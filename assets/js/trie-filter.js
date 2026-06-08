// assets/js/trie-filter.js
// v20: 敏感词 Trie 树过滤器 — 前端 & 后端共用逻辑

/**
 * 构建 Trie 节点
 */
function TrieNode() {
  this.children = {};
  this.isEnd = false;
  this.word = null;
}

/**
 * 从词数组构建 Trie 树
 * @param {string[]} words
 * @returns {TrieNode} 根节点
 */
function buildTrie(words) {
  const root = new TrieNode();
  let count = 0;
  for (const word of words) {
    if (!word || word.length === 0) continue;
    let node = root;
    const lower = word.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
      const ch = lower[i];
      if (!node.children[ch]) {
        node.children[ch] = new TrieNode();
      }
      node = node.children[ch];
    }
    node.isEnd = true;
    node.word = word; // keep original casing
    count++;
  }
  console.log('[TrieFilter] Built trie with ' + count + ' words');
  return root;
}

/**
 * 检测文本中是否包含任何敏感词（early exit）
 * @param {string} text
 * @param {TrieNode} trieRoot
 * @returns {boolean}
 */
function hasSensitive(text, trieRoot) {
  if (!text || !trieRoot) return false;
  const lower = text.toLowerCase();
  const n = lower.length;

  for (let i = 0; i < n; i++) {
    let node = trieRoot;
    for (let j = i; j < n; j++) {
      const ch = lower[j];
      if (!node.children[ch]) break;
      node = node.children[ch];
      if (node.isEnd) return true;
    }
  }
  return false;
}

/**
 * 查找文本中所有敏感词位置
 * @param {string} text
 * @param {TrieNode} trieRoot
 * @returns {{start: number, end: number, word: string}[]}
 */
function findAll(text, trieRoot) {
  const results = [];
  if (!text || !trieRoot) return results;

  const lower = text.toLowerCase();
  const n = lower.length;

  for (let i = 0; i < n; i++) {
    let node = trieRoot;
    for (let j = i; j < n; j++) {
      const ch = lower[j];
      if (!node.children[ch]) break;
      node = node.children[ch];
      if (node.isEnd) {
        results.push({ start: i, end: j + 1, word: node.word });
        // Don't break — longer matches might exist (e.g. "反动" vs "反动派")
      }
    }
  }

  // Merge overlapping matches: keep the longest
  return mergeOverlapping(results);
}

function mergeOverlapping(matches) {
  if (matches.length <= 1) return matches;
  // Sort by start, then longest first
  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  const merged = [];
  let current = matches[0];
  for (let i = 1; i < matches.length; i++) {
    const m = matches[i];
    if (m.start < current.end) {
      // Overlapping: keep the longer one
      if (m.end - m.start > current.end - current.start) {
        current = m;
      }
    } else {
      merged.push(current);
      current = m;
    }
  }
  merged.push(current);
  return merged;
}

/**
 * 过滤文本中的敏感词，替换为 replacement 字符
 * @param {string} text
 * @param {TrieNode} trieRoot
 * @param {string} replacement
 * @returns {string}
 */
function filterText(text, trieRoot, replacement) {
  if (!text || !trieRoot) return text || '';
  const rep = replacement || '*';
  const matches = findAll(text, trieRoot);
  if (matches.length === 0) return text;

  // Build result with replacements
  let result = '';
  let lastEnd = 0;
  for (const m of matches) {
    result += text.slice(lastEnd, m.start);
    result += rep.repeat(m.end - m.start);
    lastEnd = m.end;
  }
  result += text.slice(lastEnd);
  return result;
}

// ============================================
// 全局词库加载 & 接口
// ============================================

const trieFilter = {
  _root: null,
  _ready: false,
  _loading: false,
  _loadPromise: null,

  /**
   * 从指定 URL 异步加载词库并构建 Trie
   * @param {string} url — 词库文件路径
   * @returns {Promise<void>}
   */
  async loadFromURL(url) {
    if (this._ready) return;
    if (this._loading) return this._loadPromise;

    this._loading = true;
    this._loadPromise = this._doLoadFromURL(url);
    return this._loadPromise;
  },

  async _doLoadFromURL(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      const words = text.split('\n')
        .map(w => w.trim())
        .filter(w => w.length > 0 && w.length <= 50);

      const start = performance.now();
      this._root = buildTrie(words);
      const elapsed = (performance.now() - start).toFixed(0);
      this._wordCount = words.length;
      console.log('[TrieFilter] Loaded ' + words.length + ' words from ' + url + ' in ' + elapsed + 'ms');
      this._ready = true;
    } catch (e) {
      console.error('[TrieFilter] Failed to load word list from ' + url + ':', e.message);
      this._ready = false;
    } finally {
      this._loading = false;
    }
  },

  /** 检测是否包含敏感词 */
  hasSensitive(text) {
    if (!this._ready || !this._root) return false;
    return hasSensitive(text, this._root);
  },

  /** 查找所有敏感词 */
  findAll(text) {
    if (!this._ready || !this._root) return [];
    return findAll(text, this._root);
  },

  /** 过滤敏感词 */
  filter(text, replacement) {
    if (!this._ready || !this._root) return text || '';
    return filterText(text, this._root, replacement);
  },

  /** 词库是否就绪 */
  isReady() {
    return this._ready;
  },

  /** 获取词总数 */
  wordCount() {
    return this._wordCount || 0;
  }
};

// Expose globally (call trieFilter.loadFromURL('/sensitive-words/merged.txt') to init)
window.trieFilter = trieFilter;

// ============================================
// Node.js / Worker export (for backend use)
// ============================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTrie, hasSensitive, findAll, filterText, TrieNode };
}
