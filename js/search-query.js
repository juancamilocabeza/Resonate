// Query parsing and Archive.org query construction for the player search.
(function (window) {
  function getSearchFilterState() {
    const st = window.state || (typeof state !== 'undefined' ? state : null);
    const ui = st && st.searchUi ? st.searchUi : {};
    const cfg = window.SEARCH_FILTERS_CONFIG || {};
    const mediatype = (ui.mediatype || cfg.mediatypeDefault || 'audio').trim() || 'audio';
    return { mediatype };
  }

  function getSearchNetworkFilterState() {
    try {
      return getSearchFilterState();
    } catch {
      return { mediatype: 'audio' };
    }
  }

  function getSearchFilterCacheKey() {
    try {
      return `m=${getSearchNetworkFilterState().mediatype}`;
    } catch {
      return 'm=audio';
    }
  }

  function getSearchFilterClauseParts(filters) {
    const f = filters || getSearchNetworkFilterState();
    return [`mediatype:${f.mediatype || 'audio'}`];
  }

  function normalizeString(value) {
    const s = typeof value === 'string' ? value : String(value ?? '');
    return s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
  }

  function tokenizeNormalized(norm) {
    const s = String(norm || '').trim();
    if (!s) return [];
    const raw = s.split(/[\s\-_/.,;:()\[\]{}"'`~!@#$%^&*+=?|\\]+/g).filter(Boolean);
    return raw.filter(token => token.length >= 2).slice(0, 8);
  }

  function extractFirstQuotedPhrase(raw) {
    try {
      const s = String(raw || '');
      const match = s.match(/"([^"]+)"/);
      if (!match) return null;
      const phrase = String(match[1] || '').trim();
      const index = typeof match.index === 'number' ? match.index : s.indexOf(match[0]);
      const remainder = (s.slice(0, index) + ' ' + s.slice(index + match[0].length))
        .replace(/\s+/g, ' ')
        .trim();
      if (!phrase) return null;
      return { phrase, remainder };
    } catch {
      return null;
    }
  }

  function parseSearchIntent(rawQuery) {
    const raw = String(rawQuery || '').trim();
    const normalized = normalizeString(raw);
    const tokens = tokenizeNormalized(normalized);
    const result = {
      raw,
      normalized,
      tokens,
      intent: 'unknown',
      artist: '',
      title: ''
    };

    if (!raw) return result;

    const artistMatch = raw.match(/^\s*(artist|band)\s*:\s*(.+)$/i);
    if (artistMatch && artistMatch[2]) {
      result.intent = 'artist';
      result.artist = String(artistMatch[2]).trim();
      return result;
    }
    const titleMatch = raw.match(/^\s*(title|song|track|album)\s*:\s*(.+)$/i);
    if (titleMatch && titleMatch[2]) {
      result.intent = 'title';
      result.title = String(titleMatch[2]).trim();
      return result;
    }

    const quoted = extractFirstQuotedPhrase(raw);
    if (quoted) {
      if (quoted.remainder) {
        result.intent = 'mixed';
        result.title = quoted.phrase;
        result.artist = quoted.remainder;
      } else {
        result.intent = 'title';
        result.title = quoted.phrase;
      }
      return result;
    }

    const byMatch = raw.match(/^(.+?)\s+by\s+(.+?)$/i);
    if (byMatch && byMatch[1] && byMatch[2]) {
      result.intent = 'mixed';
      result.title = String(byMatch[1]).trim();
      result.artist = String(byMatch[2]).trim();
      return result;
    }
    const dashMatch = raw.match(/^(.+?)\s*[\-–—]\s*(.+?)$/);
    if (dashMatch && dashMatch[1] && dashMatch[2]) {
      result.intent = 'mixed';
      result.artist = String(dashMatch[1]).trim();
      result.title = String(dashMatch[2]).trim();
      return result;
    }

    const trackHintRe = /\b(live|remix|remastered|remaster|acoustic|demo|cover|feat\.?|ft\.?|edit|version|official|single|album|lp|ep|discography|vol\.?|pt\.?|part)\b/i;
    const hasTrackHints = trackHintRe.test(raw) || /\d/.test(raw);
    if (raw.startsWith('"')) {
      result.intent = 'title';
      result.title = raw.replace(/^"+|"+$/g, '').trim();
      return result;
    }
    if (tokens.length <= 3 && !hasTrackHints) {
      result.intent = 'artist';
      result.artist = raw;
      return result;
    }
    if (hasTrackHints) {
      result.intent = 'title';
      result.title = raw;
      return result;
    }

    result.intent = tokens.length >= 5 ? 'mixed' : 'artist';
    if (result.intent === 'artist') result.artist = raw;
    return result;
  }

  function getServerSortModeForIntent(intentInfo) {
    try {
      const intent = intentInfo && typeof intentInfo === 'object' ? String(intentInfo.intent || '') : '';
      if (intent === 'artist' || intent === 'unknown' || intent === '') return 'pop';
      return 'rel';
    } catch {
      return 'rel';
    }
  }

  function getArchiveSortParam(intentInfo) {
    return getServerSortModeForIntent(intentInfo) === 'pop' ? '&sort[]=downloads+desc' : '';
  }

  function makeSolrGroupTerm(text, { phraseIfMultiWord = false } = {}) {
    const s = String(text || '').trim();
    if (!s) return '';
    const cleaned = s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!phraseIfMultiWord || !/\s/.test(cleaned)) return cleaned;
    return `"${cleaned.replace(/"/g, '\\"')}"`;
  }

  function buildOptimizedArchiveQuery(query, filters, intentInfo) {
    const q = String(query || '').trim();
    if (!q) return '';

    const intent = intentInfo || parseSearchIntent(q);
    const qTerm = makeSolrGroupTerm(q);
    let phases;

    if (intent && intent.intent === 'mixed' && intent.artist && intent.title) {
      const artistTerm = makeSolrGroupTerm(intent.artist);
      const titleTerm = makeSolrGroupTerm(intent.title, { phraseIfMultiWord: true });
      phases = [
        `(creator:(${artistTerm}) AND title:(${titleTerm}))`,
        `(title:(${titleTerm}) AND creator:(${artistTerm}))`,
        `(title:(${titleTerm}))`,
        `(creator:(${artistTerm}))`,
        `(${qTerm})`
      ];
    } else if (intent && intent.intent === 'title') {
      phases = [
        `(title:(${qTerm}))`,
        `(title:(${qTerm}) AND creator:(${qTerm}))`,
        `(creator:(${qTerm}))`,
        `(${qTerm})`
      ];
    } else if (intent && intent.intent === 'artist') {
      phases = [
        `(creator:(${qTerm}))`,
        `(title:(${qTerm}) AND creator:(${qTerm}))`,
        `(title:(${qTerm}))`,
        `(${qTerm})`
      ];
    } else {
      phases = [
        `(title:(${qTerm}) AND creator:(${qTerm}))`,
        `(title:(${qTerm}))`,
        `(creator:(${qTerm}))`,
        `(${qTerm})`
      ];
    }

    const orGroup = `(${phases.join(' OR ')})`;
    const filterParts = getSearchFilterClauseParts(filters);
    if (!filterParts.length) return orGroup;
    return `${orGroup} AND ${filterParts.map(part => `(${part})`).join(' AND ')}`;
  }

  const api = {
    getArchiveSortParam,
    getSearchFilterCacheKey,
    getSearchFilterClauseParts,
    getSearchFilterState,
    getSearchNetworkFilterState,
    getServerSortModeForIntent,
    normalizeString,
    parseSearchIntent,
    tokenizeNormalized,
    buildOptimizedArchiveQuery
  };

  window.ResonateSearchQuery = api;
  Object.assign(window, api);
})(window);
