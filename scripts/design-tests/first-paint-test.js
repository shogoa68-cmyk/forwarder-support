// ページを開いた直後のチラつき（本来出てはいけない画面が一瞬映る）がないこと。
//   node scripts/design-tests/first-paint-test.js
// やり方：JS と テーマ CSS の配信をわざと遅くし、描画の直前（requestAnimationFrame）ごとに画面の状態を記録して調べる。
//   A. ログインしていない人：見積の「入力画面」が、ダッシュボードより先に映らない
//   B. ログイン済みの人：「ログインすると…」の案内が、確認が終わる前に映らない
//   C. テーマの CSS が届く前の「素のデザイン」が映らない（届くまでは何も出さない）
//   D. 回帰：落ち着いたあとは、ダッシュボードが出ている・テーマが効いている・読み込みが遅い／失敗してもページは出る
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x)));

// 描画の直前ごとに「いま画面に出ているもの」を記録する（ページの最初から）
const SAMPLER = () => {
  window.__frames = [];
  const vis = el => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
  (function loop() {
    const b = document.body;
    if (b) {
      const tab = document.getElementById('tab-quote-make');
      const ws = document.querySelector('#tab-quote-make > .quote-workspace');
      const login = document.getElementById('qpdLogin');
      const main = document.getElementById('qpdMain');
      const site = document.querySelector('link[data-theme-css="site"]');
      const h = document.documentElement;
      window.__frames.push({
        t: Math.round(performance.now()),
        bodyShown: getComputedStyle(b).visibility !== 'hidden',
        editor: vis(ws) && !!tab && tab.classList.contains('active'),
        dash: vis(document.getElementById('qpDashboard')),
        login: vis(login), main: vis(main),
        themeWanted: h.classList.contains('theme-industry'),
        themeLoaded: !!(site && site.sheet && site.media === 'all'),
      });
    }
    requestAnimationFrame(loop);
  })();
};

// 偽の Supabase：何を呼んでも空の結果を返す。getSession だけ、ログイン済みを少し遅れて返す
const FAKE_SB = ({ delay, user }) => {
  const chain = () => new Proxy(function () {}, {
    get: (_, k) => k === 'then' ? (res) => res({ data: [], error: null, count: 0 }) : chain(),
    apply: () => chain(),
  });
  window.supabase = {
    createClient: () => ({
      auth: {
        getSession: () => new Promise(r => setTimeout(() => r({ data: { session: user ? { user } : null } }), delay)),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({}), signInWithOAuth: async () => ({}), getUser: async () => ({ data: { user } }),
      },
      from: () => chain(), rpc: () => chain(), channel: () => chain(), removeChannel: () => {},
      storage: { from: () => chain() },
    }),
  };
};

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

  async function open({ user, theme, jsDelay = 350, cssDelay = 500, cssFail = false, sbDelay = 700 }) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ja-JP' });
    if (theme) await ctx.addInitScript(t => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify(t)); } catch (e) {} }, theme);
    await ctx.addInitScript(SAMPLER);
    await ctx.addInitScript(FAKE_SB, { delay: sbDelay, user: user || null });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    await ctx.route(/\/js\/.*\.js|\/shared\/.*\.js|\/data\/.*\.js/, async r => { await new Promise(x => setTimeout(x, jsDelay)); r.continue(); });
    await ctx.route(/css\/theme-.*\.css|css\/design-tokens-quiet\.css/, async r => {
      await new Promise(x => setTimeout(x, cssDelay));
      if (cssFail) r.abort(); else r.continue();
    });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL, { waitUntil: 'commit' });
    await p.waitForTimeout(3600);
    const frames = await p.evaluate(() => window.__frames);
    const settled = await p.evaluate(() => ({
      dash: document.body.classList.contains('qp-dash-active'),
      dashVisible: getComputedStyle(document.getElementById('qpDashboard')).display !== 'none',
      editorHidden: getComputedStyle(document.querySelector('#tab-quote-make > .quote-workspace')).display === 'none',
      login: !document.getElementById('qpdLogin').hidden, main: !document.getElementById('qpdMain').hidden,
      themeClass: document.documentElement.classList.contains('theme-industry'),
      waiting: document.documentElement.classList.contains('theme-wait'),
      bodyVisible: getComputedStyle(document.body).visibility !== 'hidden',
    }));
    await ctx.close();
    return { frames, settled, errs };
  }
  const shown = fr => fr.filter(f => f.bodyShown);

  // A. ログインなし
  const A = await open({ user: null });
  const aEditor = shown(A.frames).filter(f => f.editor);
  ok('A. ログインなし：見積の入力画面が一瞬も映らない', aEditor.length === 0, { 映ったコマ数: aEditor.length, 最初: aEditor[0] });
  ok('A. ログインなし：落ち着くとダッシュボード＋ログイン案内', A.settled.dashVisible && A.settled.editorHidden && A.settled.login && !A.settled.main, A.settled);

  // B. ログイン済み（確認に 0.7 秒かかる）
  const B = await open({ user: { email: 's@example.com', id: 'u1' } });
  const bLogin = shown(B.frames).filter(f => f.login);
  ok('B. ログイン済み：確認が終わる前に「ログインすると…」が映らない', bLogin.length === 0, { 映ったコマ数: bLogin.length, 最初: bLogin[0] });
  ok('B. ログイン済み：入力画面も映らない', shown(B.frames).filter(f => f.editor).length === 0, null);
  ok('B. ログイン済み：落ち着くと一覧側（main）が出る', B.settled.main && !B.settled.login && B.settled.dashVisible, B.settled);

  // C. テーマ CSS が遅れて届く（既定の Industry）
  const C = await open({ user: null, theme: { site: true, doc: true } });
  const cRaw = shown(C.frames).filter(f => f.themeWanted && !f.themeLoaded);
  ok('C. テーマの CSS が届く前の「素のデザイン」が映らない', cRaw.length === 0, { 映ったコマ数: cRaw.length });
  ok('C. 落ち着くとテーマが効き、待機は解除されている', C.settled.themeClass && !C.settled.waiting && C.settled.bodyVisible, C.settled);

  // D. テーマ CSS の読み込みに失敗しても、ページは出る（真っ白のままにしない）
  const D = await open({ user: null, theme: { site: true, doc: true }, cssFail: true });
  ok('D. テーマ CSS が失敗しても、ページは表示される', D.settled.bodyVisible && !D.settled.waiting && D.settled.dashVisible, D.settled);
  // クラシック（テーマなし）は待たない
  const E = await open({ user: null, theme: { site: false, doc: false } });
  ok('D. テーマなし（クラシック）は待たずに最初から表示', shown(E.frames).length > 0 && E.frames.filter(f => !f.bodyShown).length === 0, { 隠れたコマ: E.frames.filter(f => !f.bodyShown).length });
  // CSS がいつまでも届かない（応答なし）場合も、2.5 秒で必ず表示する
  const F = await open({ user: null, theme: { site: true, doc: true }, cssDelay: 30000 });
  const fHidden = F.frames.filter(f => !f.bodyShown);
  ok('D. テーマ CSS が届かなくても 2.5 秒で表示される（それまでは何も出さない）', F.settled.bodyVisible && !F.settled.waiting && fHidden.length > 0 && fHidden[fHidden.length - 1].t < 3200, { 隠れたコマ: fHidden.length, 最後: fHidden[fHidden.length - 1] });
  ok('D. JS エラーなし', [A, B, C, D, E, F].every(x => x.errs.length === 0), [A, B, C, D, E, F].map(x => x.errs));

  await b.close(); srv.close();
})();
