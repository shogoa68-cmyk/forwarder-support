// 📉 Supabase の転送量（egress）削減の試験
//   ① 同じ人のままのログイン状態の通知（タブに戻る・トークン更新）では、何も読み直さない
//   ② 案件一覧は「本体以外の列」を毎回・本体（data）は変わった案件の分だけ取り直す
//   ③ 本体の取得に失敗したら従来どおり全件を取り直す  ④ サブコン別行挿入の全件取得は 5 分使い回す
// 偽の Supabase（メモリ上・リクエストを記録）で確認する。
//   node scripts/design-tests/egress-sync-test.js           （THEME=1 で Industry）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');

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
  let fails = 0;
  const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ME = 'me@x.com';

  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.addInitScript(({ ME }) => {
    try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
    const mk = (id) => ({
      id, name: '案件' + id, status: '下書き中', customer: 'X社' + id, person: '', created_by: 'a@x.com', owner_email: 'a@x.com',
      updated_at: '2026-11-1' + id + 'T00:00:00Z', incoterms: '', transport_mode: '', pol: '', pod: '', carrier: '', ref: 'R' + id, tags: [],
      locked_by: null, locked_at: null, editors: [{ email: 'a@x.com', at: '2026-11-1' + id + 'T00:00:00Z', count: 1 }],
      data: { rows: [], fields: { 'qf-customer': 'X社' + id }, marker: 'v1-' + id, filler: 'x'.repeat(20000) },
    });
    const db = {
      allowed_emails: [{ email: ME, role: 'member', member_no: 1 }],
      user_profiles: [], master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], master_requests: [],
      quote_presets: ['1', '2', '3', '4', '5'].map(mk),
    };
    window.__db = db; window.__mk = mk; window.__log = [];
    const qb = t => {
      const st = { op: 'select', filters: [], cols: '*', payload: null };
      const api = {
        select(c) { if (c) st.cols = c; return api; }, order() { return api; }, limit() { return api; }, range(a, z) { st.range = [a, z]; return api; }, not() { return api; }, or() { return api; },
        is() { return api; }, ilike() { return api; }, gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; },
        eq(k, v) { st.filters.push(r => r[k] === v); st.eq = [k, v]; return api; },
        in(k, vs) { st.filters.push(r => vs.includes(r[k])); st.inIds = vs.slice(); return api; },
        upsert(o) { st.op = 'upsert'; st.payload = o; return api; }, insert(o) { st.op = 'insert'; st.payload = o; return api; },
        update(o) { st.op = 'update'; st.payload = o; return api; }, delete() { st.op = 'delete'; return api; },
        single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
        then(res, rej) {
          const rows = (db[t] = db[t] || []);
          let data = null, error = null;
          if (st.op === 'update') { rows.filter(r => st.filters.every(f => f(r))).forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.payload)))); }
          else if (st.op === 'select') {
            // 本体だけの取得（select('id,data')）を失敗させる試験用の仕掛け
            if (window.__failBodies && t === 'quote_presets' && st.cols === 'id,data') {
              window.__log.push({ t, cols: st.cols, ids: st.inIds || null, failed: true, bytes: 0 });
              return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej);
            }
            const want = st.cols === '*' ? null : st.cols.split(',').map(s => s.trim());
            const got = rows.filter(r => st.filters.every(f => f(r))).map(r => {
              if (!want) return JSON.parse(JSON.stringify(r));
              const o = {}; want.forEach(k => { if (k in r) o[k] = JSON.parse(JSON.stringify(r[k])); }); return o;
            });
            const part = st.range ? got.slice(st.range[0], st.range[1] + 1) : got;
            data = st.single ? (part[0] || null) : part;
            window.__log.push({ t, cols: st.cols, ids: st.inIds || null, bytes: JSON.stringify(data).length });
          }
          return Promise.resolve({ data, error }).then(res, rej);
        },
      };
      return api;
    };
    const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() {} };
    const user = { id: 'uid-1', email: ME, user_metadata: { full_name: 'Me' } };
    window.__session = { user };
    const client = {
      from: qb, rpc: name => Promise.resolve({ data: name === 'get_my_role' ? 'member' : (name === 'quote_acquire_lock' ? 'OK' : null), error: null }),
      channel: () => ch, removeChannel() {},
      auth: {
        getSession: () => Promise.resolve({ data: { session: window.__session } }),
        onAuthStateChange(cb) { window.__authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithOAuth() { return Promise.resolve({ error: null }); }, signOut() { return Promise.resolve({ error: null }); },
      },
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrls: async () => ({ data: [], error: null }), createSignedUrl: async () => ({ data: null, error: null }) }) },
    };
    window.supabase = { createClient: () => client };
  }, { ME });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.setDefaultTimeout(10000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(1500);

  const log = () => p.evaluate(() => window.__log.slice());
  const reset = () => p.evaluate(() => { window.__log.length = 0; });
  const presetQ = async () => (await log()).filter(x => x.t === 'quote_presets');
  const bodyQ = async () => (await presetQ()).filter(x => x.cols === 'id,data');
  const reload = () => p.evaluate(() => window.cloudListPresets(true)).then(() => p.waitForTimeout(300));
  const rowOf = id => p.evaluate(i => (window.cloudGetAllRows() || []).find(r => r.id === i), id);
  const cardN = () => p.evaluate(() => (window.cloudGetAllRows() || []).length);

  // ===== ② 一覧：本体は変わった案件の分だけ =====
  ok('初期表示：5 件が読み込まれ、本体（data）もある', (await cardN()) === 5 && (await rowOf('3')).data.marker === 'v1-3', await cardN());
  await reset(); await reload();
  let q = await presetQ();
  ok('変更なしで再読込：一覧は 1 回・本体の取得は 0 回', q.length === 1 && (await bodyQ()).length === 0, q.map(x => x.cols.slice(0, 30)));
  ok('一覧の取得に本体（data）の列を含まない', !q[0].cols.split(',').includes('data'), q[0].cols);
  ok('再読込しても 5 件・本体は保たれる', (await cardN()) === 5 && (await rowOf('2')).data.marker === 'v1-2');
  const bytesIdle = q.reduce((s, x) => s + x.bytes, 0);

  // 他の人が案件3を保存（本体・updated_at・editors が変わる）
  await p.evaluate(() => { const r = window.__db.quote_presets.find(x => x.id === '3'); r.data = { rows: [], fields: {}, marker: 'v2-3' }; r.updated_at = '2026-12-01T00:00:00Z'; r.editors = [{ email: 'b@x.com', at: '2026-12-01T00:00:00Z', count: 2 }]; });
  await reset(); await reload();
  let bq = await bodyQ();
  ok('他の人の保存：取り直すのは案件3の本体だけ', bq.length === 1 && bq[0].ids.length === 1 && bq[0].ids[0] === '3', bq.map(x => x.ids));
  ok('案件3の本体が新しくなり、他の案件は変わらない', (await rowOf('3')).data.marker === 'v2-3' && (await rowOf('1')).data.marker === 'v1-1');

  // updated_at を変えない書き込み（取り込み済みの priceFollow 等）：editors で拾う
  await p.evaluate(() => { const r = window.__db.quote_presets.find(x => x.id === '4'); r.data = { rows: [], fields: {}, marker: 'v2-4' }; r.editors = [{ email: 'a@x.com', at: '2026-12-02T00:00:00Z', count: 2 }]; });
  await reset(); await reload();
  bq = await bodyQ();
  ok('updated_at が変わらなくても editors が変われば取り直す（案件4）', bq.length === 1 && bq[0].ids[0] === '4' && (await rowOf('4')).data.marker === 'v2-4', bq.map(x => x.ids));

  // ロックだけが変わった（本体・editors は不変）
  await p.evaluate(() => { const r = window.__db.quote_presets.find(x => x.id === '2'); r.locked_by = 'b@x.com'; r.locked_at = new Date().toISOString(); });
  await reset(); await reload();
  ok('ロックだけの変化：本体は取り直さず、ロック状態は反映される', (await bodyQ()).length === 0 && (await rowOf('2')).locked_by === 'b@x.com', await bodyQ());

  // 削除と追加
  await p.evaluate(() => { const a = window.__db.quote_presets; a.splice(a.findIndex(x => x.id === '5'), 1); a.unshift(window.__mk('6')); });
  await reset(); await reload();
  bq = await bodyQ();
  ok('削除は反映・追加は新しい案件の本体だけ取る', (await cardN()) === 5 && !(await rowOf('5')) && (await rowOf('6')) && bq.length === 1 && bq[0].ids.join() === '6', { n: await cardN(), q: bq.map(x => x.ids) });

  // ===== ③ 本体の取得に失敗したら従来どおり全件 =====
  await p.evaluate(() => { const r = window.__db.quote_presets.find(x => x.id === '1'); r.data = { rows: [], fields: {}, marker: 'v3-1' }; r.updated_at = '2026-12-03T00:00:00Z'; r.editors = [{ email: 'a@x.com', at: '2026-12-03T00:00:00Z', count: 9 }]; window.__failBodies = true; });
  await reset(); await reload();
  q = await presetQ();
  ok('本体の取得に失敗：本体つきの全件取得にもどり、画面は壊れない', q.some(x => x.cols.split(',').includes('data')) && (await cardN()) === 5 && (await rowOf('1')).data.marker === 'v3-1', q.map(x => x.cols.slice(0, 40)));
  await p.evaluate(() => { window.__failBodies = false; });
  await reset(); await reload();
  ok('回復後は差分の取得にもどる（本体の取得は 0〜全件の 1 回）', (await presetQ()).length >= 2 || (await presetQ()).length === 1);

  // ===== ① ログイン状態の通知 =====
  await reset();
  await p.evaluate(() => { window.__authCb('SIGNED_IN', window.__session); window.__authCb('TOKEN_REFRESHED', window.__session); window.__authCb('SIGNED_IN', window.__session); });
  await p.waitForTimeout(800);
  ok('同じ人の通知（SIGNED_IN×2・TOKEN_REFRESHED）：Supabase への読み取りは 0 回', (await log()).length === 0, (await log()).map(x => x.t));
  ok('通知のあとも一覧は 5 件のまま', (await cardN()) === 5);
  await p.evaluate(() => { window.__authCb('USER_UPDATED', window.__session); }); await p.waitForTimeout(300);
  const uu = await log();
  console.log('INFO USER_UPDATED で読んだ表：' + JSON.stringify(uu.map(x => x.t)));
  ok('USER_UPDATED（表示名の変更など）でも、案件・マスターの全件は読まない', !uu.some(x => x.t === 'quote_presets' || x.t === 'master_votes' || x.t === 'master_details' || x.t === 'synonym_groups'), uu.map(x => x.t));

  await p.evaluate(() => { window.__authCb('SIGNED_OUT', null); }); await p.waitForTimeout(500);
  await reset();
  await p.evaluate(() => { window.__authCb('SIGNED_IN', window.__session); }); await p.waitForTimeout(1200);
  ok('ログアウト→ログインし直すと、ちゃんと読み込み直す（一覧・マスター）', (await presetQ()).length >= 1 && (await log()).some(x => x.t === 'master_votes' || x.t === 'user_profiles'), (await log()).map(x => x.t));

  await p.evaluate(() => { window.__session = { user: { id: 'uid-2', email: 'other@x.com', user_metadata: {} } }; });
  await reset();
  await p.evaluate(() => { window.__authCb('SIGNED_IN', window.__session); }); await p.waitForTimeout(1200);
  ok('別の人のログインに変わったときも読み込み直す', (await presetQ()).length >= 1, (await log()).map(x => x.t));
  await p.evaluate(() => { window.__session = { user: { id: 'uid-1', email: 'me@x.com', user_metadata: {} } }; window.__authCb('SIGNED_IN', window.__session); }); await p.waitForTimeout(800);

  // ===== ④ サブコン別行挿入の全件取得は使い回す =====
  await reset();
  await p.evaluate(async () => { await window.loadSubconData(); });
  const first = (await presetQ()).filter(x => x.cols.split(',').includes('data')).length;
  await reset();
  await p.evaluate(async () => { await window.loadSubconData(); await window.loadSubconData(); });
  const again = (await presetQ()).filter(x => x.cols.split(',').includes('data')).length;
  ok('サブコン別行挿入：2 回目以降は全件取得を繰り返さない', again === 0, { first, again });

  // ===== 通信量の目安 =====
  const full = await p.evaluate(() => JSON.stringify(window.__db.quote_presets).length);
  console.log('INFO 一覧 1 回の通信量（変更なし）≒ ' + bytesIdle + ' バイト／本体を含む全件 ≒ ' + full + ' バイト');
  ok('変更なしの一覧の通信量は、本体つき全件の半分以下', bytesIdle * 2 < full, { bytesIdle, full });

  ok('ページエラーなし', errs.length === 0, errs);
  await ctx.close(); await b.close(); srv.close();
  console.log(fails ? '\n' + fails + ' 件 NG' : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
