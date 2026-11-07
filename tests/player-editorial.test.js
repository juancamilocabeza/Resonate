import assert from 'assert/strict';
import { readFile } from 'fs/promises';
import vm from 'vm';

const root = new URL('../', import.meta.url);
const [html, css, theme, patch, serviceWorker, ui, displayFont, uiFont] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('css/player-editorial.css', root), 'utf8'),
  readFile(new URL('styles/theme.css', root), 'utf8'),
  readFile(new URL('styles/patch-look-and-feel.css', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8'),
  readFile(new URL('js/ui.js', root), 'utf8'),
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

assert.match(theme, /font-family:\s*"Bodoni Moda";/);
assert.match(theme, /font-family:\s*"Instrument Sans";/);
assert.match(theme, /--font-display:\s*"Bodoni Moda", Georgia, serif;/);
assert.match(theme, /--font-ui:\s*"Instrument Sans", "Helvetica Neue", sans-serif;/);
assert.match(theme, /--color-bg-paper:\s*#121316;/);
assert.match(theme, /--color-surface:\s*#1a1c23;/);
assert.match(theme, /--color-text-main:\s*#f0f2f5;/);
assert.match(theme, /--color-accent-amber:\s*#ff9e3b;/);
assert.match(theme, /--color-coop-teal:\s*#2bb6a3;/);
assert.match(theme, /--max-text-width:\s*75ch;/);
assert.match(theme, /--border-subtle:\s*1px solid rgba\(240, 242, 245, 0\.12\);/);
assert.match(theme, /--border-strong:\s*1px solid rgba\(240, 242, 245, 0\.24\);/);
assert.match(theme, /\.bg-texture-grain\s*\{[^}]*radial-gradient/s);
assert.match(theme, /:where\(body\)\s*\{[^}]*font-family:\s*var\(--font-ui\)/s);
assert.ok(contrastRatio('#f0f2f5', '#121316') >= 4.5, 'Main text should meet WCAG AA on the paper background');
assert.ok(contrastRatio('#f0f2f5', '#1a1c23') >= 4.5, 'Main text should meet WCAG AA on surfaces');
assert.ok(contrastRatio('#1a1a1a', '#f5f5f5') >= 4.5, 'Day text should meet WCAG AA on the paper background');
assert.ok(contrastRatio('#1a1a1a', '#ffffff') >= 4.5, 'Day text should meet WCAG AA on surfaces');
assert.ok(contrastRatio('#4a4a4a', '#ffffff') >= 4.5, 'Day muted text should meet WCAG AA on surfaces');
assert.ok(contrastRatio('#ff9e3b', '#121316') >= 3, 'Night focus accent should contrast against the paper background');
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

console.log('Player editorial tests passed');
