// 仕入側だけミニマムが入っていて売値側のミニマムが空の行（PROFIT SHARE など）は、利益・粗利率を計算しない（—）。架空データ・外部接続なし。
//   node scripts/design-tests/min-profit-test.js        （THEME=1 で Industry）
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
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {} });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  p.setDefaultTimeout(10000);
  const out = [];
  const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));

  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);

  const id = await p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').id.replace('row-', ''));
  const set = (f, v) => p.evaluate(([i, v]) => { const el = document.getElementById(i); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [f + '-' + id, String(v)]);   // MIN の欄は MIN モードを開くまで隠れているため DOM 経由
  const cell = () => p.evaluate(id => ({ st: document.querySelector('#st-' + id + ' .st-main')?.textContent.trim(), pr: document.querySelector('#pr-' + id + ' .pr-main')?.textContent.trim(),
    rate: document.querySelector('#pr-' + id + ' .pr-rate')?.textContent.trim() || '', cls: document.getElementById('pr-' + id).className, title: document.getElementById('pr-' + id).title,
    flag: document.getElementById('row-' + id).dataset.noProfit || '' }), id);
  await p.fill('#nm-' + id, 'PROFIT SHARE');
  await p.fill('#un-' + id, 'C/W');
  await p.selectOption('#pc-' + id, 'EUR');
  await set('pq', 500); await set('pp', 0.05); await set('mk', 0);

  // 1) ミニマムなし：従来どおり利益が出る（売 25 − 仕入 25 ＝ 0）
  let c = await cell();
  ok('ミニマムなしは従来どおり数値（0）', c.pr === '0' && c.flag === '', c);

  // 2) 仕入のミニマムだけ 40：利益・粗利率は「—」・小計（売）は数量×売単価のまま
  await set('ppmin', 40);
  c = await cell();
  ok('仕入MINだけ → 利益は「—」', c.pr === '—', c);
  ok('粗利率の表示もない', c.rate === '', c);
  ok('小計（売）は数量×売単価のまま 25', /^25(\.00)?$/.test(c.st), c);
  ok('赤字の色（profit-neg）にならない・理由が title に出る', !/profit-neg/.test(c.cls) && /計算しません/.test(c.title) && c.flag === '1', c);

  // 3) 数量を変えても「—」のまま（数量しだいで赤字に見えない）
  await set('pq', 2000);
  c = await cell();
  ok('数量を変えても「—」', c.pr === '—', c);
  await set('pq', 500);

  // 4) 売値側にもミニマムを入れると、従来どおり利益を計算する（売 40 − 仕入 40 ＝ 0）
  await set('bpmin', 40);
  c = await cell();
  ok('売MINも入れると数値に戻る', c.pr !== '—' && c.flag === '' && c.title === '', c);

  // 5) 売MINだけ消すと「—」に戻り、仕入MINも消すと通常
  await set('bpmin', '');
  c = await cell();
  ok('売MINを空にすると「—」に戻る', c.pr === '—', c);
  await set('ppmin', '');
  c = await cell();
  ok('仕入MINも空なら通常の数値', c.pr === '0' && c.flag === '', c);

  // 6) 売MINだけ入っている行（仕入MINなし）は従来どおり利益を計算する
  await set('bpmin', 40);
  c = await cell();
  ok('売MINだけの行は従来どおり数値', c.pr !== '—' && c.flag === '', c);

  // 7) 外貨が違う行（円換算の利益）でも「—」
  await set('bpmin', ''); await set('ppmin', 40);
  await p.evaluate(i => { const el = document.getElementById('bc-' + i); el.value = 'USD'; el.dispatchEvent(new Event('change', { bubbles: true })); }, id);
  await p.waitForTimeout(200);
  c = await cell();
  ok('通貨が違っても「—」', c.pr === '—', c);

  ok('JS エラーなし', errs.length === 0, errs);
  console.log(out.join('\n'));
  console.log(out.some(l => l.startsWith('FAIL')) ? '\n失敗あり' : '\n全項目 PASS');
  await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
