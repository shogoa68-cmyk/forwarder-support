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
  const info = () => p.evaluate(() => { const g = id => document.getElementById(id); const par = id => g(id) && g(id).parentElement && g(id).parentElement.id; return { on: document.body.classList.contains('qm-2col'), ref: par('section-ref'), cond: par('section-cond'), cargo: par('section-cargo'), vol: par('section-volume'), scope: par('section-scope'), remark: par('section-remark'), remarkParent: g('section-remark').parentElement.className, table: g('section-table').parentElement.className, order: [...document.querySelectorAll('#tab-quote-make .quote-main > *')].map(e => e.id || e.className.split(' ')[0]).join(',') }; });
  let i = await info();
  ok('[広い画面] 1 段目：管理番号｜貿易条件・輸送モード', i.on && i.ref === 'qmCellA' && i.cond === 'qmCellB', i);
  ok('[広い画面] 2 段目：貨物情報（＋作業範囲）｜物量情報', i.cargo === 'qmCellC' && i.scope === 'qmCellC' && i.vol === 'qmCellD', i);
  ok('[広い画面] 見積もりテーブルは全幅（列の外）・全体リマークはその下（1 カラム）', !/qm-col/.test(i.table) && !/qm-col/.test(i.remarkParent) && /qmCols,section-table,section-remark/.test(i.order), i);
  const g = await p.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); const A = r('section-ref'), B = r('section-cond'), C = r('section-cargo'), D = r('section-volume'), T = r('section-table'), R = r('section-remark'); return { aLeftOfB: A.right <= B.left + 1, cLeftOfD: C.right <= D.left + 1, aSameRowB: Math.abs(A.top - B.top) < 4, cSameRowD: Math.abs(C.top - D.top) < 4, row2BelowRow1: C.top >= Math.max(A.bottom, B.bottom) - 1, tableBelowRow2: T.top >= Math.max(C.bottom, D.bottom) - 1, remarkBelowTable: R.top >= T.bottom - 1, widths: [Math.round(A.width), Math.round(B.width), Math.round(C.width), Math.round(D.width)] }; });
  ok('[広い画面] 配置：A｜B と C｜D が同じ段で左右に並び、その下に表・リマーク', g.aLeftOfB && g.cLeftOfD && g.aSameRowB && g.cSameRowD && g.row2BelowRow1 && g.tableBelowRow2 && g.remarkBelowTable, g);
  ok('[広い画面] 左右の列の幅がそろう', Math.abs(g.widths[0] - g.widths[1]) <= 2 && Math.abs(g.widths[2] - g.widths[3]) <= 2 && Math.abs(g.widths[0] - g.widths[2]) <= 2, g.widths);
  const nav = () => p.evaluate(() => [...document.querySelectorAll('#qSecNav .q-secnav-btn')].map(b => b.dataset.sec.replace('section-', '')).join(','));
  ok('[広い画面] 左端のナビの並び：…→作業範囲→費用→リマーク', (await nav()) === 'ref,cond,cargo,volume,scope,table,remark', await nav());
  ok('[広い画面] ナビのリマークを押すと全体リマークへ移動できる', await p.evaluate(async () => { document.querySelector('#qSecNav [data-sec="section-remark"]').click(); await new Promise(r => setTimeout(r, 700)); const r = document.getElementById('section-remark').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }));
  ok('[広い画面] 横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  // 入力・保存の動きは変わらない
  await p.fill('#qf-customer', 'テスト商事'); await p.selectOption('#cond-incoterms', { label: 'FOB（本船渡し）' }); await p.waitForTimeout(200);
  ok('[広い画面] 移したセクションの入力が従来どおり動く', await p.evaluate(() => document.getElementById('qf-customer').value === 'テスト商事' && document.getElementById('cond-incoterms').value.startsWith('FOB')));
  // 狭くすると 1 カラムへ戻る
  await p.setViewportSize({ width: 1300, height: 900 }); await p.waitForTimeout(500);
  i = await info();
  ok('[狭い画面] 1 カラムに戻る（元の並び：管理番号→貿易条件→貨物→物量→作業範囲→リマーク→テーブル）', !i.on && /section-ref,section-cond,section-cargo,section-volume,section-scope,section-remark,section-table/.test(i.order), i.order);
  ok('[狭い画面] ナビの並びも元（…→作業範囲→リマーク→費用）に戻る', (await nav()) === 'ref,cond,cargo,volume,scope,remark,table', await nav());
  ok('[狭い画面] 値は残っている', await p.evaluate(() => document.getElementById('qf-customer').value === 'テスト商事'));
  await p.setViewportSize({ width: 1920, height: 1032 }); await p.waitForTimeout(500);
  ok('[広い画面へ戻す] もう一度 2 カラム', (await info()).on);
  ok('JS エラーなし', errs.length === 0, errs);
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
