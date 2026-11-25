// 2026-11 の QA で見つかった、お客様に誤った情報が出る不具合の再発防止（架空データ・外部接続なし）。
//   ①メール本文に、行の「備考（社内用）」を出さない
//   ②メール本文の為替の注記が、実際と逆のことを言わない（請求が外貨／仕入だけ外貨で文を分ける）
//   ③計算タブの輸入消費税：国税 7.8%＋地方消費税 2.2%（国税×22/78）＝合わせて 10%（以前は約 28% 多く出ていた）
//   node scripts/design-tests/qa-top5-test.js        （THEME=1 で Industry）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');

(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
    // コピーした文を受け取る
    window.__clip = '';
    try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__clip = t; return Promise.resolve(); } } }); } catch (e) {}
  });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  p.setDefaultTimeout(10000);
  let fails = 0;
  const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };

  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);

  const id = await p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').id.replace('row-', ''));
  const set = async (sel, v) => { await p.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]); };
  await set('#nm-' + id, 'Ocean Freight');
  await set('#un-' + id, '20GP');
  await set('#pq-' + id, '1');
  await set('#pp-' + id, '1000');
  await set('#mk-' + id, '200');
  await set('#nt-' + id, '仕入はA社USD280・値引き余地あり');
  const mail = async () => { await p.evaluate(() => { window.__clip = ''; window.copyQuoteEmail(); }); await p.waitForTimeout(300); return p.evaluate(() => window.__clip); };

  // ① 備考は出さない（円の行）
  let t = await mail();
  ok('メール本文が作れる', /Ocean Freight/.test(t), t.slice(0, 200));
  ok('① 行の備考（社内用）はメール本文に出ない', !/値引き余地/.test(t), t);
  ok('② 円だけの見積には為替の注記を付けない', !/為替|外貨建て/.test(t), t);

  // ② 請求が外貨（USD）
  await set('#pc-' + id, 'USD');
  await set('#bc-' + id, 'USD');
  await p.waitForTimeout(200);
  t = await mail();
  ok('② 請求が外貨なら「記載の通貨でのご請求」と書く', /記載の通貨でのご請求/.test(t), t);
  ok('② 請求が外貨なのに「JPY建て請求」と書かない（以前の逆の注記）', !/JPY建て請求/.test(t), t);
  ok('① 外貨の行でも備考は出ない', !/値引き余地/.test(t), t);

  // ② 仕入だけ外貨（請求は円）
  await set('#bc-' + id, 'JPY');
  await p.waitForTimeout(200);
  t = await mail();
  ok('② 仕入だけ外貨なら「外貨建ての原価を基に円で算出…改定する場合」と書く', /外貨建ての原価を基に円で算出/.test(t), t);
  ok('② 仕入だけ外貨のとき「記載の通貨でのご請求」は書かない', !/記載の通貨でのご請求/.test(t), t);

  // ③ 計算タブの輸入消費税
  const duty = async (cif, rate) => {
    await p.evaluate(([cif, rate]) => {
      document.getElementById('duty-cif').value = String(cif);
      document.getElementById('duty-rate').value = String(rate);
      const res = document.getElementById('duty-result'); if (res) res.innerHTML = '';
      calcDuty();
    }, [cif, rate]);
    await p.waitForTimeout(150);
    return p.evaluate(() => (document.getElementById('duty-result') || {}).innerText || '');
  };
  let d = await duty(1000000, 0);
  ok('③ CIF ¥1,000,000・関税 0% → 消費税（国税 7.8%）¥78,000', /消費税（国税 7\.8%）\s*¥78,000/.test(d), d);
  ok('③ 地方消費税 ¥22,000', /地方消費税[^\n]*\s*¥22,000/.test(d), d);
  ok('③ 税金合計 ¥100,000（以前は ¥128,200）', /税金合計\s*¥100,000/.test(d) && !/128,200/.test(d), d);
  d = await duty(2345678, 5);
  // 課税価格 2,345,000 → 関税 117,200（100円未満切捨）→ 課税標準 2,462,000 → 国税 192,000（192,036→100円未満切捨）→ 地方 54,100（54,153）
  ok('③ CIF ¥2,345,678・関税 5% → 関税 ¥117,200・国税 ¥192,000・地方 ¥54,100・合計 ¥363,300',
    /¥117,200/.test(d) && /¥192,000/.test(d) && /¥54,100/.test(d) && /税金合計\s*¥363,300/.test(d), d);

  ok('ページエラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
  console.log(fails ? fails + ' 件 FAIL' : '全項目 PASS');
  process.exit(fails ? 1 : 0);
})();
