#!/usr/bin/env node
/*
 * build-roadmap.js — アイデア台帳 → ユーザー公開用ロードマップ生成
 *
 * docs/アイデア台帳.md を読み、フォワーダー支援/roadmap.html を生成する。
 * 台帳を編集したら `node scripts/build-roadmap.js` を実行して再生成すること（単一ソース）。
 *
 * 公開ポリシー（ユーザー合意・2026-06-09）:
 *   - 「事業化・売却・譲渡」など経営方針の項目は丸ごと非公開
 *   - 該当箇所・テーブル案・SQL・ファイルパス等の「内部メモ・技術詳細」は除去
 *   - 完了済み（[x]）はセクションを問わず「✅ 実装済み」へ集約
 *   - 安全網として、機微語を含む行は最終出力から強制除去
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'docs', 'アイデア台帳.md');
const OUT = path.join(__dirname, '..', 'フォワーダー支援', 'roadmap.html');

// ---- 公開ポリシー（フィルタ） ---------------------------------------------
// タイトルにこれを含む項目は丸ごと非公開
const TITLE_BLOCK = /事業化|売却|譲渡/;
// 機微語：含む行は常に除去（安全網）
const FORBIDDEN = /SUPABASE_SERVICE_KEY|service_role|service key|settings\.local\.json|supabase\.co|\bJWT\b|API\s*キー|事業化|売却|譲渡/i;
// 技術・内部メモ：含む行は除去（ファイルパス・コード識別子・SQL・テーブル名など）
const DEVLINE = /\.(js|ts|html|css)(\b|:)|`[^`]*\.(js|ts|html|css)|index\.html|\bjs\/|\bcss\/|\bdata\/|window\.\w|gatherAllData|_applyQuoteData|CMD_LIST|localStorage|\bjsonb\b|\bRLS\b|is_team_member|allowed_emails|quote_presets|row_patterns|user_profiles|surcharge_master|notification_templates|quote_comments|bookmarks\b|onConflict|updated_at|created_by|\bSELECT\b|\bINSERT\b|ALTER TABLE|CREATE OR REPLACE|\{\s*id\s*,/i;
// 本文で表示を許可する先頭ラベル（これ以外のラベル付き行は内部メモとみなし除去）
const LABEL_WHITELIST = ['背景', '期待する動作', '期待する挙動', 'メリット', '活用例', '概要',
  '想定する連携場面', '想定する分析軸', '想定する場面', '構成案', '検証結果', '想定する動作',
  '機能', '管理項目', 'UX の流れ', '使い分け'];

// ---- ユーティリティ --------------------------------------------------------
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// markdown インライン → HTML（エスケープ後に code / strong を復元）
function inline(s) {
  let h = esc(s);
  h = h.replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return h;
}
// 行がラベル付きなら先頭ラベルを返す（なければ null）
function labelOf(text) {
  const m = text.match(/^([^:：]{1,24})[:：]\s*/);
  return m ? m[1].trim() : null;
}
function labelAllowed(label) {
  return LABEL_WHITELIST.some(w => label.startsWith(w));
}

// ---- 解析 ------------------------------------------------------------------
const md = fs.readFileSync(SRC, 'utf8');
const lines = md.split(/\r?\n/);

// 台帳の最終更新日
let updated = '';
for (const l of lines) { const m = l.match(/最終更新:\s*([0-9-]+)/); if (m) { updated = m[1]; break; } }

let section = null; // 'high' | 'mid' | 'low' | 'idea' | 'done'
const buckets = { high: [], mid: [], low: [], idea: [], done: [] };

function sectionOf(heading) {
  if (heading.includes('🔴')) return 'high';
  if (heading.includes('🟠')) return 'mid';
  if (heading.includes('🟡')) return 'low';
  if (heading.includes('🔵')) return 'idea';
  if (heading.includes('完了済み')) return 'done';
  return null;
}

