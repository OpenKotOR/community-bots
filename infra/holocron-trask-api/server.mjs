/**
 * Deprecated HF mirror — bundled reference Q&A removed. Deploy holocron-trask-http for live GPTR.
 */

import { createServer } from 'node:http';

function normalizeCorsOrigin(origin) {
  return origin?.trim() ? origin.trim() : '*';
}

function jsonResponse(status, body, origin) {
  const payload = JSON.stringify(body);
  return {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(payload)),
      'Access-Control-Allow-Origin': normalizeCorsOrigin(origin),
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Trask-Api-Key',
      Vary: 'Origin',
    },
    body: payload,
  };
}

const LIVE_RESEARCH_REQUIRED = {
  error:
    'Bundled reference answers are disabled on this Space. Use OpenKotOR/holocron-trask-http (full trask-http-server + GPTR) as TRASK_RESEARCHWIZARD_BASE_URL.',
};

async function handleRequest(request) {
  const origin = request.headers.get('origin');
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': normalizeCorsOrigin(origin),
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Trask-Api-Key',
        Vary: 'Origin',
      },
      body: '',
    };
  }

  if (url.pathname === '/' && request.method === 'GET') {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Holocron Trask API — live GPTR only (bundled references removed).\n',
    };
  }

  if (url.pathname === '/healthz' && request.method === 'GET') {
    return jsonResponse(200, { ok: true, mode: 'live-gptr-required', bundledReferenceApi: false }, origin);
  }

  if (url.pathname.startsWith('/reference') || url.pathname.startsWith('/api/trask')) {
    return jsonResponse(503, LIVE_RESEARCH_REQUIRED, origin);
  }

  return jsonResponse(404, { error: 'Not found' }, origin);
}

const port = Number(process.env.PORT || 7860);

createServer(async (req, res) => {
  const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
    duplex: 'half',
  });
  const response = await handleRequest(request);
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}).listen(port, () => {
  console.log(`holocron-trask-api stub listening on ${port}`);
});
