// 「サイバーポート」画面（案C：左で選ぶ、右で流れを見る）の試験（Chromium）。cp-proxy は偽の応答に差し替える（サイバーポートへは接続しない）。
// 使い方： node scripts/cp-tests/cp-test-page-test.js [スクリーンショットの保存先.png]   （サーバーはこの試験が自分で立てる）
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

  // ===== 初期表示 =====
  ok(/接続は未確認/.test(await txt('#cptConn')) && !(await p.locator('#cptConn').evaluate((e) => e.classList.contains('is-ok'))), '初期：接続は未確認（灰色の札・赤くしない）');
  eq(await p.locator('#tab-cptest .cpt-tab').allInnerTexts(), ['取引', '本船の動静', 'コンテナの状況'], 'タブは 取引／本船の動静／コンテナの状況');
  ok(await p.locator('#cptDev').isHidden(), '開発者向け情報は閉じている');
  ok(/読み取りのみ/.test(await txt('.cpt-head')), '「読み取りのみ」の札');
  ok(await p.locator('.cpt-banner, #cptRun, #cptMv, #cptCh').count() === 0, 'テスト用の注意書き・サンプル欄が無い');
  await p.click('#cptDevBtn');
  const st0 = await p.$$eval('#cptDev .cpt-st', (els) => els.map((e) => e.className + '|' + e.querySelector('.cpt-st-v').textContent));
  ok(st0[0].includes('is-off') && /未確認/.test(st0[0]) && st0[3].includes('is-ok') && /読み取り専用/.test(st0[3]), '開発者向け情報：4 行の状態（API は未確認・書き込みは使わない）');
  ok(await p.locator('#cptStApi, #cptStFn, #cptStAuth').count() === 3, 'id（cptStApi／cptStFn／cptStAuth）は開発者向け情報の中に残る');
  await p.click('#cptDevBtn');

  // ===== 接続を確認 =====
  respond = () => ({ status: 200, body: { ok: true, message: 'トークンを取得できました（接続情報は有効です）', tokenHost: 'api.cyber-port.net', apiHost: 'api.cyber-port.net' } });
  await p.click('#cptPing');
  await p.waitForSelector('#cptConn.is-ok');
  eq(sent.at(-1).body, { action: 'ping' }, 'ping：送る内容');
  eq(sent.at(-1).auth, 'Bearer jwt-abc', 'ping：ログインのトークンを付けて呼ぶ');
  ok(/接続できています/.test(await txt('#cptConn')), 'ping 成功：緑の「● 接続できています」');
  ok(/api\.cyber-port\.net/.test(await txt('#cptLive')), 'ping：接続先のホスト名');
  respond = () => ({ status: 502, body: { ok: false, error: 'token_failed', message: 'トークンを取得できませんでした（401）', upstreamStatus: 401, detail: 'invalid client' } });
  await p.click('#cptPing');
  await p.waitForSelector('#cptLive .cpt-msg.is-error');
  let t = await txt('#cptLive');
  ok(/トークンを取得できませんでした/.test(t) && /応答コード 401/.test(t) && /token_failed/.test(t) && /invalid client/.test(t), 'エラー：原因と、サポート向けの詳細（応答コード・種類）', t);
  ok(!/接続できています/.test(await txt('#cptConn')), 'ping 失敗：接続の札は未確認に戻る');
  respond = () => ({ status: 404, body: {} });
  await p.click('#cptPing');
  await p.waitForFunction(() => /未設定/.test(document.getElementById('cptLive').innerText));
  ok(/cp-proxy/.test(await txt('#cptLive')), 'エラー：関数が無いときは配置を案内');

  // ===== 取引 =====
  await p.click('.cpt-tab[data-tab="trade"]');
  respond = () => okBody('Trades/Search', [
    { tradeNo: 'EXP_1', tradeType: 'Export', tradeStatus: 'Ongoing', tradeName: '<img src=x onerror="window.__xss=1">テスト', blNo: 'ONEYTYOGF8748400', updatedAt: '2026-11-05T10:00:00Z' },
    { tradeNo: 'IMP_2', tradeType: 'Import', tradeStatus: 'Completed', tradeName: '輸入テスト', updatedAt: '2026-11-06T10:00:00Z' }]);
  await p.fill('#cptKw', 'oney tyogf8748400');
  await p.click('#cptSearch');
  await p.waitForSelector('#cptList .cpt-row');
  eq(sent.at(-1).body, { action: 'get', path: '/API/v2/Trades/Search', query: { keyword: 'ONEYTYOGF8748400' } }, '取引：番号を整えて keyword で送る');
  eq(await p.locator('#cptList .cpt-row').count(), 2, '取引：2 件を一覧に表示');
  ok(await p.evaluate(() => window.__xss === undefined) && (await p.locator('#cptList').innerHTML()).includes('&lt;img'), '取引：取引名の HTML は実行されず文字として表示');
  ok(/今後ここに入る予定/.test(await txt('#cptDetail')), '取引：右に「今後ここに入る予定」の枠');
  await p.click('#cptList .cpt-row >> nth=1');
  await p.click('[data-act="all"]');
  ok(/B\/L\s*サイバーポートに情報なし/.test((await txt('#cptDetail')).replace(/\n/g, '')), '取引：B/L が無いものは「サイバーポートに情報なし」');
  await p.fill('#cptKw', ''); await p.click('#cptSearch'); await p.waitForSelector('#cptList .cpt-row');
  eq(sent.at(-1).body.query, { updatedAtRange: 30, updatedAtRangeUnit: 'D' }, '取引：空なら直近30日');
  respond = () => okBody('Trades/Search', []);
  await p.fill('#cptKw', 'NOTHING1'); await p.click('#cptSearch');
  await p.waitForSelector('#cptLive .cpt-msg.is-empty');
  ok(/0件/.test(await txt('#cptLive')) && /NOTHING1/.test(await txt('#cptLive')), '取引：0 件のメッセージ（番号つき）');
  ok(await p.locator('#cptMain').isHidden(), '0 件のときは本体の代わりにメッセージを出す');
  respond = () => okBody('Trades/Search', { foo: 1 });
  await p.click('#cptSearch');
  await p.waitForFunction(() => /想定と違う形/.test(document.getElementById('cptLive').innerText));
  await p.click('#cptDevBtn');
  ok(/foo/.test(await p.locator('#cptDev').textContent()), '想定外の形：元のデータは開発者向け情報で見られる');
  await p.click('#cptDevBtn');

  // ===== 本船の動静 =====
  const portObj = (code, berth, eta, etd, ata) => ({ portCode: code, berthName: berth, estimatedTimeOfArrival: eta, actualTimeOfArrival: ata || null, estimatedTimeOfDeparture: etd, actualTimeOfDeparture: null });
  const vessels = [
    { terminalCode: 'TYOAJ00C', vessel: { vesselName: 'VESSEL-A', voyageNo: 'A1', imoNo: '1', portOfDischarge: portObj('JPTYO', '青海A1', iso(100 * H), iso(120 * H)) } },
    { terminalCode: 'TYOAK02C', vessel: { vesselName: 'VESSEL-B', voyageNo: 'B1', imoNo: '2', portOfLoading: portObj('CNSHA', '上海', iso(-500 * H), iso(-480 * H)), portOfDischarge: portObj('JPTYO', '大井2号', iso(10 * H), iso(30 * H)) },
      cargoTransfer: { cyOpenAt: iso(-20 * H), cfsCutAt: iso(-2 * H), cyCutAt: iso(20 * H) }, cargoIn: { scheduleAt: '20261109' }, remark: '備考テスト' },
    { terminalCode: 'XXXXX99C', vessel: { vesselName: 'VESSEL-C', voyageNo: 'C1' } },
    { terminalCode: 'TYOAJ00C', vessel: { vesselName: 'VESSEL-FAR', voyageNo: 'F1', portOfDischarge: portObj('JPTYO', 'F', iso(30 * 24 * H), iso(31 * 24 * H)) } },
    { terminalCode: 'TYOAJ00C', vessel: { vesselName: 'VESSEL-OLD', voyageNo: 'O1', portOfDischarge: portObj('JPTYO', 'O', iso(-30 * 24 * H), iso(-29 * 24 * H)) } }];
  const setPortOther = async (code) => { await p.selectOption('#cptPortSel', '__other'); await p.fill('#cptPort', code); };
  const portOpts = () => p.$$eval('#cptPortSel option', (o) => o.map((x) => x.value + '|' + x.textContent));
  const terminalsCalls = () => sent.filter((x) => x.body.path === '/API/v2/Terminals/GetList').length;
  const termList = [
    { terminalCode: 'TYOAJ00C', terminalNameAb: '青海A', portLocation: { portCode: 'JPTYO', portName: '東京', displayOrder: 1 } },
    { terminalCode: 'TYOAK02C', terminalName: '大井2号', portLocation: { portCode: 'JPTYO', portName: '東京', displayOrder: 1 } },
    { terminalCode: 'YOKAA01C', terminalName: '本牧', portLocation: { portCode: 'JPYOK', portName: '横浜', displayOrder: 2 } },
    { terminalCode: 'SDJAA01C', terminalName: '仙台港', portLocation: { portCode: 'JPSDJ', portName: '仙台塩釜', displayOrder: 12 } }];
  respond = router({
    '/API/v2/Terminals/GetList': () => okBody('Terminals/GetList', termList),
    '/API/v2/ColinsViewers/GetImportVessels': () => okBody('ColinsViewers/Vessels', vessels) });

  // ===== 港は選択式（自由入力から） =====
  await p.evaluate(() => window.CpTest.resetTerminalNames());
  const t0 = terminalsCalls();
  await p.click('.cpt-tab[data-tab="vessel"]');
  await p.waitForFunction(() => document.querySelectorAll('#cptPortSel option').length === 4);
  eq(terminalsCalls() - t0, 1, '港：本船タブを開くと、港の一覧（ターミナル一覧）をこっそり 1 回だけ取る');
  eq(await portOpts(), ['JPTYO|東京（JPTYO）', 'JPYOK|横浜（JPYOK）', 'JPSDJ|仙台塩釜（JPSDJ）', '__other|その他（港コードを入力）'], '港：サイバーポートの港の一覧（表示順・港ごとに 1 つ）＋「その他」');
  eq(await p.$eval('#cptPortSel', (e) => e.value), 'JPTYO', '港：初期値は東京（JPTYO）');
  ok(await p.locator('#cptPortSel').isVisible() && !(await p.locator('#cptPort').isVisible()), '港：通常は選択だけ（コードの入力欄は隠れている）');
  await p.click('.cpt-tab[data-tab="trade"]'); await p.click('.cpt-tab[data-tab="vessel"]');
  eq(terminalsCalls() - t0, 1, '港：タブを切り替えても、一覧は取り直さない');
  await p.selectOption('#cptPortSel', '__other');
  ok(await p.locator('#cptPort').isVisible(), '港：「その他」を選ぶと、コードの入力欄が出る');
  await p.selectOption('#cptPortSel', 'JPYOK');
  eq(await p.$eval('#cptPort', (e) => e.value), 'JPYOK', '港：選ぶと、照会に使うコードに入る');
  ok(!(await p.locator('#cptPort').isVisible()), '港：選ぶと、入力欄はまた隠れる');
  await p.selectOption('#cptPortSel', 'JPTYO');
  // 港の一覧の組み立て（重複・不正・並び順）
  eq(await p.evaluate(() => window.CpTest.portsFromTerminals([
    { portLocation: { portCode: 'jpyok', portName: '横浜', displayOrder: 2 } }, { portLocation: { portCode: 'JPTYO', portName: '東京', displayOrder: 1 } },
    { portLocation: { portCode: 'JPYOK', portName: '横浜（重複）', displayOrder: 2 } }, { portLocation: { portCode: 'XX', portName: '短すぎる' } },
    { portLocation: { portCode: 'JPNGO', portName: '名古屋' } }, { terminalCode: 'NOPORT' }, null]).map((x) => x.code + ':' + x.name)),
    ['JPTYO:東京', 'JPYOK:横浜', 'JPNGO:名古屋'], '港：一覧の組み立て（コードを整える・重複と不正は除く・表示順・表示順なしは最後）');
  eq(await p.evaluate(() => window.CpTest.portsFromTerminals(null)), [], '港：一覧が無いときは空（固定リストを使う）');

  const n0 = sent.length;
  await setPortOther(' jp tyo');
  await p.click('#cptColinsV');
  await p.waitForSelector('#cptList .cpt-row');
  eq(sent.slice(n0).map((x) => x.body.path), ['/API/v2/ColinsViewers/GetImportVessels/JPTYO'], '本船：港の一覧は先に取ってあるので、本船だけを取る（入力したコードは整えて送る）');
  eq(await p.$$eval('#cptList .cpt-row b', (e) => e.map((x) => x.textContent)), ['VESSEL-B / B1', 'VESSEL-A / A1', 'VESSEL-C / C1'], '本船：入港予定の早い順（日時なしは最後）');
  ok(/前後 2 週間/.test(await txt('#cptNote')) && /範囲外の 2 件は除きました/.test(await txt('#cptNote')), '本船：照会の日の前後2週間だけを表示（範囲外の件数をお知らせ）', await txt('#cptNote'));
  ok(!/VESSEL-FAR|VESSEL-OLD/.test(await txt('#cptList')), '本船：前後2週間の外（30日先・30日前）は一覧に出さない');
  eq((await p.$$eval('#cptList .cpt-chip', (e) => e.map((x) => x.textContent)))[0], 'カット超過', '本船：CFSカットを過ぎていれば「カット超過」');
  const steps = await p.$$eval('#cptDetail .cpt-step', (els) => els.map((e) => e.querySelector('b').textContent + '|' + e.querySelector('.cpt-chip').textContent));
  eq(steps.map((s) => s.split('|')[0]), ['入港', '荷役', '搬入', 'CYオープン', 'CFSカット', 'CYカット', '出港'], '本船：流れは 入港→荷役→搬入→CYオープン→CFSカット→CYカット→出港');
  ok(steps[3].endsWith('済'), '本船：CYオープンを過ぎていれば「済」');
  ok(steps[4].endsWith('超過') && steps[5].endsWith('48時間以内'), '本船：CFSカットは超過・CYカットは48時間以内');
  ok(steps[1].endsWith('情報なし'), '本船：荷役の情報が無ければ「情報なし」');
  ok(/COLINSに情報がありません/.test(await txt('#cptDetail')), '本船：情報が無い項目は「COLINSに情報がありません」と表示');
  await p.click('#cptList .cpt-row >> nth=2'); // VESSEL-C：ほぼ情報なし
  ok((await p.locator('#cptDetail .cpt-step-v.is-nodata').count()) >= 6, '本船：情報が無い本船は、流れの大半が「情報がありません」');
  await p.click('[data-act="all"]');
  ok(/COLINSに情報なし/.test(await txt('#cptDetail')), '本船：「すべての項目」でも情報が無い項目に「COLINSに情報なし」');
  await p.click('#cptList .cpt-row >> nth=0'); await p.click('[data-act="all"]');
  ok(/青海|大井2号/.test(await txt('#cptDetail')) && /備考テスト/.test(await txt('#cptDetail')), '本船：すべての項目に ターミナル名・備考 が入っている');
  // 並び替え（本船）
  const titles = () => p.$$eval('#cptList .cpt-row b', (e) => e.map((x) => x.textContent));
  eq(await p.$$eval('#cptSort option', (o) => o.map((x) => x.textContent)), ['入港予定の早い順', '入港予定の遅い順', 'CYカットが近い順', 'CFSカットが近い順', '出港予定の早い順', '本船名順', '要注意が先'], '並び替え（本船）：選択肢');
  await p.selectOption('#cptSort', 'eta-desc');
  eq(await titles(), ['VESSEL-A / A1', 'VESSEL-B / B1', 'VESSEL-C / C1'], '並び替え（本船）：入港予定の遅い順（日時なしは最後）');
  await p.selectOption('#cptSort', 'name-asc');
  eq(await titles(), ['VESSEL-A / A1', 'VESSEL-B / B1', 'VESSEL-C / C1'], '並び替え（本船）：本船名順');
  await p.selectOption('#cptSort', 'cyc-asc');
  eq((await titles())[0], 'VESSEL-B / B1', '並び替え（本船）：CYカットが近い順（カットの無いものは最後）');
  await p.selectOption('#cptSort', 'rank-asc');
  eq((await titles())[0], 'VESSEL-B / B1', '並び替え（本船）：要注意が先');
  await p.click('#cptList .cpt-row >> nth=0');
  ok(/VESSEL-B/.test(await txt('#cptDetail')), '並び替え後も、押した行の詳細が出る');
  await p.selectOption('#cptSort', 'default');
  eq(await titles(), ['VESSEL-B / B1', 'VESSEL-A / A1', 'VESSEL-C / C1'], '並び替え：「入港予定の早い順」に戻る');
  // 全部が範囲外のとき
  respond = router({ '/API/v2/Terminals/GetList': () => okBody('Terminals/GetList', []), '/API/v2/ColinsViewers/GetImportVessels': () => okBody('ColinsViewers/Vessels', [vessels[3], vessels[4]]) });
  await p.click('#cptColinsV'); await p.waitForSelector('#cptLive .cpt-msg.is-empty');
  ok(/2 件ありますが/.test(await txt('#cptLive')) && /2 週間の範囲に入るものはありません/.test(await txt('#cptLive')), '本船：全部が範囲外なら、その旨を表示');
  respond = router({ '/API/v2/Terminals/GetList': () => okBody('Terminals/GetList', []), '/API/v2/ColinsViewers/GetImportVessels': () => okBody('ColinsViewers/Vessels', vessels) });
  await p.click('#cptColinsV'); await p.waitForSelector('#cptList .cpt-row');
  const wf = await p.evaluate(() => { const T = window.CpTest, n = Date.parse('2026-11-10T00:00:00Z'), o = (eta) => ({ vessel: { portOfDischarge: { portCode: 'JPTYO', estimatedTimeOfArrival: eta } } }); return [T.inVesselWindow(o('2026-11-24T00:00:00Z'), 'JPTYO', 'import', n), T.inVesselWindow(o('2026-11-25T00:00:00Z'), 'JPTYO', 'import', n), T.inVesselWindow(o('2026-10-27T00:00:00Z'), 'JPTYO', 'import', n), T.inVesselWindow(o('2026-10-26T00:00:00Z'), 'JPTYO', 'import', n), T.inVesselWindow({}, 'JPTYO', 'import', n)]; });
  eq(wf, [true, false, true, false, true], '範囲の境目：ちょうど14日先・前は入る／それより外は除く／日時が無いものは残す');
  // 輸出に切り替えると別の結果（取り直し）。戻すと前の結果が残っている
  await p.click('.cpt-seg [data-dir="export"]');
  ok(await p.locator('#cptList .cpt-empty').count() === 1, '本船：輸出はまだ検索していないので案内');
  await p.click('.cpt-seg [data-dir="import"]');
  eq(await p.locator('#cptList .cpt-row').count(), 3, '本船：輸入に戻すと、前の結果が残っている');
  eq(await p.evaluate(() => document.getElementById('cptDir').value), 'import', '#cptDir（輸入／輸出）の値は切替ボタンと連動する');
  const nv = sent.length;
  await setPortOther('XX'); await p.click('#cptColinsV');
  await p.waitForSelector('#cptLive .cpt-msg.is-invalid');
  ok(/港コードは/.test(await txt('#cptLive')), '本船：港コードが不正なら入力の誤りを表示'); eq(sent.length, nv, '本船：不正なら通信しない');
  await p.selectOption('#cptPortSel', 'JPYOK'); await p.fill('#cptVessel', 'ONE HARMONY'); await p.click('.cpt-seg [data-dir="export"]');
  respond = () => okBody('ColinsViewers/Vessels', []);
  await p.click('#cptColinsV');
  await p.waitForSelector('#cptLive .cpt-msg.is-empty');
  eq(sent.at(-1).body, { action: 'get', path: '/API/v2/ColinsViewers/GetExportVessels/JPYOK', query: { vesselName: 'ONE HARMONY' } }, '本船：輸出・本船名つき');
  ok(/COLINS に情報がありません/.test(await txt('#cptLive')), '本船：0 件は「COLINS に情報がありません」');
  await p.selectOption('#cptPortSel', 'JPTYO'); await p.fill('#cptVessel', '');

  // 港の一覧が取れないとき：よく使う港の固定リストを出す（「その他」でコードも入力できる）
  {
    respond = router({ '/API/v2/Terminals/GetList': () => ({ status: 502, body: { ok: false, error: 'upstream_network', message: 'つながりません' } }) });
    await p.evaluate(() => window.CpTest.resetTerminalNames());
    await p.click('.cpt-tab[data-tab="trade"]'); await p.click('.cpt-tab[data-tab="vessel"]');
    await p.waitForFunction(() => document.querySelectorAll('#cptPortSel option').length === 12);
    const o = await portOpts();
    eq([o.length, o.slice(0, 3), o.at(-1)], [12, ['JPTYO|東京（JPTYO）', 'JPYOK|横浜（JPYOK）', 'JPKWS|川崎（JPKWS）'], '__other|その他（港コードを入力）'], '港：一覧が取れないときは、よく使う港 11 件の固定リスト＋「その他」');
    ok(await p.locator('#cptPortSel').isVisible(), '港：一覧が取れなくても、選択は使える');
    // 「その他」で入力中に一覧が届いても、入力したコードと選択は変わらない
    await p.selectOption('#cptPortSel', '__other'); await p.fill('#cptPort', 'USLAX');
    respond = router({ '/API/v2/Terminals/GetList': () => okBody('Terminals/GetList', termList) });   // 一覧が取れる状態に戻す
    await p.evaluate(() => window.CpTest.resetTerminalNames());
    await p.selectOption('#cptPortSel', '__other'); await p.fill('#cptPort', 'USLAX');
    await p.click('.cpt-tab[data-tab="trade"]'); await p.click('.cpt-tab[data-tab="vessel"]');
    await p.waitForFunction(() => document.querySelectorAll('#cptPortSel option').length === 4);
    eq([await p.$eval('#cptPortSel', (e) => e.value), await p.$eval('#cptPort', (e) => e.value), await p.locator('#cptPort').isVisible()], ['__other', 'USLAX', true], '港：「その他」で入力したコードは、一覧が届いても消えない');
    await p.selectOption('#cptPortSel', 'JPTYO');
  }

  // ===== コンテナ（輸入） =====
  await p.click('.cpt-tab[data-tab="ctn"]'); await p.click('.cpt-seg [data-dir="import"]');
  const c3 = (no, pick, ret, over) => Object.assign({ terminalCode: 'TYOAJ00C', container: { containerNo: no, lengthName: '40ft', containerTypeName: 'HC' }, vessel: { vesselName: 'V', voyageNo: '1' },
    billOfLadingDetail: { blNo: 'BL' + no }, containerStatus: { fullOrEmpty: '実入り', customClearanceStatus: '許可済' }, inspectionTarget: true, inspectionStatus: false, doAcquisition: true, outboundAvailability: true,
    cyCarryInDate: iso(-100 * H), loadedContainerPickup: { availableAt: iso(-48 * H), dueAt: pick, demurrageFreeTime: 7, pickupPlace: { placeName: '東京CY' } },
    emptyContainerReturn: { dueAt: ret, detentionFreeTime: 5, deliveryPlace: { placeName: '大井返却' } }, isDangerousGoods: false }, over || {});
  respond = router({ '/API/v2/ColinsViewers/GetImportContainers': () => okBody('ColinsViewers/Containers', [
    c3('AAAA0000001', iso(-3 * H), iso(240 * H)), c3('BBBB0000002', iso(24 * H), iso(240 * H)), c3('CCCC0000003', iso(240 * H), iso(240 * H)), { terminalCode: 'T', container: { containerNo: 'DDDD0000004' } }]) });
  await p.fill('#cptCtn', 'oney tyogf8748400');
  await p.click('#cptColinsC');
  await p.waitForSelector('#cptList .cpt-row');
  eq(sent.at(-1).body, { action: 'get', path: '/API/v2/ColinsViewers/GetImportContainers', query: { blNoList: ['ONEYTYOGF8748400'] } }, 'コンテナ（輸入）：B/L 番号を blNoList に（整えて）');
  eq(await p.$$eval('#cptList .cpt-chip', (e) => e.map((x) => x.textContent)), ['超過', '48時間以内', '順調', '情報なし'], 'コンテナ：一覧の札＝超過／48時間以内／順調／情報なし');
  ok(/要注意 2/.test(await txt('#cptBadge')), 'コンテナ：タブに「要注意 n」の札');
  ok(/超過 1/.test(await txt('#cptFilter')) && /48時間以内 1/.test(await txt('#cptFilter')) && /緑＝順調/.test(await txt('#cptFilter')), 'コンテナ：件数ボタンと色の凡例');
  await p.click('#cptFilter [data-f="over"]');
  eq(await p.locator('#cptList .cpt-row').count(), 1, 'コンテナ：「超過」で絞り込める');
  await p.click('#cptFilter [data-f="over"]');
  eq(await p.locator('#cptList .cpt-row').count(), 4, 'コンテナ：もう一度押すと解除');
  const st1 = await p.$$eval('#cptDetail .cpt-step', (els) => els.map((e) => e.querySelector('b').textContent + '|' + e.querySelector('.cpt-chip').textContent));
  eq(st1.map((s) => s.split('|')[0]), ['CY搬入', '通関', 'DO入手', '搬出可否', '搬出期限', '返却期限'], 'コンテナ（輸入）：流れは CY搬入→通関→DO入手→搬出可否→搬出期限→返却期限');
  ok(st1[4].endsWith('超過') && /超過 \d+時間/.test(await txt('#cptDetail')), 'コンテナ：搬出期限を過ぎていれば「超過」と経過時間');
  await p.selectOption('#cptSort', 'pick-asc');
  eq((await p.$$eval('#cptList .cpt-row b', (e) => e.map((x) => x.textContent))), ['AAAA0000001', 'BBBB0000002', 'CCCC0000003', 'DDDD0000004'], '並び替え（コンテナ）：搬出期限が近い順（期限の無いものは最後）');
  await p.selectOption('#cptSort', 'no-asc');
  await p.selectOption('#cptSort', 'rank-asc');
  eq((await p.$$eval('#cptList .cpt-row b', (e) => e.map((x) => x.textContent)))[0], 'AAAA0000001', '並び替え（コンテナ）：要注意（超過）が先');
  await p.selectOption('#cptSort', 'default');
  await p.click('#cptList .cpt-row >> nth=3'); // 情報の無いコンテナ
  ok((await p.locator('#cptDetail .cpt-step-v.is-nodata').count()) === 6, 'コンテナ：情報が無いコンテナは、6 段すべてが「COLINSに情報がありません」');
  await p.click('[data-act="all"]');
  ok((await p.locator('#cptDetail .cpt-dl dd.is-nodata').count()) >= 15, 'コンテナ：「すべての項目」も情報が無い項目は「COLINSに情報なし」');
  await p.click('#cptList .cpt-row >> nth=1'); await p.click('[data-act="all"]');
  const dl = (await txt('#cptDetail')).replace(/\n/g, ' ');
  ok(/デマレージFT\(日\)\s*7/.test(dl) && /東京CY/.test(dl) && /大井返却/.test(dl), 'コンテナ：すべての項目に FT・搬出場所・返却場所（どの項目も削らない）');
  ok(await p.locator('#cptDetail dd.cpt-due-warn').count() >= 1, 'コンテナ：すべての項目でも 48時間以内の期限は黄');
  // 輸出
  respond = router({ '/API/v2/ColinsViewers/GetExportContainers': () => okBody('ColinsViewers/Containers', [
    { terminalCode: 'T', container: { containerNo: 'TGHU1112223', lengthName: '40ft' }, containerStatus: { fullOrEmpty: '空', customClearanceStatus: '未' }, shipmentAvailability: false,
      emptyContainerPickup: { scheduledAt: iso(-20 * H), actualAt: null, pickupPlace: { placeName: '青海 空コン' } }, loadedContainerDelivery: { scheduledAt: iso(30 * H) }, remark: '照合待ち' },
    { terminalCode: 'T', container: { containerNo: 'MRKU3334445' }, shipmentAvailability: true, containerStatus: { customClearanceStatus: '許可済' },
      emptyContainerPickup: { scheduledAt: iso(-48 * H), actualAt: iso(-47 * H) }, loadedContainerDelivery: { scheduledAt: iso(-10 * H), actualAt: iso(-9 * H) }, gateInDate: iso(-9 * H), loadingUnloadingDate: iso(30 * H), shipmentDate: iso(50 * H) }]) });
  await p.click('.cpt-seg [data-dir="export"]'); await p.fill('#cptCtn', 'abc 123');
  await p.click('#cptColinsC'); await p.waitForSelector('#cptList .cpt-row');
  eq([sent.at(-1).body.path, sent.at(-1).body.query], ['/API/v2/ColinsViewers/GetExportContainers', { bookingNoList: ['ABC123'] }], 'コンテナ（輸出）：ブッキング番号を bookingNoList に');
  eq(await p.$$eval('#cptList .cpt-chip', (e) => e.map((x) => x.textContent)), ['要確認', '順調'], 'コンテナ（輸出）：止まっている＝要確認');
  ok(/黄＝止まっている/.test(await txt('#cptFilter')) && await p.locator('#cptFilter [data-f="over"]').count() === 0, 'コンテナ（輸出）：赤の絞り込みは無く黄だけ（凡例も輸出用）');
  const st2 = await p.$$eval('#cptDetail .cpt-step', (els) => els.map((e) => e.querySelector('b').textContent + '|' + e.querySelector('.cpt-chip').textContent));
  eq(st2.map((s) => s.split('|')[0]), ['空コンの搬出', '実入りの搬入', 'ゲートイン', '通関', '船積可否', '荷役', '船積'], 'コンテナ（輸出）：流れは 空コン搬出→実入り搬入→ゲートイン→通関→船積可否→荷役→船積');
  ok(st2[0].endsWith('予定超過') && st2[4].endsWith('止まっています'), 'コンテナ（輸出）：予定超過・止まっています（黄）');
  ok(/船積できません：照合待ち/.test(await txt('#cptDetail')), 'コンテナ（輸出）：止まっている理由（備考）を表示');
  eq(await p.$$eval('#cptDetail .cpt-step .cpt-chip', (e) => e.map((x) => x.className.includes('is-warn'))).then((a) => a.filter(Boolean).length), 2, 'コンテナ（輸出）：黄の札は 2 つ（予定超過・止まっている）');
  await p.fill('#cptCtn', ' '); const nc = sent.length; await p.click('#cptColinsC');
  await p.waitForSelector('#cptLive .cpt-msg.is-invalid');
  ok(/ブッキング番号を入力/.test(await txt('#cptLive')) && sent.length === nc, 'コンテナ：番号が空なら入力の誤り（通信しない）');
  respond = () => ({ status: 502, body: { ok: false, error: 'upstream_auth', message: 'サイバーポートに認証を拒否されました', upstreamStatus: 403 } });
  await p.fill('#cptCtn', 'ABC1'); await p.click('#cptColinsC');
  await p.waitForSelector('#cptLive .cpt-msg.is-error');
  ok(/403/.test(await txt('#cptLive')), 'コンテナ：エラーは応答コードつき（サポート向けの 1 行）');
  await p.click('.cpt-seg [data-dir="import"]');
  eq(await p.locator('#cptList .cpt-row').count(), 4, 'コンテナ：タブ・輸入／輸出を切り替えても、それぞれの結果と選択が残る');

  // ===== 純粋な関数 =====
  const fx = await p.evaluate(() => {
    const T = window.CpTest, now = Date.parse('2026-11-10T00:00:00Z');
    return { d: [T.fmtDt('20261109'), T.fmtDt('2026-11-11T15:30:00Z'), T.fmtDt(null), T.fmtDt('abc')],
      c: ['2026-11-09T00:00:00Z', '2026-11-11T00:00:00Z', '2026-11-13T00:00:00Z', '20261110', '20261109', 'zzz', null].map((v) => T.dueClass(v, now)),
      lv: ['2026-11-09T00:00:00Z', '2026-11-11T00:00:00Z', '2026-11-13T00:00:00Z', null].map((v) => T.levelOf(v, now)),
      r: [T.remainText('2026-11-09T23:27:00Z', now), T.remainText('2026-11-10T05:00:00Z', now), T.remainText('2026-11-16T00:00:00Z', now), T.remainText('2026-11-05T00:00:00Z', now)],
      sl: [T.slipped('2026-11-09T00:00:00Z', null, now), T.slipped('2026-11-09T00:00:00Z', '2026-11-09T01:00:00Z', now), T.slipped('2026-11-12T00:00:00Z', null, now), T.slipped(null, null, now)] };
  });
  eq(fx.d, ['2026/11/09', '2026/11/12 00:30', '', 'abc'], '日付：日付だけ／UTC は日本時間／読めない値はそのまま');
  eq(fx.c, ['cpt-due-over', 'cpt-due-warn', '', 'cpt-due-warn', 'cpt-due-over', '', ''], '期限の色：過ぎた＝over・48時間以内＝warn・日付だけはその日の終わりまで');
  eq(fx.lv, ['over', 'warn', 'ok', null], '期限の段階（levelOf）');
  eq(fx.r, ['超過 33分', 'あと 5時間', 'あと 6日', '超過 5日'], '残りの目安（分・時間・日）');
  eq(fx.sl, [true, false, false, false], '予定超過：予定を過ぎて実績が無いときだけ');

  // ===== スマホ：一覧 → 詳細 =====
  await p.setViewportSize({ width: 390, height: 800 });
  await p.click('.cpt-tab[data-tab="ctn"]');
  ok(await p.locator('#cptDetail').isHidden() && await p.locator('#cptList').isVisible(), 'スマホ：最初は一覧だけ');
  await p.click('#cptList .cpt-row >> nth=0');
  ok(await p.locator('#cptDetail').isVisible() && await p.locator('#cptList').isHidden(), 'スマホ：選ぶと詳細だけ');
  await p.click('.cpt-back');
  ok(await p.locator('#cptList').isVisible(), 'スマホ：「← 一覧へ戻る」で一覧に戻る');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'スマホ：横にはみ出さない（表の横スクロールなし）');
  await p.setViewportSize({ width: 1280, height: 1000 });
  const shot = process.argv[2]; if (shot) await p.locator('#tab-cptest').screenshot({ path: shot });

  // 未ログイン
  await p.evaluate(() => { window.__noSession = true; });
  const before = sent.length;
  await p.click('#cptPing');
  await p.waitForFunction(() => /ログインが必要/.test(document.getElementById('cptLive').innerText));
  eq(sent.length, before, '未ログインでは cp-proxy を呼ばない');
  await p.evaluate(() => { window.__noSession = false; });
  ok(await p.locator('#cptPing').isEnabled() && await p.locator('#cptSearch').isEnabled(), '処理後はボタンが戻る');
  ok(errs.length === 0, 'ページのエラーなし', errs.join(' | '));
  console.log(`\nサイバーポート画面 試験：${pass} 件合格 / ${failN} 件失敗`);
  await b.close(); srv.close();
  process.exit(failN ? 1 : 0);
})();
