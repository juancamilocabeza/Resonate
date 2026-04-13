/**
 * Resonate Node.js development server.
 * Serves static files from the project root and proxies Archive.org API calls.
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '3000', 10);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function shouldNoCache(urlPath) {
  return (
    urlPath === '/' ||
    urlPath.endsWith('.html') ||
    urlPath.endsWith('sw.js') ||
    urlPath.endsWith('manifest.json') ||
    urlPath.endsWith('manifest.webmanifest')
  );
}

function safeResolve(urlPath) {
  // Strip query and fragment
  const pathOnly = urlPath.split('?')[0].split('#')[0];
  const rel = pathOnly.replace(/\\/g, '/').replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  // Prevent path traversal
  if (!full.startsWith(ROOT)) return null;
  return full;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function proxyUpstreamJson(method, upstreamUrl, res) {
  const parsed = new URL(upstreamUrl);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ResonateNodeServer/1.0',
    },
  };

  const proxyReq = transport.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || 'application/json; charset=utf-8';
    try {
      res.writeHead(proxyRes.statusCode || 200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
      });
    } catch { /* client disconnected */ return; }

    if (method === 'HEAD') {
      res.end();
      proxyRes.resume();
      return;
    }

    proxyRes.pipe(res);
  });

  proxyReq.setTimeout(55000, () => {
    proxyReq.destroy();
    try {
      res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Gateway Timeout', upstream: upstreamUrl }));
    } catch { /* ignore */ }
  });

  proxyReq.on('error', (err) => {
    try {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Bad Gateway', upstream: upstreamUrl, message: err.message }));
    } catch { /* ignore */ }
  });

  proxyReq.end();
}

function handleRequest(req, res) {
  const rawUrl = req.url || '/';
  const parsed = new URL(rawUrl, `http://localhost:${PORT}`);
  const urlPath = parsed.pathname || '/';
  const method = (req.method || 'GET').toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  // Proxy: Archive.org advanced search
  if (urlPath === '/api/archive/advancedsearch') {
    const upstreamUrl = `https://archive.org/advancedsearch.php${parsed.search ? parsed.search : ''}`;
    proxyUpstreamJson(method, upstreamUrl, res);
    return;
  }

  // Proxy: Archive.org metadata
  if (urlPath.startsWith('/api/archive/metadata/')) {
    const identifier = urlPath.slice('/api/archive/metadata/'.length).replace(/^\/+|\/+$/g, '');
    if (!identifier) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }
    const upstreamUrl = `https://archive.org/metadata/${identifier}`;
    proxyUpstreamJson(method, upstreamUrl, res);
    return;
  }

  // Static file serving
  let filePath;
  if (urlPath === '/' || urlPath === '') {
    filePath = path.join(ROOT, 'index.html');
  } else {
    const resolved = safeResolve(rawUrl);
    if (!resolved) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }
    filePath = resolved;
  }

  // Directory -> index.html
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    // File doesn't exist yet — handled below
  }

  // SPA fallback for extensionless paths
  if (!fs.existsSync(filePath)) {
    if (path.extname(filePath) === '') {
      filePath = path.join(ROOT, 'index.html');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
  }

  const cacheControl = shouldNoCache(urlPath) ? 'no-cache' : 'public, max-age=3600';
  const contentType = getMimeType(filePath);

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': cacheControl,
    });
    if (method === 'HEAD') {
      res.end();
    } else {
      res.end(data);
    }
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
}

const server = http.createServer((req, res) => {
  try {
    handleRequest(req, res);
  } catch (err) {
    process.stderr.write(`[server] unhandled error: ${err.message}\n`);
    try {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    } catch { /* ignore */ }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Resonate node server: http://localhost:${PORT}`);
});
