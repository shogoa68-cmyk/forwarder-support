// 「📨 受信した通知（Webhook）」と「通知できる操作」（js/cp-notify.js）の試験（Chromium）。cp-proxy は偽の応答に差し替える（サイバーポートへは接続しない）。
// 使い方： node scripts/cp-tests/cp-notify-test.js   （サーバーはこの試験が自分で立てる）
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = (() => { try { return require(process.env.PLAYWRIGHT_PATH || 'playwright'); } catch (e) { return require('/opt/node-tools/node_modules/playwright'); } })();
let pass = 0, failN = 0;
function ok(c, name, extra) { if (c) pass++; else { failN++; console.log('✗ NG:', name, extra || ''); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, ' 実際=' + JSON.stringify(a) + ' 期待=' + JSON.stringify(b)); }

(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch(process.env.PLAYWRIGHT_PATH ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'ja-JP' });
  await ctx.route((u) => !u.href.startsWith('http://127.0.0.1'), (r) => (/functions\/v1\/cp-proxy/.test(r.request().url()) ? r.continue() : r.abort()));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  const sent = [];
  let respond = () => ({ status: 200, body: { ok: true } });
  await p.route('**/functions/v1/cp-proxy', async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || '{}');
    sent.push({ body, auth: req.headers()['authorization'] });
    const r = respond(body);
    return route.fulfill({ status: r.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(r.body) });
  });
  await p.goto(BASE, { waitUntil: 'load' });
  await p.evaluate(() => { window.cloudGetClient = () => ({ auth: { getSession: async () => ({ data: { session: window.__noSession ? null : { access_token: 'jwt-abc' } } }) } }); window.CLOUD_CONFIG = Object.assign({}, window.CLOUD_CONFIG, { url: 'http://127.0.0.1:1', publishableKey: 'k' }); });
  await p.evaluate(() => switchCategory('cptest', document.querySelector('.cat-btn[aria-controls="tab-cptest"]')));
  await p.waitForSelector('#cptPing');
  // cp-proxy の送り先をテスト用に差し替える（cyberport.js は CLOUD_CONFIG.url を使う）
  await p.route('http://127.0.0.1:1/functions/v1/cp-proxy', async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || '{}'); sent.push({ body, auth: req.headers()['authorization'] });
    const r = respond(body);
    return route.fulfill({ status: r.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(r.body) });
  });
  const okBody = (api, data) => ({ status: 200, body: { ok: true, api, status: 200, data } });
  const router = (map) => (body) => { const k = Object.keys(map).find((x) => (body.path || '').startsWith(x)); return map[k] ? map[k](body) : okBody('x', []); };
  const txt = (sel) => p.locator(sel).innerText();
  const H = 3600 * 1000, iso = (ms) => new Date(Date.now() + ms).toISOString();

  // ===== ⑤ 通知できる操作の一覧 =====
  const opsData = [
    { notifiableOperationCode: 'OP-001', operationType: { operationTypeName: '帳票を提出した' }, reportType: { reportName: 'B/L' }, process: { processName: '船積' } },
    { notifiableOperationCode: 'OP-002', operationType: { operationTypeName: 'EDIFACTを受信した' }, reportType: { reportName: 'ブッキング確認' }, process: { processName: '<img src=x onerror="window.__xss=2">' } },
    { notifiableOperationCode: 'OP-003', operationType: { operationTypeName: 'メッセージを送信した' }, reportType: null, process: null },
  ];
  respond = router({ '/API/v2/Master/NotifiableOperations/GetList': () => okBody('Master/NotifiableOperations/GetList', opsData) });
  const nOps = sent.length;
  await p.evaluate(() => { document.querySelector('.cpt-notify-ops').open = true; });
  await p.click('#cptOps');
  await p.waitForSelector('#cptOpsBody .cpt-table');
  eq(sent.slice(nOps).map((x) => x.body), [{ action: 'get', path: '/API/v2/Master/NotifiableOperations/GetList', query: {} }], '⑤ 通知できる操作：読み取りの API を 1 回呼ぶ');
  eq(await p.locator('#cptOpsBody .cpt-table tbody tr').count(), 3, '⑤ 3 件を表示');
  ok(/EDIFACT に関する操作：1 件/.test(await p.locator('#cptOpsBody .cpt-hint').first().innerText()), '⑤ EDIFACT に関する操作の件数を案内');
  ok(await p.evaluate(() => window.__xss !== 2), '⑤ 表の中の HTML は実行されない');
  await p.fill('#cptOpFilter', 'メッセージ');
  await p.waitForFunction(() => document.querySelectorAll('#cptOpsBody .cpt-table tbody tr').length === 1);
  ok(/OP-003/.test(await p.locator('#cptOpsBody .cpt-table tbody').innerText()), '⑤ 絞り込み：入力するとその場で絞られる');
  const nOps2 = sent.length;
  await p.fill('#cptOpFilter', 'edifact');
  await p.waitForFunction(() => /OP-002/.test(document.querySelector('#cptOpsBody .cpt-table tbody')?.innerText || ''));
  eq(sent.length, nOps2, '⑤ 絞り込みでは再取得しない（取得済みを使う）');
  await p.fill('#cptOpFilter', 'zzzz');
  await p.waitForFunction(() => /一致する操作がありません/.test(document.getElementById('cptOpsBody').innerText));
  ok(true, '⑤ 一致なしの案内');
  await p.fill('#cptOpFilter', '');

  // ===== 📨 受信した通知（Webhook） =====
  const evRows = [
    { id: 3, received_at: '2026-11-10T03:00:00Z', kind: 'message', history_id: 'H-MSG', operation_code: 'MsgSend', operation_name: 'メッセージを送信した', trade_no: 'IMP_20261110', bl_no: null, report_code: null, report_name: null, container_no: null, payload: { notifyOperation: { historyId: 'H-MSG', inMessage: { message: '<img src=x onerror="window.__xss=3">こんにちは' } } } },
    { id: 2, received_at: '2026-11-10T02:00:00Z', kind: 'report', history_id: 'H-RPT', operation_code: 'Submit', operation_name: '帳票を提出した', trade_no: 'EXP_20261110', bl_no: 'ONEYTYOGF8748400', report_code: 'BL', report_name: 'B/L', container_no: 'OOLU3962900', payload: { notifyOperation: { historyId: 'H-RPT' } } },
    { id: 1, received_at: '2026-11-10T01:00:00Z', kind: 'naccs', history_id: null, operation_code: 'Naccs', operation_name: 'NACCS電文を受信した', trade_no: null, bl_no: null, report_code: null, report_name: null, container_no: null, payload: { notifyOperation: { inNaccs: { naccsBusinessCode: 'IAL' } } } },
  ];
  const installFake = (rows, errorObj) => p.evaluate(({ rows, errorObj }) => {
    window.__evHandlers = []; window.__evQueries = []; window.__evSubStatus = null;
    window.cloudGetClient = () => ({
      auth: { getSession: async () => ({ data: { session: window.__noSession ? null : { access_token: 'jwt-abc' } } }) },
      from(table) {
        const st = { table, kind: null, id: null, cols: null }; const api = {
          select(c) { st.cols = c; return api; }, order() { return api; }, limit() { return api; },
          eq(k, v) { if (k === 'kind') st.kind = v; if (k === 'id') st.id = v; return api; },
          then(res) {
            window.__evQueries.push({ table, cols: st.cols, kind: st.kind, id: st.id });
            if (errorObj) return res({ data: null, error: errorObj });
            if (st.id != null) { const r = rows.find((x) => String(x.id) === String(st.id)); return res({ data: r ? [{ payload: r.payload }] : [], error: null }); }
            const list = rows.filter((x) => !st.kind || x.kind === st.kind).map((x) => { const y = Object.assign({}, x); delete y.payload; return y; });
            return res({ data: list, error: null });
          },
        }; return api;
      },
      channel() { const ch = { on(type, filter, cb) { window.__evHandlers.push(cb); return ch; }, subscribe(cb) { setTimeout(() => cb('SUBSCRIBED'), 0); return ch; } }; return ch; },
      removeChannel() {},
    });
  }, { rows, errorObj });
  await installFake(evRows);
  await p.click('#cptEvReload');
  await p.waitForSelector('#cptEvBody .cpt-ev-table');
  eq(await p.locator('#cptEvBody tbody tr').count(), 3, '通知：3 件を表示');
  const evQ = await p.evaluate(() => window.__evQueries[0]);
  ok(!/payload/.test(evQ.cols) && /history_id/.test(evQ.cols), '通知：一覧では本文（payload）を取らない（軽くする）', evQ.cols);
  let evText = await p.locator('#cptEvBody tbody').innerText();
  ok(/チャット/.test(evText) && /帳票/.test(evText) && /NACCS/.test(evText), '通知：種類のラベル（チャット・帳票・NACCS）');
  ok(/メッセージを送信した/.test(evText) && /IMP_20261110/.test(evText) && /ONEYTYOGF8748400/.test(evText) && /OOLU3962900/.test(evText) && /H-RPT/.test(evText), '通知：操作・取引番号・B/L・コンテナ・履歴ID を表示');
  ok(/2026\/11\/10 12:00/.test(evText), '通知：受信時刻を日本時間で表示（03:00Z → 12:00）');
  await p.waitForFunction(() => /受信待機中/.test(document.getElementById('cptEvStatus').innerText));
  const stH = await p.locator('#cptEvStatus').innerHTML();
  ok(await p.locator('#cptEvStatus .cpt-live-dot.is-on').count() === 1 && /3 件/.test(stH), '通知：件数とリアルタイム受信待機の表示', stH);

  // 詳細：本文を読み込んで表示（HTML は実行されない）
  await p.locator('#cptEvBody .cpt-ev-detail-btn').first().click();
  await p.waitForSelector('#cptEvBody .cpt-ev-detail pre');
  ok(/inMessage/.test(await p.locator('#cptEvBody .cpt-ev-detail pre').innerText()), '通知：詳細で本文（JSON）を表示');
  ok(await p.evaluate(() => window.__xss !== 3), '通知：本文の中の HTML は実行されない');
  const payloadQ = await p.evaluate(() => window.__evQueries.at(-1));
  eq([payloadQ.cols, Number(payloadQ.id)], ['payload', 3], '通知：詳細を開いたときだけ、その 1 件の本文を取る');
  // 履歴の取得（読み取りの API）
  respond = router({ '/API/v2/Trades/Histories/Get/': () => okBody('Trades/Histories/Get', { historyId: 'H-MSG', operationType: { operationTypeName: 'メッセージを送信した' } }) });
  const nH = sent.length;
  await p.locator('#cptEvBody .cpt-ev-hist-btn').first().click();
  await p.waitForFunction(() => /operationTypeName/.test(document.querySelector('.cpt-ev-hist')?.innerText || ''));
  eq(sent.slice(nH).map((x) => x.body.path), ['/API/v2/Trades/Histories/Get/H-MSG'], '通知：履歴の取得は、読み取りの API を履歴IDで 1 回');
  await p.locator('#cptEvBody .cpt-ev-detail-btn').first().click();
  eq(await p.locator('#cptEvBody .cpt-ev-detail').count(), 0, '通知：もう一度押すと閉じる');

  // 種類で絞り込み
  await p.selectOption('#cptEvKind', 'report');
  await p.waitForFunction(() => document.querySelectorAll('#cptEvBody tbody tr').length === 1);
  ok(/帳票を提出した/.test(await p.locator('#cptEvBody tbody').innerText()), '通知：種類で絞り込み（帳票だけ）');
  eq((await p.evaluate(() => window.__evQueries.at(-1))).kind, 'report', '通知：絞り込みは取得の条件にも使う');
  // リアルタイム：絞り込み中は、種類の違う新着は入れない
  const newRow = { id: 99, received_at: '2026-11-10T05:00:00Z', kind: 'message', history_id: 'H-NEW', operation_code: 'MsgSend', operation_name: '新着メッセージ', trade_no: 'IMP_NEW', payload: { notifyOperation: { historyId: 'H-NEW' } } };
  await p.evaluate((row) => window.__evHandlers.forEach((cb) => cb({ new: row })), newRow);
  eq(await p.locator('#cptEvBody tbody tr').count(), 1, '通知：絞り込み中は、種類の違う新着を出さない');
  await p.selectOption('#cptEvKind', '');
  await p.waitForFunction(() => document.querySelectorAll('#cptEvBody tbody tr').length === 3);
  await p.evaluate((row) => window.__evHandlers.forEach((cb) => cb({ new: row })), newRow);
  await p.waitForFunction(() => document.querySelectorAll('#cptEvBody tbody tr').length === 4);
  ok(/新着メッセージ/.test(await p.locator('#cptEvBody tbody tr').first().innerText()), '通知：新着は自動で先頭に増える（リアルタイム）');
  ok(await p.locator('#cptEvBody tbody tr.cpt-ev-new').count() === 1, '通知：新着の行は目立たせる');
  ok(/4 件/.test(await p.locator('#cptEvStatus').innerText()), '通知：件数が更新される');
  await p.evaluate((row) => window.__evHandlers.forEach((cb) => cb({ new: row })), newRow);
  eq(await p.locator('#cptEvBody tbody tr').count(), 4, '通知：同じ通知が重ねて届いても 1 件のまま');
  // 新着の詳細は、すでに受け取った本文を使う（取り直さない）
  const nq = await p.evaluate(() => window.__evQueries.length);
  await p.locator('#cptEvBody .cpt-ev-detail-btn').first().click();
  await p.waitForSelector('#cptEvBody .cpt-ev-detail pre');
  eq(await p.evaluate(() => window.__evQueries.length), nq, '通知：新着の詳細は、受け取った本文を使う（再取得しない）');

  // 通知がまだ無い／表が未作成／未ログイン
  await installFake([]);
  await p.click('#cptEvReload');
  await p.waitForFunction(() => /通知はまだありません/.test(document.getElementById('cptEvBody').innerText));
  ok(/cp-events|docs\/サイバーポート連携-Webhook/.test(await p.locator('#cptEvBody').innerText()), '通知：0 件のとき、設定手順の案内を出す');
  await installFake([], { code: 'PGRST205', message: "Could not find the table 'public.cp_events' in the schema cache" });
  await p.click('#cptEvReload');
  await p.waitForFunction(() => /cp-events\.sql/.test(document.getElementById('cptEvBody').innerText));
  ok(await p.locator('#cptEvBody .cpt-msg.is-info').count() === 1 && await p.locator('#cptEvBody .cpt-msg.is-error').count() === 0, '通知：表が未作成なら、エラーではなく案内（SQL を流す）');
  await installFake([], { code: '42501', message: 'permission denied for table cp_events' });
  await p.click('#cptEvReload');
  await p.waitForSelector('#cptEvBody .cpt-msg.is-error');
  ok(/permission denied/.test(await p.locator('#cptEvBody').innerText()), '通知：権限エラーは、そのまま表示');
  await installFake(evRows);
  await p.evaluate(() => { window.__noSession = true; });
  await p.click('#cptEvReload');
  await p.waitForFunction(() => /ログインが必要/.test(document.getElementById('cptEvBody').innerText));
  ok(true, '通知：未ログインなら、ログインを案内');
  await p.evaluate(() => { window.__noSession = false; });
  await p.click('#cptEvReload');
  await p.waitForSelector('#cptEvBody .cpt-ev-table');
  ok(true, '通知：ログイン後は、再読み込みで表示できる');
  // 以降の試験のために、元の簡易なスタブへ戻す
  await p.evaluate(() => { window.cloudGetClient = () => ({ auth: { getSession: async () => ({ data: { session: window.__noSession ? null : { access_token: 'jwt-abc' } } }) } }); });


  ok(errs.length === 0, 'ページのエラーが無い', errs.join(' / '));
  await b.close(); srv.close();
  console.log(`\n通知画面 試験：${pass} 件合格 / ${failN} 件失敗`);
  process.exit(failN ? 1 : 0);
})();
