// 📦 進行管理：見積とつながらない進行（スポット／レギュラー・表 ops_jobs）
//   作る・料金の控え・チェックリスト・便・次を完了・種類の絞り込み・見積への紐付け／見積を作って紐付け・完了・削除・SQL 未実行のとき を確かめる。
//   node scripts/design-tests/ops-jobs-test.js   （CLASSIC=1 で現行／W=390 でスマホ幅）
//   node scripts/design-tests/ops-jobs-test.js   （CLASSIC=1 で現行／W=390 でスマホ幅）
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
    if (process.env.CLASSIC) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: false, doc: false })); } catch (e) {} });
    if (opts.noJobs) await ctx.addInitScript(() => { window.__noJobs = true; });
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
            const rows = (db[t] = db[t] || []);
            let data = null;
            if (st.op === 'insert') {
              const made = [].concat(st.payload).map(o => Object.assign({ id: 'id' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, JSON.parse(JSON.stringify(o))));
              made.forEach(r => rows.push(r)); data = st.single ? made[0] : made;
              window.__writes.push({ t, op: 'insert', payload: JSON.parse(JSON.stringify(st.payload)) });
            } else if (t === 'ops_jobs' && window.__noJobs) {
              return Promise.resolve({ data: null, error: { code: '42P01', message: 'relation "public.ops_jobs" does not exist' } }).then(res, rej);
            } else if (st.op === 'delete') { data = rows.filter(r => st.filters.every(f => f(r))).map(r => ({ id: r.id })); db[t] = rows.filter(r => !st.filters.every(f => f(r))); }
            else if (st.op === 'update') {
              const hit = rows.filter(r => st.filters.every(f => f(r)) && !(t === 'quote_presets' && isLocked(r)));   // 編集ロック中は RLS で 0 行
              hit.forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.payload))));
              data = hit.map(r => JSON.parse(JSON.stringify(r)));
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

  const J = p => p.evaluate(() => JSON.parse(JSON.stringify(window.__db.ops_jobs || [])));
  const dom = (p, fn, a) => p.evaluate(fn, a);
  const clickSel = (p, sel) => p.evaluate(sel => { const e = document.querySelector(sel); if (e) e.click(); return !!e; }, sel);
  const setVal = (p, sel, v) => p.evaluate(([sel, v]) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
  const rowOf = (p, txt) => p.evaluate(txt => { const r = [...document.querySelectorAll('#opsRoot .opt-row')].find(x => x.textContent.includes(txt)); return r ? r.textContent.replace(/\s+/g, ' ') : null; }, txt);
  const goTab = async p => { await p.evaluate(() => document.querySelector('.cat-btn[aria-controls="tab-ops"]').click()); await p.waitForTimeout(500); };

  {
    const { ctx, p, errs } = await open();
    await goTab(p);
    ok('［＋ 進行を作る］がある', await dom(p, () => !!document.querySelector('#opsRoot [data-opt="new"]')));
    // ---- スポットを作る ----
    await clickSel(p, '#opsRoot [data-opt="new"]'); await p.waitForTimeout(200);
    await clickSel(p, '#ojNew [data-ojn="ok"]'); await p.waitForTimeout(200);
    ok('名前が空なら作らない', (await J(p)).length === 0 && await dom(p, () => document.getElementById('ojNewTitle').classList.contains('is-err')));
    await p.fill('#ojNewTitle', 'X社 スポット輸出');
    await p.fill('#ojNewCust', 'X社');
    await p.selectOption('#ojNewDir', 'export'); await p.selectOption('#ojNewMode', '海上（FCL）');
    await clickSel(p, '#ojNew [data-ojn="ok"]'); await p.waitForTimeout(700);
    let jobs = await J(p), spot = jobs.find(j => j.title === 'X社 スポット輸出');
    ok('スポットが表に入る（種類・お客様・向き・モード）', !!spot && spot.kind === 'spot' && spot.customer === 'X社' && spot.data.dir === 'export' && spot.data.mode === '海上（FCL）', spot);
    ok('輸出 FCL のひな形（8 作業）が付く', !!spot && spot.data.st && spot.data.st.s.length === 8, spot && spot.data.st);
    ok('作ると進行の画面が開く', await dom(p, () => !document.getElementById('ojModal').hidden && document.getElementById('ojTitle').textContent.includes('スポット')));
    // ---- 料金の控え ----
    await clickSel(p, '#ojModal [data-oj="cadd"]'); await p.waitForTimeout(500);
    await setVal(p, '#ojModal [data-oj-c="0"][data-k="name"]', 'OCEAN FREIGHT'); await p.waitForTimeout(300);
    await setVal(p, '#ojModal [data-oj-c="0"][data-k="qty"]', '2'); await p.waitForTimeout(300);
    await setVal(p, '#ojModal [data-oj-c="0"][data-k="ccy"]', 'USD'); await p.waitForTimeout(300);
    await setVal(p, '#ojModal [data-oj-c="0"][data-k="price"]', '1200'); await p.waitForTimeout(500);
    spot = (await J(p)).find(j => j.kind === 'spot');
    const c0 = spot.data.charges[0];
    ok('料金の行が保存される（項目・数量・通貨・単価）', c0 && c0.name === 'OCEAN FREIGHT' && c0.qty === 2 && c0.ccy === 'USD' && c0.price === 1200, c0);
    ok('合計が出る（USD 2,400）', (await dom(p, () => (document.querySelector('#ojModal .oj-total') || {}).textContent || '')).includes('USD 2,400'));
    // ---- チェックリスト（進行の画面の上から） ----
    await clickSel(p, '#ojModal [data-oj="steps"]'); await p.waitForTimeout(300);
    ok('チェックリストが進行の画面の上に開く', await dom(p, () => !document.getElementById('opmModal').hidden && !document.getElementById('ojModal').hidden && document.getElementById('opmTitle').textContent.includes('作業の進み具合')));
    await clickSel(p, '#opmModal .opm-chk[data-i="0"]'); await p.waitForTimeout(600);
    spot = (await J(p)).find(j => j.kind === 'spot');
    ok('チェックが進行に保存される（日時・名前）', spot.data.st.s[0].d === true && spot.data.st.s[0].by === 'me@x.com');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok('Esc でチェックリストだけ閉じ、進行の画面は残る', await dom(p, () => document.getElementById('opmModal').hidden && !document.getElementById('ojModal').hidden));
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok('もう一度 Esc で進行の画面も閉じる', await dom(p, () => document.getElementById('ojModal').hidden));
    let r = await rowOf(p, 'X社 スポット輸出');
    ok('タブに ⚡ スポット の行・1/8・請求 USD 2,400', !!r && r.includes('スポット') && r.includes('1/8') && r.includes('USD 2,400'), r);
    await p.evaluate(() => { const row = [...document.querySelectorAll('#opsRoot .opt-row')].find(x => x.textContent.includes('X社 スポット輸出')); row.querySelector('[data-opt="jnext"]').click(); });
    await p.waitForTimeout(700);
    spot = (await J(p)).find(j => j.kind === 'spot');
    ok('タブの「✓ 次を完了」で 2/8', spot.data.st.s.filter(x => x.d).length === 2 && (await rowOf(p, 'X社 スポット輸出')).includes('2/8'));
    // ---- レギュラーを作る・便 ----
    await clickSel(p, '#opsRoot [data-opt="new"]'); await p.waitForTimeout(200);
    await p.check('input[name="ojNewKind"][value="regular"]');
    await p.fill('#ojNewTitle', 'Y社 毎月便'); await p.selectOption('#ojNewDir', 'import'); await p.selectOption('#ojNewMode', '航空（AIR）');
    await clickSel(p, '#ojNew [data-ojn="ok"]'); await p.waitForTimeout(700);
    ok('レギュラーは便が 0 で始まる', await dom(p, () => [...document.querySelectorAll('#ojModal .oj-empty')].some(e => e.textContent.includes('便がありません'))));
    await clickSel(p, '#ojModal [data-oj="shipadd"]'); await p.waitForTimeout(600);
    await clickSel(p, '#ojModal [data-oj="shipadd"]'); await p.waitForTimeout(600);
    let reg = (await J(p)).find(j => j.kind === 'regular');
    ok('便を 2 つ足せる（輸入 AIR のひな形 6 作業つき）', reg.data.ships.length === 2 && reg.data.ships.every(s => s.st.s.length === 6), reg.data.ships.map(s => s.st.s.length));
    const shipId = reg.data.ships[0].id;
    await setVal(p, '#ojModal [data-oj-s="' + shipId + '"][data-k="label"]', '11月 第1便'); await p.waitForTimeout(400);
    await p.evaluate(id => { const c = document.querySelector('#ojModal [data-oj-s="' + id + '"][data-k="billed"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }, shipId); await p.waitForTimeout(400);
    reg = (await J(p)).find(j => j.kind === 'regular');
    const s0 = reg.data.ships.find(s => s.id === shipId);
    ok('便の名前・請求済みが保存される', s0.label === '11月 第1便' && s0.billed === true, s0);
    await clickSel(p, '#ojModal [data-oj="steps"][data-ship="' + shipId + '"]'); await p.waitForTimeout(300);
    ok('便のチェックリストの見出しに便の名前', (await dom(p, () => document.getElementById('opmSub').textContent)).includes('11月 第1便'));
    await clickSel(p, '#opmModal .opm-chk[data-i="0"]'); await p.waitForTimeout(600);
    reg = (await J(p)).find(j => j.kind === 'regular');
    ok('便のチェックが便に保存される', reg.data.ships.find(s => s.id === shipId).st.s[0].d === true && reg.data.ships.find(s => s.id !== shipId).st.s[0].d === false);
    await clickSel(p, '#opmModal [data-opm="close"]'); await clickSel(p, '#ojModal [data-oj="close"]'); await p.waitForTimeout(300);
    r = await rowOf(p, 'Y社 毎月便');
    ok('タブに 🔁 レギュラー の行・便 2', !!r && r.includes('レギュラー') && r.includes('便 2'), r);
    await p.evaluate(() => { const row = [...document.querySelectorAll('#opsRoot .opt-row')].find(x => x.textContent.includes('Y社 毎月便')); row.querySelector('[data-opt="ship"]').click(); });
    await p.waitForTimeout(700);
    ok('タブの［＋ 便］で便が増える', (await J(p)).find(j => j.kind === 'regular').data.ships.length === 3);
    // ---- 種類の絞り込み ----
    await clickSel(p, '#opsRoot [data-opt="src"][data-src="spot"]'); await p.waitForTimeout(200);
    let rows = await dom(p, () => [...document.querySelectorAll('#opsRoot .opt-row')].map(x => x.dataset.src));
    ok('「⚡ スポット」で絞り込める', rows.length === 1 && rows[0] === 'spot', rows);
    await clickSel(p, '#opsRoot [data-opt="src"][data-src="quote"]'); await p.waitForTimeout(200);
    rows = await dom(p, () => [...document.querySelectorAll('#opsRoot .opt-row')].map(x => x.dataset.src));
    ok('「💼 見積から」は受注の見積だけ（3 件）', rows.length === 3 && rows.every(x => x === 'quote'), rows);
    await clickSel(p, '#opsRoot [data-opt="src"][data-src=""]'); await p.waitForTimeout(200);
    // ---- 既存の見積に紐づける ----
    await p.evaluate(() => { const row = [...document.querySelectorAll('#opsRoot .opt-row')].find(x => x.textContent.includes('Y社 毎月便')); row.querySelector('[data-opt="job"]').click(); }); await p.waitForTimeout(300);
    await p.evaluate(() => { document.querySelector('#ojModal .oj-link-pick').open = true; });
    await setVal(p, '#ojLinkQ', 'R-B2'); await p.waitForTimeout(200);
    await clickSel(p, '#ojLinkList [data-oj="linkq"]'); await p.waitForTimeout(600);
    reg = (await J(p)).find(j => j.kind === 'regular');
    ok('既存の見積に紐づけられる', reg.preset_id === 'B2', reg.preset_id);
    await clickSel(p, '#ojModal [data-oj="close"]'); await p.waitForTimeout(300);
    r = await rowOf(p, 'Y社 毎月便');
    ok('紐づけた進行に 💼 R-B2 の印', !!r && r.includes('R-B2'), r);
    rows = await dom(p, () => [...document.querySelectorAll('#opsRoot .opt-row[data-src="quote"]')].map(x => x.textContent));
    ok('紐づけた見積は「見積から」の行に重ねて出さない', !rows.some(t => t.includes('R-B2')), rows);
    // ---- 進行から見積を作る → 保存で自動の紐付け ----
    await p.evaluate(() => { const row = [...document.querySelectorAll('#opsRoot .opt-row')].find(x => x.textContent.includes('X社 スポット輸出')); row.querySelector('[data-opt="job"]').click(); }); await p.waitForTimeout(300);
    await clickSel(p, '#ojModal [data-oj="mkquote"]'); await p.waitForTimeout(1500);
    const ed = await dom(p, () => ({ tab: document.getElementById('tab-quote-make').classList.contains('active'), cust: document.getElementById('qf-customer').value, name: (document.getElementById('qf-case-name') || {}).value, nms: [...document.querySelectorAll('#tableBody tr:not([data-virtual]) [data-field="nm"]')].map(x => x.value), pp: [...document.querySelectorAll('#tableBody tr:not([data-virtual]) [data-field="pp"]')].map(x => x.value) }));
    ok('見積の画面にお客様・名前・料金の行が写る', ed.tab && ed.cust === 'X社' && ed.name === 'X社 スポット輸出' && ed.nms.includes('OCEAN FREIGHT') && ed.pp.includes('1200'), ed);
    const n0 = await dom(p, () => window.__db.quote_presets.length);
    await p.evaluate(() => window.cloudSaveCurrent()); await p.waitForTimeout(1800);
    const newQ = await dom(p, () => window.__db.quote_presets.slice(-1)[0].id);
    spot = (await J(p)).find(j => j.kind === 'spot');
    ok('保存すると見積が作られ、進行と自動で紐づく', (await dom(p, () => window.__db.quote_presets.length)) === n0 + 1 && spot.preset_id === newQ, { pid: spot.preset_id, newQ });
    // ---- 完了・削除 ----
    await goTab(p);
    await p.evaluate(() => { const row = [...document.querySelectorAll('#opsRoot .opt-row')].find(x => x.textContent.includes('X社 スポット輸出')); row.querySelector('[data-opt="job"]').click(); }); await p.waitForTimeout(300);
    await clickSel(p, '#ojModal [data-oj="status"][data-v="done"]'); await p.waitForTimeout(600);
    ok('「完了にする」で status=done', (await J(p)).find(j => j.kind === 'spot').status === 'done');
    await clickSel(p, '#ojModal [data-oj="close"]'); await p.waitForTimeout(300);
    await clickSel(p, '#opsRoot .opt-tile[data-f="done"]'); await p.waitForTimeout(200);
    ok('完了のタイルに出る', !!(await rowOf(p, 'X社 スポット輸出')));
    await p.evaluate(() => { const row = [...document.querySelectorAll('#opsRoot .opt-row')].find(x => x.textContent.includes('X社 スポット輸出')); row.querySelector('[data-opt="job"]').click(); }); await p.waitForTimeout(300);
    await clickSel(p, '#ojModal [data-oj="delete"]'); await p.waitForSelector('.confirm-dialog');
    await p.evaluate(() => { const b = [...document.querySelectorAll('.confirm-dialog button')].find(x => x.textContent.trim() === '削除する'); b.click(); }); await p.waitForTimeout(700);
    ok('削除（確認つき）で表から消える', !(await J(p)).some(j => j.kind === 'spot') && await dom(p, () => document.getElementById('ojModal').hidden));
    ok('紐づけていた見積は消えない', await dom(p, id => window.__db.quote_presets.some(q => q.id === id), newQ));
    // ---- ダッシュボードの帯にも数が入る ----
    await p.evaluate(() => { window.switchCategory('quote', document.querySelector('.cat-btn[aria-controls="tab-quote-make"]')); window.qpShowDashboard(); }); await p.waitForTimeout(1200);
    const band = await dom(p, () => (document.getElementById('opsBand') || {}).textContent || '');
    ok('ダッシュボードの帯の「進行中」にレギュラーも数える（見積 3−紐付け 1＋レギュラー 1＝3）', band.replace(/\s+/g, '').includes('進行中3'), band);
    ok('ページのエラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  // ---- SQL 未実行のとき ----
  {
    const { ctx, p, errs } = await open({ noJobs: true });
    await goTab(p); await p.waitForTimeout(500);
    const s = await dom(p, () => ({ warn: (document.querySelector('#opsRoot .opt-warn') || {}).textContent || '', newBtn: !!document.querySelector('#opsRoot [data-opt="new"]'), rows: document.querySelectorAll('#opsRoot .opt-row').length }));
    ok('SQL 未実行：案内が出て［＋ 進行を作る］は出ない', s.warn.includes('ops-jobs.sql') && !s.newBtn, s);
    ok('SQL 未実行でも見積からの進行は並ぶ', s.rows === 3, s);
    ok('（SQL 未実行）ページのエラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(fails ? 'FAIL=' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
