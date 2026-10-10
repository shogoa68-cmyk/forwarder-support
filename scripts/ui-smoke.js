#!/usr/bin/env node
// UI スモークテスト：デザイン変更の前後で「主要な操作が今までどおり動くか」と「見た目がどう変わったか」を確かめる。
//
//   node scripts/ui-smoke.js                         主要操作の動作確認だけを行う
//   node scripts/ui-smoke.js --shots <dir>           動作確認に加え、主要画面のスクリーンショットを <dir> に保存
//   node scripts/ui-smoke.js --root <dir> ...       別のフォルダ（「フォワーダー支援/」を含む複製）を対象にする
//   node scripts/ui-smoke.js --compare <dirA> <dirB> 2つのフォルダのスクリーンショットを比べ、差のある画面と割合を表示
//                                                    （差分画像を <dirB>/diff/ に出力）
//
// 前提：Playwright（playwright / playwright-core）と Chromium が使えること。
//   環境変数 CHROMIUM_PATH（既定 /opt/pw-browsers/chromium）、NODE_PATH に playwright の node_modules を指定できる。
// サンプルデータ・固定の日付・固定のビューポートで撮るため、変更が無ければ何度撮っても差は 0 になる。

const fs = require('fs');
const path = require('path');
const http = require('http');

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const REPO = opt('--root') ? path.resolve(opt('--root')) : path.resolve(__dirname, '..');   // --root：「フォワーダー支援/」を含むフォルダ（複製の検査用）
const SITE_URL_PATH = '/' + encodeURIComponent('フォワーダー支援') + '/index.html';

function loadPlaywright() {
  for (const m of ['playwright-core', 'playwright']) { try { return require(m); } catch (e) { /* 次へ */ } }
  console.error('playwright が見つかりません。NODE_PATH に playwright の node_modules を指定してください。');
  process.exit(2);
}

// ---------- 画像比較（ブラウザの canvas で画素を比べるため、追加パッケージ不要） ----------
async function compareDirs(pw, dirA, dirB) {
  const files = fs.readdirSync(dirA).filter(f => f.endsWith('.png')).sort();
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  fs.mkdirSync(path.join(dirB, 'diff'), { recursive: true });
  let diffCount = 0;
  console.log('画面'.padEnd(28) + '差のある画素');
  for (const f of files) {
    const a = path.join(dirA, f), b = path.join(dirB, f);
    if (!fs.existsSync(b)) { console.log(f.padEnd(28) + '（比較先に画像がありません）'); diffCount++; continue; }
    const r = await page.evaluate(async ([x, y]) => {
      const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
      const mk = img => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h); };
      const da = mk(ia), db = mk(ib);
      const out = document.createElement('canvas'); out.width = w; out.height = h;
      const og = out.getContext('2d'); const od = og.createImageData(w, h);
      let diff = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        const d = Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2]);
        if (d > 24) { diff++; od.data[i] = 255; od.data[i + 1] = 0; od.data[i + 2] = 0; od.data[i + 3] = 255; }
        else { od.data[i] = db.data[i]; od.data[i + 1] = db.data[i + 1]; od.data[i + 2] = db.data[i + 2]; od.data[i + 3] = 70; }
      }
      og.putImageData(od, 0, 0);
      return { diff, total: w * h, sizeA: [ia.width, ia.height], sizeB: [ib.width, ib.height], png: out.toDataURL('image/png').split(',')[1] };
    }, ['data:image/png;base64,' + fs.readFileSync(a).toString('base64'), 'data:image/png;base64,' + fs.readFileSync(b).toString('base64')]);
    const pct = (r.diff / r.total * 100);
    const sizeNote = (r.sizeA[0] !== r.sizeB[0] || r.sizeA[1] !== r.sizeB[1]) ? `  ※画像サイズが違います ${r.sizeA.join('×')} → ${r.sizeB.join('×')}` : '';
    console.log(f.padEnd(28) + (r.diff ? `${pct.toFixed(2)}%（${r.diff.toLocaleString()}画素）` : '差なし') + sizeNote);
    if (r.diff) { diffCount++; fs.writeFileSync(path.join(dirB, 'diff', f), Buffer.from(r.png, 'base64')); }
  }
  await browser.close();
  console.log(diffCount ? `\n見た目に差がある画面：${diffCount} / ${files.length}（差分画像：${path.join(dirB, 'diff')}）` : `\n全 ${files.length} 画面で差なし。`);
  return 0;
}

