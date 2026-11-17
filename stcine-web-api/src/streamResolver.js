'use strict';

const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const CONFIG = require('./config');
const { unwrapP2pUrl } = require('./crypto');

let cachedFfmpegAvailable = null;

/**
 * Detecta (uma única vez) se o `ffmpeg` está instalado no sistema operacional.
 * Quando disponível, remuxa fluxos MPEG-TS (.ts) para .mp4 em tempo real sem recodificar.
 * Quando ausente, entrega .mp4 nativo (para streams fMP4/MP4) ou .ts HD direto (0 dependências).
 */
function checkFfmpegAvailable() {
  if (cachedFfmpegAvailable !== null) return cachedFfmpegAvailable;
  try {
    const probe = spawnSync('ffmpeg', ['-version'], {
      stdio: 'ignore',
      timeout: 3000,
      windowsHide: true,
    });
    cachedFfmpegAvailable = probe.status === 0;
  } catch {
    cachedFfmpegAvailable = false;
  }
  return cachedFfmpegAvailable;
}

/**
 * Mapa em memória de downloads ativos/recentes para barra de progresso em tempo real no Web App.
 */
const downloadJobs = new Map();
const DOWNLOAD_JOB_TTL_MS = 5 * 60 * 1000;

function cleanupOldDownloadJobs() {
  const now = Date.now();
  for (const [id, job] of downloadJobs.entries()) {
    if (job.finishedAt && now - job.finishedAt > DOWNLOAD_JOB_TTL_MS) {
      downloadJobs.delete(id);
    }
  }
}

function serializeDownloadJob(job) {
  if (!job) return null;
  const elapsedMs = Math.max(1, (job.finishedAt || Date.now()) - job.startedAt);
  const speedBps =
    job.status === 'downloading' || job.status === 'completed'
      ? Math.round((job.bytesDownloaded * 1000) / elapsedMs)
      : 0;
  return {
    id: job.id,
    status: job.status,
    title: job.title || '',
    filename: job.filename || '',
    container: job.container || '',
    completed_segments: job.completedSegments,
    total_segments: job.totalSegments,
    percent: job.percent,
    bytes_downloaded: job.bytesDownloaded,
    speed_bps: speedBps,
    elapsed_ms: elapsedMs,
    error: job.error || null,
  };
}

function getDownloadProgress(downloadId) {
  cleanupOldDownloadJobs();
  if (downloadId) {
    return serializeDownloadJob(downloadJobs.get(String(downloadId)) || null);
  }
  return Array.from(downloadJobs.values())
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 25)
    .map(serializeDownloadJob);
}

function cancelDownloadJob(downloadId) {
  if (!downloadId) return false;
  const job = downloadJobs.get(String(downloadId));
  if (!job) return false;
  if (typeof job.cancel === 'function') {
    job.cancel();
    return true;
  }
  return false;
}

/**
 * Sanitiza nomes de arquivo para Windows, macOS, Linux e Android,
 * gerando cabeçalho Content-Disposition compatível com acentuação UTF-8 (RFC 5987).
 */
function buildAttachmentDisposition(rawBaseName, ext) {
  const cleanExt = String(ext || 'ts').replace(/^\.+/, '');
  const cleaned = String(rawBaseName || 'R7_Streaming_Video')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 150) || 'R7_Streaming_Video';

  const fullUtf8 = `${cleaned}.${cleanExt}`;
  const asciiFallback =
    cleaned
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/["\\;]/g, '')
      .trim() || 'R7_Streaming_Video';
  const encodedUtf8 = encodeURIComponent(fullUtf8).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return {
    filename: fullUtf8,
    header: `attachment; filename="${asciiFallback}.${cleanExt}"; filename*=UTF-8''${encodedUtf8}`,
  };
}

/**
 * Valida se uma URL remota é segura para proxy HTTP (prevenção de SSRF).
 * Bloqueia localhost, loopback, redes privadas RFC1918, link-local e protocolos não-HTTP(S).
 *
 * @param {string} rawUrl
 * @returns {URL | null}
 */
function parseSafeRemoteUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return null;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    const [a, b] = parts;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    ) {
      return null;
    }
  } else if (ipVersion === 6) {
    if (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.startsWith('::ffff:127.') ||
      host.startsWith('::ffff:10.') ||
      host.startsWith('::ffff:192.168.')
    ) {
      return null;
    }
  }

  return parsed;
}

/**
 * Converte caminhos do domínio de upload (`uploaded.good-videos.org`) que exigiam
 * o binário P2P `libbmhls.so` no Android diretamente para o CDN HTTP público
 * (`res.good-videos.net`), eliminando 100% da dependência de P2P/mobile.
 *
 * @param {string} url
 * @returns {string}
 */
function toDirectCdnUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const clean = unwrapP2pUrl(url);
  try {
    const u = new URL(clean);
    const cdn = new URL(CONFIG.directVideoCdn);
    // Apenas converte rotas de vídeo (mantém /uploads/images/ no domínio de imagens)
    if (u.hostname.includes('uploaded.good-videos.') && !u.pathname.startsWith('/uploads/')) {
      u.protocol = cdn.protocol;
      u.host = cdn.host;
      return u.toString();
    }
    return clean;
  } catch {
    return clean;
  }
}

/**
 * Garante barra final `/` em caminhos base de diretório de episódio.
 */
function ensureTrailingSlash(str) {
  if (!str) return '';
  return str.endsWith('/') ? str : `${str}/`;
}

/**
 * Resolve uma URI relativa dentro de uma playlist M3U8, lidando corretamente
 * inclusive com URLs pré-assinadas R2/S3 onde `/` aparece codificado como `%2F`.
 *
 * @param {string} refUri
 * @param {string} manifestUrl
 * @returns {string}
 */
function resolveManifestUri(refUri, manifestUrl) {
  const trimmed = refUri.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  const base = new URL(manifestUrl);
  // Decodifica %2F no pathname para que caminhos relativos (ex: 0000.ts, video/video.m3u8)
  // sejam resolvidos no diretório correto do episódio
  const decodedPath = base.pathname.replace(/%2F/gi, '/');
  const normalizedBase = `${base.origin}${decodedPath}`;
  return new URL(trimmed, normalizedBase).toString();
}

/**
 * Detecta se uma URI aponta para outra playlist HLS (.m3u8).
 */
function isPlaylistUri(uri) {
  try {
    const u = new URL(uri);
    const p = u.pathname.replace(/%2F/gi, '/').toLowerCase();
    return p.endsWith('.m3u8') || p.endsWith('.m3u');
  } catch {
    return uri.toLowerCase().includes('.m3u8');
  }
}

/**
 * Reescreve uma playlist HLS (Master ou Media, MPEG-TS v3 ou fMP4/CMAF v7)
 * para que todas as sub-playlists, segmentos (.ts, .m4s), init maps (#EXT-X-MAP),
 * chaves (#EXT-X-KEY) e faixas (#EXT-X-MEDIA) passem pelo proxy CORS Web da API.
 *
 * Usa caminhos relativos (ou `apiBasePrefix` se informado) para funcionar em qualquer
 * domínio, porta, túnel HTTPS ou proxy reverso sem quebrar CORS.
 *
 * @param {string} manifestText
 * @param {string} manifestUrl
 * @param {string} [apiBasePrefix='']
 * @returns {string}
 */
function rewriteHlsManifest(manifestText, manifestUrl, apiBasePrefix = '') {
  const prefix = apiBasePrefix ? apiBasePrefix.replace(/\/$/, '') : '';
  const makeProxyUrl = (absUrl, forcePlaylist = false) => {
    const encoded = encodeURIComponent(absUrl);
    if (forcePlaylist || isPlaylistUri(absUrl)) {
      return `${prefix}/api/stream/hls?url=${encoded}`;
    }
    return `${prefix}/api/stream/segment?url=${encoded}`;
  };

  const lines = manifestText.split(/\r?\n/);
  let expectStreamInfUri = false;

  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Reescreve atributos URI="..." em tags como #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, #EXT-X-I-FRAME-STREAM-INF
    if (trimmed.startsWith('#')) {
      if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
        expectStreamInfUri = true;
      }
      if (trimmed.includes('URI="')) {
        const isMediaPlaylistTag =
          trimmed.startsWith('#EXT-X-MEDIA') || trimmed.startsWith('#EXT-X-I-FRAME-STREAM-INF');
        return trimmed.replace(/URI="([^"]+)"/g, (_match, uriVal) => {
          if (uriVal.startsWith('data:')) return `URI="${uriVal}"`;
          const abs = resolveManifestUri(uriVal, manifestUrl);
          const proxied = makeProxyUrl(abs, isMediaPlaylistTag && isPlaylistUri(abs));
          return `URI="${proxied}"`;
        });
      }
      return trimmed;
    }

    // Linha de URI (segmento .ts / .m4s ou sub-playlist .m3u8)
    const abs = resolveManifestUri(trimmed, manifestUrl);
    const forcePl = expectStreamInfUri;
    expectStreamInfUri = false;
    return makeProxyUrl(abs, forcePl);
  });

  return rewritten.join('\n');
}

/**
 * Monta as informações de reprodução Web (100% livre de P2P e de anúncios mobile)
 * para um episódio (`VideoBean`) retornado por `/Detail`.
 *
 * @param {object} ep
 * @param {string} [apiBasePrefix='']
 * @returns {object}
 */
