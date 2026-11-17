// Test servers for Playwright:
//  - fake Dify on :4010 (scripted answers chosen by keywords in the question)
//  - client sites: :5180 (in allowedOrigins) and :5181 (not allowed), each embedding the widget
import { createServer } from 'node:http';

const GATEWAY = process.env.E2E_GATEWAY ?? 'http://localhost:3100';
const ids = {
  task_id: '11111111-1111-4111-8111-111111111111',
  message_id: '22222222-2222-4222-8222-222222222222',
  conversation_id: '33333333-3333-4333-8333-333333333333',
};

const requests = [];
let failuresLeft = 1;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve(text ? JSON.parse(text) : undefined);
    });
  });
}

async function stream(res, chunks, pause) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write('event: ping\n\n');
  for (const answer of chunks) {
    if (res.destroyed) return;
    res.write(`data: ${JSON.stringify({ event: 'message', ...ids, answer })}\n\n`);
    await delay(pause);
  }
  res.end(`data: ${JSON.stringify({ event: 'message_end', ...ids, metadata: {} })}\n\n`);
}

const dify = createServer(async (req, res) => {
  const body = await readBody(req);
  const url = req.url ?? '';
  if (url === '/__requests') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(requests));
    return;
  }
  if (url === '/__reset') {
    requests.length = 0;
    failuresLeft = 1;
    res.writeHead(204).end();
    return;
  }
  requests.push({ method: req.method, url, authorization: req.headers.authorization, body });

  if (url.startsWith('/v1/parameters')) {
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ opening_statement: 'Bună ziua! Sunt asistentul de test.' }));
    return;
  }
  if (/^\/v1\/chat-messages\/[^/]+\/stop$/.test(url)) {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"result":"success"}');
    return;
  }
  if (url === '/v1/chat-messages') {
    const query = String(body?.query ?? '');
    if (query.includes('xss')) {
      await stream(
        res,
        [
          'Text sigur. <img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> ',
          '[rău](javascript:window.__xss=3) [site](https://example.org/pagina) ',
          '![pixel](https://tracker.example/p.png)',
        ],
        20,
      );
      return;
    }
    if (query.includes('lung')) {
      await stream(
        res,
        Array.from({ length: 200 }, (_, i) => `cuvânt${String(i)} `),
        50,
      );
      return;
    }
    if (query.includes('eroare') && failuresLeft > 0) {
      failuresLeft--;
      res.writeHead(503, { 'content-type': 'application/json' }).end('{"code":"unavailable"}');
      return;
    }
    await stream(res, ['Programul este ', '**luni–vineri**', ', între 8 și 16.'], 40);
    return;
  }
  res.writeHead(404).end();
});

function site(name) {
  return createServer((req, res) => {
    if (req.url?.startsWith('/spoof.html')) {
      // A page that is not allowed, framing the app while claiming an allowed parent.
      const src = `${GATEWAY}/w/app?tenant=e2e&parent=${encodeURIComponent('http://127.0.0.1:5180')}`;
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(
          `<!doctype html><html lang="ro"><head><title>Spoof</title></head><body><main><iframe title="spoof" src="${src}"></iframe></main></body></html>`,
        );
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html>
<html lang="ro">
  <head><meta charset="utf-8"><title>${name}</title></head>
  <body>
    <header><h1>${name}</h1></header>
    <main><p>Conținutul paginii.</p><a href="#x">Link din pagină</a></main>
    <script src="${GATEWAY}/w/loader.js" data-tenant="e2e" async></script>
  </body>
</html>`);
  });
}

dify.listen(4010, '127.0.0.1');
site('Site permis').listen(5180, '127.0.0.1');
site('Site nepermis').listen(5181, '127.0.0.1');
console.log('e2e servers ready');
