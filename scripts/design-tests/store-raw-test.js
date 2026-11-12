// 📝 自由入力で保管（新規案件・既存案件に複数件）→ 📩 未取込 → 取り込み／取込済み／削除。偽の Supabase（メモリ上の表）を使う。実サーバーには接続しない。
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
  // 2) 新しい案件として保管
  const RAW = 'PENANG向け 暫定提示\n海上運賃 20FT 1本 USD 475\nTHC 34,900円 + 税\nドレージ 実費';
  await p.fill('#eiText', RAW); await p.fill('#eiS-customer', '株式会社テスト商事'); await p.fill('#eiS-memo', '横浜→PENANG 暫定提示');
  const dlgBefore = dlg.length;
  await p.click('#emailImportBox .ei-store-btn'); await p.waitForTimeout(1500);
  const row = await p.evaluate(() => window.__db.quote_presets[0] || null);
  ok('案件が 1 件保存される', !!row, row);
  const ents = row && (() => { try { return JSON.parse(row.data.fields['qf-free-entries']); } catch (e) { return null; } })();
  ok('原文が「保管した自由入力」の 1 件目（未取込・メモ・保管者・日時つき）として入る', ents && ents.length === 1 && ents[0].text === RAW && ents[0].status === 'pending' && ents[0].label === '横浜→PENANG 暫定提示' && ents[0].by === 's@example.com' && !!ents[0].at && !!ents[0].id, ents);
  ok('お客様名が列に昇格し、件名がメモに入る', row && row.customer === '株式会社テスト商事' && row.data.fields['qf-memo'] === '横浜→PENANG 暫定提示', row && { c: row.customer, m: row.data.fields['qf-memo'] });
  ok('保存後は確認ダイアログなしでダッシュボードに戻り、モーダルは閉じる', await p.evaluate(() => document.getElementById('tab-quote-make').classList.contains('qp-dash')) && !(await vis('#emailImportModal.open')) && dlg.length === dlgBefore, dlg);
  ok('明細の品名は 0 件（原文だけの案件）', row && !row.data.rows.some(r => r._type === 'data' && String(r.cells[4] || '').trim()), row && row.data.rows);
  ok('ダッシュボードには保管欄を出さない（編集画面だけ）', !(await vis('#eiFreePanel')));
  // 3) 未取込の判定
  ok('eiPendingOf：未取込の保管が 1 件 → 1 件の配列', await p.evaluate(d => { const r = window.eiPendingOf(d); return Array.isArray(r) && r.length === 1; }, row.data));
  ok('eiPendingOf：すべて取込済みなら null（明細が無くても）', await p.evaluate(d => { const c = JSON.parse(JSON.stringify(d)); const e = JSON.parse(c.fields['qf-free-entries']); e.forEach(x => x.status = 'done'); c.fields['qf-free-entries'] = JSON.stringify(e); return window.eiPendingOf(c) === null; }, row.data));
  ok('eiPendingOf：保管が無ければ null', await p.evaluate(d => { const c = JSON.parse(JSON.stringify(d)); c.fields['qf-free-entries'] = ''; return window.eiPendingOf(c) === null; }, row.data));
  ok('旧形式（原文だけ・明細なし）は 1 件の未取込として読む／明細があれば null', await p.evaluate(() => {
    const mk = rows => ({ fields: { 'qf-import-src': JSON.stringify({ type: 'email-paste', rawText: '旧形式の原文', importedAt: '2026-11-02T00:00:00Z' }) }, rows });
    const a = window.eiPendingOf(mk([{ _type: 'data', cells: [false, '', '', false, ''] }]));
    const b = window.eiPendingOf(mk([{ _type: 'data', cells: [false, '', '', false, 'THC'] }]));
    return a && a.length === 1 && a[0].id === 'legacy' && b === null;
  }));
  // 4) ダッシュボードの印・タイル・絞り込み
  await p.evaluate(() => window.cloudListPresets && window.cloudListPresets(true)); await p.waitForTimeout(1000);
  const tile = await p.evaluate(() => { const e = document.querySelector('#qpdStats .qpd-stat--pend'); return e ? e.textContent : null; });
  ok('統計タイルに「📩 1 未取込」が出る', tile && /1/.test(tile) && /未取込/.test(tile), tile);
  const badgeT = await p.evaluate(() => (document.querySelector('#qpDashboard .cloud-pend-badge, #qpDashboard .qpd-pend-mark') || {}).textContent);
  ok('案件カード/行に「📩 未取込 1件」の印が出る', /未取込\s*1件/.test(badgeT || ''), badgeT);
  await p.evaluate(() => { window.__db.quote_presets.push({ id: 'plain1', name: '通常案件', status: '下書き中', customer: 'X社', data: { fields: { 'qf-ref': 'R1' }, rows: [{ _type: 'data', cells: [false, '', '', false, 'THC'] }] }, updated_at: new Date().toISOString(), owner_email: 's@example.com', created_by: 's@example.com' }); });
  await p.evaluate(() => window.cloudListPresets(true)); await p.waitForTimeout(800);
  const allN = await p.evaluate(() => document.querySelectorAll('#qpDashboard .qpd-card, #qpDashboard .cloud-card, #qpDashboard .qpd-row').length);
  await p.click('#qpdStats .qpd-stat--pend'); await p.waitForTimeout(500);
  const pendN = await p.evaluate(() => document.querySelectorAll('#qpDashboard .cloud-card, #qpDashboard .qpd-row').length);
  ok('「未取込」タイルで絞り込める（通常案件は除かれる）', pendN === 1 && allN >= 2, { allN, pendN });
  ok('通常案件には未取込の印が付かない', await p.evaluate(() => !window.eiPendingOf(window.__db.quote_presets[1].data)));
  await p.click('#qpdStats .qpd-stat--pend'); await p.waitForTimeout(300);   // 絞り込みを戻す

  // 5) 取り込む（バッジ → 案件を開く → 編集開始 → 解析画面）
  await p.evaluate(() => document.querySelector('#qpDashboard .cloud-pend-badge') && document.querySelector('#qpDashboard .cloud-pend-badge').click()); await p.waitForTimeout(1500);
  ok('案件が開く（エディタ画面）', await p.evaluate(() => !document.getElementById('tab-quote-make').classList.contains('qp-dash')));
  ok('未取込が 1 件なので、編集を開始して保管した原文でメール取込画面が開く', await vis('#emailImportModal.open') && !(await p.evaluate(() => document.getElementById('tab-quote-make').classList.contains('qmode-view'))));
  ok('原文が貼り付け欄に入り、自動で解析される（明細候補が出る）', (await p.inputValue('#eiText')) === RAW && (await p.evaluate(() => document.querySelectorAll('#eiReviewWrap .ei-row').length)) >= 2);
  ok('保管欄に 1 件（📩 未取込）が出る', await vis('#eiFreePanel') && (await p.evaluate(() => document.querySelectorAll('#eiFreePanel .ei-fe-row').length)) === 1 && /未取込/.test(await p.textContent('#eiFreePanel .ei-fe-chip')));
  ok('保管した原文からの取り込みでは「新規案件として展開」を出さない', !(await vis('#eiActions .ei-act-new')));
  await p.click('#eiActions .ei-act-insert'); await p.waitForTimeout(800);
  const nm = await p.evaluate(() => [...document.querySelectorAll('#tableBody tr:not([data-virtual]) [data-field="nm"]')].map(i => i.value).filter(Boolean));
  ok('表に取り込まれる（海上運賃／THC／ドレージ）', nm.length >= 3 && nm.some(n => /海上運賃/.test(n)) && nm.some(n => /THC/.test(n)), nm);
  ok('取り込んだ 1 件は「✅ 取込済み」になる（原文は残る）', await p.evaluate(() => { const e = JSON.parse(document.getElementById('qf-free-entries').value); return e.length === 1 && e[0].status === 'done' && !!e[0].text; }) && /すべて取込済み/.test(await p.textContent('#eiFreePanel .ei-fp-sum')));
  await p.evaluate(() => window.cloudSaveCurrent({ toDashboard: true })); await p.waitForTimeout(1500);
  ok('保存後は未取込 0 件（印・タイルが消える）', (await p.evaluate(() => window.__db.quote_presets.filter(r => window.eiPendingOf(r.data)).length)) === 0);
  await p.evaluate(() => window.cloudListPresets(true)); await p.waitForTimeout(800);
  ok('タイルも消える', !(await vis('#qpdStats .qpd-stat--pend')));
  const caseId = await p.evaluate(() => window.__db.quote_presets[0].id);

  // 6) 既存の案件へ、カードの「⋯」から保管を足す（案件は開かない）
  const dl6 = dlg.length;
  await p.evaluate(id => window.eiOpenStoreForCard(encodeURIComponent(id)), caseId); await p.waitForTimeout(400);
  ok('既存案件への保管は、メモ欄だけ（お客様・件名の欄は出ない）', await vis('#emailImportModal.open') && await vis('#eiS-label') && !(await vis('#eiS-customer')) && !(await vis('#eiS-memo')));
  const RAW2 = '改定見積（○○社 11/2 受領）\n海上運賃 20FT USD 520';
  await p.fill('#eiText', RAW2); await p.fill('#eiS-label', '○○社 改定見積 11/2 受領');
  await p.click('#emailImportBox .ei-store-btn'); await p.waitForTimeout(1500);
  const c6 = await p.evaluate(id => window.__db.quote_presets.find(r => r.id === id), caseId);
  const e6 = JSON.parse(c6.data.fields['qf-free-entries']);
  ok('既存案件に 2 件目が足される（1 件目は取込済みのまま・2 件目は未取込）', e6.length === 2 && e6[0].status === 'done' && e6[1].status === 'pending' && e6[1].text === RAW2 && e6[1].label === '○○社 改定見積 11/2 受領', e6);
  ok('案件の明細・ステータス・お客様は変わらない', c6.status === '下書き中' && c6.customer === '株式会社テスト商事' && c6.data.rows.some(r => r._type === 'data' && /海上運賃/.test(String(r.cells[4] || ''))), { s: c6.status });
  ok('ダッシュボードのまま・確認ダイアログなし・モーダルは閉じる', await p.evaluate(() => document.getElementById('tab-quote-make').classList.contains('qp-dash')) && !(await vis('#emailImportModal.open')) && dlg.length === dl6, dlg.slice(dl6));
  await p.waitForTimeout(800);
  ok('明細があっても、未取込の保管があれば一覧に「📩 未取込 1件」が出る', await vis('#qpdStats .qpd-stat--pend') && /未取込\s*1件/.test(await p.evaluate(() => (document.querySelector('#qpDashboard .cloud-pend-badge, #qpDashboard .qpd-pend-mark') || {}).textContent || '')));
  ok('カードの「⋯」メニューに「📝 自由入力を追加」がある', await p.evaluate(() => !!document.querySelector('#qpDashboard .cloud-menu-item[onclick*="eiOpenStoreForCard"]')));

  // 7) 案件を開く → 保管欄（閲覧モードでも操作でき、必要なら編集を開始）
  await p.evaluate(id => window.cloudLoadPreset(encodeURIComponent(id)), caseId); await p.waitForTimeout(1200);
  ok('閲覧モードで開いても保管欄が出る（.quote-main の外）・2 件・未取込 1 件', await vis('#eiFreePanel') && await p.evaluate(() => !document.getElementById('eiFreePanel').closest('.quote-main') && document.querySelectorAll('#eiFreePanel .ei-fe-row').length === 2 && document.querySelectorAll('#eiFreePanel .ei-fe-chip.pending').length === 1));
  ok('未取込があるので保管欄は開いている', await p.evaluate(() => document.getElementById('eiFreePanel').open));
  ok('閲覧モードである', await p.evaluate(() => document.getElementById('tab-quote-make').classList.contains('qmode-view')));
  // 「原文」で本文を見る
  await p.click('#eiFreePanel .ei-fe-row:nth-child(2) .ei-fe-btn:nth-child(2)'); await p.waitForTimeout(200);
  ok('「原文」で保管した本文が見える', await p.evaluate(() => { const pre = document.querySelectorAll('#eiFreePanel .ei-fe-text')[1]; return !pre.hidden && /改定見積/.test(pre.textContent); }));
  // 取込済みにする（閲覧中 → 自動で編集を開始）
  await p.click('#eiFreePanel .ei-fe-row:nth-child(2) .ei-fe-btn:nth-child(3)'); await p.waitForTimeout(900);
  ok('「取込済みにする」で編集を開始し、2 件目が取込済みになる', await p.evaluate(() => !document.getElementById('tab-quote-make').classList.contains('qmode-view') && document.querySelectorAll('#eiFreePanel .ei-fe-chip.done').length === 2));
  await p.click('#eiFreePanel .ei-fe-row:nth-child(2) .ei-fe-btn:nth-child(3)'); await p.waitForTimeout(300);
  ok('「未取込に戻す」で戻せる', await p.evaluate(() => document.querySelectorAll('#eiFreePanel .ei-fe-chip.pending').length === 1));
  // 取り込む（2 件目）
  await p.click('#eiFreePanel .ei-fe-row:nth-child(2) .ei-fe-import'); await p.waitForTimeout(700);
  ok('2 件目の原文でメール取込画面が開き、解析される', (await p.inputValue('#eiText')) === RAW2 && (await p.evaluate(() => document.querySelectorAll('#eiReviewWrap .ei-row').length)) >= 1);
  await p.click('#eiActions .ei-act-insert'); await p.waitForTimeout(600);
  ok('取り込むと、その 1 件だけが取込済みになる', await p.evaluate(() => document.querySelectorAll('#eiFreePanel .ei-fe-chip.done').length === 2));
  // 編集画面から追加（⋯ メニュー）→ 確認なしで保存・この案件に留まる
  const dl7 = dlg.length;
  await p.evaluate(() => window.eiOpenStoreForCurrent()); await p.waitForTimeout(500);
  ok('編集画面からの追加も、メモ欄だけの保管専用表示', await vis('#emailImportModal.open') && await vis('#eiS-label') && !(await vis('#eiS-customer')));
  await p.fill('#eiText', '編集画面から足した原文\nTHC 30000円'); await p.fill('#eiS-label', '編集画面から');
  await p.click('#emailImportBox .ei-store-btn'); await p.waitForTimeout(1500);
  const c7 = await p.evaluate(id => window.__db.quote_presets.find(r => r.id === id), caseId);
  const e7 = JSON.parse(c7.data.fields['qf-free-entries']);
  ok('編集画面からの追加で 3 件目が保存される（未取込）', e7.length === 3 && e7[2].status === 'pending' && /編集画面から足した原文/.test(e7[2].text) && e7[2].label === '編集画面から', e7.map(x => x.status));
  ok('保存後も、この案件の画面に留まり・確認ダイアログも出ない', await p.evaluate(() => !document.getElementById('tab-quote-make').classList.contains('qp-dash')) && dlg.length === dl7, dlg.slice(dl7));
  ok('保管欄に 3 件・未取込 1 件', await p.evaluate(() => document.querySelectorAll('#eiFreePanel .ei-fe-row').length === 3 && document.querySelectorAll('#eiFreePanel .ei-fe-chip.pending').length === 1));
  // 削除（確認 → 編集中に）
  await p.click('#eiFreePanel .ei-fe-row:nth-child(3) .ei-fe-del'); await p.waitForTimeout(400);
  ok('削除は確認画面が出る（やめる＝残る）', await vis('.confirm-dialog'));
  await p.click('.confirm-dialog .btn-cancel'); await p.waitForTimeout(300);
  ok('「やめる」では消えない', (await p.evaluate(() => document.querySelectorAll('#eiFreePanel .ei-fe-row').length)) === 3);
  await p.click('#eiFreePanel .ei-fe-row:nth-child(3) .ei-fe-del'); await p.waitForTimeout(300);
  await p.click('.confirm-dialog .btn-danger'); await p.waitForTimeout(500);
  ok('「削除する」で 3 件目が消える', (await p.evaluate(() => document.querySelectorAll('#eiFreePanel .ei-fe-row').length)) === 2);
  await p.evaluate(() => window.cloudSaveCurrent({ toDashboard: true })); await p.waitForTimeout(1500);
  const c8 = await p.evaluate(id => window.__db.quote_presets.find(r => r.id === id), caseId);
  ok('保存すると削除が反映され、未取込は 0 件', JSON.parse(c8.data.fields['qf-free-entries']).length === 2 && !(await p.evaluate(r => window.eiPendingOf(r.data), c8)));

  // 8) 新しい見積の編集画面から「原文のまま保管」（メール取込の画面）
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(600);
  ok('新規見積では保管欄は出ない', !(await vis('#eiFreePanel')));
  await p.evaluate(() => { const c = document.getElementById('qf-customer'); c.value = '編集画面から保管社'; });
  await p.evaluate(() => window.openEmailImport()); await p.waitForTimeout(300);
  ok('メール取込として開くと通常表示（解析ボタンあり・お客様欄なし）', await vis('#emailImportBox .ei-parse-btn') && !(await vis('#eiS-customer')) && /メール取込/.test(await p.textContent('#eiTitle')));
  await p.fill('#eiText', '編集画面からの自由入力\nTHC 30000円');
  const n0 = await p.evaluate(() => window.__db.quote_presets.length);
  await p.click('#emailImportBox .ei-store-btn'); await p.waitForTimeout(1500);
  const last = await p.evaluate(() => window.__db.quote_presets[window.__db.quote_presets.length - 1]);
  ok('新しい案件として保存され、保管が 1 件入る', (await p.evaluate(() => window.__db.quote_presets.length)) === n0 + 1 && last.customer === '編集画面から保管社' && JSON.parse(last.data.fields['qf-free-entries']).length === 1, { n0 });
  ok('その案件は未取込として判定される', await p.evaluate(r => !!window.eiPendingOf(r.data), last));
  ok('保存後も保管欄が出ている（閲覧モードでも）', await vis('#eiFreePanel'));

  // 9) 旧形式の 1 件を削除すると、取込元メモも空になり、読み込み直しても復活しない
  await p.evaluate(() => {
    document.getElementById('tab-quote-make').classList.remove('qmode-view');   // 編集中の状態にする
    document.getElementById('qf-free-entries').value = '';
    document.getElementById('qf-import-src').value = JSON.stringify({ type: 'email-paste', rawText: '旧形式の原文', importedAt: '2026-11-02T00:00:00Z' });
    document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type]) [data-field="nm"]').forEach(i => { i.value = ''; });
    window.eiRefreshPendingBanner();
  });
  ok('旧形式の原文が保管欄に 1 件出る', (await p.evaluate(() => document.querySelectorAll('#eiFreePanel .ei-fe-row').length)) === 1);
  await p.evaluate(() => { window.eiFeDelete('legacy'); }); await p.waitForTimeout(400);
  await p.click('.confirm-dialog .btn-danger'); await p.waitForTimeout(500);
  ok('旧形式の 1 件を削除したら復活しない（保管欄が隠れる・取込元メモも空）', await p.evaluate(() => document.getElementById('eiFreePanel').hidden && document.getElementById('qf-import-src').value === ''), await p.evaluate(() => ({ rows: document.querySelectorAll('#eiFreePanel .ei-fe-row').length, src: document.getElementById('qf-import-src').value, fe: document.getElementById('qf-free-entries').value })));

  ok('JS エラーなし', errs.length === 0, errs);
  await ctx.close(); await b.close(); srv.close();
  const fails = out.filter(l => l.startsWith('FAIL')).length;
  console.log('\nFAIL=' + fails);
  process.exit(fails ? 1 : 0);
})();
