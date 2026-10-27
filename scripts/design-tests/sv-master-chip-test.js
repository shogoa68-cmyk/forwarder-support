// 行のサブコン欄：マスターに無い名前は「サブコン未登録」の印を出し、そこから登録（承認制のメンバーは申請）できる。
// 偽の Supabase（メモリ上の表）を使う。実サーバーには接続しない。
//   node scripts/design-tests/sv-master-chip-test.js
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
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
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
  // 取り消しにくい操作の確認画面（uiConfirm）：開くのを待ち、本文を返して、指定のボタンを押す（which：'ok'＝実行／'cancel'＝やめる）
  const confirmDlg = async (p, which) => {
    await p.waitForSelector('.confirm-dialog', { timeout: 5000 });
    const text = await p.evaluate(() => document.querySelector('.confirm-dialog').textContent);
    const focused = await p.evaluate(() => document.activeElement && document.activeElement.className);
    await p.click(which === 'cancel' ? '.confirm-dialog .btn-cancel' : '.confirm-dialog .confirm-actions button:not(.btn-cancel)');
    await p.waitForTimeout(150);
    return { text, focused };
  };
  const rowId = p => p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').id.replace('row-', ''));


  const setSv = async (p, v) => {
    await p.evaluate(v => { const el = document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual]) [data-field="sv"]'); el.scrollIntoView({ block: 'center' }); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    await p.waitForTimeout(500);
  };
  const chip = p => p.evaluate(() => { const c = document.querySelector('#tableBody tr.subcon-group-header .sv-master-chip'); const sv = document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual]) [data-field="sv"]'); return { shown: !!c && !c.hidden && c.offsetParent !== null, text: c ? c.textContent : '', cls: c ? c.className : '', unreg: sv.classList.contains('name-unregistered'), rowChips: document.querySelectorAll('#tableBody tr[id^="row-"] .sv-master-chip').length, visibleChips: [...document.querySelectorAll('#tableBody .sv-master-chip')].filter(x => !x.hidden && x.offsetParent !== null).length }; });
  const bubble = p => p.evaluate(() => { const b = document.querySelector('.syn-suggest'); return b ? { text: b.textContent, apply: (b.querySelector('.syn-suggest-apply') || {}).textContent } : null; });
  const openDetail = async p => { const vis = await p.locator('#tableBody tr[id^="row-"]:not([data-type]) .sv-master-chip').first().isVisible(); return vis; };

  // ===== マスター登録済みのサブコンは、明細行の「サブコン詳細」から確認できる =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, approval: true, role: 'member' });
    const detailBtn = () => p.evaluate(() => { const b = document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual]) .sv-detail-btn'); return { exists: !!b, shown: !!b && !b.hidden && b.offsetParent !== null, canon: b ? b.dataset.canon : '' }; });
    await setSv(p, 'テスト運送');
    let d = await detailBtn();
    ok('マスター登録済みのサブコンの明細行に「サブコン詳細」が出る', d.exists && d.shown && d.canon === 'テスト運送', d);
    await p.evaluate(() => { window.__db.synonym_groups.push({ id: 'g9', field: 'sv', canonical: 'テスト運送', aliases: ['テストウンソウ'] }); });
    await p.evaluate(async () => { await window.synLoadCloud(); window.arRefreshDatalist(); });
    await p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual]) .sv-detail-btn').scrollIntoView({ block: 'center' }));
    await p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual]) .sv-detail-btn').click()); await p.waitForTimeout(500);
    const pop = await p.evaluate(() => { const e = document.querySelector('.stats-usage-pop'); return e ? { text: e.textContent, jump: !!e.querySelector('.stats-usage-pop-jump') } : null; });
    ok('押すと、登録状態・別名・マスター管理へのジャンプが出る', pop && /サブコンマスター：登録済み/.test(pop.text) && /テストウンソウ/.test(pop.text) && pop.jump, pop);
    await p.evaluate(() => window.statsHideUsage());
    await setSv(p, 'テストウンソウ');
    d = await detailBtn();
    ok('別名で入力しても、代表名（テスト運送）の詳細として出る', d.shown && d.canon === 'テスト運送', d);
    await setSv(p, '未登録の運送会社');
    d = await detailBtn();
    ok('未登録のサブコンには「サブコン詳細」は出ない', d.exists && !d.shown, d);
    await setSv(p, '');
    ok('サブコンが空なら出ない', !(await detailBtn()).shown, null);
    ok('JS エラーなし（サブコン詳細）', errs.length === 0, errs);
    await ctx.close();
  }
  // ===== 承認制のメンバー =====
  {
    const { ctx, p, errs, dlg } = await open(true, { legacy: {}, approval: true, role: 'member' });
    await p.evaluate(() => window.addRow && 0);
    await setSv(p, 'テスト運送');
    let c = await chip(p);
    ok('マスター登録済みのサブコンには印が出ない', !c.shown && c.rowChips === 0, c);
    await setSv(p, '未登録運送');
    c = await chip(p);
    ok('未登録のサブコンに「サブコン未登録」の印が、サブコンの見出しに出る（行の欄には付けない）', c.shown && /未登録/.test(c.text) && c.cls.includes('is-none') && !c.unreg && c.rowChips === 0, c);
    // 同じ未登録サブコンの行が複数あっても、印はサブコン見出しに 1 つだけ。別の未登録サブコンのグループにはそれぞれ 1 つ
    const setSvAt = async (i, v) => { await p.evaluate(([i, v]) => { const el = document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual]) [data-field="sv"]')[i]; el.scrollIntoView({ block: 'center' }); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [i, v]); await p.waitForTimeout(500); };
    await p.evaluate(() => { window.addRow(); window.addRow(); }); await p.waitForTimeout(300);
    await setSvAt(1, '未登録運送');
    ok('同じ未登録サブコンの行が 2 つあっても、印は 1 つだけ（サブコン見出し）', (await chip(p)).visibleChips === 1 && (await chip(p)).rowChips === 0, await chip(p));
    await setSvAt(2, '別の未登録運送');
    ok('別の未登録サブコンのグループには、それぞれ印が 1 つ（合計 2 つ）', (await chip(p)).visibleChips === 2, await chip(p));
    await setSvAt(2, 'テスト運送');
    ok('登録済みのサブコンのグループには出ない（1 つに戻る）', (await chip(p)).visibleChips === 1, await chip(p));
    await p.evaluate(() => document.querySelector('.syn-suggest-dismiss')?.click());
    await p.evaluate(() => document.querySelector('#tableBody tr.subcon-group-header .sv-master-chip').click()); await p.waitForTimeout(400);
    const b = await bubble(p);
    ok('印を押すと、登録の確認が出る（承認制は「登録を申請」）', b && /未登録/.test(b.text) && b.apply === '登録を申請', b);
    await p.click('.syn-suggest-apply'); await p.waitForTimeout(1200);
    const reqs = await p.evaluate(() => window.__db.master_requests.map(r => ({ f: r.field, v: r.value, s: r.status })));
    ok('登録を申請すると、申請（pending）が作られる（マスターには入らない）', reqs.length === 1 && reqs[0].f === 'sv' && reqs[0].v === '未登録運送' && reqs[0].s === 'pending', reqs);
    c = await chip(p);
    ok('申請後は「サブコン申請中」の印に変わる', c.shown && /申請中/.test(c.text) && c.cls.includes('is-pending'), c);
    await p.evaluate(() => document.querySelector('#tableBody tr.subcon-group-header .sv-master-chip').click()); await p.waitForTimeout(300);
    ok('申請中の印を押しても、二重に申請されない', (await p.evaluate(() => window.__db.master_requests.length)) === 1 && !(await bubble(p)), null);
    await setSv(p, '');
    ok('サブコンを空にすると印は消える', !(await chip(p)).shown, null);
    ok('JS エラーなし（メンバー）', errs.length === 0, errs);
    await ctx.close();
  }
  // ===== 管理者：直接登録 =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, approval: true, role: 'admin' });
    await setSv(p, '管理者が足す運送');
    let c = await chip(p);
    ok('（管理者）未登録の印が出る', c.shown, c);
    await p.evaluate(() => document.querySelector('.syn-suggest-dismiss')?.click());
    await p.evaluate(() => document.querySelector('#tableBody tr.subcon-group-header .sv-master-chip').click()); await p.waitForTimeout(400);
    const b = await bubble(p);
    ok('（管理者）ボタンは「マスター登録」', b && b.apply === 'マスター登録', b);
    await p.click('.syn-suggest-apply'); await p.waitForTimeout(1200);
    const votes = await p.evaluate(() => window.__db.master_votes.filter(v => v.field === 'sv').map(v => v.value));
    ok('（管理者）マスターに登録され、印が消える', votes.includes('管理者が足す運送') && !(await chip(p)).shown, votes);
    ok('JS エラーなし（管理者）', errs.length === 0, errs);
    await ctx.close();
  }
  // ===== 承認制ではない（従来）：メンバーも直接登録 =====
  {
    const { ctx, p } = await open(true, { legacy: {}, role: 'member' });
    await setSv(p, '従来運送');
    const c = await chip(p);
    await p.evaluate(() => document.querySelector('.syn-suggest-dismiss')?.click());
    await p.evaluate(() => document.querySelector('#tableBody tr.subcon-group-header .sv-master-chip').click()); await p.waitForTimeout(400);
    const b = await bubble(p);
    ok('（申請テーブルなし）未登録の印が出て、ボタンは「マスター登録」', c.shown && b && b.apply === 'マスター登録', { c, b });
    await ctx.close();
  }
  // ===== 別名で入力：代表名が登録済みなら未登録扱いにしない／ログインなしは出さない =====
  {
    const { ctx, p } = await open(true, { legacy: {}, approval: true, role: 'member' });
    await p.evaluate(() => { window.__db.synonym_groups.push({ id: 'g9', field: 'sv', canonical: 'テスト運送', aliases: ['テストウンソウ'] }); });
    await p.evaluate(async () => { await window.synLoadCloud(); window.arRefreshDatalist(); });
    await setSv(p, 'テストウンソウ');
    ok('別名で入力しても（代表名が登録済みなら）「未登録」の印は出ない', !(await chip(p)).shown, await chip(p));
    await ctx.close();
    const un = await open(false, { legacy: {} });
    await setSv(un.p, '誰か運送');
    ok('未ログインでは印を出さない', !(await chip(un.p)).shown, await chip(un.p));
    await un.ctx.close();
  }
  await b.close(); srv.close();
  console.log(out.join('\n'));
})();
