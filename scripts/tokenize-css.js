#!/usr/bin/env node
// CSS の値（色・書体・文字の大きさ・用紙寸法）をデザイントークン（CSS 変数）へ置き換えるための道具。
// 見た目は変えない（同じ値の別の書き方にするだけ）。
//
// プロファイル（--profile）：
//   site（既定）… サイト画面。tokens.css の色 → css/style.css・css/quote.css
//   doc         … 御見積書。tokens-doc.css の色・書体・文字の大きさ・用紙寸法 → css/quote-pdf.css の「A4 御見積書本体」以降
//                 （サイト画面とは独立。サイトの配色を変えても御見積書は変わらない）
//
//   node scripts/tokenize-css.js [--profile doc] --list [N]    色の使用回数の上位 N 件（既定 60）を、トークンの有無つきで一覧
//   node scripts/tokenize-css.js [--profile doc] --apply       トークンに定義した値を、CSS 内の直書きから var(--名前) へ置き換える
//   node scripts/tokenize-css.js [--profile doc] --verify [基準のgit参照 既定 HEAD]
//                                                              置き換え後の CSS の var(--名前) を元の値へ戻して、基準の CSS と完全一致するか確かめる
//                                                              （一致すれば「どの規則・どの状態でも値は 1 つも変わっていない」ことの証明になる）
//
// 対象外：コメント内、カスタムプロパティの定義行（--xxx: …）、url(…) の中。依存パッケージなし（Node.js のみ）。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const CSS_DIR = path.join(REPO, 'フォワーダー支援', 'css');
const PROFILES = {
  site: { tokens: 'tokens.css', targets: [{ file: 'style.css' }, { file: 'quote.css' }], kinds: ['color'] },
  doc:  { tokens: 'tokens-doc.css', targets: [{ file: 'quote-pdf.css', from: '/* ===== A4 御見積書本体' }], kinds: ['color', 'font', 'fs', 'page'] },
};

const args = process.argv.slice(2);
const pi = args.indexOf('--profile');
const PROFILE_NAME = pi >= 0 ? args[pi + 1] : 'site';
const PROFILE = PROFILES[PROFILE_NAME];
if (!PROFILE) { console.error('--profile は site か doc'); process.exit(2); }
const TOKENS = path.join(CSS_DIR, PROFILE.tokens);

const HEX_RE = /#[0-9a-fA-F]{6}(?![0-9a-fA-F])|#[0-9a-fA-F]{3}(?![0-9a-fA-F])/g;
const norm = h => { h = h.toLowerCase(); return h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h; };
const squash = v => v.replace(/\s+/g, ' ').trim();

// トークンの定義を読む：{ byName: {名前: 値}, byHex: {#色: 先に書いた名前} }。値は空白を畳んだ文字列。色は 6 桁の小文字に正規化
function loadTokens() {
  const css = fs.readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const byName = {}, byHex = {};
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    let v = squash(m[2]);
    if (/^#[0-9a-fA-F]{3,6}$/.test(v)) { v = norm(v); if (!byHex[v]) byHex[v] = m[1]; }
    byName[m[1]] = v;
  }
  return { byName, byHex };
}

// CSS を「置き換え対象の断片」と「そのまま残す断片」に分け、対象の断片だけを fn で変換する。
//   そのまま残す：コメント、カスタムプロパティ定義の行、url(...)
function mapCode(css, fn) {
  const parts = css.split(/(\/\*[\s\S]*?\*\/)/);
  return parts.map((p, i) => {
    if (i % 2 === 1) return p;
    return p.split(/(\n)/).map(line => {
      if (/^\s*--[\w-]+\s*:/.test(line)) return line;
      return line.split(/(url\([^)]*\))/).map((seg, j) => (j % 2 ? seg : fn(seg))).join('');
    }).join('');
  }).join('');
}

// ファイルの「対象領域」（from の見出し以降）だけを fn で変換し、それより前はそのまま返す
function mapRegion(css, target, fn) {
  if (!target.from) return fn(css);
  const i = css.indexOf(target.from);
  if (i < 0) throw new Error(`${target.file} に領域の見出し「${target.from}」がありません`);
  return css.slice(0, i) + fn(css.slice(i));
}

const readTarget = t => fs.readFileSync(path.join(CSS_DIR, t.file), 'utf8');

function listColors(n) {
  const cnt = new Map();
  for (const t of PROFILE.targets) {
    const css = readTarget(t); const region = t.from ? css.slice(css.indexOf(t.from)) : css;
    mapCode(region, seg => { for (const m of seg.matchAll(HEX_RE)) { const h = norm(m[0]); cnt.set(h, (cnt.get(h) || 0) + 1); } return seg; });
  }
  const { byHex } = fs.existsSync(TOKENS) ? loadTokens() : { byHex: {} };
  const total = [...cnt.values()].reduce((a, b) => a + b, 0);
  let acc = 0;
  [...cnt].sort((a, b) => b[1] - a[1]).slice(0, n).forEach(([h, c], i) => {
    acc += c;
    console.log(`${String(i + 1).padStart(3)} ${h} ${String(c).padStart(5)}  累計${(acc / total * 100).toFixed(1).padStart(5)}%  ${byHex[h] || ''}`);
  });
  console.log(`\n色の使用 ${total} 回 / 種類 ${cnt.size}`);
}

