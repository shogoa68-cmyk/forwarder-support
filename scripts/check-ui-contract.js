#!/usr/bin/env node
// UI 契約チェック：デザイン変更（CSS・HTML の見た目の改修）で、機能とのつなぎ目が壊れていないかを調べる。
//
// このアプリは「画面の部品名」で見た目と機能がつながっている。デザインの改修で次が変わると機能が壊れる：
//   1. id        … JS が getElementById / querySelector('#…') で参照する、index.html 内の静的な部品名
//   2. handler   … index.html の onclick="fn()" 等が呼ぶ関数（定義が JS に存在すること／呼び出し側が消えていないこと）
//   3. class     … JS が classList.add/toggle/contains や querySelector('.…') で使う見た目の名前
//                   （基準時点で CSS に定義があったものは、改修後も CSS に定義が残っていること）
//   4. data-*    … JS が dataset / [data-…] で使う付帯情報の名前
//   5. script    … index.html が読み込むスクリプトとその順序
//
// 使い方（リポジトリ直下から）：
//   node scripts/check-ui-contract.js            基準（docs/ui-contract.json）と現在を比べる。壊れていれば終了コード1
//   node scripts/check-ui-contract.js --update   基準を現在の内容で作り直す（意図した変更のときだけ）
//   node scripts/check-ui-contract.js --root <dir>  別のフォルダ（フォワーダー支援/ の複製など）を検査
//
// 依存パッケージなし（Node.js のみ）。

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const rootIdx = args.indexOf('--root');
const REPO = path.resolve(__dirname, '..');
const SITE = rootIdx >= 0 ? path.resolve(args[rootIdx + 1]) : path.join(REPO, 'フォワーダー支援');
const BASELINE = path.join(REPO, 'docs', 'ui-contract.json');

