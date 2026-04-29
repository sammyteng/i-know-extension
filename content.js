/* ============================================================
   i know — Content Script v5
   修复：所有保存走 background.js → 直写 storage 双保险
   修复：提示词面板空库时提供快速添加入口
   ============================================================ */
'use strict';

let widgetVisible   = false;
let selectionMenuEl = null;
let floatingWidgetEl = null;
let promptPanelEl   = null;

// ── Extension Context 检测 ────────────────────────────────────
function ctxOk() {
  try { return !!chrome.runtime?.id; } catch { return false; }
}

// ── Settings (always direct storage) ──────────────────────────
async function getSettingsSafe() {
  try {
    const r = await chrome.storage.local.get('iknow_settings');
    return r.iknow_settings || {};
  } catch (e) {
    console.warn('[i know] getSettings fail:', e.message);
    return {};
  }
}

// ── Save item — background first, direct storage fallback ──────
async function saveItemSafe(data) {
  // Path A: background service worker (most reliable)
  if (ctxOk()) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SAVE_ITEM', data });
      if (res?.success) {
        console.log('[i know] ✓ saved via background:', data.title?.slice(0, 40));
        return { success: true };
      }
    } catch (e) {
      console.warn('[i know] background save failed, trying direct:', e.message);
    }
  }

  // Path B: direct chrome.storage.local
  try {
    const item = {
      id: crypto.randomUUID(),
      type:         data.type        || 'link',
      subType:      data.subType     || null,
      title:        (data.title      || '未命名').slice(0, 200),
      content:      data.content     || '',
      summary:      data.summary     || '',
      sourceUrl:    data.sourceUrl   || '',
      sourceDomain: data.sourceDomain|| '',
      tags:         data.tags        || [],
      images:       data.images      || [],
      readLater:    data.readLater   || false,
      isRead:       false,
      isPinned:     false,
      obsidianExported: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const st = await chrome.storage.local.get('iknow_items');
    const items = st.iknow_items || [];
    items.unshift(item);
    await chrome.storage.local.set({ iknow_items: items });
    console.log('[i know] ✓ saved direct to storage:', item.id, item.title?.slice(0,40));
    return { success: true };
  } catch (e) {
    console.error('[i know] ✗ BOTH save paths failed:', e);
    return { success: false, error: e.message };
  }
}

