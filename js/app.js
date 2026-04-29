/* ============================================================
   i know — Main App (Tab-out style redesign)
   ============================================================ */
'use strict';

let currentView = 'tabs';
let currentDetailItem = null;
let kbFilter = 'all';
let promptFilter = 'all';
let rlFilter = 'all';
let searchTimer = null;

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  renderGreeting();
  try { await IKnowTabs.fetchOpenTabs(); } catch(e) { console.error('[i know] fetchOpenTabs:', e); }
  try { await refreshStats(); } catch(e) { console.error('[i know] refreshStats:', e); }
  try { await renderTabsView(); } catch(e) { console.error('[i know] renderTabsView:', e); }
  setupNav();
  setupFilterBtns();
  setupModals();
  setupSettings();
  setupSaveModal();
  setupImportExport();
  setupDetailModal();
  setupSearch();
  setupQuickSites();
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
});

// ── Greeting ────────────────────────────────────────────────
function renderGreeting() {
  const h = new Date().getHours();
  const g = h < 5 ? '夜深了' : h < 12 ? '早上好' : h < 17 ? '下午好' : h < 21 ? '晚上好' : '夜深了';
  document.getElementById('greeting').textContent = g;
  document.getElementById('dateDisplay').textContent = new Date().toLocaleDateString('zh-CN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  }).toUpperCase();
}

// ── Stats ────────────────────────────────────────────────────
async function refreshStats() {
  const stats = await IKnowStorage.getStats();
  const tabs = IKnowTabs.getOpenTabs().filter(t => !t.isTabOut);

  document.getElementById('statTabs').textContent = tabs.length;
  document.getElementById('statKnowledge').textContent = stats.total;
  document.getElementById('statReadLater').textContent = stats.readLater;
  document.getElementById('footerStatTabs').textContent = tabs.length;

  // Badge on read-later pill
  const rlPill = document.querySelector('.nav-pill[data-view="readlater"]');
  if (stats.readLater > 0) {
    rlPill.classList.add('has-badge');
    rlPill.dataset.count = stats.readLater;
  } else {
    rlPill.classList.remove('has-badge');
    delete rlPill.dataset.count;
  }
}

// ── Navigation ────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-pill[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

async function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-pill').forEach(p => p.classList.remove('active'));

  const viewEl = document.getElementById('view' + view.charAt(0).toUpperCase() + view.slice(1));
  if (viewEl) viewEl.classList.add('active');
  const pill = document.querySelector(`.nav-pill[data-view="${view}"]`);
  if (pill) pill.classList.add('active');

  switch (view) {
    case 'tabs':      await renderTabsView(); break;
    case 'knowledge': await renderKnowledgeView(); break;
    case 'readlater': await renderReadLaterView(); break;
    case 'favorites': await renderFavoritesView(); break;
  }
  await refreshStats();
}

// ── TABS VIEW (tab-out style) ─────────────────────────────────
async function renderTabsView() {
  await IKnowTabs.fetchOpenTabs();
  const tabs = IKnowTabs.getOpenTabs();
  const groups = IKnowTabs.groupTabsByDomain(tabs);

  // Dupe banner
  const dupeCount = await IKnowTabs.getTabOutDupeCount();
  const dupeBanner = document.getElementById('tabOutDupeBanner');
  if (dupeCount > 1) {
    document.getElementById('tabOutDupeCount').textContent = dupeCount;
    dupeBanner.style.display = 'flex';
  } else {
    dupeBanner.style.display = 'none';
  }

  // Tab action from banner
  document.querySelector('[data-action="close-tabout-dupes"]')?.addEventListener('click', async () => {
    await IKnowTabs.closeTabOutDupes();
    dupeBanner.style.display = 'none';
    await renderTabsView();
  });

  // Open tabs section
  const openSection = document.getElementById('openTabsSection');
  const missionsEl = document.getElementById('openTabsMissions');
  openSection.style.display = 'block';
  document.getElementById('openTabsSectionTitle').textContent = 'Right now';
  document.getElementById('openTabsSectionCount').textContent =
    `${groups.length} 个域名 · ${tabs.filter(t => !t.isTabOut).length} 个标签`;

  missionsEl.innerHTML = '';
  if (!groups.length) {
    missionsEl.innerHTML = `
      <div class="missions-empty">
        <div class="empty-checkmark">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
          </svg>
        </div>
        <div class="empty-title">All clear.</div>
        <div class="empty-subtitle">No open tabs. Enjoy the peace.</div>
      </div>`;
  } else {
    for (const group of groups) {
      missionsEl.appendChild(buildMissionCard(group));
    }
  }

  // Deferred (saved for later) column
  const { active, archived } = await IKnowStorage.getDeferredTabs();
  const deferredCol = document.getElementById('deferredColumn');
  const container = document.getElementById('appContainer');

  if (active.length > 0 || archived.length > 0) {
    deferredCol.style.display = 'block';
    container.classList.add('has-deferred');
    renderDeferredList(active, archived);
  } else {
    deferredCol.style.display = 'none';
    container.classList.remove('has-deferred');
  }
}

