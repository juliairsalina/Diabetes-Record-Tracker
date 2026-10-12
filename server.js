// Local server: serves the app from ./public and the API from lib/app.js.
// On Vercel the same API runs as a function (api/index.js) and Vercel serves ./public.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./lib/app.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
// Same security headers as vercel.json.
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}

function createServer(options) {
  const app = createApp(options);
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) app.handle(req, res);
    else serveStatic(req, res);
  });
  return { server, app };
}

if (require.main === module) {
  createServer().server.listen(PORT, () => console.log(`Rekod Gula running on http://localhost:${PORT}`));
}

module.exports = { createServer };
