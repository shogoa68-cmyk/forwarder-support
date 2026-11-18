// 🚢 類似案件のプレビューから、航路（キャリア・サービス・POL・経由・POD・ICD・T/T・使用不可）を選んで現在の見積へ追加する。
//   偽の Supabase（メモリ上）で、チェック・追加・重複の除外・使用不可の引き継ぎ・単一入力欄だけの古い案件・編集中の自分自身では出さない、を確かめる。
//   node scripts/design-tests/route-copy-test.js           （THEME=1 で Industry）
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

  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
    const routes = [
      { carrier: 'INTERASIA', pol: 'NAGOYA', via: 'PORT KLANG', pod: 'NHAVA SHEVA', tt: '26', enabled: true, rid: 'a1' },
      { carrier: 'WAN HAI LINES', service: 'JTH', pol: 'NAGOYA', pod: 'NHAVA SHEVA', icd: 'ICD Tughlakabad', tt: '25', enabled: true, rid: 'a2', leg: 'out' },
      { carrier: 'TS LINES', pol: 'NAGOYA', pod: 'NHAVA SHEVA', tt: '28', enabled: false, rid: 'a3' },
      { carrier: 'INTERASIA', pol: 'NAGOYA', pod: 'PIPAVAV', enabled: false, ng: true, ngReason: 'サービスなし', rid: 'a4' },
    ];
    const mk = (id, fields) => ({ id, name: '案件' + id, status: '下書き中', customer: 'X社', created_by: 'me@x.com', owner_email: 'me@x.com', updated_at: '2026-11-10T00:00:00Z', ref: 'R-' + id, data: { fields, rows: [] } });
    const db = {
      quote_presets: [
        mk('SRC', { 'cond-incoterms': 'CFR', 'cond-mode': '海上（FCL）', 'cond-direction': 'export', 'z2-routes-data': JSON.stringify(routes) }),
        mk('OLD', { 'z2Pol': 'TOKYO', 'z2Pod': 'MUMBAI', 'z2Carrier': 'ONE', 'z2Service': 'EX1', 'z2Tt': '20' }),
        mk('CUR', { 'z2-routes-data': JSON.stringify([routes[0]]) }),
      ],
      quote_preset_links: [], allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }], user_profiles: [], quote_comments: [],
      master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [],
    };
    window.__db = db;
    const qb = t => {
      const st = { filters: [] };
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, is() { return api; }, ilike() { return api; },
        gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, or() { return api; },
        eq(k, v) { st.filters.push(r => r[k] === v); return api; }, in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
        insert() { return api; }, upsert() { return api; }, update() { return api; }, delete() { return api; },
        single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
        then(res, rej) {
          let data = (db[t] || []).filter(r => st.filters.every(f => f(r))).map(r => Object.assign({}, r));
          if (st.single) data = data[0] || null;
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return api;
    };
    const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() {} };
    const user = { email: 'me@x.com', user_metadata: { full_name: 'Me' } };
    const client = {
      from: qb, rpc: name => Promise.resolve({ data: name === 'get_my_role' ? 'admin' : (name === 'quote_acquire_lock' ? 'OK' : null), error: null }), channel: () => ch, removeChannel() {},
      auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } },
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrls: async () => ({ data: [], error: null }) }) },
    };
    window.supabase = { createClient: () => client };
  });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.setDefaultTimeout(10000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);

  const pick = () => p.evaluate(() => [...document.querySelectorAll('#cpCondInfo .cp-route-chk')].map(c => ({ on: c.checked, txt: c.closest('.cp-kv').textContent.trim() })));
  const chips = () => p.evaluate(() => [...document.querySelectorAll('#z2RouteList .z2-route-chip')].map(c => ({
    carrier: c.querySelector('.z2-route-carrier')?.textContent, leg: c.querySelector('.z2-route-leg')?.textContent,
    ng: c.classList.contains('z2-route-chip--ng'), off: c.classList.contains('z2-route-chip--off'), icd: !!c.querySelector('.z2-route-icd'),
  })));

  // 1) 類似案件のプレビュー（いまの見積は空）
  await p.evaluate(() => window.cloudPreviewPreset('SRC')); await p.waitForTimeout(800);
  let pk = await pick();
  ok('航路 3 本にチェック欄（有効 2 本はチェック済み・使用不可は未チェック。無効の航路は従来どおり出さない）', pk.length === 3 && pk.slice(0, 2).every(x => x.on) && !pk[2].on, pk);
  ok('使用不可の行に理由が出る', /サービスなし/.test(pk[2].txt), pk[2]);
  ok('ICD が航路の行に出る', /ICD: ICD Tughlakabad/.test(pk[1].txt), pk[1]);
  ok('ボタンと件数（2 / 3 本選択中）', await p.evaluate(() => !!document.getElementById('cpRouteCopyBtn') && document.getElementById('cpRouteCount').textContent.includes('2 / 3')), null);

  // 2) 2 本目だけ追加
  await p.evaluate(() => { document.querySelectorAll('#cpCondInfo .cp-route-chk').forEach((c, i) => { c.checked = i === 1; }); window.cpUpdateRouteCount(); });
  ok('件数が 1 / 3 に変わる', await p.evaluate(() => document.getElementById('cpRouteCount').textContent.includes('1 / 3')), null);
  await p.evaluate(() => window.cpCopyRoutes()); await p.waitForTimeout(500);
  let ch = await chips();
  ok('選んだ 1 本だけ追加（WAN HAI・ICD つき・往復の leg は引き継がない）', ch.length === 1 && ch[0].carrier === 'WAN HAI LINES' && ch[0].icd, ch);
  ok('追加後にモーダルが閉じる', await p.evaluate(() => document.getElementById('cloudPreviewModal').style.display === 'none'), null);
  const saved = await p.evaluate(() => JSON.parse(document.getElementById('z2-routes-data').value));
  ok('保存用データに追加され、leg は空・service と T/T を保持', saved.length === 1 && saved[0].leg === '' && saved[0].service === 'JTH' && saved[0].tt === '25' && saved[0].rid && saved[0].rid !== 'a2', saved);

  // 3) もう一度全部：同じ航路は重ねない・使用不可は理由ごと引き継ぐ
  await p.evaluate(() => window.cloudPreviewPreset('SRC')); await p.waitForTimeout(800);
  await p.evaluate(() => { document.querySelectorAll('#cpCondInfo .cp-route-chk').forEach(c => { c.checked = true; }); window.cpUpdateRouteCount(); });
  await p.evaluate(() => window.cpCopyRoutes()); await p.waitForTimeout(500);
  ch = await chips();
  ok('重複（WAN HAI）は追加されず、残り 2 本が増えて計 3 本', ch.length === 3 && ch.filter(c => c.carrier === 'WAN HAI LINES').length === 1, ch);
  ok('使用不可の航路は使用不可のまま追加される', ch.some(c => c.ng), ch);
  const saved2 = await p.evaluate(() => JSON.parse(document.getElementById('z2-routes-data').value));
  ok('使用不可の理由を引き継ぐ', saved2.some(r => r.ng && r.ngReason === 'サービスなし' && r.enabled === false), saved2);
  ok('rid はすべて別々', new Set(saved2.map(r => r.rid)).size === saved2.length, saved2.map(r => r.rid));

  // 4) すべて追加済みのとき
  await p.evaluate(() => window.cloudPreviewPreset('SRC')); await p.waitForTimeout(800);
  await p.evaluate(() => { document.querySelectorAll('#cpCondInfo .cp-route-chk').forEach(c => { c.checked = true; }); });
  await p.evaluate(() => window.cpCopyRoutes()); await p.waitForTimeout(300);
  ok('全部追加済みなら増えない', (await chips()).length === 3, await chips());

  // 5) 何もチェックしない
  await p.evaluate(() => window.cloudPreviewPreset('SRC')); await p.waitForTimeout(800);
  await p.evaluate(() => { document.querySelectorAll('#cpCondInfo .cp-route-chk').forEach(c => { c.checked = false; }); window.cpUpdateRouteCount(); });
  ok('0 本選択ならボタンは押せない', await p.evaluate(() => document.getElementById('cpRouteCopyBtn').disabled), null);
  await p.evaluate(() => window.closeCloudPreview()); await p.waitForTimeout(200);

  // 6) 複数航路の記録が無い古い案件（単一の入力欄）
  await p.evaluate(() => window.cloudPreviewPreset('OLD')); await p.waitForTimeout(800);
  pk = await pick();
  ok('古い案件：単一の入力欄から 1 本の航路をチェックして追加できる', pk.length === 1 && pk[0].on, pk);
  if (pk.length === 1) {
    await p.evaluate(() => window.cpCopyRoutes()); await p.waitForTimeout(400);
    ch = await chips();
    ok('古い案件の POL/POD/キャリアを 1 本の航路として追加', ch.some(c => c.carrier === 'ONE' && /TOKYO/.test(c.leg) && /MUMBAI/.test(c.leg)), ch);
  } else {
    ok('古い案件でもキャリア等の欄から 1 本として出せる', false, pk);
  }

  // 7) 編集中の自分自身のプレビューでは出さない
  await p.evaluate(() => window.cloudLoadPreset('CUR')); await p.waitForTimeout(1200);
  await p.evaluate(() => window.cloudPreviewPreset('CUR')); await p.waitForTimeout(800);
  ok('編集中の案件自身のプレビューには航路のチェック・ボタンを出さない', await p.evaluate(() => !document.querySelector('#cpCondInfo .cp-route-chk') && !document.getElementById('cpRouteCopyBtn')), null);
  ok('それでも航路の表示は従来どおり', await p.evaluate(() => /INTERASIA/.test(document.getElementById('cpCondInfo').textContent)), null);
  await p.evaluate(() => window.closeCloudPreview());

  ok('JS エラーなし', errs.length === 0, errs);
  console.log(fails ? `\n${fails} 件失敗` : '\n全項目 PASS');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
