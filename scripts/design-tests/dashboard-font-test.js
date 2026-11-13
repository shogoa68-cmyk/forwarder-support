// 📊 ダッシュボードの文字サイズは 5 段（12／13／14／16／18px）にそろえる（2026-11）：Industry（既定）・現行（CLASSIC=1）・スマホ幅（W=390）。
//   node scripts/design-tests/dashboard-font-test.js
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
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html${process.env.CLASSIC ? '?theme=classic' : ''}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0;
  const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };

  // links: [id, a, b, parent|null]  ／ 案件 P1(メイン)→S1→S2（孫）, P1→S3, P1—PEER（ただの関連）, X—Y（別の関連）
  async function open({ noParentCol = false, fillers = 0 } = {}) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    await ctx.addInitScript(({ noParentCol, fillers }) => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      const mk = (id, ct) => ({ id, name: '案件' + id, status: '下書き中', customer: 'X社', created_by: 'me@x.com', owner_email: 'me@x.com', updated_at: '2026-11-' + ct + 'T00:00:00Z', ref: 'R-' + id, data: { fields: { 'qf-ref': 'R-' + id, 'qf-customer': '株式会社サンプル商事', 'qf-person': '田中', 'qf-case-name': '東京→上海 FCL 20GP 見積', 'z2Pol': 'TOKYO', 'z2Pod': 'SHANGHAI', 'z2Carrier': 'ONE', 'cond-incoterms': 'FOB', 'cond-mode': '海上FCL' }, rows: [] } });
      const L = (id, a, b, parent, note) => ({ id, preset_a: a, preset_b: b, parent_id: parent || null, note: note || '', created_by: 'me@x.com' });
      const db = {
        quote_presets: ['P1', 'S1', 'S2', 'S3', 'PEER', 'X', 'Y', 'Z'].map((id, i) => mk(id, '1' + i)).concat(Array.from({ length: fillers }, (_, i) => mk('F' + (i + 1), String(20 + i)))),
        quote_preset_links: [L('l1', 'P1', 'S1', 'P1', '追加分'), L('l2', 'S1', 'S2', 'S1'), L('l3', 'S3', 'P1', 'P1'), L('l4', 'P1', 'PEER', null, '代替案'), L('l5', 'X', 'Y', null)],
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
            return Promise.resolve({ data, error: null }).then(res, rej);
          },
        };
        const origIn = api.in; api.in = (k, vs) => { if (k === 'parent_id') st.__inParent = true; return origIn(k, vs); };
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
  const W = +(process.env.W || 1400);
  await p.setViewportSize({ width: W, height: 1000 });
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const sizes = {}; const walk = el => { for (const n of el.children) { const t = [...n.childNodes].some(x => x.nodeType === 3 && x.textContent.trim()); if (t && n.offsetParent !== null) { const f = getComputedStyle(n).fontSize; sizes[f] = (sizes[f] || 0) + 1; } walk(n); } };
    walk(document.querySelector('#qpDashboard'));
    const px = s => { const e = document.querySelector(s); return e ? parseFloat(getComputedStyle(e).fontSize) : null; };
    return { sizes, stat: px('.qpd-stat-n'), cust: px('.cloud-kv-cust'), who: px('.cloud-kv-who'), name: px('.cloud-card-name'), btn: px('.btn-preset-preview'), step: px('.qp-step') };
  });
  const lv = Object.keys(r.sizes).map(parseFloat).sort((a, b) => a - b);
  // PC は 12／13／14／16／18、スマホ幅（〜600px）は --text-* が 1 段上がる 13／14／16／17／20
  const allowed = W <= 600 ? [13, 14, 16, 17, 20] : [12, 13, 14, 16, 18];
  ok('文字サイズは 5 段だけ（' + allowed.join('／') + 'px）', lv.every(v => allowed.includes(v)), r.sizes);
  ok('最大と最小の差が小さい（PC 6px・スマホ 7px 以内）', lv[lv.length - 1] - lv[0] <= (W <= 600 ? 7 : 6), lv);
  const [xs, sm, base, lg, xl] = allowed;
  ok('統計タイルの数字は最大の段（22px から縮めた）', r.stat === xl, r.stat);
  ok('お客様名は最大の段（23px から縮めた）', r.cust === xl, r.cust);
  ok('作成・更新者は小さめの本文の段', r.who === sm, r.who);
  ok('案件名は見出しの段', r.name === lg, r.name);
  ok('ボタン・工程バーは最小の段（10〜11px から上げた）', r.btn === xs && r.step === xs, [r.btn, r.step]);
  await b.close(); srv.close();
  console.log(fails ? '失敗 ' + fails + ' 件' : 'すべて成功');
  process.exit(fails ? 1 : 0);
})();
