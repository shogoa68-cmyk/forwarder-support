// 📦 受注後の業務の進捗（ops-progress.js）
//   受注した案件のカードの札・ひな形（輸出 FCL／輸入 AIR）・チェック（日時と名前の記録・申し送り）・期限・追加／名前変更／並べ替え／削除・
//   上部の帯（進行中・期限切れ）・一覧・編集中の案件は見るだけ・コピーで引き継がない・編集画面の保存で消えない、を確かめる。
//   node scripts/design-tests/ops-progress-test.js   （CLASSIC=1 で現行／W=390 でスマホ幅）
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
  const W = parseInt(process.env.W || '1400', 10);

  async function open(opts) {
    opts = opts || {};
    const ctx = await b.newContext({ viewport: { width: W, height: 1000 }, locale: 'ja-JP' });
    if (process.env.CLASSIC) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: false, doc: false })); } catch (e) {} });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('fwd.uiMode', 'detail');  } catch (e) {}
      const iso = d => { const t = new Date(); t.setDate(t.getDate() + d); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
      const mk = (id, ct, status, follower, extra) => Object.assign({
        id, name: '案件' + id, status, customer: 'X社', created_by: 'tanaka@x.com', owner_email: 'tanaka@x.com',
        updated_at: '2026-11-' + ct + 'T00:00:00Z', ref: 'R-' + id,
        data: { fields: Object.assign({ 'qf-ref': 'R-' + id, 'qf-status': status }, follower ? { 'qf-follower': follower } : {}), rows: [] },
      }, extra || {});
      const fresh = new Date().toISOString();
      const db = {
        quote_presets: [
          mk('B1', '10', '受注', '', { name: '輸出FCL案件' }),
          mk('B2', '11', '受注', '', { name: '輸入AIR案件' }),
          mk('B3', '12', '下書き中', '', { name: '下書き案件' }),
          mk('B4', '13', '受注', '', { name: '編集中の受注', locked_by: 'tanaka@x.com', locked_at: fresh }),
        ],
        allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }, { email: 'tanaka@x.com', role: 'member', member_no: 2 }, { email: 'suzuki@x.com', role: 'member', member_no: 3 }],
        user_profiles: [{ email: 'me@x.com', display_name: '自分' }, { email: 'tanaka@x.com', display_name: '田中' }, { email: 'suzuki@x.com', display_name: '鈴木' }],
        quote_comments: [], quote_preset_links: [], master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [],
      };
      Object.assign(db.quote_presets[0].data.fields, { 'cond-direction': 'export', 'cond-mode': '海上（FCL）' });
      Object.assign(db.quote_presets[1].data.fields, { 'cond-direction': 'import', 'cond-mode': '航空（AIR）' });
      window.__iso = iso;
      window.__db = db; window.__writes = [];
      const isLocked = r => r.locked_by && r.locked_by !== 'me@x.com' && (Date.now() - new Date(r.locked_at).getTime()) < 90000;
      const qb = t => {
        const st = { op: 'select', filters: [], payload: null };
        const api = {
          select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, is() { return api; }, ilike() { return api; },
          gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, or() { return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; },
          in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          upsert(o) { st.op = 'insert'; st.payload = o; return api; }, insert(o) { st.op = 'insert'; st.payload = o; return api; },
          update(o) { st.op = 'update'; st.payload = o; return api; }, delete() { st.op = 'delete'; return api; },
          single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
          then(res, rej) {
            const rows = (db[t] = db[t] || []);
            let data = null;
            if (st.op === 'insert') {
              const made = [].concat(st.payload).map(o => Object.assign({ id: 'id' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, JSON.parse(JSON.stringify(o))));
              made.forEach(r => rows.push(r)); data = st.single ? made[0] : made;
              window.__writes.push({ t, op: 'insert', payload: JSON.parse(JSON.stringify(st.payload)) });
            } else if (st.op === 'delete') { db[t] = rows.filter(r => !st.filters.every(f => f(r))); }
            else if (st.op === 'update') {
              const hit = rows.filter(r => st.filters.every(f => f(r)) && !(t === 'quote_presets' && isLocked(r)));   // 編集ロック中は RLS で 0 行
              hit.forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.payload))));
              data = hit.map(r => ({ id: r.id }));
              window.__writes.push({ t, op: 'update', n: hit.length });
            } else {
              data = rows.filter(r => st.filters.every(f => f(r))).map(r => JSON.parse(JSON.stringify(r)));
              if (st.single) data = data[0] || null;
            }
            return Promise.resolve({ data, error: null }).then(res, rej);
          },
        };
        return api;
      };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() { return Promise.resolve(); }, presenceState() { return {}; } };
      const user = { email: 'me@x.com', user_metadata: { full_name: '自分' } };
      const client = {
        from: qb, rpc: name => Promise.resolve({ data: name === 'get_my_role' ? 'admin' : (name === 'quote_acquire_lock' ? 'OK' : null), error: null }), channel: () => ch, removeChannel() {},
        auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } },
        storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrls: async () => ({ data: [], error: null }) }) },
      };
      window.supabase = { createClient: () => client };
    });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.setDefaultTimeout(10000);
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
    await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
    await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(1500);
    return { ctx, p, errs };
  }

  const chip = (p, nm) => p.evaluate(nm => {
    const c = [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(c => c.querySelector('.cloud-card-links') && c.querySelector('.cloud-card-links').dataset.lid === nm);
    const e = c && c.querySelector('.ops-chip'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
  }, nm);
  const ops = (p, id) => p.evaluate(id => { const r = window.__db.quote_presets.find(x => x.id === id); const v = r && r.data.fields['qf-ops']; return v ? JSON.parse(v) : null; }, id);
  const steps = p => p.evaluate(() => [...document.querySelectorAll('#opmModal .opm-step')].map(li => ({ l: li.querySelector('.opm-step-l') ? li.querySelector('.opm-step-l').textContent : '', d: li.classList.contains('is-done'), next: li.classList.contains('is-next'), by: (li.querySelector('.opm-done-by') || {}).textContent || '' })));
  const click = (p, sel) => p.evaluate(sel => { const e = document.querySelector(sel); e && e.click(); return !!e; }, sel);

  const { ctx, p, errs } = await open();
  // ---- カードの札 ----
  const c1 = await chip(p, 'B1'), c2 = await chip(p, 'B2'), c3 = await chip(p, 'B3');
  ok('受注の案件のカードに「📦 業務」の札', !!c1 && c1.includes('📦 業務') && c1.includes('0/8'), c1);
  ok('輸出 FCL のひな形：次は「ブッキング依頼」・未着手', !!c1 && c1.includes('次：ブッキング依頼') && c1.includes('未着手'), c1);
  ok('輸入 AIR のひな形は 6 作業', !!c2 && c2.includes('0/6') && c2.includes('到着案内'), c2);
  ok('受注でない案件には札が出ない', c3 === null, c3);
  ok('ひな形のキー（往復）', JSON.stringify(await p.evaluate(() => window.opsTemplateKeys({ fields: { 'cond-direction': 'export_import', 'cond-mode': '海上（LCL）' } }))) === '["exp-lcl","imp-lcl"]');
  // ---- 帯 ----
  const band = await p.evaluate(() => { const e = document.getElementById('opsBand'); return e && !e.hidden ? e.textContent.replace(/\s+/g, ' ') : null; });
  ok('上部の帯「受注後の業務 進行中 3」', !!band && band.includes('進行中 3'), band);
  // ---- チェックリスト ----
  await p.evaluate(() => { const c = [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(c => c.querySelector('.cloud-card-links') && c.querySelector('.cloud-card-links').dataset.lid === 'B1'); c.querySelector('.ops-chip').click(); });
  await p.waitForTimeout(300);
  let s = await steps(p);
  ok('チェックリストが開き 8 作業・1 つ目が「次」', s.length === 8 && s[0].next, s.slice(0, 2));
  await click(p, '#opmModal .opm-chk[data-i="0"]'); await p.waitForTimeout(600);
  let o = await ops(p, 'B1');
  ok('チェックすると保存される（済み・日時・名前）', !!o && o.s[0].d === true && !!o.s[0].at && o.s[0].by === 'me@x.com', o && o.s[0]);
  s = await steps(p);
  ok('完了した作業に「✓ 日時 名前」・次が 2 つ目へ', s[0].d && s[0].by.includes('自分') && s[1].next, s.slice(0, 2));
  const cm = await p.evaluate(() => window.__db.quote_comments.map(c => c.body));
  ok('申し送りに「✅ 業務：ブッキング依頼 を完了」', cm.some(t => t.includes('ブッキング依頼') && t.includes('完了')), cm);
  // 期限（過去日）→ 期限切れ
  await p.evaluate(() => { const i = document.querySelector('#opmModal .opm-due[data-i="1"]'); i.value = window.__iso(-2); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('期限を保存', !!o.s[1].due, o.s[1]);
  // 追加・名前変更・並べ替え・削除
  await p.fill('#opmAddIn', '保険の手配'); await click(p, '#opmModal [data-opm="add"]'); await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('作業を追加（末尾）', o.s.length === 9 && o.s[8].l === '保険の手配', o.s.map(x => x.l));
  await click(p, '#opmModal [data-opm="up"][data-i="8"]'); await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('▲で上へ', o.s[7].l === '保険の手配', o.s.map(x => x.l));
  await click(p, '#opmModal [data-opm="rename"][data-i="7"]');
  await p.fill('#opmModal .opm-rename', '貨物保険の手配'); await p.press('#opmModal .opm-rename', 'Enter'); await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('✎で名前を変える', o.s[7].l === '貨物保険の手配', o.s[7]);
  await click(p, '#opmModal [data-opm="del"][data-i="7"]');
  await p.waitForSelector('.confirm-dialog');
  await p.evaluate(() => { const b = [...document.querySelectorAll('.confirm-dialog button')].find(x => x.textContent.trim() === '消す'); b && b.click(); });
  await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('✕で消す（確認つき）', o.s.length === 8 && !o.s.some(x => /保険/.test(x.l)), o.s.map(x => x.l));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok('Esc で閉じる', await p.evaluate(() => document.getElementById('opmModal').hidden));
  // カードの札・帯の更新
  const c1b = await chip(p, 'B1');
  ok('カードの札が 1/8・期限切れ', !!c1b && c1b.includes('1/8') && c1b.includes('期限切れ') && !c1b.includes('未着手'), c1b);
  const band2 = await p.evaluate(() => document.getElementById('opsBand').textContent.replace(/\s+/g, ' '));
  ok('帯に「⚠ 期限切れ 1」', band2.includes('期限切れ 1'), band2);
  // 帯から「進行管理」タブへ（期限切れで絞り込み）
  await p.evaluate(() => document.querySelector('#opsBand [data-ops-list="over"]').click()); await p.waitForTimeout(500);
  const tabOn = await p.evaluate(() => ({ tab: document.getElementById('tab-ops').classList.contains('active'), nav: document.querySelector('.cat-btn[aria-controls="tab-ops"]').classList.contains('active'), quote: document.getElementById('tab-quote-make').classList.contains('active') }));
  ok('帯の「期限切れ」を押すと「進行管理」タブへ移る', tabOn.tab && tabOn.nav && !tabOn.quote, tabOn);
  let ls = await p.evaluate(() => [...document.querySelectorAll('#opsRoot .opt-row')].map(x => x.textContent.replace(/\s+/g, ' ')));
  ok('タブは期限切れで絞り込まれ、該当の案件だけ', ls.length === 1 && ls[0].includes('R-B1'), ls);
  const tiles = await p.evaluate(() => [...document.querySelectorAll('#opsRoot .opt-tile')].map(x => x.textContent.replace(/\s+/g, '')));
  ok('タイル：進行中 3・期限切れ 1・完了 0', tiles.some(t => t === '進行中3') && tiles.some(t => t.includes('期限切れ1')) && tiles.some(t => t === '完了0'), tiles);
  await p.evaluate(() => document.querySelector('#opsRoot .opt-tile[data-f="active"]').click()); await p.waitForTimeout(200);
  ls = await p.evaluate(() => [...document.querySelectorAll('#opsRoot .opt-row')].map(x => x.textContent.replace(/\s+/g, ' ')));
  ok('「進行中」で 3 件・期限切れが先頭', ls.length === 3 && ls[0].includes('R-B1'), ls);
  await p.fill('#optQ', 'R-B2'); await p.waitForTimeout(200);
  ls = await p.evaluate(() => [...document.querySelectorAll('#opsRoot .opt-row')].length);
  ok('検索で絞り込める', ls === 1, ls);
  await p.fill('#optQ', ''); await p.waitForTimeout(200);
  // 「✓ 次を完了」
  await p.evaluate(() => { const r = [...document.querySelectorAll('#opsRoot .opt-row')].find(x => x.textContent.includes('R-B1')); r.querySelector('[data-opt="next"]').click(); });
  await p.waitForTimeout(800);
  o = await ops(p, 'B1');
  ok('「✓ 次を完了」で次の作業が済みになる（2/8）', o.s[1].d === true && o.s.filter(x => x.d).length === 2, o.s.map(x => x.d));
  const rowTxt = await p.evaluate(() => [...document.querySelectorAll('#opsRoot .opt-row')].find(x => x.textContent.includes('R-B1')).textContent);
  ok('タブの行がその場で 2/8 に更新', rowTxt.includes('2/8'), rowTxt);
  ok('編集中（他の人）の案件には「次を完了」が出ない', await p.evaluate(() => { const r = [...document.querySelectorAll('#opsRoot .opt-row')].find(x => x.textContent.includes('R-B4')); return r && !r.querySelector('[data-opt="next"]'); }));
  // タブから チェックリスト／見積
  await p.evaluate(() => { const r = [...document.querySelectorAll('#opsRoot .opt-row')].find(x => x.textContent.includes('R-B1')); r.querySelector('[data-opt="list"]').click(); });
  await p.waitForTimeout(300);
  ok('タブの「チェックリスト」でチェックリストが開く', await p.evaluate(() => !document.getElementById('opmModal').hidden));
  await click(p, '#opmModal [data-opm="close"]');
  await p.evaluate(() => document.querySelector('#opsRoot [data-opt="dash"]').click()); await p.waitForTimeout(800);
  ok('「見積ダッシュボードへ」で見積タブのダッシュボードに戻る', await p.evaluate(() => document.getElementById('tab-quote-make').classList.contains('active') && document.body.classList.contains('qp-dash-active')));
  // 編集中（他の人）の案件は見るだけ
  await p.evaluate(() => { const c = [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(c => c.querySelector('.cloud-card-links') && c.querySelector('.cloud-card-links').dataset.lid === 'B4'); c.querySelector('.ops-chip').click(); });
  await p.waitForTimeout(300);
  const ro = await p.evaluate(() => ({ lock: !!document.querySelector('#opmModal .opm-lock'), dis: [...document.querySelectorAll('#opmModal .opm-chk')].every(b => b.disabled), add: !!document.getElementById('opmAddIn') }));
  ok('他の人が編集中の案件は見るだけ（チェック不可・追加なし）', ro.lock && ro.dis && !ro.add, ro);
  await click(p, '#opmModal [data-opm="close"]');
  // 全部済ませると「すべて完了」
  await p.evaluate(() => { const c = [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(c => c.querySelector('.cloud-card-links') && c.querySelector('.cloud-card-links').dataset.lid === 'B2'); c.querySelector('.ops-chip').click(); });
  await p.waitForTimeout(300);
  for (let i = 0; i < 6; i++) { await click(p, '#opmModal .opm-chk[data-i="' + i + '"]'); await p.waitForTimeout(250); }
  await p.waitForTimeout(500);
  o = await ops(p, 'B2');
  ok('6 つすべて保存（順に書いても取りこぼさない）', o && o.s.every(x => x.d), o && o.s.map(x => x.d));
  await click(p, '#opmModal [data-opm="close"]'); await p.waitForTimeout(300);
  const c2b = await chip(p, 'B2');
  ok('カードに「✅ すべて完了」', !!c2b && c2b.includes('すべて完了'), c2b);
  // コピーは引き継がない
  await p.evaluate(() => window.cloudDuplicatePreset('B1')); await p.waitForTimeout(1500);
  const cp = await p.evaluate(() => { const r = window.__db.quote_presets.find(x => /輸出FCL案件 のコピー/.test(x.name)); return r ? (r.data.fields['qf-ops'] || '') : null; });
  ok('コピーした案件は進捗を引き継がない', cp === '', cp);
  // 編集画面で開いて保存しても消えない
  await p.evaluate(() => window.cloudLoadPreset('B1')); await p.waitForTimeout(1500);
  const hid = await p.evaluate(() => (document.getElementById('qf-ops') || {}).value || '');
  ok('編集画面の隠し項目に進捗が入る', hid.includes('ブッキング依頼'), hid.slice(0, 40));
  await p.evaluate(() => window.cloudSaveCurrent()); await p.waitForTimeout(1500);
  o = await ops(p, 'B1');
  ok('編集画面で保存しても進捗は残る', !!o && o.s[0].d === true, o && o.s[0]);
  // 見積タブを開かずに、いきなり「進行管理」を開いても一覧が出る（案件一覧を自分で読み込む）
  {
    const p2 = await ctx.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
    await p2.goto(URL, { waitUntil: 'domcontentloaded' }); await p2.waitForTimeout(800);
    await p2.evaluate(() => { const b = document.querySelector('.cat-btn[aria-controls="tab-ops"]'); b.click(); }); await p2.waitForTimeout(2500);
    const n = await p2.evaluate(() => document.querySelectorAll('#opsRoot .opt-row').length);
    ok('いきなり「進行管理」を開いても受注の案件が並ぶ', n >= 3, n);
    await p2.evaluate(() => { const r = [...document.querySelectorAll('#opsRoot .opt-row')].find(x => x.textContent.includes('R-B2')); r.querySelector('[data-opt="quote"]').click(); });
    await p2.waitForTimeout(2000);
    const q = await p2.evaluate(() => ({ tab: document.getElementById('tab-quote-make').classList.contains('active'), ref: (document.getElementById('qf-ref') || {}).value }));
    ok('「💼 見積」でその案件の見積を開く', q.tab && q.ref === 'R-B2', q);
    ok('（2 枚目）ページのエラーなし', e2.length === 0, e2);
    await p2.close();
  }
  ok('ページのエラーなし', errs.length === 0, errs);
  await ctx.close();
  await b.close(); srv.close();
  console.log(fails ? 'FAIL=' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
