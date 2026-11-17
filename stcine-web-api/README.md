# STCine Web API (v1.0.0 — Edição Web Sem P2P)

Implementação completa, modificada e 100% funcional para **Web** da API do **STCine** (`V3.0.16 / 30016`), construída em **Node.js puro (zero dependências externas e zero binários nativos)**.

Todos os componentes exclusivos de celular Android — incluindo o motor P2P `libbmhls.so` (`127.0.0.1:<porta>`), `Retrofit/OkHttp`, `ANDROID_ID`, `GAID`, detecção de VPN `tun0`, `SharedPreferences`, verificação de certificado APK (`vi`) e SDKs de anúncios — foram removidos e substituídos por protocolos **HTTP/HTTPS + HLS padrão Web com CORS completo**.

---

## O que foi modificado para funcionar na Web

| Componente Original (Android APK) | Modificação na STCine Web API |
|---|---|
| **`libbmhls.so` (P2P nativo ARM + proxy `127.0.0.1`)** | **Eliminado 100%.** Substituído por `src/streamResolver.js`: converte caminhos para o CDN HTTPS direto (`res.good-videos.net`), faz fallback automático via `POST /GetUrl` (URL pré-assinada R2/S3), desencapsula qualquer URL legada `resource.{mp4,m3u8}?src=<base64>` e reescreve playlists HLS (Master + Media, MPEG-TS `.ts` e fMP4 `.m4s`) com CORS liberado e `HTTP 206 Range`. |
| **Interceptor `Lub/n0$a` + `Lub/f.l` (Assinatura)** | Portado para `src/crypto.js` (`node:crypto`): assina automaticamente tanto o form body quanto os headers com `UPPER(SHA256(k=v&...&key=<CHAVE>))` + `cur-time`. O navegador consome rotas `GET`/`POST` JSON comuns sem precisar assinar nada. |
| **Respostas Criptografadas Base64** | Descriptografia automática **AES-256-CBC (PKCS7)** em `decryptPayload()`, devolvendo JSON UTF-8 limpo e legível para qualquer frontend Web. |
| **`ANDROID_ID`, `Build.*`, `GAID`, `tun0`, `SharedPreferences`** | Substituídos por perfil virtual Web (`device-id` alfanumérico de 22 chars) com suporte multi-usuário por navegador via headers `X-STCine-Device-Id` e `X-STCine-Token` (ou `Authorization: Bearer`). |
| **`RetrofitUrlManager` + `Lub/p0` (Troca de domínio)** | Rotação automática de domínios (`api.good-videos.click`, `api.good-videos.link`, `sys_conf.api_conf[]`) + fallback remoto no beacon em caso de queda. |
| **Bloqueio de CORS em Vídeo, Legendas e Imagens** | Proxies Web integrados (`/api/stream/hls`, `/api/stream/segment`, `/api/stream/subtitle` com conversão SRT → WebVTT, e `/api/stream/image` com cache HTTP) com `Access-Control-Allow-Origin: *` e proteção anti-SSRF. |
| **SDKs de Anúncios Mobile (`is_ad`, AdMob/AppLovin/Pangle)** | Removidos completamente (`is_ad: 0`, `hide_ad: 1`, `ads_enabled: false`). |

---

## Como Executar

**Requisito único:** Node.js **18+** (Windows, Linux, macOS ou Docker). **Não precisa nem de `npm install`!**

```bash
# Iniciar servidor Web API (padrão: http://0.0.0.0:3001)
npm start
# ou diretamente:
node src/server.js

# Rodar suíte de auto-teste real (assinatura + AES + catálogo + stream HLS/Range)
npm test
```

### Com Docker
```bash
docker build -t stcine-web-api .
docker run -p 3001:3001 stcine-web-api
```

### Acessos rápidos após iniciar
- **Documentação & Console ao Vivo:** `http://localhost:3001/api/docs`
- **SDK JavaScript para Navegador:** `http://localhost:3001/api/sdk.js`
- **Health Check:** `http://localhost:3001/api/health`

---

## Rotas Principais da API Web

### Sistema e Sessão
- `GET /api/health` — Status do servidor, domínio upstream ativo, cache e modo sem P2P
- `GET /api/init` — Inicializa sessão Web (`/comm/init`), retorna token JWT e configurações
- `GET /api/endpoints` — Lista completa dos **117 endpoints** mapeados do STCine

### Catálogo e Home
- `GET /api/home/tabs` — Categorias/abas principais (`Início`, `Filmes`, `Série`, `Terror`, `Animes`, `Novelas`, `Microdrama`, `Dramas`, `Infantil`, `Documentário`)
- `GET /api/home?category_id=4&page=1&size=12` — Banners widescreen 4K + trilhos de conteúdo
- `GET /api/home/module/:moduleId/more?page=1` — Paginação completa ("Ver tudo") de um módulo
- `GET /api/home/module/:moduleId/refresh?size=9&exclude_ids=1,2` — Troca dinâmica de títulos de um módulo
- `GET /api/catalog/filters` — Árvore de filtros (gêneros, anos, ordenação)
- `GET /api/catalog/browse?type_id=1&genre=Ação&year=2026&sort=Popularidade&page=1` — Explorar catálogo filtrado
- `GET /api/catalog/recommended?page=1` — Títulos recomendados