function buildMissionCard(group) {
  const card = document.createElement('div');
  card.className = 'mission-card';

  let domain = '';
  try { domain = new URL(group.tabs[0]?.url || '').hostname; } catch {}
  const faviconUrl = domain ? IKnowTabs.getFaviconUrl(domain) : '';

  const tabsHtml = group.tabs.slice(0, 6).map(tab => `
    <div class="page-chip" data-url="${esc(tab.url)}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${esc(tab.title || tab.url)}</span>
      <div class="chip-actions">
        <button class="chip-action chip-save" title="暂存" data-url="${esc(tab.url)}" data-title="${esc(tab.title)}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17 3H7a2 2 0 00-2 2v14l7-3 7 3V5a2 2 0 00-2-2z"/></svg>
        </button>
        <button class="chip-action chip-close" title="关闭" data-url="${esc(tab.url)}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  const overflow = group.tabs.length > 6
    ? `<div class="page-chip page-chip-overflow">+${group.tabs.length - 6} more tabs</div>`
    : '';

  card.innerHTML = `
    <div class="mission-top">
      ${faviconUrl ? `<img class="mission-favicon" src="${faviconUrl}" onerror="this.style.display='none'">` : ''}
      <span class="mission-name">${esc(group.label)}</span>
      <span class="mission-count-badge">${group.tabs.length}</span>
    </div>
    <div class="mission-pages">${tabsHtml}${overflow}</div>
    <div class="mission-actions">
      <button class="action-btn amber btn-close-all">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        关闭全组
      </button>
      <button class="action-btn sage btn-save-all">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17 3H7a2 2 0 00-2 2v14l7-3 7 3V5a2 2 0 00-2-2z"/></svg>
        暂存
      </button>
    </div>
  `;

  // Chip clicks — focus tab
  card.querySelectorAll('.page-chip').forEach(chip => {
    chip.addEventListener('click', async (e) => {
      if (e.target.closest('.chip-action')) return;
      await IKnowTabs.focusTab(chip.dataset.url);
    });
  });

  // Save individual tab
  card.querySelectorAll('.chip-save').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await IKnowStorage.saveTabForLater({ url: btn.dataset.url, title: btn.dataset.title });
      toast('已暂存');
      await renderTabsView();
    });
  });

  // Close individual tab
  card.querySelectorAll('.chip-close').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      IKnowTabs.playCloseSound();
      const chip = btn.closest('.page-chip');
      chip.style.opacity = '0';
      chip.style.transform = 'scale(0.9)';
      chip.style.transition = 'all 0.25s';
      await IKnowTabs.closeTabsExact([btn.dataset.url]);
      setTimeout(() => chip.remove(), 250);
    });
  });

  // Close all in group
  card.querySelector('.btn-close-all').addEventListener('click', async (e) => {
    e.stopPropagation();
    IKnowTabs.playCloseSound();
    const rect = card.getBoundingClientRect();
    IKnowTabs.shootConfetti(rect.left + rect.width / 2, rect.top + 20);
    card.classList.add('closing');
    const urls = group.tabs.map(t => t.url);
    setTimeout(async () => {
      await IKnowTabs.closeTabsExact(urls);
      card.remove();
      await refreshStats();
    }, 280);
  });

  // Save all
  card.querySelector('.btn-save-all').addEventListener('click', async (e) => {
    e.stopPropagation();
    for (const tab of group.tabs) await IKnowStorage.saveTabForLater(tab);
    toast(`已暂存 ${group.tabs.length} 个标签`);
    await renderTabsView();
  });

  return card;
}

function renderDeferredList(active, archived) {
  const list = document.getElementById('deferredList');
  const emptyEl = document.getElementById('deferredEmpty');
  const archiveEl = document.getElementById('deferredArchive');
  const countEl = document.getElementById('deferredCount');

  countEl.textContent = active.length ? `${active.length} 条` : '';
  list.innerHTML = '';

  if (!active.length) {
    emptyEl.style.display = 'block';
  } else {
    emptyEl.style.display = 'none';
    active.forEach((item, i) => {
      let domain = '';
      try { domain = new URL(item.url || '').hostname.replace('www.',''); } catch {}
      const el = document.createElement('div');
      el.className = 'deferred-item';
      el.style.animationDelay = `${i * 0.05}s`;
      el.innerHTML = `
        <input type="checkbox" class="deferred-checkbox" data-id="${item.id}">
        <div class="deferred-info">
          <a class="deferred-title" href="${esc(item.url || '#')}" target="_top">${esc(item.title || item.url || '未命名')}</a>
          <div class="deferred-meta">
            <span>${esc(domain)}</span>
            <span>${IKnowTabs.timeAgo(item.savedAt)}</span>
          </div>
        </div>
        <button class="deferred-dismiss" data-id="${item.id}" title="删除">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      `;
      el.querySelector('.deferred-checkbox').addEventListener('change', async (e) => {
        if (e.target.checked) {
          el.classList.add('checked');
          setTimeout(async () => {
            el.classList.add('removing');
            await IKnowStorage.checkOffDeferredTab(item.id);
            setTimeout(async () => {
              const { active: a, archived: ar } = await IKnowStorage.getDeferredTabs();
              renderDeferredList(a, ar);
            }, 300);
          }, 800);
        }
      });
      el.querySelector('.deferred-dismiss').addEventListener('click', async () => {
        el.classList.add('removing');
        setTimeout(() => el.remove(), 300);
        await IKnowStorage.dismissDeferredTab(item.id);
      });
      list.appendChild(el);
    });
  }

  // Archive toggle
  if (archived.length > 0) {
    archiveEl.style.display = 'block';
    document.getElementById('archiveCount').textContent = `(${archived.length})`;
    const toggle = document.getElementById('archiveToggle');
    const archiveBody = document.getElementById('archiveBody');
    // Clone to remove old listeners (prevents duplicate toggle on re-render)
    const newToggle = toggle.cloneNode(true);
    toggle.parentNode.replaceChild(newToggle, toggle);
    newToggle.addEventListener('click', () => {
      const open = archiveBody.style.display === 'block';
      archiveBody.style.display = open ? 'none' : 'block';
      newToggle.classList.toggle('open', !open);
    });
    renderArchive(archived);

    // Clear all archive
    const clearBtn = document.getElementById('archiveClearAll');
    if (clearBtn) {
      const newClearBtn = clearBtn.cloneNode(true);
      clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
      newClearBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`确定清空 ${archived.length} 条归档记录？`)) return;
        for (const item of archived) {
          await IKnowStorage.remove(item.id);
        }
        const { active: a, archived: ar } = await IKnowStorage.getDeferredTabs();
        renderDeferredList(a, ar);
        toast('归档已清空');
      });
    }
  } else {
    archiveEl.style.display = 'none';
  }
}

function renderArchive(items) {
  const archiveList = document.getElementById('archiveList');
  const search = document.getElementById('archiveSearch');
  const doRender = (q = '') => {
    const filtered = q ? items.filter(i => (i.title || i.url).toLowerCase().includes(q.toLowerCase())) : items;
    archiveList.innerHTML = filtered.map(item => `
      <div class="archive-item">
        <a class="archive-item-title" href="${esc(item.url)}" target="_blank" title="${esc(item.title || item.url)}">${esc(item.title || item.url)}</a>
        <span class="archive-item-date">${IKnowTabs.timeAgo(item.savedAt || item.completedAt)}</span>
      </div>
    `).join('');
  };
  doRender();
  search.addEventListener('input', e => doRender(e.target.value));
}

// ── KNOWLEDGE VIEW ─────────────────────────────────────────────
async function renderKnowledgeView(filter) {
  if (filter !== undefined) kbFilter = filter;
  const grid = document.getElementById('kbGrid');
  let items;

  if (kbFilter === 'all') {
    items = await IKnowStorage.getAll();
  } else if (kbFilter.startsWith('tag:')) {
    // Custom tag filter
    const tag = kbFilter.slice(4);
    const all = await IKnowStorage.getAll();
    items = all.filter(i => (i.tags || []).includes(tag) || i.type === tag);
  } else {
    items = await IKnowStorage.getByType(kbFilter);
  }

  if (!items.length) {
    grid.innerHTML = `<div style="column-span:all;padding:60px 0;text-align:center">
      <div style="font-family:var(--font-serif);font-size:18px;font-style:italic;color:var(--muted)">Nothing here yet.</div>
      <div style="font-size:13px;color:var(--muted);margin-top:6px">Open the side panel to start collecting knowledge.</div>
    </div>`;
    return;
  }
  grid.innerHTML = '';
  items.forEach((item, i) => {
    const card = buildKbCard(item, i);
    grid.appendChild(card);
  });
}

function getPinIcon(isPinned) {
  return isPinned 
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clip-rule="evenodd" /></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>`;
}

function buildKbCard(item, delay = 0) {
  const typeIcons = { prompt:'✏️', skill:'🔧', article:'📰', screenshot:'📷', link:'🔗' };
  const card = document.createElement('div');
  card.className = 'kb-card';
  card.dataset.type = item.type;
  card.style.animationDelay = `${Math.min(delay * 0.04, 0.4)}s`;

  card.innerHTML = `
    <div class="kb-card-header">
      <div class="kb-card-title">
        ${item.sourceUrl ? `<a href="${esc(item.sourceUrl)}" target="_blank">${esc(item.title)}</a>` : esc(item.title)}
      </div>
      <div class="kb-card-actions">
        <button class="kb-action-btn" data-action="favorite" title="收藏">
          ${getPinIcon(item.isPinned)}
        </button>
        <button class="kb-action-btn" data-action="copy" title="复制">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75"/><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5h7.5A2.25 2.25 0 0118 6.75v10.5"/></svg>
        </button>
        <button class="kb-action-btn danger" data-action="delete" title="删除">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
        </button>
      </div>
    </div>
    <div class="kb-card-preview">${esc(item.summary || item.content || '(无内容)')}</div>
    <div class="kb-card-footer">
      <div class="kb-tags">
        <span class="kb-tag">${typeIcons[item.type] || '📌'} ${item.subType ? subtypeLabel(item.subType) : item.type}</span>
        ${item.tags?.slice(0,1).map(t => `<span class="kb-tag">${esc(t)}</span>`).join('') || ''}
      </div>
      <span class="kb-card-time">${IKnowTabs.timeAgo(item.createdAt)}</span>
    </div>
  `;

  card.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'favorite') {
      const isPinned = !item.isPinned;
      IKnowStorage.update(item.id, { isPinned }).then(() => {
        item.isPinned = isPinned;
        e.target.closest('[data-action]').innerHTML = getPinIcon(isPinned);
        toast(isPinned ? '已加入收藏夹' : '已取消收藏');
      });
    } else if (action === 'copy') {
      navigator.clipboard.writeText(item.content || item.title).then(() => toast('已复制 ✓'));
    } else if (action === 'delete') {
      if (confirm(`删除「${item.title}」？`)) {
        IKnowStorage.remove(item.id).then(() => { card.remove(); refreshStats(); toast('已删除'); });
      }
    } else {
      openDetailModal(item);
    }
  });

  return card;
}



