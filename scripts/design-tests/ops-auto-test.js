// 🛰 進行管理：サイバーポートの自動確認（COLINS の実績）で、出港・入港・空コンテナ返却のチェックを自動で入れる（ops-progress.js）
//   実績の読み取り・往復の向き・人が外したら再び入れない・編集中の案件は触らない・スポットの進行・表が無いとき、を確かめる。
//   node scripts/design-tests/ops-auto-test.js   （CLASSIC=1 で現行／W=390 でスマホ幅）
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
  await p.evaluate(() => window.opsAutoSync()); await p.waitForTimeout(1500);
  const o1 = await ops(p, 'B1');
  const dep = o1 && o1.s.find(x => /本船出港/.test(x.l));
  ok('輸出：出港実績で「本船出港」に自動でチェック', !!dep && dep.d && dep.by === 'auto:colins' && /出港実績 11\/20 14:05/.test(dep.src), dep);
  ok('輸出：ほかの作業はそのまま', !!o1 && o1.s.filter(x => x.d).length === 1, o1 && o1.s.filter(x => x.d).map(x => x.l));
  ok('自動の記録は st.ax に控える', !!o1 && Array.isArray(o1.ax) && o1.ax.includes(dep.id), o1 && o1.ax);
  const cm = await p.evaluate(() => window.__db.quote_comments.map(c => c.body || c.text || c.message || JSON.stringify(c)).join('\n'));
  ok('申し送りに「🛰 … 自動で完了」', /🛰 業務：「本船出港」を自動で完了/.test(cm), cm);
  const o5 = await ops(p, 'B5');
  const arr = o5 && o5.s.find(x => /入港/.test(x.l)), ret = o5 && o5.s.find(x => /空コンテナの返却/.test(x.l));
  ok('輸入：入港実績で「本船の入港（到着）」にチェック', !!arr && arr.d && /入港実績 11\/10 06:30/.test(arr.src), arr);
  ok('輸入：返却が全部そろっていないので「空コンテナの返却」はまだ', !!ret && !ret.d, ret);
  ok('「到着案内（A/N）の受領」には入れない', !!o5 && !o5.s.find(x => /到着案内/.test(x.l)).d);
  const o6 = await ops(p, 'B6');
  const d6 = o6 && o6.s.filter(x => x.d).map(x => x.l);
  ok('往復：追跡の向き（輸入）と合う【復路】の入港だけ', !!o6 && d6.length === 1 && d6[0] === '【復路】本船の入港（到着）', d6);
  const a6 = o6 && o6.s.find(x => x.d);
  ok('積み替えがあれば最後の本船の入港を使う', !!a6 && /11\/13 08:00/.test(a6.src), a6);
  ok('他のメンバーが編集中の案件は触らない', !(await ops(p, 'B8')), await ops(p, 'B8'));
  const j1 = await p.evaluate(() => window.__db.ops_jobs[0].data.st);
  const jd = j1 && j1.s.find(x => /本船出港/.test(x.l));
  ok('見積に紐づいたスポットの進行にも自動でチェック', !!jd && jd.d && jd.by === 'auto:colins', jd);
  // 人が外したら、二度と自動では入れない
  await p.evaluate(() => window.opsOpen('B1')); await p.waitForTimeout(400);
  const note = await p.evaluate(() => (document.querySelector('#opmModal .opm-auto') || {}).textContent || '');
  ok('チェックリストに「🛰 サイバーポートで追跡中」の案内', /サイバーポートで追跡中/.test(note), note);
  const by = await steps(p);
  ok('チェックリストに「🛰 サイバーポート（自動）」と実績', by.some(x => x.d && /サイバーポート（自動）/.test(x.by) && /COLINS の出港実績/.test(x.by)), by);
  const i = by.findIndex(x => /本船出港/.test(x.l));
  await p.evaluate(i => document.querySelector('#opmModal .opm-chk[data-i="' + i + '"]').click(), i); await p.waitForTimeout(600);
  await click(p, '#opmModal [data-opm="close"]'); await p.waitForTimeout(200);
  await p.evaluate(() => window.opsAutoSync()); await p.waitForTimeout(1200);
  const o1b = await ops(p, 'B1');
  ok('外した作業には自動で入れ直さない', !!o1b && !o1b.s.find(x => /本船出港/.test(x.l)).d, o1b && o1b.s.find(x => /本船出港/.test(x.l)));
  // 単体：取引の追跡（source=trade）は対象外・実績がなければ何もしない
  const pure = await p.evaluate(() => {
    const st = { s: [{ id: 'a', l: '本船出港', d: false }] };
    const n0 = window.opsAutoApply(st, { direction: 'export', snapshot: [{ k: 'v:A|1:pol:atd', val: null }] }, 'export').length;
    const n1 = window.opsAutoApply(st, { direction: 'export', snapshot: [{ k: 'v:A|1:pol:atd', val: '2026-11-20T14:05:00' }] }, 'export').length;
    return [n0, n1];
  });
  ok('実績が空なら何もしない／入ると 1 件', pure[0] === 0 && pure[1] === 1, pure);
  ok('ページのエラーなし', errs.length === 0, errs);
  await ctx.close();
  // 表が無い（SQL 未実行）とき：何もせず、エラーも出さない
  {
    const r = await open({ nowatch: true });
    await r.p.evaluate(() => window.opsAutoSync()); await r.p.waitForTimeout(800);
    const o = await r.p.evaluate(() => window.__db.quote_presets.find(x => x.id === 'B1').data.fields['qf-ops'] || null);
    ok('自動確認の表が無いときは何もしない', !o, o);
    ok('（表なし）ページのエラーなし', r.errs.length === 0, r.errs);
    await r.ctx.close();
  }
  await b.close(); srv.close();
  console.log(fails ? 'FAIL=' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
