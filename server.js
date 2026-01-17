import http from 'node:http';
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

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    const urlPath = req.url || '/';
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
