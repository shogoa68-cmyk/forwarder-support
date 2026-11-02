// 📝 自由入力で保管 → 📩 未取込 → 取り込み。偽の Supabase（メモリ上の表）を使う。実サーバーには接続しない。
//   node scripts/design-tests/store-raw-test.js           （THEME=1 で Industry）
//   node scripts/design-tests/port-country-test.js           （THEME=1 で Industry）
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
  const ok = (n, c, d) => { const line = (c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)); out.push(line); console.log(line); };


  const ME = 's@example.com';
  async function open() {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    await ctx.addInitScript(({ ME }) => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      const db = { master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], quote_presets: [] };
      window.__db = db;
      const qb = t => {
        const st = { op: 'select', filters: [], payload: null, opts: null, one: false, sel: false };
        const api = {
          select() { st.sel = true; return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, or() { return api; },
          is() { return api; }, ilike() { return api; }, gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; },
          in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          upsert(o, opts) { st.op = 'upsert'; st.payload = o; st.opts = opts; return api; },
          insert(o) { st.op = 'insert'; st.payload = o; return api; },
          update(o) { st.op = 'update'; st.payload = o; return api; },
          delete() { st.op = 'delete'; return api; },
          single() { st.one = true; return api; }, maybeSingle() { st.one = true; return api; },
          then(res, rej) {
            const rows = (db[t] = db[t] || []);
            let data = null;
            if (st.op === 'insert' || st.op === 'upsert') {
              const made = [].concat(st.payload).map(o => {
                const r = Object.assign({ id: 'id' + Math.random().toString(36).slice(2), updated_at: new Date().toISOString() }, JSON.parse(JSON.stringify(o)));
                rows.push(r); return r;
              });
              data = st.sel ? (st.one ? made[0] : made) : null;
            } else if (st.op === 'delete') {
              db[t] = rows.filter(r => !st.filters.every(f => f(r)));
            } else if (st.op === 'update') {
              const hit = rows.filter(r => st.filters.every(f => f(r)));
              hit.forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.payload))));
              data = st.sel ? hit : null;
            } else {
              data = rows.filter(r => st.filters.every(f => f(r)));
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
        from: qb, rpc: name => Promise.resolve({ data: name === 'get_my_role' ? 'member' : (name === 'quote_acquire_lock' ? 'OK' : null), error: null }), channel: () => ch, removeChannel() {}, storage: { from: () => ({}) },
        auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signOut: () => Promise.resolve({}), signInWithOAuth: () => Promise.resolve({}) },
      };
      window.supabase = { createClient: () => client };
    }, { ME });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage();
    const errs = [], dlg = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => { dlg.push(d.message()); d.accept(); });
    p.setDefaultTimeout(10000);
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
    await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
    return { ctx, p, errs, dlg };
  }

  const { ctx, p, errs, dlg } = await open();
  await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(800);
  const vis = sel => p.evaluate(s => { const e = document.querySelector(s); return !!e && !!(e.offsetWidth || e.offsetHeight) && getComputedStyle(e).display !== 'none'; }, sel);

  // 1) ダッシュボードの入口
  ok('ダッシュボードに「📝 自由入力で保管」ボタンがある', await vis('#qpDashboard .qpd-store'));
  await p.click('#qpDashboard .qpd-store'); await p.waitForTimeout(400);
  ok('保管専用表示でモーダルが開く（タイトル・お客様/件名欄あり）', await vis('#emailImportModal.open') && await vis('#eiS-customer') && /自由入力で保管/.test(await p.textContent('#eiTitle')));
  ok('保管専用表示では「解析する」「AI整形」「結果表」を隠す', !(await vis('#emailImportBox .ei-parse-btn')) && !(await vis('#emailImportBox .ei-ai-prompt-btn')) && !(await vis('#eiActions')));
  // 空のまま保管 → 警告
  await p.click('#emailImportBox .ei-store-btn'); await p.waitForTimeout(300);
  ok('何も貼らずに保管しても案件は作られない', (await p.evaluate(() => window.__db.quote_presets.length)) === 0);
  // 2) 保管
  const RAW = 'PENANG向け 暫定提示\n海上運賃 20FT 1本 USD 475\nTHC 34,900円 + 税\nドレージ 実費';
  await p.fill('#eiText', RAW); await p.fill('#eiS-customer', '株式会社テスト商事'); await p.fill('#eiS-memo', '横浜→PENANG 暫定提示');
  const dlgBefore = dlg.length;
  await p.click('#emailImportBox .ei-store-btn'); await p.waitForTimeout(1500);
  const row = await p.evaluate(() => window.__db.quote_presets[0] || null);
  ok('案件が 1 件保存される', !!row, row);
  const srcObj = row && (() => { try { return JSON.parse(row.data.fields['qf-import-src']); } catch (e) { return null; } })();
  ok('原文が案件データ（qf-import-src）に入る', srcObj && srcObj.rawText === RAW && srcObj.stored === true, srcObj);
  ok('お客様名が列に昇格し、件名がメモに入る', row && row.customer === '株式会社テスト商事' && row.data.fields['qf-memo'] === '横浜→PENANG 暫定提示', row && { c: row.customer, m: row.data.fields['qf-memo'] });
  ok('保存後は確認ダイアログなしでダッシュボードに戻り、モーダルは閉じる', await p.evaluate(() => document.getElementById('tab-quote-make').classList.contains('qp-dash')) && !(await vis('#emailImportModal.open')) && dlg.length === dlgBefore, dlg);
  ok('明細の品名は 0 件（原文だけの案件）', row && !row.data.rows.some(r => r._type === 'data' && String(r.cells[4] || '').trim()), row && row.data.rows);
  ok('ダッシュボードには「未取込」の帯を出さない（編集画面だけ）', !(await vis('#eiPendingBanner')));
  // 3) 未取込の判定（eiPendingOf）
  ok('eiPendingOf：原文あり＋明細なし → 未取込', await p.evaluate(d => !!window.eiPendingOf(d), row.data));
  ok('eiPendingOf：明細の品名があれば取込済み（null）', await p.evaluate(d => { const c = JSON.parse(JSON.stringify(d)); const cells = c.rows.find(r => r._type === 'data').cells; cells[4] = 'THC'; return window.eiPendingOf(c) === null; }, row.data));
  ok('eiPendingOf：原文が無ければ null', await p.evaluate(d => { const c = JSON.parse(JSON.stringify(d)); c.fields['qf-import-src'] = ''; return window.eiPendingOf(c) === null; }, row.data));
  // 4) ダッシュボードの印・タイル・絞り込み
  await p.evaluate(() => window.cloudListPresets && window.cloudListPresets(true)); await p.waitForTimeout(1000);
  const tile = await p.evaluate(() => { const e = document.querySelector('#qpdStats .qpd-stat--pend'); return e ? e.textContent : null; });
  ok('統計タイルに「📩 1 未取込」が出る', tile && /1/.test(tile) && /未取込/.test(tile), tile);
  const badge = await p.evaluate(() => document.querySelectorAll('#qpDashboard .cloud-pend-badge, #qpDashboard .qpd-pend-mark').length);
  ok('案件カード/行に「📩 未取込」の印が出る', badge >= 1, badge);
  // もう 1 件（通常の案件）を足して絞り込みを確認
  await p.evaluate(() => { window.__db.quote_presets.push({ id: 'plain1', name: '通常案件', status: '下書き中', customer: 'X社', data: { fields: { 'qf-ref': 'R1' }, rows: [{ _type: 'data', cells: [false, '', '', false, 'THC'] }] }, updated_at: new Date().toISOString(), owner_email: 's@example.com', created_by: 's@example.com' }); });
  await p.evaluate(() => window.cloudListPresets(true)); await p.waitForTimeout(800);
  const allN = await p.evaluate(() => document.querySelectorAll('#qpDashboard .qpd-card, #qpDashboard .cloud-card, #qpDashboard .qpd-row').length);
  await p.click('#qpdStats .qpd-stat--pend'); await p.waitForTimeout(500);
  const pendN = await p.evaluate(() => document.querySelectorAll('#qpDashboard .cloud-card, #qpDashboard .qpd-row').length);
  ok('「未取込」タイルで絞り込める（通常案件は除かれる）', pendN === 1 && allN >= 2, { allN, pendN });
  ok('通常案件には未取込の印が付かない', await p.evaluate(() => !window.eiPendingOf(window.__db.quote_presets[1].data)));

  // 5) 取り込む（バッジ → 案件を開く → 編集開始 → 解析画面）
  await p.evaluate(() => document.querySelector('#qpDashboard .cloud-pend-badge') && document.querySelector('#qpDashboard .cloud-pend-badge').click()); await p.waitForTimeout(1500);
  ok('案件が開く（エディタ画面）', await p.evaluate(() => !document.getElementById('tab-quote-make').classList.contains('qp-dash')));
  ok('編集を開始し（閲覧モードでない）、保管した原文でメール取込画面が開く', await vis('#emailImportModal.open') && !(await p.evaluate(() => document.getElementById('tab-quote-make').classList.contains('qmode-view'))));
  ok('保管した原文が貼り付け欄に入り、自動で解析される（明細候補が出る）', (await p.inputValue('#eiText')) === RAW && (await p.evaluate(() => document.querySelectorAll('#eiReviewWrap .ei-row').length)) >= 2);
  ok('「📩 未取込」の帯が出ている（原文あり・明細なし）', await vis('#eiPendingBanner'));
  // 挿入
  await p.click('#eiActions .ei-act-insert'); await p.waitForTimeout(800);
  const nm = await p.evaluate(() => [...document.querySelectorAll('#tableBody tr:not([data-virtual]) [data-field="nm"]')].map(i => i.value).filter(Boolean));
  ok('表に取り込まれる（海上運賃／THC／ドレージ）', nm.length >= 3 && nm.some(n => /海上運賃/.test(n)) && nm.some(n => /THC/.test(n)), nm);
  ok('取り込み後は帯が消える（取込済み）', !(await vis('#eiPendingBanner')));
  ok('原文は案件に残る', await p.evaluate(() => { try { return !!JSON.parse(document.getElementById('qf-import-src').value).rawText; } catch (e) { return false; } }));
  // 保存 → 一覧で未取込でなくなる
  await p.evaluate(() => window.cloudSaveCurrent({ toDashboard: true })); await p.waitForTimeout(1500);
  const after = await p.evaluate(() => window.__db.quote_presets.filter(r => window.eiPendingOf(r.data)).length);
  ok('保存後は未取込 0 件（印・タイルが消える）', after === 0, after);
  await p.evaluate(() => window.cloudListPresets(true)); await p.waitForTimeout(800);
  ok('タイルも消える', !(await vis('#qpdStats .qpd-stat--pend')));

  // 6) 編集画面から「原文のまま保管」
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(600);
  ok('新規見積では帯は出ない', !(await vis('#eiPendingBanner')));
  await p.evaluate(() => { const c = document.getElementById('qf-customer'); c.value = '編集画面から保管社'; });
  await p.evaluate(() => window.openEmailImport()); await p.waitForTimeout(300);
  ok('編集画面から開くと通常表示（解析ボタンあり・お客様欄なし）', await vis('#emailImportBox .ei-parse-btn') && !(await vis('#eiS-customer')) && /メール取込/.test(await p.textContent('#eiTitle')));
  await p.fill('#eiText', '編集画面からの自由入力\nTHC 30000円');
  const n0 = await p.evaluate(() => window.__db.quote_presets.length);
  await p.click('#emailImportBox .ei-store-btn'); await p.waitForTimeout(1500);
  const n1 = await p.evaluate(() => window.__db.quote_presets.length);
  const last = await p.evaluate(() => window.__db.quote_presets[window.__db.quote_presets.length - 1]);
  ok('編集画面からの保管で案件が保存され、原文が入る', n1 === n0 + 1 && last.customer === '編集画面から保管社' && /編集画面からの自由入力/.test(last.data.fields['qf-import-src']), { n0, n1 });
  ok('その案件は未取込として判定される', await p.evaluate(r => !!window.eiPendingOf(r.data), last));

  // 7) 閲覧モードでは挿入できない
  await p.evaluate(id => window.cloudLoadPreset(encodeURIComponent(id)), last.id); await p.waitForTimeout(1200);
  ok('閲覧モードで開いた未取込の案件にも帯が出る（帯は閲覧中でも押せる位置）', await vis('#eiPendingBanner') && await p.evaluate(() => !document.getElementById('eiPendingBanner').closest('.quote-main')));

  ok('JS エラーなし', errs.length === 0, errs);
  await ctx.close(); await b.close(); srv.close();
  const fails = out.filter(l => l.startsWith('FAIL')).length;
  console.log('\nFAIL=' + fails);
  process.exit(fails ? 1 : 0);
})();
