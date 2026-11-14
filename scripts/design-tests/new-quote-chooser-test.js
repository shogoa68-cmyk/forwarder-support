// 🆕 新規見積の入口モーダル：「一から作成」「似ている案件を参考に作成」（お客様・積み港・揚げ港・モードで絞り込み → コピーして新規案件に）。
//   偽の Supabase（メモリ上）で、モーダルの出方・絞り込み・コピー後の編集画面（案件に固有の記録を引き継がない・クラウドに案件を作らない）を確かめる。
//   node scripts/design-tests/new-quote-chooser-test.js        （THEME=1 で Industry／W=390 でスマホ幅）
//   node scripts/design-tests/route-copy-test.js           （THEME=1 で Industry）
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

  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
    const cell = (sv, nm, pp, bp) => { const c = Array(34).fill(''); c[1] = 'other'; c[2] = sv; c[4] = nm; c[5] = '1'; c[6] = 'CNTR'; c[7] = '1'; c[8] = 'JPY'; c[9] = 'JPY'; c[10] = pp; c[11] = bp; return c; };
    const mk = (id, f, upd, rws, st) => ({ id, name: '案件' + id, status: st || '下書き中', customer: f['qf-customer'] || null, transport_mode: f['cond-mode'] || null, incoterms: f['cond-incoterms'] || null, pol: f['z2Pol'] || null, pod: f['z2Pod'] || null,
      created_by: 'me@x.com', owner_email: 'me@x.com', updated_at: upd, ref: 'R-' + id, data: { fields: Object.assign({ 'qf-ref': 'R-' + id }, f), rows: rws || [], _rowFormat: 'v3-mixed-rows' } });
    const rowsA = [{ _type: 'data', cells: cell('A社', 'THC', '10000', '12000'), done: true, doneAt: '2026-10-05T05:30:00.000Z', doneBy: 'yamada@x.com' }, { _type: 'data', cells: cell('A社', 'DOC FEE', '3000', '4000') }];
    const db = {
      quote_presets: [
        mk('A', { 'qf-customer': '株式会社サンプル商事', 'qf-person': '田中', 'z2Pol': 'TOKYO', 'z2Pod': 'SHANGHAI', 'cond-mode': '海上（FCL）', 'cond-incoterms': 'FOB（本船渡し）', 'qf-received': '2026-01-05', 'qf-date': '2026-01-06', 'qf-valid-until': '2026-01-31', 'qf-core-ref': 'CORE-1', 'qf-lost-reason': '価格', 'qf-memo': '社内メモ', 'qf-versions': '[{"x":1}]' }, '2026-11-10T00:00:00Z', rowsA, '受注'),
        mk('B', { 'qf-customer': 'サンプル商事', 'z2Pol': 'YOKOHAMA', 'z2Pod': 'SHANGHAI', 'cond-mode': '海上（LCL）' }, '2026-11-09T00:00:00Z'),
        mk('C', { 'qf-customer': 'ABC物産', 'z2Pol': 'TOKYO', 'z2Pod': 'BANGKOK', 'cond-mode': '航空' }, '2026-11-08T00:00:00Z'),
        mk('D', { 'qf-customer': 'ＡＢＣ物産', 'z2Pol': 'Tokyo', 'z2Pod': 'SINGAPORE', 'cond-mode': '海上（FCL）' }, '2026-11-07T00:00:00Z'),
        mk('E', {}, '2026-11-06T00:00:00Z'),
      ],
      quote_preset_links: [], allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }], user_profiles: [], quote_comments: [],
      master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [],
    };
    window.__db = db;
    const qb = t => {
      const st = { filters: [] };
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, is() { return api; }, ilike() { return api; },
        gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, or() { return api; },
        eq(k, v) { st.filters.push(r => r[k] === v); return api; }, in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
        insert() { return api; }, upsert() { return api; }, update() { return api; }, delete() { return api; },
        single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
        then(res, rej) {
          let data = (db[t] || []).filter(r => st.filters.every(f => f(r))).map(r => Object.assign({}, r));
          if (st.single) data = data[0] || null;
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return api;
    };
    const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() {} };
    const user = { email: 'me@x.com', user_metadata: { full_name: 'Me' } };
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


  const W = +(process.env.W || 1400);
  await p.setViewportSize({ width: W, height: 1000 });
  await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(1500);
  const q = (sel) => p.evaluate(s => !!document.querySelector(s), sel);
  const txt = (sel) => p.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
  const items = () => p.evaluate(() => [...document.querySelectorAll('#nqList .nq-item')].map(li => li.querySelector('.nq-name').textContent));
  const setv = async (id, v) => { await p.fill('#' + id, v); await p.waitForTimeout(120); };
  const openSimilar = async () => { await p.click('.qpd-new'); await p.waitForTimeout(200); await p.click('.nq-card[data-nq="similar"]'); await p.waitForTimeout(200); };
  const dbCount = () => p.evaluate(() => window.__db.quote_presets.length);

  // ===== 入口 =====
  await p.click('.qpd-new'); await p.waitForTimeout(250);
  ok('「新規見積を作成」でモーダルが開く（すぐには編集画面へ行かない）', await q('#nqOverlay') && await q('#qpDashboard') && !(await p.evaluate(() => document.getElementById('qpEditor') && !document.getElementById('qpEditor').hidden && getComputedStyle(document.getElementById('qpEditor')).display !== 'none')), null);
  ok('2 つの選択肢（一から作成／似ている案件を参考に作成）', (await p.evaluate(() => [...document.querySelectorAll('#nqOverlay .nq-card b')].map(b => b.textContent))).join() === '一から作成,似ている案件を参考に作成', null);
  ok('案件があるので「似ている案件」は押せる', await p.evaluate(() => !document.querySelector('.nq-card[data-nq="similar"]').disabled), null);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok('Esc で閉じる', !(await q('#nqOverlay')), null);
  await p.click('.qpd-new'); await p.waitForTimeout(200);
  await p.mouse.click(5, 5); await p.waitForTimeout(150);
  ok('背景を押すと閉じる', !(await q('#nqOverlay')), null);

  // ===== 一から作成 =====
  await p.click('.qpd-new'); await p.waitForTimeout(200);
  await p.click('.nq-card[data-nq="blank"]'); await p.waitForTimeout(600);
  ok('「一から作成」でモーダルが閉じ、空の編集画面になる', !(await q('#nqOverlay')) && (await p.inputValue('#qf-customer')) === '', null);
  await p.evaluate(() => window.qpShowDashboard()); await p.waitForTimeout(800);

  // ===== 似ている案件：絞り込み =====
  await openSimilar();
  ok('一覧に全 5 件（条件なし）', (await items()).length === 5 && /5 件/.test(await txt('#nqCount')), await items());
  await setv('nqCust', 'サンプル商事');
  ok('お客様で絞り込み（部分一致）→ A・B', (await items()).sort().join() === '案件A,案件B', await items());
  await setv('nqPol', 'tokyo');
  ok('積み港を足す（大文字小文字を無視）→ A だけ', (await items()).join() === '案件A', await items());
  await setv('nqPol', ''); await setv('nqCust', '');
  await setv('nqPod', 'shanghai');
  ok('揚げ港で絞り込み → A・B', (await items()).sort().join() === '案件A,案件B', await items());
  await p.selectOption('#nqMode', '海上（LCL）'); await p.waitForTimeout(120);
  ok('モードを足す → B だけ', (await items()).join() === '案件B', await items());
  await p.selectOption('#nqMode', ''); await setv('nqPod', '');
  await setv('nqCust', 'ＡＢＣ物産');
  ok('全角半角・表記の違いを無視してお客様を探す → C・D', (await items()).sort().join() === '案件C,案件D', await items());
  await setv('nqPol', 'TOKYO'); await setv('nqPod', 'SINGAPORE');
  ok('お客様＋積み港＋揚げ港 → D だけ', (await items()).join() === '案件D', await items());
  await setv('nqPod', 'NOWHERE');
  ok('一致なしは案内を出す', /条件に合う案件がありません/.test(await txt('#nqList')) && /0 件/.test(await txt('#nqCount')), await txt('#nqList'));
  await p.click('.nq-clear'); await p.waitForTimeout(150);
  ok('「条件をクリア」で全件に戻る', (await items()).length === 5, await items());
  await p.selectOption('#nqSort', 'cust'); await p.waitForTimeout(120);
  ok('並び順：お客様名順（お客様なしは最後）', (await items()).slice(-1)[0] === '案件E', await items());
  ok('候補（datalist）にお客様・港が出る', await p.evaluate(() => document.querySelectorAll('#nqCustList option').length >= 3 && document.querySelectorAll('#nqPortList option').length >= 4), null);
  await p.click('.nq-back'); await p.waitForTimeout(150);
  ok('「戻る」で選択肢に戻る', await q('.nq-card[data-nq="blank"]'), null);
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);

  // ===== コピーして新規案件に =====
  const before = await dbCount();
  await openSimilar();
  await setv('nqCust', 'サンプル商事'); await setv('nqPol', 'TOKYO');
  await p.evaluate(() => document.activeElement && document.activeElement.blur());   // 入力欄の候補（datalist）の吹き出しが開いたままだと、ヘッドレスでは最初のクリックがそれを閉じるだけになるため
  await p.click('#nqList .nq-copy'); await p.waitForTimeout(900);
  ok('モーダルが閉じて編集画面が開く', !(await q('#nqOverlay')), null);
  const f = await p.evaluate(() => ({
    cust: document.getElementById('qf-customer').value, person: document.getElementById('qf-person').value, pol: document.getElementById('z2Pol').value, pod: document.getElementById('z2Pod').value,
    mode: document.getElementById('cond-mode').value, inco: document.getElementById('cond-incoterms').value,
    ref: document.getElementById('qf-ref').value, core: (document.getElementById('qf-core-ref') || {}).value || '', lost: (document.getElementById('qf-lost-reason') || {}).value || '',
    status: document.getElementById('qf-status').value, recv: document.getElementById('qf-received').value, date: document.getElementById('qf-date').value, valid: document.getElementById('qf-valid-until').value,
    rows: document.querySelectorAll('#tableBody tr:not([data-virtual])').length, names: [...document.querySelectorAll('#tableBody tr [data-field="nm"]')].map(e => e.value),
    done: document.querySelectorAll('#tableBody tr.row-input-done').length, memo: (document.getElementById('qf-memo') || {}).value || '',
    copied: !!document.querySelector('#qfCopiedFromInfo .qf-copied-from-main:not(.qf-cf-empty)'),
  }));
  const today = await p.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  ok('お客様・担当者・積み港・揚げ港・モード・貿易条件を引き継ぐ', f.cust === '株式会社サンプル商事' && f.person === '田中' && f.pol === 'TOKYO' && f.pod === 'SHANGHAI' && f.mode === '海上（FCL）' && f.inco === 'FOB（本船渡し）', f);
  ok('明細行を引き継ぐ（THC・DOC FEE）', f.names.join() === 'THC,DOC FEE', f);
  ok('入力完了の記録は引き継がない', f.done === 0, f);
  ok('見積もり番号はコピー元のものを引き継がない', f.ref !== 'R-A', f.ref);
  ok('基幹 REF#・失注理由は引き継がない', f.core === '' && f.lost === '', f);
  ok('ステータスは下書き中に戻る', /下書き中/.test(f.status), f.status);
  ok('依頼受信日・発行日は今日・有効期限は新規の初期値（コピー元の 2026-01 ではない）', f.recv === today && f.date === today && f.valid !== '2026-01-31' && f.valid !== '', f);
  ok('「コピー元」の代替わりの印は付かない', !f.copied, f);
  ok('社内メモは引き継ぐ（📋 コピーと同じ）', f.memo === '社内メモ', f);
  ok('保存するまでクラウドに案件は増えない', (await dbCount()) === before, [before, await dbCount()]);
  ok('実行時エラーなし', errs.length === 0, errs);

  await b.close(); srv.close();
  console.log(fails ? '失敗 ' + fails + ' 件' : 'すべて成功');
  process.exit(fails ? 1 : 0);
})();
