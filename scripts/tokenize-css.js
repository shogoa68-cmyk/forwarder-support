#!/usr/bin/env node
// CSS の色をデザイントークン（CSS 変数）へ置き換えるための道具。見た目は変えない（同じ色の別の書き方にするだけ）。
//
//   node scripts/tokenize-css.js --list [N]   色の使用回数の上位 N 件（既定 60）を、トークンの有無つきで一覧する
//   node scripts/tokenize-css.js --apply      tokens.css に定義した色を、css/style.css・css/quote.css 内の直書きから var(--名前) へ置き換える
//   node scripts/tokenize-css.js --verify [基準のgit参照 既定 HEAD]
//                                              置き換え後の CSS の var(--名前) を元の色に戻して、基準の CSS と完全一致するか確かめる
//                                              （一致すれば「どの規則・どの状態でも色は1つも変わっていない」ことの証明になる）
//
// 対象外：コメント内、カスタムプロパティの定義行（--xxx: …）、url(…) の中、css/quote-pdf.css（御見積書の印刷用で独立させる）。
// 依存パッケージなし（Node.js のみ）。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const CSS_DIR = path.join(REPO, 'フォワーダー支援', 'css');
const TOKENS = path.join(CSS_DIR, 'tokens.css');
const TARGETS = ['style.css', 'quote.css'];   // quote-pdf.css は対象外

const HEX_RE = /#[0-9a-fA-F]{6}(?![0-9a-fA-F])|#[0-9a-fA-F]{3}(?![0-9a-fA-F])/g;
const norm = h => { h = h.toLowerCase(); return h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h; };

// tokens.css から { 名前: #rrggbb } を読む（:root 内の「--名前: #色;」）。同じ色が複数名にあるときは、先に書いた名前を置き換え先にする
function loadTokens() {
  const css = fs.readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const byName = {}, byHex = {};
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    const hex = norm(m[2]);
    byName[m[1]] = hex;
    if (!byHex[hex]) byHex[hex] = m[1];
  }
  return { byName, byHex };
}

// CSS 文字列を「置き換え対象の断片」と「そのまま残す断片」に分けて、対象の断片だけを fn で変換する
//   そのまま残す：コメント、カスタムプロパティ定義の行、url(...)
function mapCode(css, fn) {
  const parts = css.split(/(\/\*[\s\S]*?\*\/)/);   // コメントを分離
  return parts.map((p, i) => {
    if (i % 2 === 1) return p;
    return p.split(/(\n)/).map(line => {
      if (/^\s*--[\w-]+\s*:/.test(line)) return line;                  // カスタムプロパティ定義行
      return line.split(/(url\([^)]*\))/).map((seg, j) => (j % 2 ? seg : fn(seg))).join('');
    }).join('');
  }).join('');
}

function listColors(n) {
  const cnt = new Map();
  for (const f of TARGETS) {
    mapCode(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'), seg => { for (const m of seg.matchAll(HEX_RE)) { const h = norm(m[0]); cnt.set(h, (cnt.get(h) || 0) + 1); } return seg; });
  }
  const tokens = fs.existsSync(TOKENS) ? loadTokens() : { byHex: {} };
  const total = [...cnt.values()].reduce((a, b) => a + b, 0);
  let acc = 0;
  [...cnt].sort((a, b) => b[1] - a[1]).slice(0, n).forEach(([h, c], i) => {
    acc += c;
    console.log(`${String(i + 1).padStart(3)} ${h} ${String(c).padStart(5)}  累計${(acc / total * 100).toFixed(1).padStart(5)}%  ${tokens.byHex[h] || ''}`);
  });
  console.log(`\n色の使用 ${total} 回 / 種類 ${cnt.size}`);
}

function apply() {
  const { byHex } = loadTokens();
  let total = 0;
  for (const f of TARGETS) {
    const p = path.join(CSS_DIR, f);
    let n = 0;
    const out = mapCode(fs.readFileSync(p, 'utf8'), seg => seg.replace(HEX_RE, m => { const t = byHex[norm(m)]; if (!t) return m; n++; return `var(${t})`; }));
    fs.writeFileSync(p, out);
    console.log(`${f}: ${n} か所を置き換えました`);
    total += n;
  }
  console.log(`合計 ${total} か所`);
}

// 置き換え後の CSS で var(--名前) を元の色へ戻し、基準（git の指定版）の CSS と比べる
function verify(ref) {
  const { byName } = loadTokens();
  let bad = 0;
  for (const f of TARGETS) {
    const rel = path.join('フォワーダー支援', 'css', f);
    let base;
    try { base = execFileSync('git', ['show', `${ref}:${rel.split(path.sep).join('/')}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 }); }
    catch (e) { console.error(`基準 ${ref} の ${rel} を読めません`); return 2; }
    const cur = fs.readFileSync(path.join(REPO, rel), 'utf8');
    // 基準側：直書きの色を正規化（小文字・6桁）。現在側：var(--トークン) を色へ戻す。どちらも「対象の断片」だけを処理する
    const expand = seg => seg.replace(HEX_RE, norm).replace(/var\((--[\w-]+)\)/g, (m, name) => byName[name] || m);
    // 比較では、コメントとカスタムプロパティの定義行（--名前: 値;）は除く（トークンの移動や注釈の追加は色の変更ではないため）。
    // 定義行は別途「基準の定義と tokens.css の値が一致するか」を確かめる
    const strip = css => mapCode(css, expand).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.trim()).filter(l => l && !/^--[\w-]+\s*:/.test(l)).join('\n');   // 空行・字下げの違いも無視
    const a = strip(base);
    const b = strip(cur);
    for (const m of base.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s*(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/gm)) {
      if (byName[m[1]] !== norm(m[2])) { bad++; console.log(`❌ ${f}：${m[1]} の定義（${norm(m[2])}）が tokens.css の値（${byName[m[1]] || '未定義'}）と違います`); }
    }
    if (a === b) { console.log(`✅ ${f}：色は 1 つも変わっていません（基準 ${ref} と、トークンを元の色へ戻した結果が完全一致）`); continue; }
    bad++;
    const al = a.split('\n'), bl = b.split('\n');
    let shown = 0;
    for (let i = 0; i < Math.max(al.length, bl.length) && shown < 8; i++) {
      if (al[i] !== bl[i]) { console.log(`❌ ${f}:${i + 1}\n   基準：${(al[i] || '').trim()}\n   現在：${(bl[i] || '').trim()}`); shown++; }
    }
  }
  return bad ? 1 : 0;
}

const args = process.argv.slice(2);
if (args[0] === '--list') listColors(parseInt(args[1], 10) || 60);
else if (args[0] === '--apply') apply();
else if (args[0] === '--verify') process.exit(verify(args[1] || 'HEAD'));
else console.log('使い方：--list [N] / --apply / --verify [git参照]');
