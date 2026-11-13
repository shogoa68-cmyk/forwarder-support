// 🏢 組織とチーム：名簿（チーム管理の「組織・チーム」タブ）とダッシュボードの「全体／組織／チーム／自分」。
//   偽の Supabase（メモリ上）で、所属の読み込み・絞り込み・選び直し・管理画面での追加／割り当て／削除・SQL 未実行を確かめる。
//   node scripts/design-tests/org-teams-test.js           （THEME=1 で Industry）
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
  let fails = 0;
  const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ME = 'me@x.com';

  async function open({ role = 'member', noTables = false } = {}) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    await ctx.addInitScript(({ ME, role, noTables }) => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      const mk = (id, cb, ct, st) => ({ id, name: '案件' + id, status: st || '下書き中', customer: 'X社' + id, created_by: cb, owner_email: cb, updated_at: '2026-11-0' + ct + 'T00:00:00Z', data: { fields: { 'qf-ref': 'R' + id }, rows: [] } });
      const db = {
        organizations: [{ id: 'oA', name: '初期の組織' }, { id: 'oB', name: '協力会社' }],
        teams: [{ id: 't1', org_id: 'oA', name: '営業' }, { id: 't2', org_id: 'oA', name: '通関' }],
        org_members: [{ email: 'me@x.com', org_id: 'oA' }, { email: 'a@x.com', org_id: 'oA' }, { email: 'b@x.com', org_id: 'oA' }, { email: 'c@x.com', org_id: 'oB' }],
        team_members: [{ team_id: 't1', email: 'me@x.com' }, { team_id: 't1', email: 'a@x.com' }, { team_id: 't2', email: 'b@x.com' }],
        allowed_emails: ['me@x.com', 'a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'].map((e, i) => ({ email: e, role: i === 0 ? role : 'member', member_no: i + 1 })),
        user_profiles: [],
        quote_presets: [mk('1', 'me@x.com', 1), mk('2', 'a@x.com', 2), mk('3', 'b@x.com', 3), mk('4', 'c@x.com', 4), mk('5', 'd@x.com', 5)],
        master_votes: [], synonym_groups: [], master_details: [], alias_rules: [],
      };
      window.__db = db;
      const ORG = ['organizations', 'teams', 'org_members', 'team_members'];
      const qb = t => {
        const st = { op: 'select', filters: [], payload: null, opts: null };
        const api = {
          select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, or() { return api; },
          is() { return api; }, ilike() { return api; }, gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; },
          in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          upsert(o, opts) { st.op = 'upsert'; st.payload = o; st.opts = opts; return api; },
          insert(o) { st.op = 'insert'; st.payload = o; return api; },
          update(o) { st.op = 'update'; st.payload = o; return api; },
          delete() { st.op = 'delete'; return api; },
          single() { return api; }, maybeSingle() { return api; },
          then(res, rej) {
            if (noTables && ORG.includes(t)) return Promise.resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }).then(res, rej);
            const rows = (db[t] = db[t] || []);
            let data = null;
            if (st.op === 'insert') { [].concat(st.payload).forEach(o => rows.push(Object.assign({ id: 'id' + Math.random().toString(36).slice(2) }, JSON.parse(JSON.stringify(o))))); }
            else if (st.op === 'upsert') {
              [].concat(st.payload).forEach(o => { const k = st.opts && st.opts.onConflict; const hit = k && rows.find(r => r[k] === o[k]); if (hit) Object.assign(hit, o); else rows.push(Object.assign({ id: 'id' + Math.random().toString(36).slice(2) }, JSON.parse(JSON.stringify(o)))); });
            }
            else if (st.op === 'delete') { db[t] = rows.filter(r => !st.filters.every(f => f(r))); if (t === 'organizations') { const gone = rows.filter(r => st.filters.every(f => f(r))).map(r => r.id); db.teams = db.teams.filter(x => !gone.includes(x.org_id)); db.org_members = db.org_members.filter(x => !gone.includes(x.org_id)); } }
            else if (st.op === 'update') { rows.filter(r => st.filters.every(f => f(r))).forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.payload)))); }
            else data = rows.filter(r => st.filters.every(f => f(r)));
            return Promise.resolve({ data, error: null }).then(res, rej);
          },
        };
        return api;
      };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() {} };
      const user = { email: ME, user_metadata: { full_name: 'Me' } };
      const client = {
        from: qb, rpc: name => Promise.resolve({ data: name === 'get_my_role' ? role : (name === 'quote_acquire_lock' ? 'OK' : null), error: null }), channel: () => ch, removeChannel() {},
        auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } },
        storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrls: async () => ({ data: [], error: null }) }) },
      };
      window.supabase = { createClient: () => client };
    }, { ME, role, noTables });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.setDefaultTimeout(10000);
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
    await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
    await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(1200);
    return { ctx, p, errs };
  }
  const cards = p => p.evaluate(() => document.querySelectorAll('#qpDashboard .cloud-card, #qpDashboard .qpd-row').length);
  const chipN = (p, label) => p.evaluate(l => { const b = [...document.querySelectorAll('#qpdScope .qpd-scope-chip')].find(x => x.textContent.includes(l)); return b ? Number(b.querySelector('.cloud-chip-n').textContent) : null; }, label);
  const clickScope = (p, label) => p.evaluate(l => { [...document.querySelectorAll('#qpdScope .qpd-scope-chip')].find(x => x.textContent.includes(l)).click(); }, label).then(() => p.waitForTimeout(400));

  // ===== メンバー：所属の読み込みと絞り込み =====
  {
    const { ctx, p, errs } = await open();
    ok('所属が読み込まれる（orgDir.available）', await p.evaluate(() => window.orgDir && window.orgDir.available()));
    ok('自分の所属：組織＝初期の組織・チーム＝営業', await p.evaluate(() => window.orgDir.orgName(window.orgDir.myOrgId()) === '初期の組織' && window.orgDir.myTeamIds().map(id => window.orgDir.teamName(id)).join() === '営業'));
    ok('範囲の行が出る（全体／組織／チーム／自分）', (await p.evaluate(() => [...document.querySelectorAll('#qpdScope .qpd-scope-chip')].map(x => x.textContent.replace(/\d+$/, '').trim()))).join('|') === '🌐 全体|🏢 組織|👥 チーム|🙋 自分');
    ok('件数：全体5・組織3（A組織の3人の案件）・チーム2（営業チーム）・自分1', [await chipN(p, '全体'), await chipN(p, '組織'), await chipN(p, 'チーム'), await chipN(p, '自分')].join() === '5,3,2,1', [await chipN(p, '全体'), await chipN(p, '組織'), await chipN(p, 'チーム'), await chipN(p, '自分')]);
    ok('既定は「全体」で5件', (await cards(p)) === 5, await cards(p));
    await clickScope(p, '組織');
    ok('「組織」：自分の組織の案件3件', (await cards(p)) === 3, await cards(p));
    ok('選択肢の既定は「自分の組織（初期の組織）」', (await p.textContent('#qpdScope .qpd-scope-sel option:checked')).includes('自分の組織（初期の組織）'));
    await p.selectOption('#qpdScope .qpd-scope-sel', 'oB');
    ok('他の組織（協力会社）を選ぶと、その組織の案件1件', (await cards(p)) === 1, await cards(p));
    await clickScope(p, 'チーム');
    ok('「チーム」：自分のチーム（営業）の案件2件', (await cards(p)) === 2, await cards(p));
    await p.selectOption('#qpdScope .qpd-scope-sel', 't2');
    ok('他のチーム（通関）を選ぶと1件', (await cards(p)) === 1, await cards(p));
    await clickScope(p, '自分');
    ok('「自分」：自分が作成した案件1件', (await cards(p)) === 1, await cards(p));
    await clickScope(p, '全体');
    ok('「全体」に戻すと5件', (await cards(p)) === 5, await cards(p));
    ok('絞り込み中は「すべて解除」が出て、押すと全体に戻る', await (async () => { await clickScope(p, '自分'); const shown = await p.evaluate(() => !document.getElementById('qpdResetAll').hidden); await p.evaluate(() => document.getElementById('qpdResetAll').click()); await p.waitForTimeout(400); return shown && (await cards(p)) === 5 && (await p.evaluate(() => document.querySelector('#qpdScope .is-active').textContent.includes('全体'))); })());
    // 選択は端末に覚える
    await clickScope(p, 'チーム');
    ok('選んだ範囲は端末に記憶される', await p.evaluate(() => JSON.parse(localStorage.getItem('qpdScope_v1')).scope === 'team'));
    // 余白（2026-11）：案件の範囲・検索窓・ツール行・タグ欄が詰まらない（id の強い共通ルールに負けていないこと）
    const sp = await p.evaluate(() => {
      const r = q => document.querySelector(q).getBoundingClientRect(), cs = q => getComputedStyle(document.querySelector(q));
      return {
        scopeTop: r('#qpdScope').top - r('#qpdStats').bottom, scopeToSearch: r('#qpdSearch').top - r('#qpdScope').bottom,
        searchH: r('#qpdSearch').height, searchToRow: r('.qpd-tools-row').top - r('#qpdSearch').bottom,
        rowToTag: r('.qpd-tag-quickfilter-input').top - r('.qpd-tools-row').bottom,
        lblGap: r('#qpdScope .qpd-scope-chip').left - r('#qpdScope .qpd-scope-lbl').right, tagPad: cs('.qpd-tag-quickfilter-input').paddingLeft,
      };
    });
    ok('案件の範囲の上に余白（統計から20px以上）', sp.scopeTop >= 20, sp);
    ok('案件の範囲と検索窓の間が14px以上', sp.scopeToSearch >= 14, sp);
    ok('検索窓の高さが36px以上', sp.searchH >= 36, sp);
    ok('検索窓とツール行・ツール行とタグ欄の間が10px以上', sp.searchToRow >= 10 && sp.rowToTag >= 10, sp);
    ok('「案件の範囲」の見出しとチップの間が10px以上', sp.lblGap >= 10, sp);
    ok('ページエラーなし', errs.length === 0, errs);
    await p.screenshot({ path: path.join(process.env.OUT || '/tmp', 'org-scope.png'), clip: { x: 0, y: 100, width: 1400, height: 420 } }).catch(() => {});
    await ctx.close();
  }

  // ===== 所属が無い人：案内 =====
  {
    const { ctx, p } = await open();
    await p.evaluate(() => { window.__db.team_members = []; window.__db.org_members = window.__db.org_members.filter(r => r.email !== 'me@x.com'); return window.orgDir.reload(); }); await p.waitForTimeout(600);
    await clickScope(p, 'チーム');
    ok('チーム未所属：0件と案内（上のリストから選べる）', (await cards(p)) === 0 && (await p.textContent('#qpdScope')).includes('チームに所属していません'));
    await clickScope(p, '組織');
    ok('組織未所属：0件と案内', (await cards(p)) === 0 && (await p.textContent('#qpdScope')).includes('組織に所属していません'));
    await p.selectOption('#qpdScope .qpd-scope-sel', 'oA');
    ok('組織未所属でも、リストから選べば絞り込める（自分が抜けた組織Aは a・b の2件）', (await cards(p)) === 2, await cards(p));
    await ctx.close();
  }

  // ===== SQL 未実行 =====
  {
    const { ctx, p, errs } = await open({ noTables: true });
    ok('表が無いと orgDir.available は false', !(await p.evaluate(() => window.orgDir.available())));
    ok('「組織」「チーム」は出ず、全体と自分だけ', (await p.evaluate(() => [...document.querySelectorAll('#qpdScope .qpd-scope-chip')].map(x => x.textContent.replace(/\d+$/, '').trim()))).join('|') === '🌐 全体|🙋 自分');
    await clickScope(p, '自分');
    ok('「自分」は表が無くても使える（1件）', (await cards(p)) === 1, await cards(p));
    await p.evaluate(() => openUserMgr()); await p.waitForTimeout(400);
    await p.click('#umTabOrg'); await p.waitForTimeout(500);
    ok('管理画面に SQL 実行の案内', (await p.textContent('#umOrgPane')).includes('org-teams.sql'));
    ok('ページエラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 管理者：組織・チームの管理 =====
  {
    const { ctx, p, errs } = await open({ role: 'admin' });
    await p.evaluate(() => openUserMgr()); await p.waitForTimeout(500);
    await p.click('#umTabOrg'); await p.waitForTimeout(700);
    ok('「組織・チーム」タブが開く（他のタブは隠れる）', await p.evaluate(() => !document.getElementById('umOrgPane').hidden && document.getElementById('umMembersPane').hidden && document.getElementById('umAnnPane').hidden));
    ok('組織2つ・チーム2つが並ぶ', await p.locator('#umOrgPane .ot-org').count() === 2 && await p.locator('#umOrgPane .ot-team').count() === 2);
    ok('メンバー5人の所属表（組織・チーム）', await p.locator('#umOrgPane .ot-table tbody tr').count() === 5);
    ok('a@x.com の所属：組織＝初期の組織・チーム営業がオン', await p.evaluate(() => { const tr = document.querySelector('#umOrgPane tr[data-email="a@x.com"]'); return tr.querySelector('select').selectedOptions[0].textContent === '初期の組織' && [...tr.querySelectorAll('.ot-chip.is-on')].map(x => x.textContent).join() === '営業'; }));
    await p.screenshot({ path: path.join(process.env.OUT || '/tmp', 'org-admin.png') }).catch(() => {});

    await p.fill('#otNewOrg', '営業部'); await p.click('#umOrgPane [data-act="add-org"]'); await p.waitForTimeout(500);
    ok('組織を追加できる', await p.evaluate(() => window.__db.organizations.some(o => o.name === '営業部')));
    await p.fill('#otNewOrg', '協力会社'); await p.click('#umOrgPane [data-act="add-org"]'); await p.waitForTimeout(300);
    ok('組織をもう1つ追加できる（合計4）', await p.evaluate(() => window.__db.organizations.length) === 4);
    await p.click('#umOrgPane [data-act="add-org"]'); await p.waitForTimeout(300);
    ok('名前が空なら追加しない', await p.evaluate(() => window.__db.organizations.length) === 4);
    await p.fill('#umOrgPane [data-org="oB"] [data-newteam]', '現地手配'); await p.click('#umOrgPane [data-org="oB"] [data-act="add-team"]'); await p.waitForTimeout(500);
    ok('チームを追加できる（組織の中）', await p.evaluate(() => window.__db.teams.some(t => t.name === '現地手配' && t.org_id === 'oB')));

    await p.selectOption('#umOrgPane tr[data-email="d@x.com"] select', 'oB'); await p.waitForTimeout(500);
    ok('未所属のメンバーに組織を割り当てられる', await p.evaluate(() => window.__db.org_members.some(r => r.email === 'd@x.com' && r.org_id === 'oB')));
    await p.click('#umOrgPane tr[data-email="d@x.com"] .ot-chip'); await p.waitForTimeout(500);
    ok('チームに入れられる', await p.evaluate(() => window.__db.team_members.some(r => r.email === 'd@x.com')));
    await p.click('#umOrgPane tr[data-email="d@x.com"] .ot-chip.is-on'); await p.waitForTimeout(500);
    ok('もう一度押すとチームから外れる', await p.evaluate(() => !window.__db.team_members.some(r => r.email === 'd@x.com')));
    await p.selectOption('#umOrgPane tr[data-email="a@x.com"] select', 'oB'); await p.waitForTimeout(600);
    ok('組織を変えると、前の組織のチームへの所属は外れる', await p.evaluate(() => !window.__db.team_members.some(r => r.email === 'a@x.com') && window.__db.org_members.find(r => r.email === 'a@x.com').org_id === 'oB'));
    ok('組織は1人1つ（重複しない）', await p.evaluate(() => window.__db.org_members.filter(r => r.email === 'a@x.com').length) === 1);

    await p.fill('#umOrgPane [data-org="oB"] .ot-org-name', '協力会社（改）'); await p.press('#umOrgPane [data-org="oB"] .ot-org-name', 'Enter'); await p.waitForTimeout(500);
    ok('組織の名前を変更できる', await p.evaluate(() => window.__db.organizations.find(o => o.id === 'oB').name) === '協力会社（改）');
    await p.click('#umOrgPane .ot-team[data-team="t2"] [data-act="del-team"]'); await p.waitForTimeout(300);
    ok('チーム削除は確認画面が出る', await p.locator('.confirm-dialog').count() === 1);
    await p.click('.confirm-dialog .btn-cancel'); await p.waitForTimeout(300);
    ok('やめる→削除されない', await p.evaluate(() => window.__db.teams.some(t => t.id === 't2')));
    await p.click('#umOrgPane .ot-team[data-team="t2"] [data-act="del-team"]'); await p.waitForTimeout(300);
    await p.click('.confirm-dialog .confirm-actions button:last-child'); await p.waitForTimeout(500);
    ok('削除する→削除される', await p.evaluate(() => !window.__db.teams.some(t => t.id === 't2')));

    // 変更はダッシュボードの絞り込みにも反映される（orgdir:loaded）
    await p.evaluate(() => closeUserMgr()); await p.waitForTimeout(300);
    ok('管理画面の変更が orgDir に反映される（初期の組織＝b と自分だけになった）', await p.evaluate(() => window.orgDir.membersOfOrg(window.orgDir.myOrgId()).sort().join()) === 'b@x.com,me@x.com');
    ok('ページエラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== メンバー（管理者でない）は編集できない =====
  {
    const { ctx, p } = await open({ role: 'member' });
    await p.evaluate(() => openUserMgr()); await p.waitForTimeout(400);
    await p.click('#umTabOrg'); await p.waitForTimeout(700);
    ok('管理者でなければ、追加・削除ボタンも入力欄も出ない（読み取りのみ）', await p.locator('#umOrgPane [data-act="add-org"]').count() === 0 && await p.locator('#umOrgPane [data-act="del-org"]').count() === 0 && await p.locator('#umOrgPane select:not([disabled])').count() === 0);
    await ctx.close();
  }

  await b.close(); srv.close();
  console.log(fails ? `\n${fails} 件 FAIL` : '\n全項目 PASS');
  process.exit(fails ? 1 : 0);
})();
