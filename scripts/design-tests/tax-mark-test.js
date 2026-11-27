// 課税の行の印：品名を打ち直しても「*」が消えない・「課税」の札（js/quote/row.js syncTaxMark・css/tax-mark.css）
//   node scripts/design-tests/tax-mark-test.js   （THEME=classic|quiet・EDITOR=v1・W=390・OUT=<dir> で写真）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const th = process.env.THEME, ed = process.env.EDITOR || 'v2', W = +(process.env.W || 1440), OUT = process.env.OUT;
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=${ed}${th ? '&theme=' + th : ''}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('fbFabHintDone_v1', '1'); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL); await p.waitForTimeout(700);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(700);
  if (ed === 'v2') await p.evaluate(() => window.editorV2Go(4, true));
  await p.evaluate(() => {
    window.__last = () => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])')].pop();
    window.__f = (t, n, v) => { const e = t.querySelector(`[data-field="${n}"]`); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    window.__tick = (t, on) => { const x = t.querySelector('[data-field="tx"]'); x.checked = on; x.dispatchEvent(new Event('change', { bubbles: true })); };
  });
  const nm = () => p.evaluate(() => window.__last().querySelector('[data-field="nm"]').value);
  // ① 課税にしてから品名を入れる（以前は「*」が消えていた）
  await p.evaluate(() => { window.__tick(window.__last(), true); window.__f(window.__last(), 'nm', 'DOC FEE'); }); await p.waitForTimeout(200);
  ok('課税にしてから品名を入れても「*」が付く', await nm() === '*DOC FEE', await nm());
  // ② 課税の行の品名を打ち直す
  await p.evaluate(() => { window.__f(window.__last(), 'nm', 'CFS CHARGE'); }); await p.waitForTimeout(200);
  ok('課税の行の品名を打ち直しても「*」が付き直す', await nm() === '*CFS CHARGE', await nm());
  // ③ 課税を外すと「*」も札も消える
  await p.evaluate(() => window.__tick(window.__last(), false)); await p.waitForTimeout(200);
  ok('課税を外すと「*」が消える', await nm() === 'CFS CHARGE', await nm());
  // ④ 「*」の欠けた旧データ（課税・品名に * なし）を開くと付け直す
  await p.evaluate(() => { window.__tick(window.__last(), true); });
  await p.waitForTimeout(150);
  await p.evaluate(() => { const d = window.gatherAllData(); const r = (d.rows || d.tableRows || []); const t = window.__last(); t.querySelector('[data-field="nm"]').value = 'THC'; window.__oldData = window.gatherAllData(); });
  await p.evaluate(() => window._applyQuoteData(window.__oldData)); await p.waitForTimeout(600);
  ok('課税なのに「*」が欠けた案件を開くと「*」を付け直す', await nm() === '*THC', await nm());
  // ⑤ 課税していない行には何も付かない
  await p.evaluate(() => { window.addRow(); window.__f(window.__last(), 'nm', 'OCEAN FREIGHT'); }); await p.waitForTimeout(400);
  const look = await p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])')].map(tr => ({
    taxed: tr.classList.contains('taxed'), nm: tr.querySelector('[data-field="nm"]').value,
    chip: (() => { const c = tr.querySelector('.ca-tax'); return !!c && !!c.getClientRects().length; })(),
    cell: (() => { const c = tr.querySelector('td.tax-cell'); return c ? getComputedStyle(c, '::after').content : ''; })(),
    mc: (() => { const m = document.querySelector(`.mc-row[data-row="${tr.id}"] .is-tax`); return !!m && !!m.getClientRects().length; })(),
  })));
  const tx = look.find(x => x.taxed), nt = look.find(x => !x.taxed);
  ok('課税していない行は「*」も札も無い', nt && !/^\*/.test(nt.nm) && !nt.chip && !nt.mc && !/課税/.test(nt.cell), nt);
  if (W <= 600) ok('スマホ：一覧の行に「課税」の札', tx && tx.mc, look);
  else if (ed === 'v2') ok('新画面：項目名の後ろに「課税」の札', tx && tx.chip, look);
  else ok('旧画面：課税の欄に「課税」の字', tx && /課税/.test(tx.cell), look);
  // ⑥ 税の計算・出力はチェックのまま（印の変更で変わらない）
  ok('税の計算はチェックで決まる（行のデータの taxed）', await p.evaluate(() => (window.collectAllRows ? window.collectAllRows() : []).filter(r => r._type === 'data' || r.taxed !== undefined).some(r => r.taxed)));
  // ⑦ メール本文：課税の行の印は「*」1 つだけ（品名の「*」と重ねて「**」にしない）
  const mail = await p.evaluate(async () => {
    let got = ''; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { got = t; return Promise.resolve(); } } }); } catch (e) {}
    const oe = document.execCommand.bind(document); document.execCommand = c => { if (c === 'copy') { const a = document.activeElement; got = got || (a && a.value) || ''; return true; } return oe(c); };
    const t = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])')].find(x => x.classList.contains('taxed'));
    const f = (n, v) => { const e = t.querySelector(`[data-field="${n}"]`); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    f('pp', '1000'); await new Promise(r => setTimeout(r, 200));
    window.copyQuoteEmail(); await new Promise(r => setTimeout(r, 400));
    return got;
  });
  ok('メール本文：課税の行は「*THC」（「**」にならない）', /\*THC/.test(mail) && !/\*\*THC/.test(mail), mail.slice(0, 400));
  if (OUT) { await p.evaluate(() => document.getElementById('tableScrollWrap').scrollIntoView({ block: 'start' })); await p.evaluate(() => window.scrollBy(0, -200)); await p.waitForTimeout(200); await p.screenshot({ path: path.join(OUT, `tax-${ed}-${th || 'industry'}-${W}.png`) }); }
  ok('エラーなし', !errs.length, errs);
  await b.close(); srv.close();
  console.log(fails ? `FAIL=${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