// ── READ LATER VIEW ────────────────────────────────────────────
async function renderReadLaterView(filter) {
  if (filter !== undefined) rlFilter = filter;
  const list = document.getElementById('readLaterList');
  let items = await IKnowStorage.getReadLater();
  if (rlFilter !== 'all') items = items.filter(i => i.type === rlFilter);

  if (!items.length) {
    list.innerHTML = `<div style="padding:60px 0;text-align:center;font-family:var(--font-serif);font-size:18px;font-style:italic;color:var(--muted)">Nothing queued for later.</div>`;
    return;
  }
  list.innerHTML = '';
  const typeIcons = { prompt:'✏️', skill:'🔧', article:'📰', screenshot:'📷', link:'🔗' };
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = `rl-item${item.isRead ? ' is-read' : ''}`;
    el.innerHTML = `
      <div class="rl-dot"></div>
      <div class="rl-info">
        <div class="rl-title">
          ${item.sourceUrl ? `<a href="${esc(item.sourceUrl)}" target="_blank">${esc(item.title)}</a>` : esc(item.title)}
        </div>
        <div class="rl-meta">
          ${item.sourceDomain ? `<span>${item.sourceDomain}</span>` : ''}
          <span>${IKnowTabs.timeAgo(item.createdAt)}</span>
        </div>
      </div>
      <span class="rl-type">${typeIcons[item.type] || '📌'} ${item.type}</span>
      <div class="rl-actions">
        <button class="action-btn" data-action="read" title="标记已读" style="padding:4px 10px;font-size:11px">已读 ✓</button>
        <button class="action-btn sage" data-action="obsidian" title="→ Obsidian" style="padding:4px 10px;font-size:11px">→ Obsidian</button>
        <button class="action-btn" data-action="copy" title="复制" style="padding:4px 10px;font-size:11px">复制</button>
      </div>
    `;
    el.addEventListener('click', async e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'read') {
        await IKnowStorage.markAsRead(item.id);
        el.classList.add('is-read');
        el.querySelector('.rl-dot').style.background = 'var(--warm-gray)';
      } else if (action === 'obsidian') {
        await IKnowObsidian.appendToInbox(item);
        toast('→ Obsidian ✓');
      } else if (action === 'copy') {
        await navigator.clipboard.writeText(item.content || item.title);
        toast('已复制 ✓');
      } else {
        openDetailModal(item);
      }
    });
    list.appendChild(el);
  });
}

