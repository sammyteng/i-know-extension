/* ============================================================
   i know — Obsidian 集成 v2
   策略：追加一行到收集箱，不提取正文
   格式：- [ ] [标题](URL) · `站点` · 关键词 · 时间

   三级兜底：
   A. Local REST API  POST /vault/{file}  (append)
   B. obsidian:// URI &append=true &silent=true &clipboard
   C. 复制到剪贴板，提示手动粘贴
   ============================================================ */
'use strict';

const IKnowObsidian = (() => {

  const REST_PORT = 27123;
  const REST_BASE = `http://localhost:${REST_PORT}`;

  // ── 构建一行收集条目 ────────────────────────────────────────
  // - [ ] [标题](URL) · `来源` · 关键词 · 04-24 10:30
  function buildLine(item) {
    const title    = (item.title || item.sourceUrl || '未命名').replace(/[\[\]]/g, '');
    const url      = item.sourceUrl || item.url || '';
    const site     = item.sourceDomain || item.site ||
                     (url ? new URL(url).hostname.replace('www.', '') : '');
    const keywords = (item.tags || []).join(' ') ||
                     (item.content || '').replace(/\s+/g, ' ').slice(0, 40) || '';
    const now      = new Date();
    const time     = `${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')} ` +
                     `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    const parts = [`- [ ] [${title}](${url})`];
    if (site)     parts.push(`\`${site}\``);
    if (keywords) parts.push(keywords);
    parts.push(time);
    return parts.join(' · ') + '\n';
  }

  // ── 获取设置 ────────────────────────────────────────────────
  async function getSettings() {
    try {
      const { iknow_settings: s = {} } = await chrome.storage.local.get('iknow_settings');
      return s;
    } catch { return {}; }
  }

  // ── 检测 REST API ───────────────────────────────────────────
  async function checkRestApi(apiKey = '') {
    try {
      const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
      const res = await fetch(`${REST_BASE}/`, { headers, signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        return { available: true, version: j.versions?.obsidian || '?' };
      }
      return { available: false, reason: `HTTP ${res.status}` };
    } catch (e) {
      return { available: false, reason: e.message };
    }
  }

  // ── 核心：追加一行到收集箱 ──────────────────────────────────
  async function appendToInbox(item, overrideOpts = {}) {
    const s       = await getSettings();
    const vault   = overrideOpts.vault   || s.obsidianVaultName    || '';
    const folder  = (overrideOpts.folder || s.obsidianInboxFolder  || '00 inbox').replace(/\/$/, '');
    const apiKey  = s.obsidianRestApiKey  || '';
    const silent  = s.obsidianSilentMode !== false;
    const boxFile = `${folder}/iknow收集箱.md`;
    const line    = buildLine(item);

    // ── A: Local REST API POST (append) ──────────────────────
    // Encode each segment separately so the folder slash is preserved
    const encodedPath = boxFile.split('/').map(s => encodeURIComponent(s)).join('/');
    try {
      const headers = { 'Content-Type': 'text/markdown; charset=utf-8' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      // POST appends to existing file (official Obsidian REST API behavior)
      let res = await fetch(`${REST_BASE}/vault/${encodedPath}`, {
        method: 'POST', headers, body: line,
        signal: AbortSignal.timeout(3000),
      });
      // If file doesn't exist yet, create it with PUT first then POST
      if (res.status === 404) {
        await fetch(`${REST_BASE}/vault/${encodedPath}`, {
          method: 'PUT', headers, body: line,
          signal: AbortSignal.timeout(3000),
        });
        return { success: true, method: 'rest-api-created', line };
      }
      if (res.ok || res.status === 204) {
        return { success: true, method: 'rest-api', line };
      }
    } catch {}

    // ── B: 降级到剪贴板 ───────────────────────────────────────
    try {
      await navigator.clipboard.writeText(line);
      return { success: true, method: 'clipboard', line };
    } catch {
      return { success: false, error: 'REST API 失败，且无法写入剪贴板' };
    }
  }

  // ── 批量导出（主面板 → 导出多条）──────────────────────────
  async function appendBatch(items) {
    const s      = await getSettings();
    const vault  = s.obsidianVaultName   || '';
    const folder = (s.obsidianInboxFolder || '00 inbox').replace(/\/$/, '');
    const apiKey = s.obsidianRestApiKey   || '';
    const boxFile = `${folder}/iknow收集箱.md`;
    const lines  = items.map(buildLine).join('');

    try {
      const headers = { 'Content-Type': 'text/markdown; charset=utf-8' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const encodedBatchPath = boxFile.split('/').map(s => encodeURIComponent(s)).join('/');
      let res = await fetch(`${REST_BASE}/vault/${encodedBatchPath}`, {
        method: 'POST', headers, body: lines,
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 404) {
        res = await fetch(`${REST_BASE}/vault/${encodedBatchPath}`, {
          method: 'PUT', headers, body: lines,
          signal: AbortSignal.timeout(5000),
        });
      }
      if (res.ok || res.status === 204) return { success: true, method: 'rest-api' };
    } catch {}

    // Fallback: clipboard
    try {
      await navigator.clipboard.writeText(lines);
      return { success: true, method: 'clipboard', note: '已复制，请粘贴到 Obsidian 收集箱' };
    } catch {
      return { success: false, error: '无法写入剪贴板' };
    }
  }

  // ── AI 摘要 (Gemini) ────────────────────────────────────────
  async function generateSummary(text, customPrompt = '') {
    const s = await getSettings();
    if (!s.geminiApiKey || !text) return '';
    const prompt = customPrompt ||
      `请用3-5句话简洁总结以下内容，中文输出，保留核心要点：\n\n${text.slice(0, 5000)}`;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${s.geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 400, temperature: 0.3 },
          }),
        }
      );
      const j = await res.json();
      return j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    } catch { return ''; }
  }

  return { appendToInbox, appendBatch, checkRestApi, buildLine, generateSummary };

})();
