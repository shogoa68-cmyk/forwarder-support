#!/usr/bin/env node
// Claude Design へ共有する「デザインシステム」一式を docs/design-system/ に生成する。
//
//   node scripts/build-design-system.js
//
// 生成物（docs/design-system/）：
//   README.md                  デザインの考え方・ルールの一覧・変えてはいけないもの（Claude Design が最初に読む説明）
//   css/                       tokens.css（サイト）・tokens-doc.css（御見積書）と、実際の画面の CSS（style.css・quote.css・quote-pdf.css）
//   cards/*.html               見本カード（先頭行の <!-- @dsCard group="…" --> が、Claude Design 上のカードの分類になる）
//                                色（サイト／御見積書）・文字の大きさ・角の丸み/余白・主要な部品（実際の画面から取り出した HTML）・御見積書
//
// 共有は、お客様が /design-sync を開始し、承認した上で行う（このスクリプトは中身を作るだけで、外部へは送らない）。
// 見本の部品は、アプリを実際に動かして取り出した HTML なので、デザインを変えたら再生成して差し替える。
// 前提：Playwright と Chromium（scripts/ui-smoke.js と同じ）。

const fs = require('fs');
const path = require('path');
const http = require('http');

const REPO = path.resolve(__dirname, '..');
const SITE = path.join(REPO, 'フォワーダー支援');
const OUT = path.join(REPO, 'docs', 'design-system');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function loadPlaywright() {
  for (const m of ['playwright-core', 'playwright']) { try { return require(m); } catch (e) { /* 次へ */ } }
  console.error('playwright が見つかりません。NODE_PATH に playwright の node_modules を指定してください。'); process.exit(2);
}

// ---- トークンの読み取り（コメントの直後の説明も拾う） ----
function parseTokens(file) {
  const css = fs.readFileSync(file, 'utf8');
  const out = [];
  let section = '';
  for (const line of css.split('\n')) {
    const sec = line.match(/\/\*\s*-{3,}\s*(.+?)\s*-{3,}\s*\*\//); if (sec) { section = sec[1]; continue; }
    const sec2 = line.match(/^\s*\/\*\s*={3,}\s*$/); if (sec2) continue;
    const m = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);\s*(?:\/\*\s*(.*?)\s*\*\/)?/);
    if (m) out.push({ name: m[1], value: m[2].trim(), note: m[3] || '', section });
  }
  return out;
}
const isColor = v => /^#[0-9a-fA-F]{3,8}$/.test(v) || /^(rgb|hsl)a?\(/.test(v);

const PAGE_HEAD = (title, group, css = []) => `<!-- @dsCard group="${group}" -->
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${css.map(c => `<link rel="stylesheet" href="../css/${c}">`).join('\n')}
<style>
  body { margin: 0; padding: 20px; background: #fff; color: #2d2418; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif; font-size: 13px; }
  h1 { font-size: 15px; margin: 0 0 4px; } .sub { color: #6a5745; font-size: 12px; margin: 0 0 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
  .sw { border: 1px solid #d9cfc2; border-radius: 8px; overflow: hidden; background: #fff; }
  .sw .chip { height: 44px; border-bottom: 1px solid #d9cfc2; }
  .sw .meta { padding: 6px 8px; font-size: 11px; line-height: 1.5; } .sw b { font-size: 11.5px; } .sw code { color: #6a5745; }
  .sec { font-size: 12px; font-weight: 700; color: #3d2e1e; margin: 16px 0 6px; }
  .row { display: flex; align-items: baseline; gap: 14px; padding: 5px 0; border-bottom: 1px solid #eee; } .row code { width: 130px; color: #6a5745; font-size: 11px; } .row .v { width: 56px; color: #888; font-size: 11px; }
</style></head><body>`;

function colorCard(file, title, group) {
  const toks = parseTokens(file).filter(t => isColor(t.value));
  let html = PAGE_HEAD(title, group) + `<h1>${esc(title)}</h1><p class="sub">${toks.length} 色。名前（--…）で参照します。値を変えると、使っているすべての箇所に反映されます。</p>`;
  let cur = null;
  for (const t of toks) {
    if (t.section !== cur) { if (cur !== null) html += '</div>'; cur = t.section; html += `<div class="sec">${esc(cur || '基本')}</div><div class="grid">`; }
    html += `<div class="sw"><div class="chip" style="background:${t.value}"></div><div class="meta"><b>${esc(t.name)}</b><br><code>${esc(t.value)}</code>${t.note ? `<br>${esc(t.note)}` : ''}</div></div>`;
  }
  return html + '</div></body></html>';
}

