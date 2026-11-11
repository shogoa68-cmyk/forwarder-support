// マスターの変更（別名の追加・外す・マスター名の変更・お客様の詳細の保存）が、見積入力画面の印・詳細ボタン・候補・担当者の候補へ、その場で反映される。
// 偽の Supabase（メモリ上の表）を使う。実サーバーには接続しない。
//   node scripts/design-tests/master-refresh-test.js           （THEME=1 で Industry）
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

  const info = p => p.evaluate(() => {
    const b = document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual]) .sv-detail-btn');
    const h = document.querySelector('#tableBody tr.subcon-group-header'); const c = h && h.querySelector('.sv-master-chip');
    return { canon: b && b.dataset.canon, shown: !!b && !b.hidden, chipShown: !!c && !c.hidden, opts: [...document.querySelectorAll('#svSuggestions option')].map(o => o.value) };
  });
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, approval: false, role: 'admin' });
    await setSv(p, 'テスト運送');
    let i = await info(p);
    ok('登録済みのサブコン：詳細ボタンが出る', i.shown && i.canon === 'テスト運送' && !i.chipShown, i);
    await p.evaluate(async () => { await window.synRenameCanonical('sv', 'テスト運送', 'テスト物流'); });
    await p.waitForTimeout(400);
    i = await info(p);
    ok('マスター名を変えると、詳細ボタンの代表名・入力候補がその場で新しい名前になる', i.canon === 'テスト物流' && i.opts.includes('テスト物流') && !i.opts.includes('テスト運送'), i);
    await p.evaluate(async () => { await window.synAddAlias('sv', 'ABC Line', 'テスト物流'); });
    await setSv(p, 'ABC Line');
    i = await info(p);
    ok('別名で入力すると、代表名の詳細として出る（未登録の印は出ない）', i.shown && i.canon === 'テスト物流' && !i.chipShown, i);
    await p.evaluate(async () => { await window.synRemoveAlias('sv', 'ABC Line', 'テスト物流'); });
    await p.waitForTimeout(400);
    i = await info(p);
    ok('別名を外すと、その場で「サブコン未登録」の印が出て詳細ボタンは消える', !i.shown && i.chipShown, i);
    ok('JS エラーなし（サブコン）', errs.length === 0, errs);
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, approval: false, role: 'admin' });
    const ci = () => p.evaluate(() => ({ btn: !document.getElementById('qfCustomerDetailBtn').hidden, persons: [...document.querySelectorAll('#qfPersonSuggestions option')].map(o => o.value), nm: !document.querySelector('#tableBody tr[id^="row-"]:not([data-type]) .master-detail-jump-btn').hidden }));
    await p.evaluate(() => { const el = document.getElementById('qf-customer'); el.value = '山田商事'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    let c = await ci();
    ok('未登録のお客様：詳細ボタンも担当者候補も出ない', !c.btn && !c.persons.length, c);
    await p.evaluate(async () => { await window.mdSave('customer', '山田商事', { contacts: [{ name: '山田太郎' }] }); await window.statsEnsureMaster('customer', '山田商事'); window.arRefreshDatalist(); });
    c = await ci();
    ok('お客様の詳細を保存すると、入力済みのお客様名に対して詳細ボタン・担当者の候補がその場で出る', c.btn && c.persons.join() === '山田太郎', c);
    await p.evaluate(async () => { await window.mdSave('customer', '山田商事', { contacts: [{ name: '山田太郎' }, { name: '鈴木花子' }] }); window.arRefreshDatalist(); });
    c = await ci();
    ok('担当者を足すと、候補にその場で増える', c.persons.join() === '山田太郎,鈴木花子', c);
    await p.evaluate(() => { const el = document.querySelector('#tableBody tr[id^="row-"]:not([data-type]) [data-field="nm"]'); el.value = '新品名'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.evaluate(async () => { await window.mdSave('nm', '新品名', { defaultUnit: 'B/L' }); window.arRefreshDatalist(); });
    c = await ci();
    ok('品名の詳細を保存すると、行の詳細ボタンがその場で出る', c.nm, c);
    ok('JS エラーなし（お客様）', errs.length === 0, errs);
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, approval: false, role: 'admin' });
    const r = await p.evaluate(async () => {
      await window.statsEnsureMaster('customer', '同業A'); await window.statsEnsureMaster('customer', '荷主B');
      await window.mdSave('customer', '同業A', { dealType: window.MD_DEAL_FWD });
      await window.mdSave('customer', '荷主B', { via: '同業A' });
      const before = window.mdViaChildren('同業A').join();
      await window.synRenameCanonical('customer', '同業A', '同業A改');
      return { before, after: window.mdViaChildren('同業A改').join(), chain: window.mdViaChain('荷主B'), viaOf: window.mdViaOf('荷主B') };
    });
    ok('同業者のマスター名を変えても、先のお客様は新しい名前の下に残る', r.before === '荷主B' && r.after === '荷主B' && r.chain.join() === '同業A改' && r.viaOf === '同業A改', r);
    ok('JS エラーなし（同業者の名前変更）', errs.length === 0, errs);
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, approval: false, role: 'admin' });
    const nmSel = '#tableBody tr[id^="row-"]:not([data-type]) [data-field="nm"]';
    const unreg = () => p.evaluate(s => document.querySelector(s).classList.contains('name-unregistered'), nmSel);
    await p.evaluate(s => { const el = document.querySelector(s); el.scrollIntoView({ block: 'center' }); el.value = '新しい品名X'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, nmSel);
    await p.waitForTimeout(300);
    ok('マスターに無い品名には「未登録」の点線が付く', await unreg(), null);
    await p.evaluate(async () => { await window.statsEnsureMaster('nm', '新しい品名X'); window.arRefreshDatalist(); });
    ok('マスターに登録すると、その場で点線が消える', !(await unreg()), null);
    ok('JS エラーなし（未登録の点線）', errs.length === 0, errs);
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(out.join('\n'));
  process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
