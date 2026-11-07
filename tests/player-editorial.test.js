import assert from 'assert/strict';
import { readFile } from 'fs/promises';
import vm from 'vm';

const root = new URL('../', import.meta.url);
const [html, css, theme, patch, serviceWorker, ui, immersion, displayFont, uiFont] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('css/player-editorial.css', root), 'utf8'),
  readFile(new URL('styles/theme.css', root), 'utf8'),
  readFile(new URL('styles/patch-look-and-feel.css', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8'),
  readFile(new URL('js/ui.js', root), 'utf8'),
  readFile(new URL('css/player-immersion.css', root), 'utf8'),
  readFile(new URL('assets/fonts/bodoni-moda-latin.woff2', root)),
  readFile(new URL('assets/fonts/instrument-sans-latin.woff2', root))
]);

function relativeLuminance (hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio (foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

const badge = { hidden: true };
const label = { textContent: '', style: {} };
const fill = { style: {} };
const elements = {
  'coop-progress-label': label,
  'coop-progress-fill': fill
};
const context = {
  window: {},
  document: {
    querySelector: selector => selector === '.coop-badge' ? badge : null,
    getElementById: id => elements[id] || null
  }
};
const badgeUpdater = ui.match(/window\.updateCoopBadge = function updateCoopBadge\(track\) \{[\s\S]*?\n\};/);

assert.ok(badgeUpdater, 'Cooperative badge updater should be defined');
vm.runInNewContext(badgeUpdater[0], context);
const updateCoopBadge = context.window.updateCoopBadge;

updateCoopBadge(null);
assert.equal(badge.hidden, true, 'Badge should stay hidden when progress is unavailable');
assert.equal(fill.style.transform, 'scaleX(0)');

updateCoopBadge({ streamToOwnProgress: 34.6 });
assert.equal(badge.hidden, false, 'Badge should appear when progress is available');
assert.equal(label.textContent, '35% toward owning this track');
assert.equal(fill.style.transform, 'scaleX(0.35)');

updateCoopBadge({ streamToOwnProgress: 101 });
assert.equal(badge.hidden, true, 'Badge should hide out-of-range progress');

assert.equal((html.match(/id="progress-bar"/g) || []).length, 1);
const artFrameStart = html.indexOf('<div class="editorial-art-frame">');
const artFrameEnd = html.indexOf('</div>\n          <div class="current-track-info">', artFrameStart);
const trackInfoStart = html.indexOf('<div class="current-track-info">');
const progressStart = html.indexOf('<div class="progress-section">', artFrameStart);
const controlsStart = html.indexOf('<div class="controls">', trackInfoStart);
assert.ok(artFrameEnd > artFrameStart, 'Artwork frame should close before track information');
assert.ok(progressStart > trackInfoStart, 'Progress bar should follow track information');
assert.ok(progressStart < controlsStart, 'Progress bar should precede playback controls');
assert.doesNotMatch(html.slice(artFrameStart, artFrameEnd), /class="progress-section"/);
for (const control of ['shuffle-favorites-btn', 'prev-btn', 'play-btn', 'next-btn', 'favorite-btn']) {
  assert.match(html, new RegExp(`id="${control}"`), `Mobile player should include ${control}`);
}
assert.match(immersion, /"art info info"\s+"progress progress progress"\s+"controls controls controls"/);
assert.match(immersion, /\.main-player-section \.controls > button:not\(\.play-btn\)\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
assert.doesNotMatch(immersion, /\.main-player-section \.controls \.(?:shuffle-favorites-btn|prev-btn)[^{}]*\{[^}]*display:\s*none;/s);
assert.doesNotMatch(immersion, /\.main-player-section \.controls #favorite-btn[^{}]*\{[^}]*display:\s*none;/s);

assert.match(theme, /font-family:\s*"Bodoni Moda";/);
assert.match(theme, /font-family:\s*"Instrument Sans";/);
assert.match(theme, /--font-display:\s*"Bodoni Moda", Georgia, serif;/);
assert.match(theme, /--font-ui:\s*"Instrument Sans", "Helvetica Neue", sans-serif;/);
assert.match(theme, /--theme-bg:\s*#121316;/);
assert.match(theme, /--theme-surface:\s*#1a1c23;/);
assert.match(theme, /--theme-text-primary:\s*#f0f2f5;/);
assert.match(theme, /--color-accent-amber:\s*var\(--theme-accent\);/);
assert.match(theme, /--color-coop-teal:\s*var\(--theme-accent\);/);
assert.match(theme, /--max-text-width:\s*75ch;/);
assert.match(theme, /--border-subtle:\s*1px solid var\(--theme-player-border\);/);
assert.match(theme, /--border-strong:\s*1px solid var\(--color-border-strong\);/);
assert.match(theme, /\.bg-texture-grain\s*\{[^}]*radial-gradient/s);
assert.match(theme, /:where\(body\)\s*\{[^}]*font-family:\s*var\(--font-ui\)/s);
assert.ok(contrastRatio('#f0f2f5', '#121316') >= 4.5, 'Main text should meet WCAG AA on the paper background');
assert.ok(contrastRatio('#f0f2f5', '#1a1c23') >= 4.5, 'Main text should meet WCAG AA on surfaces');
assert.ok(contrastRatio('#121316', '#f8f9fa') >= 4.5, 'Day text should meet WCAG AA on the paper background');
assert.ok(contrastRatio('#121316', '#ffffff') >= 4.5, 'Day text should meet WCAG AA on surfaces');
assert.ok(contrastRatio('#5a606d', '#ffffff') >= 4.5, 'Day muted text should meet WCAG AA on surfaces');
assert.ok(contrastRatio('#2bb6a3', '#121316') >= 3, 'Night focus accent should contrast against the paper background');
assert.match(html, /href="styles\/patch-look-and-feel\.css"/);
assert.match(patch, /text-overflow:\s*ellipsis;/);
assert.match(patch, /white-space:\s*nowrap;/);
assert.match(patch, /max-width:\s*75ch;/);
assert.match(patch, /align-items:\s*center;/);
assert.match(patch, /transition:\s*all 150ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/);
assert.match(patch, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-accent-amber\)[^}]*outline-offset:\s*2px/s);
assert.match(patch, /@media \(max-width:\s*767px\)/);
assert.match(patch, /@media \(prefers-reduced-motion:\s*reduce\)/);
assert.ok(contrastRatio('#7b3b00', '#f5f5f5') >= 3, 'Day focus accent should contrast against the light background');
assert.match(serviceWorker, /'\/styles\/patch-look-and-feel\.css'/);
assert.match(css, /\.current-track-info \.title\s*\{[^}]*font-family:\s*var\(--font-display[^}]*text-align:\s*center;[^}]*text-align-last:\s*center;/);
assert.match(css, /\.current-track-info \.title \.title-text\s*\{[^}]*font-family:\s*var\(--font-display[^}]*text-align:\s*center;/);
assert.match(css, /\.current-track-info \.creator\s*\{[^}]*font-family:\s*var\(--font-ui[^}]*text-align:\s*center;[^}]*text-align-last:\s*center;/);
assert.match(css, /\.current-track-info \.creator #creator\s*\{[^}]*font-family:\s*var\(--font-ui[^}]*text-align:\s*center;/);
assert.match(css, /\.coop-badge\[hidden\]\s*\{\s*display:\s*none;/);
assert.equal(displayFont.toString('ascii', 0, 4), 'wOF2');
assert.equal(uiFont.toString('ascii', 0, 4), 'wOF2');
assert.match(html, /href="\/assets\/fonts\/bodoni-moda-latin\.woff2" as="font"/);
assert.match(html, /href="\/assets\/fonts\/instrument-sans-latin\.woff2" as="font"/);
assert.match(serviceWorker, /'\/assets\/fonts\/bodoni-moda-latin\.woff2'/);
assert.match(serviceWorker, /'\/assets\/fonts\/instrument-sans-latin\.woff2'/);
assert.match(serviceWorker, /static-v17p14/);
assert.match(html, /<style>[\s\S]*?html,\s*body\s*\{[^}]*background-color:\s*var\(--theme-bg,/);
assert.match(html, /<style>[\s\S]*?html,\s*body\s*\{[^}]*color:\s*var\(--theme-text-primary,/);
assert.match(html, /svg\s*\{[^}]*max-width:\s*32px;[^}]*max-height:\s*32px;[^}]*width:\s*100%;[^}]*height:\s*auto;/);
assert.match(html, /\.sr-only\s*\{\s*position:\s*absolute;[^}]*clip:\s*rect\(0,0,0,0\);/);
assert.match(html, /overscroll-behavior-y:\s*contain;/);
assert.match(theme, /:where\(body\)\s*\{[^}]*overscroll-behavior-y:\s*contain;/);
assert.match(theme, /\.app,\s*\.discovery-section\s*\{\s*overscroll-behavior-y:\s*contain;/);
assert.match(serviceWorker, /self\.skipWaiting\(\)/);
assert.match(serviceWorker, /event\.request\.mode === 'navigate'[\s\S]*?networkFirstNavigation\(event\.request\)/);
assert.match(serviceWorker, /async function networkFirstNavigation\(request\)[\s\S]*?await fetch\(request\)[\s\S]*?cache\.match\(candidate\)/);
assert.match(serviceWorker, /function isCacheRefreshRequest\(request\)[\s\S]*?request\.cache === 'reload'[\s\S]*?no-cache/);
assert.match(serviceWorker, /async function networkFirstStaticAsset\(request, url\)[\s\S]*?await fetch\(request\)[\s\S]*?cache\.put\(request, networkResponse\.clone\(\)\)[\s\S]*?cache\.match\(request\)/);
assert.match(serviceWorker, /if \(isCacheRefreshRequest\(event\.request\)\)\s*\{\s*return networkFirstStaticAsset\(event\.request, url\);/);
assert.match(serviceWorker, /if \(path\.endsWith\('\.css'\)\)\s*\{\s*return networkFirstStaticAsset\(event\.request, url\);/);
assert.match(serviceWorker, /self\.clients\.claim\(\)/);
assert.match(serviceWorker, /VERSIONED_CACHE_PREFIXES\.some\(\(prefix\) => cacheName\.startsWith\(prefix\)\)/);
assert.match(serviceWorker, /async function cacheFirstStaticAsset\([\s\S]*?isCacheableStaticResponse\(url, cachedResponse\)[\s\S]*?await fetch\(request\)/);
assert.match(serviceWorker, /event\.data\.action === 'skipWaiting'/);
assert.match(ui, /navigator\.serviceWorker\.addEventListener\('controllerchange'/);
assert.match(ui, /waitingWorker\.postMessage\(\{ action: 'skipWaiting' \}\)/);

console.log('Player editorial tests passed');
