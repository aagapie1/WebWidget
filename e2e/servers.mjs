// Test servers for Playwright:
//  - fake Dify on :4010: scripted answers chosen by keywords in the question, and an in-memory
//    store of conversations per `user` (history, rename, delete, feedback), like the pilot
//  - client sites: :5180 (in allowedOrigins) and :5181 (not allowed), each embedding the widget
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const GATEWAY = process.env.E2E_GATEWAY ?? 'http://localhost:3101';

const requests = [];
let failuresLeft = 1;
/** id → { id, user, name, createdAt, updatedAt, messages: [{ id, query, answer, created_at, feedback, retriever_resources }] } */
const conversations = new Map();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => Math.floor(Date.now() / 1000);
// Dify timestamps have 1 s resolution; a sequence keeps "most recent first" deterministic in tests.
let sequence = 0;

const SOURCES = [
  {
    position: 1,
    document_id: 'doc-1',
    document_name: 'Regulament_v3.pdf',
    content: '## Art. 3 Programul',
  },
  {
    position: 2,
    document_id: 'doc-1',
    document_name: 'Regulament_v3.pdf',
    content: 'alt fragment',
  },
  {
    position: 3,
    document_id: 'doc-2',
    document_name: 'Tarife 2026.docx',
    content: 'Taxa este 100 lei',
  },
];

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

const json = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

function scriptFor(query) {
  if (query.includes('xss')) {
    return {
      chunks: [
        'Text sigur. <img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> ',
        '[rău](javascript:window.__xss=3) [site](https://example.org/pagina) ',
        '![pixel](https://tracker.example/p.png)',
      ],
      pause: 20,
    };
  }
  if (query.includes('lung')) {
    return { chunks: Array.from({ length: 200 }, (_, i) => `cuvânt${String(i)} `), pause: 50 };
  }
  if (query.includes('absent')) {
    // Finishes even when the browser leaves (like Dify, ADR 005).
    return { chunks: ['Răspuns ', 'terminat ', 'în lipsa ', 'vizitatorului.'], pause: 400 };
  }
  if (query.includes('surse')) {
    return {
      chunks: ['Conform regulamentului, ', 'taxa este 100 lei.'],
      pause: 30,
      sources: SOURCES,
    };
  }
  return { chunks: ['Programul este ', '**luni–vineri**', ', între 8 și 16.'], pause: 40 };
}

