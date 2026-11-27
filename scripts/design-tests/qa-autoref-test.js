// 2026-11 の不具合の再発防止：「アプリを開いて何もしていないのに、案件を開こうとすると『保存していない変更があります』が出る」。
//   原因：ログインのあと発番 ID が届くと、空の新規画面に見積もり番号を自動で入れ（maybeAutoFillRef）、その input を「ユーザーの変更」と数えていた。
//   ①何もしていなければ、自動採番のあとでも未保存にならず、案件を開いても確認は出ない
//   ②自分で入力したあとは、自動採番が来ても未保存のまま（確認が出る）
//   node scripts/design-tests/qa-autoref-test.js        （THEME=1 で Industry／EDITOR=v2 で新画面）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { try { return require('playwright-core'); } catch (e2) { return require('playwright'); } } })();
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
async function start(opts = {}) {
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ME = 'me@x.com';
  async function newCtx(o = {}) {
    const ctx = await b.newContext({ viewport: o.viewport || { width: 1400, height: 900 }, locale: 'ja-JP' });
    await ctx.addInitScript(({ ME, seed }) => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      if (seed && seed.__theme) {}
      window.__delay = 0; window.__log = [];
      const db = window.__db = { quote_presets: seed || [] };
      let idn = 100;
      const qb = t => {
        const st = { op: 'select', filters: [], payload: null, single: false };
        const api = {
          select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, or() { return api; }, is() { return api; }, ilike() { return api; },
          gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, filter() { return api; }, lt() { return api; }, gt() { return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; }, in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          update(o) { st.op = 'update'; st.payload = o; return api; }, insert(o) { st.op = 'insert'; st.payload = o; return api; }, delete() { st.op = 'delete'; return api; }, upsert(o) { st.op='upsert'; st.payload=o; return api; },
          single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
          then(res, rej) {
            const run = () => {
              const rows = (db[t] = db[t] || []);
              let data = null;
              window.__log.push(t + ':' + st.op);
              if (st.op === 'update') { data = rows.filter(r => st.filters.every(f => f(r))); data.forEach(r => { Object.assign(r, JSON.parse(JSON.stringify(st.payload))); r.updated_at = new Date().toISOString(); }); }
              else if (st.op === 'delete') { db[t] = rows.filter(r => !st.filters.every(f => f(r))); data = []; }
              else if (st.op === 'insert' || st.op === 'upsert') { const arr = Array.isArray(st.payload) ? st.payload : [st.payload]; data = arr.map(p => { const r = Object.assign({ id: 'n' + (idn++), updated_at: new Date().toISOString() }, JSON.parse(JSON.stringify(p))); rows.push(r); return r; }); if (st.single) data = data[0]; }
              else { data = rows.filter(r => st.filters.every(f => f(r))); if (st.single) data = data[0] || null; }
              return { data, error: null };
            };
            const d = (t === 'quote_presets' && st.op !== 'select') ? window.__delay : 0;
            return new Promise(r => setTimeout(() => r(run()), d)).then(res, rej);
          },
        };
        return api;
      };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() { return Promise.resolve(); }, presenceState() { return {}; } };
      const user = { id: 'u1', email: ME, user_metadata: { full_name: 'Me' } };
      const client = {
        from: qb, channel: () => ch, removeChannel() {},
        rpc: (name) => Promise.resolve({ data: name === 'get_my_member_no' ? (window.__memberNo ?? 5) : name === 'get_my_role' ? 'admin' : name === 'quote_acquire_lock' ? 'OK' : name === 'quote_renew_lock' ? true : null, error: null }),
        auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } },
        storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrls: async () => ({ data: [], error: null }), list: async()=>({data:[],error:null}) }) },
      };
      window.supabase = { createClient: () => client };
    }, { ME, seed: o.seed });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    return ctx;
  }
  async function openPage(ctx, q = '') {
    const p = await ctx.newPage();
    p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
    p.on('dialog', d => { p.__dialogs = (p.__dialogs || []); p.__dialogs.push(d.message()); d.accept(); });
    p.setDefaultTimeout(10000);
    await p.goto(URL + q, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
    await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
    return p;
  }
  return { b, srv, newCtx, openPage, URL, close: async () => { await b.close(); srv.close(); } };
}

// 2026-11 の QA で見つかった「古い日付のまま出力できる」「外貨の行に課税の印」の再発防止（偽の Supabase・外部接続なし）。
//   ①コピーした案件は、発行日＝今日・有効期限＝今月末・提出期限なし（日付でない有効期限はそのまま）
//   ②出力前の確認ガイドに、過ぎた有効期限・発行日より前の有効期限・30 日より前の発行日・未来の受信日を出す
//   ③外貨で請求する行に「課税」が付いていたら確認ガイドで知らせ、御見積書に「*」を付けない

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
const mk = id => ({ id, name: '案件' + id, status: '受注', created_by: 'me@x.com', owner_email: 'me@x.com', tags: [], editors: [], updated_at: '2026-01-01T00:00:00Z', data: { fields: { 'qf-customer': 'A社', 'qf-ref': 'R-' + id }, rows: [] } });
(async () => {
  const H = await start();
  for (const typed of [false, true]) {
    const ctx = await H.newCtx({ seed: [mk('c1')] });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    // 発番 ID が届くのを遅らせる（自分で入力したあとに自動採番が来る場合を作る）
    await ctx.addInitScript(typed => { window.__memberNo = typed ? null : 5; }, typed);
    const p = await H.openPage(ctx, process.env.EDITOR === 'v2' ? '?editor=v2' : '');
    if (typed) {
      await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(500);
      await p.fill('#qf-customer', '入力した会社'); await p.waitForTimeout(200);
      await p.evaluate(() => { window.__memberNo = 5; window._myMemberNo = 5; window.maybeAutoFillRef(); });
      await p.evaluate(() => window.qpShowDashboard ? window.qpShowDashboard() : null).catch(() => {});
    }
    await p.waitForTimeout(1200);
    const ref = await p.evaluate(() => document.getElementById('qf-ref').value);
    if (!typed) ok('①（前提）ログインのあと見積もり番号が自動で入った', !!ref, ref);
    const dirty = await p.evaluate(() => window.quoteIsDirty());
    p.evaluate(() => { window.cloudLoadPreset('c1'); }); await p.waitForTimeout(1200);
    const dlg = await p.evaluate(() => !!document.querySelector('#qpLeaveConfirm.open'));
    if (!typed) {
      ok('① 何もしていなければ未保存にならない', dirty === false, dirty);
      ok('① 案件を開いても「保存していない変更があります」を出さない', dlg === false);
      ok('① そのまま案件が開く', await p.evaluate(() => document.getElementById('qf-ref').value === 'R-c1'));
    } else {
      ok('② 自分で入力したあとは、自動採番が来ても未保存のまま', dirty === true, dirty);
      ok('② 案件を開こうとすると確認が出る', dlg === true);
    }
    ok('ページエラーなし（' + (typed ? '②' : '①') + '）', p.__errs.length === 0, p.__errs);
    await ctx.close();
  }
  await H.close();
  console.log(fails ? fails + ' 件 FAIL' : '全項目 PASS');
  process.exit(fails ? 1 : 0);
})();
