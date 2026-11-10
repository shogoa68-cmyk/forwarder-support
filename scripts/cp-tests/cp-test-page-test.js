// CP(TEST) 画面の「実接続テスト」の試験（Chromium）。cp-proxy は偽の応答に差し替える（サイバーポートへは接続しない）。
// 使い方：サーバーを起動してから
//   (リポジトリ直下) python3 -m http.server 18765 &
//   node scripts/cp-tests/cp-test-page-test.js [スクリーンショットの保存先.png]
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright');

const BASE = 'http://localhost:18765/' + encodeURIComponent('フォワーダー支援') + '/index.html';
let pass = 0, failN = 0;
function ok(c, name, extra) { if (c) pass++; else { failN++; console.log('✗ NG:', name, extra || ''); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, ' 実際=' + JSON.stringify(a) + ' 期待=' + JSON.stringify(b)); }

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1200, height: 1100 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  const sent = []; // cp-proxy へ送られた本文
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
  // ログイン済みを装う
  await p.evaluate(() => {
    window.cloudGetClient = () => ({ auth: { getSession: async () => ({ data: { session: window.__noSession ? null : { access_token: 'jwt-abc' } } }) } });
  });
  await p.click('#catMoreBtn');
  await p.click('button[aria-controls="tab-cptest"]');
  await p.waitForSelector('#cptPing');

  // 初期表示：未確認（接続済みに見せない）
  const st0 = await p.$$eval('#cptRoot .cpt-st', (els) => els.map((e) => e.className + '|' + e.querySelector('.cpt-st-v').textContent));
  ok(st0[0].includes('is-off') && st0[0].includes('未確認'), '初期：APIは未確認');
  ok(st0[3].includes('is-ok') && st0[3].includes('読み取り専用'), '初期：書き込みは使わない');
  ok(await p.locator('.cpt-banner').innerText().then((t) => /サンプル/.test(t) && /読み取り/.test(t)), '注意書きにサンプルと読み取りの説明');

  // ① ping 成功
  respond = () => ({ status: 200, body: { ok: true, message: 'トークンを取得できました（接続情報は有効です）', tokenHost: 'api.cyber-port.net', apiHost: 'api.cyber-port.net' } });
  await p.click('#cptPing');
  await p.waitForSelector('#cptLive .cpt-msg.is-ok');
  eq(sent.at(-1).body, { action: 'ping' }, 'ping：送る内容');
  eq(sent.at(-1).auth, 'Bearer jwt-abc', 'ping：ログインのトークンを付けて呼ぶ');
  const st1 = await p.$$eval('#cptRoot .cpt-st', (els) => els.slice(0, 3).map((e) => e.className));
  ok(st1.every((c) => c.includes('is-ok')), 'ping 成功 → 接続状態が確認済みになる', JSON.stringify(st1));
  ok((await p.locator('#cptLive').innerText()).includes('api.cyber-port.net'), 'ping：接続先のホスト名を表示');

  // ② 番号で検索（正規化されて keyword に入る）
  respond = () => ({ status: 200, body: { ok: true, api: 'Trades/Search', status: 200, data: [
    { tradeNo: 'EXP_2026110100000001', tradeType: 'Export', tradeStatus: 'Ongoing', tradeName: '<img src=x onerror="window.__xss=1">テスト', blNo: 'ONEYTYOGF8748400', updatedAt: '2026-11-05T10:00:00Z' },
    { tradeNo: 'IMP_2026110100000002', tradeType: 'Import', tradeStatus: 'Completed', tradeName: '輸入テスト', blNo: 'X1', updatedAt: '2026-11-06T10:00:00Z' },
  ] } });
  await p.fill('#cptKw', 'oney tyogf8748400');
  await p.click('#cptSearch');
  await p.waitForSelector('#cptLive .cpt-table');
  eq(sent.at(-1).body, { action: 'get', path: '/API/v2/Trades/Search', query: { keyword: 'ONEYTYOGF8748400' } }, '検索：番号を整えて keyword で送る');
  eq(await p.locator('#cptLive .cpt-table tbody tr').count(), 2, '検索：2 件を表に表示');
  ok((await p.locator('#cptLive').innerText()).includes('EXP_2026110100000001'), '検索：取引番号を表示');
  ok(await p.evaluate(() => window.__xss === undefined), '検索：取引名の HTML は実行されない（エスケープ）');
  ok((await p.locator('#cptLive .cpt-table').innerHTML()).includes('&lt;img'), '検索：取引名は文字として表示');
  ok((await p.locator('#cptLive .cpt-raw').count()) === 1, '検索：返ってきたデータそのものを確認できる');
  const shot = process.argv[2];
  if (shot) await p.screenshot({ path: shot, fullPage: true });

  // ② 番号なし → 直近30日
  await p.fill('#cptKw', '');
  await p.click('#cptSearch');
  await p.waitForSelector('#cptLive .cpt-table');
  eq(sent.at(-1).body.query, { updatedAtRange: 30, updatedAtRangeUnit: 'D' }, '検索：空なら直近30日');

  // 0 件
  respond = () => ({ status: 200, body: { ok: true, api: 'Trades/Search', status: 200, data: [] } });
  await p.click('#cptSearch');
  await p.waitForFunction(() => /0件/.test(document.getElementById('cptLive').innerText));
  ok(true, '0 件の表示');

  // 想定と違う形
  respond = () => ({ status: 200, body: { ok: true, api: 'Trades/Search', status: 200, data: { foo: 1 } } });
  await p.click('#cptSearch');
  await p.waitForFunction(() => /想定と違う形/.test(document.getElementById('cptLive').innerText));
  ok(true, '想定外の形でも壊れず、元のデータを見せる');

  // エラー：接続情報が違う
  respond = () => ({ status: 502, body: { ok: false, error: 'token_failed', message: 'トークンを取得できませんでした（401）。client_id / client_secret を確認してください', upstreamStatus: 401, detail: 'invalid client' } });
  await p.click('#cptPing');
  await p.waitForSelector('#cptLive .cpt-msg.is-error');
  let t = await p.locator('#cptLive').innerText();
  ok(/client_id/.test(t) && /401/.test(t) && /invalid client/.test(t) && /token_failed/.test(t), 'エラー：原因・応答コード・詳細・種類を表示', t);
  const st2 = await p.$$eval('#cptRoot .cpt-st', (els) => els.slice(0, 3).map((e) => e.className));
  ok(st2.every((c) => c.includes('is-off')), 'ping 失敗 → 接続状態は未確認に戻る');

  // エラー：関数が未配置（404・error なし）
  respond = () => ({ status: 404, body: {} });
  await p.click('#cptPing');
  await p.waitForFunction(() => /未設定/.test(document.getElementById('cptLive').innerText));
  ok(/cp-proxy/.test(await p.locator('#cptLive').innerText()), 'エラー：関数が無いときは配置を案内');

  // エラー：サイバーポート側の 404（関数ではなくデータが無い）は取り違えない
  respond = () => ({ status: 502, body: { ok: false, error: 'not_found', message: '該当するデータが見つかりませんでした（NACCS未登録／ETA前の可能性もあります）', upstreamStatus: 404 } });
  await p.click('#cptSearch');
  await p.waitForFunction(() => /ETA前/.test(document.getElementById('cptLive').innerText));
  ok(!/サーバー側が未設定/.test(await p.locator('#cptLive').innerText()), 'サイバーポートの 404 を「関数が無い」と取り違えない');

  // ③ COLINS 本船の動静
  const vesselData = [{ terminalCode: 'JPTYO01', vessel: { vesselName: '<b>TEST</b> MARU', voyageNo: '001E', imoNo: '9999999' },
    cargoHandling: { scheduleAt: '2026-11-12T00:00:00Z', actualAt: null }, cargoIn: { scheduleAt: '2026-11-11T15:30:00Z' }, cargoTransfer: { cyOpenAt: '2026-11-10T00:00:00Z' } }];
  respond = () => ({ status: 200, body: { ok: true, api: 'ColinsViewers/Vessels', status: 200, data: vesselData } });
  await p.fill('#cptPort', ' jp tyo');
  await p.click('#cptColinsV');
  await p.waitForSelector('#cptLive .cpt-table');
  eq(sent.at(-1).body, { action: 'get', path: '/API/v2/ColinsViewers/GetImportVessels/JPTYO', query: {} }, 'COLINS 本船：港コードを整えて、輸入の API を呼ぶ');
  let tb = await p.locator('#cptLive .cpt-table tbody tr').first().innerText();
  ok(/JPTYO01/.test(tb) && /001E/.test(tb) && /9999999/.test(tb), 'COLINS 本船：ターミナル・航海番号・IMO を表示');
  ok(await p.evaluate(() => window.__xss === undefined) && (await p.locator('#cptLive .cpt-table').innerHTML()).includes('&lt;b&gt;TEST'), 'COLINS 本船：本船名の HTML は実行されず文字として表示');
  ok(/2026\/11\/12 00:30/.test(tb), 'COLINS 本船：UTC の日時を日本時間で表示（搬入予定 15:30Z → 翌日 00:30）');
  ok(/2026\/11\/12 09:00/.test(tb), 'COLINS 本船：UTC の日時を日本時間で表示（荷役予定 00:00Z → 09:00）');
  ok(/2026\/11\/10 09:00/.test(tb), 'COLINS 本船：CYオープンも日本時間');
  await p.selectOption('#cptDir', 'export'); await p.fill('#cptPort', 'jpyok'); await p.fill('#cptVessel', 'ONE HARMONY');
  await p.click('#cptColinsV');
  await p.waitForSelector('#cptLive .cpt-table');
  eq(sent.at(-1).body, { action: 'get', path: '/API/v2/ColinsViewers/GetExportVessels/JPYOK', query: { vesselName: 'ONE HARMONY' } }, 'COLINS 本船：輸出・本船名つき');
  const beforeV = sent.length;
  await p.fill('#cptPort', 'XX');
  await p.click('#cptColinsV');
  await p.waitForFunction(() => /港コードは/.test(document.getElementById('cptLive').innerText));
  eq(sent.length, beforeV, 'COLINS 本船：港コードが不正なら通信しない');
  respond = () => ({ status: 200, body: { ok: true, api: 'ColinsViewers/Vessels', status: 200, data: [] } });
  await p.fill('#cptPort', 'JPTYO'); await p.fill('#cptVessel', '');
  await p.click('#cptColinsV');
  await p.waitForFunction(() => /0件/.test(document.getElementById('cptLive').innerText));
  ok(true, 'COLINS 本船：0 件の表示');

  // ④ COLINS コンテナの状況
  const ctnData = [{ terminalCode: 'JPTYO01', container: { containerNo: 'MSKU1234567', lengthName: '40ft', containerTypeName: 'ドライ' }, vessel: { vesselName: 'TEST MARU', voyageNo: '001E' },
    containerStatus: { fullOrEmpty: 'FULL', customClearanceStatus: 'PERMITTED' }, outboundAvailability: true, doAcquisition: false, cyCarryInDate: '2026-11-11T01:00:00Z', gateInDate: null, gateOutDate: null }];
  respond = () => ({ status: 200, body: { ok: true, api: 'ColinsViewers/Containers', status: 200, data: ctnData } });
  await p.selectOption('#cptDir', 'import'); await p.fill('#cptCtn', 'oney tyogf8748400');
  await p.click('#cptColinsC');
  await p.waitForSelector('#cptLive .cpt-table');
  eq(sent.at(-1).body, { action: 'get', path: '/API/v2/ColinsViewers/GetImportContainers', query: { blNoList: ['ONEYTYOGF8748400'] } }, 'COLINS コンテナ：輸入は B/L 番号を blNoList に（整えて）');
  tb = await p.locator('#cptLive .cpt-table tbody tr').first().innerText();
  ok(/MSKU1234567/.test(tb) && /40ft/.test(tb) && /FULL/.test(tb) && /PERMITTED/.test(tb), 'COLINS コンテナ：番号・サイズ・実入り・通関を表示');
  ok(/○/.test(tb) && /×/.test(tb), 'COLINS コンテナ：搬出可否は ○、DO 未入手は ×');
  ok(/2026\/11\/11 10:00/.test(tb), 'COLINS コンテナ：CY搬入を日本時間で表示');
  await p.fill('#cptCtn', 'msku 1234567'); await p.click('#cptColinsC');
  await p.waitForFunction(() => document.querySelector('#cptLive .cpt-table'));
  eq(sent.at(-1).body.query, { containerNo: 'MSKU1234567' }, 'COLINS コンテナ：コンテナ番号の形なら containerNo で探す');
  await p.selectOption('#cptDir', 'export'); await p.fill('#cptCtn', 'abc 123');
  respond = () => ({ status: 200, body: { ok: true, api: 'ColinsViewers/Containers', status: 200, data: [{ terminalCode: 'T', container: { containerNo: 'X' }, shipmentAvailability: true }] } });
  await p.click('#cptColinsC');
  await p.waitForSelector('#cptLive .cpt-table');
  eq([sent.at(-1).body.path, sent.at(-1).body.query], ['/API/v2/ColinsViewers/GetExportContainers', { bookingNoList: ['ABC123'] }], 'COLINS コンテナ：輸出はブッキング番号を bookingNoList に');
  ok(/船積可否/.test(await p.locator('#cptLive .cpt-table thead').innerText()), 'COLINS コンテナ：輸出は列が違う（船積可否）');
  const beforeC = sent.length;
  await p.fill('#cptCtn', '  ');
  await p.click('#cptColinsC');
  await p.waitForFunction(() => /ブッキング番号を入力/.test(document.getElementById('cptLive').innerText));
  eq(sent.length, beforeC, 'COLINS コンテナ：番号が空なら通信しない');
  respond = () => ({ status: 502, body: { ok: false, error: 'upstream_auth', message: 'サイバーポートに認証を拒否されました', upstreamStatus: 403 } });
  await p.fill('#cptCtn', 'ABC1'); await p.click('#cptColinsC');
  await p.waitForSelector('#cptLive .cpt-msg.is-error');
  ok(/403/.test(await p.locator('#cptLive').innerText()), 'COLINS：エラーは応答コードつきで表示');
  await p.selectOption('#cptDir', 'import');

  // ===== COLINS の表の強化（ETA/ETD/バース・期限の色・ターミナル名・日付の形式） =====
  // 日付の形式と期限の判定（純粋な関数）
  const fx = await p.evaluate(() => {
    const T = window.CpTest, now = Date.parse('2026-11-10T00:00:00Z');
    return {
      d1: T.fmtDt('20261109'), d2: T.fmtDt('2026-11-09'), d3: T.fmtDt('2026-11-11T15:30:00Z'), d4: T.fmtDt(null), d5: T.fmtDt('abc'),
      c: ['2026-11-09T00:00:00Z', '2026-11-11T00:00:00Z', '2026-11-13T00:00:00Z', '20261110', '20261109', 'zzz', null].map((v) => T.dueClass(v, now)),
    };
  });
  eq([fx.d1, fx.d2, fx.d3, fx.d4, fx.d5], ['2026/11/09', '2026/11/09', '2026/11/12 00:30', '', 'abc'], '日付：YYYYMMDD・YYYY-MM-DD は日付だけ／UTC は日本時間／読めない値はそのまま');
  eq(fx.c, ['cpt-due-over', 'cpt-due-warn', '', 'cpt-due-warn', 'cpt-due-over', '', ''], '期限の色：過ぎた＝over・48時間以内＝warn・日付だけの期限はその日の終わりまで');

  // 本船：ターミナル名・ETA/ETD/バース（問い合わせた港のもの）・入港予定の早い順
  await p.evaluate(() => window.CpTest.resetTerminalNames());
  const portObj = (code, berth, eta, etd) => ({ portCode: code, berthName: berth, estimatedTimeOfArrival: eta, actualTimeOfArrival: null, estimatedTimeOfDeparture: etd, actualTimeOfDeparture: null });
  const v3 = [
    { terminalCode: 'TYOAJ00C', vessel: { vesselName: 'VESSEL-A', voyageNo: 'A1', imoNo: '1', portOfDischarge: portObj('JPTYO', '青海A1', '2026-11-15T00:00:00Z', '2026-11-16T00:00:00Z') } },
    { terminalCode: 'TYOAK02C', vessel: { vesselName: 'VESSEL-B', voyageNo: 'B1', imoNo: '2',
      portOfLoading: portObj('CNSHA', '上海バース', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'), portOfDischarge: portObj('JPTYO', '大井2号', '2026-11-12T03:00:00Z', '2026-11-13T09:00:00Z') },
      cargoIn: { scheduleAt: '20261109' }, cargoTransfer: { cfsCutAt: '2026-11-11T00:00:00Z' }, remark: '備考テスト' },
    { terminalCode: 'XXXXX99C', vessel: { vesselName: 'VESSEL-C', voyageNo: 'C1', imoNo: '3' } },
  ];
  const router = (map) => (body) => { const k = Object.keys(map).find((x) => (body.path || '').startsWith(x)); return map[k] ? map[k]() : { status: 200, body: { ok: true, status: 200, data: [] } }; };
  const okBody = (api, data) => ({ status: 200, body: { ok: true, api, status: 200, data } });
  respond = router({
    '/API/v2/Terminals/GetList': () => okBody('Terminals/GetList', [{ terminalCode: 'TYOAJ00C', terminalNameAb: '青海A', terminalName: '東京青海A' }, { terminalCode: 'TYOAK02C', terminalName: '大井2号' }]),
    '/API/v2/ColinsViewers/GetImportVessels': () => okBody('ColinsViewers/Vessels', v3),
  });
  const n0 = sent.length;
  await p.selectOption('#cptDir', 'import'); await p.fill('#cptPort', 'JPTYO'); await p.fill('#cptVessel', '');
  await p.click('#cptColinsV');
  await p.waitForSelector('#cptLive .cpt-table');
  eq(sent.slice(n0).map((x) => x.body.path), ['/API/v2/Terminals/GetList', '/API/v2/ColinsViewers/GetImportVessels/JPTYO'], '本船：ターミナル一覧を先に取り、続けて本船を取る');
  eq(sent[n0].body.query, {}, '本船：ターミナル一覧は絞らず全部取る');
  const rowsV = await p.$$eval('#cptLive .cpt-table tbody tr', (trs) => trs.map((tr) => Array.from(tr.children).map((td) => td.innerText)));
  const headV = await p.$$eval('#cptLive .cpt-table thead th', (ths) => ths.map((th) => th.innerText));
  const iv = (h) => headV.indexOf(h);
  eq(rowsV.map((r) => r[iv('本船名')]), ['VESSEL-B', 'VESSEL-A', 'VESSEL-C'], '本船：入港予定の早い順（日時なしは最後）');
  eq(rowsV[0][iv('ターミナル')], '大井2号（TYOAK02C）', '本船：ターミナル名（コード）。略称が無ければ正式名');
  eq(rowsV[1][iv('ターミナル')], '青海A（TYOAJ00C）', '本船：略称があれば略称');
  eq(rowsV[2][iv('ターミナル')], 'XXXXX99C', '本船：名前が無いターミナルはコードだけ');
  eq([rowsV[0][iv('バース')], rowsV[0][iv('入港 予定(ETA)')], rowsV[0][iv('出港 予定(ETD)')]], ['大井2号', '2026/11/12 12:00', '2026/11/13 18:00'], '本船：問い合わせた港（JPTYO）のバース・ETA・ETD を使う（積み地の上海ではなく）');
  eq(rowsV[0][iv('搬入 予定')], '2026/11/09', '本船：搬入予定が日付だけ（20261109）でも読める');
  eq([rowsV[0][iv('CFSカット')], rowsV[0][iv('備考')]], ['2026/11/11 09:00', '備考テスト'], '本船：CFSカットと備考');
  ok(/入港予定の早い順/.test(await p.locator('#cptLive .cpt-live-x').first().innerText()), '本船：並び順の説明');
  if (process.argv[4]) await p.locator('#cptLive').screenshot({ path: process.argv[4] });
  // 2 回目はターミナル一覧を取り直さない
  const n1 = sent.length;
  await p.click('#cptColinsV');
  await p.waitForSelector('#cptLive .cpt-table');
  eq(sent.slice(n1).map((x) => x.body.path), ['/API/v2/ColinsViewers/GetImportVessels/JPTYO'], '本船：2 回目はターミナル一覧を再取得しない（使い回す）');

  // コンテナ：期限の色・フリータイム・場所・検査・DO
  const H = 3600 * 1000, iso = (ms) => new Date(Date.now() + ms).toISOString();
  const c3 = (no, pick, ret) => ({ terminalCode: 'TYOAJ00C', container: { containerNo: no, lengthName: '40ft', containerTypeName: 'HC' }, vessel: { vesselName: 'V', voyageNo: '1' },
    billOfLadingDetail: { blNo: 'BL' + no }, containerStatus: { fullOrEmpty: 'FULL', customClearanceStatus: 'PERMITTED' }, inspectionTarget: true, inspectionStatus: false, doAcquisition: true, outboundAvailability: true,
    loadedContainerPickup: { availableAt: iso(-48 * H), dueAt: pick, demurrageFreeTime: 7, pickupPlace: { placeName: '東京CY' } },
    emptyContainerReturn: { dueAt: ret, detentionFreeTime: 5, deliveryPlace: { placeName: '大井返却' } }, isDangerousGoods: false });
  respond = router({ '/API/v2/ColinsViewers/GetImportContainers': () => okBody('ColinsViewers/Containers', [c3('AAAA0000001', iso(-3 * H), iso(10 * 24 * H)), c3('BBBB0000002', iso(24 * H), iso(-5 * H)), c3('CCCC0000003', iso(10 * 24 * H), iso(10 * 24 * H))]) });
  await p.selectOption('#cptDir', 'import'); await p.fill('#cptCtn', 'BLX');
  await p.click('#cptColinsC');
  await p.waitForSelector('#cptLive .cpt-table');
  eq(await p.locator('#cptLive td.cpt-due-over').count(), 2, 'コンテナ：期限を過ぎたセルは赤（搬出1・返却1）');
  eq(await p.locator('#cptLive td.cpt-due-warn').count(), 1, 'コンテナ：48時間以内のセルは黄');
  const noteC = await p.locator('#cptLive .cpt-live-x').first().innerText();
  ok(/搬出期限：超過 1 件・48時間以内 1 件/.test(noteC) && /返却期限：超過 1 件・48時間以内 0 件/.test(noteC), 'コンテナ：表の上に期限の件数の案内', noteC);
  const headC = await p.$$eval('#cptLive .cpt-table thead th', (ths) => ths.map((th) => th.innerText));
  const rowC = await p.$$eval('#cptLive .cpt-table tbody tr', (trs) => Array.from(trs[0].children).map((td) => td.innerText));
  const ic = (h) => headC.indexOf(h);
  eq([rowC[ic('B/L')], rowC[ic('検査対象')], rowC[ic('検査状況')], rowC[ic('DO入手')], rowC[ic('搬出可否')]], ['BLAAAA0000001', '○', '×', '○', '○'], 'コンテナ：B/L・検査・DO・搬出可否');
  eq([rowC[ic('ﾃﾞﾏﾚｰｼﾞFT(日)')], rowC[ic('ﾃﾞｨﾃﾝｼｮﾝFT(日)')], rowC[ic('搬出 場所')], rowC[ic('返却 場所')], rowC[ic('危険品')]], ['7', '5', '東京CY', '大井返却', '×'], 'コンテナ：フリータイム（日）・搬出と返却の場所・危険品');
  if (process.argv[3]) await p.screenshot({ path: process.argv[3], fullPage: true });
  // 期限がどれも先なら案内を出さない
  respond = router({ '/API/v2/ColinsViewers/GetImportContainers': () => okBody('ColinsViewers/Containers', [c3('DDDD0000004', iso(10 * 24 * H), iso(10 * 24 * H))]) });
  await p.click('#cptColinsC');
  await p.waitForFunction(() => document.querySelectorAll('#cptLive .cpt-table tbody tr').length === 1);
  ok(!/⚠/.test(await p.locator('#cptLive .cpt-live-x').first().innerText()), 'コンテナ：期限が先なら案内を出さない');

  // ターミナル一覧が取れなくても、表はコードのまま出る
  await p.evaluate(() => window.CpTest.resetTerminalNames());
  respond = router({
    '/API/v2/Terminals/GetList': () => ({ status: 502, body: { ok: false, error: 'upstream_auth', message: '拒否', upstreamStatus: 403 } }),
    '/API/v2/ColinsViewers/GetImportVessels': () => okBody('ColinsViewers/Vessels', v3),
  });
  await p.click('#cptColinsV');
  await p.waitForSelector('#cptLive .cpt-table');
  eq((await p.$$eval('#cptLive .cpt-table tbody tr', (trs) => trs.map((tr) => tr.children[0].innerText))).slice(0, 2), ['TYOAK02C', 'TYOAJ00C'], 'ターミナル一覧が取れなくても、表はコードで表示される');
  await p.evaluate(() => window.CpTest.resetTerminalNames());

  // ===== ⑤ 通知できる操作の一覧 =====
  const opsData = [
    { notifiableOperationCode: 'OP-001', operationType: { operationTypeName: '帳票を提出した' }, reportType: { reportName: 'B/L' }, process: { processName: '船積' } },
    { notifiableOperationCode: 'OP-002', operationType: { operationTypeName: 'EDIFACTを受信した' }, reportType: { reportName: 'ブッキング確認' }, process: { processName: '<img src=x onerror="window.__xss=2">' } },
    { notifiableOperationCode: 'OP-003', operationType: { operationTypeName: 'メッセージを送信した' }, reportType: null, process: null },
  ];
  respond = router({ '/API/v2/Master/NotifiableOperations/GetList': () => okBody('Master/NotifiableOperations/GetList', opsData) });
  const nOps = sent.length;
  await p.click('#cptOps');
  await p.waitForSelector('#cptLive .cpt-table');
  eq(sent.slice(nOps).map((x) => x.body), [{ action: 'get', path: '/API/v2/Master/NotifiableOperations/GetList', query: {} }], '⑤ 通知できる操作：読み取りの API を 1 回呼ぶ');
  eq(await p.locator('#cptLive .cpt-table tbody tr').count(), 3, '⑤ 3 件を表示');
  ok(/EDIFACT に関する操作：1 件/.test(await p.locator('#cptLive .cpt-live-x').first().innerText()), '⑤ EDIFACT に関する操作の件数を案内');
  ok(await p.evaluate(() => window.__xss !== 2), '⑤ 表の中の HTML は実行されない');
  await p.fill('#cptOpFilter', 'メッセージ');
  await p.waitForFunction(() => document.querySelectorAll('#cptLive .cpt-table tbody tr').length === 1);
  ok(/OP-003/.test(await p.locator('#cptLive .cpt-table tbody').innerText()), '⑤ 絞り込み：入力するとその場で絞られる');
  const nOps2 = sent.length;
  await p.fill('#cptOpFilter', 'edifact');
  await p.waitForFunction(() => /OP-002/.test(document.querySelector('#cptLive .cpt-table tbody')?.innerText || ''));
  eq(sent.length, nOps2, '⑤ 絞り込みでは再取得しない（取得済みを使う）');
  await p.fill('#cptOpFilter', 'zzzz');
  await p.waitForFunction(() => /一致する操作がありません/.test(document.getElementById('cptLive').innerText));
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

  // エラー：ログインしていない
  await p.evaluate(() => { window.__noSession = true; });
  const before = sent.length;
  await p.click('#cptPing');
  await p.waitForFunction(() => /ログインが必要/.test(document.getElementById('cptLive').innerText));
  eq(sent.length, before, '未ログインでは cp-proxy を呼ばない');
  await p.evaluate(() => { window.__noSession = false; });

  // 通信できない
  await p.unroute('**/functions/v1/cp-proxy');
  await p.route('**/functions/v1/cp-proxy', (r) => r.abort());
  await p.click('#cptPing');
  await p.waitForFunction(() => /通信できませんでした/.test(document.getElementById('cptLive').innerText));
  ok(/CP_ALLOWED_ORIGINS/.test(await p.locator('#cptLive').innerText()), 'エラー：通信できない → アクセス元の許可を案内');

  // ボタンは処理中だけ無効、終わったら戻る
  ok(await p.locator('#cptPing').isEnabled() && await p.locator('#cptSearch').isEnabled(), '処理後はボタンが戻る');

  // サンプル欄は従来どおり動く
  await p.selectOption('#cptState', 'eta'); await p.click('#cptRun');
  ok(/ETA前|NACCS側/.test(await p.locator('#cptMv').innerText()), 'サンプル欄は従来どおり動く');

  ok(errs.length === 0, 'ページのエラーなし', errs.join(' | '));
  console.log(`\nCP(TEST) 実接続画面 試験：${pass} 件合格 / ${failN} 件失敗`);
  await b.close();
  process.exit(failN ? 1 : 0);
})();