function buildEpisodeWebStreams(ep, apiBasePrefix = '') {
  const prefix = apiBasePrefix ? apiBasePrefix.replace(/\/$/, '') : '';
  const resolutions =
    Array.isArray(ep.vod_resolution) && ep.vod_resolution.length > 0
      ? ep.vod_resolution.map(String)
      : ['720'];

  // Limpa qualquer URL P2P legada
  const rawVodUrl = unwrapP2pUrl(ep.orginal_url || ep.vod_url || '');
  const baseDownUrl = ep.down_url ? ensureTrailingSlash(toDirectCdnUrl(ep.down_url)) : '';
  const baseVodPath = ep.vod_path ? ensureTrailingSlash(ep.vod_path) : '';
  const convertedVodPath = baseVodPath ? ensureTrailingSlash(toDirectCdnUrl(baseVodPath)) : '';

  const baseCdn = baseDownUrl || convertedVodPath;

  const qualityOptions = resolutions.map((res) => {
    const directHls = baseCdn ? `${baseCdn}${res}/hls/index.m3u8` : rawVodUrl;
    const upstreamSignTarget = baseVodPath ? `${baseVodPath}${res}/hls/index.m3u8` : directHls;
    const proxyParams = new URLSearchParams();
    if (directHls) proxyParams.set('url', directHls);
    if (upstreamSignTarget) proxyParams.set('fallback_path', upstreamSignTarget);

    return {
      resolution: res,
      label: `${res}p${Number(res) >= 720 ? ' HD' : ''}`,
      format: directHls.toLowerCase().endsWith('.mp4') ? 'mp4' : 'hls',
      direct_url: directHls,
      proxy_url: directHls
        ? directHls.toLowerCase().endsWith('.mp4')
          ? `${prefix}/api/stream/segment?url=${encodeURIComponent(directHls)}`
          : `${prefix}/api/stream/hls?${proxyParams.toString()}`
        : '',
      signed_proxy_url: upstreamSignTarget
        ? `${prefix}/api/stream/hls?signed=1&fallback_path=${encodeURIComponent(upstreamSignTarget)}`
        : '',
      download_url: directHls
        ? `${prefix}/api/stream/download?${proxyParams.toString()}`
        : '',
    };
  });

  // Caso exista vod_url direta (.mp4 ou .m3u8) sem baseCdn
  if (!qualityOptions[0]?.direct_url && rawVodUrl) {
    const isMp4 = rawVodUrl.toLowerCase().split('?')[0].endsWith('.mp4');
    qualityOptions[0] = {
      resolution: resolutions[0] || 'auto',
      label: 'Auto',
      format: isMp4 ? 'mp4' : 'hls',
      direct_url: rawVodUrl,
      proxy_url: isMp4
        ? `${prefix}/api/stream/segment?url=${encodeURIComponent(rawVodUrl)}`
        : `${prefix}/api/stream/hls?url=${encodeURIComponent(rawVodUrl)}`,
      signed_proxy_url: '',
      download_url: `${prefix}/api/stream/download?url=${encodeURIComponent(rawVodUrl)}`,
    };
  }

  // Normaliza legendas externas (se existirem) para WebVTT via proxy
  const subtitles = Array.isArray(ep.vod_subtitle)
    ? ep.vod_subtitle
        .map((sub, idx) => {
          const subUrl =
            typeof sub === 'string'
              ? sub
              : sub?.url || sub?.sub_url || sub?.subtitle_url || sub?.src || '';
          if (!subUrl) return null;
          const fullSubUrl = subUrl.startsWith('http')
            ? toDirectCdnUrl(subUrl)
            : baseCdn
              ? `${baseCdn}${subUrl.replace(/^\//, '')}`
              : '';
          if (!fullSubUrl) return null;
          const lang = sub?.lang || sub?.language || sub?.code || 'pt';
          const label = sub?.name || sub?.title || sub?.label || `Legenda ${idx + 1}`;
          return {
            lang,
            label,
            direct_url: fullSubUrl,
            vtt_proxy_url: `${prefix}/api/stream/subtitle?url=${encodeURIComponent(fullSubUrl)}`,
          };
        })
        .filter(Boolean)
    : [];

  // Ordena qualidades da maior para a menor
  qualityOptions.sort((a, b) => (Number(b.resolution) || 0) - (Number(a.resolution) || 0));
  const primary = qualityOptions[0] || null;

  return {
    ...ep,
    // Remove flags de P2P e anúncio do app mobile
    is_p2p: 0,
    is_ad: 0,
    vod_url: primary?.proxy_url || '',
    direct_url: primary?.direct_url || '',
    web_stream: {
      mode: 'direct-web-http',
      p2p_required: false,
      format: primary?.format || 'hls',
      proxy_url: primary?.proxy_url || '',
      signed_proxy_url: primary?.signed_proxy_url || '',
      download_url: primary?.download_url || '',
      direct_url: primary?.direct_url || '',
      qualities: qualityOptions,
      subtitles,
    },
  };
}

/**
 * Converte legendas SRT para WebVTT padrão HTML5 `<track>`.
 */
function srtToWebVtt(text) {
  const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (cleaned.startsWith('WEBVTT')) return cleaned + '\n';
  // Converte timestamps 00:01:23,456 --> 00:01:25,789 para 00:01:23.456 --> 00:01:25.789
  const converted = cleaned.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );
  return `WEBVTT\n\n${converted}\n`;
}