// ── FAVORITES VIEW ─────────────────────────────────────────────
let favFilter = 'all';
let favSearchQuery = '';
async function renderFavoritesView(filter) {
  if (filter !== undefined) favFilter = filter;
  const grid = document.getElementById('favoritesGrid');
  if (!grid) return;
  let items = await IKnowStorage.getPinned();
  if (favFilter !== 'all') items = items.filter(i => i.type === favFilter);
  if (favSearchQuery) items = items.filter(i =>
    (i.title || '').toLowerCase().includes(favSearchQuery) ||
    (i.content || '').toLowerCase().includes(favSearchQuery)
  );
  if (!items.length) {
    grid.innerHTML = `<div style="padding:60px 0;text-align:center;font-family:var(--font-serif);font-size:18px;font-style:italic;color:var(--muted)">收藏夹空空如也<br><span style="font-size:13px">点卡片右上角的 ★ 收藏知识</span></div>`;
    return;
  }
  grid.innerHTML = '';
  items.forEach((item, i) => {
    const card = buildKbCard(item, i);
    grid.appendChild(card);
  });
}

// ── FILTER BUTTONS ────────────────────────────────────────────
// Built-in type labels (also used by tag picker in content.js)
const TYPE_LABELS = { prompt:'提示词', skill:'Skill', article:'文章', screenshot:'截图', link:'链接' };
const BUILT_IN_TYPES = ['prompt', 'skill', 'article', 'screenshot', 'link'];