// ---------- 静的サーバ ----------
function serve() {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

async function main() {
  const pw = loadPlaywright();
  if (opt('--compare')) {
    const [a, b] = [args[args.indexOf('--compare') + 1], args[args.indexOf('--compare') + 2]];
    return compareDirs(pw, a, b);
  }
  const shotsDir = opt('--shots');
  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  // 日付を固定（御見積書の発行日などが毎回変わらないように）。外部通信は遮断（為替・CDN は既定値で動く）
  await ctx.addInitScript(() => {
    const FIXED = new Date('2026-01-15T09:00:00+09:00').getTime();
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };
  });
  await ctx.route(url => !url.href.startsWith('http://127.0.0.1'), r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());

  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '✅ ' : '❌ ') + name + (ok || !detail ? '' : '  → ' + detail)); };
  const shot = async (name, target) => {
    if (!shotsDir) return;
    await page.waitForTimeout(250);
    const opts = { path: path.join(shotsDir, name + '.png'), animations: 'disabled' };
    if (target) await page.locator(target).first().screenshot(opts); else await page.screenshot(opts);
  };

  await page.goto(base + SITE_URL_PATH, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '*{caret-color:transparent!important;} *,*::before,*::after{animation:none!important;transition:none!important;}' });
  await page.waitForTimeout(600);
  await shot('01-portal-home');

  // ① 見積タブを開く
  await page.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); if (t) t.click(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => { if (typeof window.qpShowEditor === 'function') window.qpShowEditor(); });
  check('見積タブが開く（initQuoteTab）', await page.evaluate(() => !!window.__quoteInitialized && !!document.getElementById('tableBody')));

  // ② サンプルデータの入力（ヘッダー・条件・明細）
  await page.fill('#qf-ref', '99-2601150-001'); await page.fill('#qf-customer', 'サンプル商事株式会社'); await page.fill('#qf-person', '山田');
  await page.click('#dirBtns [data-dir="export"]');
  await page.evaluate(() => setTransport('fcl'));
  await page.selectOption('#cond-incoterms', { label: 'FOB（本船渡し）' });
  await page.fill('#z2Carrier', 'Maersk'); await page.fill('#z2Pol', 'NAGOYA'); await page.fill('#z2Pod', 'XIAMEN'); await page.evaluate(() => addRouteEntry());
  const rows = [['海上運賃', 'A社', 100000, 20000], ['THC', 'B社', 30000, 5000], ['書類作成料', 'C社', 8000, 2000]];
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) { await page.evaluate(() => window.addRow()); await page.waitForTimeout(80); }
    const f = n => page.locator(`#tableBody tr:not([data-virtual]) [data-field="${n}"]`).nth(i);
    await f('nm').fill(rows[i][0]); await f('un').fill('式'); await f('sv').fill(rows[i][1]);
    await f('pq').fill('1'); await f('pp').fill(String(rows[i][2])); await f('mk').fill(String(rows[i][3])); await f('mk').blur();
    await page.waitForTimeout(60);
  }
  const tot = () => page.evaluate(() => ({ cost: document.getElementById('tot-cost').textContent.trim(), sub: document.getElementById('tot-subtotal').textContent.trim() }));
  await page.waitForTimeout(400);   // 合計の再計算は入力から少し遅れて反映される
  const t1 = await tot();
  check('明細の入力と合計の計算（仕入 138,000／売 165,000）', t1.cost === '138,000' && t1.sub === '165,000', JSON.stringify(t1));
  await shot('02-quote-editor-top', '#tab-quote-make .quote-main');
  await shot('03-quote-table', '#tableBody');

  // ③ 保存データの往復（gatherAllData → 新規 → 復元）
  const data = await page.evaluate(() => gatherAllData());
  await page.evaluate(() => qpNewQuote());
  const cleared = await page.evaluate(() => ({ customer: document.getElementById('qf-customer').value, routes: _routeEntries.length }));
  check('新規作成で入力が空になる（顧客名・航路が残らない）', cleared.customer === '' && cleared.routes === 0, JSON.stringify(cleared));
  await page.evaluate(d => _applyQuoteData(d), data);
  await page.waitForTimeout(300);
  const t2 = await tot();
  check('保存データの復元（合計・顧客名・航路）', t2.sub === '165,000' && await page.inputValue('#qf-customer') === 'サンプル商事株式会社' && await page.evaluate(() => _routeEntries.length === 1), JSON.stringify(t2));

  // ④ 物量パターン（FCL案／LCL案）と損益分岐パネル
  await page.evaluate(() => createFclLclPatterns());
  const pats = await page.evaluate(() => calcPatternTotals().map(t => t.name + ':' + t.totalJPY));
  check('FCL案／LCL案の作成とパターン別合計', pats.length === 2, pats.join(' / '));
  await page.click('.qrc-rail-btn[data-mod="fcllcl"]'); await page.waitForTimeout(250);
  await shot('04-rail-fcl-lcl', '.quote-right-col');
  await page.evaluate(() => { const f = document.getElementById('qf-multi-out'); if (f) f.value = '0'; });

  // ⑤ 御見積書（PDF 用 HTML）・メール本文
  const pdf = await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = buildQuoteDocHTML(); return { subj: !!d.querySelector('.qd-subj'), rows: d.querySelectorAll('.qd-items tbody tr').length, hasTotal: /165,000/.test(d.innerText) }; });
  check('御見積書の生成（明細・合計）', pdf.subj && pdf.rows >= 3 && pdf.hasTotal, JSON.stringify(pdf));
  const mail = await page.evaluate(() => { navigator.clipboard.writeText = async x => { window.__c = x; }; copyQuoteEmail(); return new Promise(r => setTimeout(() => r(window.__c || ''), 300)); });
  check('メール本文の生成', /御見積額/.test(mail) && /サンプル商事/.test(mail), mail.slice(0, 60));

  // ⑥ 往復案件（輸出→輸入）と往路・復路
  await page.click('#dirBtns [data-dir="export_import"]');
  await page.fill('#z2Carrier', 'ECU'); await page.fill('#z2Pol', 'XIAMEN'); await page.fill('#z2Pod', 'NAGOYA'); await page.evaluate(() => addRouteEntry());
  await page.selectOption('#cond-incoterms-ret', { label: 'CIF（運賃・保険料込み）' });
  const rt = await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = buildQuoteDocHTML(); return d.querySelector('.qd-subj').innerText.replace(/\s+/g, ' '); });
  check('往復案件の件名・往路／復路・建値', /輸出→輸入/.test(rt) && /往路（輸出）/.test(rt) && /復路（輸入）/.test(rt) && /CIF/.test(rt), rt.slice(0, 120));
  await page.click('#dirBtns [data-dir="export"]');

  // ⑦ 全体リマーク（品物別・常時付記）
  await page.selectOption('#remarkCargoSel', '医療機器・健康効果');
  await page.locator('#presetBtns button', { hasText: '薬機法' }).click();
  const rm = await page.inputValue('#remarkTextarea');
  check('品物別リマークの挿入', /薬機法/.test(rm), rm.slice(0, 30));
  await shot('05-remark-section', '.remark-section');

  // ⑧ 御見積書プレビュー画面
  await page.evaluate(() => openQuoteDoc());
  await page.waitForTimeout(600);
  check('御見積書の出力画面が開く', await page.evaluate(() => !!document.querySelector('#quoteDocOverlay.open .qd-page')));
  await shot('06-quote-doc', '#qdPreview');
  await page.evaluate(() => closeQuoteDoc());

  // ⑨ ダッシュボード（未ログイン表示）・計算タブ
  await page.evaluate(() => qpShowDashboard());
  await page.waitForTimeout(400);
  await shot('07-dashboard');
  await page.evaluate(() => qpShowEditor());
  await page.evaluate(() => { const t = document.querySelector('[data-tab="calc"]'); if (t) t.click(); });
  await page.waitForTimeout(500);
  await shot('08-calc-tab');

  check('画面操作中に JavaScript エラーが出ていない', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(ng ? `\nNG：${ng} / ${results.length} 件が失敗しました。` : `\nOK：${results.length} 件の主要操作がすべて動作しました。`);
  return ng ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(2); });
