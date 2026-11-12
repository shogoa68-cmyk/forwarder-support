// 一括置換のバックアップ・履歴・復元（alias-rules.js）：疑似 Supabase で、書き換え → バックアップ自動ダウンロード → 復元（編集済みは戻さない）
// 使い方: node scripts/design-tests/alias-backup-test.js
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ok  ' + n); } else { fail++; console.log('  NG  ' + n + (d ? '  → ' + d : '')); } };
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP', acceptDownloads: true });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);

  await p.evaluate(() => {
    const mk = (id, cust) => ({ id, customer: cust, pol: null, pod: null, carrier: null, data: { fields: { 'qf-customer': cust }, rows: [] } });
    window.__store = [mk('c1', 'ＡＢＣ商事'), mk('c2', 'ＡＢＣ商事'), mk('c3', '別の会社')];
    window.__failId = null;
    const q = () => {
      const o = { _filter: null, _upd: null };
      const run = () => {
        if (o._upd) { const id = o._eq; if (window.__failId === id) return { error: { message: 'locked' } }; const r = window.__store.find(x => x.id === id); if (r) Object.assign(r, o._upd); return { error: null }; }
        let rows = window.__store; if (o._in) rows = rows.filter(r => o._in.includes(r.id));
        return { data: rows.map(r => ({ id: r.id, data: JSON.parse(JSON.stringify(r.data)) })), error: null };
      };
      o.select = () => o; o.order = () => o; o.range = () => o; o.limit = () => o; o.in = (_c, ids) => { o._in = ids; return o; };
      o.update = u => { o._upd = u; return o; };
      o.eq = (_c, v) => { o._eq = v; return o; };
      o.then = (res, rej) => Promise.resolve(run()).then(res, rej);
      return o;
    };
    window.cloudGetClient = () => ({ from: () => q() });
    window.cloudCurrentUser = () => ({ email: 'admin@x' });
    window.uiConfirm = async () => true;
    localStorage.removeItem('aliasApplyLog_v1');
  });

  // 1) 一括置換 → バックアップが自動でダウンロードされる
  const dl = p.waitForEvent('download');
  const n = await p.evaluate(() => window.arApplyCloud([{ field: 'customer', from_value: 'ＡＢＣ商事', to_value: 'ABC商事' }]));
  const d = await dl;
  const file = path.join(os.tmpdir(), 'ab-' + Date.now() + '.json'); await d.saveAs(file);
  const bk = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok('2 件が書き換わった', n === 2 && await p.evaluate(() => window.__store.filter(r => r.customer === 'ABC商事').length === 2));
  ok('元の内容のバックアップ（JSON）が自動でダウンロードされる', bk.kind === 'alias-apply-backup' && bk.items.length === 2 && bk.items[0].before.fields['qf-customer'] === 'ＡＢＣ商事', JSON.stringify(bk).slice(0, 150));
  ok('書き換わらなかった案件はバックアップに入らない', !bk.items.some(x => x.id === 'c3'));
  ok('履歴が残る', await p.evaluate(() => JSON.parse(localStorage.getItem('aliasApplyLog_v1') || '[]').length === 1));
  ok('試算（dryRun）ではバックアップを出さない', await p.evaluate(async () => { let called = false; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { called = true; }; await window.arApplyCloud([{ field: 'customer', from_value: '別の会社', to_value: 'X' }], true); HTMLAnchorElement.prototype.click = orig; return !called; }));

  // 2) 1 件を置換のあとに編集 → 復元は編集されていないものだけ
  await p.evaluate(() => { const r = window.__store.find(x => x.id === 'c2'); r.data.fields['qf-memo'] = '後から編集'; });
  const fc = p.waitForEvent('filechooser');
  await p.evaluate(() => window.arRestoreFromBackup());
  await (await fc).setFiles(file); await p.waitForTimeout(800);
  const st = await p.evaluate(() => window.__store.map(r => [r.id, r.data.fields['qf-customer'], r.customer]));
  ok('編集されていない案件は置換前に戻る（データと customer 列）', st.find(x => x[0] === 'c1')[1] === 'ＡＢＣ商事' && st.find(x => x[0] === 'c1')[2] === 'ＡＢＣ商事', JSON.stringify(st));
  ok('置換のあとに編集された案件は戻さない', st.find(x => x[0] === 'c2')[1] === 'ABC商事', JSON.stringify(st));
  ok('別の会社は触らない', st.find(x => x[0] === 'c3')[1] === '別の会社');

  // 3) 画面（エイリアス是正）に復元ボタンと履歴
  await p.evaluate(() => { window.arGetRules = async () => [{ id: 1, field: 'customer', from_value: 'a', to_value: 'b' }]; });
  const html = await p.evaluate(async () => { document.querySelector('#statsPane-alias') || document.body.insertAdjacentHTML('beforeend', '<div id="statsPane-alias"></div>'); await window.arRenderPane(); return document.getElementById('statsPane-alias').innerHTML; });
  ok('画面に「バックアップから元に戻す」ボタンと最近の一括置換が出る', /バックアップから元に戻す/.test(html) && /最近の一括置換/.test(html));
  ok('ページエラーなし', errs.length === 0, JSON.stringify(errs));
  await b.close(); srv.close();
  console.log(`\n${pass} 項目 OK / ${fail} 件 NG`); process.exit(fail ? 1 : 0);
})();