// 1つの断片に対する置き換え（色・書体・文字の大きさ・用紙寸法）
function replaceSegment(seg, tk, counter) {
  const { byName, byHex } = tk;
  if (PROFILE.kinds.includes('color')) seg = seg.replace(HEX_RE, m => { const t = byHex[norm(m)]; if (!t) return m; counter.n++; return `var(${t})`; });
  if (PROFILE.kinds.includes('font')) {
    seg = seg.replace(/font-family\s*:\s*([^;}]+)/g, (m, v) => {
      const name = Object.keys(byName).find(k => k.startsWith('--doc-font-') && byName[k] === squash(v));
      if (!name) return m; counter.n++; return `font-family: var(${name})`;
    });
  }
  if (PROFILE.kinds.includes('fs')) {
    seg = seg.replace(/font-size\s*:\s*([\d.]+px)(?![\w-])/g, (m, v) => {
      const name = Object.keys(byName).find(k => k.startsWith('--doc-fs-') && byName[k] === v);
      if (!name) return m; counter.n++; return `font-size: var(${name})`;
    });
  }
  if (PROFILE.kinds.includes('page')) {
    const prop = { '--doc-page-width': 'width', '--doc-page-min-height': 'min-height', '--doc-page-padding': 'padding' };
    for (const [name, p] of Object.entries(prop)) {
      if (!byName[name]) continue;
      const re = new RegExp(`(^|[\\s;{])${p}\\s*:\\s*${byName[name].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s*[;}])`, 'g');
      seg = seg.replace(re, (m, pre) => { counter.n++; return `${pre}${p}: var(${name})`; });
    }
  }
  return seg;
}

function apply() {
  const tk = loadTokens();
  let total = 0;
  for (const t of PROFILE.targets) {
    const counter = { n: 0 };
    const p = path.join(CSS_DIR, t.file);
    const out = mapRegion(fs.readFileSync(p, 'utf8'), t, region => mapCode(region, seg => replaceSegment(seg, tk, counter)));
    fs.writeFileSync(p, out);
    console.log(`${t.file}: ${counter.n} か所を置き換えました`);
    total += counter.n;
  }
  console.log(`合計 ${total} か所`);
}

// 置き換え後の CSS で var(--名前) を元の値へ戻し、基準（git の指定版）の CSS と比べる
function verify(ref) {
  const { byName } = loadTokens();
  let bad = 0;
  const expand = seg => seg.replace(HEX_RE, norm).replace(/var\((--[\w-]+)\)/g, (m, name) => (name in byName ? byName[name] : m));
  // 比較では、コメントとカスタムプロパティの定義行（--名前: 値;）は除き、空行・字下げ・空白の差は無視する
  // （トークンの移動や注釈の追加は値の変更ではないため）。定義行は別途「基準の定義とトークンの値が一致するか」を確かめる
  const strip = css => mapCode(css, expand).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => squash(l)).filter(l => l && !/^--[\w-]+\s*:/.test(l)).join('\n');
  for (const t of PROFILE.targets) {
    const rel = ['フォワーダー支援', 'css', t.file].join('/');
    let base;
    try { base = execFileSync('git', ['show', `${ref}:${rel}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 }); }
    catch (e) { console.error(`基準 ${ref} の ${rel} を読めません`); return 2; }
    const cur = fs.readFileSync(path.join(CSS_DIR, t.file), 'utf8');
    for (const m of base.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
      let v = squash(m[2]); if (/^#[0-9a-fA-F]{3,6}$/.test(v)) v = norm(v);
      if (new RegExp(`^\\s*${m[1]}\\s*:`, 'm').test(cur.replace(/\/\*[\s\S]*?\*\//g, ''))) continue;   // 同じファイルに残っている定義はそのままなので確認不要
      if (byName[m[1]] !== v) { bad++; console.log(`❌ ${t.file}：${m[1]} の定義（${v}）が ${PROFILE.tokens} の値（${byName[m[1]] || '未定義'}）と違います`); }
    }
    const a = strip(base), b = strip(cur);
    if (a === b) { console.log(`✅ ${t.file}（${PROFILE_NAME}）：値は 1 つも変わっていません（基準 ${ref} と、トークンを元の値へ戻した結果が完全一致）`); continue; }
    bad++;
    const al = a.split('\n'), bl = b.split('\n');
    let shown = 0;
    for (let i = 0; i < Math.max(al.length, bl.length) && shown < 8; i++) {
      if (al[i] !== bl[i]) { console.log(`❌ ${t.file}:${i + 1}\n   基準：${al[i] || ''}\n   現在：${bl[i] || ''}`); shown++; }
    }
  }
  return bad ? 1 : 0;
}

const cmd = args.find(a => ['--list', '--apply', '--verify'].includes(a));
const after = cmd ? args[args.indexOf(cmd) + 1] : null;
if (cmd === '--list') listColors(parseInt(after, 10) || 60);
else if (cmd === '--apply') apply();
else if (cmd === '--verify') process.exit(verify(after && !after.startsWith('--') ? after : 'HEAD'));
else console.log('使い方：[--profile site|doc] --list [N] / --apply / --verify [git参照]');
