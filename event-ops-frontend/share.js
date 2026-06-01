/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * One-command public share with working real-time features.
 *
 *   npm run share:web
 *
 * Starts the WebSocket-aware reverse proxy (share-proxy.js, port 8080) AND an
 * ngrok tunnel pointing at it, then prints the public link. Requires the
 * backend (:3000) and frontend (:3001) to already be running, and ngrok to be
 * installed + authenticated (`ngrok config add-authtoken <token>`).
 */
const { spawn } = require('child_process');
const http = require('http');

const PORT = Number(process.env.SHARE_PORT) || 8080;

// Start the reverse proxy in-process (share-proxy.js listens on import).
require('./share-proxy');

// Launch ngrok against the proxy port.
const ngrok = spawn('ngrok', ['http', String(PORT), '--log', 'stdout'], {
  shell: true,
});
ngrok.on('error', (e) => {
  console.log(`\n  Could not start ngrok automatically (${e.message}).`);
  console.log(`  Run it yourself in another terminal:  ngrok http ${PORT}\n`);
});

// Poll ngrok's local API for the public URL and print it once.
let printed = false;
const timer = setInterval(() => {
  http
    .get('http://localhost:4040/api/tunnels', (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const tunnel = (data.tunnels || []).find((t) =>
            (t.public_url || '').startsWith('https'),
          );
          if (tunnel && !printed) {
            printed = true;
            clearInterval(timer);
            console.log('\n========================================');
            console.log('  SHARE THIS LINK:');
            console.log('  ' + tunnel.public_url);
            console.log('  (real-time presence + notifications work)');
            console.log('========================================\n');
          }
        } catch {
          /* ngrok not ready yet */
        }
      });
    })
    .on('error', () => {
      /* ngrok API not up yet */
    });
}, 1500);

process.on('SIGINT', () => {
  clearInterval(timer);
  ngrok.kill();
  process.exit(0);
});
