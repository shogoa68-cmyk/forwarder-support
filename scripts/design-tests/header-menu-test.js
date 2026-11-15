// ヘッダーの 2 アイコン化（☰ メニュー／アカウント）の確認。偽の Supabase でログイン状態を作る。
//   node scripts/design-tests/header-menu-test.js   （THEME=classic|quiet・W=390・OUT=<dir>）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const out = []; const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  const th = process.env.THEME;
  for (const loggedIn of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: +(process.env.W || 1300), height: 800 }, locale: 'ja-JP' });
    await ctx.addInitScript(({ th, loggedIn }) => {
      try { localStorage.setItem('forwarderTheme_v1', JSON.stringify(th === 'classic' ? { site: false, doc: false } : th === 'quiet' ? { quiet: true } : { site: true, doc: true })); } catch (e) {}
      if (!loggedIn) return;
      const user = { email: 's@example.com', user_metadata: { full_name: '青木' } };
      const qb = () => { const api = new Proxy({}, { get: (t, k) => k === 'then' ? (res) => Promise.resolve({ data: [], error: null }).then(res) : () => api }); return api; };
      const ch = { on() { return ch; }, subscribe() { return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, presenceState() { return {}; }, unsubscribe() {} };
      window.supabase = { createClient: () => ({ from: qb, rpc: n => Promise.resolve({ data: n === 'get_my_role' ? 'admin' : null, error: null }), channel: () => ch, removeChannel() {}, storage: { from: () => ({}) }, auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signOut: () => Promise.resolve({}), signInWithOAuth: () => Promise.resolve({}) } }) };
    }, { th, loggedIn });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
    const vis = s => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden'; }, s);
    const L = loggedIn ? '[ログイン中] ' : '[未ログイン] ';
    ok(L + '☰ が見える', await vis('#hdrMenuBtn'));
    ok(L + '元の 4 ボタンは外には出ていない（パネルの中）', await p.evaluate(() => !document.querySelector('.header > a.hdr-roadmap') && document.querySelectorAll('#hdrMenuPanel a.hdr-roadmap:not(#hdrEditorV2Btn)').length === 4));
    ok(L + 'パネルは閉じている', !(await vis('#hdrMenuPanel')));
    await p.click('#hdrMenuBtn'); await p.waitForTimeout(150);
    ok(L + '☰ を押すと 4 つの項目が出る', await vis('#hdrMenuPanel') && await p.$$eval('#hdrMenuPanel a.hdr-roadmap', els => els.every(e => e.getBoundingClientRect().height >= 40)));
    if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'hdr-menu-' + (th || 'industry') + (loggedIn ? '-in' : '-out') + '.png'), clip: { x: 0, y: 0, width: +(process.env.W || 1300), height: 360 } });
    ok(L + 'デザインが開ける', await (async () => { await p.click('#hdrDesignBtn'); await p.waitForTimeout(400); return !(await vis('#hdrMenuPanel')); })());
    await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelectorAll('[id*="esign"].open, .design-sw-overlay').forEach(e => e.remove()));
    await p.click('#hdrMenuBtn'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    ok(L + 'Esc で閉じる', !(await vis('#hdrMenuPanel')));
    if (loggedIn) {
      ok(L + 'アバターのアイコンが見え、名前の文字は外に出ない', await vis('#hdrAcctBtn') && await vis('#hdrCloudAvatar') && !(await vis('#hdrCloudName')));
      ok(L + 'ログアウト・チーム管理はパネルの中', await p.evaluate(() => !!document.querySelector('#hdrAcctPanel #hdrCloudLogout') && !!document.querySelector('#hdrAcctPanel #hdrUserMgrBtn')));
      await p.click('#hdrAcctBtn'); await p.waitForTimeout(150);
      ok(L + 'アバターを押すと名前・チーム管理・ログアウト', await vis('#hdrAcctPanel') && await vis('#hdrCloudName') && await vis('#hdrCloudLogout') && (await p.textContent('#hdrCloudName')).includes('青木'));
      ok(L + '管理者にはチーム管理が出る', await vis('#hdrUserMgrBtn'));
      ok(L + '☰ を押すとアカウントは閉じる（同時に 1 つ）', await (async () => { await p.click('#hdrMenuBtn'); await p.waitForTimeout(100); return !(await vis('#hdrAcctPanel')) && await vis('#hdrMenuPanel'); })());
      await p.mouse.click(10, 500); await p.waitForTimeout(100);
      ok(L + '外側クリックで閉じる', !(await vis('#hdrMenuPanel')));
      if (process.env.OUT) { await p.click('#hdrAcctBtn'); await p.waitForTimeout(150); await p.screenshot({ path: path.join(process.env.OUT, 'hdr-acct-' + (th || 'industry') + '.png'), clip: { x: 0, y: 0, width: +(process.env.W || 1300), height: 360 } }); }
    } else ok(L + 'Google ログインのボタンは従来どおり', await vis('#hdrCloudLogin'));
    ok(L + '横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
