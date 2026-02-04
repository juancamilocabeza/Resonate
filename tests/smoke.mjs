import http from 'node:http';
import { spawn } from 'node:child_process';

const BASE_URL = 'http://localhost:3000';
const TIMEOUT_MS = 20000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}${pathname}`, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode || 0, body });
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy(new Error('Request timeout'));
    });
  });
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < TIMEOUT_MS) {
    try {
      const res = await request('/');
      if (res.status === 200) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('Server did not become ready in time');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  console.log('Starting dev server...');
  const serverProc = spawn(process.execPath, ['server.js'], {
    stdio: 'pipe',
    env: { ...process.env, PORT: '3000' }
  });

  serverProc.stdout.on('data', (d) => process.stdout.write(d));
  serverProc.stderr.on('data', (d) => process.stderr.write(d));

  let exitCode = 0;
  try {
    await waitForServer();

    const indexRes = await request('/');
    assert(indexRes.status === 200, 'GET / should return 200');
    assert(indexRes.body.includes('id="app"'), 'Index should include #app');
    assert(indexRes.body.includes('id="search-input"'), 'Index should include #search-input');
    assert(indexRes.body.includes('id="play-btn"'), 'Index should include #play-btn');

    const manifestRes = await request('/manifest.json');
    assert(manifestRes.status === 200, 'GET /manifest.json should return 200');
    assert(manifestRes.body.includes('"name"'), 'Manifest should include name');

    const swRes = await request('/sw.js');
    assert(swRes.status === 200, 'GET /sw.js should return 200');
    assert(swRes.body.includes('CACHE_NAMES'), 'SW should include CACHE_NAMES');

    const cssRes = await request('/css/resonate.css');
    assert(cssRes.status === 200, 'GET /css/resonate.css should return 200');
    assert(cssRes.body.includes(':root') || cssRes.body.includes('body'), 'CSS should contain styles');

    const uiRes = await request('/js/ui.js');
    assert(uiRes.status === 200, 'GET /js/ui.js should return 200');
    assert(uiRes.body.includes('function setupPWAInstall'), 'UI should include setupPWAInstall');

    const cacheRes = await request('/js/cache.js');
    assert(cacheRes.status === 200, 'GET /js/cache.js should return 200');
    assert(cacheRes.body.includes('class AudioCache'), 'Cache should include AudioCache');

    console.log('Smoke tests passed.');
  } catch (err) {
    exitCode = 1;
    console.error(`Smoke tests failed: ${err.message}`);
  } finally {
    try {
      serverProc.kill();
    } catch {}
  }

  process.exit(exitCode);
}

run();
