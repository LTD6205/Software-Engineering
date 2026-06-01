/**
 * Reverse proxy for sharing the app (e.g. via a single ngrok tunnel) with
 * working real-time features.
 *
 * The Next.js dev server cannot proxy WebSocket traffic, so presence and live
 * notifications break behind a tunnel. This proxy fronts both servers on one
 * port and forwards WebSocket upgrades correctly:
 *
 *   /api/*       -> backend  (http://localhost:3000)
 *   /socket.io/* -> backend  (http + WebSocket upgrade)
 *   everything   -> frontend (http://localhost:3001, incl. HMR)
 *
 * Usage:
 *   1. Start backend (npm run start:dev) and frontend (npm run dev -- --port 3001)
 *   2. node share-proxy.js          (serves on http://localhost:8080)
 *   3. ngrok http 8080              (share the printed URL)
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('http');
const httpProxy = require('http-proxy');

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3001';
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3000';
const PORT = Number(process.env.SHARE_PORT) || 8080;

const proxy = httpProxy.createProxyServer({ changeOrigin: true, ws: true });
proxy.on('error', (err, _req, res) => {
  console.error('proxy error:', err.message);
  if (res && res.writeHead && !res.headersSent) {
    res.writeHead(502);
    res.end('Bad gateway');
  }
});

const toBackend = (url = '') =>
  url.startsWith('/api') || url.startsWith('/socket.io');

const server = http.createServer((req, res) => {
  proxy.web(req, res, { target: toBackend(req.url) ? BACKEND : FRONTEND });
});

// Forward WebSocket upgrades: socket.io -> backend, everything else (Next HMR)
// -> frontend.
server.on('upgrade', (req, socket, head) => {
  const target = (req.url || '').startsWith('/socket.io') ? BACKEND : FRONTEND;
  proxy.ws(req, socket, head, { target });
});

server.listen(PORT, () => {
  console.log(`\n  Share proxy ready: http://localhost:${PORT}`);
  console.log(`    /api, /socket.io  -> ${BACKEND}`);
  console.log(`    everything else   -> ${FRONTEND}`);
  console.log(`\n  Now run:  ngrok http ${PORT}\n`);
});