async function renderKbFilters() {
  const container = document.getElementById('kbFilters');
  if (!container) return;

  // Collect custom tags from all items
  const items = await IKnowStorage.getAll();
  const customTags = new Set();
  items.forEach(item => {
    (item.tags || []).forEach(t => {
      if (t && !BUILT_IN_TYPES.includes(t)) customTags.add(t);
    });
    // Also treat unknown types as custom
    if (item.type && !BUILT_IN_TYPES.includes(item.type) && item.type !== 'link') {
      customTags.add(item.type);
    }
  });

  // Build buttons: all + built-in + custom
  let html = `<button class="kb-filter ${kbFilter === 'all' ? 'active' : ''}" data-filter="all">全部</button>`;
  BUILT_IN_TYPES.forEach(t => {
    html += `<button class="kb-filter ${kbFilter === t ? 'active' : ''}" data-filter="${t}">${TYPE_LABELS[t]}</button>`;
  });
  customTags.forEach(tag => {
    html += `<button class="kb-filter ${kbFilter === 'tag:' + tag ? 'active' : ''}" data-filter="tag:${esc(tag)}">#${esc(tag)}</button>`;
  });
  container.innerHTML = html;

  // Bind click events
  container.querySelectorAll('.kb-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.kb-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderKnowledgeView(btn.dataset.filter);
    });
  });
}

function setupFilterBtns() {
  // KB filters are now dynamic — rendered by renderKbFilters()
  renderKbFilters();

  // Favorites filters
  document.querySelectorAll('#viewFavorites .kb-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#viewFavorites .kb-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderFavoritesView(btn.dataset.filter);
    });
  });

  // New item / new prompt buttons
  document.getElementById('btnNewItem')?.addEventListener('click', () => openSaveModal());
  document.getElementById('btnNewPrompt')?.addEventListener('click', () => openSaveModal({ type: 'prompt' }));

  // Mark all read
  document.getElementById('btnMarkAllRead')?.addEventListener('click', async () => {
    const items = await IKnowStorage.getReadLater();
    for (const i of items) await IKnowStorage.markAsRead(i.id);
    await renderReadLaterView();
    toast('全部已读');
  });
}

// ── SEARCH ─────────────────────────────────────────────────────
function setupSearch() {
  document.getElementById('kbSearch')?.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = e.target.value.trim();
      const grid = document.getElementById('kbGrid');
      if (!q) { await renderKnowledgeView(); return; }
      const results = await IKnowStorage.search(q);
      grid.innerHTML = '';
      if (!results.length) {
        grid.innerHTML = `<div style="column-span:all;padding:40px;text-align:center;color:var(--muted);font-style:italic">No results for "${esc(q)}"</div>`;
        return;
      }
      results.forEach((item, i) => grid.appendChild(buildKbCard(item, i)));
    }, 280);
  });

  document.getElementById('favSearch')?.addEventListener('input', e => {
    favSearchQuery = e.target.value.toLowerCase().trim();
    renderFavoritesView();
  });
}

