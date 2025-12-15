// Simple Node.js server that handles Open Graph meta tags for shared links
// This allows social media bots to see the correct cover art and metadata

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

const ROOT_DIR = path.resolve(__dirname);

// Cache for metadata to reduce API calls
const metadataCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Read the base HTML file
const indexPath = path.join(__dirname, 'index.html');
let baseHtml = fs.readFileSync(indexPath, 'utf-8');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json'
};

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function resolveSafeLocalPath(requestPathname) {
  // url.parse().pathname is always rooted (e.g. "/css/app.css").
  // Strip leading slashes so path.resolve stays within ROOT_DIR.
  const rel = String(requestPathname || '').replace(/^\/+/, '');
  const resolved = path.resolve(ROOT_DIR, rel);

  // Security check: prevent directory traversal.
  // Allow exact root match and any descendant.
  if (resolved !== ROOT_DIR && !resolved.startsWith(ROOT_DIR + path.sep)) {
    return null;
  }

  return resolved;
}

async function readJsonFromUrl(urlString) {
  // Prefer global fetch when available.
  if (typeof fetch === 'function') {
    const response = await fetch(urlString);
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    return response.json();
  }

  // Minimal fallback for older Node runtimes.
  return new Promise((resolve, reject) => {
    https
      .get(urlString, (resp) => {
        const { statusCode } = resp;
        if (!statusCode || statusCode < 200 || statusCode >= 300) {
          resp.resume();
          reject(new Error(`Request failed with ${statusCode}`));
          return;
        }
        let raw = '';
        resp.setEncoding('utf8');
        resp.on('data', (chunk) => {
          raw += chunk;
        });
        resp.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

// Function to fetch metadata from archive.org
async function fetchMetadata(identifier) {
  // Check cache first
  const cached = metadataCache.get(identifier);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  try {
    const metadata = await readJsonFromUrl(`https://archive.org/metadata/${identifier}`);
    
    // Cache the result
    metadataCache.set(identifier, {
      data: metadata,
      timestamp: Date.now()
    });
    
    return metadata;
  } catch (error) {
    console.error(`Error fetching metadata for ${identifier}:`, error.message);
    return null;
  }
}

// Function to inject meta tags into HTML
function injectMetaTags(html, identifier, metadata) {
  if (!metadata || !metadata.metadata) {
    // If metadata fetch failed, still inject the identifier for client-side handling
    return html;
  }

  const title = metadata.metadata.title || 'Shared content';
  const creator = metadata.metadata.creator || 'Unknown';
  const description = `Listen to "${title}" by ${creator} on Resonate Player. Free music from archive.org.`;
  const imageUrl = `https://archive.org/services/img/${identifier}`;
  const canonicalUrl = `${getBaseUrl()}/?play=${encodeURIComponent(identifier)}`;

  // Create meta tags to inject
  const metaTags = `
  <meta property="og:title" content="${escapeHtml(title + ' - ' + creator)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:type" content="music.song">
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:title" content="${escapeHtml(title + ' - ' + creator)}">
  <meta property="twitter:description" content="${escapeHtml(description)}">
  <meta property="twitter:image" content="${imageUrl}">
  <meta property="twitter:url" content="${canonicalUrl}">
  <meta name="description" content="${escapeHtml(description)}">`;

  // Insert meta tags before closing </head> tag
  return html.replace('</head>', metaTags + '\n  </head>');
}

// Escape HTML special characters
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Get base URL for canonical links
function getBaseUrl() {
  // This will be set based on the request
  // In production, use your actual domain
  return process.env.BASE_URL || 'https://www.resonateplayer.com';
}

async function serveStaticPath(res, pathname) {
  const localPath = resolveSafeLocalPath(pathname);
  if (!localPath) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  let stats;
  try {
    stats = await fsp.stat(localPath);
  } catch {
    sendText(res, 404, 'Not Found');
    return;
  }

  if (stats.isDirectory()) {
    const indexFile = path.join(localPath, 'index.html');
    try {
      const content = await fsp.readFile(indexFile);
      sendHtml(res, 200, content);
    } catch {
      sendText(res, 404, 'Not Found');
    }
    return;
  }

  const contentType = getContentType(localPath);
  res.writeHead(200, { 'Content-Type': contentType });
  const stream = fs.createReadStream(localPath);
  stream.on('error', () => {
    if (!res.headersSent) {
      sendText(res, 500, 'Internal Server Error');
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;

    // Handle root path with play parameter
    if (pathname === '/' || pathname === '/index.html') {
      let html = baseHtml;

      // If there's a play parameter, fetch metadata and inject meta tags
      if (query.play) {
        const identifier = decodeURIComponent(query.play);
        console.log(`Handling shared link for identifier: ${identifier}`);
        
        const metadata = await fetchMetadata(identifier);
        if (metadata) {
          html = injectMetaTags(baseHtml, identifier, metadata);
          console.log(`Meta tags injected for: ${identifier}`);
        } else {
          console.log(`Could not fetch metadata for: ${identifier}`);
        }
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    await serveStaticPath(res, pathname);
  } catch (error) {
    console.error('Server error:', error);
    sendText(res, 500, 'Internal Server Error');
  }
});

// Start the server
server.listen(PORT, () => {
  console.log(`Resonate Player server running at http://localhost:${PORT}`);
  console.log('This server handles Open Graph meta tags for social media sharing.');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
