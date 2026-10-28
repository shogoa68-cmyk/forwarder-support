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
  // ===== サブコン別明細の見出し：登録済みなら「詳細」、種別がキャリアなら「BOOKMARK」 =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, approval: true, role: 'member' });
    const hdr = () => p.evaluate(() => { const h = document.querySelector('#tableBody tr.subcon-group-header'); const v = s => { const e = h && h.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null; }; return { exists: !!h, det: v('.sv-hdr-detail'), bm: v('.sv-hdr-bm'), detCanon: h && h.querySelector('.sv-hdr-detail').dataset.canon }; });
    await setSv(p, 'テスト運送');
    let h = await hdr();
    ok('マスター登録済み（運送業者）のサブコン見出しに「詳細」が出て、「BOOKMARK」は出ない', h.det && !h.bm && h.detCanon === 'テスト運送', h);
    await p.evaluate(() => document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-detail').click()); await p.waitForTimeout(500);
    const dp = await p.evaluate(() => ({ hidden: document.getElementById('customerDetailOverlay').hidden, title: document.getElementById('cdTitle').textContent, body: document.getElementById('cdBody').textContent }));
    ok('「詳細」を押すと、マスターの詳細（サブコン種別・添付）が開く', !dp.hidden && /テスト運送/.test(dp.title) && /サブコン種別/.test(dp.body) && /運送業者/.test(dp.body) && /添付/.test(dp.body), dp);
    await p.evaluate(() => qfCloseCustomerDetail());
    await p.evaluate(async () => { await window.synLoadCloud(); window.arRefreshDatalist(); });
    await setSv(p, 'ABCキャリア');
    h = await hdr();
    ok('種別が FCL／LCL CARRIER のサブコンには「詳細」と「BOOKMARK」の両方が出る', h.det && h.bm, h);
    await p.evaluate(() => document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-bm').click()); await p.waitForTimeout(700);
    const bp = await p.evaluate(() => { const e = document.querySelector('.sv-bm-pop'); return e ? { text: e.textContent, chips: [...e.querySelectorAll('.sv-bm-chip')].map(c => c.textContent.trim()), links: [...e.querySelectorAll('a.sv-bm-chip')].map(a => a.href), add: !!e.querySelector('.sv-bm-pop-add'), inView: e.getBoundingClientRect().right <= innerWidth && e.getBoundingClientRect().bottom <= innerHeight } : null; });
    ok('「BOOKMARK」を押すと、そのキャリアのリンクが出る（別名で登録したものも・他社のものは出ない）', bp && bp.chips.length === 3 && bp.chips.some(c => /公式サイト/.test(c)) && bp.chips.some(c => /運賃表/.test(c)) && bp.chips.some(c => /別名側/.test(c)) && !bp.chips.some(c => /他社/.test(c)), bp);
    if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
    ok('リンクは新しいタブで開く・追加ボタンがあり・画面内に収まる', bp && bp.links.every(l => /^https:/.test(l)) && bp.add && bp.inView, bp);
    await p.evaluate(() => bmHideForCarrier());
    ok('閉じると消える', await p.evaluate(() => !document.querySelector('.sv-bm-pop')), null);
    await setSv(p, '未登録の運送会社');
    h = await hdr();
    ok('未登録のサブコンには「詳細」も「BOOKMARK」も出ない', h.exists && !h.det && !h.bm, h);
    await setSv(p, 'ABC Line');
    h = await hdr();
    ok('別名（ABC Line）で入力しても、代表名（ABCキャリア）の「詳細」「BOOKMARK」が出る', h.det && h.bm && h.detCanon === 'ABCキャリア', h);
    ok('JS エラーなし（見出しの詳細・BOOKMARK）', errs.length === 0, errs);
    await ctx.close();
  }
  // ===== メール取込の画面：サブコン欄（一括設定・各行）も、マスターのサブコンを候補に出す =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, approval: true, role: 'member' });
    await p.evaluate(() => { openEmailImport(); document.getElementById('eiText').value = 'OCEANFREIGHT 1 20FT × 200 USD ＝ 200 USD\nDOCFEE 1 BL × 6,100 JPY ＝ 6,100 JPY'; eiParse(); });
    await p.waitForTimeout(600);
    const r = await p.evaluate(() => {
      const opts = inp => { const l = inp && inp.list; return l ? [...l.options].map(o => o.value) : null; };
      const bulk = document.getElementById('eiBulkSv');
      const rows = [...document.querySelectorAll('#eiReviewWrap .ei-sv')];
      return { bulk: opts(bulk), rows: rows.length, row0: opts(rows[0]), listId: bulk && bulk.getAttribute('list') };
    });
    ok('「サブコン一括設定」の候補に、マスターのサブコンが出る', r.bulk && r.bulk.includes('テスト運送') && r.bulk.includes('ABCキャリア'), r);
    ok('各行のサブコン欄にも、同じ候補（マスターのサブコン）が出る', r.rows === 2 && r.row0 && r.row0.includes('テスト運送') && r.row0.includes('ABCキャリア'), r);
    ok('マスターに無い名前は候補に出ない（候補はマスターのサブコンだけ）', r.bulk && !r.bulk.includes('他社キャリア'), r);
    ok('JS エラーなし（メール取込の候補）', errs.length === 0, errs);
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