// ── SVG Icons ─────────────────────────────────────────────────
const ICON = {
  lamp:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 3.5-2.5 6.5-5.5 7.7V19h-3v-2.3C7.5 15.5 5 12.5 5 9a7 7 0 0 1 7-7z"/><path d="M9 22h6"/><path d="M10 19h4"/></svg>`,
  obsidian: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
  save:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  prompt:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  photo:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  panel:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`,
  copy:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  close:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  search:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  plus:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  star:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
};

// ── Init ─────────────────────────────────────────────────────
(async function init() {
  if (window.location.href.startsWith('chrome-extension://')) return;

  // Always remove old widget to avoid stale event listeners
  document.getElementById('iknow-widget')?.remove();
  document.getElementById('iknow-mini-toast')?.remove();

  console.log('[i know] content script v5 init on:', location.hostname);
  createFloatingWidget();
  setupSelectionMenu();
})();

// Icons have been moved to the top of the file to fix ReferenceError.

// ── Floating Widget ──────────────────────────────────────────
function createFloatingWidget() {
  floatingWidgetEl = document.createElement('div');
  floatingWidgetEl.id = 'iknow-widget';
  floatingWidgetEl.innerHTML = `
    <button id="iknow-fab" title="i know" aria-label="i know 知识采集">${ICON.lamp}</button>
    <div id="iknow-menu" class="iknow-menu-hidden">
      <button class="iknow-menu-item iknow-menu-obsidian" data-action="save-obsidian">
        ${ICON.obsidian}<span>存 Obsidian</span>
      </button>
      <button class="iknow-menu-item" data-action="save-local">
        ${ICON.save}<span>保存</span>
      </button>
      <button class="iknow-menu-item" data-action="prompt-search">
        ${ICON.prompt}<span>提示词</span>
      </button>
      <button class="iknow-menu-item" data-action="screenshot">
        ${ICON.photo}<span>截图</span>
      </button>
      <button class="iknow-menu-item" data-action="add-quicksite">
        ${ICON.star}<span>收藏到主页</span>
      </button>
      <button class="iknow-menu-item" data-action="sidepanel">
        ${ICON.panel}<span>侧边面板</span>
      </button>
    </div>
  `;
  document.body.appendChild(floatingWidgetEl);

  const fab  = floatingWidgetEl.querySelector('#iknow-fab');
  const menu = floatingWidgetEl.querySelector('#iknow-menu');

  fab.addEventListener('click', e => {
    e.stopPropagation();
    widgetVisible = !widgetVisible;
    menu.className = widgetVisible ? 'iknow-menu-visible' : 'iknow-menu-hidden';
    fab.classList.toggle('iknow-fab-open', widgetVisible);
    console.log('[i know] fab clicked, menu visible:', widgetVisible);
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (widgetVisible && !e.target.closest('#iknow-widget')) {
      widgetVisible = false;
      menu.className = 'iknow-menu-hidden';
      fab.classList.remove('iknow-fab-open');
    }
  });

  floatingWidgetEl.querySelectorAll('.iknow-menu-item').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const action = btn.dataset.action;
      console.log('[i know] menu item clicked:', action);
      widgetVisible = false;
      menu.className = 'iknow-menu-hidden';
      fab.classList.remove('iknow-fab-open');
      handleWidgetAction(action);
    });
  });
}

// ── Widget Actions ────────────────────────────────────────────
async function handleWidgetAction(action) {
  switch (action) {
    case 'save-obsidian':  await savePageToObsidian(); break;
    case 'save-local':     await savePageLocal();      break;
    case 'prompt-search':  openPromptPanel();           break;
    case 'screenshot':     await takeScreenshot();      break;
    case 'add-quicksite':  await addCurrentToQuickSites(); break;
    case 'sidepanel':      openSidePanel();              break;
    default: console.warn('[i know] unknown action:', action);
  }
}

// ── 收藏当前页到主页常用网站 ──────────────────────────────
async function addCurrentToQuickSites() {
  try {
    const url = location.href;
    const name = location.hostname.replace('www.', '');
    const { iknow_settings: settings = {} } = await chrome.storage.local.get('iknow_settings');
    const sites = settings.quickSites || [];

    // Check if already exists
    if (sites.some(s => s.url === url || new URL(s.url).hostname === location.hostname)) {
      showMiniToast('⭐ 该网站已在常用列表中');
      return;
    }

    sites.push({ url, name });
    await chrome.storage.local.set({ iknow_settings: { ...settings, quickSites: sites } });
    showMiniToast('⭐ 已收藏到主页常用网站');
  } catch (e) {
    showMiniToast('✗ 收藏失败: ' + e.message);
  }
}

// ── 保存当前页（先选 Tag 再存）────────────────────────────
async function savePageLocal() {
  showSaveTagPicker();
}

function showSaveTagPicker() {
  document.getElementById('iknow-tag-picker')?.remove();

  const picker = document.createElement('div');
  picker.id = 'iknow-tag-picker';
  picker.innerHTML = `
    <div class="iknow-tp-title">选择分类后保存</div>
    <div class="iknow-tp-tags">
      <button class="iknow-tp-tag active" data-type="link">链接</button>
      <button class="iknow-tp-tag" data-type="prompt">提示词</button>
      <button class="iknow-tp-tag" data-type="skill">Skill</button>
      <button class="iknow-tp-tag" data-type="article">文章</button>
      <button class="iknow-tp-tag" data-type="screenshot">截图</button>
    </div>
    <div class="iknow-tp-subtypes" id="iknow-tp-subtypes" style="display:none">
      <div class="iknow-tp-subtitle">提示词类型</div>
      <div class="iknow-tp-sub-row">
        <button class="iknow-tp-sub active" data-sub="other_prompt">⚡ 通用</button>
        <button class="iknow-tp-sub" data-sub="image_prompt">🎨 图片</button>
        <button class="iknow-tp-sub" data-sub="article_prompt">📝 文章</button>
      </div>
    </div>
    <div class="iknow-tp-custom">
      <input class="iknow-tp-input" id="iknow-tp-custom-tag" placeholder="#自定义标签（可选）">
    </div>
    <div class="iknow-tp-actions">
      <button class="iknow-tp-cancel" id="iknow-tp-cancel">取消</button>
      <button class="iknow-tp-save" id="iknow-tp-save">保存</button>
    </div>
  `;
  document.body.appendChild(picker);
  setTimeout(() => picker.classList.add('visible'), 10);

  let selectedType = 'link';
  let selectedSubType = 'other_prompt';
  const subtypesEl = picker.querySelector('#iknow-tp-subtypes');

  picker.querySelectorAll('.iknow-tp-tag').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      picker.querySelectorAll('.iknow-tp-tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;
      subtypesEl.style.display = selectedType === 'prompt' ? 'block' : 'none';
    });
  });

  picker.querySelectorAll('.iknow-tp-sub').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      picker.querySelectorAll('.iknow-tp-sub').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSubType = btn.dataset.sub;
    });
  });

  picker.querySelector('#iknow-tp-cancel').addEventListener('click', e => {
    e.stopPropagation();
    picker.classList.remove('visible');
    setTimeout(() => picker.remove(), 200);
  });

  picker.querySelector('#iknow-tp-save').addEventListener('click', async e => {
    e.stopPropagation();
    const customTag = picker.querySelector('#iknow-tp-custom-tag').value.trim();
    const tags = [];
    if (customTag) {
      customTag.replace(/#?([\w\u4e00-\u9fa5]+)/g, (_, t) => { tags.push(t); });
    }
    picker.classList.remove('visible');
    setTimeout(() => picker.remove(), 200);
    await doSaveWithTag(selectedType, tags, selectedType === 'prompt' ? selectedSubType : null);
  });
}

async function doSaveWithTag(type, tags, subType) {
  showMiniToast('正在保存...');
  try {
    const desc    = document.querySelector('meta[name="description"]')?.content || '';
    const content = extractPageContent().slice(0, 5000);
    const item = {
      type,
      title:        document.title || location.href,
      content,
      summary:      desc,
      sourceUrl:    location.href,
      sourceDomain: location.hostname.replace('www.', ''),
      tags,
      readLater:    true,
    };
    if (subType) item.subType = subType;
    const res = await saveItemSafe(item);
    if (res.success) {
      showMiniToast('✓ 已保存为「' + ({link:'网页', article:'文章', prompt:'提示词', skill:'Skill', screenshot:'截图'}[type] || type) + '」');
    } else {
      showMiniToast('✗ 保存失败: ' + res.error);
    }
  } catch (e) {
    showMiniToast('✗ 错误: ' + e.message);
  }
}


// ── Screenshot ───────────────────────────────────────────────
async function takeScreenshot() {
  if (!ctxOk()) { showMiniToast('请刷新页面后重试'); return; }
  showMiniToast('截图中...');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'TAKE_SCREENSHOT' });
    if (res?.dataUrl) {
      await saveItemSafe({
        type: 'screenshot', title: '截图 — ' + document.title,
        images: [{ dataUrl: res.dataUrl, caption: document.title }],
        sourceUrl: location.href, sourceDomain: location.hostname,
      });
      showMiniToast('✓ 截图已保存');
    } else {
      showMiniToast('截图失败: ' + (res?.error || '未知'));
    }
  } catch (e) { showMiniToast('截图失败: ' + e.message); }
}

// ── Open Side Panel ───────────────────────────────────────────
function openSidePanel() {
  if (!ctxOk()) { showMiniToast('请刷新页面后重试'); return; }
  chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(e => {
    console.warn('[i know] openSidePanel fail:', e.message);
    showMiniToast('无法打开侧边面板，请刷新页面');
  });
}

// ═══════════════════════════════════════════════════════════════
//  浮动提示词面板
// ═══════════════════════════════════════════════════════════════
function openPromptPanel() {
  const existing = document.getElementById('iknow-prompt-panel');
  if (existing) { existing.remove(); promptPanelEl = null; return; }

  promptPanelEl = buildPromptPanel();
  document.body.appendChild(promptPanelEl);
  console.log('[i know] prompt panel opened');

  loadAndRenderPrompts();
  setTimeout(() => promptPanelEl?.querySelector('#iknow-pp-search')?.focus(), 50);
}

function buildPromptPanel() {
  const el = document.createElement('div');
  el.id = 'iknow-prompt-panel';
  el.innerHTML = `
    <div class="ipp-header">
      <span class="ipp-title">${ICON.prompt} 提示词库</span>
      <button class="ipp-close" id="iknow-pp-close">${ICON.close}</button>
    </div>
    <div class="ipp-search-row">
      <span class="ipp-search-icon">${ICON.search}</span>
      <input class="ipp-search" id="iknow-pp-search" type="text" placeholder="搜索提示词..." autocomplete="off">
    </div>
    <div class="ipp-filters" id="iknow-pp-filters">
      <button class="ipp-filter active" data-sub="all">全部</button>
      <button class="ipp-filter" data-sub="image_prompt">🎨 图片</button>
      <button class="ipp-filter" data-sub="article_prompt">📝 文章</button>
      <button class="ipp-filter" data-sub="other_prompt">⚡ 通用</button>
    </div>
    <div class="ipp-list" id="iknow-pp-list">
      <div class="ipp-loading">加载中...</div>
    </div>
    <div class="ipp-add-tags" id="iknow-pp-add-tags">
      <button class="ipp-add-tag active" data-sub="other_prompt">⚡ 通用</button>
      <button class="ipp-add-tag" data-sub="image_prompt">🎨 图片</button>
      <button class="ipp-add-tag" data-sub="article_prompt">📝 文章</button>
      <input class="ipp-add-custom-tag" id="iknow-pp-custom-tag" type="text" placeholder="#自定义标签" style="width:80px">
    </div>
    <div class="ipp-add-row">
      <input class="ipp-add-input" id="iknow-pp-add-input" type="text" placeholder="快速添加提示词...">
      <button class="ipp-add-btn" id="iknow-pp-add-btn">${ICON.plus}</button>
    </div>
  `;

  el.querySelector('#iknow-pp-close').addEventListener('click', e => {
    e.stopPropagation();
    el.remove(); promptPanelEl = null;
  });

  // Close on outside click (deferred so current click doesn't immediately close it)
  setTimeout(() => {
    function onClickOut(e) {
      if (!document.getElementById('iknow-prompt-panel')) {
        document.removeEventListener('click', onClickOut);
        return;
      }
      if (!e.target.closest('#iknow-prompt-panel') && !e.target.closest('#iknow-widget')) {
        el.remove(); promptPanelEl = null;
        document.removeEventListener('click', onClickOut);
      }
    }
    document.addEventListener('click', onClickOut);
  }, 200);

  el.querySelectorAll('.ipp-filter').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      el.querySelectorAll('.ipp-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadAndRenderPrompts();
    });
  });

  el.querySelector('#iknow-pp-search').addEventListener('input', () => loadAndRenderPrompts());

  // Tag selector buttons for quick add
  el.querySelectorAll('.ipp-add-tag').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      el.querySelectorAll('.ipp-add-tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Quick add
  const addInput = el.querySelector('#iknow-pp-add-input');
  const addBtn   = el.querySelector('#iknow-pp-add-btn');
  async function quickAdd() {
    const text = addInput.value.trim();
    if (!text) return;
    addBtn.disabled = true;
    
    // Get selected subType
    const selectedSubType = el.querySelector('.ipp-add-tag.active')?.dataset.sub || 'other_prompt';

    // Collect tags from #hashtags in text + custom tag input
    const tags = [];
    text.replace(/#([\w\u4e00-\u9fa5]+)/g, (match, tag) => {
      tags.push(tag);
      return match;
    });
    const customTag = el.querySelector('#iknow-pp-custom-tag')?.value.trim();
    if (customTag) {
      customTag.replace(/#?([\w\u4e00-\u9fa5]+)/g, (_, t) => { tags.push(t); });
    }

    const res = await saveItemSafe({
      type: 'prompt', subType: selectedSubType,
      title: text.replace(/\s+/g, ' ').slice(0, 30) + (text.length > 30 ? '...' : ''),
      content: text,
      tags: tags
    });
    if (res.success) {
      addInput.value = '';
      el.querySelector('#iknow-pp-custom-tag').value = '';
      showMiniToast('✓ 提示词已添加');
      loadAndRenderPrompts();
    } else {
      showMiniToast('✗ 添加失败');
    }
    addBtn.disabled = false;
  }
  addBtn.addEventListener('click', e => { e.stopPropagation(); quickAdd(); });
  addInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); quickAdd(); } });

  return el;
}

async function loadAndRenderPrompts() {
  const panel = document.getElementById('iknow-prompt-panel');
  if (!panel) return;

  const listEl = panel.querySelector('#iknow-pp-list');
  const query  = (panel.querySelector('#iknow-pp-search')?.value || '').toLowerCase().trim();
  const sub    = panel.querySelector('.ipp-filter.active')?.dataset.sub || 'all';

  try {
    const st    = await chrome.storage.local.get('iknow_items');
    const all   = st.iknow_items || [];
    let prompts = all.filter(i => i.type === 'prompt');
    if (sub !== 'all') prompts = prompts.filter(i => i.subType === sub);
    if (query) prompts = prompts.filter(i =>
      (i.title   || '').toLowerCase().includes(query) ||
      (i.content || '').toLowerCase().includes(query) ||
      (i.tags    || []).some(t => t.toLowerCase().includes(query.replace('#', '')))
    );

    console.log('[i know] prompts found:', prompts.length, 'total items:', all.length);

    if (!prompts.length) {
      listEl.innerHTML = `
        <div class="ipp-empty">
          ${query ? '没有匹配的提示词' : '提示词库为空'}<br>
          <small>${query ? '' : '从下方快速添加，或划选文字点「提示词」'}</small>
        </div>`;
      return;
    }

    listEl.innerHTML = prompts.map(p => {
      const preview = (p.content || '').replace(/\s+/g, ' ').slice(0, 80);
      const sub_label = { image_prompt:'图片', article_prompt:'文章', other_prompt:'通用' }[p.subType] || '';
      const tags_html = (p.tags || []).map(t => `<span class="ipp-tag">#${escHtml(t)}</span>`).join('');
      return `
        <div class="ipp-card" data-id="${p.id}">
          <div class="ipp-card-head">
            <div class="ipp-card-title">${escHtml(p.title || '未命名')}</div>
            ${sub_label ? `<span class="ipp-sub-badge">${sub_label}</span>` : ''}
            ${tags_html}
          </div>
          ${preview ? `<div class="ipp-card-preview">${escHtml(preview)}</div>` : ''}
          <button class="ipp-copy-btn" data-content="${escHtml(p.content || '')}">
            ${ICON.copy} 复制
          </button>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.ipp-tag').forEach(tagEl => {
      tagEl.addEventListener('click', e => {
        e.stopPropagation();
        const searchInput = panel.querySelector('#iknow-pp-search');
        if (searchInput) {
          searchInput.value = tagEl.textContent;
          loadAndRenderPrompts();
        }
      });
    });

    listEl.querySelectorAll('.ipp-copy-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const ok = await copyToClipboard(btn.dataset.content);
        if (ok) {
          btn.innerHTML = `${ICON.check} 已复制`;
          btn.classList.add('copied');
          setTimeout(() => { btn.innerHTML = `${ICON.copy} 复制`; btn.classList.remove('copied'); }, 1600);
        }
      });
    });
  } catch (e) {
    console.error('[i know] loadAndRenderPrompts error:', e);
    if (!ctxOk() || e.message.includes('undefined')) {
      listEl.innerHTML = `<div class="ipp-empty" style="color:#d32f2f">扩展已更新，请按 Cmd+R 刷新当前网页以使浮窗生效。</div>`;
    } else {
      listEl.innerHTML = `<div class="ipp-empty">加载失败: ${e.message}</div>`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  Selection Menu
// ═══════════════════════════════════════════════════════════════
function setupSelectionMenu() {
  document.addEventListener('mouseup', e => {
    if (e.target.closest('#iknow-widget') || e.target.closest('#iknow-prompt-panel') || e.target.closest('#iknow-selection-menu')) return;
    const sel  = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 5) { hideSelectionMenu(); return; }
    const range = sel.getRangeAt(0);
    const rect  = range.getBoundingClientRect();
    showSelectionMenu(rect.left + window.scrollX, rect.top + window.scrollY - 90, text);
  });
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('#iknow-selection-menu')) hideSelectionMenu();
  });
}

function showSelectionMenu(x, y, text) {
  hideSelectionMenu();
  selectionMenuEl = document.createElement('div');
  selectionMenuEl.id = 'iknow-selection-menu';
  const clampX = Math.min(Math.max(8, x), window.innerWidth + window.scrollX - 290);
  const clampY = Math.max(window.scrollY + 8, y);
  selectionMenuEl.style.left = clampX + 'px';
  selectionMenuEl.style.top  = clampY + 'px';
  const preview = text.length > 32 ? text.slice(0, 32) + '…' : text;
  selectionMenuEl.innerHTML = `
    <div class="iknow-sel-preview" title="${escHtml(text)}" style="cursor: move;">${escHtml(preview)}</div>
    <div class="iknow-sel-actions">
      <button class="iknow-sel-btn" data-action="save-text">${ICON.save}<span>保存</span></button>
      <button class="iknow-sel-btn" data-action="save-prompt">${ICON.prompt}<span>提示词</span></button>
      <button class="iknow-sel-btn" data-action="translate-text"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg><span>翻译</span></button>
      <button class="iknow-sel-btn" data-action="copy-text">${ICON.copy}<span>复制</span></button>
      <button class="iknow-sel-btn iknow-sel-obsidian" data-action="to-obsidian">${ICON.obsidian}<span>Obsidian</span></button>
    </div>
  `;
  document.body.appendChild(selectionMenuEl);
  
  // Make it draggable via the preview area
  let isDragging = false;
  let startX, startY, initialX, initialY;
  const header = selectionMenuEl.querySelector('.iknow-sel-preview');
  
  header.addEventListener('mousedown', e => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    initialX = selectionMenuEl.offsetLeft;
    initialY = selectionMenuEl.offsetTop;
    e.preventDefault(); // prevent text selection
  });
  
  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    selectionMenuEl.style.left = (initialX + dx) + 'px';
    selectionMenuEl.style.top = (initialY + dy) + 'px';
  });
  
  document.addEventListener('mouseup', () => {
    isDragging = false;
  });

  selectionMenuEl.querySelectorAll('.iknow-sel-btn').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action !== 'translate-text') {
        btn.disabled = true;
        btn.style.opacity = '0.6';
      }
      await handleSelectionAction(action, text, btn);
      if (action !== 'translate-text') {
        btn.innerHTML = `${ICON.check} <span>完成</span>`;
        btn.style.opacity = '1';
        btn.style.color = '#5a7a62';
        setTimeout(() => hideSelectionMenu(), 1200);
      }
    });
  });
}

function hideSelectionMenu() { selectionMenuEl?.remove(); selectionMenuEl = null; }

async function handleSelectionAction(action, text, btnEl = null) {
  switch (action) {
    case 'save-text': {
      hideSelectionMenu();
      showSaveTagPickerWithContent(text);
      return; // don't auto-close, picker handles it
    }
    case 'save-prompt': {
      const tags = [];
      text.replace(/#([\w\u4e00-\u9fa5]+)/g, (_, t) => { tags.push(t); });
      const res = await saveItemSafe({ type: 'prompt', subType: 'other_prompt', title: text.replace(/\s+/g,' ').slice(0,30) + (text.length > 30 ? '...' : ''), content: text, sourceUrl: location.href, sourceDomain: location.hostname, tags });
      showMiniToast(res.success ? '✓ 提示词已保存' : '✗ 保存失败');
      break;
    }
    case 'translate-text': {
      if (btnEl) {
        btnEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg><span>翻译中</span>`;
        btnEl.disabled = true;
      }
      const cfg = await getSettingsSafe();
      const apiKey = cfg.aiApiKey || cfg.geminiApiKey;
      const provider = cfg.aiProvider || 'gemini';
      
      if (!apiKey) {
        showMiniToast('✗ 请先在设置中配置 AI 翻译模型 API Key');
        if (btnEl) {
          btnEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg><span>翻译</span>`;
          btnEl.disabled = false;
        }
        return;
      }
      try {
        const res = await chrome.runtime.sendMessage({ type: 'TRANSLATE', text, apiKey, provider });
        if (res?.success) {
          if (selectionMenuEl) {
            // Check if there is an existing translation result box, if so replace it
            let trBox = selectionMenuEl.querySelector('.iknow-sel-translation');
            if (!trBox) {
              trBox = document.createElement('div');
              trBox.className = 'iknow-sel-translation';
              selectionMenuEl.appendChild(trBox);
            }
            trBox.innerHTML = escHtml(res.text).replace(/\n/g, '<br>');
          }
        } else {
          showMiniToast('✗ 翻译失败: ' + (res?.error || '未知错误'));
        }
      } catch (e) {
        showMiniToast('✗ 翻译请求失败');
      }
      if (btnEl) {
        btnEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg><span>翻译</span>`;
        btnEl.disabled = false;
      }
      break;
    }
    case 'copy-text': {
      const ok = await copyToClipboard(text);
      showMiniToast(ok ? '✓ 已复制到剪贴板' : '✗ 复制失败');
      break;
    }
    case 'to-obsidian': {
      const cfg    = await getSettingsSafe();
      const folder = (cfg.obsidianInboxFolder || '00 inbox').replace(/\/$/, '');
      const vault  = cfg.obsidianVaultName  || '';
      const apiKey = cfg.obsidianRestApiKey || '';
      const silent = cfg.obsidianSilentMode !== false;
      const line   = buildInboxLine({ title: text.slice(0,60).replace(/\n/g,' '), sourceUrl: location.href, site: location.hostname.replace('www.',''), content: text.slice(0,40) });
      await doAppendLine(line, folder, vault, silent, apiKey);
      showMiniToast('✓ 已存入 Obsidian 收集箱');
      break;
    }
  }
}