// ── DETAIL MODAL ───────────────────────────────────────────────
function openDetailModal(item) {
  currentDetailItem = item;
  const typeIcons = { prompt:'✏️', skill:'🔧', article:'📰', screenshot:'📷', link:'🔗' };
  document.getElementById('detailTitle').textContent = item.title;

  const meta = document.getElementById('detailMeta');
  meta.innerHTML = `
    <span class="detail-tag">${typeIcons[item.type] || '📌'} ${item.type}</span>
    ${item.subType ? `<span class="detail-tag">${subtypeLabel(item.subType)}</span>` : ''}
    ${item.tags?.map(t => `<span class="detail-tag">${esc(t)}</span>`).join('') || ''}
    ${item.sourceUrl ? `<a href="${esc(item.sourceUrl)}" target="_top" style="font-size:11px;color:var(--muted);text-decoration:underline;text-underline-offset:2px">${esc(item.sourceDomain || item.sourceUrl)}</a>` : ''}
  `;

  document.getElementById('detailContent').textContent =
    item.summary ? `摘要: ${item.summary}\n\n${item.content || ''}` : (item.content || '(无内容)');

  const imgs = document.getElementById('detailImages');
  imgs.innerHTML = '';
  if (item.images?.length) {
    for (const img of item.images) {
      const el = document.createElement('img');
      el.src = img.dataUrl;
      el.alt = img.caption || '';
      imgs.appendChild(el);
    }
  }
  openModal('modalDetail');
}

function setupDetailModal() {
  document.getElementById('btnCopyContent')?.addEventListener('click', () => {
    if (!currentDetailItem) return;
    navigator.clipboard.writeText(currentDetailItem.content || currentDetailItem.title)
      .then(() => toast('已复制 ✓'));
  });
  document.getElementById('btnDetailObsidian')?.addEventListener('click', async () => {
    if (!currentDetailItem) return;
    await IKnowObsidian.appendToInbox(currentDetailItem);
    toast('→ Obsidian ✓');
  });
  document.getElementById('btnDetailEdit')?.addEventListener('click', () => {
    if (!currentDetailItem) return;
    closeModal('modalDetail');
    openSaveModal(currentDetailItem);
  });
}

// ── SAVE MODAL ─────────────────────────────────────────────────
function openSaveModal(existing = null) {
  document.getElementById('modalSaveTitle').textContent = existing?.id ? '编辑知识' : '保存知识';
  document.getElementById('saveTitle').value = existing?.title || '';
  const type = existing?.type || 'prompt';
  document.getElementById('saveType').value = type;
  document.getElementById('saveSubType').value = existing?.subType || 'other_prompt';
  document.getElementById('saveContent').value = existing?.content || '';
  document.getElementById('saveTags').value = existing?.tags?.join(', ') || '';
  document.getElementById('saveReadLater').checked = existing?.readLater || false;
  toggleSubTypeField(type);
  updateTitleVisibility(type);
  openModal('modalSave');
}

function updateTitleVisibility(type) {
  const titleGroup = document.getElementById('saveTitle')?.closest('.form-group');
  if (titleGroup) titleGroup.style.display = type === 'prompt' ? 'none' : 'block';
}

function setupSaveModal() {
  document.getElementById('saveType')?.addEventListener('change', e => {
    toggleSubTypeField(e.target.value);
    updateTitleVisibility(e.target.value);
  });

  document.getElementById('btnSaveConfirm')?.addEventListener('click', async () => {
    const title = document.getElementById('saveTitle').value.trim();
    const type = document.getElementById('saveType').value;
    const subType = type === 'prompt' ? document.getElementById('saveSubType').value : null;
    const content = document.getElementById('saveContent').value.trim();
    const tags = document.getElementById('saveTags').value.split(',').map(t => t.trim()).filter(Boolean);
    const readLater = document.getElementById('saveReadLater').checked;

    // Auto-generate title for prompts if empty
    const finalTitle = title || (type === 'prompt' ? content.replace(/\s+/g, ' ').slice(0, 30) + (content.length > 30 ? '...' : '') : '未命名');
    if (!finalTitle.trim()) { toast('请输入内容'); return; }

    const settings = await IKnowStorage.getSettings();
    let summary = '';
    if (settings.autoSummary && content.length > 80) {
      toast('生成摘要中...');
      summary = await IKnowObsidian.generateSummary(content) || '';
    }

    await IKnowStorage.saveNew({ title: finalTitle, type, subType, content, summary, tags, readLater });
    closeModal('modalSave');
    toast('已保存 ✓');
    await refreshStats();
    await renderKbFilters(); // refresh filters to show new custom tags
    if (currentView === 'prompts') await renderPromptsView();
    else if (currentView === 'knowledge') await renderKnowledgeView();
    else if (currentView === 'readlater') await renderReadLaterView();
  });
}

