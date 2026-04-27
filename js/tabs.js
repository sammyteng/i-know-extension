/* ============================================================
   i know — Tab Management (inherited + enhanced from tab-out)
   ============================================================ */
'use strict';

const IKnowTabs = (() => {

  let openTabs = [];

  // ── Fetch & Group ───────────────────────────────────────────

  async function fetchOpenTabs() {
    try {
      const extensionId = chrome.runtime.id;
      const newtabUrl = `chrome-extension://${extensionId}/index.html`;
      const tabs = await chrome.tabs.query({});
      openTabs = tabs.map(t => ({
        id:       t.id,
        url:      t.url,
        title:    t.title,
        favIconUrl: t.favIconUrl,
        windowId: t.windowId,
        active:   t.active,
        isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
      }));
    } catch {
      openTabs = [];
    }
  }

  function getOpenTabs() { return openTabs; }

  function groupTabsByDomain(tabs) {
    const LANDING_PAGES = [
      { pattern: /^https?:\/\/(mail\.google\.com|gmail\.com)\/?($|\?)/, label: 'Gmail' },
      { pattern: /^https?:\/\/(www\.)?twitter\.com\/?$/, label: 'X' },
      { pattern: /^https?:\/\/(www\.)?x\.com\/?$/, label: 'X' },
      { pattern: /^https?:\/\/(www\.)?youtube\.com\/?$/, label: 'YouTube' },
      { pattern: /^https?:\/\/(www\.)?linkedin\.com\/(feed|in\/me)\/?/, label: 'LinkedIn' },
      { pattern: /^https?:\/\/(www\.)?github\.com\/?$/, label: 'GitHub' },
      { pattern: /^https?:\/\/(www\.)?reddit\.com\/?$/, label: 'Reddit' },
      { pattern: /^https?:\/\/(www\.)?notion\.so\/?$/, label: 'Notion' },
    ];

    const webTabs = tabs.filter(t => {
      const url = t.url || '';
      return !url.startsWith('chrome://') &&
             !url.startsWith('chrome-extension://') &&
             !url.startsWith('about:') &&
             !url.startsWith('edge://');
    });

    const groups = new Map();
    const landingGroup = { label: '主页', tabs: [], isLanding: true };

    for (const tab of webTabs) {
      let isLanding = false;
      for (const lp of LANDING_PAGES) {
        if (lp.pattern.test(tab.url)) {
          isLanding = true;
          landingGroup.tabs.push({ ...tab, landingLabel: lp.label });
          break;
        }
      }
      if (isLanding) continue;

      // localhost grouping
      let domain;
      try {
        const u = new URL(tab.url);
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
          domain = `localhost:${u.port || 80}`;
        } else {
          domain = u.hostname.replace(/^www\./, '');
        }
      } catch {
        domain = tab.url.slice(0, 30);
      }

      if (!groups.has(domain)) {
        groups.set(domain, { label: domain, tabs: [], isLanding: false });
      }
      groups.get(domain).tabs.push(tab);
    }

    const result = [];
    if (landingGroup.tabs.length > 0) result.push(landingGroup);
    for (const [, g] of groups) result.push(g);
    return result;
  }

  // ── Tab Actions ─────────────────────────────────────────────

  async function closeTabsByDomain(domain) {
    const allTabs = await chrome.tabs.query({});
    const toClose = allTabs.filter(t => {
      try {
        const h = new URL(t.url).hostname.replace(/^www\./, '');
        return h === domain || t.url.includes(domain);
      } catch { return false; }
    }).map(t => t.id);
    if (toClose.length) await chrome.tabs.remove(toClose);
    await fetchOpenTabs();
    return toClose.length;
  }

  async function closeTabsExact(urls) {
    if (!urls?.length) return;
    const urlSet = new Set(urls);
    const allTabs = await chrome.tabs.query({});
    const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
    if (toClose.length) await chrome.tabs.remove(toClose);
    await fetchOpenTabs();
  }

  async function focusTab(url) {
    if (!url) return;
    const allTabs = await chrome.tabs.query({});
    const currentWindow = await chrome.windows.getCurrent();
    let matches = allTabs.filter(t => t.url === url);
    if (!matches.length) {
      try {
        const host = new URL(url).hostname;
        matches = allTabs.filter(t => {
          try { return new URL(t.url).hostname === host; } catch { return false; }
        });
      } catch {}
    }
    if (!matches.length) return;
    const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
    await chrome.tabs.update(match.id, { active: true });
    await chrome.windows.update(match.windowId, { focused: true });
  }

  async function closeTabOutDupes() {
    const extensionId = chrome.runtime.id;
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;
    const allTabs = await chrome.tabs.query({});
    const currentWindow = await chrome.windows.getCurrent();
    const tabOutTabs = allTabs.filter(t => t.url === newtabUrl || t.url === 'chrome://newtab/');
    if (tabOutTabs.length <= 1) return;
    const keep = tabOutTabs.find(t => t.active && t.windowId === currentWindow.id)
              || tabOutTabs.find(t => t.active)
              || tabOutTabs[0];
    const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
    if (toClose.length) await chrome.tabs.remove(toClose);
    await fetchOpenTabs();
  }

  async function getTabOutDupeCount() {
    const extensionId = chrome.runtime.id;
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;
    const allTabs = await chrome.tabs.query({});
    return allTabs.filter(t => t.url === newtabUrl || t.url === 'chrome://newtab/').length;
  }

  // ── UI Helpers ──────────────────────────────────────────────

  function playCloseSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const t = ctx.currentTime;
      const duration = 0.25;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const pos = i / data.length;
        const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
        data[i] = (Math.random() * 2 - 1) * env;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 2.0;
      filter.frequency.setValueAtTime(4000, t);
      filter.frequency.exponentialRampToValueAtTime(400, t + duration);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      source.connect(filter).connect(gain).connect(ctx.destination);
      source.start(t);
      setTimeout(() => ctx.close(), 500);
    } catch {}
  }

  function shootConfetti(x, y) {
    const colors = ['#6c5ce7','#a29bfe','#00cec9','#81ecec','#fd79a8','#fab1a0','#fdcb6e'];
    for (let i = 0; i < 16; i++) {
      const el = document.createElement('div');
      const size = 5 + Math.random() * 7;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const isCircle = Math.random() > 0.4;
      el.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${color};border-radius:${isCircle ? '50%' : '2px'};pointer-events:none;z-index:9999;transform:translate(-50%,-50%);opacity:1;`;
      document.body.appendChild(el);
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed - 80;
      const gravity = 200;
      const startTime = performance.now();
      const dur = 700 + Math.random() * 200;
      function frame(now) {
        const elapsed = (now - startTime) / 1000;
        const progress = elapsed / (dur / 1000);
        if (progress >= 1) { el.remove(); return; }
        const px = vx * elapsed;
        const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
        const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
        el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${elapsed * 200}deg)`;
        el.style.opacity = opacity;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
  }

  function getFaviconUrl(domain) {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins}分钟前`;
    if (hrs < 24) return `${hrs}小时前`;
    if (days === 1) return '昨天';
    return `${days}天前`;
  }

  return {
    fetchOpenTabs,
    getOpenTabs,
    groupTabsByDomain,
    closeTabsByDomain,
    closeTabsExact,
    focusTab,
    closeTabOutDupes,
    getTabOutDupeCount,
    playCloseSound,
    shootConfetti,
    getFaviconUrl,
    timeAgo,
  };
})();