### Busca e Rankings
- `GET /api/search?q=Batman&page=1` — Busca textual de filmes e séries
- `GET /api/search/suggest?q=bat` — Autocomplete instantâneo
- `GET /api/search/hot` — Títulos mais buscados no momento
- `GET /api/rankings/types` — Tópicos (`Em alta`, `Lista crescente`, `Novidades`, `Principais buscas`) e segmentos (`Todo`, `Filmes`, `Séries`)
- `GET /api/rankings?topic_id=1&pid=0&page=1` — Ranking paginado

### Detalhes e Reprodução Web (HLS/MP4 Direto — Sem P2P)
- `GET /api/vod/:id?audio_type=0` — Ficha completa do título, opções de áudio (`1 = Legendado`, `2 = Dublado`), temporadas (`seasons`) e episódios (`vod_collection[]`) já enriquecidos com `web_stream.proxy_url` e `web_stream.direct_url`
- `GET /api/vod/:id/stream?episode=1&audio_type=2&signed=1` — Retorna stream pronto para `<video>` / `hls.js` + URL R2/S3 pré-assinada
- `GET /api/vod/:id/similar` — Títulos semelhantes
- `POST /api/stream/resolve` `{ "url": "..." }` — Substituto Web de `/GetUrl` e `/async-get-local-url` (também desencapsula URLs P2P legadas)
- `GET /api/stream/hls?url=...` — Proxy e reescritor de manifestos `.m3u8` (CORS liberado + fallback automático p/ URL assinada)
- `GET /api/stream/segment?url=...` — Streaming de segmentos `.ts` / `.m4s` / `.mp4` com `HTTP 206 Partial Content`
- `GET /api/stream/subtitle?url=...` — Proxy de legendas com conversão automática `.srt` → `.vtt` (WebVTT)
- `GET /api/stream/image?url=...` — Proxy de pôsteres e banners com cache e CORS

### Interação, Conta, Favoritos e Histórico
- `GET /api/barrage?vod_id=1901&collection=1&collection_id=16895` — Comentários sincronizados no tempo
- `POST /api/barrage` `{ "vod_id": 1901, "collection": 1, "collection_id": 16895, "content": "Ótimo filme!", "play_second": 120 }`
- `POST /api/auth/login` `{ "account": "...", "password": "..." }` — Login
- `POST /api/auth/register` `{ "account": "...", "password": "..." }` — Cadastro
- `GET /api/user/me` — Dados do usuário da sessão atual
- `POST /api/user/update` `{ "nickname": "...", "intro": "..." }` — Atualizar perfil
- `GET /api/user/favorites` — Listar favoritos
- `POST /api/user/favorites` `{ "movie_id": 1901, "favorite": true, "type_pid": 1 }` — Adicionar/remover favorito
- `DELETE /api/user/favorites/:movieId` — Remover favorito
- `GET /api/user/history` — Histórico de reprodução da conta
- `POST /api/user/history` `{ "vod_id": 1901, "collection_id": 16895, "current_time": 320, "total_time": 10550 }` — Salvar progresso

### Gateway Universal (Todos os 117 Endpoints Originais)
- `POST /api/proxy/<caminho_original>` — Assina, envia e descriptografa qualquer endpoint do catálogo original.
  Exemplo: `POST /api/proxy/v2.FindMovie` com `{ "type_id": 1, "pn": 1 }`.

---

## Exemplo de Uso no Frontend (com `hls.js`)

```html
<video id="player" controls style="width:100%;max-width:900px"></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script src="http://localhost:3001/api/sdk.js"></script>
<script>
  (async () => {
    const api = new STCineWebSDK({ baseUrl: 'http://localhost:3001' });
    const stream = await api.getStream(1901, { episode: 1, audioType: 2 });
    const video = document.getElementById('player');

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(stream.proxy_url);
      hls.attachMedia(video);
    } else {
      video.src = stream.proxy_url; // Safari / iOS nativo
    }
  })();
</script>
```

---

## Estrutura do Projeto

```
stcine-web-api/
├── package.json                  # Scripts start, dev e test (0 dependências externas)
├── .env.example                  # Variáveis de ambiente opcionais
├── Dockerfile                    # Imagem pronta para deploy em nuvem
├── README.md                     # Documentação completa
└── src/
    ├── server.js                 # Servidor HTTP REST + CORS + Roteador + SPA opcional
    ├── config.js                 # Configurações, domínios e perfil virtual Web
    ├── crypto.js                 # Assinatura SHA-256 + AES-256-CBC + unwrap P2P
    ├── client.js                 # Cliente STCine com rotação de domínio e normalização
    ├── streamResolver.js         # Motor HLS/MP4/WebVTT/Imagem direto para Web (sem P2P)
    ├── cache.js                  # Cache LRU/TTL em memória
    ├── docs.html                 # Documentação interativa em /api/docs
    ├── selftest.js               # Suíte automatizada de testes ponta a ponta
    ├── sdk/
    │   └── stcine-web-sdk.js     # SDK JavaScript universal para navegadores
    └── data/
        └── endpoints_catalog.json # Catálogo estruturado dos 117 endpoints
```
