// 旧「ブラウザ保存」の廃止：UI から外れていること、このブラウザに残る旧データをチーム共有へ移せること（元データは控えに残る／破棄もできる）。
// 偽の Supabase（メモリ上の表）を使う。実サーバーには接続しない。
//   node scripts/design-tests/local-migrate-test.js
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
    quote_presets: [{ id: 'q1', name: 'クラウド案件A', status: '下書き中', owner_email: ME, created_by: ME, updated_at: '2026-10-20T00:00:00Z', data: { fields: { 'qf-customer': 'クラウド商事' }, rows: [], _rowFormat: 'v3-mixed-rows' } }],
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


  // ===== 旧「ブラウザ保存」の廃止と、チーム共有への移行 =====
  const mkLocal = (name, cust) => ({ name, ts: new Date().toISOString(), data: { fields: { 'qf-customer': cust, 'qf-person': '担当', 'qf-ref': 'R-' + name, 'cond-mode': '海上', 'qf-status': '下書き中', 'qf-tags-data': '["台湾"]', 'z2Pol': 'TAIPEI', 'z2Pod': 'YOKOHAMA' }, rows: [], _rowFormat: 'v3-mixed-rows' } });
  const confirmClick = async (p, which) => {
    await p.waitForSelector('.confirm-dialog', { timeout: 5000 });
    const text = await p.evaluate(() => document.querySelector('.confirm-dialog').textContent);
    const focus = await p.evaluate(() => document.activeElement && document.activeElement.className);
    await p.click(which === 'cancel' ? '.confirm-dialog .btn-cancel' : '.confirm-dialog .confirm-actions button:not(.btn-cancel)');
    await p.waitForTimeout(200);
    return { text, focus };
  };
  {
    const { ctx, p, errs } = await open(true, { legacy: { quotePresets_v1: [mkLocal('旧案件1', '旧商事'), mkLocal('クラウド案件A', '旧商事2')] } });
    const ui = await p.evaluate(() => ({
      toolbarBtn: [...document.querySelectorAll('#saveToolbar button')].some(b => /ブラウザ保存/.test(b.textContent)),
      browserCol: !!document.getElementById('presetBrowserSection'),
      statsSrc: !!document.getElementById('statsSource'),
      fns: ['savePreset', 'loadPreset', 'deletePreset', 'getPresets'].filter(n => typeof window[n] === 'function'),
    }));
    ok('ツールバー・モーダル・統計からブラウザ保存が無い', !ui.toolbarBtn && !ui.browserCol && !ui.statsSrc, ui);
    ok('旧ブラウザ保存の関数が残っていない', ui.fns.length === 0, ui);
    const note = await p.evaluate(() => { const n = document.getElementById('qpdLocalMigrate'); return { hidden: n.hidden, text: n.textContent }; });
    ok('旧データがあるとき、ダッシュボードに移行の案内が出る（2 件）', !note.hidden && /2案件/.test(note.text), note);
    await p.evaluate(() => { cloudMigrateLocalPresets(); });
    const { text: dlg } = await confirmClick(p, 'ok'); await p.waitForTimeout(1500);
    const after = await p.evaluate(() => ({
      cloud: window.__db.quote_presets.map(r => ({ name: r.name, customer: r.customer, ref: r.ref, pol: r.pol, tags: r.tags, owner: r.owner_email, status: r.status, hasSubcons: Array.isArray(r.subcons) })),
      local: localStorage.getItem('quotePresets_v1'), backup: JSON.parse(localStorage.getItem('quotePresets_v1_migrated') || '[]').length,
      noteHidden: document.getElementById('qpdLocalMigrate').hidden,
    }));
    ok('確認画面に件数と「上書きしない」旨が出る', /2 件/.test(dlg) && /上書きはしません/.test(dlg), dlg);
    const names = after.cloud.map(r => r.name).sort();
    ok('チーム共有に 3 件（既存 1＋移行 2）。同名は別の案件として保存', after.cloud.length === 3 && names.includes('旧案件1') && names.includes('クラウド案件A（ブラウザ保存から移行）') && names.includes('クラウド案件A'), names);
    const m = after.cloud.find(r => r.name === '旧案件1') || {};
    ok('顧客・REF・航路・タグ・状態・作成者が列に昇格している', m.customer === '旧商事' && m.ref === 'R-旧案件1' && m.pol === 'TAIPEI' && JSON.stringify(m.tags) === '["台湾"]' && m.status === '下書き中' && m.owner === ME && m.hasSubcons, m);
    ok('移したあと、元の置き場は空・控えが 2 件残る・案内が消える', after.local === null && after.backup === 2 && after.noteHidden, after);
    ok('JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  // 破棄（移さない）
  {
    const { ctx, p, errs } = await open(true, { legacy: { quotePresets_v1: [mkLocal('破棄する案件', '破棄商事')] } });
    await p.evaluate(() => { cloudDiscardLocalPresets(); });
    const c1 = await confirmClick(p, 'cancel');
    ok('破棄：やめるを押すと残る（初期の焦点は「やめる」・取り消せない旨）', (await p.evaluate(() => localStorage.getItem('quotePresets_v1'))) !== null && /元に戻せません/.test(c1.text) && /btn-cancel/.test(c1.focus), c1);
    await p.evaluate(() => { cloudDiscardLocalPresets(); });
    await confirmClick(p, 'ok');
    ok('破棄：実行すると消え、クラウドには何も作られない', (await p.evaluate(() => localStorage.getItem('quotePresets_v1'))) === null && (await p.evaluate(() => window.__db.quote_presets.length)) === 1, null);
    ok('JS エラーなし（破棄）', errs.length === 0, errs);
    await ctx.close();
  }
  // 旧データが無いときは案内を出さない
  {
    const { ctx, p } = await open(true, { legacy: {} });
    ok('旧データが無ければ案内は出ない', await p.evaluate(() => document.getElementById('qpdLocalMigrate').hidden), null);
    await ctx.close();
  }
  // ===== 見積の比較：チーム共有の案件を比べる =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {} });
    await p.evaluate(() => {
      const mk = (id, name, bp) => ({ id, name, status: '下書き中', owner_email: 's@example.com', created_by: 's@example.com', updated_at: '2026-10-2' + id.slice(1) + 'T00:00:00Z',
        data: { fields: {}, rows: [{ _type: 'data', cells: [false, 'ocean', 'A海運', false, '海上運賃', '1', 'CNTR', '1', 'JPY', 'JPY', '1000', String(bp), '', '0'] }], _rowFormat: 'v3-mixed-rows' } });
      window.__db.quote_presets.push(mk('q2', '比較用B', 2000), mk('q3', '比較用C', 3000));
    });
    await p.evaluate(() => openCompare()); await p.waitForTimeout(900);
    const items = await p.evaluate(() => [...document.querySelectorAll('#cmpPresetList .cmp-chk')].length);
    ok('比較の一覧にチーム共有の案件が出る（3 件）', items === 3, items);
    await p.locator('#cmpPresetList .cmp-chk').nth(1).check(); await p.locator('#cmpPresetList .cmp-chk').nth(2).check();
    await p.evaluate(() => runCompare()); await p.waitForTimeout(500);
    const res = await p.evaluate(() => document.getElementById('cmpResult').textContent);
    ok('2 件を選ぶと比較結果が出る', /売上合計/.test(res), res.slice(0, 80));
    ok('JS エラーなし（比較）', errs.length === 0, errs);
    await ctx.close();
    const un = await open(false, {});
    await un.p.evaluate(() => openCompare()); await un.p.waitForTimeout(300);
    ok('未ログインでは、ログインを促す表示になる', /ログイン/.test(await un.p.evaluate(() => document.getElementById('cmpPresetList').textContent)), null);
    await un.ctx.close();
  }
  await b.close(); srv.close();
  console.log(out.join('\n'));
})();
