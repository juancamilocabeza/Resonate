// Search history management
// Provides storage, retrieval, and manipulation of recent search history.
// History entries are stored in localStorage as {query, timestamp} objects.
// Handles migration from the old plain-string format transparently.

const SEARCH_HISTORY_KEY = 'resonate_search_history';
const SEARCH_HISTORY_MAX_ITEMS = 20;

function loadSearchHistory() {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed.map(item => {
      if (item && typeof item === 'object' && typeof item.query === 'string') {
        return { query: item.query, timestamp: item.timestamp || 0 };
      }
      // Migrate old plain-string entries
      if (typeof item === 'string' && item.trim()) {
        return { query: item.trim(), timestamp: 0 };
      }
      return null;
    }).filter(Boolean);
    return normalized;
  } catch (e) {
    window.logger?.warn(`Error loading search history: ${e.message}`, 'SEARCH_HISTORY');
    return [];
  }
}

function saveSearchHistory(history) {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    window.logger?.warn(`Error saving search history: ${e.message}`, 'SEARCH_HISTORY');
  }
}

function addToSearchHistory(query) {
  if (!query || !query.trim()) return;

  const history = loadSearchHistory();
  const trimmedQuery = query.trim();

  // Remove any existing entry with the same query (to move it to the front)
  const filtered = history.filter(item => item.query !== trimmedQuery);

  // Add to beginning with current timestamp, limit to max items
  filtered.unshift({ query: trimmedQuery, timestamp: Date.now() });
  const limited = filtered.slice(0, SEARCH_HISTORY_MAX_ITEMS);

  saveSearchHistory(limited);
}

function clearSearchHistory() {
  saveSearchHistory([]);
}

function removeFromSearchHistory(index) {
  const history = loadSearchHistory();
  if (index >= 0 && index < history.length) {
    history.splice(index, 1);
    saveSearchHistory(history);
  }
}

// Returns a human-readable relative time label for a timestamp.
function formatSearchHistoryTime(timestamp) {
  if (!timestamp) return '';
  try {
    const now = Date.now();
    const diffMs = now - timestamp;
    if (diffMs < 0) return '';
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD === 1) return 'Yesterday';
    if (diffD < 7) return `${diffD}d ago`;
    return '';
  } catch {
    return '';
  }
}

window.loadSearchHistory = loadSearchHistory;
window.saveSearchHistory = saveSearchHistory;
window.addToSearchHistory = addToSearchHistory;
window.clearSearchHistory = clearSearchHistory;
window.removeFromSearchHistory = removeFromSearchHistory;
window.formatSearchHistoryTime = formatSearchHistoryTime;
