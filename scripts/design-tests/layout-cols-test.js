// 見積入力の 2 カラム配置（広い画面）の試験。  node scripts/design-tests/layout-cols-test.js （THEME=1, MODE=simple）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const out = []; const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1032 }, locale: 'ja-JP' });
  await ctx.addInitScript((mode) => { try { localStorage.setItem('fwd.uiMode', mode); } catch (e) {} }, process.env.MODE || 'detail');
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(700);
  const info = () => p.evaluate(() => { const g = id => document.getElementById(id); const par = id => g(id) && g(id).parentElement && g(id).parentElement.id; return { on: document.body.classList.contains('qm-2col'), ref: par('section-ref'), cond: par('section-cond'), cargo: par('section-cargo'), vol: par('section-volume'), scope: par('section-scope'), remark: par('section-remark'), table: g('section-table').parentElement.className, order: [...document.querySelectorAll('#tab-quote-make .quote-main > *')].map(e => e.id || e.className.split(' ')[0]).join(',') }; });
  let i = await info();
  ok('[広い画面] 2 カラム：左＝管理番号・貿易条件', i.on && i.ref === 'qmColL' && i.cond === 'qmColL', i);
  ok('[広い画面] 2 カラム：右＝貨物・物量・作業範囲・リマーク', i.cargo === 'qmColR' && i.vol === 'qmColR' && i.scope === 'qmColR' && i.remark === 'qmColR', i);
  ok('[広い画面] 見積もりテーブルは全幅（列の外）', !/qm-col/.test(i.table), i.table);
  const w = await p.evaluate(() => ['qmColL', 'qmColR'].map(id => Math.round(document.getElementById(id).getBoundingClientRect().width)));
  ok('[広い画面] 左右の列の幅がそろう', Math.abs(w[0] - w[1]) <= 2, w);
  ok('[広い画面] 横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  // 入力・保存の動きは変わらない
  await p.fill('#qf-customer', 'テスト商事'); await p.selectOption('#cond-incoterms', { label: 'FOB（本船渡し）' }); await p.waitForTimeout(200);
  ok('[広い画面] 移したセクションの入力が従来どおり動く', await p.evaluate(() => document.getElementById('qf-customer').value === 'テスト商事' && document.getElementById('cond-incoterms').value.startsWith('FOB')));
  // 狭くすると 1 カラムへ戻る
  await p.setViewportSize({ width: 1300, height: 900 }); await p.waitForTimeout(500);
  i = await info();
  ok('[狭い画面] 1 カラムに戻る（元の並び：管理番号→貿易条件→貨物→物量→作業範囲→リマーク→テーブル）', !i.on && /section-ref,section-cond,section-cargo,section-volume,section-scope,section-remark,section-table/.test(i.order), i.order);
  ok('[狭い画面] 値は残っている', await p.evaluate(() => document.getElementById('qf-customer').value === 'テスト商事'));
  await p.setViewportSize({ width: 1920, height: 1032 }); await p.waitForTimeout(500);
  ok('[広い画面へ戻す] もう一度 2 カラム', (await info()).on);
  ok('JS エラーなし', errs.length === 0, errs);
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