function toggleSubTypeField(type) {
  document.getElementById('subTypeGroup').style.display = type === 'prompt' ? 'flex' : 'none';
}

// ── SETTINGS ───────────────────────────────────────────────────
function setupSettings() {
  document.getElementById('btnSettings')?.addEventListener('click', async () => {
    const s = await IKnowStorage.getSettings();
    document.getElementById('settingVaultName').value      = s.obsidianVaultName    || '';
    document.getElementById('settingInboxFolder').value    = s.obsidianInboxFolder   || 'inbox';
    document.getElementById('settingRestApiKey').value     = s.obsidianRestApiKey    || '';
    document.getElementById('settingObsidianSilent').checked = s.obsidianSilentMode !== false;
    document.getElementById('settingAiProvider').value     = s.aiProvider            || 'gemini';
    document.getElementById('settingAiKey').value          = s.aiApiKey              || '';
    document.getElementById('settingAutoSummary').checked  = s.autoSummary           || false;
    document.getElementById('settingFloatingBtn').checked  = s.floatingButtonEnabled !== false;
    document.getElementById('settingSelectionMenu').checked= s.selectionMenuEnabled  !== false;
    document.getElementById('restApiStatus').textContent   = '';
    openModal('modalSettings');
  });

  // REST API 检测
  document.getElementById('btnCheckRestApi')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('restApiStatus');
    const apiKey   = document.getElementById('settingRestApiKey').value.trim();
    statusEl.textContent = '检测中...';
    statusEl.style.color = 'var(--muted)';
    try {
      const result = await IKnowObsidian.checkRestApi(apiKey);
      if (result.available) {
        statusEl.textContent = `✓ Local REST API 可用 (Obsidian ${result.version}) — 将使用全面无弹窗保存`;
        statusEl.style.color = 'var(--status-active)';
      } else {
        statusEl.textContent = `未检测到插件 (${result.reason}) — 将回退到 obsidian:// 协议`;
        statusEl.style.color = 'var(--amber)';
      }
    } catch(e) {
      statusEl.textContent = '检测失败: ' + e.message;
      statusEl.style.color = 'var(--rose)';
    }
  });

  document.getElementById('btnSaveSettings')?.addEventListener('click', async () => {
    await IKnowStorage.updateSettings({
      obsidianVaultName:      document.getElementById('settingVaultName').value.trim(),
      obsidianInboxFolder:    document.getElementById('settingInboxFolder').value.trim() || 'inbox',
      obsidianRestApiKey:     document.getElementById('settingRestApiKey').value.trim(),
      obsidianSilentMode:     document.getElementById('settingObsidianSilent').checked,
      aiProvider:             document.getElementById('settingAiProvider').value,
      aiApiKey:               document.getElementById('settingAiKey').value.trim(),
      autoSummary:            document.getElementById('settingAutoSummary').checked,
      floatingButtonEnabled:  document.getElementById('settingFloatingBtn').checked,
      selectionMenuEnabled:   document.getElementById('settingSelectionMenu').checked,
    });
    const allTabs = await chrome.tabs.query({});
    for (const t of allTabs) chrome.tabs.sendMessage(t.id, { type: 'SETTINGS_UPDATED' }).catch(() => {});
    closeModal('modalSettings');
    toast('设置已保存 ✓');
  });
}

// ── IMPORT / EXPORT ────────────────────────────────────────────
function setupImportExport() {
  document.getElementById('btnExportAll')?.addEventListener('click', async () => {
    const items = await IKnowStorage.getAll();
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), {
      href: url, download: `iknow_${new Date().toISOString().slice(0,10)}.json`
    }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出 JSON ✓');
  });

  document.getElementById('importFileInput')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const result = await IKnowStorage.importAll(await file.text());
      toast(`导入成功 ${result.imported} 条`);
      await refreshStats();
    } catch (err) { toast('导入失败: ' + err.message); }
    e.target.value = '';
  });
}

// ── MODALS ─────────────────────────────────────────────────────
function setupModals() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
  });
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });
}

