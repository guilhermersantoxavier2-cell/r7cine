/**
 * Cliente frontend da STCine Web API (Modificada — 100% Web, sem P2P e sem SDK mobile).
 * Usa URLs relativas (`/api/...`) por padrão para funcionar em qualquer host/domínio/proxy,
 * ou `VITE_API_BASE_URL` quando hospedado separadamente da API.
 */

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

const SESSION_KEY = 'stcine_web_session_v1';
const HISTORY_KEY = 'stcine_web_history_v1';
const FAVORITES_KEY = 'stcine_web_favorites_v1';

function randomDeviceId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(22);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => alphabet[b % alphabet.length]).join('');
}

export function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.deviceId) return parsed;
    }
  } catch {
    // fallback
  }
  const fresh = { deviceId: randomDeviceId(), token: '', user: null };
  saveStoredSession(fresh);
  return fresh;
}

export function saveStoredSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore storage quota errors
  }
}

export function clearUserAuth() {
  const fresh = { deviceId: randomDeviceId(), token: '', user: null };
  saveStoredSession(fresh);
  return fresh;
}

async function apiRequest(path, { method = 'GET', query = {}, body, signal } = {}) {
  const session = getStoredSession();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') {
      qs.set(k, String(v));
    }
  }
  if (API_BASE) qs.set('base_prefix', API_BASE);
  const qStr = qs.toString();
  const url = `${API_BASE}${path}${qStr ? `?${qStr}` : ''}`;

  const headers = {
    'X-STCine-Language': 'pt',
    'X-STCine-Device-Id': session.deviceId,
  };
  if (session.token) headers['X-STCine-Token'] = session.token;
  if (API_BASE) headers['X-STCine-Base-Prefix'] = API_BASE;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || json?.message || `Erro na API (HTTP ${res.status})`);
  }
  return json.data;
}

