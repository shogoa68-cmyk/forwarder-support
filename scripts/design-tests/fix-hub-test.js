// 🔧 ゆらぎ・未登録の「1 行＋主ボタン」（Design 29 ①b）の確認。node scripts/design-tests/fix-hub-test.js
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..', 'フォワーダー支援');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith(path.sep)) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
srv.listen(0, async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  await ctx.route(u => !u.href.startsWith('http://localhost'), r => r.abort());
  const p = await ctx.newPage();
  await p.goto('http://localhost:' + srv.address().port + '/index.html'); await p.waitForTimeout(1200);
  await p.evaluate(() => {
    const R = (sv, nm, pp, bp, cust) => ({ _type: 'data', cells: ['', '運賃', sv, '', nm, '1', 'B/L', '1', 'JPY', 'JPY', String(pp), String(bp)] });
    const M = (id, st, rows, f, cust) => ({ id, name: 'case' + id, status: st, customer: cust || '甲商事', data: { rows, fields: Object.assign({ 'qf-status': st }, f || {}) }, updated_at: new Date().toISOString(), created_by: 'a@example.com' });
    const rows = [
      M(1, '受注', [R('ABC運輸', 'O/F', 100, 140), R('ＡＢＣ運輸', 'CFS作業料', 100, 108)]),
      M(2, '失注', [R('DEF通運', 'O/F', 100, 130)], { 'qf-lost-reason': '価格' }, '乙物産'),
      M(3, '失注', [R('DEF通運', 'O/F', 100, 130)], { 'qf-lost-reason': '価格' }, '乙物産'),
      M(4, '提示済み', [R('GHI倉庫', '保管料', 100, 120), R('GHI 倉庫', '通関料', 80, 90)], {}, '丙商会'),
      M(5, '受注', [R('ABC運輸', 'THC', 50, 70), R('JKL海運', 'O/F', 200, 230)], {}, '乙物産'),
      M(6, '受注', [R('JKL海運', 'O/F', 200, 260)], {}, '丙商会'),
    ];
    window.cloudGetAllRows = () => rows;
  });
  await p.evaluate(() => switchCategory('stats', document.querySelector('[onclick*="switchCategory(\'stats"]'))); await p.waitForTimeout(1800);
  let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x))); };
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.evaluate(() => { window.__calls = []; window.uiConfirm = async o => { window.__calls.push(['confirm', o.title, (o.lines||[]).join('|')]); return true; };
    window.synAddAlias = async (f, a, c) => { window.__calls.push(['alias', f, a, c]); }; window.synRemoveAlias = async (f, a, c) => { window.__calls.push(['unalias', f, a, c]); };
    window.statsToggleVote = async (f, n) => { window.__calls.push(['vote', f, n]); }; });
  await p.evaluate(() => window.statsSetPane('sv')); await p.waitForTimeout(1500);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')].map(t => ({ tog: !!t.querySelector('.fh-tog'), open: t.classList.contains('fh-open'), chipsShown: getComputedStyle(t.querySelector('td.stats-chips-cell')).display, st: t.querySelector('.fh-st')?.textContent || '', badge: !!t.querySelector('.stats-variant-badge') })));
  ok('行ごとに開閉ボタンがあり、最初は畳んである', rows.length >= 3 && rows.every(r => r.tog && !r.open && r.chipsShown === 'none'), rows);
  ok('未登録の札・ゆらぎの札が出る', rows.some(r => r.st === '未登録') && rows.some(r => r.badge), rows);
  const vi = await p.evaluate(() => [...document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')].findIndex(t => t.classList.contains('stats-has-variant')));
  await p.evaluate(i => document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')[i].querySelector('.fh-tog').click(), vi);
  const op = await p.evaluate(i => { const t = document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')[i]; const m = t.querySelector('.fh-main'); return { open: t.classList.contains('fh-open'), main: m && m.textContent, chips: getComputedStyle(t.querySelector('td.stats-chips-cell')).display, btnHidden: [...t.querySelectorAll('.stats-chip button')].every(b => getComputedStyle(b).display === 'none'), canon: t.querySelector('.fh-canon') && t.querySelector('.fh-canon').value }; }, vi);
  ok('開くと表記の一覧と主ボタン［この名前にまとめる］・細かいボタンは隠れている', op.open && op.main === 'この名前にまとめる' && op.chips === 'block' && op.btnHidden, op);
  await p.evaluate(i => document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')[i].querySelector('.fh-main').click(), vi); await p.waitForTimeout(500);
  const calls = await p.evaluate(() => window.__calls);
  ok('確認ダイアログ→別名にまとめる', calls[0] && calls[0][0] === 'confirm' && calls.some(c => c[0] === 'alias' && c[1] === 'sv'), calls);
  ok('下のバーに［元に戻す］', await p.evaluate(() => !!document.querySelector('#fhUndo button') && /にまとめました/.test(document.getElementById('fhUndo').textContent)));
  await p.evaluate(() => document.querySelector('#fhUndo button').click()); await p.waitForTimeout(400);
  ok('元に戻す→別名を外す', (await p.evaluate(() => window.__calls)).some(c => c[0] === 'unalias'));
  const si = await p.evaluate(() => [...document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')].findIndex(t => t.querySelector('.fh-st-new')));
  if (si >= 0) { await p.evaluate(i => { const t = document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')[i]; t.querySelector('.fh-tog').click(); t.querySelector('.fh-main').click(); }, si); await p.waitForTimeout(400);
    ok('未登録の行は［☆ マスターに登録］で登録される', (await p.evaluate(() => window.__calls)).some(c => c[0] === 'vote')); }
  await p.evaluate(() => { document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')[0].querySelector('.fh-more').click(); });
  ok('［⋯ その他］で細かいボタンが出る', await p.evaluate(() => [...document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')[0].querySelectorAll('.stats-chip button')].some(b => getComputedStyle(b).display !== 'none')));
  ok('ページエラーなし', errs.length === 0, errs);
  console.log(fails ? fails + ' FAIL' : '全項目 PASS');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
});
