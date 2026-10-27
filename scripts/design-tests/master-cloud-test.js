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
      cleared: ['masterCandidates_v1', 'synonymGroups_v1', 'masterDetails_v1', 'aliasRules_v1', 'abbrevPairs_v1'].every(k => localStorage.getItem(k) === null),
      exclKept: !!localStorage.getItem('statsExclusions_v1'),
      backup: !!localStorage.getItem('masterLocalBackup_v1'),
      noticeAfter: window.masterTopNoticeHtml(),
      canon: nameCanon('sv', 'ﾛｰｶﾙ運送'),
    }));
    ok(L + '移行：マスター・同義グループ・詳細・統合ルール・略称がクラウドへ', r5.master && r5.syn && r5.md && r5.rule && r5.abbrev, r5);
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

  console.log(out.join('\n'));
  console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close();
  process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