// 項目本文（サブ箇条書き）を公開用に整形
function cleanBody(bodyLines) {
  const out = [];
  let inCode = false;
  let keepChildren = false;
  for (const raw of bodyLines) {
    const t = raw.trim();
    if (t.startsWith('```')) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = raw.match(/^(\s*)-\s+(.*)$/);
    if (!m) continue;                       // 箇条書き以外（散文・空行・ascii図）は捨てる
    const indent = m[1].length;
    const text = m[2].trim();
    if (!text) continue;
    if (FORBIDDEN.test(text) || DEVLINE.test(text)) { if (indent <= 2) keepChildren = false; continue; }
    if (indent <= 2) {
      // 先頭レベル
      const label = labelOf(text);
      if (label && !labelAllowed(label)) { keepChildren = false; continue; } // 内部ラベルは除去
      out.push({ lvl: 0, text });
      keepChildren = true;
    } else {
      // ネスト（採用された親の補足のみ残す）
      if (keepChildren) out.push({ lvl: 1, text });
    }
  }
  return out;
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const h2 = line.match(/^##\s+(.*)$/);
  if (h2) { section = sectionOf(h2[1]); continue; }
  if (!section) continue;
  const it = line.match(/^- \[([ x])\]\s+\*\*(.+?)\*\*(.*)$/);
  if (!it) continue;
  const done = it[1] === 'x';
  let title = it[2].trim();
  if (TITLE_BLOCK.test(title)) continue;          // 経営方針などは丸ごと非公開
  title = title.replace(/\s*✅.*$/, '').trim();    // 完了マークの注記は落とす
  // 本文収集（次の項目／見出しまで）
  const body = [];
  let j = i + 1;
  for (; j < lines.length; j++) {
    if (/^- \[[ x]\]\s+\*\*/.test(lines[j])) break;
    if (/^#{2,3}\s+/.test(lines[j])) break;
    body.push(lines[j]);
  }
  const bucket = done ? 'done' : section;
  if (bucket === 'done') buckets.done.push({ title });
  else buckets[bucket].push({ title, body: cleanBody(body) });
  i = j - 1;
}

// ---- HTML 生成 -------------------------------------------------------------
function bodyHtml(items) {
  if (!items.length) return '';
  let html = '<ul class="rm-desc">';
  let open = false;
  for (const b of items) {
    if (b.lvl === 0) {
      if (open) html += '</ul></li>';
      html += '<li>' + inline(b.text);
      open = true;
      html += '<ul class="rm-sub">';
    } else {
      html += '<li>' + inline(b.text) + '</li>';
    }
  }
  if (open) html += '</ul></li>';
  html += '</ul>';
  // 空の <ul class="rm-sub"></ul> を畳む
  return html.replace(/<ul class="rm-sub"><\/ul>/g, '');
}

function cardsHtml(items, badgeClass, badgeText) {
  return items.map(it =>
    '<article class="rm-card">' +
      '<div class="rm-card-head"><span class="rm-badge ' + badgeClass + '">' + badgeText + '</span>' +
      '<h3 class="rm-card-title">' + inline(it.title) + '</h3></div>' +
      bodyHtml(it.body) +
    '</article>'
  ).join('\n');
}

const SECTIONS = [
  { key: 'high', icon: '🔴', title: '優先度：高（早急に対応したい改修）', badge: 'rm-badge--high', badgeText: '高' },
  { key: 'mid',  icon: '🟠', title: '優先度：中（あると便利・品質向上）', badge: 'rm-badge--mid',  badgeText: '中' },
  { key: 'low',  icon: '🟡', title: '将来的に対応を検討',                 badge: 'rm-badge--low',  badgeText: '将来' },
  { key: 'idea', icon: '💡', title: '構想・検討中のアイデア',             badge: 'rm-badge--idea', badgeText: '構想' },
];

let sectionsHtml = '';
for (const s of SECTIONS) {
  const items = buckets[s.key];
  if (!items.length) continue;
  sectionsHtml +=
    '<section class="rm-section">' +
      '<h2 class="rm-h2">' + s.icon + ' ' + s.title + ' <span class="rm-count">' + items.length + '</span></h2>' +
      '<div class="rm-cards">' + cardsHtml(items, s.badge, s.badgeText) + '</div>' +
    '</section>';
}

// 実装済み（チップ一覧）
let doneHtml = '';
if (buckets.done.length) {
  doneHtml =
    '<section class="rm-section rm-done">' +
      '<h2 class="rm-h2">✅ 実装済み <span class="rm-count">' + buckets.done.length + '</span></h2>' +
      '<ul class="rm-done-list">' +
        buckets.done.map(d => '<li>' + inline(d.title) + '</li>').join('') +
      '</ul>' +
    '</section>';
}

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>改修予定・アイデア — フォワーダー支援</title>
<style>
  :root { --ink:#4a3f35; --muted:#8a7a66; --line:#e7ddcd; --bg:#f7f3ec; --card:#fff; --accent:#6b5a42; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font-family:"Noto Sans JP", system-ui, -apple-system, sans-serif; line-height:1.7; }
  .rm-wrap { max-width: 920px; margin: 0 auto; padding: 0 18px 64px; }
  .rm-top { display:flex; align-items:center; gap:12px; padding:18px 0 10px; }
  .rm-back { text-decoration:none; color:var(--accent); font-weight:700; font-size:13px;
    border:1px solid var(--line); background:#fff; padding:7px 13px; border-radius:8px; white-space:nowrap; }
  .rm-back:hover { background:#f0e8d8; }
  .rm-title { font-size:22px; font-weight:800; color:#3d2e1e; margin:0; }
  .rm-intro { background:#fbf7ef; border:1px solid var(--line); border-radius:12px;
    padding:14px 16px; font-size:13.5px; color:var(--muted); margin:6px 0 26px; }
  .rm-intro strong { color:var(--ink); }
  .rm-section { margin-bottom: 34px; }
  .rm-h2 { font-size:16px; font-weight:800; color:#3d2e1e; border-bottom:2px solid var(--line);
    padding-bottom:8px; margin:0 0 16px; display:flex; align-items:center; gap:8px; }
  .rm-count { font-size:12px; font-weight:700; color:#fff; background:var(--accent);
    border-radius:999px; padding:1px 9px; }
  .rm-cards { display:grid; gap:13px; }
  .rm-card { background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:15px 17px; box-shadow:0 2px 8px rgba(80,60,30,.05); }
  .rm-card-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap; }
  .rm-card-title { font-size:15px; font-weight:700; color:#3d2e1e; margin:0; }
  .rm-badge { font-size:11px; font-weight:800; border-radius:999px; padding:2px 10px; white-space:nowrap; }
  .rm-badge--high { background:#fdeaea; color:#c0392b; }
  .rm-badge--mid  { background:#fef3e0; color:#b9711c; }
  .rm-badge--low  { background:#fffbe6; color:#9a7d12; }
  .rm-badge--idea { background:#eef3fb; color:#3a6aa6; }
  .rm-desc { margin:6px 0 0; padding-left:20px; font-size:13.5px; color:#5a4f43; }
  .rm-desc > li { margin:3px 0; }
  .rm-sub { margin:3px 0 6px; padding-left:18px; color:var(--muted); font-size:13px; }
  .rm-desc code { background:#f3ece0; border-radius:4px; padding:0 5px; font-size:12px; }
  .rm-done-list { list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:8px; }
  .rm-done-list li { background:#e9f5ec; color:#1e7e44; border:1px solid #bfe3cb;
    border-radius:999px; padding:5px 13px; font-size:12.5px; font-weight:600; }
  .rm-done-list code { background:rgba(0,0,0,.05); border-radius:4px; padding:0 4px; font-size:11px; }
  .rm-foot { margin-top:40px; padding-top:16px; border-top:1px solid var(--line);
    font-size:12px; color:var(--muted); text-align:center; }
  @media (max-width:560px){ .rm-title{ font-size:19px; } }
</style>
</head>
<body>
  <div class="rm-wrap">
    <div class="rm-top">
      <a class="rm-back" href="index.html">← アプリに戻る</a>
      <h1 class="rm-title">📣 改修予定・アイデア</h1>
    </div>
    <p class="rm-intro">
      このページは <strong>フォワーダー支援アプリの開発ロードマップ</strong>です。
      現在対応中・検討中の改善や、今後追加したい機能を一覧にしています。<br>
      「こんな機能がほしい」「ここが使いにくい」などのご要望は、アプリ右下の
      <strong>💬 フィードバックボタン</strong>からお寄せください。優先度の参考にします。
    </p>
${sectionsHtml}
${doneHtml}
    <div class="rm-foot">
      台帳 最終更新：${esc(updated || '—')} ／ このページは docs/アイデア台帳.md から自動生成しています
    </div>
  </div>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');
const total = buckets.high.length + buckets.mid.length + buckets.low.length + buckets.idea.length + buckets.done.length;
console.log('✅ roadmap.html を生成しました');
console.log(`   高:${buckets.high.length} 中:${buckets.mid.length} 将来:${buckets.low.length} 構想:${buckets.idea.length} 実装済み:${buckets.done.length}（計${total}件）`);
console.log('   →', path.relative(path.join(__dirname, '..'), OUT));
