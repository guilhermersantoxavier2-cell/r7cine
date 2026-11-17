# R7 STREAMING — versão preparada para Vercel

## Publicação
1. Extraia este ZIP.
2. Envie o conteúdo da pasta para um repositório privado no GitHub.
3. Na Vercel, importe esse repositório como um novo projeto.
4. Mantenha o Root Directory como `.` (raiz).
5. As configurações de instalação, build, saída e função já estão em `vercel.json`; não precisa preencher comandos manualmente.
6. Publique e teste `https://SEU-DOMINIO/api/health`.

## Variáveis opcionais
Configure em Vercel → Project → Settings → Environment Variables, se desejar personalizar: `STCINE_LANGUAGE=pt`, `STCINE_ADULT=0`, `STCINE_TIMEOUT_MS=15000`, `STCINE_STREAM_TIMEOUT_MS=25000`, `STCINE_BASE_URL`, `STCINE_DIRECT_CDN`.

## Observações importantes
- O frontend chama a API por caminhos relativos `/api`, então frontend e API usam o mesmo domínio.
- A API foi adaptada para execução como Vercel Function; ela não abre `http.createServer().listen()` no ambiente serverless.
- A sessão gravada em arquivo e os caches em memória são efêmeros em funções serverless. Uma instância pode ser reciclada e diferentes instâncias não compartilham estado.
- Downloads longos, acompanhamento de progresso/cancelamento e fluxos de vídeo muito longos podem atingir o limite de duração da função ou não manter o mesmo estado entre invocações. Teste esses recursos no plano da sua conta.
- A função usa Node.js e APIs nativas. O recurso de remux com FFmpeg não deve ser considerado disponível no ambiente Vercel.
- O arquivo de sessão anterior foi removido do ZIP para não distribuir credenciais/sessões.
- Publique somente conteúdos e fontes que você tenha autorização para disponibilizar.