function typographyCard() {
  const site = parseTokens(path.join(SITE, 'css', 'tokens.css')).filter(t => t.name.startsWith('--fs-'));
  const doc = parseTokens(path.join(SITE, 'css', 'tokens-doc.css')).filter(t => t.name.startsWith('--doc-fs-'));
  const fam = parseTokens(path.join(SITE, 'css', 'tokens-doc.css')).filter(t => t.name.startsWith('--doc-font-'));
  let html = PAGE_HEAD('文字の大きさ・書体', 'Type', ['tokens.css', 'tokens-doc.css']) + '<h1>文字の大きさ・書体</h1><p class="sub">サイト画面は 9px〜18px の 14 段階、御見積書は 13 段階。名前の数字は現在の px 値です。</p>';
  html += '<div class="sec">サイト画面（--fs-*）</div>' + site.map(t => `<div class="row"><code>${t.name}</code><span class="v">${t.value}</span><span style="font-size:var(${t.name})">見積項目 FCL 20ft ¥120,000 ABC123</span></div>`).join('');
  html += '<div class="sec">御見積書（--doc-fs-*）</div>' + doc.map(t => `<div class="row"><code>${t.name}</code><span class="v">${t.value}</span><span style="font-size:var(${t.name});font-family:var(--doc-font-body)">${esc(t.note || '見積項目')}　¥120,000</span></div>`).join('');
  html += '<div class="sec">御見積書の書体</div>' + fam.map(t => `<div class="row"><code>${t.name}</code><span style="font-family:var(${t.name});font-size:18px">御 見 積 書　Quotation 1234567890</span></div>`).join('');
  return html + '</body></html>';
}

function radiusSpacingCard() {
  const t = parseTokens(path.join(SITE, 'css', 'tokens.css'));
  const r = t.filter(x => x.name.startsWith('--r-')), sp = t.filter(x => x.name.startsWith('--sp-'));
  let html = PAGE_HEAD('角の丸み・余白', 'Shape', ['tokens.css']) + '<h1>角の丸み・余白</h1><p class="sub">角の丸み 14 段階（--r-*）、余白 15 段階（--sp-*）。3・5・7・9・11px は現状の細かい調整値で、今後の統合候補です。</p>';
  html += '<div class="sec">角の丸み</div><div style="display:flex;flex-wrap:wrap;gap:12px">' + r.map(x => `<div style="text-align:center;font-size:11px"><div style="width:64px;height:44px;background:#f0e8d8;border:1px solid #c4b49a;border-radius:var(${x.name})"></div><code>${x.name}</code><br>${x.value}</div>`).join('') + '</div>';
  html += '<div class="sec">余白</div>' + sp.map(x => `<div class="row"><code>${x.name}</code><span class="v">${x.value}</span><span style="display:inline-block;height:14px;width:var(${x.name});background:#6b5a42"></span></div>`).join('');
  return html + '</body></html>';
}

