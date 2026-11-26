// 名前に入れた文字で、画面にスクリプトを仕込めないことの試験（2026-11 の QA で見つかった XSS の再発防止）。
//   お客様名・サブコン名などに `"><img onerror=…>` や `'-alert(…)-'` を入れた案件を偽の Supabase に置き、
//   ダッシュボード（ランキング）・類似案件のプレビュー・マスター管理・統計・編集画面を開いて、alert が 1 回も出ないことを見る。
//   修正前のコード（stats.js の _ea が " と & を通す等）では 4 か所で alert が出る。
//   node scripts/design-tests/xss-names-test.js
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
(async () => {
  const __bad = [];
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => {
    window.__hits = []; window.__x = l => { window.__hits.push(String(l)); };
    window.alert = m => window.__hits.push('alert:' + m);
    try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('fwd.follow', '1'); } catch (e) {}
    const T = {
      H: L => (L==='cust' ? `'-alert('XSS-rank')-'` : L==='sv' ? `x');alert('XSS-sv');//` : 'safe' + L),
      A: L => (L==='cust' ? `"><img src=x onerror=alert(document.title.length)>` : 'safeA' + L),
      Q: L => 'q'+L, S: L => 's'+L, E: L => 'e'+L, B: L => 'b'+L,
    };
    window.__T = T;
    const presets = [], comments = [], votes = [], details = [], news = [];
    Object.keys(T).forEach((k, i) => {
      const P = T[k];
      const cust = P('cust'), sv = P('sv');
      const cells = [false, '', sv, false, P('nm'), '1', P('un'), '1', 'JPY', 'JPY', '100', '120', '', '20', P('nt'), '', '', '', '', P('pt')];
      while (cells.length < 36) cells.push('');
      presets.push({
        id: 'P' + k, name: P('pname'), status: '下書き中', customer: cust, person: P('person'), created_by: 'me@x.com', owner_email: 'me@x.com',
        updated_at: '2026-11-1' + i + 'T00:00:00Z', ref: P('ref'), tags: [P('tag')], pol: P('pol'), pod: P('pod'), carrier: P('carrier'),
        data: { fields: { 'qf-ref': P('ref'), 'qf-status': '下書き中', 'qf-customer': cust, 'qf-person': P('person'), 'qf-case-name': P('case'), 'qf-memo': P('memo'), 'remarkTextarea': P('remark'), 'z2Pol': P('pol'), 'z2Pod': P('pod'), 'qf-follower': 'me@x.com' }, rows: [{ _type: 'data', cells }, { _type: 'remark', text: P('rmrow') }], _rowFormat: 'v3-mixed-rows' },
      });
      comments.push({ id: 'c' + k, preset_id: 'P' + k, body: P('comment'), created_by: 'me@x.com', created_at: '2026-11-20T00:00:00Z' });
      votes.push({ field: 'customer', value: cust, voter_email: 'me@x.com' }, { field: 'sv', value: sv, voter_email: 'me@x.com' });
      details.push({ field: 'customer', value: cust, details: { dealType: '荷主（直接）', website: 'javascript:__x(\'web' + k + '\')', memo: P('mdmemo'), contacts: [{ name: P('ctname'), dept: P('ctdept'), email: P('ctmail') }], referrer: P('referrer'), via: P('via') } });
      details.push({ field: 'sv', value: sv, details: { svTypes: [P('svtype')], location: P('loc'), website: 'javascript:__x(\'svweb' + k + '\')', group: P('group') } });
      news.push({ id: 'n' + k, field: 'customer', value: cust, kind: 'news', title: P('newstitle'), body: P('newsbody'), url: 'javascript:__x(\'newsurl\')', news_date: '2026-11-20', created_by: 'me@x.com', created_at: '2026-11-20T00:00:00Z' });
    });
    const db = {
      quote_presets: presets, quote_comments: comments, master_votes: votes, master_details: details, master_news: news,
      allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }],
      user_profiles: [{ email: 'me@x.com', display_name: T.H('dispname') }],
      announcements: [{ id: 'a1', kind: 'important', title: T.A('anntitle'), body: T.H('annbody') + ' javascript:__x(1) https://x.com/"><img src=x onerror=__x(\'annurl\')>', starts_at: '2026-01-01T00:00:00Z', ends_at: null, updated_at: '2026-11-01T00:00:00Z', created_by: 'me@x.com' }],
      feedbacks: [{ id: 'f1', category: 'bug', section: T.A('fbsec'), title: T.A('fbtitle'), body: T.H('fbbody'), status: 'open', reporter_email: T.A('fbmail'), page_url: 'javascript:__x(\'fburl\')', context: { nav: T.H('fbnav'), errs: [T.H('fberr')] }, attachments: [], response: T.H('fbresp'), created_at: '2026-11-20T00:00:00Z', report_no: 1 }],
      bookmarks: [{ id: 'b1', label: T.A('bmlabel'), url: 'javascript:__x(\'bmurl\')', carrier_type: 'FCL', carrier: T.S('bmcarrier'), memo: T.H('bmmemo'), created_by: 'me@x.com' }],
      customer_rules: [{ id: 'r1', customer: presets[0].customer, person: '', severity: 'strict', body: T.H('rulebody'), reason: T.A('rulereason'), created_by: 'me@x.com', created_at: '2026-11-01T00:00:00Z', checked_at: '2026-11-01T00:00:00Z' }],
      customer_cases: [], synonym_groups: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [], quote_preset_links: [], master_requests: [], ops_jobs: [], drift_log: [],
    };
    window.__db = db;
    const qb = t => {
      const st = { op: 'select', filters: [], payload: null };
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, is() { return api; }, ilike() { return api; },
        gte() { return api; }, lte() { return api; }, lt() { return api; }, gt() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, or() { return api; }, filter() { return api; }, match() { return api; },
        eq(k, v) { st.filters.push(r => r[k] === v); return api; },
        in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
        upsert(o) { st.op = 'insert'; st.payload = o; return api; }, insert(o) { st.op = 'insert'; st.payload = o; return api; },
        update(o) { st.op = 'update'; st.payload = o; return api; }, delete() { st.op = 'delete'; return api; },
        single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; }, abortSignal() { return api; },
        then(res, rej) {
          const rows = (db[t] = db[t] || []);
          let data = null;
          if (st.op === 'insert') { const made = [].concat(st.payload).map(o => Object.assign({ id: 'id' + Math.random().toString(36).slice(2), created_at: new Date().toISOString() }, o)); made.forEach(r => rows.push(r)); data = st.single ? made[0] : made; }
          else if (st.op === 'delete') { db[t] = rows.filter(r => !st.filters.every(f => f(r))); }
          else if (st.op === 'update') { const hit = rows.filter(r => st.filters.every(f => f(r))); hit.forEach(r => Object.assign(r, st.payload)); data = hit; }
          else { data = rows.filter(r => st.filters.every(f => f(r))).map(r => JSON.parse(JSON.stringify(r))); if (st.single) data = data[0] || null; }
          return Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : 0 }).then(res, rej);
        },
      };
      return api;
    };
    const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() { return Promise.resolve(); }, presenceState() { return {}; } };
    const user = { id: 'u1', email: 'me@x.com', user_metadata: { full_name: '自分' } };
    const client = {
      from: qb, rpc: name => Promise.resolve({ data: name === 'get_my_role' ? 'admin' : (name === 'quote_acquire_lock' ? 'OK' : null), error: null }), channel: () => ch, removeChannel() {},
      auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), getUser: () => Promise.resolve({ data: { user } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } },
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), list: async () => ({ data: [], error: null }), createSignedUrl: async () => ({ data: { signedUrl: 'about:blank' }, error: null }), createSignedUrls: async () => ({ data: [], error: null }) }) },
    };
    window.supabase = { createClient: () => client };
  });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  p.on('dialog', d => { console.log('DIALOG', d.type(), d.message()); d.dismiss().catch(() => {}); });
  p.setDefaultTimeout(15000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

  // インライン属性・href を砂場で評価
  const scan = async (where) => {
    const r = await p.evaluate(() => {
      const out = [];
      const mk = () => { const f = function () { return pr; }; const pr = new Proxy(f, { get: (t, k) => k === Symbol.toPrimitive ? (() => '') : pr, apply: () => pr }); return pr; };
      const noop = mk();
      document.querySelectorAll('*').forEach(el => {
        for (const a of el.attributes) {
          if (/^on/i.test(a.name) && /__x/.test(a.value)) {
            const got = [];
            const scope = new Proxy({}, { has: () => true, get: (t, k) => k === Symbol.unscopables ? undefined : (k === '__x' ? (l => got.push(l)) : noop) });
            try { new Function('__s', 'with(__s){' + a.value + '\n}').call(el, scope); } catch (e) { got.push('SYNTAX:' + e.message.slice(0, 40)); }
            const real = got.filter(g => !/^SYNTAX/.test(g));
            if (got.length) out.push({ tag: el.tagName + '.' + (el.className || '').toString().slice(0, 30) + (el.tagName==='IMG' ? ' parent=' + (el.parentElement ? el.parentElement.tagName + '.' + el.parentElement.className + '#' + el.parentElement.id : '') : ''), attr: a.name, got, v: a.value.slice(0, 160) });
          }
          if ((a.name === 'href' || a.name === 'src') && /^\s*javascript:/i.test(a.value)) out.push({ tag: el.tagName + '.' + (el.className || '').toString().slice(0, 30), attr: a.name, got: ['JSURL'], v: a.value.slice(0, 100) });
        }
      });
      const hits = window.__hits.splice(0);
      return { out: out.filter(o => o.got.some(g => !/^SYNTAX/.test(g))), hits };
    });
    console.log('\n=== ' + where + ' hits=' + JSON.stringify(r.hits)); __bad.push(...r.hits, ...r.out.filter(o => !o.got.includes('JSURL')).map(o => where + ':' + o.tag));
    const seen = new Set();
    r.out.forEach(o => { const k = o.tag + o.attr + o.got.join(); if (seen.has(k)) return; seen.add(k); console.log('  ', JSON.stringify(o)); });
  };
  const step = async (name, fn, wait, arg) => { try { await p.evaluate(fn, arg); } catch (e) { console.log('ERR ' + name + ': ' + e.message.slice(0, 120)); } await p.waitForTimeout(wait || 1500); await scan(name); };

  await scan('load');
  const ev = async (n, f) => { try { await p.evaluate(f); } catch (e) { console.log('ERR', n, e.message.slice(0,150)); } await p.waitForTimeout(1500); { const h = await p.evaluate(() => window.__hits.splice(0)); __bad.push(...h); console.log(n, JSON.stringify(h)); } };
  await ev('dashboard', () => { document.querySelector('[aria-controls="tab-quote-make"]').click(); setTimeout(() => window.qpShowDashboard(), 800); });
  await p.waitForTimeout(1500);
  await ev('click rank item', () => { const b = [...document.querySelectorAll('.qpd-rank-item')].find(x => /alert/.test(x.getAttribute('onclick'))); console.log(!!b); b.click(); });
  await ev('preview PH', () => window.cloudPreviewPreset('PH'));
  await ev('click group chk', () => { const c = document.querySelector('.cp-group-chk'); c.click(); });
  await ev('click bm javascript', () => {});
  await ev('master', () => switchCategory('master', document.querySelector('[aria-controls="tab-master"]')));
  await p.waitForTimeout(3000); { const h = await p.evaluate(() => window.__hits.splice(0)); __bad.push(...h); console.log('master later', JSON.stringify(h)); }
  await ev('stats', () => { switchCategory('stats', document.querySelector('[aria-controls="tab-stats"]')); setTimeout(()=>window.statsSetPane('ledger'),1500); });
  await p.waitForTimeout(3000); { const h = await p.evaluate(() => window.__hits.splice(0)); __bad.push(...h); console.log('stats later', JSON.stringify(h)); }
  await ev('editor PH', () => { document.querySelector('[aria-controls="tab-quote-make"]').click(); window.cloudLoadPreset('PH'); });
  await p.waitForTimeout(2500);
  await ev('click qsp add', () => { const b = document.querySelector('.qsp-dig-grp-add'); console.log(b && b.getAttribute('onclick')); b.click(); });
  await b.close(); srv.close();
  if (__bad.length) { console.log('FAIL 名前からスクリプトが動いた：' + JSON.stringify(__bad)); process.exit(1); }
  console.log('PASS どの画面でも、名前に入れたスクリプトは動かない'); console.log('全項目 PASS');
})();