function showSaveTagPickerWithContent(text) {
  document.getElementById('iknow-tag-picker')?.remove();

  const picker = document.createElement('div');
  picker.id = 'iknow-tag-picker';
  picker.innerHTML = `
    <div class="iknow-tp-title">选择分类后保存</div>
    <div class="iknow-tp-preview">${escHtml(text.slice(0, 60))}${text.length > 60 ? '…' : ''}</div>
    <div class="iknow-tp-tags">
      <button class="iknow-tp-tag active" data-type="link">链接</button>
      <button class="iknow-tp-tag" data-type="prompt">提示词</button>
      <button class="iknow-tp-tag" data-type="skill">Skill</button>
      <button class="iknow-tp-tag" data-type="article">文章</button>
      <button class="iknow-tp-tag" data-type="screenshot">截图</button>
    </div>
    <div class="iknow-tp-subtypes" id="iknow-tp-subtypes" style="display:none">
      <div class="iknow-tp-subtitle">提示词类型</div>
      <div class="iknow-tp-sub-row">
        <button class="iknow-tp-sub active" data-sub="other_prompt">⚡ 通用</button>
        <button class="iknow-tp-sub" data-sub="image_prompt">🎨 图片</button>
        <button class="iknow-tp-sub" data-sub="article_prompt">📝 文章</button>
      </div>
    </div>
    <div class="iknow-tp-custom">
      <input class="iknow-tp-input" id="iknow-tp-custom-tag" placeholder="#自定义标签（可选）">
    </div>
    <div class="iknow-tp-actions">
      <button class="iknow-tp-cancel" id="iknow-tp-cancel">取消</button>
      <button class="iknow-tp-save" id="iknow-tp-save">保存</button>
    </div>
  `;
  document.body.appendChild(picker);
  setTimeout(() => picker.classList.add('visible'), 10);

  let selectedType = 'link';
  let selectedSubType = 'other_prompt';
  const subtypesEl = picker.querySelector('#iknow-tp-subtypes');

  picker.querySelectorAll('.iknow-tp-tag').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      picker.querySelectorAll('.iknow-tp-tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;
      subtypesEl.style.display = selectedType === 'prompt' ? 'block' : 'none';
    });
  });

  picker.querySelectorAll('.iknow-tp-sub').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      picker.querySelectorAll('.iknow-tp-sub').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSubType = btn.dataset.sub;
    });
  });

  picker.querySelector('#iknow-tp-cancel').addEventListener('click', e => {
    e.stopPropagation();
    picker.classList.remove('visible');
    setTimeout(() => picker.remove(), 200);
  });

  picker.querySelector('#iknow-tp-save').addEventListener('click', async e => {
    e.stopPropagation();
    const customTag = picker.querySelector('#iknow-tp-custom-tag').value.trim();
    const tags = [];
    if (customTag) {
      customTag.replace(/#?([\w\u4e00-\u9fa5]+)/g, (_, t) => { tags.push(t); });
    }
    text.replace(/#([\w\u4e00-\u9fa5]+)/g, (_, t) => { if (!tags.includes(t)) tags.push(t); });

    picker.classList.remove('visible');
    setTimeout(() => picker.remove(), 200);

    const title = selectedType === 'prompt'
      ? text.replace(/\s+/g,' ').slice(0, 30) + (text.length > 30 ? '...' : '')
      : (document.title || text.slice(0, 60));

    const res = await saveItemSafe({
      type: selectedType,
      subType: selectedType === 'prompt' ? selectedSubType : null,
      title,
      content: text,
      sourceUrl: location.href,
      sourceDomain: location.hostname.replace('www.', ''),
      tags,
      readLater: true,
    });
    showMiniToast(res.success ? '✓ 已保存为「' + ({link:'链接', article:'文章', prompt:'提示词', skill:'Skill', screenshot:'截图'}[selectedType] || selectedType) + '」' : '✗ 保存失败');
  });
}

// ═══════════════════════════════════════════════════════════════
//  Obsidian 一行追加
// ═══════════════════════════════════════════════════════════════
async function savePageToObsidian() {
  showMiniToast('发送到 Obsidian...');
  try {
    const cfg    = await getSettingsSafe();
    const kw     = window.getSelection()?.toString().trim().slice(0, 60) || '';
    const site   = document.querySelector('meta[property="og:site_name"]')?.content || location.hostname.replace('www.', '');
    const line   = buildInboxLine({ title: document.title || location.href, sourceUrl: location.href, site, content: kw, tags: kw ? [kw] : [] });
    await doAppendLine(line, (cfg.obsidianInboxFolder || '00 inbox').replace(/\/$/, ''), cfg.obsidianVaultName || '', cfg.obsidianSilentMode !== false, cfg.obsidianRestApiKey || '');
    showMiniToast('✓ 已存入 Obsidian 收集箱');
  } catch (e) { showMiniToast('失败: ' + e.message); }
}

function buildInboxLine(item) {
  const title = (item.title || '未命名').replace(/[\[\]]/g, '');
  const url   = item.sourceUrl || '';
  const site  = item.site || item.sourceDomain || '';
  const kw    = (item.tags || []).join(' ') || (item.content || '').slice(0, 40);
  const now   = new Date();
  const time  = `${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  const parts = [`- [ ] [${title}](${url})`];
  if (site) parts.push(`\`${site}\``);
  if (kw)   parts.push(kw);
  parts.push(time);
  return parts.join(' · ') + '\n';
}

