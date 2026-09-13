// Unit tests for js/track-normalizer.js.
//
// track-normalizer.js is a browser script that attaches TrackNormalizer to the
// global `window` object, so tests run it in a Node context with a window stub
// and read the exported API back off of it.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(__dirname, '..', 'js', 'track-normalizer.js'), 'utf8');

let TrackNormalizer;
let restoreWindow;

before(() => {
  const prevWindow = globalThis.window;
  globalThis.window = { location: { href: 'https://example.com/path/index.html' } };
  restoreWindow = () => {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  };
  (0, eval)(source);
  TrackNormalizer = globalThis.window.TrackNormalizer;
});

after(() => {
  restoreWindow();
});

describe('canonicalizeUrl', () => {
  it('returns an empty string for falsy inputs', () => {
    assert.equal(TrackNormalizer.canonicalizeUrl(null), '');
    assert.equal(TrackNormalizer.canonicalizeUrl(undefined), '');
    assert.equal(TrackNormalizer.canonicalizeUrl(''), '');
  });

  it('resolves relative URLs against the page location', () => {
    assert.equal(
      TrackNormalizer.canonicalizeUrl('/media/file.mp3'),
      'https://example.com/media/file.mp3'
    );
  });

  it('returns absolute URLs unchanged', () => {
    assert.equal(
      TrackNormalizer.canonicalizeUrl('https://cdn.example.org/a.mp3'),
      'https://cdn.example.org/a.mp3'
    );
  });
});

describe('stripCreatorFromTitle', () => {
  it('strips a "creator - title" prefix', () => {
    assert.equal(TrackNormalizer.stripCreatorFromTitle('Sonic Youth - Teen Age Riot', 'Sonic Youth'), 'Teen Age Riot');
  });

  it('strips an em-dash prefix', () => {
    assert.equal(TrackNormalizer.stripCreatorFromTitle('Artist — Title', 'Artist'), 'Title');
  });

  it('strips a trailing "title - creator" suffix', () => {
    assert.equal(TrackNormalizer.stripCreatorFromTitle('Title - Artist', 'Artist'), 'Title');
  });

  it('handles a trailing "by creator" phrase', () => {
    assert.equal(TrackNormalizer.stripCreatorFromTitle('Wonderful Song by Great Artist', 'Great Artist'), 'Wonderful Song');
  });

  it('returns the title unchanged when the creator is not present', () => {
    assert.equal(TrackNormalizer.stripCreatorFromTitle('Something Else', 'Artist'), 'Something Else');
  });

  it('handles null/undefined title and creator', () => {
    assert.equal(TrackNormalizer.stripCreatorFromTitle(null, 'Artist'), '');
    assert.equal(TrackNormalizer.stripCreatorFromTitle(undefined, 'Artist'), '');
    assert.equal(TrackNormalizer.stripCreatorFromTitle('Title', null), 'Title');
    assert.equal(TrackNormalizer.stripCreatorFromTitle('Title', undefined), 'Title');
    assert.equal(TrackNormalizer.stripCreatorFromTitle('', ''), '');
  });

  it('keeps a trailing parenthetical "(by creator)" untouched', () => {
    assert.equal(TrackNormalizer.stripCreatorFromTitle('Title (by Artist)', 'Artist'), 'Title (by Artist)');
  });
});

describe('sanitizeDisplayTitle', () => {
  it('returns an empty string for an empty title', () => {
    assert.equal(TrackNormalizer.sanitizeDisplayTitle('', 'Artist', 'Album'), '');
  });

  it('joins album and track with an em-dash when the title is prefixed with the album', () => {
    assert.equal(TrackNormalizer.sanitizeDisplayTitle('Album - Song', 'Artist', 'Album'), 'Album — Song');
  });

  it('strips the creator entirely when there is no album title', () => {
    assert.equal(TrackNormalizer.sanitizeDisplayTitle('Artist - Song', 'Artist', ''), 'Song');
  });

  it('strips the creator from a non-album-prefixed title', () => {
    assert.equal(TrackNormalizer.sanitizeDisplayTitle('Artist - Song', 'Artist', 'Album'), 'Song');
  });
});

describe('getTrackKey', () => {
  it('prefers trackId, then url, then id', () => {
    assert.equal(TrackNormalizer.getTrackKey({ trackId: 't1', url: '/u', id: 'i1' }), 't1');
    assert.equal(TrackNormalizer.getTrackKey({ url: '/u', id: 'i1' }), '/u');
    assert.equal(TrackNormalizer.getTrackKey({ id: 'i1' }), 'i1');
  });

  it('returns an empty string for missing tracks', () => {
    assert.equal(TrackNormalizer.getTrackKey(null), '');
    assert.equal(TrackNormalizer.getTrackKey(undefined), '');
    assert.equal(TrackNormalizer.getTrackKey('not-an-object'), '');
  });
});

