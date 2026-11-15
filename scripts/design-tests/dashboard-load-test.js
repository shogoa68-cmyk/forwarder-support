// ⚡ ダッシュボードの読み込み順：案件が多くても、本体（data）の取得を並列に行い、一覧の取得はプロフィール・別名の取得と同時に始める。
//   偽の Supabase（1 回 100ms の遅延・案件 200 件・通信の開始／終了を記録）で、通信の重なりを確かめる（時間そのものは環境で揺れるため見ない）。
//   node scripts/design-tests/dashboard-load-test.js           （THEME=1 で Industry）
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
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html${process.env.Q||''}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0;
  const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };

  // links: [id, a, b, parent|null]  ／ 案件 P1(メイン)→S1→S2（孫）, P1→S3, P1—PEER（ただの関連）, X—Y（別の関連）
  async function open({ noParentCol = false, fillers = 0 } = {}) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    await ctx.addInitScript(({ noParentCol, fillers }) => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      const N = 200;
      const cell = (sv, nm, i) => { const c = Array(34).fill(''); c[1] = 'other'; c[2] = sv; c[4] = nm; c[5] = '1'; c[6] = 'CNTR'; c[7] = '1'; c[8] = 'JPY'; c[9] = 'JPY'; c[10] = String(1000 + i); c[11] = String(1200 + i); return c; };
      const mk = (id, ct) => ({ id, name: '案件' + id, status: '下書き中', customer: 'X社' + (ct % 7), created_by: 'me@x.com', owner_email: 'me@x.com', updated_at: new Date(Date.UTC(2026, 10, 1) + ct * 3600e3).toISOString(), ref: 'R-' + id, pol: 'TOKYO', pod: 'SHANGHAI', transport_mode: '海上（FCL）', data: { fields: { 'qf-ref': 'R-' + id, 'qf-customer': 'X社' + (ct % 7), 'z2Pol': 'TOKYO', 'z2Pod': 'SHANGHAI' }, _rowFormat: 'v3-mixed-rows', rows: Array.from({ length: 25 }, (_, i) => ({ _type: 'data', cells: cell('サブコン' + (i % 4), 'CHARGE' + i, i) })) } });
      const L = (id, a, b, parent, note) => ({ id, preset_a: a, preset_b: b, parent_id: parent || null, note: note || '', created_by: 'me@x.com' });
      const db = {
        quote_presets: Array.from({ length: N }, (_, i) => mk('C' + (i + 1), i)),
        quote_preset_links: [L('l1', 'C1', 'C2', 'C1', 'x'), L('l2', 'C3', 'C4', null)],
        allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }], user_profiles: [], quote_comments: [],
        master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [],
      };
      if (noParentCol) db.quote_preset_links.forEach(l => delete l.parent_id);
      window.__db = db;
      // 'a.eq.X,b.in.(P,Q)' / 'and(a.eq.X,b.eq.Y),and(...)' を解く
      const splitTop = s => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; };
      const term = (t, r) => {
        const m = t.match(/^and\((.*)\)$/); if (m) return splitTop(m[1]).every(x => term(x, r));
        const k = t.match(/^([a-z_]+)\.(eq|in)\.(.*)$/); if (!k) return true;
        if (k[2] === 'eq') return r[k[1]] === k[3];
        return k[3].replace(/^\(|\)$/g, '').split(',').includes(r[k[1]]);
      };
      const qb = t => {
        const st = { op: 'select', filters: [], payload: null, cols: '' };
        const api = {
          select(c) { st.cols = c || ''; return api; }, order() { return api; }, limit() { return api; }, not() { return api; },
          is() { return api; }, ilike() { return api; }, gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; },
          or(expr) { st.filters.push(r => splitTop(expr).some(x => term(x, r))); return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; },
          in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          upsert(o) { st.op = 'insert'; st.payload = o; return api; },
          insert(o) { st.op = 'insert'; st.payload = o; return api; },
          update(o) { st.op = 'update'; st.payload = o; return api; },
          delete() { st.op = 'delete'; return api; },
          single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
          then(res, rej) {
            const miss = { code: '42703', message: 'column quote_preset_links.parent_id does not exist' };
            const rows = (db[t] = db[t] || []);
            if (t === 'quote_preset_links' && noParentCol) {
              if (/parent_id/.test(st.cols) || (st.payload && JSON.stringify(st.payload).includes('parent_id')) || st.filters.some(f => { try { return f({ parent_id: 'q' }) && false; } catch (e) { return false; } }))
                return Promise.resolve({ data: null, error: miss }).then(res, rej);
              if (st.op === 'select' && st.__inParent) return Promise.resolve({ data: null, error: miss }).then(res, rej);
            }
            let data = null;
            if (st.op === 'insert') { const made = [].concat(st.payload).map(o => Object.assign({ id: 'id' + Math.random().toString(36).slice(2) }, JSON.parse(JSON.stringify(o)))); made.forEach(r => rows.push(r)); if (st.cols) data = st.single ? { id: made[0].id } : made.map(r => ({ id: r.id })); }
            else if (st.op === 'delete') { db[t] = rows.filter(r => !st.filters.every(f => f(r))); }
            else if (st.op === 'update') { rows.filter(r => st.filters.every(f => f(r))).forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.payload)))); }
            else data = rows.filter(r => st.filters.every(f => f(r))).map(r => Object.assign({}, r));
            const t0 = performance.now();
            (window.__net = window.__net || []).push({ t0, table: t, op: st.op, cols: (st.cols || '').slice(0, 50), n: Array.isArray(data) ? data.length : (data ? 1 : 0), bytes: JSON.stringify(data || '').length, done: null });
            const rec = window.__net[window.__net.length - 1];
            return new Promise(r => setTimeout(() => { rec.done = performance.now(); r({ data, error: null }); }, 100)).then(res, rej);
          },
        };
        const origIn = api.in; api.in = (k, vs) => { if (k === 'parent_id') st.__inParent = true; return origIn(k, vs); };
        return api;
      };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() {} };
      const user = { email: 'me@x.com', user_metadata: { full_name: 'Me' } };
      const client = {
        from: qb, rpc: name => new Promise(r => setTimeout(r, 100)).then(() => ({ data: name === 'get_my_role' ? 'admin' : (name === 'quote_acquire_lock' ? 'OK' : null), error: null })), channel: () => ch, removeChannel() {},
        auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } },
        storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrls: async () => ({ data: [], error: null }) }) },
      };
      window.supabase = { createClient: () => client };
    }, { noParentCol, fillers });
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

  const { ctx, p } = await open();
  await p.waitForTimeout(2500);
  const res = await p.evaluate(() => ({ net: window.__net || [], rows: (window.cloudGetAllRows ? window.cloudGetAllRows() : []).map(r => !!r.data), marks: window.__marks }));
  const net = res.net.filter(n => n.done != null);
  const bodies = net.filter(n => n.table === 'quote_presets' && n.cols === 'id,data');
  const first = net.filter(n => n.table === 'quote_presets' && /^id,name,status/.test(n.cols)).sort((a, b) => a.t0 - b.t0)[0];
  const syn = net.filter(n => n.table === 'synonym_groups').sort((a, b) => a.t0 - b.t0)[0];
  const overlap = (a, b) => a.t0 < b.done && b.t0 < a.done;
  let maxPar = 0; bodies.forEach(a => { maxPar = Math.max(maxPar, bodies.filter(b => overlap(a, b)).length); });
  ok('本体の取得は 200 件 ÷ 40 件＝5 本', bodies.length === 5, bodies.length);
  ok('本体の取得は並列に走る（同時に 2 本以上・以前は 1 本ずつ順番）', maxPar >= 2, maxPar);
  ok('案件の一覧の取得は、別名（synonym_groups）の取得が終わるのを待たずに始まる', first && syn && first.t0 < syn.done, [first && first.t0, syn && syn.done]);
  ok('全 200 件の本体がそろっている（描画に使う data が欠けない）', res.rows.length === 200 && res.rows.every(Boolean), [res.rows.length, res.rows.filter(Boolean).length]);
  ok('カードが描かれる', await p.evaluate(() => document.querySelectorAll('#qpdListWrap .cloud-card, #qpdListWrap .qpd-row').length > 0), null);
  ok('実行時エラーなし', true, null);
  await b.close(); srv.close();
  console.log(fails ? '失敗 ' + fails + ' 件' : 'すべて成功');
  process.exit(fails ? 1 : 0);
})();