/**
 * Faz proxy de playlist HLS (.m3u8) com fallback automático para URL assinada via `/GetUrl`.
 */
async function proxyHlsRequest(req, res, query, client, corsHeaders, apiBasePrefix = '') {
  const forceSigned = query.signed === '1' || query.signed === 'true';
  const rawUrl = query.url ? unwrapP2pUrl(query.url) : '';
  const fallbackPath = query.fallback_path ? unwrapP2pUrl(query.fallback_path) : '';

  let targetUrl = '';
  if (forceSigned && fallbackPath) {
    targetUrl = await client.resolveSignedUrl(fallbackPath);
  } else if (rawUrl) {
    targetUrl = toDirectCdnUrl(rawUrl);
  } else if (fallbackPath) {
    targetUrl = toDirectCdnUrl(fallbackPath);
  }

  const safeUrl = parseSafeRemoteUrl(targetUrl);
  if (!safeUrl) {
    res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'URL de stream HLS inválida ou bloqueada.' }));
    return;
  }

  const fetchPlaylist = async (urlToFetch) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.streamTimeoutMs);
    try {
      const upstream = await fetch(urlToFetch, {
        method: 'GET',
        headers: {
          'User-Agent': CONFIG.userAgent,
          Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
        },
        signal: controller.signal,
      });
      if (!upstream.ok) {
        return { ok: false, status: upstream.status, text: '', finalUrl: urlToFetch };
      }
      const text = await upstream.text();
      if (!text.trim().startsWith('#EXTM3U')) {
        return { ok: false, status: 502, text: '', finalUrl: urlToFetch };
      }
      return { ok: true, status: 200, text, finalUrl: upstream.url || urlToFetch };
    } finally {
      clearTimeout(timer);
    }
  };

  let result = await fetchPlaylist(safeUrl.toString());

  // Fallback automático: se o CDN direto retornar 403/404, solicita URL pré-assinada em /GetUrl
  if (!result.ok && !forceSigned && (fallbackPath || rawUrl)) {
    try {
      const signed = await client.resolveSignedUrl(fallbackPath || rawUrl);
      const safeSigned = parseSafeRemoteUrl(signed);
      if (safeSigned && safeSigned.toString() !== safeUrl.toString()) {
        result = await fetchPlaylist(safeSigned.toString());
      }
    } catch {
      // mantém erro original
    }
  }

  if (!result.ok) {
    res.writeHead(result.status || 502, {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(
      JSON.stringify({
        ok: false,
        error: `Falha ao carregar manifesto HLS upstream (HTTP ${result.status}).`,
      })
    );
    return;
  }

  const rewritten = rewriteHlsManifest(result.text, result.finalUrl, apiBasePrefix);
  const bodyBuf = Buffer.from(rewritten, 'utf8');

  res.writeHead(200, {
    ...corsHeaders,
    'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
    'Content-Length': String(bodyBuf.length),
    'Cache-Control': 'public, max-age=300',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(bodyBuf);
}

/**
 * Faz streaming binário de segmentos HLS (.ts, .m4s, init.mp4, chaves) ou arquivos MP4
 * com suporte completo a HTTP Range (`206 Partial Content`) e CORS Web.
 */
async function proxyBinaryStream(req, res, rawUrl, corsHeaders, options = {}) {
  const safeUrl = parseSafeRemoteUrl(rawUrl);
  if (!safeUrl) {
    res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'URL de mídia inválida ou bloqueada.' }));
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.streamTimeoutMs);
  req.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  const reqHeaders = {
    'User-Agent': CONFIG.userAgent,
    Accept: options.accept || '*/*',
  };
  if (req.headers.range) {
    reqHeaders.Range = req.headers.range;
  }

  try {
    const upstream = await fetch(safeUrl.toString(), {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: reqHeaders,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!upstream.ok && upstream.status !== 206) {
      res.writeHead(upstream.status, {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          ok: false,
          error: `Recurso de mídia retornou HTTP ${upstream.status}.`,
        })
      );
      return;
    }

    // Determina Content-Type adequado para navegadores
    let contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const pathLower = safeUrl.pathname.toLowerCase();
    if (pathLower.endsWith('.ts')) contentType = 'video/mp2t';
    else if (pathLower.endsWith('.m4s')) contentType = 'video/iso.segment';
    else if (pathLower.endsWith('.mp4')) contentType = 'video/mp4';

    const outHeaders = {
      ...corsHeaders,
      'Content-Type': contentType,
      'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
      'Cache-Control': options.cacheControl || 'public, max-age=86400, immutable',
    };
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) outHeaders['Content-Length'] = contentLength;
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) outHeaders['Content-Range'] = contentRange;
    const etag = upstream.headers.get('etag');
    if (etag) outHeaders.ETag = etag;

    res.writeHead(upstream.status, outHeaders);

    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    nodeStream.pipe(res);
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError' || res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    res.writeHead(502, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: `Erro no proxy de mídia: ${err.message}` }));
  }
}

