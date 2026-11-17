/**
 * STCine Web SDK v1.0.0 — Cliente JavaScript Universal para Navegadores e Node.js
 * Funciona 100% em Web sem P2P (libbmhls.so) e sem componentes de celular.
 *
 * Uso no navegador (script tag):
 *   <script src="http://localhost:3001/api/sdk.js"></script>
 *   const stcine = new window.STCineWebSDK({ baseUrl: 'http://localhost:3001' });
 *   const home = await stcine.getHome(4);
 *
 * Uso em React / Vite / Next.js:
 *   const stcine = new STCineWebSDK({ baseUrl: '' }); // relativo via proxy /api
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.STCineWebSDK = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  class STCineWebSDK {
    /**
     * @param {object} [options]
     * @param {string} [options.baseUrl=''] URL base da STCine Web API (vazio = mesma origem)
     * @param {string} [options.language='pt'] Idioma do catálogo
     * @param {string} [options.storageKey='stcine_web_session'] Chave no localStorage
     */
    constructor(options = {}) {
      this.baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
      this.language = options.language || 'pt';
      this.storageKey = options.storageKey || 'stcine_web_session';
      this.token = options.token || '';
      this.deviceId = options.deviceId || '';
      this._restoreBrowserSession();
    }

    _restoreBrowserSession() {
      if (typeof localStorage === 'undefined') return;
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!this.token && parsed.token) this.token = parsed.token;
          if (!this.deviceId && parsed.deviceId) this.deviceId = parsed.deviceId;
        }
        if (!this.deviceId) {
          const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
          let id = '';
          for (let i = 0; i < 22; i++) id += chars[Math.floor(Math.random() * chars.length)];
          this.deviceId = id;
          this._persistBrowserSession();
        }
      } catch {
        // localStorage indisponível
      }
    }

    _persistBrowserSession() {
      if (typeof localStorage === 'undefined') return;
      try {
        localStorage.setItem(
          this.storageKey,
          JSON.stringify({ token: this.token, deviceId: this.deviceId })
        );
      } catch {
        // ignora
      }
    }

    setToken(token) {
      this.token = token || '';
      this._persistBrowserSession();
    }

    async _fetch(path, { method = 'GET', query = {}, body } = {}) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      }
      if (this.baseUrl) qs.set('base_prefix', this.baseUrl);
      const qStr = qs.toString();
      const url = `${this.baseUrl}${path}${qStr ? `?${qStr}` : ''}`;

      const headers = { 'X-STCine-Language': this.language };
      if (this.token) headers['X-STCine-Token'] = this.token;
      if (this.deviceId) headers['X-STCine-Device-Id'] = this.deviceId;
      if (this.baseUrl) headers['X-STCine-Base-Prefix'] = this.baseUrl;
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!json.ok) {
        throw new Error(json.error || json.message || `Erro HTTP ${res.status}`);
      }
      return json.data;
    }

    async init() {
      const data = await this._fetch('/api/init');
      if (data?.token) this.setToken(data.token);
      return data;
    }

    getHealth() {
      return this._fetch('/api/health');
    }

    getTabs() {
      return this._fetch('/api/home/tabs');
    }

    getHome(categoryId = 4, page = 1, size = 12) {
      return this._fetch('/api/home', { query: { category_id: categoryId, page, size } });
    }

    getModuleMore(moduleId, page = 1) {
      return this._fetch(`/api/home/module/${moduleId}/more`, { query: { page } });
    }

    refreshModule(moduleId, excludeIds = [], size = 9) {
      return this._fetch(`/api/home/module/${moduleId}/refresh`, {
        query: { exclude_ids: excludeIds.join(','), size },
      });
    }

    getFilters() {
      return this._fetch('/api/catalog/filters');
    }

    browse({ typeId = 1, genre = '', year = '', area = '', sort = 'Popularidade', page = 1 } = {}) {
      return this._fetch('/api/catalog/browse', {
        query: { type_id: typeId, genre, year, area, sort, page },
      });
    }

    getRecommended(page = 1) {
      return this._fetch('/api/catalog/recommended', { query: { page } });
    }

    getHotSearch() {
      return this._fetch('/api/search/hot');
    }

    suggest(query) {
      return this._fetch('/api/search/suggest', { query: { q: query } });
    }

    search(query, { typeId = 0, page = 1, sort = 0 } = {}) {
      return this._fetch('/api/search', { query: { q: query, type_id: typeId, page, sort } });
    }

    getRankingTypes(typeId = 0) {
      return this._fetch('/api/rankings/types', { query: { type_id: typeId } });
    }

    getRankings(topicId = 1, pid = 0, page = 1) {
      return this._fetch('/api/rankings', { query: { topic_id: topicId, pid, page } });
    }

    getDetail(vodId, audioType = 0) {
      return this._fetch(`/api/vod/${vodId}`, { query: { audio_type: audioType } });
    }

    getSimilar(vodId, genre = '', size = 12) {
      return this._fetch(`/api/vod/${vodId}/similar`, { query: { genre, size } });
    }

    getStream(vodId, { episode = 1, audioType = 0, signed = false } = {}) {
      return this._fetch(`/api/vod/${vodId}/stream`, {
        query: { episode, audio_type: audioType, signed: signed ? '1' : '0' },
      });
    }

    resolveUrl(url) {
      return this._fetch('/api/stream/resolve', { method: 'POST', body: { url } });
    }

    getBarrage(vodId, collection = 1, collectionId = 0) {
      return this._fetch('/api/barrage', {
        query: { vod_id: vodId, collection, collection_id: collectionId },
      });
    }

    sendBarrage(vodId, content, playSecond = 0, collection = 1, collectionId = 0) {
      return this._fetch('/api/barrage', {
        method: 'POST',
        body: {
          vod_id: vodId,
          collection,
          collection_id: collectionId,
          content,
          play_second: playSecond,
        },
      });
    }

    async login(account, password) {
      const user = await this._fetch('/api/auth/login', {
        method: 'POST',
        body: { account, password },
      });
      if (user?.token) this.setToken(user.token);
      return user;
    }

    async register(account, password) {
      const user = await this._fetch('/api/auth/register', {
        method: 'POST',
        body: { account, password },
      });
      if (user?.token) this.setToken(user.token);
      return user;
    }

    getProfile() {
      return this._fetch('/api/user/me');
    }

    getFavorites() {
      return this._fetch('/api/user/favorites');
    }

    toggleFavorite(movieId, favorite = true, typePid = 1) {
      return this._fetch('/api/user/favorites', {
        method: 'POST',
        body: { movie_id: movieId, favorite, type_pid: typePid },
      });
    }

    getHistory() {
      return this._fetch('/api/user/history');
    }

    saveProgress(vodId, collectionId, currentTime, totalTime) {
      return this._fetch('/api/user/history', {
        method: 'POST',
        body: {
          vod_id: vodId,
          collection_id: collectionId,
          current_time: currentTime,
          total_time: totalTime,
        },
      });
    }

    /**
     * Chama qualquer um dos 117 endpoints originais do STCine diretamente via JSON.
     * Ex.: stcine.callRaw('/ShareConfig', {})
     */
    callRaw(originalPath, params = {}) {
      const clean = '/' + String(originalPath).replace(/^\/+/, '');
      return this._fetch(`/api/proxy${clean}`, { method: 'POST', body: params });
    }
  }

  return STCineWebSDK;
});
