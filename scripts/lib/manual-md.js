// マニュアルの原稿（docs/マニュアル/*.md）を読む純粋関数。build-manual.js と試験から使う。
'use strict';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// 先頭の --- ... --- を読む（値は文字のまま。カンマ区切りの項目は配列に）
const LIST_KEYS = ['covers', 'watch'];
function parseFront(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  const meta = {};
  if (!m) return { meta, body: src };
  m[1].split(/\r?\n/).forEach(line => {
    const k = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (!k) return;
    meta[k[1]] = k[2].trim();
  });
  LIST_KEYS.forEach(k => { meta[k] = String(meta[k] || '').split(',').map(s => s.trim()).filter(Boolean); });
  meta.order = Number(meta.order) || 999;
  return { meta, body: src.slice(m[0].length) };
}

// ```lesson ... ``` を取り出す
function parseLesson(text) {
  const L = { id: '', title: '', open: '', steps: [] };
  text.split(/\r?\n/).forEach(line => {
    const m = /^(id|title|open|step|click|else):\s*(.*)$/.exec(line.trim());
    if (!m) return;
    if (m[1] === 'step' || m[1] === 'click' || m[1] === 'else') {
      const i = m[2].indexOf('|');
      const sel = (i < 0 ? '-' : m[2].slice(0, i)).trim();
      const txt = (i < 0 ? m[2] : m[2].slice(i + 1)).trim();
      const st = { sel: sel === '-' ? '' : sel, text: txt };
      // else: 直前の手順の場所が画面に無いときの、代わりの場所と説明（「-」なら説明だけ）
      if (m[1] === 'else') { const prev = L.steps[L.steps.length - 1]; if (prev && !prev.alt) prev.alt = st; return; }
      st.wait = m[1] === 'click';
      L.steps.push(st);
    } else L[m[1]] = m[2].trim();
  });
  return L;
}

// 行の中の書式：**太字**・`ボタン`・[文字](#manual:id)
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/\[([^\]]+)\]\(#manual:([a-z0-9-]+)\)/g, '<a href="#" class="man-link" data-man="$2">$1</a>');
  return t;
}

// 本文 → HTML（小さな書式だけ）。lessons と plain text も返す
function renderBody(body) {
  const lines = body.split(/\r?\n/);
  const out = [], lessons = [], text = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); text.push(para.join(' ')); para = []; } };
  const flushList = () => { if (list) { out.push('<' + list.tag + '>' + list.items.map(x => '<li>' + inline(x) + '</li>').join('') + '</' + list.tag + '>'); text.push(list.items.join('\n')); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```lesson\s*$/.test(line.trim())) {
      flushPara(); flushList();
      const buf = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i].trim()); i++) buf.push(lines[i]);
      const L = parseLesson(buf.join('\n'));
      if (L.id && L.steps.length) { lessons.push(L); out.push('<div class="man-lesson-slot" data-lesson="' + esc(L.id) + '"></div>'); }
      continue;
    }
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = /^(#{2,3})\s+(.*)$/.exec(line))) { flushPara(); flushList(); const h = m[1].length === 2 ? 'h3' : 'h4'; out.push('<' + h + '>' + inline(m[2]) + '</' + h + '>'); text.push(m[2]); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); flushList(); out.push('<div class="man-note">' + inline(m[1]) + '</div>'); text.push(m[1]); continue; }
    if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = /^\s*\d+\.\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    flushList(); para.push(line.trim());
  }
  flushPara(); flushList();
  const plain = text.join('\n').replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\(#manual:[a-z0-9-]+\)/g, '$1');
  return { html: out.join('\n'), lessons, text: plain };
}

function parseChapter(src, file) {
  const { meta, body } = parseFront(src);
  const r = renderBody(body);
  return {
    id: meta.id || '', title: meta.title || '', group: meta.group || 'その他', order: meta.order,
    level: meta.level || '', open: meta.open || '', covers: meta.covers, watch: meta.watch,
    updated: meta.updated || '', file: file || '', html: r.html, text: r.text, lessons: r.lessons,
  };
}

// 画面（index.html の .cat-btn）の一覧＝監視の対象
function featureInventory(indexHtml) {
  const out = [], seen = new Set();
  const re = /<button[^>]*class="cat-btn[^"]*"[^>]*aria-controls="(tab-[^"]+)"[^>]*>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(indexHtml))) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    const tag = m[0];
    const desc = (/data-desc="([^"]*)"/.exec(tag) || /title="([^"]*)"/.exec(tag) || [])[1] || '';
    const label = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    out.push({ tab: m[1], label, desc });
  }
  return out;
}

// 監視の判定：未記載の画面・見直しが要る章（watch のファイルが updated より後に変わった）
// lastChange(paths) → [{date:'YYYY-MM-DD', subject}]（updated より後の変更）を返す関数を渡す
function checkChapters(chapters, inventory, changesSince, appRoot, exists) {
  const covered = new Set();
  chapters.forEach(c => c.covers.forEach(t => covered.add(t)));
  const missing = inventory.filter(f => !covered.has(f.tab));
  const problems = [];
  const ids = new Set();
  chapters.forEach(c => {
    if (!c.id) problems.push(c.file + '：id がありません');
    else if (ids.has(c.id)) problems.push(c.file + '：id「' + c.id + '」が重なっています'); else ids.add(c.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.updated)) problems.push(c.file + '：updated が日付（YYYY-MM-DD）ではありません');
    c.watch.forEach(w => { if (exists && !exists(w)) problems.push(c.file + '：watch のファイルが見つかりません（' + w + '）'); });
  });
  chapters.forEach(c => {
    (c.html.match(/data-man="([a-z0-9-]+)"/g) || []).forEach(x => { const id = x.slice(10, -1); if (!ids.has(id)) problems.push(c.file + '：リンク先の章「' + id + '」がありません'); });
  });
  const stale = [];
  chapters.forEach(c => {
    if (!c.watch.length || !/^\d{4}-\d{2}-\d{2}$/.test(c.updated)) return;
    const ch = changesSince(c.watch, c.updated) || [];
    if (ch.length) stale.push({ id: c.id, title: c.title, updated: c.updated, changes: ch });
  });
  return { missing, stale, problems };
}

module.exports = { esc, parseFront, parseLesson, renderBody, parseChapter, featureInventory, checkChapters };
