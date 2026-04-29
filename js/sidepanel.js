/* ============================================================
   i know — Side Panel Logic v2
   三栏：提示词库 / 待阅读 / 收藏夹
   ============================================================ */
'use strict';

// ── State ────────────────────────────────────────────────────
let allPrompts   = [];
let allReadLater = [];
let allFavorites = [];
let activeTab    = 'prompts';
let promptFilter = 'all';
let promptSearch = '';

// ── Init ─────────────────────────────────────────────────────
(async function init() {
  setupTabs();
  setupPromptFilters();
  setupSearch();
  setupObsidianBtn();
  setupSettings();
  await loadAll();

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.iknow_items) loadAll();
  });
})();

// ── Load data ────────────────────────────────────────────────
async function loadAll() {
  try {
    const { iknow_items: items = [] } = await chrome.storage.local.get('iknow_items');
    allPrompts   = items.filter(i => i.type === 'prompt');
    allReadLater = items.filter(i => i.readLater && !i.isRead);
    allFavorites = items.filter(i => i.isPinned);
    renderPrompts();
    renderReadLater();
    renderFavorites();
    updateReadLaterBadge();
  } catch (e) {
    console.error('[i know sidepanel] loadAll error', e);
  }
}

// ── Tab switching ─────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.sp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sp-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sp-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      const panel = document.getElementById('panel' + capitalize(activeTab));
      panel?.classList.add('active');
    });
  });
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Prompt filters ────────────────────────────────────────────
function setupPromptFilters() {
  document.querySelectorAll('.sp-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sp-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      promptFilter = btn.dataset.subtype;
      renderPrompts();
    });
  });
}

function setupSearch() {
  document.getElementById('promptSearch')?.addEventListener('input', e => {
    promptSearch = e.target.value.toLowerCase().trim();
    renderPrompts();
  });
}

// ── Render: Prompt List ───────────────────────────────────────
function renderPrompts() {
  const list = document.getElementById('promptList');

  let items = allPrompts;
  if (promptFilter !== 'all') {
    items = items.filter(i => i.subType === promptFilter);
  }
  if (promptSearch) {
    items = items.filter(i =>
      (i.title || '').toLowerCase().includes(promptSearch) ||
      (i.content || '').toLowerCase().includes(promptSearch)
    );
  }

  if (!items.length) {
    list.innerHTML = `<div class="sp-empty">暂无提示词<br><small>在浮窗中点「存提示词」添加</small></div>`;
    return;
  }

  const SUBTYPE_LABELS = {
    image_prompt:   '图片', article_prompt: '文章', other_prompt: '通用',
  };

  list.innerHTML = items.map(item => {
    const subtype = item.subType || 'other_prompt';
    const label   = SUBTYPE_LABELS[subtype] || '通用';
    const preview = (item.content || '').replace(/\s+/g, ' ').slice(0, 90);
    const time    = timeAgo(item.createdAt);
    return `
      <div class="sp-prompt-card" data-id="${item.id}">
        <div class="sp-prompt-head">
          <div class="sp-prompt-title">${esc(item.title || '未命名')}</div>
          <span class="sp-type-badge ${subtype}">${label}</span>
        </div>
        ${preview ? `<div class="sp-prompt-preview">${esc(preview)}</div>` : ''}
        <div class="sp-prompt-footer">
          <span class="sp-prompt-time">${time}</span>
          <button class="sp-copy-btn" data-id="${item.id}" data-content="${esc(item.content || '')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            复制
          </button>
        </div>
      </div>`;
  }).join('');

  // Copy buttons
  list.querySelectorAll('.sp-copy-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const content = btn.dataset.content || '';
      const ok = await copyText(content);
      if (ok) {
        btn.classList.add('copied');
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> 已复制`;
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> 复制`;
        }, 1800);
      } else {
        toast('复制失败');
      }
    });
  });
}

