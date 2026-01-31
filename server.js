import http from 'node:http';
import https from 'node:https';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8']
]);

function safeResolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const clean = decoded.replaceAll('\\\\', '/');
  const rel = clean.replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT)) return null;
  return full;
}

function shouldNoCache(urlPath) {
  return (
    urlPath === '/' ||
    urlPath.endsWith('.html') ||
    urlPath.endsWith('/sw.js') ||
    urlPath.endsWith('sw.js') ||
    urlPath.endsWith('manifest.json')
  );
}

function proxyArchiveAdvancedSearch(req, res) {
  try {
    const base = `http://${req.headers.host || 'localhost'}`;
    const incomingUrl = new URL(req.url || '/', base);

    // Only support this single, known endpoint to avoid becoming an open proxy.
    if (incomingUrl.pathname !== '/api/archive/advancedsearch') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    const upstreamPath = `/advancedsearch.php${incomingUrl.search || ''}`;
    const upstreamReq = https.request(
      {
        method,
        hostname: 'archive.org',
        path: upstreamPath,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'ResonateDevServer/1.0'
        }
      },
      (upstreamRes) => {
        const statusCode = upstreamRes.statusCode || 502;
        const contentType = upstreamRes.headers['content-type'] || 'application/json; charset=utf-8';

        res.writeHead(statusCode, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          // Not strictly necessary for same-origin use, but helpful if someone
          // opens the UI from a different local origin.
          'Access-Control-Allow-Origin': '*'
        });

        if (method === 'HEAD') {
          res.end();
          upstreamRes.resume();
          return;
        }

        upstreamRes.pipe(res);
      }
    );

    upstreamReq.setTimeout(55000, () => {
      try { upstreamReq.destroy(new Error('Upstream timeout')); } catch {}
    });

    upstreamReq.on('error', () => {
      if (res.headersSent) {
        try { res.end(); } catch {}
        return;
      }
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Gateway');
    });

    upstreamReq.end();
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
}

function proxyArchiveMetadata(req, res) {
  try {
    const base = `http://${req.headers.host || 'localhost'}`;
    const incomingUrl = new URL(req.url || '/', base);

    const m = incomingUrl.pathname.match(/^\/api\/archive\/metadata\/([^\/]+)$/);
    if (!m || !m[1]) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    let identifier = '';
    try { identifier = decodeURIComponent(String(m[1] || '')); } catch { identifier = String(m[1] || ''); }
    identifier = identifier.replace(/\/+$/, '').trim();
    if (!identifier || identifier.includes('/') || identifier.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    const upstreamPath = `/metadata/${encodeURIComponent(identifier)}`;

    const upstreamReq = https.request(
      {
        method,
        hostname: 'archive.org',
        path: upstreamPath,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'ResonateDevServer/1.0'
        }
      },
      (upstreamRes) => {
        const statusCode = upstreamRes.statusCode || 502;
        const contentType = upstreamRes.headers['content-type'] || 'application/json; charset=utf-8';

        res.writeHead(statusCode, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*'
        });

        if (method === 'HEAD') {
          res.end();
          upstreamRes.resume();
          return;
        }

        upstreamRes.pipe(res);
      }
    );

    // If the client disconnects, stop the upstream request.
    try {
      req.on('close', () => {
        try { upstreamReq.destroy(); } catch {}
      });
    } catch {}

    upstreamReq.setTimeout(55000, () => {
      try { upstreamReq.destroy(new Error('Upstream timeout')); } catch {}
    });

    upstreamReq.on('error', () => {
      if (res.headersSent) {
        try { res.end(); } catch {}
        return;
      }
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Gateway');
    });

    upstreamReq.end();
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    try { res.end('Internal Server Error'); } catch {}
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    const urlPath = req.url || '/';

    // Local proxy for Archive advancedsearch to avoid CORS/network blocks.
    if (urlPath.startsWith('/api/archive/advancedsearch')) {
      proxyArchiveAdvancedSearch(req, res);
      return;
    }

    // Local proxy for Archive metadata to avoid CORS/network blocks.
    if (urlPath.startsWith('/api/archive/metadata/')) {
      proxyArchiveMetadata(req, res);
      return;
    }

    let filePath = safeResolve(urlPath);
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    if (urlPath === '/' || urlPath === '') {
      filePath = path.join(ROOT, 'index.html');
    }

    // If a directory, serve its index.html
    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
    } catch {
      // If route-like request (no extension), fall back to index.html for SPA/PWA.
      if (!path.extname(filePath)) {
        filePath = path.join(ROOT, 'index.html');
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME.get(ext) || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', shouldNoCache(urlPath) ? 'no-cache' : 'no-cache');

    if (method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return;
    }

    const data = await fs.readFile(filePath);
    res.writeHead(200);
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Resonate dev server: http://localhost:${PORT}`);
});
