// 🆔 進行管理：基幹 ID（＝サイバーポートの取引番号）で見積・進行・サイバーポートをつなぐ（ops-progress.js）
//   ID の保存・重複の拒否・往復の 2 つの欄・サイバーポートで確認→追いかけの登録・取引番号での自動チェック・一覧の検索、を確かめる。
//   node scripts/design-tests/ops-id-test.js   （CLASSIC=1 で現行／W=390 でスマホ幅）
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
  const W = parseInt(process.env.W || '1400', 10);

  async function open(opts) {
    opts = opts || {};
    const ctx = await b.newContext({ viewport: { width: W, height: 1000 }, locale: 'ja-JP' });
    if (opts.nowatch) await ctx.addInitScript(() => { window.__nowatch = 1; });
    if (process.env.CLASSIC) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: false, doc: false })); } catch (e) {} });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('fwd.uiMode', 'detail');  } catch (e) {}
      const iso = d => { const t = new Date(); t.setDate(t.getDate() + d); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
      const mk = (id, ct, status, follower, extra) => Object.assign({
        id, name: '案件' + id, status, customer: 'X社', created_by: 'tanaka@x.com', owner_email: 'tanaka@x.com',
        updated_at: '2026-11-' + ct + 'T00:00:00Z', ref: 'R-' + id,
        data: { fields: Object.assign({ 'qf-ref': 'R-' + id, 'qf-status': status }, follower ? { 'qf-follower': follower } : {}), rows: [] },
      }, extra || {});
      const fresh = new Date().toISOString();
      const db = {
        quote_presets: [
          mk('B1', '10', '受注', '', { name: '輸出FCL案件' }),
          mk('B2', '11', '受注', '', { name: '輸入AIR案件' }),
          mk('B3', '12', '下書き中', '', { name: '下書き案件' }),
          mk('B4', '13', '受注', '', { name: '編集中の受注', locked_by: 'tanaka@x.com', locked_at: fresh }),
        ],
        allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }, { email: 'tanaka@x.com', role: 'member', member_no: 2 }, { email: 'suzuki@x.com', role: 'member', member_no: 3 }],
        user_profiles: [{ email: 'me@x.com', display_name: '自分' }, { email: 'tanaka@x.com', display_name: '田中' }, { email: 'suzuki@x.com', display_name: '鈴木' }],
        quote_comments: [], quote_preset_links: [], master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [],
      };
      Object.assign(db.quote_presets[0].data.fields, { 'cond-direction': 'export', 'cond-mode': '海上（FCL）' });
      Object.assign(db.quote_presets[1].data.fields, { 'cond-direction': 'import', 'cond-mode': '航空（AIR）' });

      const V = (k, val) => ({ k, scope: 's', label: 'l', val, cat: 'date' });
      const ex = (id, name, f, extra2) => { const r = mk(id, '14', '受注', '', Object.assign({ name }, extra2 || {})); Object.assign(r.data.fields, f); db.quote_presets.push(r); };
      ex('B5', '輸入FCL案件', { 'cond-direction': 'import', 'cond-mode': '海上（FCL）' });
      ex('B6', '往復案件', { 'cond-direction': 'export_import', 'cond-mode': '海上（FCL）' });
      ex('B7', 'スポットの見積', { 'cond-direction': 'export', 'cond-mode': '海上（FCL）' });
      ex('B8', '編集中の輸出', { 'cond-direction': 'export', 'cond-mode': '海上（FCL）' }, { locked_by: 'tanaka@x.com', locked_at: new Date().toISOString() });
      db.cp_watch_targets = [
        { preset_id: 'B1', source: 'case', direction: 'export', trace: true, snapshot: [V('v:A|1:pol:etd', '2026-11-20 10:00'), V('v:A|1:pol:atd', '2026-11-20 14:05'), V('v:A|1:pod:ata', null)] },
        { preset_id: 'B5', source: 'case', direction: 'import', trace: true, snapshot: [V('v:B|2:pol:atd', '2026-11-01 09:00'), V('v:B|2:pod:ata', '2026-11-10 06:30'), V('c:AAAU1234567:retAct', '2026-11-15 10:00'), V('c:BBBU7654321:retAct', null)] },
        { preset_id: 'B6', source: 'case', direction: 'import', trace: true, snapshot: [V('v:C|3:pol:atd', '2026-11-02 09:00'), V('v:C|3:pod:ata', '2026-11-12 08:00'), V('v:C|3:tr0pod:ata', '2026-11-13 08:00')] },
        { preset_id: 'B7', source: 'case', direction: 'export', trace: true, snapshot: [V('v:D|4:pol:atd', '2026-11-18 20:00')] },
        { preset_id: 'B8', source: 'case', direction: 'export', trace: true, snapshot: [V('v:E|5:pol:atd', '2026-11-18 20:00')] },
        { preset_id: 'T1', source: 'trade', direction: 'export', trace: true, snapshot: [V('v:F|6:pol:atd', '2026-11-18 20:00')] },
      ];
      db.ops_jobs = [{ id: 'J1', kind: 'spot', title: 'スポット輸出', customer: 'Y社', status: 'active', preset_id: 'B7', updated_at: '2026-11-15T00:00:00Z', data: { dir: 'export', mode: '海上（FCL）', charges: [], ships: [] } }];
      ex('B9', 'ID輸出案件', { 'cond-direction': 'export', 'cond-mode': '海上（FCL）' });
      db.ops_jobs.push({ id: 'J2', kind: 'spot', title: 'ID付きスポット', customer: 'Z社', status: 'active', preset_id: null, updated_at: '2026-11-16T00:00:00Z', data: { dir: 'export', mode: '海上（FCL）', coreId: 'JOBX1', charges: [], ships: [] } });
      db.cp_watch_targets.push({ preset_id: 'TJ2', source: 'trade', trade_no: 'JOBX1', direction: 'export', trace: true, state: 'active', snapshot: [V('v:G|7:pol:atd', '2026-11-19 09:15')] });
      if (window.__nowatch) { delete db.cp_watch_targets; }
      window.__iso = iso;
      window.__db = db; window.__writes = [];
      const isLocked = r => r.locked_by && r.locked_by !== 'me@x.com' && (Date.now() - new Date(r.locked_at).getTime()) < 90000;
      const qb = t => {
        const st = { op: 'select', filters: [], payload: null };
        const api = {
          select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, is() { return api; }, ilike() { return api; },
          gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, or() { return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; },
          in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          upsert(o) { st.op = 'insert'; st.payload = o; return api; }, insert(o) { st.op = 'insert'; st.payload = o; return api; },
          update(o) { st.op = 'update'; st.payload = o; return api; }, delete() { st.op = 'delete'; return api; },
          single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
          then(res, rej) {
            if (t === 'cp_watch_targets' && !db[t]) return Promise.resolve({ data: null, error: { code: 'PGRST205', message: 'Could not find the table cp_watch_targets' } }).then(res, rej);
            const rows = (db[t] = db[t] || []);
            let data = null;
            if (st.op === 'insert') {
              const made = [].concat(st.payload).map(o => Object.assign({ id: 'id' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, JSON.parse(JSON.stringify(o))));
              made.forEach(r => rows.push(r)); data = st.single ? made[0] : made;
              window.__writes.push({ t, op: 'insert', payload: JSON.parse(JSON.stringify(st.payload)) });
            } else if (st.op === 'delete') { db[t] = rows.filter(r => !st.filters.every(f => f(r))); }
            else if (st.op === 'update') {
              const hit = rows.filter(r => st.filters.every(f => f(r)) && !(t === 'quote_presets' && isLocked(r)));   // 編集ロック中は RLS で 0 行
              hit.forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.payload))));
              data = t === 'ops_jobs' ? hit.map(r => JSON.parse(JSON.stringify(r))) : hit.map(r => ({ id: r.id }));
              window.__writes.push({ t, op: 'update', n: hit.length });
            } else {
              data = rows.filter(r => st.filters.every(f => f(r))).map(r => JSON.parse(JSON.stringify(r)));
              if (st.single) data = data[0] || null;
            }
            return Promise.resolve({ data, error: null }).then(res, rej);
          },
        };
        return api;
      };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() { return Promise.resolve(); }, presenceState() { return {}; } };
      const user = { email: 'me@x.com', user_metadata: { full_name: '自分' } };
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
    await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(1500);
    return { ctx, p, errs };
  }

  const chip = (p, nm) => p.evaluate(nm => {
    const c = [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(c => c.querySelector('.cloud-card-links') && c.querySelector('.cloud-card-links').dataset.lid === nm);
    const e = c && c.querySelector('.ops-chip'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
  }, nm);
  const ops = (p, id) => p.evaluate(id => { const r = window.__db.quote_presets.find(x => x.id === id); const v = r && r.data.fields['qf-ops']; return v ? JSON.parse(v) : null; }, id);
  const steps = p => p.evaluate(() => [...document.querySelectorAll('#opmModal .opm-step')].map(li => ({ l: li.querySelector('.opm-step-l') ? li.querySelector('.opm-step-l').textContent : '', d: li.classList.contains('is-done'), next: li.classList.contains('is-next'), by: (li.querySelector('.opm-done-by') || {}).textContent || '' })));
  const click = (p, sel) => p.evaluate(sel => { const e = document.querySelector(sel); e && e.click(); return !!e; }, sel);



  const { ctx, p, errs } = await open();
  await p.evaluate(() => {   // サイバーポートの問い合わせを差し替える
    window.__cpCalls = [];
    window.CyberPort = Object.assign({}, window.CyberPort, {
      tradesSearch: async q => { window.__cpCalls.push(['search', q]); return { data: q.keyword === 'ABC123' ? [{ tradeNo: 'ABC123', tradeName: '輸出の取引', tradeType: 'Export', tradeStatus: '進行中', blNo: '' }] : [] }; },
      get: async path => { window.__cpCalls.push(['get', path]); return { data: [{ container: { containerNo: 'MSCU1234567' } }] }; },
    });
  });
  await p.evaluate(() => window.opsAutoSync()); await p.waitForTimeout(1200);
  // ---- スポットの進行：基幹 ID（取引番号）の追跡で自動チェック ----
  const j2 = await p.evaluate(() => window.__db.ops_jobs.find(j => j.id === 'J2').data.st);
  const j2d = j2 && j2.s.find(x => /本船出港/.test(x.l));
  ok('見積とつながらないスポットの進行も、基幹 ID の追跡で自動チェック', !!j2d && j2d.d && /09:15/.test(j2d.src), j2d);
  // ---- 見積の案件：ID を入れる ----
  await p.evaluate(() => window.opsOpen('B9')); await p.waitForTimeout(500);
  const sec = await p.evaluate(() => { const s = document.querySelector('#opmModal .oid-sec'); return s ? { n: s.querySelectorAll('.oid-in').length, t: s.textContent } : null; });
  ok('チェックリストに「🆔 基幹 ID・サイバーポート」の欄（片道は 1 つ）', !!sec && sec.n === 1, sec);
  const setId = (sel, v) => p.evaluate(([sel, v]) => { const i = document.querySelector(sel); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
  await setId('#opmModal .oid-in[data-oid-n="1"]', ' abc123 '); await p.waitForTimeout(800);
  const f9 = await p.evaluate(() => window.__db.quote_presets.find(r => r.id === 'B9').data.fields['qf-core-ref']);
  ok('ID は空白を除いて大文字で保存（qf-core-ref）', f9 === 'ABC123', f9);
  const st9 = await p.evaluate(() => (document.querySelector('#opmModal .oid-st') || {}).textContent || '');
  ok('まだ追いかけていない ID には「サイバーポート未登録」', /未登録/.test(st9), st9);
  // 重複
  await click(p, '#opmModal [data-opm="close"]'); await p.waitForTimeout(200);
  await p.evaluate(() => window.opsOpen('B5')); await p.waitForTimeout(400);
  await setId('#opmModal .oid-in[data-oid-n="1"]', 'ABC123'); await p.waitForTimeout(600);
  const f5 = await p.evaluate(() => window.__db.quote_presets.find(r => r.id === 'B5').data.fields['qf-core-ref'] || '');
  ok('ほかの案件と同じ ID は保存しない', f5 === '', f5);
  await click(p, '#opmModal [data-opm="close"]'); await p.waitForTimeout(200);
  // 往復は 2 つ
  await p.evaluate(() => window.opsOpen('B6')); await p.waitForTimeout(400);
  const legs = await p.evaluate(() => [...document.querySelectorAll('#opmModal .oid-l')].map(x => x.textContent));
  ok('往復の案件は往路（輸出）・復路（輸入）の 2 つの欄', legs.length === 2 && /往路輸出/.test(legs[0]) && /復路輸入/.test(legs[1]), legs);
  await setId('#opmModal .oid-in[data-oid-n="2"]', 'RET777'); await p.waitForTimeout(600);
  const f6 = await p.evaluate(() => window.__db.quote_presets.find(r => r.id === 'B6').data.fields);
  ok('復路の ID は qf-core-ref2 に保存', f6['qf-core-ref2'] === 'RET777' && !f6['qf-core-ref'], f6['qf-core-ref2']);
  await click(p, '#opmModal [data-opm="close"]'); await p.waitForTimeout(200);
  // ---- サイバーポートで確認 → 追いかける ----
  await p.evaluate(() => window.opsOpen('B9')); await p.waitForTimeout(400);
  await click(p, '#opmModal [data-oid="check"]'); await p.waitForTimeout(800);
  const pane = await p.evaluate(() => { const x = document.querySelector('#opmModal .oid-pane'); return x ? { t: x.textContent, dir: (x.querySelector('[data-k="dir"]') || {}).value, ctn: (x.querySelector('[data-k="ctn"]') || {}).value } : null; });
  ok('取引が見つかり、取引名・向き（輸出）・コンテナ番号が入る', !!pane && /輸出の取引/.test(pane.t) && pane.dir === 'export' && pane.ctn === 'MSCU1234567', pane);
  await click(p, '#opmModal [data-oid="watch"]'); await p.waitForTimeout(900);
  const w = await p.evaluate(() => window.__db.cp_watch_targets.find(t => t.trade_no === 'ABC123'));
  ok('追いかけの名簿に取引として入る（source=trade・取引番号・コンテナ）', !!w && w.source === 'trade' && w.direction === 'export' && w.container_nos[0] === 'MSCU1234567' && w.trace === true, w);
  const st9b = await p.evaluate(() => (document.querySelector('#opmModal .oid-st') || {}).textContent || '');
  ok('登録後は「🛰 追跡中」', /追跡中/.test(st9b), st9b);
  ok('「サイバーポートで追跡中」の案内が出る', await p.evaluate(() => !!document.querySelector('#opmModal .opm-auto')));
  await click(p, '#opmModal [data-opm="close"]'); await p.waitForTimeout(200);
  // 自動確認の結果が入ったら、取引番号で結び付けてチェック
  await p.evaluate(() => { window.__db.cp_watch_targets.find(t => t.trade_no === 'ABC123').snapshot = [{ k: 'v:H|8:pol:atd', val: '2026-11-20 07:40', cat: 'date' }]; });
  await p.evaluate(() => window.opsAutoSync()); await p.waitForTimeout(1200);
  const o9 = await ops(p, 'B9'), d9 = o9 && o9.s.find(x => /本船出港/.test(x.l));
  ok('取引番号の追跡の実績で、案件の「本船出港」に自動チェック', !!d9 && d9.d && /07:40/.test(d9.src), d9);
  // 見つからない番号
  await p.evaluate(() => window.opsOpen('B5')); await p.waitForTimeout(400);
  await setId('#opmModal .oid-in[data-oid-n="1"]', 'NOPE99'); await p.waitForTimeout(700);
  await click(p, '#opmModal [data-oid="check"]'); await p.waitForTimeout(600);
  const err = await p.evaluate(() => (document.querySelector('#opmModal .oid-pane.is-err') || {}).textContent || '');
  ok('見つからない番号は案内を出す', /見つかりませんでした/.test(err), err);
  await click(p, '#opmModal [data-opm="close"]'); await p.waitForTimeout(200);
  // ---- 進行の画面の ID 欄 ----
  await p.evaluate(() => window.opsOpenJob('J2')); await p.waitForTimeout(500);
  const jsec = await p.evaluate(() => { const s = document.querySelector('#ojModal .oid-sec'); return s ? { v: s.querySelector('.oid-in').value, st: (s.querySelector('.oid-st') || {}).textContent } : null; });
  ok('進行の画面にも ID の欄（JOBX1・追跡中）', !!jsec && jsec.v === 'JOBX1' && /追跡中/.test(jsec.st), jsec);
  await p.evaluate(() => { const b = document.querySelector('#ojModal [data-oj="close"]'); b && b.click(); });
  // ---- 一覧の検索 ----
  await p.evaluate(() => window.opsGoTab('all')); await p.waitForTimeout(800);
  await p.evaluate(() => { const i = document.getElementById('optQ'); i.value = 'abc123'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(300);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#opsRoot .opt-row')].map(r => r.textContent.replace(/\s+/g, ' ')));
  ok('進行管理の一覧は基幹 ID で探せる・🆔 が出る', rows.length === 1 && /ID輸出案件/.test(rows[0]) && /🆔 ABC123/.test(rows[0]), rows);
  ok('ページのエラーなし', errs.length === 0, errs);
  await ctx.close();
  {
    const r = await open({ nowatch: true });
    await r.p.evaluate(() => window.opsAutoSync()); await r.p.waitForTimeout(600);
    await r.p.evaluate(() => window.opsOpen('B9')); await r.p.waitForTimeout(500);
    const t = await r.p.evaluate(() => (document.querySelector('#opmModal .oid-sec') || {}).textContent || '');
    ok('名簿の表が無いときは案内を出す（壊れない）', /cp-watch\.sql/.test(t), t.slice(0, 120));
    ok('（表なし）ページのエラーなし', r.errs.length === 0, r.errs);
    await r.ctx.close();
  }
  await b.close(); srv.close();
  console.log(fails ? 'FAIL=' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