/** Streams the answer; generation continues and is stored even if the client disconnects. */
async function chat(res, body) {
  const query = String(body?.query ?? '');
  if (query.includes('eroare') && failuresLeft > 0) {
    failuresLeft--;
    json(res, 503, { code: 'unavailable' });
    return;
  }
  let conversation = body?.conversation_id ? conversations.get(body.conversation_id) : undefined;
  if (body?.conversation_id && (!conversation || conversation.user !== body.user)) {
    json(res, 404, { code: 'not_found', message: 'Conversation Not Exists.', status: 404 });
    return;
  }
  if (!conversation) {
    conversation = {
      id: randomUUID(),
      user: body.user,
      // Dify's own default name: the question truncated (no model call with auto_generate_name false).
      name: query.slice(0, 20),
      createdAt: now(),
      updatedAt: now(),
      seq: ++sequence,
      messages: [],
    };
    conversations.set(conversation.id, conversation);
  }
  const ids = { task_id: randomUUID(), message_id: randomUUID(), conversation_id: conversation.id };
  const { chunks, pause, sources = [] } = scriptFor(query);
  const record = {
    id: ids.message_id,
    query,
    answer: '',
    created_at: now(),
    feedback: null,
    retriever_resources: sources,
    status: 'normal',
  };
  conversation.messages.push(record);

  const send = (data) => {
    if (!res.destroyed) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write('event: ping\n\n');
  for (const answer of chunks) {
    record.answer += answer;
    send({ event: 'message', ...ids, answer });
    await delay(pause);
  }
  conversation.updatedAt = now();
  conversation.seq = ++sequence;
  send({ event: 'message_end', ...ids, metadata: { retriever_resources: sources } });
  if (!res.destroyed) res.end();
}

const owned = (id, user) => {
  const conversation = conversations.get(id);
  return conversation && conversation.user === user ? conversation : undefined;
};

const dify = createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url ?? '/', 'http://dify.test');
  const path = url.pathname;
  if (path === '/__requests') return json(res, 200, requests);
  if (path === '/__reset') {
    requests.length = 0;
    failuresLeft = 1;
    conversations.clear();
    return res.writeHead(204).end();
  }
  requests.push({
    method: req.method,
    url: req.url,
    authorization: req.headers.authorization,
    body,
  });

  if (path === '/v1/parameters') {
    return json(res, 200, {
      opening_statement: 'Bună ziua! Sunt asistentul de test.',
      suggested_questions: ['Care e programul?', 'Ce taxe sunt? surse'],
    });
  }
  if (/^\/v1\/chat-messages\/[^/]+\/stop$/.test(path)) return json(res, 200, { result: 'success' });
  if (path === '/v1/chat-messages') return chat(res, body);

  if (path === '/v1/conversations' && req.method === 'GET') {
    const user = url.searchParams.get('user');
    const data = [...conversations.values()]
      .filter((c) => c.user === user)
      .sort((a, b) => b.updatedAt - a.updatedAt || b.seq - a.seq)
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: 'normal',
        created_at: c.createdAt,
        updated_at: c.updatedAt,
      }));
    return json(res, 200, { limit: 20, has_more: false, data });
  }
  const rename = path.match(/^\/v1\/conversations\/([^/]+)\/name$/);
  if (rename && req.method === 'POST') {
    const conversation = owned(rename[1], body?.user);
    if (!conversation) return json(res, 404, { code: 'not_found' });
    conversation.name = body.name;
    return json(res, 200, { id: conversation.id, name: conversation.name });
  }
  const remove = path.match(/^\/v1\/conversations\/([^/]+)$/);
  if (remove && req.method === 'DELETE') {
    if (!owned(remove[1], body?.user)) return json(res, 404, { code: 'not_found' });
    conversations.delete(remove[1]);
    return res.writeHead(204).end();
  }
  if (path === '/v1/messages' && req.method === 'GET') {
    const conversation = owned(
      url.searchParams.get('conversation_id'),
      url.searchParams.get('user'),
    );
    if (!conversation)
      return json(res, 404, { code: 'not_found', message: 'Conversation Not Exists.' });
    const data = conversation.messages.map((m) => ({
      ...m,
      conversation_id: conversation.id,
      feedback: m.feedback ? { rating: m.feedback } : null,
    }));
    return json(res, 200, { limit: 20, has_more: false, data });
  }
  const feedback = path.match(/^\/v1\/messages\/([^/]+)\/feedbacks$/);
  if (feedback && req.method === 'POST') {
    for (const conversation of conversations.values()) {
      if (conversation.user !== body?.user) continue;
      const message = conversation.messages.find((m) => m.id === feedback[1]);
      if (message) {
        message.feedback = body.rating;
        return json(res, 200, { result: 'success' });
      }
    }
    return json(res, 404, { code: 'not_found' });
  }
  res.writeHead(404).end();
});

function site(name) {
  return createServer((req, res) => {
    // /brand.html embeds the second tenant (white-label tests, E4).
    const tenant = req.url?.startsWith('/brand.html')
      ? 'e2e-brand'
      : req.url?.startsWith('/off.html')
        ? 'e2e-off'
        : 'e2e';
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
    // /strict.html: a client site with a strict CSP (E5 A1, ADR 010): default-src 'none' plus exactly
    // what 'Integrare pe site' tells clients to add (cspFor() in the admin), no 'unsafe-inline'.
    const headers = { 'content-type': 'text/html; charset=utf-8' };
    if (req.url?.startsWith('/strict.html')) {
      headers['content-security-policy'] = [
        "default-src 'none'",
        `script-src ${GATEWAY}`,
        `style-src ${GATEWAY}`,
        `frame-src ${GATEWAY}`,
        `connect-src ${GATEWAY}`,
        `img-src ${GATEWAY}`,
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ');
    }
    res.writeHead(200, headers).end(`<!doctype html>
<html lang="ro">
  <head><meta charset="utf-8"><title>${name}</title></head>
  <body>
    <header><h1>${name}</h1></header>
    <main><p>Conținutul paginii.</p><a href="#x">Link din pagină</a></main>
    <script src="${GATEWAY}/w/loader.js" data-tenant="${tenant}" async></script>
  </body>
</html>`);
  });
}

dify.listen(4010, '127.0.0.1');
site('Site permis').listen(5180, '127.0.0.1');
site('Site nepermis').listen(5181, '127.0.0.1');
console.log('e2e servers ready');
