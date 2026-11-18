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
    ok(L + 'ヘッダーに並んだままのリンクはない／☰ にはデザインだけ（ご意見の 3 つは「❓ 困ったとき」へ移った）', await p.evaluate(() => !document.querySelector('.header > a.hdr-roadmap') && document.querySelectorAll('#hdrMenuPanel a.hdr-roadmap:not(#hdrEditorV2Btn)').length === 1 && !!document.querySelector('#hdrMenuPanel #hdrDesignBtn') && !document.querySelector('#hdrMenuPanel #hdrBugReportsBtn, #hdrMenuPanel #hdrIdeasBtn')));
    ok(L + '☰ の見出しは「表示」「画面の切替」（「ご意見」は無い）／title は「表示・画面の切替」', await p.evaluate(() => { const t = [...document.querySelectorAll('#hdrMenuPanel .hdr-panel-label')].map(e => e.textContent.trim()); return t.includes('表示') && t.includes('画面の切替') && !t.some(x => /ご意見/.test(x)) && document.getElementById('hdrMenuBtn').title === '表示・画面の切替'; }));
    ok(L + '「ご意見」の 3 つは「❓ 困ったとき」のカードの中（id・onclick そのまま）', await p.evaluate(() => ['hdrBugReportsBtn', 'hdrIdeasBtn'].every(id => { const a = document.getElementById(id); return a && a.closest('#fbHelpCard') && /switchCategory\('bugreports'\)/.test(a.getAttribute('onclick') || ''); }) && !!document.querySelector('#fbHelpCard a.hdr-roadmap[href="roadmap.html"]')));
    ok(L + 'パネルは閉じている', !(await vis('#hdrMenuPanel')));
    await p.click('#hdrMenuBtn'); await p.waitForTimeout(150);
    ok(L + '☰ を押すと 2 つの項目（デザイン・画面の切替）が出る', await vis('#hdrMenuPanel') && await p.$$eval('#hdrMenuPanel a.hdr-roadmap', els => els.length === 2 && els.every(e => e.getBoundingClientRect().height >= 40)));
    if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'hdr-menu-' + (th || 'industry') + (loggedIn ? '-in' : '-out') + '.png'), clip: { x: 0, y: 0, width: +(process.env.W || 1300), height: 360 } });
    ok(L + 'デザインが開ける', await (async () => { await p.click('#hdrDesignBtn'); await p.waitForTimeout(400); return !(await vis('#hdrMenuPanel')); })());
    await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelectorAll('[id*="esign"].open, .design-sw-overlay').forEach(e => e.remove()));
    await p.click('#hdrMenuBtn'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    ok(L + 'Esc で閉じる', !(await vis('#hdrMenuPanel')));
    if (loggedIn) {
      ok(L + 'アカウントは［アバター 名前 ▾］の 1 つの形（名前はボタンに見える）', await vis('#hdrAcctBtn') && await vis('#hdrCloudAvatar') && await vis('#hdrAcctBtn #hdrCloudName') && await vis('#hdrAcctBtn .hdr-acct-caret') && (await p.textContent('#hdrAcctBtn')).includes('青木'));
      ok(L + '名前が長くても「…」で省略され、ボタンがヘッダーからはみ出さない', await p.evaluate(() => { const n = document.getElementById('hdrCloudName'); n.textContent = '長い名前の人ですよろしくお願いいたします山田太郎'; const b = document.getElementById('hdrAcctBtn').getBoundingClientRect(); return getComputedStyle(n).textOverflow === 'ellipsis' && b.right <= innerWidth && b.height >= 40; }));
      ok(L + 'ログアウト・チーム管理はパネルの中', await p.evaluate(() => !!document.querySelector('#hdrAcctPanel #hdrCloudLogout') && !!document.querySelector('#hdrAcctPanel #hdrUserMgrBtn')));
      await p.click('#hdrAcctBtn'); await p.waitForTimeout(150);
      ok(L + '▾ を押すとプロフィール・チーム管理・ログアウト', await vis('#hdrAcctPanel') && await vis('#hdrAcctPanel .hdr-acct-who') && await vis('#hdrCloudLogout') && /プロフィール/.test(await p.textContent('#hdrAcctPanel .hdr-acct-who')));
      ok(L + '管理者にはチーム管理が出る', await vis('#hdrUserMgrBtn'));
      ok(L + '☰ を押すとアカウントは閉じる（同時に 1 つ）', await (async () => { await p.click('#hdrMenuBtn'); await p.waitForTimeout(100); return !(await vis('#hdrAcctPanel')) && await vis('#hdrMenuPanel'); })());
      await p.mouse.click(10, 500); await p.waitForTimeout(100);
      ok(L + '外側クリックで閉じる', !(await vis('#hdrMenuPanel')));
      if (process.env.OUT) { await p.click('#hdrAcctBtn'); await p.waitForTimeout(150); await p.screenshot({ path: path.join(process.env.OUT, 'hdr-acct-' + (th || 'industry') + '.png'), clip: { x: 0, y: 0, width: +(process.env.W || 1300), height: 360 } }); }
    } else ok(L + 'ログインのボタンが見える（文言は「ログイン」・押す動作は従来どおり）', await vis('#hdrCloudLogin') && /ログイン/.test(await p.textContent('#hdrCloudLogin')) && /cloudLogin\(\)/.test(await p.getAttribute('#hdrCloudLogin', 'onclick')));
    ok(L + '横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
