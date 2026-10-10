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
//   【2b：近い色の統合（見た目がごくわずかに変わる。変化量の上限を ΔE で保証する）】
//   node scripts/tokenize-css.js --plan-colors T N [--write]   T（ΔE 許容値）の範囲でどのトークンにも近くない色のうち、使用の多い順に N 色を新トークン候補として表示
//                                                              （--write で tokens.css へ追記）
//   node scripts/tokenize-css.js --snap-colors T               直書きの色・--c-xxxxxx（意味づけ前）の参照を、ΔE≤T の最も近いトークンへ寄せる
//                                                              （寄せ先が見つかった --c-xxxxxx の定義は tokens.css から削除）
//   node scripts/tokenize-css.js --verify-snap T [基準のgit参照]   基準との差が「色の変化のみで、すべて ΔE≤T」であることを確かめる（最大 ΔE・変更数も表示）
//
// 【2c：文字の大きさ・角の丸み・余白（見た目は変えない。値を名前にするだけ）】
//   tokens.css の --fs-*（font-size）・--r-*（border-radius）・--sp-*（padding/margin/gap の px 値）を --apply / --verify の対象にする
//
// 対象外：コメント内、カスタムプロパティの定義行（--xxx: …）、url(…) の中。依存パッケージなし（Node.js のみ）。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const CSS_DIR = path.join(REPO, 'フォワーダー支援', 'css');
const PROFILES = {
  site: { tokens: 'tokens.css', targets: [{ file: 'style.css' }, { file: 'quote.css' }], kinds: ['color', 'fs-site', 'radius', 'space'] },
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
function loadTokens(text) {
  const css = (text != null ? text : fs.readFileSync(TOKENS, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
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
  // サイト画面：font-size（--fs-*）。値は px の完全一致のみ
  if (PROFILE.kinds.includes('fs-site')) {
    seg = seg.replace(/(^|[\s;{])(font-size\s*:\s*)([\d.]+px)(?=\s*(?:;|}|!important|$))/g, (m, pre, head, v) => {
      const name = Object.keys(byName).find(k => k.startsWith('--fs-') && byName[k] === v);
      if (!name) return m; counter.n++; return `${pre}${head}var(${name})`;   // 「font-size:」の書式（コロン前後の空白）は元のまま
    });
  }
  // border-radius（--r-*）・余白 padding/margin/gap（--sp-*）：宣言の値に含まれる長さを、1つずつ完全一致でトークンへ置き換える
  const lenSub = (propRe, prefix) => {
    seg = seg.replace(new RegExp(`(^|[\\s;{])((?:${propRe})\\s*:\\s*)([^;{}]+)`, 'g'), (m, pre, prop, val) => {
      if (/calc\(|var\(|clamp\(|min\(|max\(/.test(val)) return m;   // 計算式・既に変数のものは対象外
      let changed = false;
      const nv = val.replace(/(^|[\s/])(-?[\d.]+(?:px|%)|0)(?=\s|$|!)/g, (mm, lead, len) => {
        const name = Object.keys(byName).find(k => k.startsWith(prefix) && byName[k] === len);
        if (!name || len === '0') return mm; counter.n++; changed = true; return `${lead}var(${name})`;
      });
      return changed ? `${pre}${prop}${nv}` : m;   // プロパティ名とコロンの書式は元のまま
    });
  };
  if (PROFILE.kinds.includes('radius')) lenSub('border(?:-top|-bottom)?(?:-left|-right)?-radius', '--r-');
  if (PROFILE.kinds.includes('space')) lenSub('padding(?:-top|-right|-bottom|-left)?|margin(?:-top|-right|-bottom|-left)?|gap|row-gap|column-gap', '--sp-');
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

// ===== 2b：近い色の統合 =====
function toLab(h) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92));
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (b * 0.9505 + g * 0.1192 + r * 0.0193) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const dE = (a, b) => Math.hypot(...toLab(a).map((v, i) => v - toLab(b)[i]));

function familyName(h) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d) { hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hue = (hue * 60 + 360) % 360; }
  const L = Math.round(l * 100);
  const fam = sat < 0.08 ? 'gray' : (hue < 18 || hue >= 340) ? 'red' : hue < 55 ? (sat >= 0.65 ? 'amber' : l > 0.7 ? 'tan' : 'brown') : hue < 70 ? 'olive' : hue < 170 ? 'green' : hue < 260 ? 'blue' : 'purple';
  return `--${fam}-${L}`;
}

function rawColorCounts() {
  const cnt = new Map();
  for (const t of PROFILE.targets) mapCode(readTarget(t), seg => { for (const m of seg.matchAll(HEX_RE)) { const h = norm(m[0]); cnt.set(h, (cnt.get(h) || 0) + 1); } return seg; });
  return cnt;
}

function planColors(T, N, write) {
  const tk = loadTokens();
  const centers = Object.entries(tk.byName).filter(([, v]) => /^#/.test(v)).map(([n, v]) => v);
  const cnt = rawColorCounts();
  let left = [...cnt].filter(([h]) => Math.min(...centers.map(c => dE(h, c))) > T).sort((a, b) => b[1] - a[1]);
  const adds = []; const used = new Set(Object.keys(tk.byName));
  while (adds.length < N && left.length) {
    const [h, c] = left[0];
    let name = familyName(h); let k = 0; const base = name;
    while (used.has(name)) name = base + String.fromCharCode(97 + k++);
    used.add(name); adds.push([name, h, c]); centers.push(h);
    left = left.filter(([x]) => dE(x, h) > T);
  }
  adds.forEach(([n, h, c]) => console.log(`${n.padEnd(14)} ${h}  （中心色の使用 ${c} 回）`));
  if (write) {
    const css = fs.readFileSync(TOKENS, 'utf8');
    const block = `\n  /* ----- 近い色の統合（2b）で追加：使用の多い色を中心に、ΔE≤${T} の範囲を代表する色 ----- */\n` + adds.map(([n, h]) => `  ${n}: ${h};`).join('\n') + '\n';
    const i = css.lastIndexOf('}');
    fs.writeFileSync(TOKENS, css.slice(0, i).replace(/\s*$/, '\n') + block + css.slice(i));
    console.log(`\ntokens.css に ${adds.length} 色を追記しました`);
  }
}

function nearest(h, pool) { let best = null, bd = Infinity; for (const [n, v] of pool) { const d = dE(h, v); if (d < bd) { bd = d; best = n; } } return [best, bd]; }

function snapColors(T) {
  const text = fs.readFileSync(TOKENS, 'utf8');
  const tk = loadTokens(text);
  const named = Object.entries(tk.byName).filter(([n, v]) => /^#/.test(v) && !/^--c-[0-9a-f]{6}$/.test(n));   // 寄せ先：--c-xxxxxx 以外の全トークン
  const legacy = Object.entries(tk.byName).filter(([n, v]) => /^--c-[0-9a-f]{6}$/.test(n));
  // 意味づけ前（--c-xxxxxx）のうち、寄せ先が ΔE≤T にあるものは統合（定義を削除し、参照を寄せ先へ付け替える）
  const merge = {};
  for (const [n, v] of legacy) { const [t, d] = nearest(v, named); if (d <= T) merge[n] = t; }
  const stat = { raw: 0, legacyRefs: 0, maxDE: 0 };
  const pool = named.concat(legacy.filter(([n]) => !(n in merge)));
  for (const t of PROFILE.targets) {
    const p = path.join(CSS_DIR, t.file);
    const out = mapRegion(fs.readFileSync(p, 'utf8'), t, region => mapCode(region, seg => seg
      .replace(HEX_RE, m => { const h = norm(m); const [n, d] = nearest(h, pool); if (d > T) return m; stat.raw++; stat.maxDE = Math.max(stat.maxDE, d); return `var(${n})`; })
      .replace(/var\((--c-[0-9a-f]{6})\)/g, (m, n) => { if (!(n in merge)) return m; stat.legacyRefs++; return `var(${merge[n]})`; })));
    fs.writeFileSync(p, out);
  }
  // tokens.css から統合した --c-xxxxxx の定義を削除
  const kept = text.split('\n').filter(l => { const m = l.match(/^\s*(--c-[0-9a-f]{6})\s*:/); return !(m && merge[m[1]]); }).join('\n');
  fs.writeFileSync(TOKENS, kept);
  console.log(`直書きの色 ${stat.raw} か所を既存トークンへ寄せました（最大 ΔE ${stat.maxDE.toFixed(2)}）／--c- 参照 ${stat.legacyRefs} か所を付け替え／統合した --c- トークン ${Object.keys(merge).length} 個`);
}

// 基準との差が「色の変化のみ」で、すべて ΔE≤T であることの確認
function verifySnap(T, ref) {
  let bad = 0, changed = 0, maxD = 0;
  const gitShow = rel => execFileSync('git', ['show', `${ref}:${rel}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
  const baseTk = loadTokens(gitShow(['フォワーダー支援', 'css', PROFILE.tokens].join('/'))).byName;
  const curTk = loadTokens().byName;
  const exp = tk => seg => seg.replace(HEX_RE, norm).replace(/var\((--[\w-]+)\)/g, (m, n) => (n in tk ? tk[n] : m));
  const prep = (css, tk) => mapCode(css, exp(tk)).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => squash(l)).filter(l => l && !/^--[\w-]+\s*:/.test(l)).join('\n');
  for (const t of PROFILE.targets) {
    const base = prep(gitShow(['フォワーダー支援', 'css', t.file].join('/')), baseTk);
    const cur = prep(readTarget(t), curTk);
    const sk = x => x.replace(HEX_RE, '#');
    if (sk(base) !== sk(cur)) { bad++; console.log(`❌ ${t.file}：色以外の内容が変わっています`); const a = sk(base).split('\n'), b = sk(cur).split('\n'); for (let i = 0, s = 0; i < Math.max(a.length, b.length) && s < 6; i++) if (a[i] !== b[i]) { console.log(`   基準：${a[i] || ''}\n   現在：${b[i] || ''}`); s++; } continue; }
    const ca = base.match(HEX_RE) || [], cb = cur.match(HEX_RE) || [];
    let n = 0, mx = 0;
    ca.forEach((h, i) => { if (h !== cb[i]) { n++; const d = dE(h, cb[i]); mx = Math.max(mx, d); if (d > T) { bad++; console.log(`❌ ${t.file}：${h} → ${cb[i]}（ΔE ${d.toFixed(2)} > ${T}）`); } } });
    changed += n; maxD = Math.max(maxD, mx);
    console.log(`${bad ? '⚠️ ' : '✅ '}${t.file}：色の使用 ${ca.length} か所のうち ${n} か所が変化（最大 ΔE ${mx.toFixed(2)}）。色以外の内容は変わっていません`);
  }
  console.log(bad ? `\nNG：許容（ΔE≤${T}）を超える変化、または色以外の変更があります。` : `\nOK：変化はすべて ΔE≤${T} の範囲で、色以外は変わっていません（変化 ${changed} か所・最大 ΔE ${maxD.toFixed(2)}）。`);
  return bad ? 1 : 0;
}

const cmd = args.find(a => ['--list', '--apply', '--verify', '--plan-colors', '--snap-colors', '--verify-snap'].includes(a));
const after = cmd ? args[args.indexOf(cmd) + 1] : null;
if (cmd === '--list') listColors(parseInt(after, 10) || 60);
else if (cmd === '--apply') apply();
else if (cmd === '--verify') process.exit(verify(after && !after.startsWith('--') ? after : 'HEAD'));
else if (cmd === '--plan-colors') planColors(parseFloat(after), parseInt(args[args.indexOf(cmd) + 2], 10) || 12, args.includes('--write'));
else if (cmd === '--snap-colors') snapColors(parseFloat(after));
else if (cmd === '--verify-snap') process.exit(verifySnap(parseFloat(after), args[args.indexOf(cmd) + 2] && !args[args.indexOf(cmd) + 2].startsWith('--') ? args[args.indexOf(cmd) + 2] : 'HEAD'));
else console.log('使い方：[--profile site|doc] --list [N] / --apply / --verify [git参照]');