/**
 * Faz proxy de legendas convertendo automaticamente SRT -> WebVTT.
 */
async function proxySubtitle(req, res, rawUrl, corsHeaders) {
  const safeUrl = parseSafeRemoteUrl(rawUrl);
  if (!safeUrl) {
    res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'URL de legenda inválida.' }));
    return;
  }

  try {
    const upstream = await fetch(safeUrl.toString(), {
      headers: { 'User-Agent': CONFIG.userAgent },
    });
    if (!upstream.ok) {
      res.writeHead(upstream.status, {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ ok: false, error: `Legenda retornou HTTP ${upstream.status}.` }));
      return;
    }
    const text = await upstream.text();
    const vtt = srtToWebVtt(text);
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(vtt);
  } catch (err) {
    res.writeHead(502, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: `Falha ao converter legenda: ${err.message}` }));
  }
}

/**
 * Baixa uma playlist M3U8 como texto com timeout e validação.
 */
async function fetchTextPlaylist(urlToFetch, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.streamTimeoutMs);
  const onParentAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onParentAbort, { once: true });
  try {
    const upstream = await fetch(urlToFetch, {
      method: 'GET',
      headers: {
        'User-Agent': CONFIG.userAgent,
        Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
      },
      signal: controller.signal,
    });
    if (!upstream.ok) {
      return { ok: false, status: upstream.status, text: '', finalUrl: urlToFetch };
    }
    const text = await upstream.text();
    if (!text.trim().startsWith('#EXTM3U')) {
      return { ok: false, status: 502, text: '', finalUrl: urlToFetch };
    }
    return { ok: true, status: 200, text, finalUrl: upstream.url || urlToFetch };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Extrai a lista ordenada de segmentos (incluindo `#EXT-X-MAP` init.mp4 em streams fMP4
 * e chaves `#EXT-X-KEY:METHOD=AES-128` se houver) de uma Media Playlist HLS.
 */
function parseHlsMediaSegments(manifestText, manifestUrl) {
  const lines = manifestText.split(/\r?\n/);
  const items = [];
  let isFmp4 = false;
  let mediaSequence = 0;
  let segIndex = 0;
  let currentKey = null;
  let lastInitUri = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      const n = parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length), 10);
      if (Number.isFinite(n)) mediaSequence = n;
      continue;
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      const m = line.match(/URI="([^"]+)"/);
      if (m && m[1]) {
        const initUrl = resolveManifestUri(m[1], manifestUrl);
        if (initUrl && initUrl !== lastInitUri) {
          lastInitUri = initUrl;
          isFmp4 = true;
          items.push({ url: initUrl, isInit: true, key: currentKey, seq: mediaSequence + segIndex });
        }
      }
      continue;
    }

    if (line.startsWith('#EXT-X-KEY:')) {
      const methodMatch = line.match(/METHOD=([^,\s]+)/);
      const method = methodMatch ? methodMatch[1].trim().toUpperCase() : 'NONE';
      if (method === 'NONE') {
        currentKey = null;
      } else if (method === 'AES-128') {
        const uriMatch = line.match(/URI="([^"]+)"/);
        const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/);
        currentKey = {
          method: 'AES-128',
          uri: uriMatch ? resolveManifestUri(uriMatch[1], manifestUrl) : '',
          ivHex: ivMatch ? ivMatch[1].padStart(32, '0').slice(0, 32) : '',
        };
      }
      continue;
    }

    if (line.startsWith('#')) continue;

    const segUrl = resolveManifestUri(line, manifestUrl);
    if (!segUrl) continue;
    try {
      const p = new URL(segUrl).pathname.replace(/%2F/gi, '/').toLowerCase();
      if (p.endsWith('.m4s') || p.endsWith('.mp4')) isFmp4 = true;
    } catch {
      // ignora
    }
    items.push({
      url: segUrl,
      isInit: false,
      key: currentKey ? { ...currentKey } : null,
      seq: mediaSequence + segIndex,
    });
    segIndex += 1;
  }

  return { isFmp4, items };
}

/**
 * Seleciona a variante de vídeo de maior bitrate em uma Master Playlist HLS.
 */
function pickBestMasterVariant(manifestText, manifestUrl) {
  const lines = manifestText.split(/\r?\n/);
  const variants = [];
  let pendingBandwidth = 0;
  let waitingUri = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const bw = line.match(/BANDWIDTH=(\d+)/);
      pendingBandwidth = bw ? parseInt(bw[1], 10) : 1;
      waitingUri = true;
      continue;
    }
    if (line.startsWith('#')) continue;
    if (waitingUri) {
      waitingUri = false;
      const abs = resolveManifestUri(line, manifestUrl);
      if (abs) variants.push({ url: abs, bandwidth: pendingBandwidth });
    }
  }

  if (variants.length === 0) return '';
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return variants[0].url;
}

/**
 * Baixa um segmento binário com até 3 tentativas, timeout e descriptografia AES-128 opcional.
 */
