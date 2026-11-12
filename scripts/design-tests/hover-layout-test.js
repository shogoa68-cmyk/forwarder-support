// 表示崩れの回帰試験：タブレット幅のヘッダー／確認画面の上のトースト／狭い幅のマスター管理の別名列／ダッシュボードの長い名前。
//   node scripts/design-tests/hover-layout-test.js   （THEME=1 で Industry）。偽の Supabase を使う
// 行のサブコン欄：マスターに無い名前は「サブコン未登録」の印を出し、そこから登録（承認制のメンバーは申請）できる。
// 偽の Supabase（メモリ上の表）を使う。実サーバーには接続しない。
//   node scripts/design-tests/sv-master-chip-test.js           （THEME=1 で Industry・SHOT=パス で「BOOKMARK」を開いた画面を保存）
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
  const out = [];
  const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));

  // クラウド（偽）の初期データ
  const ME = 's@example.com';
  const seed = {
    master_votes: [
      { field: 'carrier', value: 'ONE', voter_email: ME }, { field: 'nm', value: 'THC', voter_email: ME },
      { field: 'nm', value: '海上運賃', voter_email: ME }, { field: 'port', value: 'Yokohama', voter_email: ME },
      { field: 'sv', value: 'テスト運送', voter_email: ME }, { field: 'sv', value: 'ABCキャリア', voter_email: ME },
    ],
    synonym_groups: [
      { id: 'g1', field: 'carrier', canonical: 'ONE', aliases: ['Ocean Network Express'] },
      { id: 'g2', field: 'nm', canonical: 'THC', aliases: ['Terminal Handling Charge', 'ターミナルハンドリングチャージ'] },
      { id: 'g3', field: 'port', canonical: 'Yokohama', aliases: ['横浜'] },
      { id: 'g4', field: 'sv', canonical: 'ABCキャリア', aliases: ['ABC Line'] },
    ],
    master_details: [
      { field: 'nm', value: 'THC', details: { defaultUnit: 'CNTR', defaultCat: 'export-local', enName: 'Terminal Handling Charge' } },
      { field: 'sv', value: 'テスト運送', details: { svTypes: ['運送業者'], location: '横浜市' } },
      { field: 'sv', value: 'ABCキャリア', details: { svTypes: ['FCL CARRIER', 'LCL CARRIER'], website: 'https://abc.example' } },
    ],
    bookmarks: [
      { id: 'b1', label: 'ABC 公式サイト', url: 'https://abc.example', carrier: 'ABCキャリア', function: 'tracking' },
      { id: 'b2', label: 'ABC 運賃表', file_path: 'x/rate.pdf', file_name: 'rate.pdf', carrier: 'ABCキャリア' },
      { id: 'b3', label: '別名側で登録したリンク', url: 'https://abc2.example', carrier: 'ABC Line' },
      { id: 'b4', label: '他社のリンク', url: 'https://other.example', carrier: '他社キャリア' },
    ],
    alias_rules: [{ id: 'r1', field: 'nm', from_value: 'O/F', to_value: '海上運賃' }],
  };
  // このブラウザにだけ残っている古いデータ（移行の対象）
  const legacy = {
    masterCandidates_v1: [{ field: 'nm', value: 'ローカル品名', votes: 1 }, { field: 'nm', value: 'THC', votes: 1 }],
    synonymGroups_v1: [{ id: 'l1', field: 'sv', canonical: 'ローカル運送', aliases: ['ﾛｰｶﾙ運送'] }],
    masterDetails_v1: [{ field: 'nm', value: 'ローカル品名', details: { defaultUnit: 'B/L' } }],
    aliasRules_v1: [{ id: 'l2', field: 'port', from_value: 'YKH', to_value: 'Yokohama' }],
    abbrevPairs_v1: [{ id: 'l3', field: 'carrier', abbrev: 'NTL', full: 'NAIGAI TRANS LINES' }],
    statsExclusions_v1: [{ field: 'nm', value: 'ローカル除外', created_at: '2026-01-01T00:00:00Z' }],
  };

  // opts.approval：申請テーブル（master_requests）を用意する＝承認制、opts.role：get_my_role() の結果
  async function open(loggedIn, opts = {}) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    await ctx.addInitScript(({ seed, legacy, loggedIn, ME, opts }) => {
      try {
        localStorage.setItem('fwd.uiMode', 'detail');
        Object.entries(legacy).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
        if (opts.backup) localStorage.setItem('masterLocalBackup_v1', JSON.stringify(opts.backup));
      } catch (e) {}
      if (!loggedIn) return;
      const db = JSON.parse(JSON.stringify(seed));
      if (opts.approval) db.master_requests = [];
      if (opts.excl) db.stats_exclusions = [];
      window.__db = db;
      const qb = t => {
        const st = { op: 'select', filters: [], payload: null, opts: null, one: false, range: null };
        const api = {
          select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, or() { return api; },
          is() { return api; }, ilike() { return api; }, gte() { return api; }, lte() { return api; },
          range(a, z) { st.range = [a, z]; return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; },
          in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          match(o) { st.filters.push(r => Object.keys(o).every(k => r[k] === o[k])); return api; },
          upsert(o, opts) { st.op = 'upsert'; st.payload = o; st.opts = opts; return api; },
          insert(o) { st.op = 'insert'; st.payload = o; return api; },
          update(o) { st.op = 'update'; st.payload = o; return api; },
          delete() { st.op = 'delete'; return api; },
          single() { st.one = true; return api; }, maybeSingle() { st.one = true; return api; },
          then(res, rej) {
            // 申請テーブルは承認制の試験のときだけ存在する（無いときは未作成のエラー＝従来の動き）
            if ((t === 'master_requests' || t === 'stats_exclusions') && !db[t]) return Promise.resolve({ data: null, error: { message: 'relation "' + t + '" does not exist' } }).then(res, rej);
            const rows = (db[t] = db[t] || []);
            // 1 行でも不正（制約違反）なら、まとめて書いた分も全体が失敗する（Postgres と同じ）
            if (opts.badKey && (st.op === 'upsert' || st.op === 'insert') && [].concat(st.payload).some(o => [o.canonical, o.value, o.from_value].includes(opts.badKey))) return Promise.resolve({ data: null, error: { message: 'violates check constraint' } }).then(res, rej);
            if (opts.failDetailWrites && t === 'master_details' && st.op !== 'select') return Promise.resolve({ data: null, error: { message: 'new row violates row-level security policy' } }).then(res, rej);
            let data = null;
            if (st.op === 'upsert' || st.op === 'insert') {
              [].concat(st.payload).forEach(o => {
                const keys = ((st.opts && st.opts.onConflict) || '').split(',').filter(Boolean);
                const i = keys.length ? rows.findIndex(r => keys.every(k => r[k] === o[k])) : -1;
                if (i >= 0) Object.assign(rows[i], o); else rows.push(Object.assign({ id: 'id' + Math.random().toString(36).slice(2) }, o));
              });
            } else if (st.op === 'delete') {
              db[t] = rows.filter(r => !st.filters.every(f => f(r)));
            } else if (st.op === 'update') {
              rows.filter(r => st.filters.every(f => f(r))).forEach(r => Object.assign(r, st.payload));
            } else {
              data = rows.filter(r => st.filters.every(f => f(r)));
              if (st.range) data = data.slice(st.range[0], st.range[1] + 1);
              if (st.one) data = data[0] || null;
            }
            return Promise.resolve({ data, error: null }).then(res, rej);
          },
        };
        return api;
      };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, presenceState() { return {}; }, unsubscribe() { return Promise.resolve(); }, send() { return Promise.resolve(); } };
      const user = { email: ME, user_metadata: { full_name: 'S' } };
      const client = {
        from: qb, rpc: name => Promise.resolve({ data: name === 'get_my_role' ? (opts.role || 'member') : null, error: null }), channel: () => ch, removeChannel() {}, storage: { from: () => ({}) },
        auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signOut: () => Promise.resolve({}), signInWithOAuth: () => Promise.resolve({}) },
      };
      window.supabase = { createClient: () => client };
    }, { seed, legacy: (opts.legacy !== undefined ? opts.legacy : legacy), loggedIn, ME, opts });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage();
    const errs = [], dlg = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => { dlg.push(d.message()); d.accept(); });
    p.setDefaultTimeout(10000);
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
    await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1000);
    await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);
    await p.evaluate(async () => { if (window.statsLoadMasterCache) await window.statsLoadMasterCache(); if (window.arRefreshDatalist) window.arRefreshDatalist(); });
    return { ctx, p, errs, dlg };
  }
  const { ctx, p, errs } = await open(true, { legacy: {}, approval: true, role: 'admin' });
  // 1) ヘッダー：タブレット幅でも見出しが潰れない・横にはみ出さない
  for (const W of [900, 700]) {
    await p.setViewportSize({ width: W, height: 800 }); await p.waitForTimeout(150);
    const r = await p.evaluate(() => ({ h1h: document.querySelector('.header h1').getBoundingClientRect().height, hh: document.querySelector('.header').getBoundingClientRect().height }));
    ok('ヘッダーの見出しが 1 行で出る(' + W + 'px)', r.h1h < 40 && r.hh < 220, r);
  }
  // 2) 確認画面の上にトーストが見える
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.evaluate(() => { window.uiConfirm({ title: 't', message: 'm' }); });
  await p.waitForTimeout(300);
  await p.evaluate(() => window.quoteShowToast('テスト', 'success', 8000)); await p.waitForTimeout(1200);
  const t = await p.evaluate(() => { const e = [...document.querySelectorAll('.toast')].pop(); e.style.pointerEvents = 'auto'; const r = e.getBoundingClientRect(); const o = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return o && o.className; });
  ok('確認画面の表示中もトーストが前面', /(^| )toast( |$)/.test(t || ''), t);
  await p.evaluate(() => document.querySelector('.confirm-overlay') && document.querySelector('.confirm-overlay').remove());
  // 3) マスター管理（狭い幅）：別名列が 1 文字幅に潰れない
  await p.evaluate(async () => {
    const L = 'VeryLongCompanyNameWithoutSpacesABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    window.__db.master_votes.push({ field: 'sv', value: L, voter_email: 's@example.com' });
    window.__db.synonym_groups.push({ id: 'gx', field: 'sv', canonical: L, aliases: ['別名その2'] });
    await window.statsLoadMasterCache(); switchCategory('master', document.querySelector('[aria-controls="tab-master"]'));
  });
  await p.setViewportSize({ width: 680, height: 800 }); await p.waitForTimeout(1200);
  const th = await p.evaluate(() => { const h = [...document.querySelectorAll('#tab-master .master-table th')].find(x => /別名/.test(x.textContent)); return h && h.getBoundingClientRect().width; });
  ok('マスター管理 680px：別名列の幅が十分', th > 100, th);
  // 4) ダッシュボード：空白の無い長い名前でページが横にはみ出さない
  await p.evaluate(() => {
    const L = 'とても長いお客様名株式会社ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    window.__db.quote_presets = [{ id: 'q1', name: L, status: '下書き中', customer: L, owner_email: 's@example.com', created_by: 's@example.com', updated_at: '2026-10-20T00:00:00Z', data: { fields: { 'qf-customer': L }, rows: [], _rowFormat: 'v3-mixed-rows' } }];
    window.qpShowDashboard(); window.qpdSetView('card');
  });
  await p.setViewportSize({ width: 900, height: 800 });
  await p.evaluate(async () => { await window.cloudListPresets(); }); await p.waitForTimeout(1000);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  ok('ダッシュボード 900px：横にはみ出さない', sw <= 900, sw);
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
  console.log(out.join('\n'));
  if (out.some(l => l.startsWith('FAIL'))) process.exit(1);
})();
