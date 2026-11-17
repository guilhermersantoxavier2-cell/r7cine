'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const CONFIG = require('./config');
const { STCineWebClient } = require('./client');
const { unwrapP2pUrl } = require('./crypto');
const {
  toDirectCdnUrl,
  proxyHlsRequest,
  proxyBinaryStream,
  proxySubtitle,
  checkFfmpegAvailable,
  downloadEpisodeStream,
  getDownloadProgress,
  cancelDownloadJob,
} = require('./streamResolver');
const ENDPOINTS_CATALOG = require('./data/endpoints_catalog.json');

const startedAt = Date.now();
const client = new STCineWebClient();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.vtt': 'text/vtt; charset=utf-8',
};

function getCorsHeaders(req) {
  const origin = req.headers.origin;
  const allowOrigin =
    CONFIG.corsOrigin === '*' ? '*' : origin === CONFIG.corsOrigin ? origin : CONFIG.corsOrigin;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, HEAD, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, Range, X-STCine-Token, X-STCine-Device-Id, X-STCine-Language, X-STCine-Adult, X-STCine-Base-Prefix',
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition, X-Download-Id, X-Stream-Container, X-Total-Segments',
    'Access-Control-Max-Age': '86400',
  };
}

function sendJson(res, status, data, corsHeaders) {
  const payload = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(status, {
    ...corsHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
  });
  res.end(payload);
}

function readRequestBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return resolve({});
    }
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Corpo da requisição excede o limite de 1 MB.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (total === 0) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      const ct = String(req.headers['content-type'] || '').toLowerCase();
      if (ct.includes('application/x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(raw).entries()));
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        // fallback para form-urlencoded
        resolve(Object.fromEntries(new URLSearchParams(raw).entries()));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Extrai contexto de sessão Web opcional enviado pelo navegador
 * (permite sessões multi-usuário independentes em produção Web).
 */
function extractWebContext(req, query, body) {
  let token = req.headers['x-stcine-token'] || query.token || body?.token || '';
  const auth = req.headers.authorization || '';
  if (!token && auth.toLowerCase().startsWith('bearer ')) {
    token = auth.slice(7).trim();
  }
  const customDeviceId =
    req.headers['x-stcine-device-id'] || query.device_id || body?.device_id || '';
  const language = req.headers['x-stcine-language'] || query.lang || body?.lang || '';
  const adultRaw = req.headers['x-stcine-adult'] ?? query.adult ?? body?.adult;

  return {
    customToken: token ? String(token).trim() : undefined,
    customDeviceId: customDeviceId ? String(customDeviceId).trim() : undefined,
    language: language ? String(language).trim() : undefined,
    adult: adultRaw !== undefined && adultRaw !== '' ? String(adultRaw) : undefined,
    force: query.force === '1' || body?.force === true,
  };
}

/**
 * Prefixo opcional de URL quando o frontend consome a API em outro domínio (cross-origin).
 * Quando servido na mesma origem ou via proxy `/api`, permanece `""` (URLs relativas puras).
 */
function extractBasePrefix(req, query) {
  const explicit = req.headers['x-stcine-base-prefix'] || query.base_prefix || '';
  if (explicit && typeof explicit === 'string') {
    return explicit.trim().replace(/\/$/, '');
  }
  return '';
}

function serveStaticFile(req, res, staticRoot, pathname, corsHeaders) {
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(staticRoot, safePath);

  if (!filePath.startsWith(path.resolve(staticRoot))) {
    sendJson(res, 403, { ok: false, error: 'Acesso negado.' }, corsHeaders);
    return true;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    // Fallback SPA para index.html
    const indexHtml = path.join(staticRoot, 'index.html');
    if (fs.existsSync(indexHtml) && !path.extname(safePath)) {
      filePath = indexHtml;
    } else {
      return false;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    ...corsHeaders,
    'Content-Type': contentType,
    'Content-Length': String(stat.size),
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    fs.createReadStream(filePath).pipe(res);
  }
  return true;
}

async function handleRequest(req, res) {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname.replace(/\/+$/, '') || '/';
  const query = Object.fromEntries(reqUrl.searchParams.entries());
  const apiBasePrefix = extractBasePrefix(req, query);

  try {
    // ==================== ROTAS DE STREAMING WEB (SEM P2P) ====================

    if (pathname === '/api/stream/hls' && (req.method === 'GET' || req.method === 'HEAD')) {
      await proxyHlsRequest(req, res, query, client, corsHeaders, apiBasePrefix);
      return;
    }

    if (
      (pathname === '/api/stream/segment' || pathname === '/api/stream/media') &&
      (req.method === 'GET' || req.method === 'HEAD')
    ) {
      const target = query.url ? unwrapP2pUrl(query.url) : '';
      await proxyBinaryStream(req, res, target, corsHeaders, {
        cacheControl: 'public, max-age=86400, immutable',
      });
      return;
    }

    if (pathname === '/api/stream/subtitle' && (req.method === 'GET' || req.method === 'HEAD')) {
      await proxySubtitle(req, res, query.url || '', corsHeaders);
      return;
    }

    if (
      (pathname === '/api/stream/image' || pathname === '/api/proxy/image') &&
      (req.method === 'GET' || req.method === 'HEAD')
    ) {
      await proxyBinaryStream(req, res, query.url || '', corsHeaders, {
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        cacheControl: 'public, max-age=604800, immutable',
      });
      return;
    }

    if (pathname === '/api/stream/download' && (req.method === 'GET' || req.method === 'HEAD')) {
      const dlCtx = extractWebContext(req, query, {});
      await downloadEpisodeStream(req, res, query, client, corsHeaders, dlCtx);
      return;
    }

    if (pathname === '/api/stream/download/progress' && req.method === 'GET') {
      const data = getDownloadProgress(query.id || query.download_id || '');
      if ((query.id || query.download_id) && !data) {
        sendJson(
          res,
          404,
          { ok: false, error: 'Download não encontrado ou já expirado.' },
          corsHeaders
        );
        return;
      }
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (
      (pathname === '/api/stream/download/cancel' &&
        (req.method === 'POST' || req.method === 'GET')) ||
      (pathname === '/api/stream/download' && req.method === 'DELETE')
    ) {
      const id = query.id || query.download_id || '';
      const cancelled = cancelDownloadJob(id);
      sendJson(res, 200, { ok: true, cancelled, id }, corsHeaders);
      return;
    }

    // ==================== BRANDING ASSET (serve.png) ====================

    if (pathname === '/serve.png' && (req.method === 'GET' || req.method === 'HEAD')) {
      const logoPath = path.join(__dirname, 'serve.png');
      if (fs.existsSync(logoPath)) {
        const stat = fs.statSync(logoPath);
        res.writeHead(200, {
          ...corsHeaders,
          'Content-Type': 'image/png',
          'Content-Length': String(stat.size),
          'Cache-Control': 'public, max-age=86400',
        });
        if (req.method === 'HEAD') res.end();
        else fs.createReadStream(logoPath).pipe(res);
        return;
      }
    }

    // ==================== DOCS & SDK BROWSER ====================

    if (pathname === '/api/docs' && req.method === 'GET') {
      const html = fs.readFileSync(path.join(__dirname, 'docs.html'), 'utf8');
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (pathname === '/api/sdk.js' && req.method === 'GET') {
      const js = fs.readFileSync(path.join(__dirname, 'sdk', 'stcine-web-sdk.js'), 'utf8');
      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(js);
      return;
    }

    // Se não for rota /api e houver diretório estático configurado, serve o frontend Web
    if (!pathname.startsWith('/api') && CONFIG.staticDir && fs.existsSync(CONFIG.staticDir)) {
      if (serveStaticFile(req, res, CONFIG.staticDir, pathname, corsHeaders)) {
        return;
      }
    }

    // Raiz informativa quando rodando standalone (abre console interativo em navegadores)
    if (pathname === '/' && req.method === 'GET') {
      const accept = String(req.headers.accept || '');
      if (accept.includes('text/html') && query.format !== 'json') {
        const html = fs.readFileSync(path.join(__dirname, 'docs.html'), 'utf8');
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      sendJson(
        res,
        200,
        {
          ok: true,
          name: 'R7 STREAMING API',
          version: '1.1.0',
          edition: 'Web Direct (Sem P2P / Sem Componentes Mobile / Download de EP)',
          docs: '/api/docs',
          sdk: '/api/sdk.js',
          health: '/api/health',
          download: '/api/stream/download',
          endpoints_catalog: '/api/endpoints',
        },
        corsHeaders
      );
      return;
    }

    // Lê body para endpoints JSON/form
    const body = await readRequestBody(req);
    const params = { ...query, ...(body && typeof body === 'object' ? body : {}) };
    const ctx = extractWebContext(req, query, body);

    // ==================== HEALTH & INIT ====================

    if (pathname === '/api/health') {
      sendJson(
        res,
        200,
        {
          ok: true,
          service: 'r7-streaming-web-api',
          brand: 'R7 STREAMING',
          version: '1.1.0',
          mode: 'web-direct-no-p2p',
          p2p_required: false,
          mobile_sdk_required: false,
          download_enabled: true,
          mp4_remux_available: checkFfmpegAvailable(),
          uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
          session_initialized: Boolean(client.token),
          initialized_at: client.initializedAt,
          active_domain: client.activeDomain,
          available_domains: client.domains,
          direct_video_cdn: CONFIG.directVideoCdn,
          cache: client.cache.stats(),
        },
        corsHeaders
      );
      return;
    }

    if (pathname === '/api/init') {
      const data = await client.initSession(ctx);
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/endpoints') {
      sendJson(
        res,
        200,
        {
          ok: true,
          total: ENDPOINTS_CATALOG.length,
          gateway_usage:
            'Envie POST /api/proxy/<path_original> com JSON simples; a API assina e descriptografa automaticamente.',
          data: ENDPOINTS_CATALOG,
        },
        corsHeaders
      );
      return;
    }

    // ==================== CATÁLOGO / HOME ====================

    if (pathname === '/api/home/tabs') {
      const data = await client.getHomeTabs(ctx);
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/home') {
      const data = await client.getHome({
        categoryId: params.category_id ?? params.categoryId ?? 4,
        page: params.page ?? params.pn ?? 1,
        pageSize: params.size ?? params.psize ?? 12,
        isRecommend: params.is_recommend,
        ctx,
        apiBasePrefix,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    const modMoreMatch = pathname.match(/^\/api\/home\/module\/(\d+)\/more$/);
    if (modMoreMatch) {
      const data = await client.getModuleMore({
        moduleId: Number(modMoreMatch[1]),
        page: params.page ?? params.pn ?? 1,
        ctx,
        apiBasePrefix,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    const modRefreshMatch = pathname.match(/^\/api\/home\/module\/(\d+)\/refresh$/);
    if (modRefreshMatch) {
      const exclude = Array.isArray(params.exclude_ids)
        ? params.exclude_ids.join(',')
        : params.exclude_ids || params.not_vod_ids || '';
      const data = await client.refreshModule({
        moduleId: Number(modRefreshMatch[1]),
        size: params.size ?? params.psize ?? 9,
        excludeIds: exclude,
        ctx,
        apiBasePrefix,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/catalog/filters') {
      const data = await client.getFilters(ctx);
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/catalog/browse') {
      const data = await client.browseCatalog({
        typeId: params.type_id ?? params.typeId ?? 1,
        genre: params.genre ?? params.type ?? '',
        area: params.area ?? '',
        year: params.year ?? '',
        sort: params.sort ?? 'Popularidade',
        page: params.page ?? params.pn ?? 1,
        ctx,
        apiBasePrefix,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/catalog/recommended') {
      const data = await client.getRecommended({
        page: params.page ?? params.pn ?? 1,
        ctx,
        apiBasePrefix,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    // ==================== BUSCA & RANKINGS ====================

    if (pathname === '/api/search/hot') {
      const data = await client.getHotSearch({ ctx, apiBasePrefix });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/search/suggest') {
      const data = await client.searchSuggest({
        query: params.q ?? params.kw ?? '',
        ctx,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/search') {
      const data = await client.search({
        query: params.q ?? params.kw ?? '',
        typeId: params.type_id ?? 0,
        page: params.page ?? params.pn ?? 1,
        sort: params.sort ?? params.sr ?? 0,
        ctx,
        apiBasePrefix,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/rankings/types') {
      const data = await client.getRankingTypes({
        typeId: params.type_id ?? 0,
        ctx,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/rankings') {
      const data = await client.getRankings({
        topicId: params.topic_id ?? params.topicId ?? 1,
        pid: params.pid ?? 0,
        page: params.page ?? params.pn ?? 1,
        ctx,
        apiBasePrefix,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    // ==================== VOD DETALHE & STREAM RESOLVER ====================

    const vodDetailMatch = pathname.match(/^\/api\/vod\/(\d+)$/);
    if (vodDetailMatch) {
      const data = await client.getVodDetail({
        vodId: Number(vodDetailMatch[1]),
        audioType: params.audio_type ?? params.audioType ?? 0,
        curTime: params.cur_time ?? 0,
        searchUuid: params.search_uuid ?? '',
        ctx,
        apiBasePrefix,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    const vodSimilarMatch = pathname.match(/^\/api\/vod\/(\d+)\/similar$/);
    if (vodSimilarMatch) {
      const data = await client.getSimilar({
        vodId: Number(vodSimilarMatch[1]),
        genre: params.genre ?? params.type ?? '',
        area: params.area ?? '',
        size: params.size ?? params.psize ?? 12,
        ctx,
        apiBasePrefix,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    const vodStreamMatch = pathname.match(/^\/api\/vod\/(\d+)\/stream$/);
    if (vodStreamMatch) {
      const vodId = Number(vodStreamMatch[1]);
      const epNum = Number(params.episode ?? params.collection ?? 1);
      const audioType = Number(params.audio_type ?? params.audioType ?? 0);
      const wantSigned = params.signed === '1' || params.signed === true;

      const detail = await client.getVodDetail({
        vodId,
        audioType,
        ctx,
        apiBasePrefix,
      });

      const episodes = detail.vod_collection || [];
      const episode =
        episodes.find((e) => Number(e.collection) === epNum) ||
        episodes[Math.max(0, epNum - 1)] ||
        episodes[0];

      if (!episode) {
        sendJson(res, 404, { ok: false, error: 'Episódio não encontrado.' }, corsHeaders);
        return;
      }

      let signedUrl = null;
      if (wantSigned && episode.vod_path) {
        const res0 = episode.vod_resolution?.[0] || '720';
        const upPath = `${episode.vod_path.replace(/\/$/, '')}/${res0}/hls/index.m3u8`;
        signedUrl = await client.resolveSignedUrl(upPath, ctx);
      }

      sendJson(
        res,
        200,
        {
          ok: true,
          data: {
            vod_id: vodId,
            vod_name: detail.vod_name,
            episode_id: episode.id,
            collection: episode.collection,
            title: episode.title,
            duration: episode.duration,
            vod_duration: episode.vod_duration,
            active_audio_type: detail.active_audio_type,
            audio_options: detail.audio_type_option || [],
            signed_upstream_url: signedUrl,
            ...episode.web_stream,
          },
        },
        corsHeaders
      );
      return;
    }

    // Substituto Web direto de /GetUrl e /async-get-local-url (sem P2P)
    if (pathname === '/api/stream/resolve') {
      const inputUrl = params.url || '';
      if (!inputUrl) {
        sendJson(res, 400, { ok: false, error: 'Informe o parâmetro url.' }, corsHeaders);
        return;
      }
      const cleanUrl = unwrapP2pUrl(inputUrl);
      const directUrl = toDirectCdnUrl(cleanUrl);
      let signedUrl = '';
      try {
        signedUrl = await client.resolveSignedUrl(cleanUrl, ctx);
      } catch {
        signedUrl = directUrl;
      }
      const prefix = apiBasePrefix ? apiBasePrefix.replace(/\/$/, '') : '';
      const isMp4 = directUrl.toLowerCase().split('?')[0].endsWith('.mp4');
      const proxyUrl = isMp4
        ? `${prefix}/api/stream/segment?url=${encodeURIComponent(directUrl)}`
        : `${prefix}/api/stream/hls?url=${encodeURIComponent(directUrl)}&fallback_path=${encodeURIComponent(cleanUrl)}`;

      sendJson(
        res,
        200,
        {
          ok: true,
          data: {
            p2p_removed: cleanUrl !== inputUrl,
            format: isMp4 ? 'mp4' : 'hls',
            direct_url: directUrl,
            signed_url: signedUrl,
            proxy_url: proxyUrl,
          },
        },
        corsHeaders
      );
      return;
    }

    // ==================== BARRAGE / COMENTÁRIOS ====================

    if (pathname === '/api/barrage' && req.method === 'GET') {
      const data = await client.getBarrage({
        vodId: params.vod_id ?? params.vodId,
        collection: params.collection ?? 1,
        collectionId: params.collection_id ?? params.collectionId ?? 0,
        startTime: params.start_time ?? 0,
        endTime: params.end_time ?? 10800,
        ctx,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/barrage' && req.method === 'POST') {
      const data = await client.sendBarrage({
        vodId: params.vod_id ?? params.movie_id ?? params.vodId,
        collection: params.collection ?? 1,
        collectionId: params.collection_id ?? params.collectionId ?? 0,
        content: params.content,
        playSecond: params.play_second ?? params.playSecond ?? 0,
        ctx,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    // ==================== AUTENTICAÇÃO, FAVORITOS & HISTÓRICO ====================

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const data = await client.login({
        account: params.account,
        password: params.password,
        ctx,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const data = await client.register({
        account: params.account,
        password: params.password,
        ctx,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/user/me') {
      const data = await client.getUserInfo(ctx);
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/user/update' && req.method === 'POST') {
      const data = await client.updateUserInfo({
        nickname: params.nickname,
        sex: params.sex,
        intro: params.intro,
        ctx,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/user/favorites' && req.method === 'GET') {
      const data = await client.getFavorites({ ctx, apiBasePrefix });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/user/favorites' && req.method === 'POST') {
      const movieId = params.movie_id ?? params.vod_id ?? params.movieId;
      const fav = params.favorite !== undefined ? Boolean(params.favorite) : Number(params.type ?? 1) === 1;
      const data = await client.setFavorite({
        movieId,
        favorite: fav,
        typePid: params.type_pid ?? 1,
        typeId: params.type_id ?? 1,
        ctx,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    const delFavMatch = pathname.match(/^\/api\/user\/favorites\/(\d+)$/);
    if (delFavMatch && req.method === 'DELETE') {
      const data = await client.setFavorite({
        movieId: Number(delFavMatch[1]),
        favorite: false,
        typePid: params.type_pid ?? 1,
        typeId: params.type_id ?? 1,
        ctx,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/user/history' && req.method === 'GET') {
      const data = await client.getWatchHistory({ ctx, apiBasePrefix });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    if (pathname === '/api/user/history' && req.method === 'POST') {
      const data = await client.reportProgress({
        vodId: params.vod_id ?? params.movie_id ?? params.vodId,
        collectionId: params.collection_id ?? params.collectionId ?? 0,
        currentTime: params.current_time ?? params.vod_time ?? 0,
        totalTime: params.total_time ?? 0,
        viewTime: params.view_time ?? 0,
        type: params.type ?? '2',
        ctx,
      });
      sendJson(res, 200, { ok: true, data }, corsHeaders);
      return;
    }

    // ==================== GATEWAY UNIVERSAL (TODOS OS 117 ENDPOINTS) ====================

    if (pathname.startsWith('/api/proxy/')) {
      const targetEndpoint = pathname.slice('/api/proxy'.length);
      // Remove campos internos de controle se vierem na query
      const forwardParams = { ...params };
      delete forwardParams._bodyMode;
      delete forwardParams._method;

      const upstreamMethod =
        params._method || (targetEndpoint === '/api/v2/site_report' ? 'GET' : 'POST');
      const bodyMode = params._bodyMode || 'form';

      const envelope = await client.request(targetEndpoint, forwardParams, {
        ...client._reqOpts(ctx),
        method: upstreamMethod,
        bodyMode,
      });

      const isSuccess = Number(envelope?.code) === CONFIG.protocol.successCode;
      sendJson(
        res,
        200,
        {
          ok: isSuccess,
          endpoint: targetEndpoint,
          code: envelope?.code,
          message: envelope?.message || '',
          data: envelope?.result ?? null,
        },
        corsHeaders
      );
      return;
    }

    sendJson(
      res,
      404,
      {
        ok: false,
        error: `Rota não encontrada: ${req.method} ${pathname}`,
        docs: '/api/docs',
      },
      corsHeaders
    );
  } catch (err) {
    const status = err.apiCode ? 400 : 500;
    sendJson(
      res,
      status,
      {
        ok: false,
        code: err.apiCode || status,
        error: err.message || 'Erro interno na STCine Web API.',
      },
      corsHeaders
    );
  }
}

function startServer(port = CONFIG.port, host = CONFIG.host) {
  const server = http.createServer(handleRequest);

  server.listen(port, host, async () => {
    const mp4Remux = checkFfmpegAvailable() ? 'MP4 automatico (FFmpeg)' : 'TS/MP4 direto (sem FFmpeg)';
    console.log(`\n[R7 STREAMING API] Servidor online em http://${host}:${port}`);
    console.log(`[R7 STREAMING API] Documentacao interativa: http://localhost:${port}/api/docs`);
    console.log(`[R7 STREAMING API] Browser SDK JS:          http://localhost:${port}/api/sdk.js`);
    console.log(`[R7 STREAMING API] Download de EP/Filme:    Ativo (6x paralelo · ${mp4Remux})`);
    console.log(`[R7 STREAMING API] Modo: Web Direto (HLS/HTTP CORS, Sem P2P, Sem SDK Mobile)`);

    try {
      await client.ensureInitialized();
      console.log(
        `[R7 STREAMING API] Sessao inicializada | Dominio ativo: ${client.activeDomain} | Device Web: ${client.deviceId}`
      );
    } catch (err) {
      console.warn(`[R7 STREAMING API] Aviso na pre-inicializacao: ${err.message}`);
    }
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, handleRequest, client };