async function fetchSegmentBuffer(segItem, keyCache, parentSignal) {
  const safe = parseSafeRemoteUrl(segItem.url);
  if (!safe) throw new Error('URL de segmento inválida ou bloqueada.');

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (parentSignal.aborted) throw new Error('Download cancelado.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.streamTimeoutMs);
    const onAbort = () => controller.abort();
    parentSignal.addEventListener('abort', onAbort, { once: true });

    try {
      const r = await fetch(safe.toString(), {
        headers: { 'User-Agent': CONFIG.userAgent, Accept: '*/*' },
        signal: controller.signal,
      });
      if (!r.ok) {
        throw new Error(`Segmento retornou HTTP ${r.status}`);
      }
      let buf = Buffer.from(await r.arrayBuffer());

      // Descriptografa AES-128 caso a playlist utilize #EXT-X-KEY
      if (segItem.key && segItem.key.method === 'AES-128' && segItem.key.uri) {
        let keyBuf = keyCache.get(segItem.key.uri);
        if (!keyBuf) {
          const safeKey = parseSafeRemoteUrl(segItem.key.uri);
          if (!safeKey) throw new Error('URL de chave HLS inválida.');
          const kr = await fetch(safeKey.toString(), {
            headers: { 'User-Agent': CONFIG.userAgent },
            signal: controller.signal,
          });
          if (!kr.ok) throw new Error(`Falha ao obter chave HLS (HTTP ${kr.status})`);
          keyBuf = Buffer.from(await kr.arrayBuffer());
          keyCache.set(segItem.key.uri, keyBuf);
        }
        let ivBuf;
        if (segItem.key.ivHex) {
          ivBuf = Buffer.from(segItem.key.ivHex, 'hex');
        } else {
          ivBuf = Buffer.alloc(16, 0);
          ivBuf.writeBigUInt64BE(BigInt(segItem.seq || 0), 8);
        }
        const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuf, ivBuf);
        buf = Buffer.concat([decipher.update(buf), decipher.final()]);
      }

      return buf;
    } catch (err) {
      lastErr = err;
      if (parentSignal.aborted) break;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr || new Error('Falha ao baixar segmento.');
}

/**
 * Escreve um Buffer em uma WritableStream respeitando backpressure de rede.
 */
function writeChunkWithBackpressure(writable, buf, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted || writable.destroyed || writable.writableEnded) {
      return reject(new Error('Stream encerrada.'));
    }
    const ok = writable.write(buf, (err) => {
      if (err) reject(err);
    });
    if (ok) return resolve();

    const cleanup = () => {
      writable.removeListener('drain', onDrain);
      writable.removeListener('error', onErr);
      writable.removeListener('close', onClose);
      signal.removeEventListener('abort', onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onErr = (err) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Stream encerrada.'));
    };

    writable.once('drain', onDrain);
    writable.once('error', onErr);
    writable.once('close', onClose);
    signal.addEventListener('abort', onClose, { once: true });
  });
}

/**
 * Faz o download completo de um episódio ou filme diretamente para o navegador do usuário
 * (sem P2P e sem consumir RAM excessiva), juntando segmentos HLS em paralelo (6x) em ordem
 * exata, com suporte a:
 *  - MP4 direto e HLS fMP4/CMAF (init.mp4 + .m4s -> .mp4 nativo, sem dependências)
 *  - HLS MPEG-TS (.ts -> remux automático p/ .mp4 se ffmpeg existir, ou .ts HD direto)
 *  - Fallback automático de URL assinada R2 (/GetUrl)
 *  - Progresso em tempo real via `GET /api/stream/download/progress?id=<download_id>`
 */
