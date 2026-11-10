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