const read = f => fs.readFileSync(f, 'utf8');
function walk(dir, ext, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

function collect() {
  const html = read(path.join(SITE, 'index.html'));
  const jsFiles = [...walk(path.join(SITE, 'js'), '.js'), ...(fs.existsSync(path.join(SITE, 'shared')) ? walk(path.join(SITE, 'shared'), '.js') : [])];
  const js = jsFiles.map(read).join('\n');
  const css = walk(path.join(SITE, 'css'), '.css').map(read).join('\n');

  // 1. id
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const usedIds = new Set();
  for (const m of js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]/g)) usedIds.add(m[1]);
  for (const m of js.matchAll(/querySelector(?:All)?\(\s*(['"`])((?:(?!\1).)*)\1/g)) {
    for (const i of m[2].matchAll(/#([A-Za-z][\w-]*)/g)) usedIds.add(i[1]);
  }
  const ids = [...usedIds].filter(i => htmlIds.has(i)).sort();

  // 2. handler（index.html のインライン on*="…" が呼ぶ関数名）
  const SKIP = new Set(['if', 'else', 'return', 'function', 'event', 'this', 'typeof', 'void', 'new', 'confirm', 'alert', 'prompt', 'parseInt', 'parseFloat', 'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'setTimeout', 'setInterval', 'encodeURIComponent', 'decodeURIComponent']);
  const handlerCount = {};
  for (const m of html.matchAll(/\bon(?:click|change|input|keydown|keyup|blur|focus|submit|dblclick|paste|drop|dragover|mouseover|mouseout)\s*=\s*"([^"]*)"/g)) {
    for (const f of m[1].matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (SKIP.has(f[2])) continue;
      handlerCount[f[2]] = (handlerCount[f[2]] || 0) + 1;
    }
  }
  const defined = name => new RegExp(`(function\\s+${name}\\s*\\(|window\\.${name}\\s*=|(?:const|let|var)\\s+${name}\\s*=|\\b${name}\\s*=\\s*(?:async\\s*)?(?:function|\\())`).test(js)
    || new RegExp(`(?:window|globalThis)\\[['"]${name}['"]\\]\\s*=`).test(js)
    || new RegExp(`Object\\.assign\\(\\s*window\\s*,[^;]*?\\b${name}\\b`, 's').test(js);   // Object.assign(window, { name, … }) / { name: fn }
  const handlers = {};
  for (const n of Object.keys(handlerCount).sort()) handlers[n] = { uses: handlerCount[n], defined: defined(n) };

  // 3. class（JS が見た目の状態や部品の探索に使う名前）
  const usedClasses = new Set();
  for (const m of js.matchAll(/classList\.(?:add|remove|toggle|contains|replace)\(\s*['"]([\w-]+)['"]/g)) usedClasses.add(m[1]);
  for (const m of js.matchAll(/querySelector(?:All)?\(\s*(['"`])((?:(?!\1).)*)\1/g)) {
    for (const c of m[2].matchAll(/\.([A-Za-z][\w-]*)/g)) usedClasses.add(c[1]);
  }
  const classes = {};
  for (const c of [...usedClasses].sort()) {
    const inCss = new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css);
    const inHtml = new RegExp(`class="[^"]*(?<![\\w-])${c.replace(/[-]/g, '\\-')}(?![\\w-])[^"]*"`).test(html);
    classes[c] = { css: inCss, html: inHtml };
  }

  // 4. data-*
  const dataAttrs = new Set();
  for (const m of js.matchAll(/\.dataset\.([A-Za-z]\w*)/g)) dataAttrs.add(m[1].replace(/[A-Z]/g, x => '-' + x.toLowerCase()));
  for (const m of js.matchAll(/\[data-([\w-]+)/g)) dataAttrs.add(m[1]);
  const data = {};
  for (const a of [...dataAttrs].sort()) data[a] = { html: new RegExp(`\\bdata-${a}=`).test(html), js: new RegExp(`data-${a}|dataset\\.${a.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`).test(js) };

  // 5. script
  const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"?]+)/g)].map(m => m[1]);

  return { ids, handlers, classes, data, scripts };
}

function main() {
  const cur = collect();
  if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify({
      note: 'デザイン変更で壊してはいけない、画面（HTML/CSS）と機能（JS）のつなぎ目の基準。node scripts/check-ui-contract.js --update で再生成。',
      ...cur,
    }, null, 1) + '\n');
    console.log(`基準を更新しました：id ${cur.ids.length} / handler ${Object.keys(cur.handlers).length} / class ${Object.keys(cur.classes).length} / data-* ${Object.keys(cur.data).length} / script ${cur.scripts.length}`);
    return 0;
  }
  if (!fs.existsSync(BASELINE)) { console.error('基準がありません。まず --update で作成してください。'); return 2; }
  const base = JSON.parse(read(BASELINE));
  const errs = [], warns = [];

  // id：基準にあった id が、HTML から消えていないか
  const curIds = new Set(cur.ids);
  const htmlIdsNow = new Set([...read(path.join(SITE, 'index.html')).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  base.ids.filter(i => !htmlIdsNow.has(i)).forEach(i => errs.push(`id が消えています：#${i}`));
  cur.ids.filter(i => !base.ids.includes(i)).forEach(i => warns.push(`新しく JS が参照する id：#${i}（基準の更新が必要かもしれません）`));

  // handler
  for (const [n, b] of Object.entries(base.handlers)) {
    const c = cur.handlers[n];
    if (!c) errs.push(`HTML から呼び出しが無くなった関数：${n}()（ボタン等が消えた／名前が変わった可能性）`);
    else {
      if (b.defined && !c.defined) errs.push(`関数の定義が見つかりません：${n}()`);
      if (c.uses < b.uses) errs.push(`${n}() を呼ぶ箇所が減っています（${b.uses} → ${c.uses}）`);
    }
  }
  for (const [n, c] of Object.entries(cur.handlers)) if (!c.defined && !(base.handlers[n] && !base.handlers[n].defined)) errs.push(`HTML が呼ぶ関数が未定義：${n}()`);

  // class
  for (const [c, b] of Object.entries(base.classes)) {
    const n = cur.classes[c];
    if (!n) { warns.push(`JS が使わなくなった class：.${c}`); continue; }
    if (b.css && !n.css) errs.push(`CSS から .${c} の定義が無くなりました（JS が使う見た目の名前）`);
    if (b.html && !n.html) warns.push(`HTML から class「${c}」が無くなりました（JS が探す部品の可能性）`);
  }

  // data-*
  for (const [a, b] of Object.entries(base.data)) {
    const n = cur.data[a];
    if (b.html && n && !n.html) errs.push(`HTML から data-${a} が無くなりました`);
  }

  // script
  const missing = base.scripts.filter(s => !cur.scripts.includes(s));
  missing.forEach(s => errs.push(`読み込むスクリプトが消えています：${s}`));
  const common = base.scripts.filter(s => cur.scripts.includes(s));
  const order = cur.scripts.filter(s => common.includes(s));
  if (JSON.stringify(common) !== JSON.stringify(order)) errs.push('スクリプトの読み込み順が変わっています（共通のグローバル変数を使うため順序が重要です）');

  warns.forEach(w => console.log('⚠️  ' + w));
  errs.forEach(e => console.log('❌ ' + e));
  console.log(errs.length
    ? `\nNG：壊れている可能性があるつなぎ目が ${errs.length} 件あります。`
    : `\nOK：画面と機能のつなぎ目は基準どおりです（id ${base.ids.length} / handler ${Object.keys(base.handlers).length} / class ${Object.keys(base.classes).length} / data-* ${Object.keys(base.data).length} / script ${base.scripts.length}）。`);
  return errs.length ? 1 : 0;
}

process.exit(main());
