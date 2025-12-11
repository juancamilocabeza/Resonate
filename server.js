// Simple Node.js server that handles Open Graph meta tags for shared links
// This allows social media bots to see the correct cover art and metadata

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// Cache for metadata to reduce API calls
const metadataCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Read the base HTML file
const indexPath = path.join(__dirname, 'index.html');
let baseHtml = fs.readFileSync(indexPath, 'utf-8');

// Function to fetch metadata from archive.org
async function fetchMetadata(identifier) {
  // Check cache first
  const cached = metadataCache.get(identifier);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  try {
    const response = await fetch(`https://archive.org/metadata/${identifier}`);
    if (!response.ok) {
      throw new Error(`Archive.org API returned ${response.status}`);
    }
    const metadata = await response.json();
    
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

    // Serve static files
    const filePath = path.join(__dirname, pathname);
    
    // Security check: prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // Try to serve the file
    fs.stat(filePath, (err, stats) => {
      if (err) {
        // File not found
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      if (stats.isDirectory()) {
        // If it's a directory, try to serve index.html
        const indexFile = path.join(filePath, 'index.html');
        fs.stat(indexFile, (err) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
          }
          fs.readFile(indexFile, (err, content) => {
            if (err) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Internal Server Error');
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
          });
        });
        return;
      }

      // Serve the file
      const contentType = getContentType(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

// Get content type based on file extension
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
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
    '.wasm': 'application/wasm',
    '.wast': 'text/plain; charset=utf-8',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
  };
  return types[ext] || 'application/octet-stream';
}

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
