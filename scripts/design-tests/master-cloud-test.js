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
  };

  // opts.approval：申請テーブル（master_requests）を用意する＝承認制、opts.role：get_my_role() の結果
  async function open(loggedIn, opts = {}) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
    await ctx.addInitScript(({ seed, legacy, loggedIn, ME, opts }) => {
      try {
        localStorage.setItem('fwd.uiMode', 'detail');
        Object.entries(legacy).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
      } catch (e) {}
      if (!loggedIn) return;
      const db = JSON.parse(JSON.stringify(seed));
      if (opts.approval) db.master_requests = [];
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
            if (t === 'master_requests' && !db.master_requests) return Promise.resolve({ data: null, error: { message: 'relation "master_requests" does not exist' } }).then(res, rej);
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
    ok(L + '移行の案内（このブラウザにだけあるデータ）', notice.includes('このブラウザにだけ保存されている') && notice.includes('マスター 1 件') && notice.includes('略称 1 件'), notice);
    if (process.env.OUT) {   // OUT=<dir> でマスター管理画面（移行の案内）を撮る
      await p.evaluate(() => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); });
      await p.waitForTimeout(1500);
      await p.evaluate(() => { if (window.statsSetPane) window.statsSetPane('master'); }); await p.waitForTimeout(800);
      await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(process.env.OUT, 'master-migrate.png') });
    }
    dlg.length = 0;
    await p.evaluate(() => masterMigrateLocal()); await p.waitForTimeout(800);
    const r5 = await p.evaluate(() => ({
      master: window.__db.master_votes.some(m => m.value === 'ローカル品名'),
      syn: window.__db.synonym_groups.some(g => g.canonical === 'ローカル運送' && g.aliases.includes('ﾛｰｶﾙ運送')),
      md: window.__db.master_details.some(m => m.value === 'ローカル品名'),
      rule: window.__db.alias_rules.some(r => r.from_value === 'YKH'),
      abbrev: window.__db.synonym_groups.some(g => g.canonical === 'NAIGAI TRANS LINES' && g.aliases.includes('NTL')),
      cleared: ['masterCandidates_v1', 'synonymGroups_v1', 'masterDetails_v1', 'aliasRules_v1', 'abbrevPairs_v1'].every(k => localStorage.getItem(k) === null),
      backup: !!localStorage.getItem('masterLocalBackup_v1'),
      noticeAfter: window.masterTopNoticeHtml(),
      canon: nameCanon('sv', 'ﾛｰｶﾙ運送'),
    }));
    ok(L + '移行：マスター・同義グループ・詳細・統合ルール・略称がクラウドへ', r5.master && r5.syn && r5.md && r5.rule && r5.abbrev, r5);
    ok(L + '移行後：このブラウザの分を消し、バックアップを残す', r5.cleared && r5.backup, r5);
    ok(L + '移行後：案内が消え、移した同義グループが効く', r5.noticeAfter === '' && r5.canon === 'ローカル運送', r5);
    ok(L + '移行の確認画面', dlg.some(m => m.includes('チーム共有のマスターへ移します')), dlg);
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
    ok(L + 'マスター管理画面に自分の申請（承認待ち・取り消し）', html.includes('あなたの申請') && html.includes('申請する費用') && html.includes('承認待ち') && html.includes('取り消し'), html.slice(0, 300));
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

  console.log(out.join('\n'));
  console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close();
  process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
