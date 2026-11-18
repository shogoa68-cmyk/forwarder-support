// ブックマークの URL：http/https 以外（javascript: など）をリンクにしない・保存させないこと。
//   node scripts/design-tests/bookmark-url-test.js
// 1) SharedFmt.httpUrl（共通の検証関数）の入出力  2) 画面に出るリンク（ブックマークのピル・見積タブ右のチップ）に、
//    危険な href が出ないこと（過去に保存された危険な URL が DB に残っていても、リンクにしない）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path'), vm = require('vm');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x)));

const root = path.resolve(__dirname, '..', '..');

// ---------- 1) 検証関数そのもの ----------
(function unit() {
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'フォワーダー支援/shared/format.js'), 'utf8'), ctx);
  const f = ctx.window.SharedFmt.httpUrl;
  const same = (t, exp, label) => { const g = f(t); ok(`httpUrl ${label || JSON.stringify(t)} → ${JSON.stringify(exp)}`, g === exp, g); };
  // 通すもの
  same('https://example.com/a?b=c#d', 'https://example.com/a?b=c#d');
  same('HTTP://EXAMPLE.COM', 'HTTP://EXAMPLE.COM');
  same('  https://example.com/  ', 'https://example.com/', '（前後の空白は取る）');
  same('example.com', 'https://example.com', '（スキーム無しは https:// を補う）');
  same('www.example.co.jp/path?x=1', 'https://www.example.co.jp/path?x=1');
  same('example.com:8080/x', 'https://example.com:8080/x', '（ポート付き）');
  same('https://example.com/日本語/パス', 'https://example.com/日本語/パス', '（日本語を含む）');
  same("https://example.com/it's", "https://example.com/it's", '（アポストロフィ）');
  // 止めるもの
  for (const t of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)',
    'java\u0000script:alert(1)', '\u0001javascript:alert(1)', 'javascript&colon;alert(1)', 'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD4=', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'blob:https://x/1',
    'mailto:a@b.com', 'tel:0312345678', 'ftp://example.com/x', '//evil.example.com/x', '\\\\evil.example.com\\x',
    'https://', 'http://', 'https:', 'http:///x', 'https://:80/', 'https://exa mple.com', 'https://example.com/ x',
    'https://example.com/" onmouseover="alert(1)', 'https://example.com/<script>', 'https://example.com/`x`',
    'https://example.com\\@evil.example.com', 'https://good.example.com@evil.example.com/', 'java.script:alert(1)',
    'alert(1)', '<img src=x onerror=alert(1)>', 'localhost', 'abc', '', '   ', null, undefined,
    'https://example.com/' + 'a'.repeat(2100),
  ]) same(t, '');
})();

