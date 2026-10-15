#!/usr/bin/env node
// Industry テーマ生成：Claude Design から受け取った「Industry 版 CSS 一式」を、
// 「現行 CSS との差分だけ」を取り出した"着せ替えレイヤー"（theme-industry*.css）に変換する。
//
// 目的：現行の CSS を 1 文字も書き換えずに、Industry デザインを「オン／オフで切替・いつでも元に戻せる」形で載せる。
//   <html class="theme-industry">      … サイト画面を Industry に（theme-industry.css が効く）
//   <html class="theme-industry-doc">  … 御見積書を Industry に（theme-industry-doc.css が効く）
//   クラスが無ければ、生成した CSS は一切効かない＝現行デザインのまま（既定）。
//
// 仕組み：
//   ・Design の style.css / quote.css / quote-pdf.css / tokens*.css を現行と比べ、値が違う宣言だけを出力
//   ・各セレクタの先頭に :where(html.theme-industry) を付ける（詳細度ゼロ＝元のルールどうしの優先関係を変えない）
//   ・Design が追加した 3 ファイル（quote-table / quote-hierarchy / blueprint）も同じ方式で丸ごと包む
//
// 使い方（リポジトリ直下から）：
//   node scripts/build-industry-theme.js            生成（css/theme-industry.css, css/theme-industry-doc.css）
//   node scripts/build-industry-theme.js --check    生成物が最新か確認（差があれば終了コード1）
//
// 入力：docs/design-handoff/industry/css/（Design から受け取った一式をそのまま保管）
// 依存パッケージなし。

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SITE = path.join(REPO, 'フォワーダー支援', 'css');
const SRC = path.join(REPO, 'docs', 'design-handoff', 'industry', 'css');
const CHECK = process.argv.includes('--check');

const T_SITE = 'html.theme-industry';
const T_DOC = 'html.theme-industry-doc';

const read = f => fs.readFileSync(f, 'utf8');
const norm = s => s.replace(/\s+/g, ' ').replace(/\s*([:;,])\s*/g, '$1').trim();

// ---------- CSS パーサ（コメント除去→ブロック構造化） ----------
function stripComments(css) {
  let out = '', i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") { // 文字列
      let j = i + 1;
      while (j < css.length && css[j] !== c) { if (css[j] === '\\') j++; j++; }
      out += css.slice(i, j + 1); i = j + 1;
    } else if (c === '/' && css[i + 1] === '*') {
      const j = css.indexOf('*/', i + 2); i = j < 0 ? css.length : j + 2;
    } else { out += c; i++; }
  }
  return out;
}
// 括弧・文字列の外で ch が現れる位置
function findTop(s, chars, from = 0) {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { i++; while (i < s.length && s[i] !== c) { if (s[i] === '\\') i++; i++; } continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && chars.includes(c)) return i;
  }
  return -1;
}
function splitTop(s, ch) {
  const parts = []; let from = 0;
  for (;;) {
    const i = findTop(s, ch, from);
    if (i < 0) { parts.push(s.slice(from)); break; }
    parts.push(s.slice(from, i)); from = i + 1;
  }
  return parts.map(p => p.trim()).filter(Boolean);
}
function matchBrace(s, open) { // s[open] === '{'
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { i++; while (i < s.length && s[i] !== c) { if (s[i] === '\\') i++; i++; } continue; }
    if (c === '(') { // url(data:...;...) などは括弧内をまるごと読み飛ばす
      let d = 1; i++;
      while (i < s.length && d) { if (s[i] === '(') d++; else if (s[i] === ')') d--; i++; }
      i--; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return i; }
  }
  return s.length - 1;
}
const NESTED_AT = /^@(media|supports|container|layer|document)\b/i;
function parse(css) {
  css = stripComments(css);
  const nodes = []; let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    const semi = findTop(css, ';', i), brace = findTop(css, '{', i);
    if (brace < 0 || (semi >= 0 && semi < brace)) { // @import など
      const end = semi < 0 ? css.length : semi;
      nodes.push({ type: 'raw', text: css.slice(i, end).trim() + ';' }); i = end + 1; continue;
    }
    const head = css.slice(i, brace).trim();
    const close = matchBrace(css, brace);
    const body = css.slice(brace + 1, close);
    if (head.startsWith('@')) {
      if (NESTED_AT.test(head)) nodes.push({ type: 'at', head, children: parse(body) });
      else nodes.push({ type: 'rawblock', head, text: `${head}{${body}}` }); // @keyframes / @font-face など
    } else nodes.push({ type: 'rule', sel: head, decls: parseDecls(body) });
    i = close + 1;
  }
  return nodes;
}
function parseDecls(body) {
  return splitTop(body, ';').map(d => {
    const k = findTop(d, ':');
    if (k < 0) return null;
    return { prop: d.slice(0, k).trim(), val: d.slice(k + 1).trim() };
  }).filter(Boolean);
}

