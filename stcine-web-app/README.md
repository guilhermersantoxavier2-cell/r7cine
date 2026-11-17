# R7 STREAMING — Plataforma Web (v1.1)

Plataforma Web completa construída com **React 19 + Vite + Tailwind CSS + hls.js**, com identidade visual **R7 STREAMING** (`public/serve.png`), reprodução HLS direta sem P2P e **Download de Episódios e Filmes**.

## Novidades da v1.1
- **Marca R7 STREAMING + `serve.png`:** ícone da aba (favicon), logo na barra superior, rodapé, modal de conta e imagem de pré-visualização (`og:image`).
- **Download de EP e Filmes (Turbo 6x):**
  - Botão **Baixar EP / Baixar Filme** abaixo do player e dentro da barra de controles do vídeo.
  - Ícone de **Download individual em cada episódio** na grade de temporadas/episódios.
  - Barra de progresso em tempo real com porcentagem, tamanho baixado (MB/GB), velocidade (MB/s) e botão de cancelar.
  - Suporte automático a **MP4** (nativo em fMP4/MP4 ou automático em qualquer vídeo se o `ffmpeg` estiver instalado no PC, ex.: `winget install Gyan.FFmpeg`) e **TS HD** direto (sem precisar instalar nada extra).

## Como Executar

1. **Terminal 1 — API (`r7-streaming-api` / `stcine-web-api`):**
```bash
npm start
```

2. **Terminal 2 — Site (`r7-streaming-web` / `stcine-web-app`):**
```bash
npm install
npm run dev
```

Acesse `http://localhost:5173`.