function serve() {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const srv = http.createServer((req, res) => {
    const f = path.join(REPO, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// 実際の画面から取り出す部品（セレクタ・タイトル・カード名）
const COMPONENTS = [
  { file: 'components-buttons', group: 'Components', title: 'ボタン', note: '方向・輸送モードの切替、ステータス、定型文、追加ボタンなど', picks: ['#dirBtns', '#seaAirBtns', '#qf-status-btns', '.qf-ref-row', '#presetBtns'] },
  { file: 'components-forms', group: 'Components', title: '入力欄・選択', note: '見積ヘッダー、インコタームズ選択、貨物入力', picks: ['.quote-header .quote-field:nth-child(1)', '.quote-header .quote-field:nth-child(2)', '.quote-header .quote-field:nth-child(3)', '.cond-prim-group-inco'] },
  { file: 'components-chips', group: 'Components', title: 'チップ・タブ', note: '航路チップ、物量パターンのタブ、コンテナ選択', picks: ['#z2RouteList', '#cdPatternTabs', '.cc-chip:nth-child(-n+3)'] },
  { file: 'components-cards', group: 'Components', title: 'セクション（カード）', note: '管理番号入力・貿易条件・全体リマークの各セクション', picks: ['#section-ref', '#section-remark'] },
  { file: 'components-table', group: 'Components', title: '見積明細の表', note: '明細行（仕入・乗せ幅・売値）と合計行', picks: ['TABLE'] },
  { file: 'components-rail', group: 'Components', title: '右カラムのレール・パネル', note: 'ジャンプ・比較・FCL/LCL などのパネル切替', picks: ['#qrcRail', '#flPanel'] },
];

async function captureComponents(pw) {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await ctx.addInitScript(() => { const F = new Date('2026-01-15T09:00:00+09:00').getTime(), R = Date; Date = class extends R { constructor(...a) { if (a.length) super(...a); else super(F); } static now() { return F; } }; });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(`${base}/${encodeURIComponent('フォワーダー支援')}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); if (t) t.click(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.qpShowEditor && window.qpShowEditor());
  // サンプルデータ（部品が空にならないように）
  await page.fill('#qf-ref', '99-2601150-001'); await page.fill('#qf-customer', 'サンプル商事株式会社'); await page.fill('#qf-person', '山田');
  await page.click('#dirBtns [data-dir="export"]'); await page.evaluate(() => setTransport('fcl'));
  await page.selectOption('#cond-incoterms', { label: 'FOB（本船渡し）' });
  await page.fill('#z2Carrier', 'Maersk'); await page.fill('#z2Pol', 'NAGOYA'); await page.fill('#z2Pod', 'XIAMEN'); await page.evaluate(() => addRouteEntry());
  const rows = [['海上運賃', 'A社', 100000, 20000], ['THC', 'B社', 30000, 5000]];
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) { await page.evaluate(() => window.addRow()); await page.waitForTimeout(80); }
    const f = n => page.locator(`#tableBody tr:not([data-virtual]) [data-field="${n}"]`).nth(i);
    await f('nm').fill(rows[i][0]); await f('un').fill('式'); await f('sv').fill(rows[i][1]); await f('pq').fill('1'); await f('pp').fill(String(rows[i][2])); await f('mk').fill(String(rows[i][3])); await f('mk').blur();
  }
  await page.evaluate(() => createFclLclPatterns());
  await page.waitForTimeout(500);

  const result = {};
  for (const c of COMPONENTS) {
    result[c.file] = await page.evaluate(picks => {
      const out = [];
      for (const sel of picks) {
        if (sel === 'TABLE') { const t = document.getElementById('tableBody')?.closest('table'); if (t) { const clone = t.cloneNode(true); clone.querySelectorAll('tbody tr').forEach((tr, i) => { if (i > 5) tr.remove(); }); out.push(clone.outerHTML); } continue; }
        document.querySelectorAll(sel).forEach(el => out.push(el.outerHTML));
      }
      return out;
    }, c.picks);
  }
  // 御見積書（日本語・英語）
  const doc = await page.evaluate(() => { localStorage.setItem('quoteDocLangEn_v1', '0'); document.getElementById('qf-multi-out').value = '0'; return buildQuoteDocHTML(); });
  const docEn = await page.evaluate(() => { localStorage.setItem('quoteDocLangEn_v1', '1'); const h = buildQuoteDocHTML(); localStorage.setItem('quoteDocLangEn_v1', '0'); return h; });
  const docMulti = await page.evaluate(() => { document.getElementById('qf-multi-out').value = '1'; const h = buildQuoteDocHTML(); document.getElementById('qf-multi-out').value = '0'; return h; });
  await browser.close(); srv.close();
  return { components: result, doc, docEn, docMulti };
}

function componentCard(c, htmls) {
  const body = htmls.length ? htmls.map(h => `<div style="margin:0 0 14px">${h}</div>`).join('') : '<p>（取り出せませんでした）</p>';
  return PAGE_HEAD(c.title, c.group, ['tokens.css', 'style.css', 'quote.css']) +
    `<h1>${esc(c.title)}</h1><p class="sub">${esc(c.note)}。実際の画面から取り出した HTML です（クラス名・構造は機能とつながっているため変えないでください）。</p>` +
    `<div id="tab-quote-make" class="tab-content active"><div class="quote-workspace"><div class="quote-main">${body}</div></div></div></body></html>`;
}

function docCard(title, html, note) {
  return `<!-- @dsCard group="Quote document" -->
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="stylesheet" href="../css/tokens-doc.css"><link rel="stylesheet" href="../css/quote-pdf.css">
<style>body{margin:0;padding:20px;background:#e9e6e0}.note{font:12px sans-serif;color:#555;margin:0 0 10px}</style></head><body>
<p class="note">${esc(note)}</p>${html}</body></html>`;
}

function readme() {
  const site = parseTokens(path.join(SITE, 'css', 'tokens.css')), doc = parseTokens(path.join(SITE, 'css', 'tokens-doc.css'));
  const count = (arr, p) => arr.filter(t => t.name.startsWith(p)).length;
  const contract = JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'ui-contract.json'), 'utf8'));
  return `# フォワーダー支援 デザインシステム

フォワーディング（国際物流）業務の見積・手配を支える Web アプリ「フォワーダー支援」の、デザインのルールと部品の見本です。
Claude Design で見た目を改良するときの出発点として共有します。

## このアプリについて
- 使う人：フォワーダー（国際物流の営業・オペレーション）。見積の入力、料金の比較、御見積書（PDF）の作成が中心業務です。
- コンセプト：**誰でも迷わず使える・でもできる人にはもっと便利**。親しみやすく、やわらかい雰囲気。清潔感があり、ごちゃごちゃしていない。
- 現在の配色：ベージュ・茶系（背景 \`--bg\`、文字 \`--text\`、アクセント \`--accent\`）。入力項目が非常に多く、情報密度の高い画面です（文字は 9〜14px が中心）。
- 構成：ビルドなしの静的サイト（HTML + CSS + JavaScript）。見た目は CSS のルール（変数）で決まります。

## ルールは 2 系統
| 系統 | ファイル | 内容 |
|---|---|---|
| サイト画面 | \`css/tokens.css\` | 色 ${site.filter(t => isColor(t.value)).length} 個、文字の大きさ ${count(site, '--fs-')} 段階、角の丸み ${count(site, '--r-')} 段階、余白 ${count(site, '--sp-')} 段階 |
| 御見積書 | \`css/tokens-doc.css\` | お客様に出す文書専用。色・書体・文字の大きさ ${count(doc, '--doc-fs-')} 段階・A4 の寸法（${doc.length} 個） |

**御見積書はサイト画面から独立**しています。サイトの配色を変えても御見積書は変わりません。御見積書のデザインを変えるときは \`tokens-doc.css\` の値を変えます。

## デザインを変えるときの約束（機能を壊さないために）
このアプリは、画面の部品名で見た目と機能（JavaScript）がつながっています。次を守ってください。

1. **まず、ルール（CSS 変数）の値を変える。** 色・文字の大きさ・角の丸み・余白は \`var(--名前)\` で参照されています。値を変えれば、使っている箇所すべてに反映されます。
2. **HTML の構造を変える場合は、次を残す**（機能が参照しているもの）：
   - \`id\` 属性（機能が参照するもの：${contract.ids.length} 個）
   - \`onclick\` などの動作の指定と、呼び出す関数名（${Object.keys(contract.handlers).length} 種類）
   - JavaScript が付け外しする class 名（${Object.keys(contract.classes).length} 個。CSS に定義があるものは定義を残す）
   - \`data-*\` 属性（${Object.keys(contract.data).length} 種類）
3. 御見積書は印刷（A4・PDF）で使われます。用紙寸法・改ページ（\`break-inside\`）を壊さないでください。
4. 英語出力・日本語出力の両方があります。文字数が増えても崩れないようにしてください。

## 見本カード（cards/）
- Colors：サイト画面の色／御見積書の色
- Type：文字の大きさ・書体
- Shape：角の丸み・余白
- Components：ボタン、入力欄・選択、チップ・タブ、セクション、見積明細の表、右カラムのレール（実際の画面から取り出した HTML）
- Quote document：御見積書（日本語・英語・FCL案/LCL案の併記）

見本の部品は、アプリを実際に動かして取り出したもので、クラス名・構造は本物と同じです。
`;
}

async function main() {
  const pw = loadPlaywright();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'css'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'cards'), { recursive: true });
  for (const f of ['tokens.css', 'tokens-doc.css', 'style.css', 'quote.css', 'quote-pdf.css']) fs.copyFileSync(path.join(SITE, 'css', f), path.join(OUT, 'css', f));
  const w = (n, s) => fs.writeFileSync(path.join(OUT, 'cards', n + '.html'), s);
  w('colors-site', colorCard(path.join(SITE, 'css', 'tokens.css'), 'サイト画面の色', 'Colors'));
  w('colors-doc', colorCard(path.join(SITE, 'css', 'tokens-doc.css'), '御見積書の色', 'Colors'));
  w('typography', typographyCard());
  w('radius-spacing', radiusSpacingCard());
  const cap = await captureComponents(pw);
  for (const c of COMPONENTS) w(c.file, componentCard(c, cap.components[c.file]));
  w('quote-document', docCard('御見積書（日本語）', cap.doc, '御見積書（日本語）。A4 縦。印刷・PDF で使われます。'));
  w('quote-document-en', docCard('御見積書（英語）', cap.docEn, '御見積書（英語出力）。固定ラベルのみ英語になります。'));
  w('quote-document-multi', docCard('御見積書（FCL案／LCL案の併記）', cap.docMulti, '物量パターンを併記した御見積書。比較表のあとに案ごとの明細が続きます。'));
  fs.writeFileSync(path.join(OUT, 'README.md'), readme());
  const n = fs.readdirSync(path.join(OUT, 'cards')).length;
  console.log(`docs/design-system/ を生成しました：カード ${n} 枚、CSS 5 本、README.md`);
}

main().catch(e => { console.error(e); process.exit(1); });