// ── Render: Read Later ────────────────────────────────────────
function renderReadLater() {
  const list = document.getElementById('readLaterList');

  if (!allReadLater.length) {
    list.innerHTML = `
      <div class="sp-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        收件箱清零 🎉
      </div>`;
    return;
  }

  list.innerHTML = allReadLater.map(item => {
    const domain  = item.sourceDomain || '';
    const favicon = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';
    const time    = timeAgo(item.createdAt);
    const url     = item.sourceUrl || '#';
    return `
      <a class="sp-rl-item" href="${esc(url)}" target="_blank" rel="noopener" data-id="${item.id}">
        ${favicon ? `<img class="sp-rl-favicon" src="${favicon}" alt="" onerror="this.style.display='none'">` : ''}
        <div class="sp-rl-body">
          <div class="sp-rl-title">${esc(item.title || url)}</div>
          <div class="sp-rl-meta">
            <span class="sp-rl-domain">${esc(domain)}</span>
            <span>·</span>
            <span>${time}</span>
          </div>
        </div>
        <div class="sp-rl-actions" onclick="event.preventDefault();event.stopPropagation()">
          <button class="sp-icon-btn pin" data-id="${item.id}" title="${item.isPinned ? '取消收藏' : '加入收藏'}" style="${item.isPinned ? 'color:#c8713a' : ''}">
            <svg viewBox="0 0 24 24" fill="${item.isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
          <button class="sp-icon-btn done" data-id="${item.id}" title="标记已读">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button class="sp-icon-btn del" data-id="${item.id}" title="删除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </a>`;
  }).join('');

  // Pin / favorite
  list.querySelectorAll('.sp-icon-btn.pin').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const item = allReadLater.find(i => i.id === btn.dataset.id);
      if (!item) return;
      const isPinned = !item.isPinned;
      await updateItem(btn.dataset.id, { isPinned });
      toast(isPinned ? '★ 已加入收藏夹' : '取消收藏');
      await loadAll();
    });
  });

  // Mark read
  list.querySelectorAll('.sp-icon-btn.done').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      await updateItem(btn.dataset.id, { isRead: true, readLater: false });
      await loadAll();
      toast('已标记已读 ✓');
    });
  });

  // Delete
  list.querySelectorAll('.sp-icon-btn.del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      await deleteItem(btn.dataset.id);
      await loadAll();
    });
  });
}

