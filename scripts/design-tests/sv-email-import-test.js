// サブコン別メール取込：サブコン見出しの「📥 取り込み」→ そのサブコン専用の取込 → 修正を「覚える」→ 次回から自動で直る（チーム共有＝マスター詳細に保存）。
// 偽の Supabase（メモリ上の表）を使う。実サーバーには接続しない。
//   node scripts/design-tests/sv-email-import-test.js           （THEME=1 で Industry・SHOT=パス で「BOOKMARK」を開いた画面を保存）
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
      { field: 'un', value: "40'HQ", voter_email: ME },
    ],
    synonym_groups: [
      { id: 'g1', field: 'carrier', canonical: 'ONE', aliases: ['Ocean Network Express'] },
      { id: 'g2', field: 'nm', canonical: 'THC', aliases: ['Terminal Handling Charge', 'ターミナルハンドリングチャージ'] },
      { id: 'g3', field: 'port', canonical: 'Yokohama', aliases: ['横浜'] },
      { id: 'g4', field: 'sv', canonical: 'ABCキャリア', aliases: ['ABC Line'] },
      { id: 'g5', field: 'un', canonical: "40'HQ", aliases: ['40HQ', '40HC'] },
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
        from: qb, rpc: (name, args) => { (window.__rpc = window.__rpc || []).push({ name, args }); if (name === 'email_unread_record' && opts.unreadMissing) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.email_unread_record(shapes) in the schema cache' } }); return Promise.resolve({ data: name === 'get_my_role' ? (opts.role || 'member') : null, error: null }); }, channel: () => ch, removeChannel() {}, storage: { from: () => ({}) },
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


  // ===== サブコン別メール取込 =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, role: 'member' });
    const first = '#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])';
    const hdrBtn = () => p.evaluate(() => { const b = document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-import'); return { exists: !!b, shown: !!b && !b.hidden && b.offsetParent !== null, canon: b ? b.dataset.canon : '' }; });

    await setSv(p, 'テスト運送');
    let h = await hdrBtn();
    ok('マスター登録済みのサブコンの見出しに「📩 メール取込」が出る', h.exists && h.shown && h.canon === 'テスト運送', h);
    await setSv(p, '未登録の運送会社');
    h = await hdrBtn();
    ok('マスター未登録のサブコンの見出しには出ない', h.exists && !h.shown, h);
    await setSv(p, 'テスト運送');

    // ルールを先に保存（既定の通貨 USD・既定の単位）→ 通貨のない数字も読める
    await p.evaluate(() => { document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-import').click(); window.icChoose('text'); }); await p.waitForTimeout(400);
    const m = await p.evaluate(() => ({ open: document.getElementById('emailImportModal').classList.contains('open'), ctx: document.getElementById('emailImportBox').classList.contains('ei-sv-ctx'), title: document.getElementById('eiTitle').textContent, rules: !document.getElementById('eiSvCtx').hidden, newBtnHidden: getComputedStyle(document.querySelector('.ei-act-new')).display === 'none' }));
    ok('押すとそのサブコン専用の取込ダイアログが開く（タイトルにサブコン名・「新規案件として展開」は出さない）', m.open && m.ctx && /テスト運送/.test(m.title) && m.rules && m.newBtnHidden, m);
    await p.evaluate(() => { document.getElementById('eiRuleCcy').value = 'USD'; window.eiRuleSaveDefaults(); }); await p.waitForTimeout(500);
    const saved = await p.evaluate(() => (window.__db.master_details.find(r => r.field === 'sv' && r.value === 'テスト運送') || {}).details);
    ok('既定の通貨が、マスター詳細（importRules）に保存される（ほかの詳細は消えない）', saved && saved.importRules && saved.importRules.ccy === 'USD' && saved.location === '横浜市' && saved.svTypes && saved.svTypes[0] === '運送業者', saved);

    await p.evaluate(() => { document.getElementById('eiText').value = 'ドキュメント料 50 /B/L\n海上運賃 1200 /20GP\n2026/11/20 までご回答ください'; window.eiParse(); }); await p.waitForTimeout(400);
    let rows = await p.evaluate(() => [...document.querySelectorAll('#eiReviewWrap .ei-table tbody tr')].map(tr => ({ name: tr.querySelector('.ei-name').value, sv: tr.querySelector('.ei-sv').value, ccy: tr.querySelector('.ei-ccy').value, price: tr.querySelector('.ei-price').value, unit: tr.querySelector('.ei-unit').value, flags: tr.querySelector('.ei-flags').textContent })));
    ok('通貨の書かれていない数字も既定の通貨で読め、全行のサブコンが入る（日付は金額にしない）', rows.length === 2 && rows.every(r => r.sv === 'テスト運送' && r.ccy === 'USD') && /通貨は既定/.test(rows[0].flags) && rows[1].price === '1200' && rows[1].unit === '20GP', rows);

    // 直して「覚える」
    await p.evaluate(() => { const tr = document.querySelector('#eiReviewWrap .ei-table tbody tr'); const n = tr.querySelector('.ei-name'); n.value = 'DOC FEE'; const c = tr.querySelector('.ei-cat'); c.value = 'export-local'; window.eiLearnFromCorrections(); }); await p.waitForTimeout(600);
    const learned = await p.evaluate(() => (window.__db.master_details.find(r => r.field === 'sv' && r.value === 'テスト運送') || {}).details.importRules);
    ok('直した行が「呼び名の置き換え」ルールとして保存される（チーム共有）', learned.aliases.length === 1 && learned.aliases[0].from === 'ドキュメント料' && learned.aliases[0].to === 'DOC FEE' && learned.ccy === 'USD', learned);

    // 次回：同じ呼び名が自動で直る
    await p.evaluate(() => { document.getElementById('eiText').value = 'ドキュメント料 50 /B/L'; window.eiParse(); }); await p.waitForTimeout(400);
    rows = await p.evaluate(() => [...document.querySelectorAll('#eiReviewWrap .ei-table tbody tr')].map(tr => ({ name: tr.querySelector('.ei-name').value, cat: tr.querySelector('.ei-cat').value, flags: tr.querySelector('.ei-flags').textContent })));
    ok('次回の取込では、呼び名が自動で直り（DOC FEE・カテゴリも）、「置換」の印が付く', rows.length === 1 && rows[0].name === 'DOC FEE' && rows[0].cat === 'export-local' && /置換/.test(rows[0].flags), rows);

    // 挿入：そのサブコンの明細グループに入る
    const before = await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').length);
    await p.evaluate(() => window.eiInsertRows()); await p.waitForTimeout(700);
    const after = await p.evaluate(() => { const rs = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')]; return { n: rs.length, last: rs.map(r => ({ nm: r.querySelector('[data-field="nm"]').value, sv: r.querySelector('[data-field="sv"]').value })).filter(x => x.nm === 'DOC FEE'), groups: [...document.querySelectorAll('#tableBody tr.subcon-group-header')].map(h => h.dataset.svLabel) }; });
    ok('挿入すると、そのサブコン（テスト運送）の明細として入り、グループは 1 つのまま', after.n === before + 1 && after.last.length === 1 && after.last[0].sv === 'テスト運送' && after.groups.filter(g => g === 'テスト運送').length === 1, after);

    // ルールの削除
    await p.evaluate(() => { document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-import').click(); window.icChoose('text'); }); await p.waitForTimeout(300);
    await p.evaluate(() => window.eiRuleDel(0)); await p.waitForTimeout(500);
    const left = await p.evaluate(() => window.__db.master_details.find(r => r.field === 'sv' && r.value === 'テスト運送').details.importRules.aliases.length);
    ok('ルールを一覧から外せる', left === 0, left);

    // 通常の取込（ヘッダーの入口）は従来どおり：サブコン専用の表示が残らない
    await p.evaluate(() => { window.closeEmailImport(); window.openEmailImport(); }); await p.waitForTimeout(200);
    const plain = await p.evaluate(() => ({ ctx: document.getElementById('emailImportBox').classList.contains('ei-sv-ctx'), box: document.getElementById('eiSvCtx').hidden, title: document.getElementById('eiTitle').textContent }));
    await p.evaluate(() => { document.getElementById('eiText').value = '海上運賃 USD 1,200 /20GP'; window.eiParse(); }); await p.waitForTimeout(300);
    ok('通常のメール取込の説明文には、従来どおり「売値として取り込む」の説明がある', await p.evaluate(() => /売値として取り込む/.test(document.querySelector('#eiReviewWrap .ei-hint').textContent)), null);
    ok('通常のメール取込では、お客様・REF#・有効期限・「単価を売値として取り込む」も従来どおり表示される', await p.evaluate(() => ['#eiF-customer', '#eiF-ref', '#eiF-valid', '#eiSellMode'].every(s => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; })), null);
    ok('通常のメール取込（サブコンを決めない入口）では、一括設定の欄は空のまま', await p.evaluate(() => document.getElementById('eiBulkSv').value === ''), await p.evaluate(() => document.getElementById('eiBulkSv').value));
    ok('通常のメール取込を開き直すと、サブコン専用の表示は残らない', !plain.ctx && plain.box && !/テスト運送/.test(plain.title), plain);
    // サブコン専用の取込を閉じたあと、別の入口（保管した原文の取り込み）を開いても、前のサブコンが持ち越されない
    await p.evaluate(() => { window.closeEmailImport(); window.eiOpenForSubcon('テスト運送'); window.closeEmailImport(); document.getElementById('eiText').value = '海上運賃 USD 1,200 /20GP'; document.getElementById('emailImportModal').classList.add('open'); window.eiParse(); }); await p.waitForTimeout(300);
    ok('サブコン専用の取込を閉じたあと、次の取込にサブコン名が自動で入らない（専用の見た目も残らない）', await p.evaluate(() => document.querySelector('#eiReviewWrap .ei-sv').value === '' && !document.getElementById('emailImportBox').classList.contains('ei-sv-ctx')), null);

    // ===== 取り込みの入口（テキスト／PDF／荷姿） =====
    await p.evaluate(() => { window.closeEmailImport(); window.openImportChooser(); }); await p.waitForTimeout(200);
    const ch1 = await p.evaluate(() => ({ open: document.getElementById('importChooser').classList.contains('open'), n: document.querySelectorAll('#importChooser .ic-opt').length, pk: !document.getElementById('icPacking').hidden }));
    ok('「取り込み」で選択画面が開き、テキスト・PDF・荷姿の3択が出る', ch1.open && ch1.n === 3 && ch1.pk, ch1);
    await p.evaluate(() => window.icChoose('text')); await p.waitForTimeout(200);
    const ch2 = await p.evaluate(() => ({ ch: document.getElementById('importChooser').classList.contains('open'), ei: document.getElementById('emailImportModal').classList.contains('open'), ctx: document.getElementById('emailImportBox').classList.contains('ei-sv-ctx') }));
    ok('「テキストで取り込む」で選択画面が閉じ、通常のメール取込が開く', !ch2.ch && ch2.ei && !ch2.ctx, ch2);
    await p.evaluate(() => { window.closeEmailImport(); window.openImportChooser('テスト運送'); }); await p.waitForTimeout(200);
    const ch3 = await p.evaluate(() => ({ pk: document.getElementById('icPacking').hidden, sub: document.getElementById('icSub').textContent }));
    ok('サブコンの入口では荷姿の選択肢を隠し、サブコン名を案内する', ch3.pk && /テスト運送/.test(ch3.sub), ch3);
    // PDF：文字の取り出しは差し替え（PDF.js は外部CDN）。取り出した行が解析まで流れ、サブコン専用の状態で開く
    await p.evaluate(() => {
      window.__realExtract = window.pkiExtractPdfLines;
      window.pkiExtractPdfLines = async () => ({ lines: [['海上運賃', '1', "20'GP", 'USD 200'], ['THC', '1', "20'GP", 'USD 50']] });
      const inp = document.getElementById('icPdfFile');
      Object.defineProperty(inp, 'files', { value: [new File(['x'], 'q.pdf', { type: 'application/pdf' })], configurable: true });
      window.icPdfSelected(inp);
    }); await p.waitForTimeout(800);
    const ch4 = await p.evaluate(() => ({ ch: document.getElementById('importChooser').classList.contains('open'), ei: document.getElementById('emailImportModal').classList.contains('open'), ctx: document.getElementById('emailImportBox').classList.contains('ei-sv-ctx'), tabs: /\t/.test(document.getElementById('eiText').value), rows: document.querySelectorAll('#eiReviewWrap tbody tr').length }));
    ok('PDFを選ぶと文字が取り出され、サブコン専用の取込で解析まで進む（確認画面に明細が出る）', !ch4.ch && ch4.ei && ch4.ctx && ch4.tabs && ch4.rows >= 2, ch4);
    await p.evaluate(() => { window.closeEmailImport(); window.openImportChooser();
      window.pkiExtractPdfLines = async () => ({ error: 'このPDFから文字を取り出せませんでした。画像（スキャン）のPDFの可能性があります' });
      const inp = document.getElementById('icPdfFile');
      Object.defineProperty(inp, 'files', { value: [new File(['x'], 'q.pdf')], configurable: true });
      window.icPdfSelected(inp); }); await p.waitForTimeout(500);
    const ch5 = await p.evaluate(() => ({ ch: document.getElementById('importChooser').classList.contains('open'), ei: document.getElementById('emailImportModal').classList.contains('open') }));
    ok('文字を取り出せないPDFは、選択画面のまま止まって取込画面は開かない', ch5.ch && !ch5.ei, ch5);
    await p.evaluate(() => { window.closeImportChooser(); window.pkiExtractPdfLines = window.__realExtract; });
    ok('画面のエラーが出ていない', errs.length === 0, errs);
    if (process.env.SHOT) { await p.evaluate(() => { window.closeEmailImport(); document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-import').click(); }); await p.waitForTimeout(300); await p.screenshot({ path: process.env.SHOT }); }
    await ctx.close();
  }
  // ===== マスター管理（サブコン詳細）の「メール取込ルール」欄 =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, role: 'member' });
    const rules = () => p.evaluate(() => (window.__db.master_details.find(r => r.field === 'sv' && r.value === 'テスト運送') || {}).details);
    await p.evaluate(async () => { const prev = window.mdGet('sv', 'テスト運送').details; await window.mdSave('sv', 'テスト運送', Object.assign({}, prev, { importRules: { aliases: [{ from: 'ドキュメント料', to: 'DOC FEE', cat: 'export-local' }], ccy: 'USD', unit: 'B/L', by: 'taro@example.com', at: '2026-11-16T00:00:00Z' } })); });
    await p.evaluate(() => window.statsToggleMasterDetail('sv', 'テスト運送')); await p.waitForTimeout(700);
    await p.evaluate(() => document.querySelector('#mdDetailModal .mt-tab[data-mt="mail"]')?.click()); await p.waitForTimeout(200);
    let ui = await p.evaluate(() => { const m = document.getElementById('mdDetailModal'); return { tab: !!m.querySelector('.mt-tab[data-mt="mail"]'), sum: (m.querySelector('.mt-tab[data-mt="mail"] .mt-sum') || {}).textContent, vis: !!m.querySelector('.mt-panel[data-mt="mail"]') && !m.querySelector('.mt-panel[data-mt="mail"]').hidden, rows: [...m.querySelectorAll('#irPanel .ir-row')].map(r => [r.querySelector('.ir-from').value, r.querySelector('.ir-to').value, r.querySelector('.ir-cat').value]), ccy: m.querySelector('#irPanel .ir-ccy').value, unit: m.querySelector('#irPanel .ir-unit').value, meta: m.querySelector('#irPanel .ir-meta').textContent }; });
    ok('サブコンの詳細に「メール取込ルール」タブが出て、保存済みのルールが見える（要約つき）', ui.tab && ui.vis && /1件/.test(ui.sum) && /USD/.test(ui.sum) && ui.rows.length === 1 && ui.rows[0][0] === 'ドキュメント料' && ui.rows[0][1] === 'DOC FEE' && ui.rows[0][2] === 'export-local' && ui.ccy === 'USD' && ui.unit === 'B/L' && /2026-11-16/.test(ui.meta), ui);

    // 回帰：詳細の「保存」（所在地などを直したとき）で、ルールが消えない
    await p.evaluate(async () => { document.getElementById('md_location').value = '横浜市中区'; await window.statsSaveMasterDetail('sv', 'テスト運送'); }); await p.waitForTimeout(500);
    let d = await rules();
    ok('詳細の「保存」で、メール取込のルールが消えない（ほかの項目は更新される）', d.location === '横浜市中区' && d.importRules && d.importRules.aliases.length === 1 && d.importRules.ccy === 'USD' && d.svTypes && d.svTypes[0] === '運送業者', d);

    // パネルでルールを足す・通貨を変える
    await p.evaluate(() => window.statsToggleMasterDetail('sv', 'テスト運送')); await p.waitForTimeout(600);
    await p.evaluate(() => {
      const m = document.getElementById('mdDetailModal'); m.querySelector('#irPanel .ir-add').click();
      const r = m.querySelectorAll('#irPanel .ir-row'); const n = r[r.length - 1];
      n.querySelector('.ir-from').value = 'ターミナル代'; n.querySelector('.ir-to').value = 'THC';
      m.querySelector('#irPanel .ir-ccy').value = 'EUR'; m.querySelector('#irPanel .ir-save').click();
    }); await p.waitForTimeout(600);
    d = await rules();
    ok('パネルでルールを足し、既定の通貨を変えて保存できる（ほかの詳細は残る）', d.importRules.aliases.length === 2 && d.importRules.aliases[1].from === 'ターミナル代' && d.importRules.aliases[1].to === 'THC' && d.importRules.ccy === 'EUR' && d.importRules.unit === 'B/L' && d.location === '横浜市中区', d);
    ok('保存後、パネルが最新の内容で描き直される（2 件）', await p.evaluate(() => document.querySelectorAll('#irPanel .ir-row').length === 2), null);

    // 行の削除・空の行は保存しない
    await p.evaluate(() => {
      const m = document.getElementById('mdDetailModal'); m.querySelector('#irPanel .ir-add').click();   // 空の行（保存されない）
      m.querySelector('#irPanel .ir-row .ir-del').click();   // 1 行目を削除
      m.querySelector('#irPanel .ir-save').click();
    }); await p.waitForTimeout(600);
    d = await rules();
    ok('行を ✕ で外して保存すると消える・空の行は保存されない', d.importRules.aliases.length === 1 && d.importRules.aliases[0].from === 'ターミナル代', d.importRules);

    // 取込ダイアログと同じルールを読む（どちらから直しても同じ）
    await p.evaluate(() => window.statsCloseMasterDetail());
    await p.evaluate(() => { document.getElementById('eiText') && 0; window.eiOpenForSubcon('テスト運送'); }); await p.waitForTimeout(300);
    const dlg = await p.evaluate(() => document.querySelector('#eiSvCtx .ei-rules summary').textContent);
    ok('取込ダイアログにも、マスターで直したルールが反映される', /置き換え 1 件/.test(dlg) && /EUR/.test(dlg), dlg);
    // 他のサブコン（ルール無し）の詳細でも壊れない
    await p.evaluate(() => { window.closeEmailImport(); window.statsToggleMasterDetail('sv', 'ABCキャリア'); }); await p.waitForTimeout(600);
    const none = await p.evaluate(() => ({ rows: document.querySelectorAll('#irPanel .ir-row').length, empty: !document.querySelector('#irPanel .ir-empty').hidden }));
    ok('ルールの無いサブコンの詳細では「まだありません」と出る', none.rows === 0 && none.empty, none);
    ok('画面のエラーが出ていない', errs.length === 0, errs);
    await ctx.close();
  }
  // ===== 土台：使用回数・履歴の引き継ぎ・古いルールの整理・単位の学習・数量付きの金額 =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, role: 'member' });
    const rules = () => p.evaluate(() => (window.__db.master_details.find(r => r.field === 'sv' && r.value === 'テスト運送') || {}).details.importRules);
    const old = new Date(Date.now() - 200 * 86400000).toISOString(), recent = new Date(Date.now() - 5 * 86400000).toISOString();
    await p.evaluate(async ({ old, recent }) => {
      const prev = window.mdGet('sv', 'テスト運送').details;
      await window.mdSave('sv', 'テスト運送', Object.assign({}, prev, { importRules: { aliases: [
        { from: 'ドキュメント料', to: 'DOC FEE', cat: 'export-local', n: 2, last: '2026-11-01', at: recent, by: 'a@example.com' },
        { from: '古い呼び名', to: 'OLD', n: 1, last: '2025-01-05', at: old, by: 'a@example.com' },
        { from: '使われなかった', to: 'UNUSED', n: 0, at: old, by: 'a@example.com' },
      ], ccy: '', unit: '' } }));
    }, { old, recent });
    const today = new Date().toISOString().slice(0, 10);

    // 1) 取り込んで挿入すると、当たったルールの使用回数・最終使用日が記録される（挿入は待たない）
    await setSv(p, 'テスト運送');
    await p.evaluate(() => { document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-import').click(); window.icChoose('text'); }); await p.waitForTimeout(300);
    await p.evaluate(() => { document.getElementById('eiText').value = 'ドキュメント料 USD 50\nTHC USD 300'; window.eiParse(); }); await p.waitForTimeout(300);
    await p.evaluate(() => window.eiInsertRows()); await p.waitForTimeout(900);
    let r = await rules(), a = r.aliases.find(x => x.from === 'ドキュメント料');
    ok('挿入すると、当たったルールの使用回数が増え、最終使用日が今日になる（当たらなかったルールは変わらない）', a.n === 3 && a.last === today && r.aliases.find(x => x.from === '古い呼び名').n === 1 && r.aliases.find(x => x.from === '使われなかった').n === 0, r.aliases);

    // 2) パネルの表示：使用状況・古いルールの印・整理ボタン
    await p.evaluate(() => window.statsToggleMasterDetail('sv', 'テスト運送')); await p.waitForTimeout(600);
    await p.evaluate(() => document.querySelector('#mdDetailModal .mt-tab[data-mt="mail"]')?.click()); await p.waitForTimeout(200);
    const ui = await p.evaluate(() => { const m = document.getElementById('mdDetailModal'); const rows = [...m.querySelectorAll('#irPanel .ir-row')]; return { uses: rows.map(r => ({ t: (r.querySelector('.ir-use') || {}).textContent || '', stale: !!r.querySelector('.ir-use.is-stale') })), clean: (m.querySelector('#irPanel .ir-clean') || {}), cleanShown: !!m.querySelector('#irPanel .ir-clean') && !m.querySelector('#irPanel .ir-clean').hidden, cleanText: (m.querySelector('#irPanel .ir-clean') || {}).textContent }; });
    ok('パネルに使用状況が出て、長く使っていないルール（古い・未使用の 2 件）が印と整理ボタンで分かる', /使用 3回/.test(ui.uses[0].t) && !ui.uses[0].stale && ui.uses[1].stale && ui.uses[2].stale && /未使用/.test(ui.uses[2].t) && ui.cleanShown && /2 件/.test(ui.cleanText), ui);

    // 3) パネルで直して保存しても、使用回数・登録日が消えない／単位・「数量付きの金額は単価」を保存できる
    await p.evaluate(() => {
      const m = document.getElementById('mdDetailModal');
      const row = [...m.querySelectorAll('#irPanel .ir-row')].find(x => x.querySelector('.ir-from').value === 'ドキュメント料');
      row.querySelector('.ir-to').value = 'DOC FEE（書類）'; row.querySelector('.ir-aunit').value = 'B/L';
      m.querySelector('#irPanel .ir-qtyunit').checked = true; m.querySelector('#irPanel .ir-save').click();
    }); await p.waitForTimeout(600);
    r = await rules(); a = r.aliases.find(x => x.from === 'ドキュメント料');
    ok('パネルで直して保存しても、使用回数・最終使用日・登録日は引き継がれる（単位と癖も保存される）', a.to === 'DOC FEE（書類）' && a.n === 3 && a.last === today && !!a.at && a.unit === 'B/L' && r.qtyAsUnit === true && r.aliases.length === 3, r);

    // 4) 古いルールの整理（確認つき）：古い 2 件だけ外れ、使っているルールは残る
    await p.evaluate(() => document.querySelector('#mdDetailModal #irPanel .ir-clean').click());
    await p.waitForSelector('.confirm-dialog', { timeout: 5000 });
    const dlgText = await p.evaluate(() => document.querySelector('.confirm-dialog').textContent);
    await p.click('.confirm-dialog .confirm-actions button:not(.btn-cancel)'); await p.waitForTimeout(700);
    r = await rules();
    ok('整理の確認に件数と内容が出て、実行すると古い 2 件だけが外れる（使っているルールは残る）', /2 件/.test(dlgText) && /古い呼び名/.test(dlgText) && r.aliases.length === 1 && r.aliases[0].from === 'ドキュメント料' && r.aliases[0].n === 3, { dlgText, aliases: r.aliases });
    ok('整理のあと、整理ボタンは出ない', await p.evaluate(() => document.querySelector('#mdDetailModal #irPanel .ir-clean').hidden), null);

    // 5) 「数量付きの金額は単価」の癖が、取込で効く
    await p.evaluate(() => window.statsCloseMasterDetail());
    await p.evaluate(() => { document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-import').click(); window.icChoose('text'); }); await p.waitForTimeout(300);
    await p.evaluate(() => { document.getElementById('eiText').value = '陸送費 3 台 ¥10,000'; window.eiParse(); }); await p.waitForTimeout(300);
    let row = await p.evaluate(() => { const tr = document.querySelector('#eiReviewWrap .ei-table tbody tr'); return { qty: tr.querySelector('.ei-qty').value, price: tr.querySelector('.ei-price').value, unit: tr.querySelector('.ei-unit').value }; });
    ok('癖「数量付きの金額は単価」が取込で効く（3 台 ¥10,000 → 単価 10,000）', row.qty === '3' && row.price === '10000', row);

    // 6) 単位を直して「覚える」と、単位も覚える（直していない行の単位は覚えない）
    await p.evaluate(() => { document.getElementById('eiText').value = '保管料 ¥500\nTHC ¥48,000 /CNTR'; window.eiParse(); }); await p.waitForTimeout(300);
    await p.evaluate(() => { const trs = document.querySelectorAll('#eiReviewWrap .ei-table tbody tr'); trs[0].querySelector('.ei-unit').value = 'DAY'; window.eiLearnFromCorrections(); }); await p.waitForTimeout(700);
    r = await rules();
    const lu = r.aliases.find(x => x.from === '保管料');
    ok('単位だけ直した行も覚える（直していない行は覚えない）・既存ルールの使用回数は残る', lu && lu.unit === 'DAY' && lu.to === '保管料' && !r.aliases.find(x => x.from === 'THC') && r.aliases.find(x => x.from === 'ドキュメント料').n === 3, r.aliases);
    // 次回：単位が自動で入る
    await p.evaluate(() => { document.getElementById('eiText').value = '保管料 ¥500'; window.eiParse(); }); await p.waitForTimeout(300);
    row = await p.evaluate(() => { const tr = document.querySelector('#eiReviewWrap .ei-table tbody tr'); return { unit: tr.querySelector('.ei-unit').value, flags: tr.querySelector('.ei-flags').textContent }; });
    ok('次回の取込では、覚えた単位が自動で入る', row.unit === 'DAY' && /単位は既定/.test(row.flags), row);
    ok('画面のエラーが出ていない', errs.length === 0, errs);
    await ctx.close();
  }
  // ===== 別のサブコンの見出しから開き直したとき、前のサブコンの確認画面（一括設定・各行のサブコン）が残らない =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, role: 'member' });
    await setSv(p, 'テスト運送');
    await p.evaluate(() => { document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-import').click(); window.icChoose('text'); }); await p.waitForTimeout(300);
    await p.evaluate(() => { document.getElementById('eiText').value = '海上運賃 USD 1,200 /20GP'; window.eiParse(); }); await p.waitForTimeout(300);
    ok('（前提）テスト運送の取込を解析すると、一括設定がテスト運送になる', await p.evaluate(() => document.getElementById('eiBulkSv').value === 'テスト運送'));
    await p.evaluate(() => window.closeEmailImport()); await p.waitForTimeout(100);
    await p.evaluate(() => window.eiOpenForSubcon('テスト運送')); await p.waitForTimeout(200);
    ok('同じサブコンで閉じて開き直したときは、貼り付け文と確認画面を残す（うっかり閉じても失わない）', await p.evaluate(() => document.getElementById('eiText').value.includes('海上運賃') && !!document.getElementById('eiBulkSv')));
    await p.evaluate(() => { window.closeEmailImport(); window.eiOpenForSubcon('ABCキャリア'); }); await p.waitForTimeout(300);
    ok('別のサブコンの取込を開くと、前のサブコンの確認画面は残らない（貼り付け文・確認画面が空）', await p.evaluate(() => document.getElementById('eiText').value === '' && document.getElementById('eiReviewWrap').innerHTML === '' && !document.getElementById('eiBulkSv')), await p.evaluate(() => [document.getElementById('eiText').value.length, document.getElementById('eiReviewWrap').innerHTML.length]));
    await p.evaluate(() => { document.getElementById('eiText').value = '海上運賃 USD 1,200 /20GP'; window.eiParse(); }); await p.waitForTimeout(300);
    ok('解析すると、一括設定・各行のサブコンは今開いたサブコン（ABCキャリア）になる', await p.evaluate(() => document.getElementById('eiBulkSv').value === 'ABCキャリア' && [...document.querySelectorAll('#eiReviewWrap .ei-sv')].every(i => i.value === 'ABCキャリア')), await p.evaluate(() => document.getElementById('eiBulkSv').value));
    await p.evaluate(() => { window.closeEmailImport(); window.openEmailImport(); }); await p.waitForTimeout(200);
    ok('サブコンを決めない通常の取込を開くと、サブコン専用の確認画面は残らない', await p.evaluate(() => document.getElementById('eiText').value === '' && !document.getElementById('eiBulkSv')));
    await p.evaluate(() => { document.getElementById('eiText').value = '海上運賃 USD 1,200 /20GP'; window.eiParse(); window.eiInsertRows && window.eiInsertRows(); }); await p.waitForTimeout(300);
    await p.evaluate(() => { window.closeEmailImport(); window.openEmailImport(); }); await p.waitForTimeout(200);
    ok('挿入し終えた取り込みは、次に開くとき空になる', await p.evaluate(() => document.getElementById('eiText').value === '' && !document.getElementById('eiBulkSv')));
    ok('エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  // ===== 実際の文面（円記号が「\\」）：読めなかった状態 → 読める → 直して覚える =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, role: 'member' });
    await setSv(p, 'テスト運送');
    await p.evaluate(() => { document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-import').click(); window.icChoose('text'); }); await p.waitForTimeout(300);
    const TXT = '倉庫料金\n定温庫保管料：\\850/M3/期\n入出庫バンニング作業：\\2,600/M3 min:\\45,000 ※フォークリフト作業可条件\nショアリング作業(簡易)：\\15,000/VAN\n\n倉庫〜東京CY搬入\nショートドレー20F：\\36,000/VAN';
    await p.evaluate(t => { document.getElementById('eiText').value = t; window.eiParse(); }, TXT); await p.waitForTimeout(400);
    let rows = await p.evaluate(() => [...document.querySelectorAll('#eiReviewWrap .ei-table tbody tr')].map(tr => ({ name: tr.querySelector('.ei-name').value, unit: tr.querySelector('.ei-unit').value, ccy: tr.querySelector('.ei-ccy').value, price: tr.querySelector('.ei-price').value, note: tr.querySelector('.ei-note').value, sv: tr.querySelector('.ei-sv').value })));
    ok('「抽出できませんでした」だった文面が、4 行の明細として読める（サブコンも入る）', rows.length === 4 && rows.every(r => r.ccy === 'JPY' && r.sv === 'テスト運送') && rows[0].unit === 'M3/期' && rows[0].price === '850' && /Min/.test(rows[1].note), rows);
    ok('サブコン専用の取込では、「サブコン一括設定」の欄にもサブコン名が最初から入る（各行と同じ）', await p.evaluate(() => document.getElementById('eiBulkSv').value === 'テスト運送' && [...document.querySelectorAll('#eiReviewWrap .ei-sv')].every(i => i.value === 'テスト運送')), await p.evaluate(() => document.getElementById('eiBulkSv').value));
    const vis = sel => p.evaluate(s => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; }, sel);
    ok('サブコン専用の取込では、お客様・REF#・有効期限・「単価を売値として取り込む」は表示しない（サブコン一括設定は出す）', !(await vis('#eiF-customer')) && !(await vis('#eiF-ref')) && !(await vis('#eiF-valid')) && !(await vis('#eiSellMode')) && await vis('#eiBulkSv'), [await vis('#eiF-customer'), await vis('#eiSellMode'), await vis('#eiBulkSv')]);
    ok('サブコン専用の取込の説明文には、非表示にした「売値として取り込む」の説明が残らない', await p.evaluate(() => { const h = document.querySelector('#eiReviewWrap .ei-hint').textContent; return !/売値として取り込む/.test(h) && /課税/.test(h); }), await p.evaluate(() => document.querySelector('#eiReviewWrap .ei-hint').textContent));
    ok('読み取れなかった行の案内は出ない（すべて読めたため）', await p.evaluate(() => !document.querySelector('#eiReviewWrap .ei-unread')), null);
    // 直して覚える → 次回から自動
    await p.evaluate(() => { const tr = document.querySelectorAll('#eiReviewWrap .ei-table tbody tr')[3]; tr.querySelector('.ei-name').value = '東京CY搬入（ショートドレー）'; window.eiLearnFromCorrections(); }); await p.waitForTimeout(700);
    const learned = await p.evaluate(() => window.__db.master_details.find(r => r.field === 'sv' && r.value === 'テスト運送').details.importRules.aliases);
    ok('読めた行を直して「覚える」と、ルールとして残る', learned.length === 1 && learned[0].from === 'ショートドレー20F' && learned[0].to === '東京CY搬入（ショートドレー）', learned);
    await p.evaluate(t => { document.getElementById('eiText').value = t; window.eiParse(); }, TXT); await p.waitForTimeout(400);
    ok('次に同じ書き方のメールを貼ると、呼び名が自動で直る', await p.evaluate(() => [...document.querySelectorAll('#eiReviewWrap .ei-name')].some(i => i.value === '東京CY搬入（ショートドレー）')), null);

    // 読めない行は、原因が分かるように見せる
    await p.evaluate(() => { document.getElementById('eiText').value = '特殊作業 ABC123 XYZ 999 要相談\n倉庫保管 〒105-0023 港区'; window.eiParse(); }); await p.waitForTimeout(300);
    const un = await p.evaluate(() => ({ empty: !!document.querySelector('#eiReviewWrap .preset-empty'), list: [...document.querySelectorAll('#eiReviewWrap .ei-unread li')].map(l => l.textContent), open: document.querySelector('#eiReviewWrap .ei-unread')?.open }));
    ok('何も読めないときは、金額らしい数字があるのに読めなかった行を一覧で見せる（郵便番号の行は除く）', un.empty && un.list.length === 1 && /特殊作業/.test(un.list[0]) && un.open === true, un);
    ok('画面のエラーが出ていない', errs.length === 0, errs);
    if (process.env.SHOT2) { await p.screenshot({ path: process.env.SHOT2 }); }
    await ctx.close();
  }
  // ===== 読み取れなかった行の自動記録（数字を 9 に伏せた形だけ）・改善用にコピー =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, role: 'member' });
    const calls = () => p.evaluate(() => (window.__rpc || []).filter(c => c.name === 'email_unread_record'));
    await setSv(p, 'テスト運送');
    await p.evaluate(() => { document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-import').click(); window.icChoose('text'); }); await p.waitForTimeout(300);
    const mask = await p.evaluate(() => ({ a: window.eiMaskLine('定温庫保管料：\\850/M3/期'), b: window.eiMaskLine('連絡先 taro@example.com 03-1234-5678'), c: window.eiMaskLine('見積 https://example.com/q?id=12345 ＿１２３'), d: window.eiMaskLine('  特殊作業   ABC123  ') }));
    ok('伏せ字：数字は 9 に（半角・全角とも）・メールアドレスと URL は置き換え・空白はそろえる', mask.a === '定温庫保管料：\\999/M9/期' && mask.b === '連絡先 <mail> 99-9999-9999' && mask.c === '見積 <url> ＿999' && mask.d === '特殊作業 ABC999', mask);

    // アプリが知っている社名・人名も伏せる（マスターの候補・いまの案件のお客様／ご担当者・チームのメンバー）
    const kn = await p.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; } };
      set('qf-customer', '青空商事'); set('qf-person', '佐藤 一郎');
      const dl = document.getElementById('custSuggestions'); if (dl) { const o = document.createElement('option'); o.value = 'MIDORI TRADING'; dl.appendChild(o); }
      const prev = window.cloudKnownPeople; window.cloudKnownPeople = () => ['高橋 花子'];
      const r = {
        a: window.eiMaskLine('青空商事向け 特別料金 USD 120'),
        b: window.eiMaskLine('MIDORI TRADING handling fee 50'),
        c: window.eiMaskLine('担当 佐藤 からの依頼 3,000'),
        d: window.eiMaskLine('高橋さん確認済み 9,000'),
        e: window.eiMaskLine('テスト運送 作業料 1,000'),
        f: window.eiMaskLine('PHONE 料金 100'),
      };
      window.cloudKnownPeople = prev; set('qf-customer', ''); set('qf-person', '');
      return r;
    });
    ok('伏せ字：マスター・案件のお客様は <社名>、ご担当者・メンバーは <人名> に（英字は語の途中では当てない）',
      /^<社名>向け/.test(kn.a) && /^<社名> handling/.test(kn.b) && /担当 <人名> から/.test(kn.c) && /^<人名>さん/.test(kn.d) && /^<社名> 作業料/.test(kn.e) && /^PHONE/.test(kn.f), kn);

    // 読めなかった行がある文面 → 自動で記録される（伏せた形だけ）
    await p.evaluate(() => { document.getElementById('eiText').value = '特殊作業 ABC123 XYZ 999 要相談\n倉庫保管 〒105-0023 港区\n海上運賃 USD 1,200 /20GP'; window.eiParse(); }); await p.waitForTimeout(500);
    let c = await calls();
    ok('読めなかった行が、数字を 9 に伏せた形で自動で記録される（読めた行・郵便番号の行は送らない）', c.length === 1 && JSON.stringify(c[0].args.shapes) === JSON.stringify(['特殊作業 ABC999 XYZ 999 要相談']), c);
    const sent = JSON.stringify(c);
    ok('送った内容に、本物の数字・サブコン名・メールアドレスが含まれない', !/[0-8]/.test(JSON.stringify(c[0].args.shapes)) && !/テスト運送|@|example/.test(sent), sent);
    // 同じ形は、同じページでは何度も送らない
    await p.evaluate(() => window.eiParse()); await p.waitForTimeout(400);
    ok('同じ文面をもう一度解析しても、同じ形は再送しない', (await calls()).length === 1, await calls());
    // 読めた文面では送らない
    await p.evaluate(() => { document.getElementById('eiText').value = '海上運賃 USD 1,200 /20GP'; window.eiParse(); }); await p.waitForTimeout(300);
    ok('すべて読めた文面では、何も送らない', (await calls()).length === 1, await calls());
    // 新しい形は送る
    await p.evaluate(() => { document.getElementById('eiText').value = '特殊作業 ABC123 XYZ 999 要相談\n別件作業 QQQ 4567 要相談'; window.eiParse(); }); await p.waitForTimeout(400);
    c = await calls();
    ok('新しい形だけが追加で送られる', c.length === 2 && JSON.stringify(c[1].args.shapes) === JSON.stringify(['別件作業 QQQ 9999 要相談']), c);

    // 「改善用にコピー」：伏せた形がコピーされる
    await p.evaluate(() => { window.__clip = ''; Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__clip = t; return Promise.resolve(); } }, configurable: true }); });
    await p.evaluate(() => { document.getElementById('eiText').value = '特殊作業 ABC123 XYZ 999 要相談'; window.eiParse(); }); await p.waitForTimeout(300);
    const msg = await p.evaluate(() => document.querySelector('#eiReviewWrap .ei-unread p').textContent);
    ok('黄色の案内に、自動で記録される旨（数字を 9 に伏せる・金額や社名は残らない）が書かれている', /数字を 9 に伏せた形/.test(msg) && /自動で記録/.test(msg) && /残りません/.test(msg), msg);
    await p.evaluate(() => document.querySelector('#eiReviewWrap .ei-unread-copy').click()); await p.waitForTimeout(300);
    const clip = await p.evaluate(() => window.__clip);
    ok('「📋 改善用にコピー」で、数字を 9 に伏せた形がコピーされる', /数字は 9 に伏せています/.test(clip) && /・特殊作業 ABC999 XYZ 999 要相談/.test(clip) && !/[0-8]/.test(clip.split('\n').slice(1).join('')), clip);

    // ===== 行の評価（✅合っている／❌明細ではない）→ 覚える → 次回から反映 =====
    const abcRules = () => p.evaluate(() => ((window.__db.master_details.find(r => r.field === 'sv' && r.value === 'ABCキャリア') || {}).details || {}).importRules || null);
    const RATE_TXT = "海上運賃 USD 1,200 /20GP\nTHC USD 150 /20GP\n注意書き USD 50 at cost\nTYPE 40HQ 99";
    await p.evaluate(t => { window.closeEmailImport(); window.eiOpenForSubcon('ABCキャリア'); document.getElementById('eiText').value = t; window.eiParse(); }, RATE_TXT); await p.waitForTimeout(500);
    const r0 = await p.evaluate(() => ({ rows: document.querySelectorAll('#eiReviewWrap .ei-table tbody tr').length, btns: document.querySelectorAll('#eiReviewWrap .ei-rate-btn').length, src: [...document.querySelectorAll('#eiReviewWrap .ei-table tbody tr')].map(t => t.dataset.src) }));
    ok('サブコン専用の取込では、各行に ✅／❌ の評価ボタンが出て、元の行の文を持つ', r0.rows >= 3 && r0.btns === r0.rows * 2 && /海上運賃/.test(r0.src[0]), r0);
    const r1 = await p.evaluate(() => {
      const trs = document.querySelectorAll('#eiReviewWrap .ei-table tbody tr');
      trs[0].querySelector('.ei-rate-btn[data-k="ok"]').click();
      trs[2].querySelector('.ei-rate-btn[data-k="ng"]').click();
      return { okOn: trs[0].querySelector('.ei-rate-btn[data-k="ok"]').classList.contains('on'), ngChk: trs[2].querySelector('.ei-chk').checked, ngRate: trs[2].dataset.rate };
    });
    ok('❌ を押した行は、挿入のチェックが外れて印が付く（もう一度押すと取り消し）', r1.okOn && r1.ngChk === false && r1.ngRate === 'ng', r1);
    const r2 = await p.evaluate(() => { const tr = document.querySelectorAll('#eiReviewWrap .ei-table tbody tr')[2]; tr.querySelector('.ei-rate-btn[data-k="ng"]').click(); const a = tr.querySelector('.ei-chk').checked; tr.querySelector('.ei-rate-btn[data-k="ng"]').click(); return a; });
    ok('❌ をもう一度押すと取り消されてチェックが戻る', r2 === true, r2);
    // 直した行は ✅ を選べない（❌ は選べる）／元に戻すと ✅ も戻る
    const edr = await p.evaluate(() => {
      const tr = document.querySelectorAll('#eiReviewWrap .ei-table tbody tr')[1], nm = tr.querySelector('.ei-name'), base = nm.value;
      const okB = tr.querySelector('.ei-rate-btn[data-k="ok"]'), ngB = tr.querySelector('.ei-rate-btn[data-k="ng"]'), tag = tr.querySelector('.ei-edited-tag');
      const fire = () => nm.dispatchEvent(new Event('change', { bubbles: true }));
      okB.click(); const before = { on: okB.classList.contains('on'), dis: okB.disabled, tagHidden: tag.hidden };
      nm.value = 'ZZ直した品名'; fire();
      const edited = { on: okB.classList.contains('on'), dis: okB.disabled, tagHidden: tag.hidden, rate: tr.dataset.rate || '', ngDis: ngB.disabled };
      okB.click(); const afterClick = tr.dataset.rate || '';
      nm.value = base; fire();
      const reverted = { dis: okB.disabled, tagHidden: tag.hidden, rate: tr.dataset.rate || '' };
      return { before, edited, afterClick, reverted, guide: !!document.querySelector('#eiReviewWrap .ei-rate-guide') };
    });
    ok('✅を押したあと品名を直すと、✅は外れて押せなくなり「✏️ 修正済み」が出る', edr.before.on && !edr.before.dis && edr.before.tagHidden && !edr.edited.on && edr.edited.dis && !edr.edited.tagHidden && edr.edited.rate === '', edr);
    ok('直した行でも ❌ は押せる／直した行の ✅ クリックは何も起きない', edr.edited.ngDis === false && edr.afterClick === '', edr);
    ok('直した内容を元に戻すと、✅ が押せる状態に戻る', edr.reverted.dis === false && edr.reverted.tagHidden === true, edr);
    ok('✅／❌ の選び方の説明（❓）が確認画面に出る', edr.guide, edr);
    await p.evaluate(() => window.eiLearnFromCorrections()); await p.waitForTimeout(700);
    let rr = await abcRules();
    ok('「覚える」で、❌の形が ignore に・✅の形が ok に保存される（数字は 9 に伏せた形）', rr && rr.ignore && rr.ignore.length === 1 && /注意書き USD 99 at cost/.test(rr.ignore[0].shape) && rr.ok && rr.ok.length === 1 && /海上運賃 USD 9,999 \/9GP|海上運賃/.test(rr.ok[0].shape) && !/1,200/.test(rr.ok[0].shape), rr);
    // 金額が違っても同じ形として当たる
    await p.evaluate(() => { document.getElementById('eiText').value = "海上運賃 USD 2,500 /20GP\n注意書き USD 80 at cost\nTHC USD 300 /20GP"; window.eiParse(); }); await p.waitForTimeout(500);
    const r3 = await p.evaluate(() => ({ names: [...document.querySelectorAll('#eiReviewWrap .ei-name')].map(x => x.value), confs: [...document.querySelectorAll('#eiReviewWrap .ei-table tbody tr')].map(t => t.querySelector('.ei-conf')?.textContent), ign: document.querySelector('#eiReviewWrap .ei-ignored')?.textContent || '' }));
    ok('次回：❌の形の行（金額違い）は自動で除外され、「ルールで除外した行」に出る', r3.names.length === 2 && !r3.names.some(n => /注意書き/.test(n)) && /ルールで除外した行（1 件）/.test(r3.ign), r3);
    ok('次回：✅の形の行は確度が「高」になる（ほかの行は変わらない）', r3.confs[0] === '高' && r3.confs[1] !== '高', r3.confs);
    // 読めなかった行を「今後は無視」
    await p.evaluate(() => { document.getElementById('eiText').value = "海上運賃 USD 2,500 /20GP\nTYPE 40HQ 99 ref"; window.eiParse(); }); await p.waitForTimeout(400);
    const hasIgn = await p.evaluate(() => !!document.querySelector('#eiReviewWrap .ei-unread .ei-ign-btn'));
    if (hasIgn) {
      await p.evaluate(() => document.querySelector('#eiReviewWrap .ei-unread .ei-ign-btn').click()); await p.waitForTimeout(600);
      rr = await abcRules();
      ok('「読めなかった行」の「🚫 今後は無視」で、その形が ignore に保存される', rr.ignore.length === 2, rr.ignore);
    } else ok('（読めなかった行の無視ボタンの試験は、この文面では読めなかった行が出ないためスキップ）', true, null);
    // 通常（サブコンなし）の取込には評価ボタンが出ない
    await p.evaluate(t => { window.closeEmailImport(); window.openEmailImport(); document.getElementById('eiText').value = t; window.eiParse(); }, RATE_TXT); await p.waitForTimeout(400);
    ok('サブコンを決めない通常の取込には、評価ボタンは出ない', await p.evaluate(() => document.querySelectorAll('#eiReviewWrap .ei-rate-btn').length === 0), null);
    // マスターのパネル：形の一覧・✕で外して保存
    await p.evaluate(() => { window.closeEmailImport(); window.statsToggleMasterDetail('sv', 'ABCキャリア'); }); await p.waitForTimeout(700);
    const pn = await p.evaluate(() => ({ ign: document.querySelectorAll('#irPanel .ir-shapes[data-kind="ignore"] .ir-shape').length, ok: document.querySelectorAll('#irPanel .ir-shapes[data-kind="ok"] .ir-shape').length }));
    ok('マスターの「メール取込ルール」に、取り込まない形・確認済みの形の一覧が出る', pn.ign >= 1 && pn.ok === 1, pn);
    await p.evaluate(() => { const m = document.getElementById('mdDetailModal'); m.querySelector('#irPanel .ir-shapes[data-kind="ok"] .ir-shape-del').click(); m.querySelector('#irPanel .ir-save').click(); }); await p.waitForTimeout(700);
    rr = await abcRules();
    ok('パネルで ✕ を押した形だけが外れる（ほかの形は残る）', rr.ok.length === 0 && rr.ignore.length >= 1, rr);
    await p.evaluate(() => window.statsCloseMasterDetail());
    // ===== 評価の記録（email_feedback_record・数字を 9 に伏せた形だけ） =====
    const fbCalls = () => p.evaluate(() => (window.__rpc || []).filter(c => c.name === 'email_feedback_record').flatMap(c => c.args.items));
    let fb = await fbCalls();
    ok('「覚える」の評価が、伏せた形で記録される（❌＝ignore・直さず✅＝ok）', fb.some(x => x.kind === 'ignore' && /注意書き USD 99 at cost/.test(x.shape)) && fb.some(x => x.kind === 'ok' && /海上運賃/.test(x.shape)) && fb.every(x => !/[0-8]/.test(x.shape + x.hint) && !/1,200|150/.test(x.shape)), fb);
    await p.evaluate(() => { window.eiOpenForSubcon('ABCキャリア'); document.getElementById('eiText').value = "ドキュメント代 USD 75 /BL"; window.eiParse(); }); await p.waitForTimeout(400);
    await p.evaluate(() => { const tr = document.querySelector('#eiReviewWrap .ei-table tbody tr'); tr.querySelector('.ei-name').value = 'DOC FEE'; window.eiLearnFromCorrections(); }); await p.waitForTimeout(600);
    fb = await fbCalls();
    const fx = fb.find(x => x.kind === 'fix');
    ok('品名を直した行は fix として記録される（元の行＋「解析 → 直し」・数字は 9 に伏せる）', fx && /ドキュメント代 USD 99 \/BL/.test(fx.shape) && /解析=ドキュメント代/.test(fx.hint) && /直し=DOC FEE/.test(fx.hint), fx);
    const fbSent0 = (await fbCalls()).length;
    await p.evaluate(() => window.eiLearnFromCorrections()); await p.waitForTimeout(300);
    ok('同じ内容は、このページから二度送らない', (await fbCalls()).length === fbSent0, fbSent0);
    await p.evaluate(() => window.closeEmailImport());
    // ===== 品名・単位のマスターを参照する（解析時／確認画面で直したとき） =====
    await p.evaluate(() => { window.openEmailImport(); document.getElementById('eiText').value = "Terminal Handling Charge USD 100\n5. THC: terminal USD 50 /BL\nABC特殊作業 USD 10\n海上運賃 USD 100 /40HQ"; window.eiParse(); }); await p.waitForTimeout(500);
    const mm = await p.evaluate(() => [...document.querySelectorAll('#eiReviewWrap .ei-table tbody tr')].map(tr => ({ name: tr.querySelector('.ei-name').value, unit: tr.querySelector('.ei-unit').value, cat: tr.querySelector('.ei-cat').value, unreg: tr.querySelector('.ei-name').classList.contains('name-unregistered'), flags: tr.querySelector('.ei-flags').textContent, list: tr.querySelector('.ei-name').getAttribute('list') + '/' + tr.querySelector('.ei-unit').getAttribute('list') })));
    ok('解析：マスターの別名はマスターの名前にそろい、既定の単位・カテゴリが入る', mm[0].name === 'THC' && mm[0].unit === 'CNTR' && mm[0].cat === 'export-local' && /マスター名/.test(mm[0].flags), mm[0]);
    ok('解析：行頭の番号と「: 説明」を外して照合する（既定の単位は読めた単位を上書きしない）', mm[1].name === 'THC' && mm[1].unit === 'BL', mm[1]);
    ok('解析：マスターに無い名前はそのまま・欄に「マスターに無い」印が付く', mm[2].name === 'ABC特殊作業' && mm[2].unreg === true, mm[2]);
    ok('解析：単位も単位マスターの名前にそろう（40HQ → 40\'HQ）', mm[3].unit === "40'HQ", mm[3]);
    ok('品名・単位の欄はマスターの入力候補を引く（datalist）', mm[0].list === 'nmSuggestions/unit-list', mm[0].list);
    const ed = await p.evaluate(() => {
      const tr = document.querySelectorAll('#eiReviewWrap .ei-table tbody tr')[2];
      const unit = tr.querySelector('.ei-unit'); unit.value = ''; 
      const nm = tr.querySelector('.ei-name'); nm.value = 'Terminal Handling Charge'; nm.dispatchEvent(new Event('change', { bubbles: true }));
      return { name: nm.value, unit: unit.value, cat: tr.querySelector('.ei-cat').value, unreg: nm.classList.contains('name-unregistered') };
    });
    ok('品名を直すと、マスターの名前にそろい、空の単位・カテゴリにマスターの既定が入る', ed.name === 'THC' && ed.unit === 'CNTR' && ed.cat === 'export-local' && ed.unreg === false, ed);
    const ed2 = await p.evaluate(() => {
      const tr = document.querySelectorAll('#eiReviewWrap .ei-table tbody tr')[2];
      const unit = tr.querySelector('.ei-unit'); unit.value = '40HC'; unit.dispatchEvent(new Event('change', { bubbles: true }));
      const nm = tr.querySelector('.ei-name'); const cat = tr.querySelector('.ei-cat'); cat.value = 'other'; cat.dispatchEvent(new Event('change', { bubbles: true }));
      nm.value = 'THC'; nm.dispatchEvent(new Event('change', { bubbles: true }));
      return { unit: unit.value, cat: cat.value };
    });
    ok('単位を直すと単位マスターの名前にそろう／手で選んだカテゴリは品名を直しても上書きしない', ed2.unit === "40'HQ" && ed2.cat !== 'export-local', ed2);
    await p.evaluate(() => window.closeEmailImport());
    ok('画面のエラーが出ていない', errs.length === 0, errs);
    await ctx.close();
  }
  // 表（関数）が無い環境：エラーを出さず、取込は普通に動き、以後は送らない
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, role: 'member', unreadMissing: true });
    await setSv(p, 'テスト運送');
    await p.evaluate(() => { document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-import').click(); window.icChoose('text'); }); await p.waitForTimeout(300);
    await p.evaluate(() => { document.getElementById('eiText').value = '特殊作業 ABC123 XYZ 999 要相談'; window.eiParse(); }); await p.waitForTimeout(500);
    await p.evaluate(() => { document.getElementById('eiText').value = '別件作業 QQQ 4567 要相談'; window.eiParse(); }); await p.waitForTimeout(500);
    const n = await p.evaluate(() => (window.__rpc || []).filter(c => c.name === 'email_unread_record').length);
    ok('SQL 未実行の環境：1 回試して、以後は送らない（取込の画面は普通に出る）', n === 1 && await p.evaluate(() => !!document.querySelector('#eiReviewWrap .ei-unread')), n);
    ok('SQL 未実行の環境で、画面のエラーが出ない', errs.length === 0, errs);
    await ctx.close();
  }
  // 未ログイン：何も送らない
  {
    const { ctx, p, errs } = await open(false, { legacy: {} });
    await p.evaluate(() => { window.openEmailImport(); document.getElementById('eiText').value = '特殊作業 ABC123 XYZ 999 要相談'; window.eiParse(); }); await p.waitForTimeout(400);
    ok('未ログインでは、記録しない（黄色の案内は出る・エラーなし）', await p.evaluate(() => !(window.__rpc || []).length && !!document.querySelector('#eiReviewWrap .ei-unread')) && errs.length === 0, errs);
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(out.join('\n'));
  process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
