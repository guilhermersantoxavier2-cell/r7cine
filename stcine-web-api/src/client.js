'use strict';

const fs = require('node:fs');
const path = require('node:path');
const CONFIG = require('./config');
const {
  decryptPayload,
  generateWebDeviceId,
  buildSignedHeaders,
  buildSignedForm,
  unwrapP2pUrl,
} = require('./crypto');
const { MemoryCache } = require('./cache');
const { buildEpisodeWebStreams, toDirectCdnUrl } = require('./streamResolver');

/**
 * Normaliza e enriquece um item de vídeo (`RecommandVideosEntity`) para uso direto na Web:
 *  - Adiciona `poster_proxy` (CORS-safe) além de `vod_pic`
 *  - Transforma `vod_tag` string em array `genres`
 *  - Remove flags de anúncio/P2P mobile
 *  - Padroniza campos de tipo (`media_type`: 'movie' | 'series')
 */
function normalizeVodItem(vod, apiBasePrefix = '') {
  if (!vod || typeof vod !== 'object') return vod;
  const prefix = apiBasePrefix ? apiBasePrefix.replace(/\/$/, '') : '';
  const pic = vod.vod_pic || vod.coverUrl || '';
  const tags =
    typeof vod.vod_tag === 'string' && vod.vod_tag.trim()
      ? vod.vod_tag
          .split(/[,/、]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  const scoreNum = parseFloat(vod.vod_douban_score);
  const score = Number.isFinite(scoreNum) && scoreNum > 0 ? scoreNum.toFixed(1) : null;
  const isMovie = Number(vod.type_pid) === 1 || (Number(vod.vod_total) === 1 && Number(vod.type_pid) !== 2);

  const normalized = {
    ...vod,
    hide_ad: 1,
    poster_url: pic,
    poster_proxy: pic ? `${prefix}/api/stream/image?url=${encodeURIComponent(pic)}` : '',
    genres: tags,
    rating: score,
    media_type: isMovie ? 'movie' : 'series',
  };

  if (Array.isArray(vod.vod_collection)) {
    normalized.vod_collection = vod.vod_collection.map((ep) =>
      buildEpisodeWebStreams(ep, apiBasePrefix)
    );
  }

  return normalized;
}

/**
 * Cliente Web principal do STCine.
 * Substitui integralmente:
 *  - Retrofit + OkHttp + Interceptor Lub/n0$a (assinatura dupla form + headers)
 *  - Descriptografia AES-256-CBC de respostas
 *  - RetrofitUrlManager + Lub/p0 (rotação de domínios + beacon fallback)
 *  - SharedPreferences + ANDROID_ID + GAID (sessão Web limpa)
 *  - NativeLib / libbmhls.so (resolução HTTP/HLS direta sem P2P)
 */
class STCineWebClient {
  constructor() {
    this.cache = new MemoryCache(800);
    this.domains = [...CONFIG.defaultDomains];
    this.activeDomain = this.domains[0];
    this.deviceId = '';
    this.token = '';
    this.userInfo = null;
    this.sysConf = null;
    this.vConfig = null;
    this.initializedAt = null;
    this.initPromise = null;

    this._loadPersistedSession();
  }

  _loadPersistedSession() {
    try {
      if (fs.existsSync(CONFIG.sessionFile)) {
        const saved = JSON.parse(fs.readFileSync(CONFIG.sessionFile, 'utf8'));
        if (saved.deviceId) this.deviceId = saved.deviceId;
        if (saved.token) this.token = saved.token;
        if (saved.activeDomain) this.activeDomain = saved.activeDomain;
        if (Array.isArray(saved.domains) && saved.domains.length > 0) {
          this.domains = saved.domains;
        }
        if (saved.userInfo) this.userInfo = saved.userInfo;
      }
    } catch {
      // ignora sessão corrompida e cria nova
    }
    if (!this.deviceId) {
      this.deviceId = generateWebDeviceId();
      this._savePersistedSession();
    }
  }

  _savePersistedSession() {
    try {
      const dir = path.dirname(CONFIG.sessionFile);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        CONFIG.sessionFile,
        JSON.stringify(
          {
            deviceId: this.deviceId,
            token: this.token,
            activeDomain: this.activeDomain,
            domains: this.domains,
            userInfo: this.userInfo,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf8'
      );
    } catch {
      // ambiente somente-leitura (ex: serverless) continua em memória normalmente
    }
  }

  /**
   * Atualiza lista de domínios ativos retornada por `/comm/init` (`sys_conf.api_conf`).
   */
  _applyDomainConfig(sysConf) {
    if (!sysConf) return;
    const nextDomains = [];

    if (sysConf.api_url2 && typeof sysConf.api_url2 === 'string') {
      nextDomains.push(sysConf.api_url2.replace(/\/$/, ''));
    }
    if (Array.isArray(sysConf.api_conf)) {
      // Prioriza domínios com is_open === 1, seguidos dos demais como fallback
      const open = sysConf.api_conf
        .filter((d) => d?.api && Number(d.is_open) === 1)
        .map((d) => d.api.trim().replace(/\/$/, ''));
      const backup = sysConf.api_conf
        .filter((d) => d?.api && Number(d.is_open) !== 1)
        .map((d) => d.api.trim().replace(/\/$/, ''));
      nextDomains.push(...open, ...backup);
    }
    for (const d of CONFIG.defaultDomains) {
      nextDomains.push(d.replace(/\/$/, ''));
    }

    const unique = [...new Set(nextDomains.filter((d) => d.startsWith('http')))];
    if (unique.length > 0) {
      this.domains = unique;
      this.activeDomain = unique[0];
    }
  }

  /**
   * Consulta o beacon remoto de fallback caso todos os domínios conhecidos falhem.
   */
  async _fetchBeaconDomain() {
    try {
      const res = await fetch(CONFIG.fallbackBeaconUrl, {
        headers: { 'User-Agent': CONFIG.userAgent },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const body = (await res.text()).trim();
      if (body.startsWith('https://') || body.startsWith('http://')) {
        const cleaned = body.replace(/\/$/, '');
        if (!this.domains.includes(cleaned)) {
          this.domains.unshift(cleaned);
        }
        this.activeDomain = cleaned;
        this._savePersistedSession();
        return cleaned;
      }
    } catch {
      // ignora erro do beacon
    }
    return null;
  }

  /**
   * Executa uma chamada assinada + descriptografada para qualquer endpoint STCine,
   * com rotação automática de domínio em caso de falha de rede.
   *
   * @param {string} endpointPath
   * @param {Record<string, any>} [params={}]
   * @param {object} [options={}]
   */
  async request(endpointPath, params = {}, options = {}) {
    const {
      method = 'POST',
      bodyMode = 'form', // 'form' (padrão assinado) | 'json' | 'none'
      token = this.token,
      deviceId = this.deviceId,
      language = CONFIG.protocol.defaultLanguage,
      adult = CONFIG.protocol.defaultAdult,
      skipAutoInit = false,
    } = options;

    if (!skipAutoInit && !this.token && endpointPath !== '/comm/init') {
      await this.ensureInitialized();
    }

    const effectiveToken = options.token !== undefined ? options.token : this.token;
    const effectiveDevice = deviceId || this.deviceId;
    const cleanPath = '/' + String(endpointPath || '').replace(/^\/+/, '');

    // Monta ordem de tentativa começando pelo domínio ativo
    const candidateDomains = [
      this.activeDomain,
      ...this.domains.filter((d) => d !== this.activeDomain),
    ];

    let lastError = null;

    for (let attempt = 0; attempt < Math.min(candidateDomains.length, CONFIG.maxRetries); attempt++) {
      const domain = candidateDomains[attempt].replace(/\/$/, '');
      const curTime = String(Math.floor(Date.now() / 1000));
      const headers = buildSignedHeaders({
        curTime,
        deviceId: effectiveDevice,
        token: effectiveToken,
        language,
        adult,
      });
      headers['User-Agent'] = 'okhttp/4.12.0';

      let body;
      let url = `${domain}${cleanPath}`;

      if (method.toUpperCase() === 'GET') {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params || {})) {
          if (v !== undefined && v !== null) qs.set(k, String(v));
        }
        const qStr = qs.toString();
        if (qStr) url += `?${qStr}`;
      } else if (bodyMode === 'json') {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        body = JSON.stringify(params || {});
      } else if (bodyMode !== 'none') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
        body = buildSignedForm(params, curTime).toString();
      }

      try {
        const res = await fetch(url, {
          method: method.toUpperCase(),
          headers,
          body,
          signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
        });

        const rawText = await res.text();
        if (!res.ok && res.status >= 500) {
          throw new Error(`Upstream HTTP ${res.status} em ${domain}`);
        }

        const decoded = decryptPayload(rawText);
        if (domain !== this.activeDomain) {
          this.activeDomain = domain;
          this._savePersistedSession();
        }
        return decoded;
      } catch (err) {
        lastError = err;
      }
    }

    // Último recurso: tenta descobrir novo domínio no beacon
    const beaconDomain = await this._fetchBeaconDomain();
    if (beaconDomain) {
      const curTime = String(Math.floor(Date.now() / 1000));
      const headers = buildSignedHeaders({
        curTime,
        deviceId: effectiveDevice,
        token: effectiveToken,
        language,
        adult,
      });
      headers['User-Agent'] = 'okhttp/4.12.0';
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
      const res = await fetch(`${beaconDomain}${cleanPath}`, {
        method: method.toUpperCase(),
        headers,
        body:
          method.toUpperCase() === 'GET' ? undefined : buildSignedForm(params, curTime).toString(),
        signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
      });
      return decryptPayload(await res.text());
    }

    throw lastError || new Error('Falha ao conectar aos servidores STCine.');
  }

  /**
   * Verifica o envelope padrão `{ code: 10000, message, result }`.
   */
  _unwrap(envelope, endpointName) {
    if (!envelope || typeof envelope !== 'object') {
      throw new Error(`Resposta vazia de ${endpointName}.`);
    }
    if (Number(envelope.code) !== CONFIG.protocol.successCode) {
      const err = new Error(envelope.message || `Erro código ${envelope.code} em ${endpointName}`);
      err.apiCode = envelope.code;
      err.envelope = envelope;
      throw err;
    }
    return envelope.result;
  }

  /**
   * Garante que a sessão Web padrão foi inicializada via `/comm/init`.
   */
  async ensureInitialized(force = false) {
    if (!force && this.token && this.initializedAt) {
      return {
        user_info: this.userInfo,
        active_domain: this.activeDomain,
        domains: this.domains,
      };
    }
    if (this.initPromise && !force) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const env = await this.request(
          '/comm/init',
          { is_install: '0' },
          { skipAutoInit: true, token: this.token || '' }
        );
        const result = this._unwrap(env, '/comm/init');
        if (result?.user_info) {
          this.userInfo = result.user_info;
          if (result.user_info.token) {
            this.token = result.user_info.token;
          }
        }
        if (result?.sys_conf) {
          this.sysConf = result.sys_conf;
          this._applyDomainConfig(result.sys_conf);
        }
        if (result?.v_config) {
          this.vConfig = result.v_config;
        }
        this.initializedAt = new Date().toISOString();
        this._savePersistedSession();
        return result;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Inicializa uma sessão Web isolada para um navegador específico (quando envia X-STCine-Device-Id).
   */
  async initSession(ctx = {}) {
    if (ctx.customDeviceId && ctx.customDeviceId !== this.deviceId) {
      const env = await this.request(
        '/comm/init',
        { is_install: '0' },
        {
          skipAutoInit: true,
          deviceId: ctx.customDeviceId,
          token: ctx.customToken || '',
          language: ctx.language,
          adult: ctx.adult,
        }
      );
      const res = this._unwrap(env, '/comm/init');
      return this._formatInitResponse(res, ctx.customDeviceId);
    }

    const res = await this.ensureInitialized(Boolean(ctx.force));
    return this._formatInitResponse(
      {
        user_info: res.user_info || this.userInfo,
        sys_conf: res.sys_conf || this.sysConf,
        v_config: res.v_config || this.vConfig,
      },
      this.deviceId
    );
  }

  _formatInitResponse(raw, deviceId) {
    const sys = raw?.sys_conf || {};
    const vConf = raw?.v_config || {};
    return {
      mode: 'web-direct-no-p2p',
      p2p_enabled: false,
      ads_enabled: false,
      device_id: deviceId,
      active_domain: this.activeDomain,
      available_domains: this.domains,
      direct_video_cdn: CONFIG.directVideoCdn,
      user: raw?.user_info || null,
      token: raw?.user_info?.token || this.token,
      statistics_thresholds: vConf.statistics || {
        play_time_s_num: '300',
        play_time_e_rate: '75',
        stop_play_time_rate: '10',
      },
      config: {
        video_domain: sys.video_domain || CONFIG.uploadMediaCdn,
        is_app_free: sys.is_app_free ?? 1,
        vod_duration_free: sys.vod_duration_free ?? 36000,
        show_barrage: vConf?.movie_detail?.show_barrage === '1',
        faq_url: vConf?.third_report?.faq_url || '',
        privacy_url: sys.privacy_url || '',
      },
    };
  }

  _reqOpts(ctx = {}) {
    const opts = {};
    if (ctx.customToken) opts.token = ctx.customToken;
    if (ctx.customDeviceId) opts.deviceId = ctx.customDeviceId;
    if (ctx.language) opts.language = ctx.language;
    if (ctx.adult !== undefined) opts.adult = ctx.adult;
    return opts;
  }

  // ==================== CATÁLOGO ====================

  async getHomeTabs(ctx = {}) {
    const lang = ctx.language || CONFIG.protocol.defaultLanguage;
    const cacheKey = `tabs:${lang}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request('/HomeTopType', { cgl: '1' }, this._reqOpts(ctx));
    const tabs = this._unwrap(env, '/HomeTopType') || [];
    this.cache.set(cacheKey, tabs, CONFIG.cacheTtl.tabs);
    return tabs;
  }

  async getHome({ categoryId = 4, page = 1, pageSize = 12, isRecommend, ctx = {}, apiBasePrefix = '' } = {}) {
    const lang = ctx.language || CONFIG.protocol.defaultLanguage;
    const rec = isRecommend !== undefined ? Number(isRecommend) : Number(categoryId) === 4 ? 1 : 0;
    const cacheKey = `home:${lang}:${categoryId}:${page}:${pageSize}:${rec}:${apiBasePrefix}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request(
      '/Home',
      {
        category_id: categoryId,
        pn: page,
        psize: pageSize,
        is_recommend: rec,
        cgi: '1',
      },
      this._reqOpts(ctx)
    );
    const rawModules = this._unwrap(env, '/Home') || [];
    const prefix = apiBasePrefix ? apiBasePrefix.replace(/\/$/, '') : '';

    const banners = [];
    const sections = [];

    for (const mod of rawModules) {
      const blocks = Array.isArray(mod.block_list) ? mod.block_list : [];

      // type === 1: Carrossel Hero de banners widescreen (4K)
      if (Number(mod.type) === 1) {
        for (const b of blocks) {
          const bannerPic = b.banner_pic || b.vod_info?.vod_pic || '';
          const vodInfo = b.vod_info ? normalizeVodItem(b.vod_info, apiBasePrefix) : null;
          const vodId = vodInfo?.id || b.data_id;
          if (!vodId && !bannerPic) continue;
          banners.push({
            id: vodId,
            jump_type: b.jump_type,
            topic_id: b.topic_id || 0,
            banner_url: bannerPic,
            banner_proxy: bannerPic
              ? `${prefix}/api/stream/image?url=${encodeURIComponent(bannerPic)}`
              : '',
            vod: vodInfo,
          });
        }
        continue;
      }

      // Demais módulos: trilhos / grades de filmes e séries
      const items = [];
      for (const b of blocks) {
        if (Array.isArray(b.vod_list)) {
          for (const v of b.vod_list) {
            // Limita módulos gigantes (type=5 com 200+ itens) a 30 no payload inicial para leveza
            if (items.length >= 30 && Number(mod.type) === 5) break;
            items.push(normalizeVodItem(v, apiBasePrefix));
          }
        } else if (b.vod_info?.id) {
          items.push(normalizeVodItem(b.vod_info, apiBasePrefix));
        }
      }

      if (items.length > 0) {
        sections.push({
          module_id: mod.module_id,
          title: mod.module_name || blocks[0]?.block_name || 'Destaques',
          type: mod.type,
          type_id: mod.type_id,
          has_more: Number(mod.is_more) === 1,
          can_refresh: Number(mod.is_change) === 1,
          items,
        });
      }
    }

    // Se a aba "Início" (categoryId=4) não trouxer banners widescreen próprios na pág. 1,
    // combina automaticamente os banners 4K de Filmes (cat=2) e Séries (cat=6)
    if (banners.length === 0 && Number(categoryId) === 4 && Number(page) === 1) {
      try {
        const [moviesEnv, seriesEnv] = await Promise.all([
          this.request(
            '/Home',
            { category_id: 2, pn: 1, psize: 6, is_recommend: 0, cgi: '1' },
            this._reqOpts(ctx)
          ),
          this.request(
            '/Home',
            { category_id: 6, pn: 1, psize: 6, is_recommend: 0, cgi: '1' },
            this._reqOpts(ctx)
          ),
        ]);
        const seenIds = new Set();
        for (const src of [moviesEnv?.result, seriesEnv?.result]) {
          const bannerMod = Array.isArray(src) ? src.find((m) => Number(m.type) === 1) : null;
          for (const b of bannerMod?.block_list || []) {
            const vid = b.vod_info?.id || b.data_id;
            if (!vid || seenIds.has(vid) || !b.banner_pic) continue;
            seenIds.add(vid);
            banners.push({
              id: vid,
              jump_type: b.jump_type,
              topic_id: b.topic_id || 0,
              banner_url: b.banner_pic,
              banner_proxy: `${prefix}/api/stream/image?url=${encodeURIComponent(b.banner_pic)}`,
              vod: b.vod_info ? normalizeVodItem(b.vod_info, apiBasePrefix) : null,
            });
          }
        }
      } catch {
        // segue sem banners extras se falhar
      }
    }

    const output = {
      category_id: Number(categoryId),
      page: Number(page),
      banners,
      sections,
    };

    this.cache.set(cacheKey, output, CONFIG.cacheTtl.home);
    return output;
  }

  async getModuleMore({ moduleId, page = 1, ctx = {}, apiBasePrefix = '' }) {
    const cacheKey = `modmore:${moduleId}:${page}:${apiBasePrefix}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request(
      '/HomeModuleMore',
      { module_id: moduleId, pn: page },
      this._reqOpts(ctx)
    );
    const res = this._unwrap(env, '/HomeModuleMore') || {};
    const list = Array.isArray(res.vod_list)
      ? res.vod_list.map((v) => normalizeVodItem(v, apiBasePrefix))
      : [];
    const output = {
      module_id: res.id || Number(moduleId),
      title: res.name || '',
      description: res.content || '',
      page: Number(page),
      has_more: list.length >= 9,
      items: list,
    };
    this.cache.set(cacheKey, output, CONFIG.cacheTtl.browse);
    return output;
  }

  async refreshModule({ moduleId, size = 9, excludeIds = '', ctx = {}, apiBasePrefix = '' }) {
    const env = await this.request(
      '/HomeModuleChange',
      {
        module_id: moduleId,
        psize: size,
        not_vod_ids: excludeIds,
      },
      this._reqOpts(ctx)
    );
    const list = this._unwrap(env, '/HomeModuleChange') || [];
    return Array.isArray(list) ? list.map((v) => normalizeVodItem(v, apiBasePrefix)) : [];
  }

  async getFilters(ctx = {}) {
    const lang = ctx.language || CONFIG.protocol.defaultLanguage;
    const cacheKey = `filters:${lang}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request('/FindMovieOption', {}, this._reqOpts(ctx));
    const raw = this._unwrap(env, '/FindMovieOption') || [];

    // Padroniza nomes para exibição clara (id=1 Filmes, id=2 Séries/Novelas)
    const normalized = raw.map((cat) => {
      const filters = {};
      for (const group of cat.msg || []) {
        filters[group.name] = Array.isArray(group.data) ? group.data : [];
      }
      return {
        type_id: cat.id,
        name: Number(cat.id) === 2 && cat.name === 'Novelas' ? 'Séries & Novelas' : cat.name,
        original_name: cat.name,
        genres: filters.type || [],
        areas: filters.area || [],
        years: filters.year || [],
        sorts: filters.sort || ['Popularidade', 'Mais recentes', 'Top hoje'],
      };
    });

    this.cache.set(cacheKey, normalized, CONFIG.cacheTtl.filters);
    return normalized;
  }

  async browseCatalog({
    typeId = 1,
    genre = '',
    area = '',
    year = '',
    sort = 'Popularidade',
    page = 1,
    ctx = {},
    apiBasePrefix = '',
  }) {
    const cleanVal = (v) => (!v || v === 'Tudo' || v === 'Todos' ? '' : String(v));
    const params = {
      type_id: typeId,
      type: cleanVal(genre),
      area: cleanVal(area),
      year: cleanVal(year),
      sort: cleanVal(sort),
      pn: page,
    };
    const cacheKey = `browse:${JSON.stringify(params)}:${apiBasePrefix}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request('/v2.FindMovie', params, this._reqOpts(ctx));
    const list = this._unwrap(env, '/v2.FindMovie') || [];
    const items = Array.isArray(list) ? list.map((v) => normalizeVodItem(v, apiBasePrefix)) : [];
    const output = {
      page: Number(page),
      type_id: Number(typeId),
      has_more: items.length >= 15,
      items,
    };
    this.cache.set(cacheKey, output, CONFIG.cacheTtl.browse);
    return output;
  }

  async getRecommended({ page = 1, ctx = {}, apiBasePrefix = '' }) {
    const cacheKey = `rec:${page}:${apiBasePrefix}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request('/v2.Recommended', { pn: page }, this._reqOpts(ctx));
    const list = this._unwrap(env, '/v2.Recommended') || [];
    const items = Array.isArray(list) ? list.map((v) => normalizeVodItem(v, apiBasePrefix)) : [];
    this.cache.set(cacheKey, items, CONFIG.cacheTtl.browse);
    return items;
  }

  // ==================== BUSCA & RANKINGS ====================

  async getHotSearch({ ctx = {}, apiBasePrefix = '' } = {}) {
    const cacheKey = `hot:${apiBasePrefix}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request('/HotSearch', {}, this._reqOpts(ctx));
    const list = this._unwrap(env, '/HotSearch') || [];
    const items = Array.isArray(list) ? list.map((v) => normalizeVodItem(v, apiBasePrefix)) : [];
    this.cache.set(cacheKey, items, CONFIG.cacheTtl.hotSearch);
    return items;
  }

  async searchSuggest({ query, ctx = {} }) {
    const kw = String(query || '').trim();
    if (!kw) return [];
    const cacheKey = `sug:${kw.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request('/SearchSuggest', { kw }, this._reqOpts(ctx));
    const list = this._unwrap(env, '/SearchSuggest') || [];
    this.cache.set(cacheKey, list, CONFIG.cacheTtl.suggest);
    return list;
  }

  async search({ query, typeId = 0, page = 1, sort = 0, ctx = {}, apiBasePrefix = '' }) {
    const kw = String(query || '').trim();
    if (!kw) return { query: '', page: 1, has_more: false, items: [] };

    const cacheKey = `search:${kw.toLowerCase()}:${typeId}:${page}:${sort}:${apiBasePrefix}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request(
      '/Search',
      { kw, type_id: typeId, pn: page, sr: sort },
      this._reqOpts(ctx)
    );
    const list = this._unwrap(env, '/Search') || [];
    const items = Array.isArray(list) ? list.map((v) => normalizeVodItem(v, apiBasePrefix)) : [];
    const output = {
      query: kw,
      page: Number(page),
      has_more: items.length >= 10,
      items,
    };
    this.cache.set(cacheKey, output, CONFIG.cacheTtl.search);
    return output;
  }

  async getRankingTypes({ typeId = 0, ctx = {} } = {}) {
    const cacheKey = `ranktypes:${typeId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request('/RankType', { type_id: typeId }, this._reqOpts(ctx));
    const data = this._unwrap(env, '/RankType') || { pid_list: [], topic_list: [] };
    this.cache.set(cacheKey, data, CONFIG.cacheTtl.rankings);
    return data;
  }

  async getRankings({ topicId = 1, pid = 0, page = 1, ctx = {}, apiBasePrefix = '' }) {
    const cacheKey = `ranklist:${topicId}:${pid}:${page}:${apiBasePrefix}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request(
      '/RankList',
      { topic_id: topicId, pid, pn: page },
      this._reqOpts(ctx)
    );
    const res = this._unwrap(env, '/RankList') || {};
    const items = Array.isArray(res.vod_list)
      ? res.vod_list.map((v) => normalizeVodItem(v, apiBasePrefix))
      : [];
    const output = {
      topic_id: Number(topicId),
      pid: Number(pid),
      title: res.name || '',
      page: Number(page),
      has_more: items.length >= 10,
      items,
    };
    this.cache.set(cacheKey, output, CONFIG.cacheTtl.rankings);
    return output;
  }

  // ==================== DETALHE & REPRODUÇÃO WEB (SEM P2P) ====================

  async getVodDetail({
    vodId,
    audioType = 0,
    curTime = 0,
    searchUuid = '',
    ctx = {},
    apiBasePrefix = '',
  }) {
    const idNum = Number(vodId);
    if (!idNum) throw new Error('Parâmetro vod_id inválido.');

    const cacheKey = `detail:${idNum}:${audioType}:${apiBasePrefix}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const params = {
      vod_id: idNum,
      cur_time: String(curTime || 0),
      audio_type: Number(audioType || 0),
    };
    if (searchUuid) params.search_uuid = searchUuid;

    const env = await this.request('/Detail', params, this._reqOpts(ctx));
    const detail = this._unwrap(env, '/Detail');
    if (!detail) throw new Error('Título não encontrado.');

    const normalized = normalizeVodItem(detail, apiBasePrefix);

    // Identifica qual faixa de áudio foi efetivamente retornada (o backend retorna audio_type=0 por padrão;
    // caminhos contendo "/o_<id>/" indicam áudio original/Legendado = type 1, caso contrário Dublado = type 2)
    const firstEp = normalized.vod_collection?.[0];
    let resolvedAudioType = Number(audioType);
    if (resolvedAudioType === 0 && Array.isArray(normalized.audio_type_option)) {
      if (normalized.audio_type_option.length === 1) {
        resolvedAudioType = Number(normalized.audio_type_option[0].type);
      } else if (firstEp?.vod_path || firstEp?.down_url) {
        const samplePath = firstEp.down_url || firstEp.vod_path || '';
        resolvedAudioType = /\/o_\d+\/?$/.test(samplePath) ? 1 : 2;
      }
    }
    normalized.active_audio_type = resolvedAudioType;

    // Organiza lista de temporadas (serial_list) removendo duplicatas e ordenando
    if (Array.isArray(normalized.serial_list) && normalized.serial_list.length > 0) {
      const seenMovies = new Set();
      normalized.seasons = normalized.serial_list
        .filter((s) => {
          if (!s?.movie_id || seenMovies.has(s.movie_id)) return false;
          seenMovies.add(s.movie_id);
          return true;
        })
        .sort((a, b) => Number(a.serial) - Number(b.serial))
        .map((s) => ({
          season: s.serial,
          vod_id: s.movie_id,
          is_current: Number(s.movie_id) === idNum,
        }));
    } else {
      normalized.seasons = [];
    }

    this.cache.set(cacheKey, normalized, CONFIG.cacheTtl.detail);
    return normalized;
  }

  async getSimilar({ vodId, genre = '', area = '', size = 12, ctx = {}, apiBasePrefix = '' }) {
    const cacheKey = `sim:${vodId}:${size}:${apiBasePrefix}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request(
      '/v2.SimilarMovie',
      {
        movie_id: vodId,
        type: genre,
        psize: size,
        area,
        is_random: 1,
      },
      this._reqOpts(ctx)
    );
    const list = this._unwrap(env, '/v2.SimilarMovie') || [];
    const items = Array.isArray(list) ? list.map((v) => normalizeVodItem(v, apiBasePrefix)) : [];
    this.cache.set(cacheKey, items, CONFIG.cacheTtl.similar);
    return items;
  }

  /**
   * Substitui o `/async-get-local-url` do `libbmhls.so` chamando `POST /GetUrl`
   * para obter uma URL HTTPS pré-assinada do R2/S3 (sem P2P e sem componente nativo).
   */
  async resolveSignedUrl(rawUrl, ctx = {}) {
    const clean = unwrapP2pUrl(rawUrl);
    if (!clean) throw new Error('URL vazia para resolução.');

    const cacheKey = `signed:${clean}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const env = await this.request('/GetUrl', { url: clean }, this._reqOpts(ctx));
    const signedUrl = this._unwrap(env, '/GetUrl');
    if (typeof signedUrl === 'string' && signedUrl.startsWith('http')) {
      this.cache.set(cacheKey, signedUrl, CONFIG.cacheTtl.signedUrl);
      return signedUrl;
    }
    return toDirectCdnUrl(clean);
  }

  // ==================== BARRAGE / COMENTÁRIOS SINCRONIZADOS ====================

  async getBarrage({ vodId, collection = 1, collectionId = 0, startTime = 0, endTime = 7200, ctx = {} }) {
    const env = await this.request(
      '/BarrageList',
      {
        vod_id: vodId,
        collection,
        collection_id: collectionId,
        start_time: startTime,
        end_time: endTime,
      },
      this._reqOpts(ctx)
    );
    return this._unwrap(env, '/BarrageList') || [];
  }

  async sendBarrage({ vodId, collection = 1, collectionId = 0, content, playSecond = 0, ctx = {} }) {
    const text = String(content || '').trim();
    if (!text) throw new Error('Conteúdo do comentário não pode ser vazio.');
    const env = await this.request(
      '/SendBarrage',
      {
        movie_id: vodId,
        collection,
        collection_id: collectionId,
        content: text.slice(0, 140),
        play_second: Math.max(0, Math.floor(Number(playSecond) || 0)),
      },
      this._reqOpts(ctx)
    );
    return this._unwrap(env, '/SendBarrage');
  }

  // ==================== CONTA, FAVORITOS & HISTÓRICO ====================

  async login({ account, password, ctx = {} }) {
    if (!account || !password) throw new Error('Informe conta e senha.');
    const env = await this.request(
      '/api/public/login',
      { account: String(account).trim(), password: String(password) },
      this._reqOpts(ctx)
    );
    const user = this._unwrap(env, '/api/public/login');
    // Se não for sessão customizada por header, atualiza token local
    if (!ctx.customToken && !ctx.customDeviceId && user?.token) {
      this.token = user.token;
      this.userInfo = user;
      this._savePersistedSession();
    }
    return user;
  }

  async register({ account, password, ctx = {} }) {
    if (!account || !password) throw new Error('Informe conta e senha.');
    const env = await this.request(
      '/api/public/register',
      { account: String(account).trim(), password: String(password) },
      this._reqOpts(ctx)
    );
    const user = this._unwrap(env, '/api/public/register');
    if (!ctx.customToken && !ctx.customDeviceId && user?.token) {
      this.token = user.token;
      this.userInfo = user;
      this._savePersistedSession();
    }
    return user;
  }

  async getUserInfo(ctx = {}) {
    const env = await this.request('/user/get_user_info', {}, this._reqOpts(ctx));
    return this._unwrap(env, '/user/get_user_info');
  }

  async updateUserInfo({ nickname, sex, intro, ctx = {} }) {
    const params = {};
    if (nickname !== undefined) params.nickname = nickname;
    if (sex !== undefined) params.sex = sex;
    if (intro !== undefined) params.intro = intro;
    const env = await this.request('/api/user/update', params, this._reqOpts(ctx));
    return this._unwrap(env, '/api/user/update');
  }

  async getFavorites({ ctx = {}, apiBasePrefix = '' } = {}) {
    const env = await this.request('/CollectList', {}, this._reqOpts(ctx));
    const list = this._unwrap(env, '/CollectList') || [];
    return Array.isArray(list) ? list.map((v) => normalizeVodItem(v, apiBasePrefix)) : [];
  }

  async setFavorite({ movieId, favorite = true, typePid = 1, typeId = 1, ctx = {} }) {
    if (!movieId) throw new Error('movie_id é obrigatório.');
    const env = await this.request(
      '/CollectMovie',
      {
        movie_id: movieId,
        type: favorite ? 1 : 0,
        type_pid: typePid,
        type_id: typeId,
      },
      this._reqOpts(ctx)
    );
    return {
      movie_id: Number(movieId),
      favorite: Boolean(favorite),
      result: this._unwrap(env, '/CollectMovie'),
    };
  }

  async getWatchHistory({ ctx = {}, apiBasePrefix = '' } = {}) {
    const env = await this.request('/watchHistory', {}, this._reqOpts(ctx));
    const list = this._unwrap(env, '/watchHistory') || [];
    return Array.isArray(list) ? list.map((v) => normalizeVodItem(v, apiBasePrefix)) : [];
  }

  async reportProgress({
    vodId,
    collectionId = 0,
    currentTime = 0,
    totalTime = 0,
    viewTime = 0,
    type = '2',
    ctx = {},
  }) {
    if (!vodId) throw new Error('vod_id é obrigatório.');
    const cur = Math.max(0, Math.floor(Number(currentTime) || 0));
    const tot = Math.max(0, Math.floor(Number(totalTime) || 0));
    const view = Math.max(0, Math.floor(Number(viewTime) || cur));

    const results = {};
    try {
      const hEnv = await this.request(
        '/api/user_history/add',
        {
          vod_id: vodId,
          collection_id: collectionId,
          vod_time: cur,
          total_time: tot,
          view_time: view,
        },
        this._reqOpts(ctx)
      );
      results.history = hEnv;
    } catch (e) {
      results.history_error = e.message;
    }

    try {
      const sEnv = await this.request(
        '/StatisticsUserPlay',
        {
          type: String(type),
          movie_id: vodId,
          collection_id: collectionId,
          view_time: view,
          total_time: tot,
          vod_time: cur,
        },
        this._reqOpts(ctx)
      );
      results.statistics = sEnv;
    } catch (e) {
      results.statistics_error = e.message;
    }

    return results;
  }
}

module.exports = {
  STCineWebClient,
  normalizeVodItem,
};