// ---------- 差分 ----------
const warns = [];
function declKey(d) { return norm(d.prop + ':' + d.val); }
// base と design を突き合わせ、design 側で違う宣言だけを持つノード列を返す
function diffNodes(base, design, ctx) {
  const baseIdx = new Map();
  base.forEach(n => {
    const k = nodeKey(n); baseIdx.set(k, (baseIdx.get(k) || []).concat(n));
  });
  const seen = new Map(); const out = [];
  for (const n of design) {
    const k = nodeKey(n); const c = seen.get(k) || 0; seen.set(k, c + 1);
    const b = (baseIdx.get(k) || [])[c];
    if (n.type === 'rule') {
      if (!b) { out.push(n); continue; }                     // Design で新設されたルール
      const have = new Set(b.decls.map(declKey));
      const changed = n.decls.filter(d => !have.has(declKey(d)));
      if (changed.length) out.push({ type: 'rule', sel: n.sel, decls: changed });
      const dk = new Set(n.decls.map(d => d.prop.toLowerCase()));
      const gone = b.decls.filter(d => !dk.has(d.prop.toLowerCase()));
      if (gone.length) warns.push(`${ctx}: ${n.sel.slice(0, 50)} から ${gone.map(g => g.prop).join(', ')} が無くなっています（テーマでは打ち消さず現行のまま）`);
    } else if (n.type === 'at') {
      const sub = diffNodes(b ? b.children : [], n.children, ctx);
      if (sub.length) out.push({ type: 'at', head: n.head, children: sub });
    } else if (n.type === 'rawblock') {
      if (!b || norm(b.text) !== norm(n.text)) warns.push(`${ctx}: ${n.head} は現行と異なりますが、グローバル名のためテーマには含めません`);
    }
  }
  return out;
}
function nodeKey(n) {
  if (n.type === 'rule') return 'r|' + norm(n.sel);
  if (n.type === 'at') return 'a|' + norm(n.head);
  if (n.type === 'rawblock') return 'b|' + norm(n.head);
  return 'x|' + norm(n.text);
}

// ---------- 出力（セレクタを :where(テーマ) で包む） ----------
function scopeSel(sel, theme) {
  return splitTop(sel, ',').map(s => {
    if (/^(:root|html)$/i.test(s)) return theme;
    if (/^(:root|html)\b/i.test(s)) return s.replace(/^(:root|html)/i, theme);
    return `:where(${theme}) ${s}`;
  }).join(',\n');
}
function emit(nodes, theme, indent = '') {
  return nodes.map(n => {
    if (n.type === 'rule') {
      const body = n.decls.map(d => `${indent}  ${d.prop}: ${d.val};`).join('\n');
      return `${indent}${scopeSel(n.sel, theme).replace(/\n/g, '\n' + indent)} {\n${body}\n${indent}}`;
    }
    if (n.type === 'at') return `${indent}${n.head} {\n${emit(n.children, theme, indent + '  ')}\n${indent}}`;
    return '';
  }).filter(Boolean).join('\n');
}
const countRules = nodes => nodes.reduce((a, n) => a + (n.type === 'rule' ? 1 : n.type === 'at' ? countRules(n.children) : 0), 0);

