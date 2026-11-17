'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Carrega .env local se existir (sem dependências externas)
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}

const CONFIG = {
  // Servidor HTTP Web
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3001),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  staticDir: process.env.STATIC_DIR || '',

  // Domínios upstream + rotação automática (substitui RetrofitUrlManager + Lub/p0)
  defaultDomains: [
    process.env.STCINE_BASE_URL || 'https://api.good-videos.click',
    'https://api.good-videos.link',
  ],
  fallbackBeaconUrl: 'https://metric.ytabcawecctae.com/aendig.jpg',
  directVideoCdn: process.env.STCINE_DIRECT_CDN || 'https://res.good-videos.net',
  uploadMediaCdn: 'https://uploaded.good-videos.org',

  // Constantes criptográficas do protocolo STCine (V3.0.16 / 30016)
  signKey:
    process.env.STCINE_SIGN_KEY ||
    '8_)*jhe#rf$WNtb_IBAbfj&avwaw%78yg23b4gB&HIUVA2h(3fsdf^G!ui3ubIB#*',
  aesKey: process.env.STCINE_AES_KEY || '8_)*jhe#rf$WNtb_IBAbfJ&avwaw%7#*',
  aesIv: process.env.STCINE_AES_IV || '(3fsdf^G!8_)*jh#',

  // Perfil virtual Web (substitui android.os.Build, ANDROID_ID, GAID, VPN tun0 e libbmhls.so)
  protocol: {
    appId: '3',
    packageName: 'com.testhabseiap.testiap',
    version: '30016',
    sysPlatform: '2',
    channelCode: '7',
    mobMfr: 'web',
    mobModel: 'STCine-Web-Browser',
    sysRelease: '14',
    defaultLanguage: process.env.STCINE_LANGUAGE || 'pt',
    defaultDisplay: 'GMT-03:00',
    defaultAdult: process.env.STCINE_ADULT || '0',
    successCode: 10000,
    certSha1: 'B6B8010B9184A0D5011AC4E2E3BD4178EF583466',
  },

  // Rede e Cache
  requestTimeoutMs: Number(process.env.STCINE_TIMEOUT_MS || 15000),
  streamTimeoutMs: Number(process.env.STCINE_STREAM_TIMEOUT_MS || 25000),
  maxRetries: 4,
  sessionFile: path.resolve(__dirname, '..', 'data', 'web_session.json'),
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',

  // TTLs de cache (segundos)
  cacheTtl: {
    tabs: 300,
    home: 120,
    filters: 600,
    browse: 90,
    rankings: 180,
    hotSearch: 180,
    suggest: 60,
    search: 60,
    detail: 90,
    similar: 180,
    signedUrl: 2400, // URLs assinadas duram 3600s; renova com folga em 40 min
  },
};

module.exports = CONFIG;