describe('normalizeTrack', () => {
  it('returns the input unchanged for non-objects', () => {
    assert.equal(TrackNormalizer.normalizeTrack(null), null);
    assert.equal(TrackNormalizer.normalizeTrack(undefined), undefined);
    assert.equal(TrackNormalizer.normalizeTrack('x'), 'x');
  });

  it('fills albumId, id, album, albumTitle and creator from options', () => {
    const track = TrackNormalizer.normalizeTrack(
      { title: 'Song', url: '/u' },
      { albumId: 'alb-1', albumTitle: 'Album', creator: 'Maker' }
    );
    assert.equal(track.albumId, 'alb-1');
    assert.equal(track.id, 'alb-1');
    assert.equal(track.album, 'Album');
    assert.equal(track.albumTitle, 'Album');
    assert.equal(track.creator, 'Maker');
  });

  it('strips the creator from the title', () => {
    const track = TrackNormalizer.normalizeTrack(
      { title: 'Maker - Song', url: '/u' },
      { creator: 'Maker' }
    );
    assert.equal(track.title, 'Song');
  });

  it('parses "m:ss" durations to seconds', () => {
    assert.equal(TrackNormalizer.normalizeTrack({ url: '/u', duration: '3:45' }).duration, 225);
    assert.equal(TrackNormalizer.normalizeTrack({ url: '/u', length: '1:30' }).duration, 90);
  });

  it('parses "h:mm:ss" durations to seconds', () => {
    assert.equal(TrackNormalizer.normalizeTrack({ url: '/u', duration: '1:02:03' }).duration, 3723);
  });

  it('keeps numeric durations as-is', () => {
    assert.equal(TrackNormalizer.normalizeTrack({ url: '/u', duration: 90 }).duration, 90);
  });

  it('parses plain numeric strings to numbers', () => {
    assert.equal(TrackNormalizer.normalizeTrack({ url: '/u', duration: '450' }).duration, 450);
  });

  it('ignores unknown duration strings, leaving the raw value untouched', () => {
    const track = TrackNormalizer.normalizeTrack({ url: '/u', duration: 'abc' });
    assert.equal(track.duration, 'abc');
  });

  it('generates a stable trackId when none is present', () => {
    const track = TrackNormalizer.normalizeTrack(
      { fileName: 'a.mp3', url: '/u' },
      { albumId: 'alb-1' }
    );
    assert.equal(track.trackId, 'alb-1:a.mp3');
  });

  it('does not overwrite an existing trackId', () => {
    const track = TrackNormalizer.normalizeTrack({ url: '/u', trackId: 'keep-me' });
    assert.equal(track.trackId, 'keep-me');
  });

  it('applies the supplied trackIndex and totalTracks', () => {
    const track = TrackNormalizer.normalizeTrack(
      { url: '/u' },
      { trackIndex: 2, totalTracks: 10 }
    );
    assert.equal(track.trackIndex, 2);
    assert.equal(track.totalTracks, 10);
    assert.equal(track.isAlbumTrack, true);
  });

  it('marks a single-track list as not an album track', () => {
    const track = TrackNormalizer.normalizeTrack({ url: '/u' }, {});
    assert.equal(track.isAlbumTrack, false);
  });
});

describe('normalizeTrackList', () => {
  it('returns an empty array for non-arrays', () => {
    assert.deepEqual(TrackNormalizer.normalizeTrackList(null), []);
    assert.deepEqual(TrackNormalizer.normalizeTrackList(undefined), []);
  });

  it('normalizes each track and drops tracks without a url', () => {
    const tracks = TrackNormalizer.normalizeTrackList([
      { title: 'Artist - One', url: '/1.mp3' },
      { title: 'Two' },
      { title: 'Three', url: '/3.mp3' }
    ], { creator: 'Artist' });

    assert.equal(tracks.length, 2);
    assert.equal(tracks[0].title, 'One');
    assert.equal(tracks[0].trackIndex, 0);
    assert.equal(tracks[0].totalTracks, 3);
    assert.equal(tracks[1].title, 'Three');
    assert.equal(tracks[1].trackIndex, 2);
    assert.equal(tracks[1].totalTracks, 3);
  });
});