// ---------- 組み立て ----------
function rdoc(name, dir) { return parse(read(path.join(dir, name))); }
function section(title, css) { return `\n/* ===== ${title} ===== */\n${css}\n`; }

const HEADER = (theme, what) => `/* AUTO-GENERATED by scripts/build-industry-theme.js — 手で編集しないこと（再生成で上書きされます）。
 * ${what}
 * <html class="${theme.replace('html.', '').replace(/\./g, ' ')}"> のときだけ効く着せ替えレイヤー。クラスを外せば現行デザインに戻る。
 * 元データ：docs/design-handoff/industry/css/（Claude Design からの引き渡し）。現行 CSS との差分のみ収録。
 * セレクタは :where(${theme}) で包み、詳細度を増やさない（現行ルールどうしの優先関係をそのまま保つ）。 */\n`;

function build() {
  // ---- サイト ----
  const tok = diffNodes(rdoc('tokens.css', SITE), rdoc('tokens.css', SRC), 'tokens.css');
  const sty = diffNodes(rdoc('style.css', SITE), rdoc('style.css', SRC), 'style.css');
  const quo = diffNodes(rdoc('quote.css', SITE), rdoc('quote.css', SRC), 'quote.css');
  const addons = ['quote-table-industry.css', 'quote-hierarchy-industry.css', 'blueprint-industry.css', 'quote-table-fb03.css', 'quote-row-stage1-industry.css', 'quote-row-stage2-industry.css', 'code-overrides-industry.css'];   // fb03＝見積テーブル改善7件／row-stage1・2＝行レイアウト再整理（3段固定・「その他 ▾」パネル）／code-overrides＝code 側の補正（最後）
  let site = HEADER(T_SITE, 'サイト画面（ポータル／見積タブ）の Industry 版：鋼青のブループリント調');
  site += section('tokens（色・書体・角丸）', emit(tok, T_SITE));
  site += section('style.css 差分', emit(sty, T_SITE));
  site += section('quote.css 差分', emit(quo, T_SITE));
  const stat = { tokens: countRules(tok), style: countRules(sty), quote: countRules(quo) };
  for (const f of addons) {
    const nodes = rdoc(f, SRC);
    site += section(`${f}（Design 追加分）`, emit(nodes, T_SITE));
    stat[f] = countRules(nodes);
  }
  // ---- 御見積書 ----
  const dtok = diffNodes(rdoc('tokens-doc.css', SITE), rdoc('tokens-doc.css', SRC), 'tokens-doc.css');
  const dpdf = diffNodes(rdoc('quote-pdf.css', SITE), rdoc('quote-pdf.css', SRC), 'quote-pdf.css');
  let doc = HEADER(T_DOC, '御見積書（プレビュー／印刷／PDF）の Industry 版：配色・書体のみ。サイト画面の設定とは独立して切り替える');
  doc += section('tokens-doc（御見積書の色・書体）', emit(dtok, T_DOC));
  doc += section('quote-pdf.css 差分', emit(dpdf, T_DOC));
  stat['doc-tokens'] = countRules(dtok); stat['quote-pdf'] = countRules(dpdf);
  return { site, doc, stat };
}

const { site, doc, stat } = build();
const outSite = path.join(SITE, 'theme-industry.css');
const outDoc = path.join(SITE, 'theme-industry-doc.css');
if (CHECK) {
  const same = fs.existsSync(outSite) && fs.existsSync(outDoc) && read(outSite) === site && read(outDoc) === doc;
  console.log(same ? 'OK：テーマ CSS は最新です。' : 'NG：テーマ CSS が元データと一致しません。node scripts/build-industry-theme.js で再生成してください。');
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(outSite, site);
fs.writeFileSync(outDoc, doc);
console.log('収録ルール数：', JSON.stringify(stat));
console.log(`theme-industry.css ${(site.length / 1024).toFixed(1)}KB / theme-industry-doc.css ${(doc.length / 1024).toFixed(1)}KB`);
warns.forEach(w => console.log('⚠️  ' + w));
