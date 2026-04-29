/* ============================================================
   i know — Unified Storage Layer
   
   All knowledge data CRUD through chrome.storage.local.
   Data model, indexing, search, import/export.
   ============================================================ */

'use strict';

const IKnowStorage = (() => {
  const STORAGE_KEY = 'iknow_items';
  const SETTINGS_KEY = 'iknow_settings';
  const DEFERRED_KEY = 'deferred'; // tab-out compatibility

  // ── Data Model ──────────────────────────────────────────────

  /**
   * Create a new knowledge item
   * @param {Object} params
   * @returns {Object} knowledge item
   */
  function createItem({
    type = 'link',        // prompt | skill | article | screenshot | link
    subType = null,       // image_prompt | article_prompt | other_prompt
    title = '',
    content = '',
    summary = '',
    sourceUrl = '',
    sourceDomain = '',
    tags = [],
    images = [],
    readLater = false,
  }) {
    return {
      id: crypto.randomUUID(),
      type,
      subType,
      title,
      content,
      summary,
      sourceUrl,
      sourceDomain,
      tags,
      images,           // [{ dataUrl, caption, width, height }]
      readLater,
      isRead: false,
      isPinned: false,
      obsidianExported: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ── CRUD ────────────────────────────────────────────────────

  async function getAll() {
    const { [STORAGE_KEY]: items = [] } = await chrome.storage.local.get(STORAGE_KEY);
    return items;
  }

  async function getById(id) {
    const items = await getAll();
    return items.find(item => item.id === id) || null;
  }

  async function save(item) {
    const items = await getAll();
    const existingIndex = items.findIndex(i => i.id === item.id);
    
    if (existingIndex >= 0) {
      items[existingIndex] = { ...item, updatedAt: new Date().toISOString() };
    } else {
      items.unshift(item); // newest first
    }
    
    await chrome.storage.local.set({ [STORAGE_KEY]: items });
    return item;
  }

  async function saveNew(params) {
    const item = createItem(params);
    await save(item);
    return item;
  }

  async function update(id, updates) {
    const items = await getAll();
    const index = items.findIndex(i => i.id === id);
    if (index < 0) return null;
    
    items[index] = { 
      ...items[index], 
      ...updates, 
      updatedAt: new Date().toISOString() 
    };
    
    await chrome.storage.local.set({ [STORAGE_KEY]: items });
    return items[index];
  }

  async function remove(id) {
    const items = await getAll();
    const filtered = items.filter(i => i.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
  }

  async function removeBatch(ids) {
    const idSet = new Set(ids);
    const items = await getAll();
    const filtered = items.filter(i => !idSet.has(i.id));
    await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
  }

  // ── Query & Filter ─────────────────────────────────────────

  async function getByType(type) {
    const items = await getAll();
    return items.filter(i => i.type === type);
  }

  async function getBySubType(subType) {
    const items = await getAll();
    return items.filter(i => i.subType === subType);
  }

  async function getReadLater() {
    const items = await getAll();
    return items.filter(i => i.readLater && !i.isRead);
  }

  async function getUnread() {
    const items = await getAll();
    return items.filter(i => !i.isRead);
  }

  async function getPinned() {
    const items = await getAll();
    return items.filter(i => i.isPinned);
  }

  async function search(query) {
    if (!query || !query.trim()) return getAll();
    
    const q = query.toLowerCase().trim();
    const items = await getAll();
    
    return items.filter(item => {
      return (
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.content && item.content.toLowerCase().includes(q)) ||
        (item.summary && item.summary.toLowerCase().includes(q)) ||
        (item.sourceUrl && item.sourceUrl.toLowerCase().includes(q)) ||
        (item.tags && item.tags.some(tag => tag.toLowerCase().includes(q)))
      );
    });
  }

  async function getStats() {
    const items = await getAll();
    const stats = {
      total: items.length,
      byType: {},
      readLater: 0,
      unread: 0,
      pinned: 0,
      recentCount: 0, // last 24h
    };

    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    
    for (const item of items) {
      stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;
      if (item.readLater && !item.isRead) stats.readLater++;
      if (!item.isRead) stats.unread++;
      if (item.isPinned) stats.pinned++;
      if (item.createdAt > oneDayAgo) stats.recentCount++;
    }

    return stats;
  }

  // ── Toggle helpers ─────────────────────────────────────────

  async function togglePin(id) {
    const item = await getById(id);
    if (!item) return null;
    return update(id, { isPinned: !item.isPinned });
  }

  async function toggleRead(id) {
    const item = await getById(id);
    if (!item) return null;
    return update(id, { isRead: !item.isRead });
  }

  async function toggleReadLater(id) {
    const item = await getById(id);
    if (!item) return null;
    return update(id, { readLater: !item.readLater });
  }

  async function markAsRead(id) {
    return update(id, { isRead: true });
  }

  async function markExported(id) {
    return update(id, { obsidianExported: true });
  }

  // ── Import / Export ────────────────────────────────────────

  async function exportAll() {
    const items = await getAll();
    const settings = await getSettings();
    return JSON.stringify({ items, settings, exportedAt: new Date().toISOString() }, null, 2);
  }

  async function importAll(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (data.items && Array.isArray(data.items)) {
        const existing = await getAll();
        const existingIds = new Set(existing.map(i => i.id));
        const newItems = data.items.filter(i => !existingIds.has(i.id));
        const merged = [...newItems, ...existing];
        await chrome.storage.local.set({ [STORAGE_KEY]: merged });
        return { imported: newItems.length, skipped: data.items.length - newItems.length };
      }
      return { imported: 0, skipped: 0 };
    } catch (e) {
      throw new Error('Invalid JSON format');
    }
  }

  // ── Settings ───────────────────────────────────────────────

  const DEFAULT_SETTINGS = {
    obsidianVaultName: '',
    obsidianInboxFolder: 'inbox',
    geminiApiKey: '', // Legacy
    aiProvider: 'gemini',
    aiApiKey: '',
    theme: 'dark',
    floatingButtonEnabled: true,
    selectionMenuEnabled: true,
    autoSummary: false,
    promptCategories: ['image_prompt', 'article_prompt', 'other_prompt'],
    customTags: [],
  };

  async function getSettings() {
    const { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
    const finalSettings = { ...DEFAULT_SETTINGS, ...settings };
    
    // Migrate legacy geminiApiKey to new aiApiKey format if empty
    if (finalSettings.geminiApiKey && !finalSettings.aiApiKey && finalSettings.aiProvider === 'gemini') {
      finalSettings.aiApiKey = finalSettings.geminiApiKey;
    }
    
    return finalSettings;
  }

  async function updateSettings(updates) {
    const current = await getSettings();
    const newSettings = { ...current, ...updates };
    await chrome.storage.local.set({ [SETTINGS_KEY]: newSettings });
    return newSettings;
  }

  // ── Tab-Out Compatible: Saved for Later ────────────────────

  async function getDeferredTabs() {
    const items = await getAll();
    const active = items.filter(i => i.readLater && !i.isRead).map(i => ({
      id: i.id, url: i.sourceUrl, title: i.title, savedAt: i.createdAt
    }));
    const archived = items.filter(i => i.readLater && i.isRead).map(i => ({
      id: i.id, url: i.sourceUrl, title: i.title, completedAt: i.updatedAt
    })).sort((a,b) => new Date(b.completedAt) - new Date(a.completedAt)).slice(0, 50);
    return { active, archived };
  }

  async function saveTabForLater(tab) {
    const items = await getAll();
    const item = {
      id: Date.now().toString(),
      type: 'link',
      title: tab.title || tab.url,
      sourceUrl: tab.url,
      sourceDomain: tab.url ? new URL(tab.url).hostname.replace('www.', '') : '',
      readLater: true,
      isRead: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    items.unshift(item);
    await chrome.storage.local.set({ [STORAGE_KEY]: items });
  }

  async function checkOffDeferredTab(id) {
    await markAsRead(id);
  }

  async function dismissDeferredTab(id) {
    await remove(id);
  }

  // ── Public API ─────────────────────────────────────────────

  return {
    createItem,
    getAll,
    getById,
    save,
    saveNew,
    update,
    remove,
    removeBatch,
    getByType,
    getBySubType,
    getReadLater,
    getUnread,
    getPinned,
    search,
    getStats,
    togglePin,
    toggleRead,
    toggleReadLater,
    markAsRead,
    markExported,
    exportAll,
    importAll,
    getSettings,
    updateSettings,
    // Tab-Out compat
    getDeferredTabs,
    saveTabForLater,
    checkOffDeferredTab,
    dismissDeferredTab,
  };
})();