// ---------- 2) 画面 ----------
(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);

  const BAD = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.example.com', 'https://a.com/" onmouseover="alert(1)'];
  const GOOD = 'https://example.com/ok';

  // 2-1) ブックマーク一覧のピル（bookmarks.js _bmPillHtml）
  const pill = await p.evaluate(({ BAD, GOOD }) => {
    const mk = (u, i) => _bmPillHtml({ id: 'id' + i, label: 'L' + i, url: u, carrier: 'ONE', carrier_type: 'carrier', function: 'レート', note: '' }, null, false);
    const wrap = document.createElement('div');
    wrap.innerHTML = BAD.map(mk).join('') + mk(GOOD, 99) + mk('example.com/x', 98);
    // 危険な URL 1 件ずつを単独で描き、リンク（href）も、URL に仕込まれたイベント属性（onmouseover 等）も作られないことを見る
    const alone = BAD.map(u => { const w = document.createElement('div'); w.innerHTML = mk(u, 0);
      return { href: w.querySelectorAll('[href]').length, injected: [...w.querySelectorAll('*')].some(e => e.hasAttribute('onmouseover') || /javascript:/i.test(e.outerHTML.replace(/&[a-z#0-9]+;/gi, ''))), nourl: w.querySelectorAll('.bm-pill-nourl').length }; });
    return {
      hrefs: [...wrap.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
      bad: alone.some(a => a.href || a.injected),
      nourl: wrap.querySelectorAll('.bm-pill-nourl').length,
    };
  }, { BAD, GOOD });
  ok('一覧のピル：危険な URL は 1 つもリンクにならない', pill.hrefs.every(h => /^https?:\/\//i.test(h)), pill.hrefs);
  ok('一覧のピル：安全な URL とスキーム無しの URL（https を補う）は、リンクになる', pill.hrefs.includes(GOOD) && pill.hrefs.includes('https://example.com/x'), pill.hrefs);
  ok('一覧のピル：危険な URL の行は「URLなし」の見た目（クリックできない）で残る', pill.nourl === BAD.length, pill);
  ok('一覧のピル：危険な URL から、on〜（イベント）属性が作られない', !pill.bad, pill);

  // 2-2) 見積タブ右のチップ（ui.js renderQuoteBookmarkRail）。クラウドのキャッシュに危険な URL が残っていても、リンクにしない
  const rail = await p.evaluate(({ BAD, GOOD }) => {
    document.getElementById('z2Carrier').value = 'TESTCARRIER';
    window._qspBmCache = { TESTCARRIER: [...BAD.map((u, i) => ({ id: 'r' + i, label: 'BAD' + i, url: u, carrier: 'TESTCARRIER', note: '', type: 'carrier', fn: 'レート' })),
      { id: 'rg', label: 'GOOD', url: GOOD, carrier: 'TESTCARRIER', note: '', type: 'carrier', fn: 'レート' }] };
    window.renderQuoteBookmarkRail();
    const w = document.getElementById('bmRailChips');
    return { html: w ? w.innerHTML.length : -1,
      hrefs: w ? [...w.querySelectorAll('a[href]')].map(a => a.getAttribute('href')) : [],
      chips: w ? w.querySelectorAll('.qsp-ms-cl-chip').length : 0 };
  }, { BAD, GOOD });
  ok('見積タブのチップ：描画された（試験の前提）', rail.chips >= BAD.length + 1, rail);
  ok('見積タブのチップ：危険な URL は 1 つもリンクにならない', rail.hrefs.every(h => /^https?:\/\//i.test(h)), rail.hrefs);
  ok('見積タブのチップ：安全な URL はリンクのまま', rail.hrefs.includes(GOOD), rail.hrefs);

  // 2-3) 保存の入口：危険な URL は保存を止める（フォームに入れて saveBm を呼ぶ）
  const save = await p.evaluate(async ({ BAD, GOOD }) => {
    const calls = []; const toasts = [];
    const fake = { auth: { getSession: async () => ({ data: { session: { user: { email: 'tester@example.com', id: 'u1' } } } }) }, from: () => { const c = { select: () => c, eq: () => c, limit: () => c, insert: (r) => { calls.push(['insert', r]); return Promise.resolve({ error: null }); }, update: (r) => { calls.push(['update', r]); return c; }, then: (res) => res({ data: [], error: null }) }; return c; } };
    window.SupabaseClient = fake;
    window.quoteShowToast = (m) => toasts.push(m);
    const set = (id, v) => { let el = document.getElementById(id); if (!el) { el = document.createElement('input'); el.id = id; document.body.appendChild(el); } el.value = v; };
    set('bmFormId', ''); set('bmFormLabel', 'テスト'); set('bmFormType', 'general'); set('bmFormCarrier', 'ONE'); set('bmFormFunction', 'レート'); set('bmFormNote', '');
    const out = {};
    for (const u of BAD) { calls.length = 0; toasts.length = 0; set('bmFormUrl', u); await saveBm(); out[u] = { inserted: calls.some(c => c[0] === 'insert'), toast: toasts.length }; }
    calls.length = 0; set('bmFormUrl', 'example.com/x'); await saveBm();
    const ins = calls.find(c => c[0] === 'insert');
    return { out, goodInserted: !!ins, goodUrl: ins && ins[1].url };
  }, { BAD, GOOD });
  ok('保存：危険な URL は 1 件も保存されず、案内が出る', Object.values(save.out).every(v => !v.inserted && v.toast >= 1), save.out);
  ok('保存：スキーム無しの URL は https:// を補って保存される', save.goodInserted && save.goodUrl === 'https://example.com/x', save);

  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
})();
