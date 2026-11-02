import assert from 'assert/strict';
import { readFile } from 'fs/promises';
import vm from 'vm';

const root = new URL('../', import.meta.url);
const [html, css, theme, serviceWorker, displayFont, sansFont, ui] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('css/player-editorial.css', root), 'utf8'),
  readFile(new URL('styles/theme.css', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8'),
  readFile(new URL('assets/fonts/bodoni-moda-latin.woff2', root)),
  readFile(new URL('assets/fonts/instrument-sans-latin.woff2', root)),
  readFile(new URL('js/ui.js', root), 'utf8')
]);

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

assert.match(html, /class="coop-badge"[^>]*\shidden(?:\s|>)/);
assert.match(css, /\.coop-badge\[hidden\]\s*\{\s*display:\s*none;/);
assert.match(theme, /font-family:\s*"Bodoni Moda";/);
assert.match(theme, /font-family:\s*"Instrument Sans";/);
assert.match(theme, /--font-display:\s*"Bodoni Moda", Georgia, serif;/);
assert.match(theme, /--font-ui:\s*"Instrument Sans", "Helvetica Neue", sans-serif;/);
assert.match(css, /\.current-track-info \.title\s*\{[^}]*display:\s*block;[^}]*font-family:\s*var\(--font-display[^}]*text-align:\s*center;[^}]*text-align-last:\s*center;/);
assert.match(css, /\.current-track-info \.title \.title-text\s*\{[^}]*font-family:\s*var\(--font-display[^}]*text-align:\s*center;/);
assert.match(css, /\.current-track-info \.creator\s*\{[^}]*font-family:\s*var\(--font-ui[^}]*text-align:\s*center;[^}]*text-align-last:\s*center;/);
assert.match(css, /\.current-track-info \.creator #creator\s*\{[^}]*font-family:\s*var\(--font-ui[^}]*text-align:\s*center;/);
assert.equal(displayFont.toString('ascii', 0, 4), 'wOF2');
assert.equal(sansFont.toString('ascii', 0, 4), 'wOF2');
assert.match(html, /rel="preload" href="\/assets\/fonts\/bodoni-moda-latin\.woff2" as="font"/);
assert.match(serviceWorker, /'\/assets\/fonts\/bodoni-moda-latin\.woff2'/);
assert.match(serviceWorker, /'\/assets\/fonts\/instrument-sans-latin\.woff2'/);
assert.match(serviceWorker, /static-v17p14/);
const artFrameEnd = html.indexOf('</div>\n          <div class="current-track-info">');
const trackInfoStart = html.indexOf('<div class="current-track-info">');
const progressStart = html.indexOf('<div class="progress-section">');
const controlsStart = html.indexOf('<div class="controls">', trackInfoStart);
assert.ok(artFrameEnd >= 0, 'Artwork frame should close before track information');
assert.ok(progressStart > trackInfoStart, 'Progress bar should follow track information');
assert.ok(progressStart < controlsStart, 'Progress bar should precede playback controls');
assert.doesNotMatch(html.slice(html.indexOf('<div class="editorial-art-frame">'), artFrameEnd), /class="progress-section"/);
assert.doesNotMatch(css, /\.editorial-art-frame \.progress/);

console.log('Player editorial tests passed');
