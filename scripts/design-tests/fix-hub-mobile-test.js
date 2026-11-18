// 名前の整理のスマホ版（Design 29 ⑥）。node scripts/design-tests/fix-hub-mobile-test.js
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..', 'フォワーダー支援');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith(path.sep)) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
srv.listen(0, async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
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
  await p.evaluate(() => switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]'))); await p.waitForTimeout(1800);
  let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x))); };
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.evaluate(() => { window.__calls = []; window.uiConfirm = async o => { window.__calls.push(['confirm', o.title, (o.lines||[]).join('|')]); return true; };
    window.synAddAlias = async (f, a, c) => { window.__calls.push(['alias', f, a, c]); }; window.synRemoveAlias = async (f, a, c) => { window.__calls.push(['unalias', f, a, c]); };
    window.statsToggleVote = async (f, n) => { window.__calls.push(['vote', f, n]); }; });
  const vis = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);
  ok('今日やることに「名前の整理」のカードがある', await p.evaluate(() => !!document.querySelector('#mmHome [data-go="fix"]')));
  await p.evaluate(() => document.querySelector('#mmHome [data-go="fix"]').click()); await p.waitForTimeout(900);
  ok('名前の整理の画面が出る（一覧・マスターは隠れる）', await vis('#statsPane-fix') && !(await vis('#statsPane-master')));
  ok('下の 3 タブが出ている', await vis('#ptBar'));
  await p.evaluate(() => window.fixSetKind && window.fixSetKind('sv')); await p.waitForTimeout(1200);
  const vi = await p.evaluate(() => [...document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')].findIndex(t => t.classList.contains('stats-has-variant')));
  ok('ゆらぎのある行が 1 件＝1 カードで出る', vi >= 0 && await p.evaluate(i => { const t = document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')[i]; return t.getBoundingClientRect().width <= innerWidth && !!t.querySelector('.fh-tog'); }, vi));
  await p.evaluate(i => document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')[i].querySelector('.fh-tog').click(), vi); await p.waitForTimeout(300);
  const sz = await p.evaluate(i => { const t = document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')[i]; const m = t.querySelector('.fh-main'), c = t.querySelector('.fh-canon'), g = t.querySelector('.fh-tog'); const h = e => e ? Math.round(e.getBoundingClientRect().height) : 0; return { main: h(m), canon: h(c), tog: h(g), w: Math.round(m.getBoundingClientRect().width), vw: innerWidth }; }, vi);
  ok('主ボタン・選択・開閉は 44px 以上で幅いっぱい', sz.main >= 44 && sz.canon >= 44 && sz.tog >= 44 && sz.w > sz.vw * 0.7, sz);
  await p.evaluate(i => document.querySelectorAll('#statsPane-sv .stats-nm-table tbody > tr')[i].querySelector('.fh-main').click(), vi); await p.waitForTimeout(500);
  const calls = await p.evaluate(() => window.__calls);
  ok('確認→別名にまとめる', calls[0] && calls[0][0] === 'confirm' && calls.some(c => c[0] === 'alias'), calls);
  ok('元に戻すバーが下のタブより上に出る', await p.evaluate(() => { const u = document.getElementById('fhUndo'), t = document.getElementById('ptBar'); return !!u && u.getBoundingClientRect().bottom <= t.getBoundingClientRect().top + 1; }));
  ok('横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok('ページエラーなし', errs.length === 0, errs);
  console.log(fails ? fails + ' FAIL' : '全項目 PASS');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
});
