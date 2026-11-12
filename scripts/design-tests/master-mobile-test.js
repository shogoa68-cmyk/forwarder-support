// マスター管理のスマホ版（案A「今日やること」）の確認。偽の Supabase を使う。THEME=1 で Industry。
//   node scripts/design-tests/master-mobile-test.js
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
    unitAlias_v1: [{ id: 'u1', canonical: 'CONTAINER', aliases: ['CNTR'] }],
    masterDetails_v1: [{ field: 'nm', value: 'ローカル品名', details: { defaultUnit: 'B/L' } }],
    aliasRules_v1: [{ id: 'l2', field: 'port', from_value: 'YKH', to_value: 'Yokohama' }],
    abbrevPairs_v1: [{ id: 'l3', field: 'carrier', abbrev: 'NTL', full: 'NAIGAI TRANS LINES' }],
    statsExclusions_v1: [{ field: 'nm', value: 'ローカル除外', created_at: '2026-01-01T00:00:00Z' }],
  };

  // opts.approval：申請テーブル（master_requests）を用意する＝承認制、opts.role：get_my_role() の結果
  async function open(loggedIn, opts = {}) {
    const ctx = await b.newContext({ viewport: { width: +(process.env.W || 390), height: +(process.env.H || 844) }, locale: 'ja-JP' });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    if (process.env.QUIET) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ quiet: true })); } catch (e) {} });
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
            if (opts.badKey && (st.op === 'upsert' || st.op === 'insert') && [].concat(st.payload).some(o => [o.canonical, o.value, o.from_value].includes(opts.badKey) || (o.aliases || []).includes(opts.badKey))) return Promise.resolve({ data: null, error: { message: 'violates check constraint' } }).then(res, rej);
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
    // 詳細ポップアップはタブ形式：隠れているタブの中の入力欄を操作するときは、先にそのタブを開く
    for (const m of ['fill', 'click', 'selectOption']) {
      const orig = p[m].bind(p);
      p[m] = async (sel, ...r) => {
        if (typeof sel === 'string' && sel.includes('#md')) {
          await p.evaluate(s => { const e = document.querySelector(s); const pn = e && e.closest('.mt-panel'); if (pn && pn.hidden) { const t = document.querySelector('#mdDetailModal .mt-tab[data-mt="' + pn.dataset.mt + '"]'); t && t.click(); } }, sel).catch(() => {});
        }
        return orig(sel, ...r);
      };
    }
    return { ctx, p, errs, dlg };
  }
  const vis = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; }, sel);
  for (const role of ['admin', 'member']) {
    const { ctx, p, errs } = await open(true, { approval: true, role });
    const L = '[' + role + '] ';
    await p.evaluate(() => { window.__db.master_requests.push({ id: 'q1', field: 'nm', value: '承認待ち費用', requested_by: 'm@example.com', status: 'pending', created_at: new Date().toISOString() }, { id: 'q2', field: 'customer', value: '申請お客様', requested_by: 'm@example.com', status: 'pending', created_at: new Date().toISOString() }); window.__db.master_requests.forEach(r => { if (window._myRole === 'member') r.requested_by = 's@example.com'; }); });
    await p.evaluate(async () => { await statsLoadMasterCache(); switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); });
    await p.waitForTimeout(1500);
    ok(L + '今日やることが出る', await vis(p, '#mmHome'), 1);
    ok(L + '小タブ・一覧は隠れる', !(await vis(p, '#tab-master .stats-tabs')) && !(await vis(p, '#statsPane-master')));
    const home = await p.evaluate(() => document.getElementById('mmHome').innerText.replace(/\s+/g, ' '));
    if (role === 'admin') ok(L + '承認待ち 2 件のカード', /承認待ち 2 件/.test(home), home); else ok(L + 'メンバーは「申請中 N件」の 1 行', /申請中 \d+ 件/.test(home) && !/承認待ち \d+ 件/.test(home), home);
    ok(L + 'ゆらぎ・マスター一覧のカード', /ゆらぎチェック/.test(home) && /マスター一覧/.test(home), home);
    ok(L + '横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'mm-home-' + role + '.png') });
    if (role === 'admin') {
      await p.click('#mmHome [data-go="req"]'); await p.waitForTimeout(500);
      ok(L + '承認カードが 2 枚', (await p.$$('#mmWork .mm-card')).length === 2);
      ok(L + '承認・却下ボタンは 44px 以上', await p.$$eval('#mmWork .mm-btn', els => els.every(e => e.getBoundingClientRect().height >= 44)));
      if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'mm-work.png') });
      await p.click('[data-rej="q2"]'); await p.waitForTimeout(300);
      ok(L + '却下：理由を選ぶまで実行できない', await p.evaluate(() => document.querySelector('#mmSheet [data-go]').disabled));
      await p.click('#mmSheet [data-r="その他"]'); ok(L + 'その他は文字が要る', await p.evaluate(() => document.querySelector('#mmSheet [data-go]').disabled));
      await p.fill('#mmSheet .mm-other', '対象外'); ok(L + '入力で押せる', await p.evaluate(() => !document.querySelector('#mmSheet [data-go]').disabled));
      if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'mm-reject.png') });
      await p.click('#mmSheet [data-go]'); await p.waitForTimeout(700);
      ok(L + '却下できた', await p.evaluate(() => window.__db.master_requests.find(x => x.id === 'q2').status === 'rejected'));
      await p.click('[data-ok="q1"]'); await p.waitForTimeout(700);
      ok(L + '1 タップで承認・トースト', await p.evaluate(() => window.__db.master_requests.find(x => x.id === 'q1').status === 'approved' && !!document.querySelector('.mm-toast')));
      await p.click('[data-wt="drift"]'); await p.waitForTimeout(600);
      ok(L + 'ゆらぎ：既存カードが出る', await vis(p, '#driftCard') && !(await vis(p, '#statsPane-master .master-table')));
      if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'mm-drift.png') });
    }
    await p.evaluate(() => mmShow('home')); await p.click('#mmHome [data-go="list"]'); await p.waitForTimeout(600);
    ok(L + '一覧：検索・チップが見え、KPI・ゆらぎは隠れる', await vis(p, '#masterSearch') && await vis(p, '.master-filter-chips') && !(await vis(p, '#driftCard')) && !(await vis(p, '.master-kpis')));
    await p.click('.master-filter-chip:has-text("サブコン")'); await p.waitForTimeout(400);
    if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'mm-list-' + role + '.png'), fullPage: true });
    const tr = await p.$('#statsPane-master table.master-grid > tbody > tr:not(.master-tag-group-row)');
    ok(L + 'カードがある', !!tr);
    if (tr) {
      ok(L + 'カードのボタンは「詳細」と「⋯」だけ', await p.evaluate(() => { const bs = [...document.querySelectorAll('#statsPane-master table.master-grid > tbody > tr:not(.master-tag-group-row)')[0].querySelectorAll('td.ops button')].filter(b => getComputedStyle(b).display !== 'none'); return bs.length <= 2; }));
      const more = await p.$('#statsPane-master .master-ops-more');
      if (more) { await more.click(); await p.waitForTimeout(300); ok(L + '「⋯」は下からのシート', await vis(p, '#mmSheet .mm-menu')); if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'mm-more-' + role + '.png') }); await p.click('#mmSheet [data-x]'); }
      const det = await p.$('#statsPane-master table.master-grid > tbody > tr:not(.master-tag-group-row) td.ops button:not(.master-ops-more)');
      if (det) { await det.click(); await p.waitForTimeout(800); const full = await p.evaluate(() => { const m = document.querySelector('#mdDetailModal .md-modal'); if (!m) return null; const r = m.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), innerWidth, innerHeight]; }); ok(L + '詳細は全画面', !!full && full[0] === full[2] && full[1] === full[3], full); ok(L + '保存バーが見える', await vis(p, '#mdDetailModal .mt-foot')); if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'mm-detail-' + role + '.png') }); }
    }
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  // PC は変わらない
  { const { ctx, p, errs } = await open(true, { approval: true, role: 'admin' });
    await p.setViewportSize({ width: 1400, height: 900 }); await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1200);
    await p.evaluate(async () => { await statsLoadMasterCache(); switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    ok('[PC] 今日やることは出ない・従来の画面', !(await vis(p, '#mmHome')) && !(await vis(p, '#mmBar')) && await vis(p, '#tab-master .stats-tabs') && await vis(p, '#masterSearch'));
    await ctx.close(); }
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
