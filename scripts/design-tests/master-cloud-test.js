// マスター（入力候補・同義グループ・統合ルール・マスター詳細・投票）のクラウド必須化と、名前の突き合わせの試験。
// 偽の Supabase（読み書きできるメモリ上の表）でログイン状態を再現する。実サーバーには接続しない。
//   node scripts/design-tests/master-cloud-test.js
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

  // ===== ログイン中：クラウドだけを使う =====
  {
    const { ctx, p, errs, dlg } = await open(true);
    const L = '[ログイン] ';
    const r1 = await p.evaluate(() => ({
      a: nameCanon('carrier', 'Ocean Network Express'), b: nameCanon('carrier', 'ｏｎｅ'), c: nameCanon('nm', '*Terminal Handling Charge'),
      d: nameCanon('port', '横浜'), e: nameCanon('nm', 'O/F'), f: nameSame('sv', 'テスト運送(株)', 'テスト運送'),
      g: nameCanon('sv', 'ﾛｰｶﾙ運送'),
    }));
    ok(L + '別名→代表名（クラウドの同義グループ）', r1.a === 'ONE' && r1.d === 'Yokohama', r1);
    ok(L + '表記ゆれ・課税マーク', r1.b === 'ONE' && r1.c === 'THC', r1);
    ok(L + '統合ルール（クラウド）で代表名', r1.e === '海上運賃', r1);
    ok(L + '法人格の違いは同じ会社', r1.f === true, r1);
    ok(L + 'このブラウザだけの同義グループは使わない', r1.g === 'ﾛｰｶﾙ運送', r1);
    const r2 = await p.evaluate(() => {
      const vals = id => [...document.getElementById(id).children].map(o => ({ v: o.value, l: o.label }));
      return { nm: vals('nmSuggestions'), port: vals('portSuggestions') };
    });
    ok(L + '候補は代表名のみ（別名なし・label に別名）', r2.nm.some(o => o.v === 'THC' && o.l.includes('別名')) && !r2.nm.some(o => o.v === 'Terminal Handling Charge'), r2.nm);
    ok(L + 'このブラウザだけのマスターは候補に出ない', !r2.nm.some(o => o.v === 'ローカル品名'), r2.nm);
    // 別名で自動入力
    const id = await rowId(p);
    await p.fill('#nm-' + id, 'ターミナルハンドリングチャージ'); await p.dispatchEvent('#nm-' + id, 'change'); await p.waitForTimeout(300);
    const r3 = await p.evaluate(id => ({ un: document.getElementById('un-' + id).value, cat: document.getElementById('cat-' + id).value }), id);
    ok(L + '別名の品名でも単位・カテゴリを補完', r3.un === 'CNTR' && r3.cat === 'export-local', r3);
    // マスター登録：クラウドに書き、このブラウザには書かない
    dlg.length = 0;
    await p.fill('#nm-' + id, '新しい費用ABC'); await p.fill('#un-' + id, 'shipment');
    await p.evaluate(id => registerRowToMaster(id), id); await p.waitForTimeout(400);
    const r4 = await p.evaluate(() => ({
      md: window.__db.master_details.some(m => m.value === '新しい費用ABC'),
      vote: window.__db.master_votes.some(m => m.value === '新しい費用ABC'),
      local: (localStorage.getItem('masterDetails_v1') || '').includes('新しい費用ABC'),
    }));
    ok(L + 'マスター登録はクラウドに保存', r4.md && r4.vote, r4);
    ok(L + 'このブラウザには保存しない', !r4.local, r4);
    ok(L + '新規登録の確認', dlg.some(m => m.includes('新しくマスターに登録')), dlg);
    // 移行の案内と移行
    const notice = await p.evaluate(() => window.masterTopNoticeHtml());
    ok(L + '移行の案内（このブラウザにだけあるデータ）', notice.includes('このブラウザにだけ保存されている') && notice.includes('<b>1</b><span>マスター</span>') && notice.includes('<b>1</b><span>略称</span>'), notice);
    if (process.env.OUT) {   // OUT=<dir> でマスター管理画面（移行の案内）を撮る
      await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); });
      await p.waitForTimeout(1500);
      await p.evaluate(() => { if (window.statsSetPane) window.statsSetPane('master'); }); await p.waitForTimeout(800);
      await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(process.env.OUT, 'master-migrate.png') });
    }
    dlg.length = 0;
    await p.evaluate(() => { window.__mig = masterMigrateLocal(); });
    const migDlg = await confirmDlg(p, 'ok');
    await p.evaluate(() => window.__mig); await p.waitForTimeout(500);
    const r5 = await p.evaluate(() => ({
      master: window.__db.master_votes.some(m => m.value === 'ローカル品名'),
      syn: window.__db.synonym_groups.some(g => g.canonical === 'ローカル運送' && g.aliases.includes('ﾛｰｶﾙ運送')),
      md: window.__db.master_details.some(m => m.value === 'ローカル品名'),
      rule: window.__db.alias_rules.some(r => r.from_value === 'YKH'),
      abbrev: window.__db.synonym_groups.some(g => g.canonical === 'NAIGAI TRANS LINES' && g.aliases.includes('NTL')),
      unit: window.__db.synonym_groups.some(g => g.field === 'un' && g.canonical === 'CONTAINER' && g.aliases.includes('CNTR')),
      cleared: ['masterCandidates_v1', 'synonymGroups_v1', 'unitAlias_v1', 'masterDetails_v1', 'aliasRules_v1', 'abbrevPairs_v1'].every(k => localStorage.getItem(k) === null),
      exclKept: !!localStorage.getItem('statsExclusions_v1'),
      backup: !!localStorage.getItem('masterLocalBackup_v1'),
      noticeAfter: window.masterTopNoticeHtml(),
      canon: nameCanon('sv', 'ﾛｰｶﾙ運送'),
    }));
    ok(L + '移行：マスター・同義グループ・詳細・統合ルール・略称がクラウドへ', r5.master && r5.syn && r5.md && r5.rule && r5.abbrev, r5);
    ok(L + '移行：このブラウザの単位の別名もクラウドへ', r5.unit, r5);
    ok(L + '移行後：このブラウザの分を消し、バックアップを残す', r5.cleared && r5.backup, r5);
    ok(L + '除外リストの共有テーブルが無い間は、このブラウザの除外リストを残す', r5.exclKept, r5);
    ok(L + '移行後：案内が消え、移した同義グループが効く', r5.noticeAfter === '' && r5.canon === 'ローカル運送', r5);
    ok(L + '移行の確認画面（実行は「チームへ移す」。初期の焦点は「やめる」）', migDlg.text.includes('チーム共有のマスターへ移します') && migDlg.focused === 'btn-cancel', migDlg);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 承認制（申請テーブルあり）：メンバーは申請、管理者が承認 =====
  {
    const { ctx, p, errs, dlg } = await open(true, { approval: true, role: 'member' });
    const L = '[承認制・メンバー] ';
    await p.waitForTimeout(500);
    const id = await rowId(p);
    dlg.length = 0;
    await p.fill('#nm-' + id, '申請する費用'); await p.evaluate(id => registerRowToMaster(id), id); await p.waitForTimeout(500);
    const r = await p.evaluate(() => ({
      req: window.__db.master_requests.find(x => x.value === '申請する費用'),
      vote: window.__db.master_votes.some(m => m.value === '申請する費用'),
      cand: [...document.getElementById('nmSuggestions').children].some(o => o.value === '申請する費用'),
    }));
    ok(L + '登録は「申請」になる（申請中・マスターにはならない）', r.req && r.req.status === 'pending' && !r.vote && !r.cand, r);
    ok(L + '確認画面は「申請します」', dlg.some(m => m.includes('申請します')), dlg);
    // 解除はできない
    await p.evaluate(() => statsToggleVote('nm', 'THC')); await p.waitForTimeout(300);
    ok(L + 'マスターの解除はできない', await p.evaluate(() => window.__db.master_votes.some(m => m.value === 'THC')));
    const html = await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); return new Promise(r => setTimeout(() => r(document.getElementById('statsPane-master')?.innerHTML || ''), 1200)); });
    ok(L + 'マスター管理画面に自分の申請（承認待ち・取り消し）', html.includes('あなたの申請') && html.includes('申請する費用') && html.includes('承認待ち') && html.includes('取り消す') && html.includes('req-state is-wait'), html.slice(0, 300));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await open(true, { approval: true, role: 'admin' });
    const L = '[承認制・管理者] ';
    await p.waitForTimeout(500);
    await p.evaluate(() => { window.__db.master_requests.push({ id: 'q1', field: 'nm', value: '承認待ち費用', requested_by: 'm@example.com', status: 'pending', created_at: new Date().toISOString() }); });
    await p.evaluate(async () => { await statsLoadMasterCache(); switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); });
    await p.waitForTimeout(1200);
    const html = await p.evaluate(() => document.getElementById('statsPane-master')?.innerHTML || '');
    ok(L + '承認待ちの一覧（承認・却下）', html.includes('承認待ち 1 件') && html.includes('承認待ち費用') && html.includes('statsApproveRequest'), html.slice(0, 300));
    if (process.env.OUT) { await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: path.join(process.env.OUT, 'master-approval.png') }); }
    await p.evaluate(() => statsApproveRequest('q1')); await p.waitForTimeout(500);
    const r = await p.evaluate(() => ({
      req: window.__db.master_requests.find(x => x.id === 'q1'),
      vote: window.__db.master_votes.some(m => m.value === '承認待ち費用'),
      cand: [...document.getElementById('nmSuggestions').children].some(o => o.value === '承認待ち費用'),
    }));
    ok(L + '承認でマスターになり、候補に出る', r.req.status === 'approved' && r.req.decided_by && r.vote && r.cand, r);
    // ほかの人の登録も解除できる
    await p.evaluate(() => { window.__db.master_votes.push({ field: 'nm', value: '他人の品名', voter_email: 'x@example.com' }); });
    await p.evaluate(async () => { await statsLoadMasterCache(); await statsToggleVote('nm', '他人の品名'); });
    await p.waitForTimeout(300);
    ok(L + 'ほかの人が登録したマスターも解除できる', await p.evaluate(() => !window.__db.master_votes.some(m => m.value === '他人の品名')));
    // 管理者の登録は直接マスター
    const id = await rowId(p);
    // マスター管理タブを開いているため入力欄は見えない：値を直接入れて登録する
    await p.evaluate(id => { document.getElementById('nm-' + id).value = '管理者の費用'; registerRowToMaster(id); }, id); await p.waitForTimeout(400);
    ok(L + '管理者の登録は直接マスター（申請なし）', await p.evaluate(() => window.__db.master_votes.some(m => m.value === '管理者の費用') && !window.__db.master_requests.some(x => x.value === '管理者の費用')));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== マスター管理の画面操作（07 回答）：役割・件数・却下／解除の確認・「⋯」メニュー =====
  {
    const { ctx, p, errs } = await open(true, { approval: true, role: 'admin', noLegacy: true });
    const L = '[管理者の画面] ';
    await p.waitForTimeout(500);
    await p.evaluate(() => {
      window.__db.master_requests.push({ id: 'q1', field: 'nm', value: '申請A', requested_by: 'm1@example.com', status: 'pending', created_at: new Date().toISOString() });
      window.__db.master_requests.push({ id: 'q2', field: 'nm', value: '申請B', requested_by: 'm2@example.com', status: 'pending', created_at: new Date().toISOString() });
    });
    await p.evaluate(async () => { await statsLoadMasterCache(); switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); });
    await p.waitForTimeout(1200);
    const head = await p.evaluate(() => ({
      badge: document.querySelector('#statsPane-master .role-badge')?.textContent,
      admin: !!document.querySelector('#statsPane-master .role-badge.is-admin'),
      kpis: [...document.querySelectorAll('#statsPane-master .master-kpis .kpi')].map(k => k.textContent.replace(/\s+/g, '')),
      primary: document.querySelector('#statsPane-master .master-kpis .kpi.is-primary')?.textContent.replace(/\s+/g, ''),
    }));
    ok(L + '役割バッジ（管理者）', head.badge === '管理者' && head.admin, head);
    ok(L + '件数ストリップ：承認待ちが先頭・強調', head.primary === '2承認待ち' && head.kpis.length === 3, head);
    // 却下：確認 → やめる で残り、実行で却下
    await p.evaluate(() => { [...document.querySelectorAll('#statsPane-master .stats-req-section button')].find(b => b.textContent.includes('却下')).click(); });
    const rj1 = await confirmDlg(p, 'cancel');
    ok(L + '却下の確認（初期の焦点は「やめる」・取り消せない旨）', rj1.focused === 'btn-cancel' && rj1.text.includes('取り消せません') && rj1.text.includes('却下'), rj1);
    ok(L + '「やめる」では却下されない', await p.evaluate(() => window.__db.master_requests.find(x => x.id === 'q1').status === 'pending'));
    await p.evaluate(() => { [...document.querySelectorAll('#statsPane-master .stats-req-section button')].find(b => b.textContent.includes('却下')).click(); });
    await confirmDlg(p, 'ok');
    await p.waitForTimeout(400);
    ok(L + '実行で却下される', await p.evaluate(() => window.__db.master_requests.filter(x => x.status === 'rejected').length === 1));
    // Esc で「やめる」
    await p.evaluate(() => { [...document.querySelectorAll('#statsPane-master .stats-req-section button')].find(b => b.textContent.includes('却下')).click(); });
    await p.waitForSelector('.confirm-dialog'); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    ok(L + 'Esc で閉じる（却下されない）', await p.evaluate(() => !document.querySelector('.confirm-dialog') && window.__db.master_requests.filter(x => x.status === 'rejected').length === 1));
    // 「⋯」メニュー → 解除（個別マスター）
    await p.evaluate(() => { window.__db.master_votes.push({ field: 'nm', value: '解除する品名', voter_email: 'x@example.com' }); });
    await p.evaluate(async () => { await statsLoadMasterCache(); statsMasterSetFilter && statsMasterSetFilter('nm'); });
    await p.waitForTimeout(500);
    const rowSel = '#statsPane-master tr[data-mvalue="解除する品名"]';
    await p.click(rowSel + ' .master-ops-more'); await p.waitForTimeout(150);
    ok(L + '「⋯」で解除のメニュー（赤字）', await p.evaluate(() => !!document.querySelector('.master-ops-menu .btn-remove')));
    await p.click('.master-ops-menu .btn-remove');
    const rm1 = await confirmDlg(p, 'cancel');
    ok(L + '解除の確認（取り消せない旨）→ やめるなら残る', rm1.text.includes('解除') && rm1.focused === 'btn-cancel' && await p.evaluate(() => window.__db.master_votes.some(m => m.value === '解除する品名')), rm1);
    await p.click(rowSel + ' .master-ops-more'); await p.click('.master-ops-menu .btn-remove');
    await confirmDlg(p, 'ok'); await p.waitForTimeout(500);
    ok(L + '実行で解除される', await p.evaluate(() => !window.__db.master_votes.some(m => m.value === '解除する品名')));
    // 同義グループの「⋯」→ グループを解除
    await p.evaluate(() => { statsMasterSetFilter('port'); }); await p.waitForTimeout(300);
    await p.click('#statsPane-master tr[data-mvalue="Yokohama"] .master-ops-more'); await p.click('.master-ops-menu .btn-remove');
    const gr = await confirmDlg(p, 'ok'); await p.waitForTimeout(500);
    ok(L + 'グループの解除も確認つき', gr.text.includes('別名をすべて外しますか') && await p.evaluate(() => !window.__db.synonym_groups.some(g => g.canonical === 'Yokohama')), gr);
    // 代表を新規登録の開閉
    await p.evaluate(() => statsMasterToggleRegister());
    ok(L + '「マスターを新規登録」が開く', await p.evaluate(() => document.querySelector('#statsPane-master .master-register').classList.contains('is-open')));
    // 表の列：個別マスターと同義グループは 1 つの表（同じ列）
    const cols = await p.evaluate(() => [...document.querySelectorAll('#statsPane-master table.master-table')].map(t => [...t.querySelectorAll('thead th')].map(h => h.textContent.trim()).join('|')));
    ok(L + '表は 1 つで、列は 種別｜マスター名｜別名・略称｜操作', cols.length === 1 && cols[0] === '種別|マスター名|別名・略称（英語表記・省略形）|操作', cols);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await open(true, { approval: true, role: 'member', noLegacy: true });
    const L = '[メンバーの画面] ';
    await p.waitForTimeout(500);
    await p.evaluate(() => {
      window.__db.master_requests.push({ id: 'q1', field: 'nm', value: '私の申請', requested_by: 's@example.com', status: 'pending', created_at: new Date().toISOString() });
      window.__db.master_requests.push({ id: 'q2', field: 'nm', value: '承認された', requested_by: 's@example.com', status: 'approved', created_at: new Date().toISOString() });
      window.__db.master_requests.push({ id: 'q3', field: 'nm', value: '却下された', requested_by: 's@example.com', status: 'rejected', created_at: new Date().toISOString() });
    });
    await p.evaluate(async () => { await statsLoadMasterCache(); switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); });
    await p.waitForTimeout(1200);
    const r = await p.evaluate(() => ({
      badge: document.querySelector('#statsPane-master .role-badge')?.textContent, admin: !!document.querySelector('#statsPane-master .role-badge.is-admin'),
      kpis: [...document.querySelectorAll('#statsPane-master .master-kpis .kpi')].map(k => k.textContent.replace(/\s+/g, '')),
      states: [...document.querySelectorAll('#statsPane-master .req-state')].map(x => x.className + ':' + x.textContent),
      ops: [...document.querySelectorAll('#statsPane-master .master-ops-more')].filter(b => (b.getAttribute('onclick') || '').includes("'master'")).length,
    }));
    ok(L + '役割バッジ（メンバー）・件数（承認待ち／承認済み／却下）', r.badge === 'メンバー' && !r.admin && r.kpis.join() === '1承認待ち,1承認済み,1却下', r);
    ok(L + '申請の状態を記号用の class つきで表示', r.states.length === 3 && r.states.some(x => x.includes('is-wait')) && r.states.some(x => x.includes('is-ok')) && r.states.some(x => x.includes('is-no')), r.states);
    ok(L + 'メンバーには個別マスターの解除（「⋯」）を出さない', r.ops === 0, r);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 除外リストの共有（stats_exclusions あり）=====
  {
    const { ctx, p, errs } = await open(true, { excl: true });
    const L = '[除外リスト共有] ';
    await p.waitForTimeout(500);
    await p.evaluate(async () => { await arAddExclusion('sv', '共有の除外'); });
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => ({
      db: window.__db.stats_exclusions.some(e => e.value === '共有の除外' && e.created_by),
      local: (localStorage.getItem('statsExclusions_v1') || '').includes('共有の除外'),
      get: arGetExclusions().map(e => e.value),
      notice: window.masterTopNoticeHtml(),
    }));
    ok(L + '追加はクラウドへ（このブラウザには書かない）', r.db && !r.local, r);
    ok(L + '読み出しはクラウドの除外リスト', r.get.includes('共有の除外') && !r.get.includes('ローカル除外'), r.get);
    ok(L + '移行の案内に除外リストの件数', r.notice.includes('<b>1</b><span>除外リスト</span>'), r.notice);
    await p.evaluate(() => { window.__mig = masterMigrateLocal(); });
    await confirmDlg(p, 'ok');
    await p.evaluate(() => window.__mig);
    await p.waitForTimeout(800);
    const r2 = await p.evaluate(() => ({ db: window.__db.stats_exclusions.some(e => e.value === 'ローカル除外'), cleared: localStorage.getItem('statsExclusions_v1') === null }));
    ok(L + '移行：このブラウザの除外リストをクラウドへ移して消す', r2.db && r2.cleared, r2);
    await p.evaluate(async () => { await arRemoveExclusion('sv', '共有の除外'); });
    ok(L + '解除はクラウドから', await p.evaluate(() => !window.__db.stats_exclusions.some(e => e.value === '共有の除外')));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 未ログイン：マスターは使わない・保存しない =====
  {
    const { ctx, p, errs } = await open(false);
    const L = '[未ログイン] ';
    const r = await p.evaluate(() => ({
      canon: nameCanon('nm', 'ターミナルハンドリングチャージ'),
      cands: [...document.getElementById('nmSuggestions').children].filter(o => o.dataset.master).map(o => o.value),
      notice: window.masterTopNoticeHtml(),
    }));
    ok(L + 'このブラウザのマスターは候補に出ない', !r.cands.includes('ローカル品名'), r);
    ok(L + '読み替えはしない（そのまま）', r.canon === 'ターミナルハンドリングチャージ', r);
    ok(L + 'マスター画面に「ログインしてください」', r.notice.includes('ログインしてください'), r.notice);
    const id = await rowId(p);
    const before = await p.evaluate(() => localStorage.getItem('masterDetails_v1'));
    await p.fill('#nm-' + id, 'ログインなし費用'); await p.evaluate(id => registerRowToMaster(id), id); await p.waitForTimeout(400);
    const after = await p.evaluate(() => localStorage.getItem('masterDetails_v1'));
    ok(L + 'マスター登録はこのブラウザに保存しない', before === after, { before, after });
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }


  // ===== バックアップからの復元・移行の安全確認・旧「担当」の表示 =====
  {
    const BK = { at: '2026-10-20T08:31:52.615Z',
      masterDetails_v1: JSON.stringify([
        { field: 'nm', value: 'AAA', details: {} },
        { field: 'customer', value: 'テスト商事', details: { furigana: 'てすとしょうじ', contact: '鈴木' } },
      ]),
      synonymGroups_v1: JSON.stringify([{ id: 'b1', field: 'customer', canonical: 'テスト商事', aliases: ['TEST SHOJI'] }]) };
    const { ctx, p, errs } = await open(true, { legacy: {}, backup: BK });
    const L = '[バックアップ復元] ';
    const n0 = await p.evaluate(() => window.masterTopNoticeHtml());
    ok(L + '復元の案内（空の詳細は数えず、詳細1件・同義グループ1件）', n0.includes('バックアップに残っています') && n0.includes('<b>1</b><span>マスター詳細</span>') && n0.includes('<b>1</b><span>同義グループ</span>'), n0);
    // 旧「担当」だけの詳細も、担当者として見える（一覧チップ・ポップアップ・サジェスト）
    const c0 = await p.evaluate(() => window.mdContactsOf({ contact: '鈴木' }));
    ok(L + '旧「担当」を担当者1名として扱う', c0.length === 1 && c0[0].name === '鈴木', c0);
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(800);
    const btn = await p.evaluate(() => !!document.querySelector('[onclick*="masterRestoreBackup"]'));
    ok(L + '画面に「戻してチームへ移す」ボタン', btn);
    p.evaluate(() => window.masterRestoreBackup());
    const d1 = await confirmDlg(p, 'ok');                 // バックアップを戻しますか？
    ok(L + '戻す確認画面', d1.text.includes('バックアップを戻しますか') && d1.text.includes('1'), d1.text);
    const d2 = await confirmDlg(p, 'ok');                 // チームへ移しますか？
    ok(L + '続けて「チームへ移す」の確認', d2.text.includes('チーム共有のマスターへ移します'), d2.text);
    await p.waitForTimeout(800);
    const r = await p.evaluate(() => ({
      md: (window.__db.master_details || []).find(m => m.value === 'テスト商事'),
      emptyMd: (window.__db.master_details || []).some(m => m.value === 'AAA'),
      syn: window.__db.synonym_groups.some(g => g.canonical === 'テスト商事' && g.aliases.includes('TEST SHOJI')),
      notice: window.masterTopNoticeHtml(),
      cleared: localStorage.getItem('masterDetails_v1') === null,
      chip: !!mdGet('customer', 'テスト商事'),
    }));
    ok(L + 'マスター詳細（ふりがな・旧「担当」）がクラウドへ', r.md && r.md.details.furigana === 'てすとしょうじ' && r.md.details.contact === '鈴木', r);
    ok(L + '同義グループもクラウドへ', r.syn, r);
    ok(L + '空の詳細（AAA）は登録しない', !r.emptyMd, r);
    ok(L + '移行後：案内が消え、このブラウザの分は空', r.notice === '' && r.cleared && r.chip, r);
    // 詳細の表示（一覧のチップと、見積タブのポップアップ）に旧「担当」が出る
    await p.evaluate(() => { statsSetPane && 0; }); 
    const shown = await p.evaluate(() => { document.getElementById('qf-customer') && (document.getElementById('qf-customer').value = 'テスト商事'); mdShowDetailPopup('customer', 'テスト商事'); return document.getElementById('cdBody').textContent; });
    ok(L + 'ポップアップに旧「担当」（鈴木）とふりがなが出る', shown.includes('鈴木') && shown.includes('てすとしょうじ'), shown);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  {
    // クラウドへ書けなかった場合は、このブラウザの分を消さない（消すと移せていないデータが失われる）
    const { ctx, p, errs } = await open(true, { legacy: { masterDetails_v1: [{ field: 'nm', value: '失敗する品名', details: { defaultUnit: 'B/L' } }] }, failDetailWrites: true });
    const L = '[移行の安全確認] ';
    p.evaluate(() => window.masterMigrateLocal());
    await confirmDlg(p, 'ok'); await p.waitForTimeout(1000);
    const r = await p.evaluate(() => ({ kept: (localStorage.getItem('masterDetails_v1') || '').includes('失敗する品名'), backup: !!localStorage.getItem('masterLocalBackup_v1'), toast: document.body.textContent.includes('移せませんでした') }));
    ok(L + '書けなかったときはこのブラウザの分を消さない', r.kept && !r.backup, r);
    ok(L + '移せなかった旨を画面に出す', r.toast, r);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  {
    // 1 行だけ不正でも、ほかは移せる。移せなかった分と理由は画面に残る
    const { ctx, p, errs } = await open(true, { badKey: 'BAD品名', legacy: { synonymGroups_v1: [
      { id: 'x1', field: 'nm', canonical: '良い品名A', aliases: ['GOOD A'] },
      { id: 'x2', field: 'nm', canonical: 'BAD品名', aliases: ['BAD B'] },
      { id: 'x3', field: 'nm', canonical: '良い品名C', aliases: ['GOOD C'] }] } });
    const L = '[移行の切り分け] ';
    p.evaluate(() => window.masterMigrateLocal());
    await confirmDlg(p, 'ok'); await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({
      good: ['良い品名A', '良い品名C'].every(c => window.__db.synonym_groups.some(g => g.canonical === c)),
      bad: window.__db.synonym_groups.some(g => g.canonical === 'BAD品名'),
      kept: (localStorage.getItem('synonymGroups_v1') || '').includes('BAD品名'),
      notice: window.masterTopNoticeHtml(),
    }));
    ok(L + '不正な 1 件があっても、ほかの 2 件は移せる', r.good && !r.bad, r);
    ok(L + '移せなかった分はこのブラウザに残す', r.kept, r);
    ok(L + '案内に件数（1 件）と理由・前回の失敗が残る', r.notice.includes('<b>1</b><span>同義グループ</span>') && r.notice.includes('前回の移行で移せなかったもの') && r.notice.includes('violates check constraint'), r.notice);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 別名（略称）の追加：マスター管理の「＋ 別名」 =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {} });
    const L = '[別名の追加] ';
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    const has = await p.evaluate(() => !!document.querySelector('#statsPane-master tr[data-mvalue="テスト運送"] .stats-master-abbrev-add'));
    ok(L + '個別マスター（サブコン）の行に「＋ 別名」', has);
    const rowIdx = () => p.evaluate(() => [...document.querySelectorAll('#statsPane-master tbody tr')].findIndex(r => r.dataset.mvalue === 'テスト運送'));
    const idx0 = await rowIdx();
    await p.click('#statsPane-master tr[data-mvalue="テスト運送"] .stats-master-abbrev-add');
    await p.fill('.stats-abbrev-input', 'テスト運輸'); await p.click('.stats-abbrev-ok'); await p.waitForTimeout(1200);
    const r = await p.evaluate(() => ({
      db: window.__db.synonym_groups.some(g => g.field === 'sv' && g.canonical === 'テスト運送' && (g.aliases || []).includes('テスト運輸')),
      // 代表の行（同じ行）に別名のチップが付く
      shown: [...document.querySelectorAll('#statsPane-master tr[data-mvalue="テスト運送"] .stats-syn-member')].some(e => e.textContent.includes('テスト運輸')),
      star: !!document.querySelector('#statsPane-master tr[data-mvalue="テスト運送"] .ua-star'),
      tables: document.querySelectorAll('#statsPane-master table.master-table').length,
      cand: nameCanon('sv', 'テスト運輸'),
    }));
    ok(L + 'クラウドの同義グループに別名が入る', r.db, r);
    ok(L + '行の位置が変わらない（別の表へ移らない）', idx0 >= 0 && idx0 === await rowIdx() && r.tables === 1, { idx0, tables: r.tables });
    ok(L + '代表の行の「別名・略称」に別名が付き、⭐になる', r.shown && r.star, r);
    // 同義グループの行にも「＋ 別名」で足せる（先の別名のチップは残る）
    await p.click('#statsPane-master tr[data-mvalue="テスト運送"] .stats-master-abbrev-add');
    await p.fill('.stats-abbrev-input', 'TEST UNSO'); await p.click('.stats-abbrev-ok'); await p.waitForTimeout(1200);
    const r2 = await p.evaluate(() => [...document.querySelectorAll('#statsPane-master tr[data-mvalue="テスト運送"] .stats-syn-member')].map(e => e.textContent.replace('✕', '')));
    ok(L + '同義グループの行にも別名を追加でき、先の別名も残る', r2.includes('テスト運輸') && r2.includes('TEST UNSO'), r2);
    ok(L + '別名が代表名に読み替えられる', r.cand === 'テスト運送', r);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  {
    // 書き込みに失敗したときは「統合しました」と出さず、理由を出す
    const { ctx, p, errs } = await open(true, { legacy: {}, badKey: 'テスト運輸' });
    const L = '[別名の追加・失敗] ';
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    await p.click('#statsPane-master tr[data-mvalue="テスト運送"] .stats-master-abbrev-add');
    await p.fill('.stats-abbrev-input', 'テスト運輸'); await p.click('.stats-abbrev-ok'); await p.waitForTimeout(1200);
    const r = await p.evaluate(() => ({
      db: window.__db.synonym_groups.some(g => (g.aliases || []).includes('テスト運輸')),
      okToast: [...document.querySelectorAll('.toast')].some(e => e.textContent.includes('統合しました')),
      warn: [...document.querySelectorAll('.toast')].map(e => e.textContent).find(t => t.includes('保存できませんでした') || t.includes('書き込め')) || '',
    }));
    ok(L + '書けなかった（DB には入らない）', !r.db, r);
    ok(L + '「統合しました」とは出さない', !r.okToast, r);
    ok(L + '失敗の理由を出す', /violates check constraint/.test(r.warn), r);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 単位の別名もクラウド共有／書き込みの順序（途中で失敗しても別名が消えない） =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[単位・順序] ';
    await p.evaluate(async () => { await synLoadCloud(); await uaAddAlias('CNTR', 'CONTAINER'); });
    await p.waitForTimeout(800);
    const r = await p.evaluate(() => ({
      db: window.__db.synonym_groups.some(g => g.field === 'un' && g.canonical === 'CONTAINER' && g.aliases.includes('CNTR')),
      local: localStorage.getItem('unitAlias_v1'),
      map: uaGetNormalizeMap().CNTR,
      groups: uaGetGroups().length,
    }));
    ok(L + '単位の別名はクラウドへ保存され、ブラウザには残さない', r.db && r.local === null, r);
    ok(L + '単位の別名が代表単位に読み替えられる', r.map === 'CONTAINER' && r.groups === 1, r);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  {
    // 付け替え先への書き込みに失敗しても、元の所属（別名）は消えない
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true, badKey: 'BADGROUP' });
    const L = '[付け替えの失敗] ';
    await p.evaluate(async () => {
      window.__db.synonym_groups.push({ id: 'g1', field: 'sv', canonical: 'GROUP1', aliases: ['AAA'] });
      await synLoadCloud();
      await synAddAlias('sv', 'AAA', 'BADGROUP');
    });
    await p.waitForTimeout(800);
    ok(L + '失敗しても、元のグループの別名が残る', await p.evaluate(() => window.__db.synonym_groups.some(g => g.canonical === 'GROUP1' && g.aliases.includes('AAA'))));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== サブコン詳細：種別（複数選択・あとから追加できる） =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[サブコン種別] ';
    await p.evaluate(async () => {
      window.__db.master_votes.push({ field: 'sv', value: 'テスト運送', voter_email: 's@example.com' });
      window.__db.master_votes.push({ field: 'sv', value: '別の会社', voter_email: 's@example.com' });
      window.__db.master_details.push({ field: 'sv', value: '別の会社', details: { svTypes: ['保税蔵置場'] } });
      await statsLoadMasterCache(); await mdLoadCloud();
    });
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="テスト運送"] .stats-master-detail-btn').click());
    await p.waitForTimeout(300);
    const presets = await p.evaluate(() => [...document.querySelectorAll('.master-type-preset')].map(b => b.textContent));
    ok(L + 'ひな形 9 種が並ぶ', ['通関業者', '倉庫業者', '運送業者', 'FCL CARRIER', 'LCL CARRIER', 'AIR CARRIER', '海外代理店', '保険会社', 'サーベイヤー'].every(t => presets.includes(t)), presets);
    ok(L + 'ほかの人が追加した種別も候補に出る', presets.includes('保税蔵置場'), presets);
    await p.click('.master-type-preset:text("通関業者")'); await p.click('.master-type-preset:text("倉庫業者")');
    await p.fill('#md_svTypes_input', 'トラック手配'); await p.keyboard.press('Enter');
    await p.click('.master-detail-save'); await p.waitForTimeout(800);
    const d = await p.evaluate(() => (window.__db.master_details.find(m => m.value === 'テスト運送') || {}).details);
    ok(L + '複数の種別（ひな形＋自由入力）が保存される', d && JSON.stringify(d.svTypes) === JSON.stringify(['通関業者', '倉庫業者', 'トラック手配']), d);
    ok(L + '一覧の名称欄にも種別が出る', await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="テスト運送"]').textContent.includes('通関業者')));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== マスター管理：サブコン種別の絞り込み・画面幅からはみ出さない（Industry） =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[種別絞り込み・幅] ';
    await p.setViewportSize({ width: 1240, height: 900 });
    await p.evaluate(() => { document.documentElement.classList.add('theme-industry'); document.querySelector('link[data-theme-css="site"]').media = 'all'; });
    await p.evaluate(async () => {
      const add = (v, t) => { window.__db.master_votes.push({ field: 'sv', value: v, voter_email: 's@example.com' }); if (t) window.__db.master_details.push({ field: 'sv', value: v, details: { svTypes: t } }); };
      add('通関A', ['通関業者']); add('倉庫B', ['倉庫業者']); add('兼業C', ['通関業者', '倉庫業者']); add('未設定D');
      window.__db.master_votes.push({ field: 'customer', value: '長い名前のお客様株式会社 東京営業所', voter_email: 's@example.com' });
      window.__db.synonym_groups.push({ id: 'z1', field: 'customer', canonical: '長い名前のお客様株式会社 東京営業所', aliases: ['別名１', '別名２', 'VERYLONGALIASNAMEWITHOUTANYSPACEFORLAYOUTTESTING1234567890VERYLONGALIASNAMEWITHOUTANYSPACE', '長い別名の会社名株式会社東京営業所第二営業部門担当窓口サービスセンター'] });
      await statsLoadMasterCache(); await mdLoadCloud(); await synLoadCloud();
    });
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    const over = () => p.evaluate(() => { const t = document.querySelector('#statsPane-master table.master-table'); const c = document.querySelector('#tab-master'); return { t: Math.round(t.getBoundingClientRect().right), c: Math.round(c.getBoundingClientRect().right), vw: innerWidth, sw: document.documentElement.scrollWidth }; });
    let o = await over();
    ok(L + '表が枠（と画面）の幅をはみ出さない', o.t <= o.c + 1 && o.sw <= o.vw + 1, o);
    // 他のマスターにまとめる（ピッカー展開）でもはみ出さない
    await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue^="長い名前"] .stats-master-merge').click()); await p.waitForTimeout(300);
    o = await over();
    ok(L + 'ピッカー展開時もはみ出さない', o.t <= o.c + 1 && o.sw <= o.vw + 1, o);
    await p.evaluate(() => statsMasterSetFilter('sv')); await p.waitForTimeout(300);
    const chips = await p.evaluate(() => [...document.querySelectorAll('.master-type-chip')].map(b => b.textContent));
    ok(L + 'サブコンのときだけ種別チップ（件数つき・未設定あり）', chips.includes('通関業者2') && chips.includes('倉庫業者2') && chips.some(c => c.startsWith('未設定')), chips);
    await p.click('.master-type-chip:has-text("倉庫業者")'); await p.waitForTimeout(300);
    const rows = await p.evaluate(() => [...document.querySelectorAll('#statsPane-master tbody tr[data-mvalue]')].map(r => r.dataset.mvalue).sort());
    ok(L + '倉庫業者で絞り込み（兼業も含む）', JSON.stringify(rows) === JSON.stringify(['倉庫B', '兼業C']), rows);
    await p.click('.master-type-chip:has-text("未設定")'); await p.waitForTimeout(300);
    ok(L + '未設定で絞り込み（種別ありの会社は出ない）', await p.evaluate(() => [...document.querySelectorAll('#statsPane-master tbody tr[data-mvalue]')].map(r => r.dataset.mvalue).includes('未設定D')));
    // 並び順：種別ごとにまとめる（兼業は両方の下に出る・種別なしは最後）
    await p.evaluate(() => { statsMasterSetSvType(''); statsMasterSetSort('tag'); }); await p.waitForTimeout(300);
    const grp = await p.evaluate(() => {
      const out = []; let cur = null;
      document.querySelectorAll('#statsPane-master tbody tr').forEach(r => {
        if (r.classList.contains('master-tag-group-row')) { cur = { head: r.textContent.replace(/\s+/g, ' ').trim(), rows: [] }; out.push(cur); }
        else if (r.dataset.mvalue && cur) cur.rows.push(r.dataset.mvalue);
      });
      return out;
    });
    const byHead = k => grp.find(x => x.head.includes(k)) || { rows: [] };
    ok(L + '種別ごとの見出しの下に並ぶ（兼業は両方に出る）', byHead('通関業者').rows.includes('通関A') && byHead('通関業者').rows.includes('兼業C') && byHead('倉庫業者').rows.includes('倉庫B') && byHead('倉庫業者').rows.includes('兼業C'), grp);
    ok(L + '種別なしは最後にまとまる', grp.length > 2 && grp[grp.length - 1].head.includes('種別なし') && grp[grp.length - 1].rows.includes('未設定D'), grp);
    await p.evaluate(() => statsMasterSetSort('name')); await p.waitForTimeout(200);
    ok(L + '名前順に戻すと見出しは消える', await p.evaluate(() => !document.querySelector('.master-tag-group-row')));
    await p.evaluate(() => statsMasterSetFilter('customer')); await p.waitForTimeout(300);
    ok(L + 'サブコン以外では種別チップを出さない', await p.evaluate(() => !document.querySelector('.master-type-chip')));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== お客様詳細：ウェブサイトのリンクチップ・担当者ごとの所在地 =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[お客様詳細] ';
    await p.evaluate(async () => {
      window.__db.master_votes.push({ field: 'customer', value: 'リンク商事', voter_email: 's@example.com' });
      window.__db.master_votes.push({ field: 'customer', value: '危険商事', voter_email: 's@example.com' });
      window.__db.master_details.push({ field: 'customer', value: 'リンク商事', details: { website: 'www.example.com/top/', contacts: [{ name: '山田', location: '大阪支店', dept: '海外営業部 第2課' }] } });
      window.__db.master_details.push({ field: 'customer', value: '危険商事', details: { website: 'javascript:alert(1)' } });
      await statsLoadMasterCache(); await mdLoadCloud();
    });
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    const a = await p.evaluate(() => { const e = document.querySelector('#statsPane-master tr[data-mvalue="リンク商事"] a.stats-md-link'); return e && { href: e.getAttribute('href'), target: e.target, rel: e.rel, text: e.textContent }; });
    ok(L + 'ウェブサイトがリンクチップ（https を補い、新しいタブで開く）', a && a.href === 'https://www.example.com/top/' && a.target === '_blank' && /noopener/.test(a.rel), a);
    ok(L + 'javascript: などはリンクにしない', await p.evaluate(() => !document.querySelector('#statsPane-master tr[data-mvalue="危険商事"] a.stats-md-link') && !!document.querySelector('#statsPane-master tr[data-mvalue="危険商事"] .stats-md-inline')));
    ok(L + '担当者に所在地があると一覧に印（📍）', await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="リンク商事"]').textContent.includes('📍')));
    await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="リンク商事"] .stats-master-detail-btn').click()); await p.waitForTimeout(300);
    ok(L + '編集欄に担当者の所在地が入っている', await p.evaluate(() => document.querySelector('.md-contact-location').value === '大阪支店'));
    ok(L + '編集欄に担当者の所属部署・課が入っている', await p.evaluate(() => document.querySelector('.md-contact-dept').value === '海外営業部 第2課'));
    await p.fill('.md-contact-dept', '国際物流部 通関課');
    await p.fill('.md-contact-location', '東京本社 3F'); await p.click('.master-detail-save'); await p.waitForTimeout(800);
    ok(L + '担当者の所在地が保存される', await p.evaluate(() => window.__db.master_details.find(m => m.value === 'リンク商事').details.contacts[0].location === '東京本社 3F' && window.__db.master_details.find(m => m.value === 'リンク商事').details.contacts[0].dept === '国際物流部 通関課'));
    // お客様：タグでの絞り込み・担当者の表示は「様」付き（入力は敬称略）
    await p.evaluate(async () => {
      window.__db.master_votes.push({ field: 'customer', value: 'タグ商事', voter_email: 's@example.com' });
      window.__db.master_details.push({ field: 'customer', value: 'タグ商事', details: { tags: ['化学品', 'DG品'], contacts: [{ name: '幸崎' }] } });
      await statsLoadMasterCache(); await mdLoadCloud(); statsMasterSetFilter('customer');
    });
    await p.waitForTimeout(300);
    const tchips = await p.evaluate(() => [...document.querySelectorAll('.master-type-chip')].map(b => b.textContent));
    ok(L + 'お客様のときはタグの絞り込みチップが出る', tchips.includes('化学品1') && tchips.includes('DG品1'), tchips);
    await p.click('.master-type-chip:has-text("化学品")'); await p.waitForTimeout(300);
    ok(L + 'タグで絞り込める', await p.evaluate(() => [...document.querySelectorAll('#statsPane-master tbody tr[data-mvalue]')].map(r => r.dataset.mvalue).join() === 'タグ商事'));
    ok(L + '一覧の担当者は「様」付きで表示', await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="タグ商事"]').textContent.includes('幸崎 様')));
    ok(L + '保存される担当者名は敬称なしのまま', await p.evaluate(() => window.__db.master_details.find(m => m.value === 'タグ商事').details.contacts[0].name === '幸崎'));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 取引ルール（お客様・担当者ごと） =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[取引ルール] ';
    await p.evaluate(async () => {
      window.__db.master_votes.push({ field: 'customer', value: 'ルール商事', voter_email: 's@example.com' });
      window.__db.master_details.push({ field: 'customer', value: 'ルール商事', details: { contacts: [{ name: '幸崎' }, { name: '山田' }] } });
      await statsLoadMasterCache(); await mdLoadCloud();
    });
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    await p.evaluate(() => { statsMasterSetFilter('customer'); }); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="ルール商事"] .stats-master-detail-btn').click()); await p.waitForTimeout(600);
    ok(L + 'お客様の詳細に取引ルール欄が出る', await p.evaluate(() => !!document.querySelector('#crPanel .cr-form')));
    ok(L + '対象に「お客様全体」と担当者が選べる', await p.evaluate(() => [...document.querySelectorAll('#crPanel .cr-f-contact option')].map(o => o.textContent).join('|').includes('幸崎')));
    // お客様全体の厳守ルールと、幸崎様だけの要確認ルールを登録
    await p.selectOption('#crPanel .cr-f-level', 'strict'); await p.fill('#crPanel .cr-f-body', '請求書は月末締め・翌月10日必着');
    await p.click('#crPanel [data-cr="save"]'); await p.waitForTimeout(600);
    await p.selectOption('#crPanel .cr-f-contact', '幸崎'); await p.selectOption('#crPanel .cr-f-level', 'check'); await p.fill('#crPanel .cr-f-body', '見積はUSD建て併記'); await p.fill('#crPanel .cr-f-reason', '2026-10 案件で指摘');
    await p.click('#crPanel [data-cr="save"]'); await p.waitForTimeout(600);
    const rows = await p.evaluate(() => window.__db.customer_rules.map(r => ({ c: r.customer, p: r.contact, l: r.level, b: r.body, by: r.created_by })));
    ok(L + '2 件がクラウドに保存される（お客様全体／担当者別）', rows.length === 2 && rows.some(r => r.l === 'strict' && !r.p) && rows.some(r => r.l === 'check' && r.p === '幸崎'), rows);
    ok(L + '一覧に厳守・要確認のバッジが並ぶ', await p.evaluate(() => !!document.querySelector('#crPanel .cr-badge-strict') && !!document.querySelector('#crPanel .cr-badge-check')));
    // 見積タブのバナー：お客様だけ → 全体ルールのみ（担当者別は件数だけ）／担当者を入れる → 担当者のルールも
    await p.evaluate(async () => { document.getElementById('qf-customer').value = 'ルール商事'; document.getElementById('qf-person').value = ''; await crRefreshBanner(); });
    let t = await p.evaluate(() => { const b = document.getElementById('crBanner'); return { hidden: b.hidden, text: b.textContent.replace(/\s+/g, ' ') }; });
    ok(L + '見積：お客様を選ぶとバナーが出て、厳守は開いて表示', !t.hidden && t.text.includes('請求書は月末締め') && t.text.includes('担当者別 1件'), t);
    ok(L + '見積：担当者別ルールは担当者未入力では本文を出さない', !t.text.includes('USD建て'), t);
    await p.evaluate(async () => { document.getElementById('qf-person').value = '幸崎 様'; await crRefreshBanner(); });
    t = await p.evaluate(() => document.getElementById('crBanner').textContent.replace(/\s+/g, ' '));
    ok(L + '見積：担当者（敬称付きでも）を入れるとその担当者のルールも出る', t.includes('USD建て併記') && t.includes('請求書は月末締め'), t);
    await p.evaluate(async () => { document.getElementById('qf-person').value = '山田'; await crRefreshBanner(); });
    ok(L + '見積：別の担当者のルールは出ない', await p.evaluate(() => !document.getElementById('crBanner').textContent.includes('USD建て')));
    // 見積タブからの追加
    await p.evaluate(async () => { document.getElementById('qf-person').value = '幸崎'; await crRefreshBanner(); });
    await p.evaluate(() => document.querySelector('#crBanner [data-cr="addtoggle"]').click()); await p.waitForTimeout(300);
    await p.evaluate(() => { document.querySelector('#crBanner .cr-f-body').value = 'メールはCCに上司を入れる'; document.querySelector('#crBanner [data-cr="save"]').click(); }); await p.waitForTimeout(800);
    ok(L + '見積タブからもルールを追加できる', await p.evaluate(() => window.__db.customer_rules.length === 3 && document.getElementById('crBanner').textContent.includes('CCに上司')));
    // 廃止すると見積に出ない／出力（御見積書・プレビュー）には出ない
    await p.evaluate(async () => { await crSetStatus(window.__db.customer_rules[0].id, 'retired'); });
    ok(L + '廃止したルールは見積に出ない', await p.evaluate(() => crFor('ルール商事', '幸崎').list.every(r => r.status !== 'retired')));
    ok(L + 'お客様向けの出力にはルールを入れない', await p.evaluate(() => typeof buildQuoteDocHTML !== 'function' || !buildQuoteDocHTML().includes('取引ルール')));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 取引ルール：案件から作る（背景の自動入力）・再確認の運用 =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[ルールの育て方] ';
    const old = new Date(Date.now() - 200 * 86400000).toISOString();
    await p.evaluate(async (old) => {
      window.__db.master_votes.push({ field: 'customer', value: '古いルール商事', voter_email: 's@example.com' });
      window.__db.customer_rules = [
        { id: 'r1', customer: '古いルール商事', contact: null, level: 'strict', body: '古い決まりごと', status: 'active', created_by: 's@example.com', created_at: old, confirmed_at: old },
        { id: 'r2', customer: '古いルール商事', contact: null, level: 'memo', body: '最近確認したメモ', status: 'active', created_by: 's@example.com', created_at: new Date().toISOString(), confirmed_at: new Date().toISOString() },
      ];
      await statsLoadMasterCache();
    }, old);
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1500);
    await p.evaluate(() => statsMasterSetFilter('customer')); await p.waitForTimeout(500);
    const m = await p.evaluate(() => ({ chip: (document.querySelector('#statsPane-master tr[data-mvalue="古いルール商事"] .cr-chip') || {}).textContent, notice: (document.querySelector('.cr-stale-notice') || {}).textContent }));
    ok(L + 'マスター管理の一覧に「📌 ルール2件 ⛔1 ⏳1」の印', m.chip && m.chip.includes('ルール2件') && m.chip.includes('⛔1') && m.chip.includes('⏳1'), m);
    ok(L + '再確認が必要なルールの案内が出る', m.notice && m.notice.includes('古いルール商事') && m.notice.includes('1件'), m);
    // 見積タブ：背景に案件番号が入る・古いルールに「いまも有効」
    await p.evaluate(async () => { document.getElementById('qf-ref').value = '2026-077'; document.getElementById('qf-customer').value = '古いルール商事'; document.getElementById('qf-person').value = ''; await crRefreshBanner(); });
    let t = await p.evaluate(() => document.getElementById('crBanner').textContent.replace(/\s+/g, ' '));
    ok(L + '見積：⏳ 再確認 1件 と「いまも有効」ボタン', t.includes('再確認 1件') && t.includes('いまも有効'), t);
    ok(L + '見積：ボタンが「この案件で気づいたことをルールにする」', t.includes('この案件で気づいたことをルールにする'), t);
    await p.evaluate(() => document.querySelector('#crBanner [data-cr="addtoggle"]').click()); await p.waitForTimeout(300);
    ok(L + '見積：背景に「案件 2026-077 で判明」が入った状態で開く', await p.evaluate(() => document.querySelector('#crBanner .cr-f-reason').value === '案件 2026-077 で判明'));
    await p.evaluate(() => document.querySelector('#crBanner [data-cr="addtoggle"]').click());
    await p.evaluate(() => document.querySelector('#crBanner [data-cr="confirm"]').click()); await p.waitForTimeout(800);
    const r1 = await p.evaluate(() => ({ at: window.__db.customer_rules.find(r => r.id === 'r1').confirmed_at, txt: document.getElementById('crBanner').textContent }));
    ok(L + '「いまも有効」で最終確認日が今日になり、再確認の表示が消える', Date.now() - new Date(r1.at).getTime() < 3600000 && !r1.txt.includes('再確認'), r1);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== マスターの詳細はポップアップ（画面いっぱいに広がらない） =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[詳細ポップアップ] ';
    await p.setViewportSize({ width: 1400, height: 800 });
    await p.evaluate(async () => {
      window.__db.master_votes.push({ field: 'customer', value: 'ポップ商事', voter_email: 's@example.com' });
      window.__db.master_details.push({ field: 'customer', value: 'ポップ商事', details: { contacts: [{ name: '幸崎', dept: '海外営業部', title: '課長', phone: '03-0000-0000', email: 'k@example.com', location: '大阪支店' }], tags: ['化学品'], website: 'example.com' } });
      await statsLoadMasterCache(); await mdLoadCloud();
    });
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    await p.evaluate(() => statsMasterSetFilter('customer')); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="ポップ商事"] .stats-master-detail-btn').click()); await p.waitForTimeout(600);
    const g = await p.evaluate(() => { const m = document.querySelector('#mdDetailModal .md-modal'); const r = m.getBoundingClientRect(); return { x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, pos: getComputedStyle(document.getElementById('mdDetailModal')).position, title: m.querySelector('h3').textContent, inline: !!document.querySelector('.stats-detail-row') }; });
    ok(L + '詳細がポップアップ（画面に固定・幅は画面いっぱいにならない・高さは画面内）', g.pos === 'fixed' && g.w <= 980 && g.w < g.vw && g.h <= g.vh && !g.inline, g);
    ok(L + '見出しに種別と名前が出る', g.title.includes('お客様') && g.title.includes('ポップ商事'), g);
    ok(L + '背景の画面はスクロールしない', await p.evaluate(() => document.body.classList.contains('md-modal-open')));
    if (process.env.OUT) await p.screenshot({ path: require('path').join(process.env.OUT, 'master-detail-modal.png') });
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(L + 'Esc で閉じる', await p.evaluate(() => !document.getElementById('mdDetailModal') && !document.body.classList.contains('md-modal-open')));
    await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="ポップ商事"] .stats-master-detail-btn').click()); await p.waitForTimeout(400);
    await p.fill('#md_furigana', 'ぽっぷしょうじ'); await p.click('.master-detail-save'); await p.waitForTimeout(800);
    ok(L + '保存すると保存されて閉じる', await p.evaluate(() => !document.getElementById('mdDetailModal') && window.__db.master_details.find(m => m.value === 'ポップ商事').details.furigana === 'ぽっぷしょうじ'));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 所属グループ（グループ傘下の別会社をつなぐ） =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[所属グループ] ';
    await p.evaluate(async () => {
      const add = (f, v, g) => { window.__db.master_votes.push({ field: f, value: v, voter_email: 's@example.com' }); if (g) window.__db.master_details.push({ field: f, value: v, details: { group: g } }); };
      add('sv', 'CMA CGM', 'CMA CGM グループ'); add('sv', 'ANL', 'CMA CGM グループ'); add('sv', 'APL', 'CMA CGM グループ'); add('sv', 'ONE', 'ONE グループ'); add('sv', '単独社');
      add('carrier', 'CNC', 'CMA CGM グループ'); add('carrier', 'CMA CGM', 'CMA CGM グループ');
      await statsLoadMasterCache(); await mdLoadCloud();
    });
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    await p.evaluate(() => statsMasterSetFilter('sv')); await p.waitForTimeout(300);
    ok(L + 'サブコンのとき「所属グループごとにまとめる」が選べる', await p.evaluate(() => [...document.querySelectorAll('.master-sort-chip')].some(b => b.textContent.includes('所属グループ'))));
    await p.evaluate(() => statsMasterSetSort('group')); await p.waitForTimeout(300);
    const grp = await p.evaluate(() => {
      const out = []; let cur = null;
      document.querySelectorAll('#statsPane-master tbody tr').forEach(r => {
        if (r.classList.contains('master-tag-group-row')) { cur = { head: r.textContent.replace(/\s+/g, ' ').trim(), rows: [] }; out.push(cur); }
        else if (r.dataset.mvalue && cur) cur.rows.push(r.dataset.mvalue);
      });
      return out;
    });
    const cma = grp.find(x => x.head.includes('CMA CGM グループ')) || { rows: [] };
    ok(L + 'グループの見出しの下に傘下の会社が並ぶ（3社）', cma.head && cma.head.includes('3社') && ['CMA CGM', 'ANL', 'APL'].every(n => cma.rows.includes(n)), grp);
    ok(L + 'グループなしは最後', grp[grp.length - 1].head.includes('グループなし') && grp[grp.length - 1].rows.includes('単独社'), grp);
    await p.evaluate(() => statsMasterSetFilter('carrier')); await p.waitForTimeout(300);
    ok(L + 'キャリアでも選べる（種別チップは出ない）', await p.evaluate(() => [...document.querySelectorAll('.master-sort-chip')].some(b => b.textContent.includes('所属グループ')) && !document.querySelector('.master-type-chip')));
    // 詳細の入力欄：グループ名の候補に、入力済みの名前が出る
    await p.evaluate(() => statsMasterSetFilter('sv')); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="単独社"] .stats-master-detail-btn').click()); await p.waitForTimeout(500);
    const opts = await p.evaluate(() => [...document.querySelectorAll('#md_group_list option')].map(o => o.value));
    ok(L + '詳細の「所属グループ」欄に、入力済みのグループ名が候補で出る', opts.includes('CMA CGM グループ') && opts.includes('ONE グループ'), opts);
    await p.fill('#md_group', 'ONE グループ'); await p.click('.master-detail-save'); await p.waitForTimeout(700);
    ok(L + '所属グループが保存される', await p.evaluate(() => window.__db.master_details.find(m => m.value === '単独社').details.group === 'ONE グループ'));
    // 統計タブ：グループ別の合計（使用件数を合算）
    const sum = await p.evaluate(() => { const box = document.createElement('div'); box.innerHTML = statsGroupSummaryHtml('sv', { 'CMA CGM': 5, 'ANL': 3, 'APL': 2, 'APL JAPAN': 1, 'ONE': 4 }, { 'APL JAPAN': 'APL' }); return box.textContent.replace(/\s+/g, ' '); });
    ok(L + '統計：グループ別の合計（別名の件数も傘下の会社に合算）', sum.includes('CMA CGM グループ') && sum.includes('3社') && sum.includes('11') && sum.includes('ANL 3') && sum.includes('APL 3'), sum);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== サブコンとキャリアの統合（段階 1）：サブコンのマスター（種別がキャリア）を、キャリア候補・ブックマークの会社名候補に出す =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[キャリアの候補] ';
    await p.evaluate(async () => {
      const add = (v, t) => { window.__db.master_votes.push({ field: 'sv', value: v, voter_email: 's@example.com' }); window.__db.master_details.push({ field: 'sv', value: v, details: { svTypes: t } }); };
      add('ABC LINE', ['FCL CARRIER']); add('山田海運', ['RORO CARRIER']); add('北星在来', ['在来船 CARRIER']); add('通関X', ['通関業者']); add('兼業社', ['通関業者', 'AIR CARRIER']);
      await statsLoadMasterCache(); await mdLoadCloud();
    });
    const names = t => p.evaluate(x => mdCarrierNames(x), t);
    const all = await names();
    ok(L + '種別がキャリア系のサブコンだけが対象（通関業者は含まない）', all.includes('ABC LINE') && all.includes('山田海運') && all.includes('北星在来') && all.includes('兼業社') && !all.includes('通関X'), all);
    ok(L + 'ブックマーク種別ごとに絞れる（FCL／RORO／在来船／AIR）', (await names('FCL')).join() === 'ABC LINE' && (await names('RORO')).join() === '山田海運' && (await names('BREAKBULK')).join() === '北星在来' && (await names('AIR')).join() === '兼業社');
    ok(L + 'サブコン種別のひな形に RORO CARRIER と 在来船 CARRIER がある', await p.evaluate(() => { const s = MD_SCHEMA.sv.find(x => x.key === 'svTypes'); return s.presets.includes('RORO CARRIER') && s.presets.includes('在来船 CARRIER'); }));
    await p.evaluate(() => qfRefreshCarrierMasterCandidates('RORO'));
    let opts = await p.evaluate(() => [...document.querySelectorAll('#carriers-dl option')].map(o => o.value));
    ok(L + '幹線輸送のキャリア候補（RORO のとき）にサブコンのマスターが出る', opts.includes('山田海運') && !opts.includes('ABC LINE'), opts.slice(-6));
    await p.evaluate(() => qfRefreshCarrierMasterCandidates('FCL'));
    opts = await p.evaluate(() => [...document.querySelectorAll('#carriers-dl option')].map(o => o.value));
    ok(L + '輸送モードを変えると候補も入れ替わる（FCL のとき）', opts.includes('ABC LINE') && !opts.includes('山田海運'), opts.slice(-6));
    ok(L + 'キャリア系の判定（在来船 CARRIER・大文字小文字）', await p.evaluate(() => mdIsCarrierType('在来船 CARRIER') && mdIsCarrierType('roro  carrier') && !mdIsCarrierType('通関業者')));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== サブコンとキャリアの統合・段階 2 の前：移行の影響範囲（読み取りのみ） =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[統合の影響範囲] ';
    await p.evaluate(async () => {
      const v = (f, n) => window.__db.master_votes.push({ field: f, value: n, voter_email: 's@example.com' });
      v('carrier', 'ONE'); v('carrier', 'Yang Ming'); v('carrier', 'MSC');
      v('sv', 'YANG MING'); v('sv', 'Mediterranean'); v('sv', '通関X');
      window.__db.synonym_groups.push({ id: 'c1', field: 'carrier', canonical: 'MSC', aliases: ['Mediterranean'] });
      window.__db.master_details.push({ field: 'carrier', value: 'Yang Ming', details: { enName: 'Yang Ming Marine', group: 'YM' } });
      window.__db.master_details.push({ field: 'sv', value: 'YANG MING', details: { enName: 'YML', svTypes: ['FCL CARRIER'] } });
      await statsLoadMasterCache(); await synLoadCloud(); await mdLoadCloud();
    });
    const before = await p.evaluate(() => JSON.stringify([window.__db.master_votes, window.__db.master_details, window.__db.synonym_groups]));
    const r = await p.evaluate(() => statsCarrierMigrationReport());
    ok(L + '対象はキャリアのマスター 3 件（ONE／Yang Ming／MSC）', r.ok && r.total === 3, r);
    ok(L + 'そのまま移せる 1（ONE）／合流が要る 1（Yang Ming＝YANG MING・表記違いでも同じ会社）／要判断 1（MSC の別名がサブコンと一致）', r.move === 1 && r.merge === 1 && r.decide === 1, { m: r.move, g: r.merge, d: r.decide });
    const ym = r.items.find(i => i.name === 'Yang Ming');
    ok(L + '合流の相手と、詳細の食い違い（英語名称）が分かる', ym.sameSv === 'YANG MING' && ym.conflictKeys.includes('enName'), ym);
    ok(L + '要判断の理由（別名 Mediterranean がサブコンの名前と一致）', r.items.find(i => i.name === 'MSC').aliasHits.includes('Mediterranean'));
    ok(L + 'データは変更しない（読み取りのみ）', before === await p.evaluate(() => JSON.stringify([window.__db.master_votes, window.__db.master_details, window.__db.synonym_groups])));
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1000);
    await p.evaluate(() => statsMasterSetFilter('carrier')); await p.waitForTimeout(300);
    ok(L + 'キャリアを見ているときだけ「影響範囲を確認する」ボタンが出る', await p.evaluate(() => !!document.querySelector('.cm-entry-btn')));
    await p.evaluate(() => statsShowCarrierMigrationReport()); await p.waitForTimeout(800);
    ok(L + '画面に分類と件数が出る', await p.evaluate(() => { const t = document.querySelector('#cmReportModal').textContent; return t.includes('そのまま移せる') && t.includes('合流が要る') && t.includes('要判断'); }));
    await p.evaluate(() => statsMasterSetFilter('sv')); await p.waitForTimeout(200);
    ok(L + 'サブコンでは出ない', await p.evaluate(() => !document.querySelector('.cm-entry-btn')));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== キャリア→サブコン統合・段階 2：変更一覧と移行の実行（管理者のみ・元のキャリアは残す・何度でも安全） =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true, role: 'admin' });
    const L = '[キャリア移行] ';
    await p.evaluate(async () => {
      const v = (f, n) => window.__db.master_votes.push({ field: f, value: n, voter_email: 's@example.com' });
      v('carrier', 'ONE'); v('carrier', 'Yang Ming'); v('carrier', 'MSC'); v('carrier', 'HMM');
      v('sv', 'YANG MING'); v('sv', 'Mediterranean'); v('sv', '通関X'); v('sv', 'HMM');
      window.__db.synonym_groups.push({ id: 'c1', field: 'carrier', canonical: 'MSC', aliases: ['Mediterranean'] });
      window.__db.synonym_groups.push({ id: 'c2', field: 'carrier', canonical: 'ONE', aliases: ['Ocean Network Express'] });
      window.__db.master_details.push({ field: 'carrier', value: 'Yang Ming', details: { enName: 'Yang Ming Marine', group: 'YM' } });
      window.__db.master_details.push({ field: 'sv', value: 'YANG MING', details: { enName: 'YML', svTypes: ['FCL CARRIER'] } });
      window.__db.master_details.push({ field: 'carrier', value: 'ONE', details: { enName: 'Ocean Network Express Pte' } });
      window.bmCarrierNamesForType = t => t === 'FCL' ? ['ONE', 'Yang Ming', 'MSC', 'HMM'] : [];
      await statsLoadMasterCache(); await synLoadCloud(); await mdLoadCloud();
    });
    const snap = () => p.evaluate(() => JSON.stringify(window.__db.master_votes.filter(x => x.field === 'carrier')));
    const carrierBefore = await snap();
    const plan = await p.evaluate(() => cmBuildPlan());
    const by = n => plan.steps.find(x => x.carrier === n) || {};
    ok(L + '変更一覧：ONE は新規登録・種別 FCL CARRIER・別名とその詳細を引き継ぐ', by('ONE').create && by('ONE').addTypes.includes('FCL CARRIER') && by('ONE').addAliases.includes('Ocean Network Express') && by('ONE').fillKeys.includes('enName'), by('ONE'));
    ok(L + '変更一覧：Yang Ming は YANG MING へ合流（空欄のグループだけ補い、英語名称は食い違いでも上書きしない・別名を足す）', by('Yang Ming').target === 'YANG MING' && by('Yang Ming').fillKeys.join() === 'group' && by('Yang Ming').addAliases.includes('Yang Ming') && !by('Yang Ming').addTypes.length, by('Yang Ming'));
    ok(L + '変更一覧：MSC は別名が一致する Mediterranean へ合流し、MSC を別名に足す', by('MSC').target === 'Mediterranean' && by('MSC').addAliases.includes('MSC'), by('MSC'));
    ok(L + '変更一覧：サブコンに同じ HMM があれば新規は作らず、種別だけ足す', by('HMM').target === 'HMM' && !by('HMM').create && by('HMM').addTypes.includes('FCL CARRIER'), by('HMM'));
    // 管理者でないと実行できない
    const noAdmin = await p.evaluate(async () => { const keep = window._myRole; window._myRole = 'member'; const r = await cmExecute({ backup: false }); window._myRole = keep; return r; });
    ok(L + '管理者でなければ実行できない', noAdmin.ok === false && noAdmin.reason === 'not-admin', noAdmin);
    const run = await p.evaluate(() => cmExecute({ backup: false }));
    ok(L + '実行できて、残りは 0', run.ok && run.applied === plan.steps.length && run.remaining === 0 && run.fail.length === 0, run);
    const st = await p.evaluate(() => ({
      svVotes: window.__db.master_votes.filter(x => x.field === 'sv').map(x => x.value),
      one: (window.__db.master_details.find(d => d.field === 'sv' && d.value === 'ONE') || {}).details,
      ym: (window.__db.master_details.find(d => d.field === 'sv' && d.value === 'YANG MING') || {}).details,
      grp: window.__db.synonym_groups.filter(g => g.field === 'sv').map(g => g.canonical + ':' + (g.aliases || []).join('|')),
    }));
    ok(L + 'ONE がサブコンのマスターになり、種別・詳細が入る', st.svVotes.includes('ONE') && st.one && st.one.svTypes.includes('FCL CARRIER') && st.one.enName === 'Ocean Network Express Pte', st);
    ok(L + 'YANG MING：グループを補い、英語名称は元のまま', st.ym && st.ym.group === 'YM' && st.ym.enName === 'YML', st.ym);
    ok(L + '別名が入る（YANG MING←Yang Ming、Mediterranean←MSC、ONE←Ocean Network Express）', st.grp.some(g => g.startsWith('YANG MING:') && g.includes('Yang Ming')) && st.grp.some(g => g.startsWith('Mediterranean:') && g.includes('MSC')) && st.grp.some(g => g.startsWith('ONE:') && g.includes('Ocean Network Express')), st.grp);
    ok(L + '元のキャリアのマスターは残る', await snap() === carrierBefore);
    const again = await p.evaluate(() => cmExecute({ backup: false }));
    ok(L + 'もう一度実行しても、変更なし（二重にならない）', again.ok && again.applied === 0 && again.remaining === 0, again);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 港の「国」（国コードで保存・日本語名で表示）・国ごとの整理・自動の提案 =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[港の国] ';
    await p.evaluate(async () => {
      const v = n => window.__db.master_votes.push({ field: 'port', value: n, voter_email: 's@example.com' });
      v('HAIPHONG'); v('HO CHI MINH'); v('YOKOHAMA'); v('LOS ANGELES'); v('XYZ UNKNOWN PORT');
      window.__db.master_details.push({ field: 'port', value: 'LOS ANGELES', details: { country: 'US' } });
      await statsLoadMasterCache(); await mdLoadCloud();
    });
    const lk = await p.evaluate(() => ({ n: COUNTRY_LIST.length, a: findCountry('ベトナム') && findCountry('ベトナム').code, b: findCountry('vn').code, c: findCountry('ベトナム（VN）').code, d: findCountry('United States').code, e: countryLabel('VN'), g1: guessPortCountry('HAIPHONG'), g2: guessPortCountry('YOKOHAMA, JAPAN'), g3: guessPortCountry('横浜'), g4: guessPortCountry('FOOBAR') }));
    ok(L + '国の候補（国コード＋日本語名）を用意している', lk.n > 150 && lk.a === 'VN' && lk.b === 'VN' && lk.c === 'VN' && lk.d === 'US' && lk.e === 'ベトナム（VN）', lk);
    ok(L + '港の名前から国を推測できる（分からなければ null）', lk.g1 === 'VN' && lk.g2 === 'JP' && lk.g3 === 'JP' && lk.g4 === null, lk);
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    await p.evaluate(() => statsMasterSetFilter('port')); await p.waitForTimeout(300);
    ok(L + '港のときだけ「国を自動で付ける」ボタンが出る', await p.evaluate(() => !!document.querySelector('.cm-entry-btn')));
    // 詳細の入力：国（日本語名で入力しても国コードで保存される）
    await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="XYZ UNKNOWN PORT"] .stats-master-detail-btn').click()); await p.waitForTimeout(500);
    ok(L + '港の詳細に「国」の入力欄と候補がある', await p.evaluate(() => !!document.querySelector('#md_country') && document.querySelectorAll('#md_country_list option').length > 150));
    await p.fill('#md_country', 'ベトナム'); await p.click('.master-detail-save'); await p.waitForTimeout(700);
    ok(L + '日本語名で入力しても国コード（VN）で保存される', await p.evaluate(() => window.__db.master_details.find(m => m.value === 'XYZ UNKNOWN PORT').details.country === 'VN'));
    // 国での整理：国連の地理区分（UN M.49）で 地域 → 小地域 → 国 の順に絞り込む
    const row1 = await p.evaluate(() => [...document.querySelectorAll('.master-type-chip')].map(b => b.textContent));
    ok(L + '最初は「地域」だけが並ぶ（国は多くても画面がすっきり）', row1.some(c => c.startsWith('アジア')) && row1.some(c => c.startsWith('アメリカ')) && row1.some(c => c.startsWith('国なし')) && !row1.some(c => c.startsWith('ベトナム')), row1);
    await p.evaluate(() => statsMasterSetRegion('AS')); await p.waitForTimeout(300);
    const row2 = await p.evaluate(() => [...document.querySelectorAll('.master-type-chip')].map(b => b.textContent));
    ok(L + '地域を選ぶと、その地域の「小地域」が出る（東南アジア。北米は出ない）', row2.some(c => c.startsWith('東南アジア')) && !row2.some(c => c.startsWith('北米')), row2);
    await p.evaluate(() => statsMasterSetSub('SEA')); await p.waitForTimeout(300);
    const row3 = await p.evaluate(() => [...document.querySelectorAll('.master-type-chip')].map(b => b.textContent));
    ok(L + '小地域を選ぶと「国」が出る', row3.some(c => c.startsWith('ベトナム（VN）')), row3);
    const only = await p.evaluate(() => [...document.querySelectorAll('#statsPane-master tbody tr[data-mvalue]')].map(r => r.dataset.mvalue));
    ok(L + '東南アジアの港だけに絞られる（米国の港は出ない）', only.includes('XYZ UNKNOWN PORT') && !only.includes('LOS ANGELES'), only);
    await p.evaluate(() => statsMasterSetRegion('')); await p.waitForTimeout(200);
    await p.evaluate(() => statsMasterSetSort('tag')); await p.waitForTimeout(300);
    const heads = await p.evaluate(() => [...document.querySelectorAll('.master-tag-group-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
    ok(L + '「国ごとにまとめる」：小地域の見出しの下に、国の見出し', heads.some(h => h.includes('東南アジア（アジア）')) && heads.some(h => h.includes('北米（アメリカ）')) && heads.some(h => h.includes('米国（US）')) && heads.some(h => h.includes('ベトナム（VN）')) && heads.some(h => h.includes('国なし')), heads);
    ok(L + '一覧のチップに国が出る', await p.evaluate(() => (document.querySelector('#statsPane-master tr[data-mvalue="LOS ANGELES"]') || { textContent: '' }).textContent.includes('米国')));
    // 自動の提案（登録済みで国が無い港）
    await p.evaluate(() => statsShowPortCountryAssist({ used: {} })); await p.waitForTimeout(900);
    const asst = await p.evaluate(() => document.querySelector('#pcAssistModal').textContent.replace(/\s+/g, ' '));
    ok(L + '提案：HAIPHONG／YOKOHAMA が対象。国が付いている港（LOS ANGELES）は対象外', asst.includes('HAIPHONG') && asst.includes('YOKOHAMA') && !asst.includes('LOS ANGELES'), asst.slice(0, 300));
    await p.evaluate(() => document.getElementById('pcApplyBtn').click()); await p.waitForTimeout(1200);
    const after = await p.evaluate(() => Object.fromEntries(['HAIPHONG', 'HO CHI MINH', 'YOKOHAMA', 'LOS ANGELES'].map(n => [n, (window.__db.master_details.find(m => m.field === 'port' && m.value === n) || { details: {} }).details.country])));
    ok(L + '反映すると国が付く（すでにある国は変えない）', after['HAIPHONG'] === 'VN' && after['HO CHI MINH'] === 'VN' && after['YOKOHAMA'] === 'JP' && after['LOS ANGELES'] === 'US', after);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 港のマスターが 0 件でも「港」を選べて、過去案件で使った港を国つきで一括登録できる =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[港の一括登録] ';
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    ok(L + '港のマスターが無くても「港」の絞り込みが出る', await p.evaluate(() => [...document.querySelectorAll('.master-filter-chip')].some(b => b.textContent.startsWith('港'))));
    await p.evaluate(() => statsMasterSetFilter('port')); await p.waitForTimeout(300);
    ok(L + '港を選んだままで、一括登録の入口が出る', await p.evaluate(() => !!document.querySelector('.cm-entry-btn') && [...document.querySelectorAll('.master-filter-chip.is-active')].some(b => b.textContent.startsWith('港'))));
    await p.evaluate(() => statsShowPortCountryAssist({ used: { HAIPHONG: 5, YOKOHAMA: 3, 'XYZ NO IDEA': 1 } })); await p.waitForTimeout(900);
    const rows = await p.evaluate(() => [...document.querySelectorAll('#pcAssistModal tbody tr')].map(r => ({ t: r.textContent.replace(/\s+/g, ' '), chk: r.querySelector('.pc-chk').checked, val: r.querySelector('.pc-country').value })));
    ok(L + '未登録の港が使用件数順に並び、推測できるものは国つきでチェック済み', rows[0].t.includes('HAIPHONG') && rows[0].chk && rows[0].val.includes('ベトナム') && rows.find(r => r.t.includes('YOKOHAMA')).val.includes('日本'), rows);
    ok(L + '推測できない港はチェックなし・国は空欄', (() => { const x = rows.find(r => r.t.includes('XYZ NO IDEA')); return x && !x.chk && x.val === ''; })(), rows);
    await p.evaluate(() => document.getElementById('pcApplyBtn').click()); await p.waitForTimeout(1500);
    const st = await p.evaluate(() => ({ votes: window.__db.master_votes.filter(v => v.field === 'port').map(v => v.value).sort(), det: Object.fromEntries(window.__db.master_details.filter(d => d.field === 'port').map(d => [d.value, d.details.country])) }));
    ok(L + 'チェックした港だけがマスターに登録され、国が付く', st.votes.includes('HAIPHONG') && st.votes.includes('YOKOHAMA') && !st.votes.includes('XYZ NO IDEA') && st.det.HAIPHONG === 'VN' && st.det.YOKOHAMA === 'JP', st);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== サブコン・キャリアにも担当者を複数登録できる（お客様と同じ入力欄） =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[サブコンの担当者] ';
    await p.evaluate(async () => {
      window.__db.master_votes.push({ field: 'sv', value: '担当者テスト運輸', voter_email: 's@example.com' });
      window.__db.master_votes.push({ field: 'carrier', value: 'TESTLINE', voter_email: 's@example.com' });
      await statsLoadMasterCache(); await mdLoadCloud();
    });
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    await p.evaluate(() => statsMasterSetFilter('sv')); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="担当者テスト運輸"] .stats-master-detail-btn').click()); await p.waitForTimeout(500);
    ok(L + 'サブコンの詳細に担当者の入力欄がある（部署・役職・電話・メール・所在地つき）', await p.evaluate(() => !!document.querySelector('#md_contacts .md-contact-row') && !!document.querySelector('#md_contacts .md-contact-dept') && !!document.querySelector('#md_contacts .md-contact-title') && !!document.querySelector('#md_contacts .md-contact-location')));
    await p.fill('#md_contacts .md-contact-name', '山田'); await p.fill('#md_contacts .md-contact-dept', '営業部'); await p.fill('#md_contacts .md-contact-phone', '03-1111-2222');
    await p.click('.master-contact-add'); await p.waitForTimeout(200);
    await p.evaluate(() => { const r = document.querySelectorAll('#md_contacts .md-contact-row')[1]; r.querySelector('.md-contact-name').value = '佐藤'; r.querySelector('.md-contact-email').value = 's@example.com'; });
    await p.click('.master-detail-save'); await p.waitForTimeout(800);
    const c = await p.evaluate(() => (window.__db.master_details.find(m => m.value === '担当者テスト運輸') || { details: {} }).details.contacts);
    ok(L + '担当者を 2 名登録できる', Array.isArray(c) && c.length === 2 && c[0].name === '山田' && c[0].dept === '営業部' && c[1].email === 's@example.com', c);
    ok(L + '一覧に担当者が「様」付きで出る', await p.evaluate(() => (document.querySelector('#statsPane-master tr[data-mvalue="担当者テスト運輸"]') || { textContent: '' }).textContent.includes('山田 様')));
    await p.evaluate(() => statsMasterSetFilter('carrier')); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="TESTLINE"] .stats-master-detail-btn').click()); await p.waitForTimeout(500);
    ok(L + 'キャリアの詳細にも担当者の入力欄がある', await p.evaluate(() => !!document.querySelector('#md_contacts .md-contact-row')));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== サブコン・キャリアの得意エリア（国内＝日本の地方／海外＝UN M.49 の小地域・国） =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, noLegacy: true });
    const L = '[得意エリア] ';
    await p.evaluate(async () => {
      const add = (n, a) => { window.__db.master_votes.push({ field: 'sv', value: n, voter_email: 's@example.com' }); if (a) window.__db.master_details.push({ field: 'sv', value: n, details: { areas: a } }); };
      add('関東運送', ['JP-KAN']); add('全国便', ['JP']); add('アジア船社', ['SEA', 'VN']); add('欧州船社', ['WEU']); add('エリア無し運送');
      await statsLoadMasterCache(); await mdLoadCloud();
    });
    ok(L + 'エリアの判定：日本全国は各地方を、小地域は国を含む', await p.evaluate(() => areaCovers(['JP'], 'JP-KIN') && areaCovers(['SEA'], 'VN') && areaCovers(['VN'], 'SEA') && !areaCovers(['JP-KAN'], 'JP-KIN') && !areaCovers(['WEU'], 'VN') && areaLabel('JP-KAN') === '関東' && areaLabel('SEA') === '東南アジア'));
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    await p.evaluate(() => statsMasterSetFilter('sv')); await p.waitForTimeout(300);
    // 入力：ボタンで地方・小地域を選び、国は候補から追加
    await p.evaluate(() => document.querySelector('#statsPane-master tr[data-mvalue="エリア無し運送"] .stats-master-detail-btn').click()); await p.waitForTimeout(500);
    ok(L + '詳細に「得意エリア」（国内の地方・海外の小地域のボタン）がある', await p.evaluate(() => !!document.querySelector('#md_areas') && document.querySelectorAll('.master-area-btn').length > 25));
    await p.evaluate(() => { [...document.querySelectorAll('.master-area-btn')].find(b => b.textContent === '関西' || b.textContent === '近畿').click(); [...document.querySelectorAll('.master-area-btn')].find(b => b.textContent === '東アジア').click(); });
    await p.fill('#md_areas_input', 'ベトナム'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    ok(L + '選択中のエリアのボタンがハイライトされ、外すと戻る', await p.evaluate(() => { const on = [...document.querySelectorAll('.master-area-btn.on')].map(b => b.dataset.area); return on.includes('JP-KIN') && on.includes('EAS'); }));
    await p.evaluate(() => document.querySelector('.master-area-btn[data-area="JP-KIN"]').click());
    ok(L + 'もう一度押すとハイライトが消える', await p.evaluate(() => !document.querySelector('.master-area-btn[data-area="JP-KIN"]').classList.contains('on')));
    await p.evaluate(() => document.querySelector('.master-area-btn[data-area="JP-KIN"]').click());
    await p.click('.master-detail-save'); await p.waitForTimeout(800);
    const saved = await p.evaluate(() => (window.__db.master_details.find(m => m.value === 'エリア無し運送') || { details: {} }).details.areas);
    ok(L + '選んだエリアが保存される（近畿・東アジア・ベトナム）', Array.isArray(saved) && saved.includes('JP-KIN') && saved.includes('EAS') && saved.includes('VN'), saved);
    ok(L + '一覧のチップに得意エリアが出る', await p.evaluate(() => (document.querySelector('#statsPane-master tr[data-mvalue="エリア無し運送"]') || { textContent: '' }).textContent.includes('近畿')));
    // 一覧の絞り込み
    const chips = await p.evaluate(() => [...document.querySelectorAll('.master-type-chip')].map(b => b.textContent));
    ok(L + '「得意エリア：すべて／国内／海外」の絞り込み', chips.some(c => c.startsWith('🇯🇵 国内')) && chips.some(c => c.startsWith('🌏 海外')), chips);
    await p.evaluate(() => statsMasterSetAreaKind('DOM')); await p.waitForTimeout(300);
    let rows = await p.evaluate(() => [...document.querySelectorAll('#statsPane-master tbody tr[data-mvalue]')].map(r => r.dataset.mvalue));
    ok(L + '国内：国内エリアを持つ会社だけ', rows.includes('関東運送') && rows.includes('全国便') && rows.includes('エリア無し運送') && !rows.includes('欧州船社'), rows);
    await p.evaluate(() => statsMasterSetArea('JP-KIN')); await p.waitForTimeout(300);
    rows = await p.evaluate(() => [...document.querySelectorAll('#statsPane-master tbody tr[data-mvalue]')].map(r => r.dataset.mvalue));
    ok(L + '近畿：近畿を登録した会社と、日本全国の会社（関東だけの会社は出ない）', rows.includes('全国便') && rows.includes('エリア無し運送') && !rows.includes('関東運送'), rows);
    await p.evaluate(() => { statsMasterSetAreaKind('OVS'); statsMasterSetArea('VN'); }); await p.waitForTimeout(300);
    rows = await p.evaluate(() => [...document.querySelectorAll('#statsPane-master tbody tr[data-mvalue]')].map(r => r.dataset.mvalue));
    ok(L + 'ベトナム：ベトナム・東南アジアを得意とする会社（欧州は出ない）', rows.includes('アジア船社') && !rows.includes('欧州船社'), rows);
    await p.evaluate(() => { statsMasterSetAreaKind(''); statsMasterSetSort('area'); }); await p.waitForTimeout(300);
    const heads = await p.evaluate(() => [...document.querySelectorAll('.master-tag-group-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
    ok(L + '「得意エリアごとにまとめる」：国内の地方・海外の小地域の見出し（国内が先）', heads.some(h => h.includes('関東')) && heads.some(h => h.includes('日本全国')) && heads.some(h => h.includes('東南アジア')) && heads.some(h => h.includes('西ヨーロッパ')) && heads.findIndex(h => h.includes('関東')) < heads.findIndex(h => h.includes('東南アジア')), heads);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 承認制：別名の追加（メンバーは申請・管理者が承認）／詳細の合流／添付の集約 =====
  {
    const { ctx, p, errs } = await open(true, { approval: true, role: 'member', noLegacy: true });
    const L = '[別名の申請(メンバー)] ';
    const seed = async () => {
      await p.evaluate(async () => {
        window.__db.master_votes.push({ field: 'sv', value: 'テスト運送', voter_email: 'admin@example.com' });
        await statsLoadMasterCache(); await synLoadCloud();
        await synAddAlias('sv', 'テスト運輸', 'テスト運送');
      });
      await p.waitForTimeout(800);
    };
    await seed();
    const r = await p.evaluate(() => ({
      syn: window.__db.synonym_groups.filter(g => g.canonical === 'テスト運送' || (g.aliases || []).includes('テスト運輸')).length,
      req: window.__db.master_requests.find(x => x.value === 'テスト運輸'),
      toast: [...document.querySelectorAll('.toast')].some(e => e.textContent.includes('別名にする申請')),
    }));
    ok(L + '直接は別名にならず、申請が作られる', r.syn === 0 && r.req && r.req.alias_of === 'テスト運送' && r.req.status === 'pending', r);
    ok(L + '申請したことが表示される', r.toast, r);
    await p.evaluate(async () => { await synSetCanonical('sv', 'ABC'); });
    ok(L + 'マスター名・別名の直接変更はできない', await p.evaluate(() => !window.__db.synonym_groups.some(g => g.canonical === 'ABC')));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await open(true, { approval: true, role: 'admin', noLegacy: true });
    const L = '[別名の承認(管理者)] ';
    await p.evaluate(async () => {
      window.__db.master_votes.push({ field: 'sv', value: 'テスト運送', voter_email: 'admin@example.com' });
      window.__db.master_votes.push({ field: 'sv', value: 'テスト運輸', voter_email: 'admin@example.com' });
      window.__db.master_details.push({ field: 'sv', value: 'テスト運輸', details: { furigana: 'てすとうんゆ', contacts: [{ name: '山田' }] } });
      window.__db.master_details.push({ field: 'sv', value: 'テスト運送', details: { enName: 'TEST UNSO', contacts: [{ name: '佐藤' }] } });
      window.__db.master_requests.push({ id: 'a1', field: 'sv', value: 'テスト運輸', alias_of: 'テスト運送', requested_by: 'm@example.com', status: 'pending', created_at: new Date().toISOString() });
      await statsLoadMasterCache(); await synLoadCloud(); await mdLoadCloud(); await statsRefresh();
    });
    await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); }); await p.waitForTimeout(1200);
    const shown = await p.evaluate(() => document.querySelector('#statsPane-master .stats-req-section')?.textContent || '');
    ok(L + '申請に「→ 「テスト運送」の別名」と出る', shown.includes('テスト運送') && shown.includes('別名'), shown);
    ok(L + '申請中の別名はマスター申請として数えない', await p.evaluate(() => statsMasterState('sv', 'テスト運輸') !== 'pending'));
    await p.evaluate(() => statsApproveRequest('a1')); await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({
      syn: window.__db.synonym_groups.find(g => g.canonical === 'テスト運送'),
      req: window.__db.master_requests.find(x => x.id === 'a1').status,
      votes: window.__db.master_votes.filter(v => v.value === 'テスト運輸').length,
      md: (window.__db.master_details.find(m => m.value === 'テスト運送') || {}).details,
      mdAlias: !!window.__db.master_details.find(m => m.value === 'テスト運輸'),
    }));
    ok(L + '承認すると別名として入り、申請は承認済み', r.syn && r.syn.aliases.includes('テスト運輸') && r.req === 'approved', r);
    ok(L + '別名側のマスター登録は外れる', r.votes === 0, r);
    ok(L + '別名側の詳細が代表へ合流（空欄を補い、担当者は足し合わせ）', r.md && r.md.furigana === 'てすとうんゆ' && r.md.enName === 'TEST UNSO' && r.md.contacts.length === 2, r.md);
    ok(L + '別名側の記録は消さない', r.mdAlias, r);
    // 別名を外したときの案内
    await p.evaluate(() => synRemoveAlias('sv', 'テスト運輸', 'テスト運送')); await p.waitForTimeout(800);
    ok(L + '別名を外すと「マスターには自動では戻りません」と案内', await p.evaluate(() => [...document.querySelectorAll('.toast')].some(e => e.textContent.includes('自動では戻りません'))));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  console.log(out.join('\n'));
  console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close();
  process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
