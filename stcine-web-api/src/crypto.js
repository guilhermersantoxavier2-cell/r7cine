'use strict';

const crypto = require('node:crypto');
const CONFIG = require('./config');

const AES_KEY_BUF = Buffer.from(CONFIG.aesKey, 'utf8');
const AES_IV_BUF = Buffer.from(CONFIG.aesIv, 'utf8');

/**
 * Gera a assinatura determinística do protocolo STCine (equivalente Web de Lub/f.l):
 *   1. Ordena chaves lexicograficamente (ordem UTF-16 / TreeMap)
 *   2. Concatena "k=v&" para cada par
 *   3. Adiciona "key=<SIGN_KEY>"
 *   4. Retorna SHA-256 hex em MAIÚSCULAS
 *
 * @param {Record<string, string | number>} params
 * @returns {string}
 */
function signParams(params) {
  const sortedKeys = Object.keys(params).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let raw = '';
  for (const key of sortedKeys) {
    raw += `${key}=${params[key]}&`;
  }
  raw += `key=${CONFIG.signKey}`;
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').toUpperCase();
}

/**
 * Descriptografa respostas Base64 AES-256-CBC/PKCS7 do backend STCine.
 * Caso o payload já esteja em JSON puro (ex.: health check `GET /`), faz parse direto.
 *
 * @param {string} rawText
 * @returns {any}
 */
function decryptPayload(rawText) {
  if (!rawText) return null;
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  // Resposta já em JSON plano
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  // Resposta criptografada em Base64 (AES-256-CBC + PKCS7)
  const cipherBuf = Buffer.from(trimmed, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', AES_KEY_BUF, AES_IV_BUF);
  const plainBuf = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
  const jsonStr = plainBuf.toString('utf8');
  return JSON.parse(jsonStr);
}

/**
 * Criptografa um objeto em Base64 AES-256-CBC (utilitário para testes/debug).
 *
 * @param {any} data
 * @returns {string}
 */
function encryptPayload(data) {
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
  const cipher = crypto.createCipheriv('aes-256-cbc', AES_KEY_BUF, AES_IV_BUF);
  const enc = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  return enc.toString('base64');
}

/**
 * Gera um identificador virtual de dispositivo Web de 22 caracteres alfanuméricos
 * (substitui Settings.Secure.ANDROID_ID + SharedPreferences sem depender de Android).
 *
 * @returns {string}
 */
function generateWebDeviceId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(22);
  let id = '';
  for (let i = 0; i < 22; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

/**
 * Remove qualquer encapsulamento legado do proxy P2P local (`libbmhls.so`):
 *   Ex.: http://127.0.0.1:18080/resource.m3u8?src=<Base64> -> https://cdn.../index.m3u8
 *
 * @param {string} url
 * @returns {string}
 */
function unwrapP2pUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (
    trimmed.includes('/resource.mp4') ||
    trimmed.includes('/resource.m3u8') ||
    (trimmed.startsWith('http://127.0.0.1') && trimmed.includes('src='))
  ) {
    try {
      const parsed = new URL(trimmed);
      const src = parsed.searchParams.get('src');
      if (src) {
        // Corrige espaços que podem ter substituído '+' em query strings
        const normalized = src.replace(/ /g, '+');
        const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim();
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          return decoded;
        }
      }
    } catch {
      // ignora URL malformada
    }
  }
  return trimmed;
}

/**
 * Monta o conjunto completo de headers assinados para o backend STCine,
 * usando apenas perfil Web virtual (sem GAID, sem VPN tun0, sem SDKs mobile).
 *
 * @param {object} opts
 * @param {string} opts.curTime
 * @param {string} opts.deviceId
 * @param {string} [opts.token]
 * @param {string} [opts.language]
 * @param {string} [opts.adult]
 * @returns {Record<string, string>}
 */
function buildSignedHeaders({ curTime, deviceId, token = '', language, adult }) {
  const p = CONFIG.protocol;
  const headerMap = {
    'app-id': p.appId,
    'package-name': p.packageName,
    version: p.version,
    'sys-platform': p.sysPlatform,
    'mob-mfr': p.mobMfr,
    mobmodel: p.mobModel,
    sysrelease: p.sysRelease,
    'device-id': deviceId,
    gaid: '',
    'channel-code': p.channelCode,
    'cur-time': curTime,
    token: token || '',
    'is-vvv': '0',
    'is-language': language || p.defaultLanguage,
    'is-display': p.defaultDisplay,
    'app-language': language || p.defaultLanguage,
    'en-al': adult !== undefined ? String(adult) : p.defaultAdult,
  };
  headerMap.sign = signParams(headerMap);
  return headerMap;
}

/**
 * Assina os parâmetros de formulário POST adicionando `cur-time` e `sign`.
 *
 * @param {Record<string, any>} params
 * @param {string} curTime
 * @returns {URLSearchParams}
 */
function buildSignedForm(params, curTime) {
  const map = {};
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        map[k] = String(v);
      }
    }
  }
  map['cur-time'] = curTime;
  map.sign = signParams(map);

  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(map)) {
    form.append(k, v);
  }
  return form;
}

module.exports = {
  signParams,
  decryptPayload,
  encryptPayload,
  generateWebDeviceId,
  unwrapP2pUrl,
  buildSignedHeaders,
  buildSignedForm,
};