async function doAppendLine(line, folder, vault, silent, apiKey) {
  try {
    // Route through background service worker (content scripts can't fetch localhost due to page CSP)
    const result = await chrome.runtime.sendMessage({
      type: 'OBSIDIAN_APPEND',
      line, folder, apiKey,
    });
    if (result?.success) return;
    // REST API failed, fall through to clipboard
    console.warn('[i know] Obsidian REST API:', result?.error || 'unknown error');
  } catch (e) {
    console.warn('[i know] sendMessage failed:', e.message);
  }
  
  // Fallback: copy to clipboard and notify
  try { 
    await navigator.clipboard.writeText(line); 
    showMiniToast('⚠️ REST API 未连接，已复制到剪贴板');
  } catch {
    showMiniToast('❌ 请安装并启用 Obsidian Local REST API 插件');
  }
}

// ═══════════════════════════════════════════════════════════════
//  Utils
// ═══════════════════════════════════════════════════════════════
function extractPageContent() {
  const el = document.querySelector('article, main, [role="main"], .article-content, .post-content, .entry-content');
  if (el) return el.innerText || '';
  return Array.from(document.querySelectorAll('p, h2, h3'))
    .map(e => e.innerText?.trim() || '').filter(t => t.length > 20).join('\n\n');
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(el); el.focus(); el.select();
    const ok = document.execCommand('copy'); el.remove(); return ok;
  } catch { return false; }
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showMiniToast(msg) {
  let t = document.getElementById('iknow-mini-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'iknow-mini-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'iknow-toast-visible';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; }, 3000);
  console.log('[i know] toast:', msg);
}