export const stcineApi = {
  getDocsUrl: () => `${API_BASE}/api/docs`,
  getHealth: () => apiRequest('/api/health'),

  async initSession() {
    const data = await apiRequest('/api/init');
    const cur = getStoredSession();
    const updated = {
      deviceId: data.device_id || cur.deviceId,
      token: data.token || cur.token,
      user: data.user || cur.user,
      activeDomain: data.active_domain,
    };
    saveStoredSession(updated);
    return data;
  },

  getTabs: () => apiRequest('/api/home/tabs'),

  getHome: (categoryId = 4, page = 1, size = 12) =>
    apiRequest('/api/home', { query: { category_id: categoryId, page, size } }),

  getModuleMore: (moduleId, page = 1) =>
    apiRequest(`/api/home/module/${moduleId}/more`, { query: { page } }),

  refreshModule: (moduleId, excludeIds = [], size = 9) =>
    apiRequest(`/api/home/module/${moduleId}/refresh`, {
      query: { exclude_ids: excludeIds.join(','), size },
    }),

  getFilters: () => apiRequest('/api/catalog/filters'),

  browseCatalog: ({ typeId = 1, genre = '', year = '', sort = 'Popularidade', page = 1 } = {}) =>
    apiRequest('/api/catalog/browse', {
      query: { type_id: typeId, genre, year, sort, page },
    }),

  getRecommended: (page = 1) => apiRequest('/api/catalog/recommended', { query: { page } }),

  getHotSearch: () => apiRequest('/api/search/hot'),

  searchSuggest: (q, signal) => apiRequest('/api/search/suggest', { query: { q }, signal }),

  search: (q, { typeId = 0, page = 1, sort = 0, signal } = {}) =>
    apiRequest('/api/search', { query: { q, type_id: typeId, page, sort }, signal }),

  getRankingTypes: () => apiRequest('/api/rankings/types'),

  getRankings: (topicId = 1, pid = 0, page = 1) =>
    apiRequest('/api/rankings', { query: { topic_id: topicId, pid, page } }),

  getVodDetail: (vodId, audioType = 0) =>
    apiRequest(`/api/vod/${vodId}`, { query: { audio_type: audioType } }),

  getSimilar: (vodId, genre = '', size = 12) =>
    apiRequest(`/api/vod/${vodId}/similar`, { query: { genre, size } }),

  getStream: (vodId, { episode = 1, audioType = 0, signed = false } = {}) =>
    apiRequest(`/api/vod/${vodId}/stream`, {
      query: { episode, audio_type: audioType, signed: signed ? '1' : '0' },
    }),

  getBarrage: (vodId, collection = 1, collectionId = 0) =>
    apiRequest('/api/barrage', {
      query: { vod_id: vodId, collection, collection_id: collectionId },
    }),

  sendBarrage: ({ vodId, collection = 1, collectionId = 0, content, playSecond = 0 }) =>
    apiRequest('/api/barrage', {
      method: 'POST',
      body: {
        vod_id: vodId,
        collection,
        collection_id: collectionId,
        content,
        play_second: Math.floor(playSecond),
      },
    }),

  async login(account, password) {
    const user = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { account, password },
    });
    const cur = getStoredSession();
    saveStoredSession({
      ...cur,
      token: user?.token || cur.token,
      user: user || cur.user,
      isAuthenticated: true,
    });
    return user;
  },

  async register(account, password) {
    const user = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { account, password },
    });
    const cur = getStoredSession();
    saveStoredSession({
      ...cur,
      token: user?.token || cur.token,
      user: user || cur.user,
      isAuthenticated: true,
    });
    return user;
  },

  getProfile: () => apiRequest('/api/user/me'),

  getCloudFavorites: () => apiRequest('/api/user/favorites'),

  setCloudFavorite: (movieId, favorite, typePid = 1) =>
    apiRequest('/api/user/favorites', {
      method: 'POST',
      body: { movie_id: movieId, favorite, type_pid: typePid },
    }),

  syncProgress: ({ vodId, collectionId, currentTime, totalTime }) =>
    apiRequest('/api/user/history', {
      method: 'POST',
      body: {
        vod_id: vodId,
        collection_id: collectionId,
        current_time: Math.floor(currentTime),
        total_time: Math.floor(totalTime),
      },
    }),

  buildDownloadUrl: ({
    episode,
    quality,
    title = 'R7 STREAMING',
    isSeries = false,
    episodeNumber = 1,
    audioLabel = '',
    downloadId = '',
    container = 'auto',
  }) => {
    const q = quality || episode?.web_stream?.qualities?.[0] || episode?.web_stream || {};
    const directUrl = q.direct_url || episode?.web_stream?.direct_url || '';
    let fallbackPath = '';
    const refProxy = q.proxy_url || episode?.web_stream?.proxy_url || '';
    if (refProxy) {
      try {
        const u = new URL(refProxy, window.location.origin);
        fallbackPath = u.searchParams.get('fallback_path') || '';
      } catch {
        // ignore
      }
    }

    const resTag = q.resolution ? `${q.resolution}p` : 'HD';
    const epTag = isSeries
      ? ` - Ep ${String(episode?.title || episode?.collection || episodeNumber).padStart(2, '0')}`
      : '';
    const audTag = audioLabel ? ` (${audioLabel})` : '';
    const baseName = `${title}${epTag}${audTag} [${resTag}]`;

    const params = new URLSearchParams();
    if (directUrl) params.set('url', directUrl);
    if (fallbackPath) params.set('fallback_path', fallbackPath);
    params.set('filename', baseName);
    if (downloadId) params.set('download_id', downloadId);
    if (container && container !== 'auto') params.set('container', container);

    return `${API_BASE}/api/stream/download?${params.toString()}`;
  },

  getDownloadProgress: (downloadId) =>
    apiRequest('/api/stream/download/progress', { query: { id: downloadId } }),

  cancelDownload: (downloadId) =>
    fetch(`${API_BASE}/api/stream/download/cancel?id=${encodeURIComponent(downloadId)}`, {
      method: 'POST',
    }).catch(() => {}),
};

export function triggerBrowserDownload(url) {
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', '');
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => link.remove(), 1000);
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ==================== HISTÓRICO & FAVORITOS PERSISTENTES ====================

export function getLocalHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function getSavedVodProgress(vodId) {
  return getLocalHistory().find((item) => Number(item.id) === Number(vodId)) || null;
}

export function upsertLocalHistory(entry) {
  try {
    const list = getLocalHistory().filter((item) => Number(item.id) !== Number(entry.id));
    const updated = [{ ...entry, updatedAt: Date.now() }, ...list].slice(0, 40);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function removeLocalHistory(vodId) {
  try {
    const updated = getLocalHistory().filter((item) => Number(item.id) !== Number(vodId));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function getLocalFavorites() {
  try {
    const list = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveLocalFavorites(list) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export function resolvePoster(vod) {
  if (!vod) return '';
  return vod.poster_proxy || vod.poster_url || vod.vod_pic || '';
}
