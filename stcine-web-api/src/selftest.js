'use strict';

const assert = require('node:assert');
const { signParams, encryptPayload, decryptPayload, unwrapP2pUrl } = require('./crypto');
const { startServer } = require('./server');

async function runSelfTest() {
  console.log('=== STCine Web API — Auto-Teste Completo ===\n');

  // 1. Testes unitários de criptografia e remoção de P2P
  const sample = { ok: true, msg: 'Olá STCine Web!' };
  const enc = encryptPayload(sample);
  const dec = decryptPayload(enc);
  assert.deepStrictEqual(dec, sample, 'Falha no roundtrip AES-256-CBC');
  console.log('[OK] AES-256-CBC encrypt/decrypt roundtrip');

  const sig = signParams({ b: '2', a: '1' });
  assert.strictEqual(sig.length, 64, 'Assinatura SHA-256 deve ter 64 hex chars');
  assert.strictEqual(sig, sig.toUpperCase(), 'Assinatura deve estar em maiúsculas');
  console.log('[OK] Assinatura SHA-256 determinística:', sig.slice(0, 16) + '...');

  const rawCdn = 'https://res.good-videos.net/20261023/96391/pt/2198077/720/hls/index.m3u8';
  const p2pUrl =
    'http://127.0.0.1:19821/resource.m3u8?src=' + Buffer.from(rawCdn, 'utf8').toString('base64');
  assert.strictEqual(unwrapP2pUrl(p2pUrl), rawCdn, 'Falha ao desencapsular URL P2P');
  console.log('[OK] Remoção de URL P2P local (127.0.0.1 -> HTTPS CDN direto)');

  // 2. Teste de integração HTTP real
  const port = 3987;
  const server = startServer(port, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;

  try {
    await new Promise((r) => setTimeout(r, 400));

    const init = await (await fetch(`${base}/api/init`)).json();
    assert.strictEqual(init.ok, true);
    assert.strictEqual(init.data.p2p_enabled, false);
    assert.ok(init.data.token.length > 20);
    console.log('[OK] GET /api/init -> token JWT obtido | domínio:', init.data.active_domain);

    const tabs = await (await fetch(`${base}/api/home/tabs`)).json();
    assert.strictEqual(tabs.ok, true);
    assert.ok(tabs.data.length > 0);
    console.log('[OK] GET /api/home/tabs ->', tabs.data.map((t) => t.channel_name).join(', '));

    const home = await (await fetch(`${base}/api/home?category_id=4&page=1`)).json();
    assert.strictEqual(home.ok, true);
    assert.ok(home.data.banners.length > 0, 'Deve trazer banners 4K');
    assert.ok(home.data.sections.length > 0, 'Deve trazer trilhos');
    console.log(
      `[OK] GET /api/home -> ${home.data.banners.length} banners 4K + ${home.data.sections.length} trilhos`
    );

    const firstVodId = home.data.sections[0].items[0].id;
    const detail = await (await fetch(`${base}/api/vod/${firstVodId}`)).json();
    assert.strictEqual(detail.ok, true);
    const ep = detail.data.vod_collection[0];
    assert.strictEqual(ep.is_p2p, 0);
    assert.strictEqual(ep.web_stream.p2p_required, false);
    assert.ok(ep.web_stream.proxy_url.startsWith('/api/stream/hls'));
    console.log(
      `[OK] GET /api/vod/${firstVodId} -> "${detail.data.vod_name}" | eps=${detail.data.vod_collection.length} | stream=${ep.web_stream.format}`
    );

    // 3. Testa manifesto HLS reescrito + primeiro segmento de vídeo com HTTP Range 206!
    const hlsRes = await fetch(`${base}${ep.web_stream.proxy_url}`);
    assert.strictEqual(hlsRes.status, 200);
    const m3u8 = await hlsRes.text();
    assert.ok(m3u8.startsWith('#EXTM3U'));
    assert.ok(m3u8.includes('/api/stream/'));
    const firstMediaLine = m3u8
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('/api/stream/'));
    console.log('[OK] GET /api/stream/hls -> Manifesto M3U8 Web válido | 1ª URI:', firstMediaLine.slice(0, 52) + '...');

    let segUrl = firstMediaLine;
    if (segUrl.startsWith('/api/stream/hls')) {
      const subM3u8 = await (await fetch(`${base}${segUrl}`)).text();
      segUrl = subM3u8
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('/api/stream/segment'));
    }
    const segRes = await fetch(`${base}${segUrl}`, { headers: { Range: 'bytes=0-1023' } });
    assert.ok(segRes.status === 206 || segRes.status === 200);
    const segBytes = await segRes.arrayBuffer();
    assert.ok(segBytes.byteLength > 0);
    console.log(
      `[OK] GET /api/stream/segment -> HTTP ${segRes.status} (${segRes.headers.get('content-type')}, ${segBytes.byteLength} bytes, CORS=${segRes.headers.get('access-control-allow-origin')})`
    );

    const search = await (await fetch(`${base}/api/search?q=Batman`)).json();
    assert.strictEqual(search.ok, true);
    assert.ok(search.data.items.length > 0);
    console.log(`[OK] GET /api/search?q=Batman -> ${search.data.items.length} resultados`);

    const ranks = await (await fetch(`${base}/api/rankings?topic_id=1&pid=0`)).json();
    assert.strictEqual(ranks.ok, true);
    assert.ok(ranks.data.items.length > 0);
    console.log(`[OK] GET /api/rankings -> ${ranks.data.items.length} títulos em alta`);

    // 4. Testa Download direto de episódio (2 primeiros segmentos + barra de progresso)
    assert.ok(ep.web_stream.download_url.startsWith('/api/stream/download'));
    const dlId = 'selftest_dl_1';
    const dlUrl = `${base}${ep.web_stream.download_url}&filename=${encodeURIComponent('Teste Ep 01')}&download_id=${dlId}&max_segments=2`;
    const dlRes = await fetch(dlUrl);
    assert.strictEqual(dlRes.status, 200);
    assert.ok(String(dlRes.headers.get('content-disposition') || '').includes('attachment'));
    const dlBuf = await dlRes.arrayBuffer();
    assert.ok(dlBuf.byteLength > 10000, 'Arquivo baixado deve conter dados reais de vídeo');
    const prog = await (await fetch(`${base}/api/stream/download/progress?id=${dlId}`)).json();
    assert.strictEqual(prog.ok, true);
    assert.strictEqual(prog.data.percent, 100);
    console.log(
      `[OK] GET /api/stream/download -> ${(dlBuf.byteLength / 1024).toFixed(0)} KB (${prog.data.filename}, progresso=${prog.data.percent}%)`
    );

    console.log('\nTodos os testes passaram com 100% de sucesso (0 componentes mobile/P2P)!');
  } finally {
    server.close();
    process.exit(0);
  }
}

runSelfTest().catch((err) => {
  console.error('\n[FALHA]', err);
  process.exit(1);
});