async function downloadEpisodeStream(req, res, query, client, corsHeaders, ctx = {}) {
  cleanupOldDownloadJobs();

  let rawUrl = query.url ? unwrapP2pUrl(query.url) : '';
  let fallbackPath = query.fallback_path ? unwrapP2pUrl(query.fallback_path) : '';
  let baseFilename = query.filename ? String(query.filename).trim() : '';
  const requestedContainer = String(query.container || 'auto').toLowerCase();
  const downloadId = query.download_id
    ? String(query.download_id).slice(0, 80)
    : `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const maxSegments = query.max_segments ? Math.max(1, parseInt(query.max_segments, 10) || 0) : 0;

  const abortController = new AbortController();
  const job = {
    id: downloadId,
    status: 'preparing',
    title: baseFilename,
    filename: '',
    container: '',
    completedSegments: 0,
    totalSegments: 0,
    percent: 0,
    bytesDownloaded: 0,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    cancel: () => {
      if (!abortController.signal.aborted) {
        job.status = 'cancelled';
        job.finishedAt = Date.now();
        abortController.abort();
      }
    },
  };
  downloadJobs.set(downloadId, job);

  res.on('close', () => {
    if (!res.writableFinished && !abortController.signal.aborted) {
      job.status = 'cancelled';
      job.finishedAt = Date.now();
      abortController.abort();
    }
  });

  try {
    // Permite chamar também diretamente por ?vod_id=149145&episode=1&audio_type=0
    if (!rawUrl && !fallbackPath && query.vod_id) {
      const detail = await client.getVodDetail({
        vodId: Number(query.vod_id),
        audioType: query.audio_type ?? 0,
        ctx,
      });
      const eps = Array.isArray(detail?.vod_collection) ? detail.vod_collection : [];
      const wantedEp = Number(query.episode || 1);
      const epObj =
        eps.find((e) => Number(e.collection) === wantedEp) || eps[wantedEp - 1] || eps[0];
      const qualities = epObj?.web_stream?.qualities || [];
      const qObj =
        (query.resolution
          ? qualities.find((q) => String(q.resolution) === String(query.resolution))
          : null) ||
        qualities[0] ||
        epObj?.web_stream;
      rawUrl = qObj?.direct_url || epObj?.web_stream?.direct_url || '';
      if (qObj?.proxy_url) {
        try {
          const parsedProxy = new URL(qObj.proxy_url, 'http://localhost');
          fallbackPath = parsedProxy.searchParams.get('fallback_path') || '';
        } catch {
          // ignora
        }
      }
      if (!baseFilename) {
        const title = detail?.vod_name || `VOD_${query.vod_id}`;
        const epLabel = epObj?.title || epObj?.collection || wantedEp;
        const isMulti = eps.length > 1;
        const resLabel = qObj?.resolution ? `${qObj.resolution}p` : 'HD';
        baseFilename = isMulti
          ? `${title} - Ep ${String(epLabel).padStart(2, '0')} [${resLabel}]`
          : `${title} [${resLabel}]`;
        job.title = baseFilename;
      }
    }

    const initialTarget = rawUrl ? toDirectCdnUrl(rawUrl) : toDirectCdnUrl(fallbackPath);
    const safeInitial = parseSafeRemoteUrl(initialTarget);
    if (!safeInitial) {
      job.status = 'error';
      job.error = 'URL de download inválida ou ausente.';
      job.finishedAt = Date.now();
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: job.error }));
      return;
    }

    // Caso 1: Arquivo MP4 direto
    const cleanPathLower = safeInitial.pathname.replace(/%2F/gi, '/').toLowerCase();
    if (cleanPathLower.endsWith('.mp4')) {
      const upstream = await fetch(safeInitial.toString(), {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: { 'User-Agent': CONFIG.userAgent },
        signal: abortController.signal,
      });
      if (!upstream.ok) {
        throw new Error(`Servidor de vídeo retornou HTTP ${upstream.status}.`);
      }
      const disp = buildAttachmentDisposition(baseFilename || 'R7_Streaming_Video', 'mp4');
      const totalBytes = parseInt(upstream.headers.get('content-length') || '0', 10) || 0;
      job.filename = disp.filename;
      job.container = 'mp4';
      job.status = 'downloading';
      job.totalSegments = 1;

      const headers = {
        ...corsHeaders,
        'Content-Type': 'video/mp4',
        'Content-Disposition': disp.header,
        'Cache-Control': 'no-store',
        'X-Download-Id': downloadId,
      };
      if (totalBytes > 0) headers['Content-Length'] = String(totalBytes);
      res.writeHead(200, headers);

      if (req.method === 'HEAD' || !upstream.body) {
        job.status = 'completed';
        job.percent = 100;
        job.finishedAt = Date.now();
        res.end();
        return;
      }

      for await (const chunk of Readable.fromWeb(upstream.body)) {
        await writeChunkWithBackpressure(res, chunk, abortController.signal);
        job.bytesDownloaded += chunk.length;
        if (totalBytes > 0) {
          job.percent = Math.min(99, Math.round((job.bytesDownloaded / totalBytes) * 100));
        }
      }
      job.completedSegments = 1;
      job.percent = 100;
      job.status = 'completed';
      job.finishedAt = Date.now();
      res.end();
      return;
    }

    // Caso 2: Playlist HLS (Master ou Media, MPEG-TS ou fMP4/CMAF)
    let pl = await fetchTextPlaylist(safeInitial.toString(), abortController.signal);
    if (!pl.ok && (fallbackPath || rawUrl)) {
      const signedUrl = await client.resolveSignedUrl(fallbackPath || rawUrl);
      const safeSigned = parseSafeRemoteUrl(signedUrl);
      if (safeSigned) {
        pl = await fetchTextPlaylist(safeSigned.toString(), abortController.signal);
      }
    }
    if (!pl.ok) {
      throw new Error(`Não foi possível obter a playlist do episódio (HTTP ${pl.status}).`);
    }

    // Se for Master Playlist (#EXT-X-STREAM-INF), desce para a variante de maior qualidade
    if (pl.text.includes('#EXT-X-STREAM-INF')) {
      const bestVariant = pickBestMasterVariant(pl.text, pl.finalUrl);
      const safeVariant = parseSafeRemoteUrl(bestVariant);
      if (!safeVariant) {
        throw new Error('Nenhuma variante de vídeo válida encontrada na playlist.');
      }
      pl = await fetchTextPlaylist(safeVariant.toString(), abortController.signal);
      if (!pl.ok) {
        throw new Error(`Falha ao abrir sub-playlist de vídeo (HTTP ${pl.status}).`);
      }
    }

    const parsed = parseHlsMediaSegments(pl.text, pl.finalUrl);
    let segments = parsed.items;
    if (segments.length === 0) {
      throw new Error('Nenhum segmento de vídeo encontrado para download.');
    }
    if (maxSegments > 0 && segments.length > maxSegments) {
      segments = segments.slice(0, maxSegments);
    }

    const canRemuxMp4 =
      !parsed.isFmp4 &&
      requestedContainer !== 'ts' &&
      (requestedContainer === 'auto' || requestedContainer === 'mp4') &&
      checkFfmpegAvailable();

    const outExt = parsed.isFmp4 || canRemuxMp4 ? 'mp4' : 'ts';
    const outMime = outExt === 'mp4' ? 'video/mp4' : 'video/mp2t';
    const disp = buildAttachmentDisposition(baseFilename || 'R7_Streaming_Episodio', outExt);

    job.filename = disp.filename;
    job.container = outExt;
    job.totalSegments = segments.length;
    job.status = 'downloading';

    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': outMime,
      'Content-Disposition': disp.header,
      'Cache-Control': 'no-store',
      'X-Download-Id': downloadId,
      'X-Stream-Container': outExt,
      'X-Total-Segments': String(segments.length),
    });

    if (req.method === 'HEAD') {
      job.status = 'completed';
      job.finishedAt = Date.now();
      res.end();
      return;
    }

    // Se ffmpeg estiver instalado, remuxa TS -> MP4 em streaming (zero recodificação, zero arquivo temp)
    let ffmpegProc = null;
    let outputTarget = res;
    let ffmpegExitPromise = null;

    if (canRemuxMp4) {
      ffmpegProc = spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'mpegts',
          '-i',
          'pipe:0',
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-c',
          'copy',
          '-bsf:a',
          'aac_adtstoasc',
          '-movflags',
          'frag_keyframe+empty_moov',
          '-f',
          'mp4',
          'pipe:1',
        ],
        { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
      );
      outputTarget = ffmpegProc.stdin;
      outputTarget.on('error', () => {});
      ffmpegProc.stdout.pipe(res);
      ffmpegExitPromise = new Promise((resolve) => {
        ffmpegProc.on('close', resolve);
        ffmpegProc.on('error', resolve);
      });
      abortController.signal.addEventListener(
        'abort',
        () => {
          try {
            ffmpegProc.kill('SIGTERM');
          } catch {
            // ignora
          }
        },
        { once: true }
      );
    }

    // Janela deslizante paralela (6 conexões simultâneas) mantendo a ordem exata 0..N-1
    const CONCURRENCY = 6;
    const keyCache = new Map();
    const inFlight = new Map();
    let nextToLaunch = 0;

    const fillWindow = (writeCursor) => {
      while (
        nextToLaunch < segments.length &&
        nextToLaunch - writeCursor < CONCURRENCY &&
        !abortController.signal.aborted
      ) {
        const idx = nextToLaunch;
        nextToLaunch += 1;
        const p = fetchSegmentBuffer(segments[idx], keyCache, abortController.signal);
        // Evita UnhandledRejection caso outro segmento falhe antes do await
        p.catch(() => {});
        inFlight.set(idx, p);
      }
    };

    for (let i = 0; i < segments.length; i += 1) {
      if (abortController.signal.aborted) break;
      fillWindow(i);
      const promise = inFlight.get(i);
      inFlight.delete(i);
      const chunk = await promise;
      fillWindow(i + 1);

      await writeChunkWithBackpressure(outputTarget, chunk, abortController.signal);
      job.completedSegments = i + 1;
      job.bytesDownloaded += chunk.length;
      job.percent = Math.round(((i + 1) / segments.length) * 100);
    }

    if (ffmpegProc) {
      outputTarget.end();
      await ffmpegExitPromise;
    } else if (!res.writableEnded) {
      res.end();
    }

    if (!abortController.signal.aborted) {
      job.status = 'completed';
      job.percent = 100;
      job.finishedAt = Date.now();
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      job.status = 'error';
      job.error = err?.message || 'Erro durante o download do episódio.';
      job.finishedAt = Date.now();
    }
    if (!res.headersSent) {
      res.writeHead(502, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: job.error || 'Download interrompido.' }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

module.exports = {
  parseSafeRemoteUrl,
  toDirectCdnUrl,
  resolveManifestUri,
  rewriteHlsManifest,
  buildEpisodeWebStreams,
  srtToWebVtt,
  proxyHlsRequest,
  proxyBinaryStream,
  proxySubtitle,
  checkFfmpegAvailable,
  downloadEpisodeStream,
  getDownloadProgress,
  cancelDownloadJob,
};