function openModal(id) { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

// ── TOAST ───────────────────────────────────────────────────────
function toast(msg) {
  const el = document.getElementById('toast');
  document.getElementById('toastText').textContent = msg;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 2400);
}

// ── RUNTIME MESSAGES ───────────────────────────────────────────
function handleRuntimeMessage(msg) {
  if (msg.type === 'ITEM_SAVED') {
    refreshStats();
    renderKbFilters(); // refresh to include any new custom tags
    toast('新内容已保存 ✓');
    if (currentView === 'knowledge') renderKnowledgeView();
    else if (currentView === 'readlater') renderReadLaterView();
  }
}

// ── UTILS ───────────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function subtypeLabel(s) {
  return { image_prompt:'图片提示词', article_prompt:'文章提示词', other_prompt:'其他提示词' }[s] || s;
}

// ── QUICK SITES ─────────────────────────────────────────────────
const DEFAULT_QUICK_SITES = [
  { url: 'https://www.google.com',  name: 'Google' },
  { url: 'https://github.com',      name: 'GitHub' },
  { url: 'https://chat.openai.com', name: 'ChatGPT' },
  { url: 'https://gemini.google.com', name: 'Gemini' },
  { url: 'https://www.zhihu.com',   name: '知乎' },
  { url: 'https://notion.so',       name: 'Notion' },
];

let quickSitesEditing = false;

function setupQuickSites() {
  renderQuickSites();

  document.getElementById('btnEditQuickSites')?.addEventListener('click', () => {
    quickSitesEditing = !quickSitesEditing;
    document.getElementById('quickSitesSection')?.classList.toggle('editing', quickSitesEditing);
    document.getElementById('quickSitesAdd').style.display = quickSitesEditing ? 'block' : 'none';
  });

  document.getElementById('btnAddSiteConfirm')?.addEventListener('click', async () => {
    let url = document.getElementById('addSiteUrl').value.trim();
    const name = document.getElementById('addSiteName').value.trim();
    if (!url) return;
    if (!url.startsWith('http')) url = 'https://' + url;
    await addQuickSite(url, name);
    document.getElementById('addSiteUrl').value = '';
    document.getElementById('addSiteName').value = '';
  });

  document.getElementById('btnAddSiteCancel')?.addEventListener('click', () => {
    quickSitesEditing = false;
    document.getElementById('quickSitesSection')?.classList.remove('editing');
    document.getElementById('quickSitesAdd').style.display = 'none';
  });
}

async function renderQuickSites() {
  const grid = document.getElementById('quickSitesGrid');
  if (!grid) return;

  const settings = await IKnowStorage.getSettings();
  const sites = settings.quickSites || DEFAULT_QUICK_SITES;

  grid.innerHTML = sites.map((site, i) => {
    let domain = '';
    try { domain = new URL(site.url).hostname; } catch {}
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    return `
      <a class="quick-site-item" href="${esc(site.url)}" target="_blank" rel="noopener" data-index="${i}">
        <button class="quick-site-remove" data-index="${i}" title="删除">×</button>
        <div class="quick-site-favicon">
          <img src="${favicon}" alt="" onerror="this.style.display='none'">
        </div>
        <div class="quick-site-name">${esc(site.name || domain)}</div>
      </a>`;
  }).join('') + `
    <button class="quick-site-add-btn" id="btnAddSiteInGrid" title="添加网站">+</button>`;

  // Remove buttons
  grid.querySelectorAll('.quick-site-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await removeQuickSite(parseInt(btn.dataset.index));
    });
  });

  // Add button inside grid
  grid.querySelector('#btnAddSiteInGrid')?.addEventListener('click', () => {
    quickSitesEditing = true;
    document.getElementById('quickSitesSection')?.classList.add('editing');
    document.getElementById('quickSitesAdd').style.display = 'block';
    document.getElementById('addSiteUrl')?.focus();
  });
}

async function addQuickSite(url, name) {
  const settings = await IKnowStorage.getSettings();
  const sites = settings.quickSites || [...DEFAULT_QUICK_SITES];
  let domain = '';
  try { domain = new URL(url).hostname.replace('www.', ''); } catch {}
  sites.push({ url, name: name || domain });
  await IKnowStorage.updateSettings({ quickSites: sites });
  await renderQuickSites();
  toast('网站已添加 ✓');
}

async function removeQuickSite(index) {
  const settings = await IKnowStorage.getSettings();
  const sites = settings.quickSites || [...DEFAULT_QUICK_SITES];
  sites.splice(index, 1);
  await IKnowStorage.updateSettings({ quickSites: sites });
  await renderQuickSites();
}