// ── Render: Favorites ─────────────────────────────────────────
function renderFavorites() {
  const list = document.getElementById('favoritesList');

  if (!allFavorites.length) {
    list.innerHTML = `
      <div class="sp-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        还没有收藏<br><small>在知识库中点 ★ 收藏</small>
      </div>`;
    return;
  }

  const TYPE_LABELS = {
    article: '文章', prompt: '提示词', skill: 'Skill',
    screenshot: '截图', link: '链接',
  };

  list.innerHTML = allFavorites.map(item => {
    const typeLabel = TYPE_LABELS[item.type] || item.type;
    const source    = item.sourceDomain || '';
    const time      = timeAgo(item.createdAt);
    const url       = item.sourceUrl || '#';
    return `
      <div class="sp-fav-card" data-id="${item.id}">
        <div class="sp-fav-head">
          <a class="sp-fav-title" href="${esc(url)}" target="_blank" rel="noopener" title="点击打开原页面">${esc(item.title || '未命名')}</a>
          <span class="sp-type-badge other_prompt">${typeLabel}</span>
        </div>
        ${item.content ? `<div class="sp-prompt-preview">${esc((item.content || '').replace(/\\s+/g,' ').slice(0, 80))}</div>` : ''}
        <div class="sp-fav-footer">
          <a class="sp-fav-source" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(url)}">
            ${source ? esc(source) : '打开 ↗'}
          </a>
          <button class="sp-unpin-btn" data-id="${item.id}">取消收藏</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.sp-unpin-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await updateItem(btn.dataset.id, { isPinned: false });
      await loadAll();
      toast('已取消收藏');
    });
  });
}

// ── Badge ─────────────────────────────────────────────────────
function updateReadLaterBadge() {
  const badge = document.getElementById('readLaterBadge');
  if (!badge) return;
  if (allReadLater.length > 0) {
    badge.textContent = allReadLater.length > 99 ? '99+' : allReadLater.length;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

// ── Obsidian Quick Save (with setup wizard) ───────────────────
function setupObsidianBtn() {
  const btn = document.getElementById('spBtnObsidian');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    // Check if Obsidian is configured
    const { iknow_settings: s = {} } = await chrome.storage.local.get('iknow_settings');
    if (!s.obsidianVaultName) {
      // Show setup wizard
      document.getElementById('obsidianSetupPanel').style.display = 'block';
      return;
    }
    await doObsidianSave(btn);
  });

  // Setup panel Save button
  document.getElementById('btnSetupSave')?.addEventListener('click', async () => {
    const vault = document.getElementById('setupVaultName')?.value.trim();
    if (!vault) { toast('请输入 Vault 名称'); return; }
    const inbox = document.getElementById('setupInboxFolder')?.value.trim() || 'inbox';
    const apiKey = document.getElementById('setupApiKey')?.value.trim() || '';

    const { iknow_settings: existing = {} } = await chrome.storage.local.get('iknow_settings');
    await chrome.storage.local.set({
      iknow_settings: { ...existing, obsidianVaultName: vault, obsidianInboxFolder: inbox, obsidianRestApiKey: apiKey }
    });
    document.getElementById('obsidianSetupPanel').style.display = 'none';
    toast('✓ Obsidian 配置已保存');
    await doObsidianSave(btn);
  });

  document.getElementById('btnSetupSkip')?.addEventListener('click', () => {
    document.getElementById('obsidianSetupPanel').style.display = 'none';
  });

  // Batch mode
  setupBatchMode();
}

async function doObsidianSave(btn) {
  btn.classList.add('loading');
  btn.textContent = '发送中...';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { toast('无法获取当前页面'); return; }

    const result = await IKnowObsidian.appendToInbox({
      title:        tab.title || tab.url,
      sourceUrl:    tab.url,
      sourceDomain: tab.url ? new URL(tab.url).hostname.replace('www.', '') : '',
    });

    if (result.success) {
      if (result.method === 'clipboard') {
        toast('⚠️ REST API 未连接，已复制到剪贴板');
      } else {
        toast('✓ 已存入 Obsidian 收集箱');
      }
    } else {
      toast('❌ ' + (result.error || '发送失败'));
    }
  } catch (e) {
    toast('错误: ' + e.message);
  } finally {
    btn.classList.remove('loading');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg> 存 Obsidian`;
  }
}

// ── Batch Export Mode ─────────────────────────────────────────
let batchMode = false;
let batchSelected = new Set();

function setupBatchMode() {
  document.getElementById('spBtnBatch')?.addEventListener('click', () => {
    enterBatchMode();
  });

  document.getElementById('btnBatchCancel')?.addEventListener('click', () => {
    exitBatchMode();
  });

  document.getElementById('batchSelectAll')?.addEventListener('change', e => {
    const checks = document.querySelectorAll('.sp-batch-check');
    checks.forEach(c => { c.checked = e.target.checked; });
    batchSelected.clear();
    if (e.target.checked) {
      checks.forEach(c => batchSelected.add(c.dataset.id));
    }
    updateBatchCount();
  });

  document.getElementById('btnBatchExport')?.addEventListener('click', async () => {
    if (!batchSelected.size) { toast('请先选择条目'); return; }
    const btn = document.getElementById('btnBatchExport');
    btn.textContent = '导出中...';
    btn.disabled = true;

    const { iknow_items: items = [] } = await chrome.storage.local.get('iknow_items');
    let ok = 0, fail = 0;

    for (const id of batchSelected) {
      const item = items.find(i => i.id === id);
      if (!item) continue;
      try {
        const r = await IKnowObsidian.appendToInbox({
          title: item.title || '未命名',
          content: item.content || '',
          sourceUrl: item.sourceUrl || '',
          sourceDomain: item.sourceDomain || '',
        });
        if (r.success) ok++; else fail++;
      } catch { fail++; }
    }

    toast(`✓ 成功 ${ok} 项${fail ? `，失败 ${fail} 项` : ''}`);
    btn.textContent = '📤 批量存 Obsidian';
    btn.disabled = false;
    exitBatchMode();
  });
}

function enterBatchMode() {
  batchMode = true;
  batchSelected.clear();
  document.getElementById('batchToolbar').style.display = 'flex';
  // Add checkboxes to read-later and favorites items
  addBatchCheckboxes();
  updateBatchCount();
}

function exitBatchMode() {
  batchMode = false;
  batchSelected.clear();
  document.getElementById('batchToolbar').style.display = 'none';
  document.getElementById('batchSelectAll').checked = false;
  // Remove checkboxes
  document.querySelectorAll('.sp-batch-check').forEach(c => c.remove());
}

function addBatchCheckboxes() {
  // Remove existing
  document.querySelectorAll('.sp-batch-check').forEach(c => c.remove());

  // Add to readlater items
  document.querySelectorAll('.sp-rl-item').forEach(item => {
    const id = item.dataset.id;
    if (!id) return;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'sp-batch-check';
    cb.dataset.id = id;
    cb.addEventListener('change', () => {
      if (cb.checked) batchSelected.add(id); else batchSelected.delete(id);
      updateBatchCount();
    });
    item.insertBefore(cb, item.firstChild);
  });

  // Add to favorites items
  document.querySelectorAll('.sp-fav-card').forEach(card => {
    const id = card.dataset.id;
    if (!id) return;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'sp-batch-check';
    cb.dataset.id = id;
    cb.addEventListener('change', () => {
      if (cb.checked) batchSelected.add(id); else batchSelected.delete(id);
      updateBatchCount();
    });
    card.insertBefore(cb, card.firstChild);
  });
}

function updateBatchCount() {
  const el = document.getElementById('batchCount');
  if (el) el.textContent = `已选 ${batchSelected.size} 项`;
}


// ── Storage helpers ───────────────────────────────────────────
async function updateItem(id, patch) {
  const { iknow_items: items = [] } = await chrome.storage.local.get('iknow_items');
  const idx = items.findIndex(i => i.id === id);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...patch, updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ iknow_items: items });
  }
}

