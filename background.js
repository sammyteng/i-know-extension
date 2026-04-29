/* ============================================================
   i know — Background Service Worker
   Badge + context menus + screenshot + message routing
   ============================================================ */
'use strict';

// ── Badge ────────────────────────────────────────────────────
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});
    const count = tabs.filter(t => {
      const url = t.url || '';
      return !url.startsWith('chrome://') &&
             !url.startsWith('chrome-extension://') &&
             !url.startsWith('about:') &&
             !url.startsWith('edge://');
    }).length;

    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    if (!count) return;

    const color = count <= 10 ? '#6c5ce7' : count <= 20 ? '#fdcb6e' : '#ff7675';
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Context Menus ────────────────────────────────────────────
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'iknow-save-selection',
      title: '💾 保存选中文本到 i know',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'iknow-save-as-prompt',
      title: '✏️ 保存为提示词',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'iknow-save-image',
      title: '🖼️ 保存图片到 i know',
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: 'iknow-save-page',
      title: '📰 保存当前页面',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'iknow-screenshot',
      title: '📷 截取当前页面',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'iknow-read-later',
      title: '📚 稍后阅读',
      contexts: ['page', 'link'],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {

    case 'iknow-save-selection':
      await saveToStorage({
        type: 'link',
        title: info.selectionText.slice(0, 80),
        content: info.selectionText,
        sourceUrl: tab.url,
        sourceDomain: extractDomain(tab.url),
      });
      notifyTab(tab.id, 'ITEM_SAVED');
      break;

    case 'iknow-save-as-prompt':
      await saveToStorage({
        type: 'prompt',
        subType: 'other_prompt',
        title: info.selectionText.slice(0, 80),
        content: info.selectionText,
        sourceUrl: tab.url,
        sourceDomain: extractDomain(tab.url),
      });
      notifyTab(tab.id, 'ITEM_SAVED');
      break;

    case 'iknow-save-image':
      await saveToStorage({
        type: 'screenshot',
        title: `图片 — ${extractDomain(tab.url)}`,
        content: '',
        images: [{ dataUrl: info.srcUrl, caption: tab.title }],
        sourceUrl: tab.url,
        sourceDomain: extractDomain(tab.url),
      });
      notifyTab(tab.id, 'ITEM_SAVED');
      break;

    case 'iknow-save-page':
      // Ask content script to extract full page content
      chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PAGE' }, async (res) => {
        if (chrome.runtime.lastError || !res) {
          await saveToStorage({
            type: 'article',
            title: tab.title || tab.url,
            content: '',
            sourceUrl: tab.url,
            sourceDomain: extractDomain(tab.url),
          });
        } else {
          await saveToStorage({
            type: 'article',
            title: res.title || tab.title,
            content: res.content,
            summary: res.description || '',
            sourceUrl: tab.url,
            sourceDomain: extractDomain(tab.url),
          });
        }
        notifyTab(tab.id, 'ITEM_SAVED');
      });
      break;

    case 'iknow-screenshot': {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      await saveToStorage({
        type: 'screenshot',
        title: `截图 — ${tab.title || tab.url}`,
        content: '',
        images: [{ dataUrl, caption: tab.title }],
        sourceUrl: tab.url,
        sourceDomain: extractDomain(tab.url),
      });
      notifyTab(tab.id, 'ITEM_SAVED');
      break;
    }

    case 'iknow-read-later':
      await saveToStorage({
        type: 'link',
        title: tab.title || info.linkUrl || tab.url,
        content: '',
        sourceUrl: info.linkUrl || tab.url,
        sourceDomain: extractDomain(info.linkUrl || tab.url),
        readLater: true,
      });
      notifyTab(tab.id, 'ITEM_SAVED');
      break;
  }
});

// ── Message Handler (from content script / sidepanel) ────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SAVE_ITEM') {
    saveToStorage(msg.data).then(item => sendResponse({ success: true, item }));
    return true; // keep async
  }
  if (msg.type === 'TAKE_SCREENSHOT') {
    chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: 'png' })
      .then(dataUrl => sendResponse({ dataUrl }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GET_SETTINGS') {
    chrome.storage.local.get('iknow_settings').then(result => {
      sendResponse(result.iknow_settings || {});
    });
    return true;
  }
  if (msg.type === 'OPEN_SIDEPANEL') {
    chrome.sidePanel.open({ tabId: sender.tab?.id }).catch(() => {});
  }

  // ── Obsidian REST API proxy (content scripts can't fetch localhost due to CSP)
  if (msg.type === 'OBSIDIAN_APPEND') {
    (async () => {
      const { line, folder, apiKey } = msg;
      const boxFile = `${(folder || '00 inbox').replace(/\/$/, '')}/iknow收集箱.md`;
      const encodedPath = boxFile.split('/').map(s => encodeURIComponent(s)).join('/');
      const headers = { 'Content-Type': 'text/markdown; charset=utf-8' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      try {
        let res = await fetch(`http://localhost:27123/vault/${encodedPath}`, {
          method: 'POST', headers, body: line,
          signal: AbortSignal.timeout(3000),
        });
        if (res.status === 404) {
          res = await fetch(`http://localhost:27123/vault/${encodedPath}`, {
            method: 'PUT', headers, body: line,
            signal: AbortSignal.timeout(3000),
          });
        }
        if (res.ok || res.status === 204) {
          sendResponse({ success: true, method: 'rest-api' });
        } else {
          sendResponse({ success: false, error: `HTTP ${res.status}` });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true; // async
  }

  // ── Translate using Gemini API ─────────────────────────────────
  if (msg.type === 'TRANSLATE') {
    (async () => {
      const { text, apiKey } = msg;
      if (!apiKey) {
        sendResponse({ success: false, error: '未配置 Gemini API Key' });
        return;
      }
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        const prompt = `Translate the following text to simplified Chinese. Only output the translated text without any explanation, markdown formatting, or quotes:\n\n${text}`;
        
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3 }
          }),
          signal: AbortSignal.timeout(10000)
        });
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (translatedText) {
          sendResponse({ success: true, text: translatedText.trim() });
        } else {
          sendResponse({ success: false, error: 'API 返回格式异常' });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});

// ── Storage helper (same key as storage.js) ──────────────────
async function saveToStorage(params) {
  const item = {
    id: crypto.randomUUID(),
    type: params.type || 'link',
    subType: params.subType || null,
    title: params.title || '未命名',
    content: params.content || '',
    summary: params.summary || '',
    sourceUrl: params.sourceUrl || '',
    sourceDomain: params.sourceDomain || '',
    tags: params.tags || [],
    images: params.images || [],
    readLater: params.readLater || false,
    isRead: false,
    isPinned: false,
    obsidianExported: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const { iknow_items: items = [] } = await chrome.storage.local.get('iknow_items');
  items.unshift(item);
  await chrome.storage.local.set({ iknow_items: items });
  return item;
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function notifyTab(tabId, type) {
  chrome.tabs.sendMessage(tabId, { type }).catch(() => {});
}

// ── Action click → open side panel ───────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

// ── Lifecycle ────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
  setupContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  setupContextMenus();
});

chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);
chrome.tabs.onUpdated.addListener(updateBadge);

updateBadge();
setupContextMenus();
