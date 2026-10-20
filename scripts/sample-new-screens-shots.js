#!/usr/bin/env node
// Design への依頼用：別セッションでコードだけで足した画面・部品の見た目を、架空データで撮る（実サーバーには接続しない）。
//   OUT=<dir> node scripts/sample-new-screens-shots.js          現行デザイン
//   OUT=<dir> THEME=1 node scripts/sample-new-screens-shots.js  Industry
// 出力：n1-table（明細テーブル：パターン設定なし・ミニマム・未登録の名前）／n2-min-panel（「その他 ▾」のミニマム欄）／n3-glossary（用語集）／
//       n4-master-admin・n5-master-member（マスター管理：申請・移行の案内）／n6-mobile（390px 幅の上段）／n7-ops-menu・n8-confirm（マスター管理の「⋯」メニューと確認画面）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
const OUT = process.env.OUT || path.resolve(__dirname, '..', 'docs', 'design-handoff', 'requests', 'new-screens');
const THEME = !!process.env.THEME, SUF = THEME ? '-industry' : '';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const root = path.resolve(__dirname, '..');
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

  // クラウド（偽）の初期データ
  const ME = 's@example.com';
  const seed = {
    master_votes: [
      { field: 'carrier', value: 'ONE', voter_email: ME }, { field: 'nm', value: 'THC', voter_email: ME },
      { field: 'nm', value: '海上運賃', voter_email: ME }, { field: 'port', value: 'Yokohama', voter_email: ME },
      { field: 'sv', value: 'テスト運送', voter_email: ME },
    ],
    synonym_groups: [
      { id: 'g1', field: 'carrier', canonical: 'ONE', aliases: ['Ocean Network Express'] },
      { id: 'g2', field: 'nm', canonical: 'THC', aliases: ['Terminal Handling Charge', 'ターミナルハンドリングチャージ'] },
      { id: 'g3', field: 'port', canonical: 'Yokohama', aliases: ['横浜'] },
    ],
    master_details: [{ field: 'nm', value: 'THC', details: { defaultUnit: 'CNTR', defaultCat: 'export-local', enName: 'Terminal Handling Charge' } }],
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
    const ctx = await b.newContext({ viewport: { width: opts.w || 1400, height: opts.h || 900 }, deviceScaleFactor: 1, locale: 'ja-JP' });
    await ctx.addInitScript(({ seed, legacy, loggedIn, ME, opts }) => {
      try {
        localStorage.setItem('fwd.uiMode', opts.mode || 'detail'); if (opts.theme) localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true }));
        if (!opts.noLegacy) Object.entries(legacy).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
      } catch (e) {}
      if (!loggedIn) return;
      const db = JSON.parse(JSON.stringify(seed));
      if (opts.approval) db.master_requests = opts.requests || [];
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
    }, { seed, legacy, loggedIn, ME, opts });
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

  const css = '*{caret-color:transparent!important;} *,*::before,*::after{animation:none!important;transition:none!important;}';
  const row = (p, i) => p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(i);

  // ===== 明細テーブル（管理者でログイン。承認制あり）=====
  {
    const { ctx, p, errs } = await open(true, { approval: true, role: 'admin', theme: THEME, noLegacy: true });
    await p.addStyleTag({ content: css });
    await p.evaluate(() => setTransport('fcl'));
    // 明細（架空）：A社＝パターン「FCL案」2行＋パターン設定なし1行、B社＝パターン設定なしのみ、MIN の行、未登録の名前の行
    const rows = [
      ['海上運賃', 'A海運', 'FCL案', 'ocean', "40'GP", 1, 1200, 300, 'USD'],
      ['BAF', 'A海運', 'FCL案', 'surcharge', "40'GP", 1, 80, 20, 'USD'],
      ['書類手配費', 'A海運', '', 'export-local', 'B/L', 1, 8000, 2000, 'JPY'],
      ['AMS（Min.あり）', 'B航空', '', 'surcharge', 'kg', 100, 0.1, 0.05, 'USD'],
      ['新規の費用（未登録）', 'B航空', '', 'domestic', 'shipment', 1, 5000, 1000, 'JPY'],
    ];
    for (let i = 0; i < rows.length; i++) {
      if (i > 0) { await p.evaluate(() => window.addRow()); await p.waitForTimeout(80); }
      const f = n => row(p, i).locator(`[data-field="${n}"]`);
      const r = rows[i];
      await f('nm').fill(r[0]); await f('sv').fill(r[1]); await f('pt').fill(r[2]);
      await f('cat').selectOption(r[3], { force: true }).catch(() => {});
      await f('un').fill(r[4]); await f('pq').fill(String(r[5]));
      await f('pc').selectOption(r[8], { force: true }).catch(() => {}); await f('bc').selectOption(r[8], { force: true }).catch(() => {});
      await f('pp').fill(String(r[6])); await f('mk').fill(String(r[7])); await f('mk').blur();
    }
    // MIN の行：売値の最低料金 28（100kg × 0.15 = 15 → 最低料金 28 が適用される）
    const minId = await row(p, 3).evaluate(e => e.id.replace('row-', ''));
    await p.evaluate(id => window.toggleMinMode(id), minId);
    await p.fill('#bpmin-' + minId, '28'); await p.dispatchEvent('#bpmin-' + minId, 'input');
    await p.fill('#ppmin-' + minId, '12'); await p.dispatchEvent('#ppmin-' + minId, 'input');
    await p.waitForTimeout(800);
    await p.keyboard.press('Escape');
    await p.mouse.click(5, 5);
    await p.evaluate(() => document.getElementById('section-table').scrollIntoView()); await p.waitForTimeout(400);
    await p.locator('#section-table').screenshot({ path: path.join(OUT, 'n1-table' + SUF + '.png') });
    // ミニマムの入力欄（Industry は「その他 ▾」の中。現行は行の中）
    if (THEME) {
      await row(p, 3).locator('.row-detail-btn').click(); await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(OUT, 'n2-min-panel' + SUF + '.png'), clip: await p.evaluate(() => { const r = document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[3].getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 10), width: 1000, height: 440 }; }) });
      await p.keyboard.press('Escape');
    } else {
      await row(p, 3).locator('td.price-cell').hover(); await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(OUT, 'n2-min-panel' + SUF + '.png'), clip: await p.evaluate(() => { const r = document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[3].getBoundingClientRect(); return { x: 300, y: Math.max(0, r.top - 10), width: 700, height: 260 }; }) });
    }
    // 用語集
    const gl = p.locator('button', { hasText: '用語の説明' }).first();
    if (await gl.count()) { await gl.click(); await p.waitForTimeout(600); await p.screenshot({ path: path.join(OUT, 'n3-glossary' + SUF + '.png') }); }
    console.log('table errors', JSON.stringify(errs));
    await ctx.close();
  }

  // ===== マスター管理（管理者：承認待ちの申請＋このブラウザにだけあるデータの移行の案内）=====
  const reqs = [
    { id: 'q1', field: 'nm', value: 'AMS（Min.あり）', requested_by: 'member1@example.com', status: 'pending', created_at: '2026-10-19T09:10:00Z' },
    { id: 'q2', field: 'carrier', value: 'Evergreen', requested_by: 'member2@example.com', status: 'pending', created_at: '2026-10-19T08:30:00Z' },
    { id: 'q3', field: 'sv', value: 'B航空', requested_by: 's@example.com', status: 'approved', decided_by: 'admin@example.com', decided_at: '2026-10-18T10:00:00Z', created_at: '2026-10-18T09:00:00Z' },
    { id: 'q4', field: 'port', value: 'Qingdao', requested_by: 's@example.com', status: 'rejected', decided_by: 'admin@example.com', decided_at: '2026-10-17T10:00:00Z', created_at: '2026-10-17T09:00:00Z' },
  ];
  for (const [name, role, noLegacy] of [['n4-master-admin', 'admin', false], ['n5-master-member', 'member', true]]) {
    const { ctx, p, errs } = await open(true, { approval: true, role, requests: reqs, theme: THEME, noLegacy });
    await p.addStyleTag({ content: css });
    await p.evaluate(async () => { document.querySelector('.cat-btn[aria-controls="tab-master"]')?.click(); await window.initMasterTab(); });
    await p.waitForTimeout(1200);
    await p.locator('#tab-master').screenshot({ path: path.join(OUT, name + SUF + '.png') });
    if (role === 'admin') {   // 取り消しにくい操作の確認（却下）と「⋯」メニュー
      await p.evaluate(() => { window.scrollTo(0, 0); });
      await p.click('#statsPane-master tr[data-mvalue="テスト運送"] .master-ops-more').catch(() => {});
      await p.waitForTimeout(200);
      await p.screenshot({ path: path.join(OUT, 'n7-ops-menu' + SUF + '.png'), clip: { x: 0, y: 0, width: 1368, height: 900 } });
      await p.keyboard.press('Escape');
      await p.evaluate(() => { statsRejectRequest('q1'); });
      await p.waitForTimeout(400);
      await p.screenshot({ path: path.join(OUT, 'n8-confirm' + SUF + '.png') });
    }
    console.log(name, 'errors', JSON.stringify(errs));
    await ctx.close();
  }

  // ===== スマホ幅（390px）の見積入力画面の上段 =====
  {
    const { ctx, p, errs } = await open(true, { approval: true, role: 'admin', theme: THEME, noLegacy: true, w: 390, h: 844 });
    await p.addStyleTag({ content: css });
    await p.screenshot({ path: path.join(OUT, 'n6-mobile' + SUF + '.png') });
    console.log('mobile errors', JSON.stringify(errs));
    await ctx.close();
  }
  await b.close(); srv.close();
})();