async function deleteItem(id) {
  const { iknow_items: items = [] } = await chrome.storage.local.get('iknow_items');
  await chrome.storage.local.set({ iknow_items: items.filter(i => i.id !== id) });
}

// ── Utils ─────────────────────────────────────────────────────
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  try {
    const el = Object.assign(document.createElement('textarea'), {
      value: text,
      style: 'position:fixed;top:-9999px;opacity:0',
    });
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  } catch { return false; }
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return '刚刚';
  if (m < 60) return `${m}分钟前`;
  if (h < 24) return `${h}小时前`;
  if (d === 1) return '昨天';
  return `${d}天前`;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('spToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ── Settings ──────────────────────────────────────────────────
function setupSettings() {
  const providerSelect = document.getElementById('settingAiProvider');
  const keyInput = document.getElementById('settingAiKey');
  const saveBtn = document.getElementById('btnSaveAiSettings');

  // Load existing settings
  chrome.storage.local.get('iknow_settings').then(res => {
    const s = res.iknow_settings || {};
    if (s.aiProvider) providerSelect.value = s.aiProvider;
    if (s.aiApiKey) keyInput.value = s.aiApiKey;
    else if (s.geminiApiKey) {
      keyInput.value = s.geminiApiKey; // fallback load
      providerSelect.value = 'gemini';
    }
  });

  saveBtn?.addEventListener('click', async () => {
    const provider = providerSelect.value;
    const apiKey = keyInput.value.trim();
    
    saveBtn.textContent = '保存中...';
    saveBtn.disabled = true;

    try {
      const { iknow_settings: current = {} } = await chrome.storage.local.get('iknow_settings');
      await chrome.storage.local.set({
        iknow_settings: {
          ...current,
          aiProvider: provider,
          aiApiKey: apiKey
        }
      });
      toast('✓ AI 配置已保存');
    } catch (e) {
      toast('✗ 保存失败');
    }

    setTimeout(() => {
      saveBtn.textContent = '保存 AI 配置';
      saveBtn.disabled = false;
    }, 600);
  });
}
