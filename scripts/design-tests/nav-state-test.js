// 画面遷移の回帰試験：①「← 見積もりに戻る」で上段の「見積」が選択中になる（BOOKMARK ではない）
// ②編集権を失って閲覧に落ちたあと再び「編集」しても、未保存の入力は未保存扱いのまま（ダッシュボードへ戻るときに確認が出る）。
//   node scripts/design-tests/nav-state-test.js   （THEME=1 で Industry。②は約 35 秒かかる）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ok = (n, c, d) => console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  const ID = '00000000-0000-4000-8000-000000000001';
  const c1 = { id: ID, name: '案件1', status: 'draft', customer: 'C1', person: 'P', owner_email: 's@example.com', created_by: 's@example.com', updated_at: new Date().toISOString(), data: { fields: { 'qf-customer': 'C1' }, rows: [], _rowFormat: 'v3-mixed-rows' } };
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(({ c1 }) => {
    try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
    const mk = t => { const st = { one: false }; const bb = new Proxy({}, { get(_, k) { if (k === 'then') return (res, rej) => Promise.resolve({ data: st.one ? c1 : (t === 'quote_presets' ? [c1] : []), error: null }).then(res, rej); if (k === 'single' || k === 'maybeSingle') return () => { st.one = true; return bb; }; return () => bb; } }); return bb; };
    const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, presenceState() { return {}; }, unsubscribe() { return Promise.resolve(); }, send() { return Promise.resolve(); } };
    const user = { email: 's@example.com', user_metadata: { full_name: 'S' } };
    const client = { from: mk, rpc: n => Promise.resolve({ data: (window.__lost && /renew|acquire/.test(n)) ? 'other@x.com' : (n === 'quote_acquire_lock' ? 'OK' : (n === 'quote_renew_lock' ? true : null)), error: null }), channel: () => ch, removeChannel() {}, storage: { from: () => ({}) }, auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signOut: () => Promise.resolve({}), signInWithOAuth: () => Promise.resolve({}) } };
    window.supabase = { createClient: () => client };
  }, { c1 });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  const click = sel => p.evaluate(s => document.querySelector(s).click(), sel);
  await click('.cat-btn[aria-controls="tab-quote-make"]'); await p.waitForTimeout(1500);
  await click('.cat-btn[aria-controls="tab-calc"]'); await p.waitForTimeout(400);
  await p.click('#backToQuoteFab'); await p.waitForTimeout(400);
  const s = await p.evaluate(() => ({ tab: document.getElementById('tab-quote-make').classList.contains('active'), act: [...document.querySelectorAll('.cat-btn.active')].map(e => e.textContent.trim()) }));
  ok('「見積もりに戻る」で見積タブが開き、選択中は「見積」だけ', s.tab && s.act.length === 1 && /見積/.test(s.act[0]), s);
  await p.evaluate(id => cloudLoadPreset(encodeURIComponent(id)), ID); await p.waitForTimeout(800);
  await p.evaluate(() => quoteModeEdit()); await p.waitForTimeout(500);
  await p.fill('#qf-customer', 'CHANGED'); await p.waitForTimeout(200);
  await p.evaluate(() => { window.__lost = 1; }); await p.waitForTimeout(32000); await p.evaluate(() => { window.__lost = 0; });
  ok('編集権を失うと閲覧モードに落ちる', await p.evaluate(() => document.querySelector('#tab-quote-make .quote-main').inert), null);
  await p.evaluate(() => quoteModeEdit()); await p.waitForTimeout(500);
  p.evaluate(() => qpBackToDashboard()).catch(() => {}); await p.waitForTimeout(500);
  ok('再編集後にダッシュボードへ戻ろうとすると、未保存の確認が出る', await p.evaluate(() => !!document.getElementById('qpLeaveConfirm') && document.getElementById('qpLeaveConfirm').classList.contains('open')), null);
  await b.close(); srv.close();
})();
