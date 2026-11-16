// 「サイバーポート」画面の説明用サンプル画像を作る（Chromium で本物の画面を撮影）。
// 使い方：node scripts/screenshots/cyberport-samples.js [出力フォルダ]
//   出力：<出力フォルダ>/plain/*.png（そのままの画面）と <出力フォルダ>/marked/*.png（番号つき）、説明メモ.md
// ※ データはすべて架空（本船名・番号・取引先）。サイバーポートへは接続しない（cp-proxy の応答を偽物に差し替える）。
// ※ 日時は「いま」を基準に作るので、撮るたびに日付が変わる。
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = (() => { try { return require(process.env.PLAYWRIGHT_PATH || 'playwright'); } catch (e) { return require('/opt/node-tools/node_modules/playwright'); } })();

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'sample-images'));
const H = 3600 * 1000, iso = (ms) => new Date(Date.now() + ms).toISOString();

// ---------- 架空のデータ ----------
const TERMINALS = [
  { terminalCode: 'TYOSM00C', terminalNameAb: 'サンプルA', portLocation: { portCode: 'JPTYO', portName: '東京', displayOrder: 1 } },
  { terminalCode: 'TYOSM02C', terminalNameAb: 'サンプルB', portLocation: { portCode: 'JPTYO', portName: '東京', displayOrder: 1 } },
  { terminalCode: 'YOKSM01C', terminalNameAb: 'サンプル横浜', portLocation: { portCode: 'JPYOK', portName: '横浜', displayOrder: 2 } },
  { terminalCode: 'KWSSM01C', terminalNameAb: 'サンプル川崎', portLocation: { portCode: 'JPKWS', portName: '川崎', displayOrder: 3 } },
  { terminalCode: 'NGOSM01C', terminalNameAb: 'サンプル名古屋', portLocation: { portCode: 'JPNGO', portName: '名古屋', displayOrder: 4 } },
  { terminalCode: 'OSASM01C', terminalNameAb: 'サンプル大阪', portLocation: { portCode: 'JPOSA', portName: '大阪', displayOrder: 5 } },
  { terminalCode: 'UKBSM01C', terminalNameAb: 'サンプル神戸', portLocation: { portCode: 'JPUKB', portName: '神戸', displayOrder: 6 } }];

const TRADES = [
  { tradeNo: 'EXP_2026111000000101', tradeType: 'Export', tradeStatus: 'Ongoing', tradeName: 'サンプル商事 向け 機械部品 FCL', blNo: 'SMPL90010001', updatedAt: iso(-2 * H) },
  { tradeNo: 'IMP_2026110900000087', tradeType: 'Import', tradeStatus: 'Ongoing', tradeName: 'テスト物産 家具 LCL', blNo: 'SMPL90020002', updatedAt: iso(-6 * H) },
  { tradeNo: 'EXP_2026110800000066', tradeType: 'Export', tradeStatus: 'Completed', tradeName: 'サンプル電機 部品', blNo: 'SMPL90030003', updatedAt: iso(-30 * H) },
  { tradeNo: 'IMP_2026110700000052', tradeType: 'Import', tradeStatus: 'Completed', tradeName: 'ダミー食品 冷凍食品', blNo: 'SMPL90040004', updatedAt: iso(-52 * H) },
  { tradeNo: 'EXP_2026110600000031', tradeType: 'Export', tradeStatus: 'Ongoing', tradeName: 'サンプル化学 樹脂', blNo: '', updatedAt: iso(-77 * H) }];

const portObj = (code, berth, eta, etd, ata, atd) => ({ portCode: code, portName: code === 'JPTYO' ? '東京' : code === 'CNSHA' ? '上海' : code, berthName: berth, estimatedTimeOfArrival: eta, actualTimeOfArrival: ata || null, estimatedTimeOfDeparture: etd, actualTimeOfDeparture: atd || null });
const vessel = (term, name, voy, eta, etd, ata, atd, extra) => Object.assign({
  terminalCode: term,
  vessel: { vesselName: name, voyageNo: voy, imoNo: '9' + String(Math.abs(name.length * 7919 + voy.length * 31)).padStart(6, '0'), portOfLoading: portObj('CNSHA', '上海', iso(eta - 120 * H), iso(eta - 100 * H), iso(eta - 120 * H), iso(eta - 100 * H)), portOfDischarge: portObj('JPTYO', 'B1', iso(eta), iso(etd), ata ? iso(ata) : null, atd ? iso(atd) : null) },
  cargoHandling: { scheduleAt: iso(eta + 2 * H), actualAt: ata ? iso(ata + 2 * H) : null },
  cargoIn: { scheduleAt: iso(eta - 30 * H), actualAt: ata ? iso(eta - 29 * H) : null },
  cargoTransfer: { cyOpenAt: iso(eta - 96 * H), cfsCutAt: iso(eta + 6 * H), cyCutAt: iso(eta + 10 * H) } }, extra || {});
const VESSELS = [
  vessel('TYOSM00C', 'SAKURA MARU', '101E', -72 * H, -50 * H, -72 * H, -50 * H),
  vessel('TYOSM02C', 'FUJI EXPRESS', '202W', -20 * H, 4 * H, -20 * H, null),
  vessel('TYOSM00C', 'HARUKA STAR', '303E', 6 * H, 30 * H, null, null),
  vessel('TYOSM02C', 'MIZUHO TRADER', '404S', 40 * H, 66 * H, null, null),
  vessel('TYOSM00C', 'TSUBAME BRIDGE', '505N', 100 * H, 124 * H, null, null),
  vessel('TYOSM02C', 'KAEDE VOYAGER', '606E', 150 * H, 174 * H, null, null)];
// 日時の情報がまだ無い本船（「情報なし」の例）
VESSELS.push({ terminalCode: 'TYOSM00C', vessel: { vesselName: 'MOMIJI SAMPLE', voyageNo: '707E' } });

const impC = (no, pick, ret, over) => Object.assign({
  terminalCode: 'TYOSM00C', container: { containerNo: no, lengthName: '40ft', containerTypeName: 'HC' }, vessel: { vesselName: 'SAKURA MARU', voyageNo: '101E' },
  billOfLadingDetail: { blNo: 'SMPL90020002' }, containerStatus: { fullOrEmpty: '実入り', customClearanceStatus: '許可済' }, inspectionTarget: false, inspectionStatus: false,
  doAcquisition: true, outboundAvailability: true, cyCarryInDate: iso(-100 * H),
  loadedContainerPickup: { availableAt: iso(-48 * H), dueAt: pick, demurrageFreeTime: 7, pickupPlace: { placeName: 'サンプルA CY' } },
  emptyContainerReturn: { dueAt: ret, detentionFreeTime: 5, deliveryPlace: { placeName: 'サンプル返却ヤード' } }, isDangerousGoods: false }, over || {});
const IMPORT_CTN = [
  impC('SMPU1000001', iso(-3 * H), iso(240 * H)),
  impC('SMPU1000002', iso(24 * H), iso(240 * H)),
  impC('SMPU1000003', iso(150 * H), iso(300 * H)),
  impC('SMPU1000004', iso(200 * H), iso(320 * H)),
  { terminalCode: 'TYOSM00C', container: { containerNo: 'SMPU1000005' }, billOfLadingDetail: { blNo: 'SMPL90020002' } }];
const EXPORT_CTN = [
  { terminalCode: 'YOKSM01C', container: { containerNo: 'SMPU2000001', lengthName: '20ft', containerTypeName: 'GP' }, containerStatus: { fullOrEmpty: '空', customClearanceStatus: '未' }, shipmentAvailability: false,
    emptyContainerPickup: { scheduledAt: iso(-20 * H), actualAt: null, pickupPlace: { placeName: 'サンプル空コンヤード' } }, loadedContainerDelivery: { scheduledAt: iso(30 * H) }, remark: '照合待ち' },
  { terminalCode: 'YOKSM01C', container: { containerNo: 'SMPU2000002', lengthName: '40ft', containerTypeName: 'HC' }, shipmentAvailability: true, containerStatus: { fullOrEmpty: '実入り', customClearanceStatus: '許可済' },
    emptyContainerPickup: { scheduledAt: iso(-48 * H), actualAt: iso(-47 * H) }, loadedContainerDelivery: { scheduledAt: iso(-10 * H), actualAt: iso(-9 * H) }, gateInDate: iso(-9 * H), loadingUnloadingDate: iso(30 * H), shipmentDate: iso(50 * H) }];

// ---------- 撮影の道具 ----------
const okBody = (api, data) => ({ status: 200, body: { ok: true, api, status: 200, data } });
let respond = () => okBody('x', []);
const router = (map) => (body) => { const k = Object.keys(map).find((x) => (body.path || '').startsWith(x)); return map[k] ? map[k](body) : okBody('x', []); };
const BASEMAP = () => ({
  '/API/v2/Terminals/GetList': () => okBody('Terminals/GetList', TERMINALS),
  '/API/v2/Trades/Search': () => okBody('Trades/Search', TRADES),
  '/API/v2/ColinsViewers/GetImportVessels': () => okBody('ColinsViewers/Vessels', VESSELS),
  '/API/v2/ColinsViewers/GetImportContainers': () => okBody('ColinsViewers/Containers', IMPORT_CTN),
  '/API/v2/ColinsViewers/GetExportContainers': () => okBody('ColinsViewers/Containers', EXPORT_CTN) });

async function mark(p, items) {
  await p.evaluate((items) => {
    items.forEach((it) => {
      const el = document.querySelector(it.sel); if (!el) return;
      const r = el.getBoundingClientRect(); const x = r.left + window.scrollX, y = r.top + window.scrollY;
      const off = it.at === 'out' ? [r.width + 4, r.height / 2 - 14] : it.at === 'r' ? [r.width - 12, -14] : it.at === 'c' ? [r.width / 2 - 13, r.height / 2 - 13] : it.at === 'bl' ? [-12, r.height - 12] : [-12, -14];
      const d = document.createElement('div'); d.className = '__mk'; d.textContent = it.n;
      d.style.cssText = 'position:absolute;left:' + (x + off[0]) + 'px;top:' + (y + off[1]) + 'px;width:28px;height:28px;border-radius:50%;background:#d6336c;color:#fff;font:700 16px/28px sans-serif;text-align:center;box-shadow:0 0 0 3px #fff,0 2px 8px rgba(0,0,0,.4);z-index:99999;pointer-events:none';
      document.body.appendChild(d);
    });
  }, items);
}
const unmark = (p) => p.evaluate(() => document.querySelectorAll('.__mk').forEach((e) => e.remove()));

(async () => {
  fs.mkdirSync(path.join(OUT, 'plain'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'marked'), { recursive: true });
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch(process.env.PLAYWRIGHT_PATH ? { executablePath: '/opt/pw-browsers/chromium' } : {});

  async function open(viewport) {
    const ctx = await b.newContext({ viewport, deviceScaleFactor: 2, locale: 'ja-JP' });
    await ctx.route((u) => !u.href.startsWith('http://127.0.0.1'), (r) => r.abort());
    const p = await ctx.newPage();
    await p.route('**/functions/v1/cp-proxy', (route) => route.fulfill({ status: 204 }));
    await p.goto(BASE, { waitUntil: 'load' });
    await p.addStyleTag({ content: '#backToQuoteFab, #fbQuickFab, #quoteActionDock { display: none !important; }' });   // 説明用なので、画面下の固定ボタンは写さない
    await p.evaluate(() => { window.cloudGetClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'sample' } } }) } }); window.CLOUD_CONFIG = Object.assign({}, window.CLOUD_CONFIG, { url: 'http://127.0.0.1:1', publishableKey: 'x' }); });
    await p.evaluate(() => switchCategory('cptest', document.querySelector('.cat-btn[aria-controls="tab-cptest"]')));
    await p.waitForSelector('#cptPing');
    await p.route('http://127.0.0.1:1/functions/v1/cp-proxy', async (route) => {
      const req = route.request();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const r = respond(JSON.parse(req.postData() || '{}'));
      return route.fulfill({ status: r.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(r.body) });
    });
    return p;
  }
  // 画面の中身（#cptRoot）を、上に余白をつけて撮る。top=true のときは画面の一番上（カテゴリの行）から撮る
  async function shoot(p, name, marks, opts) {
    opts = opts || {};
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(200);
    const clip = await p.evaluate((o) => {
      const r = document.querySelector(o.sel || '#cptRoot').getBoundingClientRect();
      const top = o.top ? 0 : Math.max(0, r.top + window.scrollY - 12);
      const bottom = Math.min(document.documentElement.scrollHeight, r.bottom + window.scrollY + 12 + (o.padBottom || 0));
      const h = o.height ? Math.min(o.height, bottom - top) : bottom - top;
      return { x: 0, y: top, width: window.innerWidth, height: h };
    }, opts);
    await p.screenshot({ path: path.join(OUT, 'plain', name + '.png'), clip, fullPage: true });
    if (marks && marks.length) { await mark(p, marks); await p.screenshot({ path: path.join(OUT, 'marked', name + '.png'), clip, fullPage: true }); await unmark(p); }
    console.log('撮影:', name);
  }

  // ================= PC 幅 =================
  const p = await open({ width: 1280, height: 1500 });   // 縦を高くして、右の詳細（追従する枠）が切れないようにする
  respond = router(Object.assign(BASEMAP(), { '/API/v2/Terminals/GetList': () => okBody('Terminals/GetList', TERMINALS) }));
  respond = (body) => (body.action === 'ping' ? { status: 200, body: { ok: true, message: 'システム用と利用者用の両方のトークンを取得できました（接続情報・API接続用ユーザーは有効です）', apiHost: 'api.cyber-port.net', tokenHost: 'api.cyber-port.net' } } : router(BASEMAP())(body));

  // 01 接続を確認（画面の一番上から）
  await p.click('#cptPing'); await p.waitForFunction(() => /接続できて|確認済み|接続済み|有効/.test(document.getElementById('cptConn').innerText) || document.getElementById('cptConn').classList.contains('is-ok'));
  await shoot(p, '01_接続を確認', [
    { n: 1, sel: '.cat-btn[aria-controls="tab-cptest"]', at: 'tl' }, { n: 2, sel: '#cptConn', at: 'tl' }, { n: 3, sel: '#cptPing', at: 'tl' }, { n: 4, sel: '.cpt-tabs', at: 'tl' }],
    { top: true, sel: '#cptLive', padBottom: 6 });

  // 02 取引を検索
  await p.click('.cpt-tab[data-tab="trade"]');
  await p.click('#cptSearch'); await p.waitForSelector('#cptList .cpt-row');
  await shoot(p, '02_取引を検索', [{ n: 1, sel: '#cptKw', at: 'tl' }, { n: 2, sel: '#cptSearch', at: 'tl' }, { n: 3, sel: '#cptList .cpt-row', at: 'tl' }, { n: 4, sel: '.cpt-detailpane', at: 'tl' }]);

  // 03 本船の動静（一覧と流れ）
  await p.click('.cpt-tab[data-tab="vessel"]');
  await p.waitForFunction(() => document.querySelectorAll('#cptPortSel option').length === 7);
  await p.selectOption('#cptPortSel', 'JPTYO');
  await p.click('#cptColinsV'); await p.waitForSelector('#cptList .cpt-row');
  await p.locator('#cptList .cpt-row').nth(1).click();
  await shoot(p, '03_本船の動静', [
    { n: 1, sel: '.cpt-seg', at: 'tl' }, { n: 2, sel: '#cptPortSel', at: 'tl' }, { n: 3, sel: '#cptColinsV', at: 'tl' }, { n: 4, sel: '#cptSort', at: 'tl' },
    { n: 5, sel: '#cptList .cpt-row:nth-child(2)', at: 'tl' }, { n: 6, sel: '.cpt-detailpane', at: 'tl' }]);

  // 04 港の選び方（その他でコード入力）
  await p.selectOption('#cptPortSel', '__other'); await p.fill('#cptPort', 'JPSDJ');
  await shoot(p, '04_港の選び方（一覧に無い港）', [{ n: 1, sel: '#cptPortSel', at: 'tl' }, { n: 2, sel: '#cptPort', at: 'tl' }], { sel: '.cpt-search', padBottom: 30 });
  await p.selectOption('#cptPortSel', 'JPTYO');

  // 05 コンテナの状況（輸入）
  await p.click('.cpt-tab[data-tab="ctn"]'); await p.click('.cpt-seg [data-dir="import"]');
  await p.fill('#cptCtn', 'SMPL90020002'); await p.click('#cptColinsC'); await p.waitForSelector('#cptList .cpt-row');
  await shoot(p, '05_コンテナの状況（輸入・期限の色）', [
    { n: 1, sel: '.cpt-seg', at: 'tl' }, { n: 2, sel: '#cptCtn', at: 'tl' }, { n: 3, sel: '#cptColinsC', at: 'tl' }, { n: 4, sel: '#cptBadge', at: 'out' },
    { n: 5, sel: '#cptFilter', at: 'tl' }, { n: 6, sel: '#cptList .cpt-row:nth-child(1) .cpt-chip', at: 'out' }, { n: 7, sel: '.cpt-detailpane', at: 'tl' }]);

  // 06 すべての項目を見る
  const allBtn = p.locator('[data-act="all"]');
  if (await allBtn.count()) { await allBtn.first().click(); await p.waitForTimeout(300); await shoot(p, '06_すべての項目を見る', [{ n: 1, sel: '[data-act="all"]', at: 'out' }]); await allBtn.first().click(); }

  // 07 コンテナの状況（輸出）
  await p.click('.cpt-seg [data-dir="export"]');
  await p.fill('#cptCtn', 'SMPL-BK-0001'); await p.click('#cptColinsC'); await p.waitForSelector('#cptList .cpt-row');
  await shoot(p, '07_コンテナの状況（輸出）', [{ n: 1, sel: '.cpt-seg', at: 'tl' }, { n: 2, sel: '#cptCtn', at: 'tl' }, { n: 3, sel: '#cptList .cpt-row', at: 'tl' }, { n: 4, sel: '.cpt-detailpane', at: 'tl' }]);
  await p.context().close();

  // ================= スマホ幅 =================
  const m = await open({ width: 390, height: 844 });
  respond = router(BASEMAP());
  await m.click('.cpt-tab[data-tab="vessel"]');
  await m.waitForFunction(() => document.querySelectorAll('#cptPortSel option').length === 7);
  await m.click('#cptColinsV'); await m.waitForSelector('#cptList .cpt-row');
  await shoot(m, '08_スマホ_一覧', [{ n: 1, sel: '#cptPortSel', at: 'tl' }, { n: 2, sel: '#cptColinsV', at: 'tl' }, { n: 3, sel: '#cptList .cpt-row', at: 'tl' }], { height: 900 });
  await m.locator('#cptList .cpt-row').nth(1).click(); await m.waitForSelector('.cpt-detailpane', { state: 'visible' });
  await shoot(m, '09_スマホ_詳細', [{ n: 1, sel: '.cpt-back', at: 'tl' }, { n: 2, sel: '.cpt-flow-h', at: 'tl' }], { height: 900 });

  await b.close(); srv.close();
  fs.writeFileSync(path.join(OUT, '説明メモ.md'), `# サイバーポート画面のサンプル画像\n\nデータはすべて架空です（本船名・番号・取引先は実在しません）。\n\n| ファイル | 内容 |\n|---|---|\n| 01_接続を確認 | 画面の入口（上段の「サイバーポート」タブ）と、接続の確認 |\n| 02_取引を検索 | 取引の検索と、左で選ぶ・右で詳細を見る |\n| 03_本船の動静 | 港を選んで本船の動静を調べる。入港→荷役→搬入→CYオープン→カット→出港の流れ |\n| 04_港の選び方（一覧に無い港） | 一覧に無い港は「その他」でコードを入力 |\n| 05_コンテナの状況（輸入・期限の色） | 搬出期限・返却期限の色分け（赤＝超過、黄＝48時間以内） |\n| 06_すべての項目を見る | 流れの下の「すべての項目を見る」で全項目を表示 |\n| 07_コンテナの状況（輸出） | 輸出：空コン搬出→実入り搬入→ゲートイン→船積 |\n| 08・09_スマホ | 一覧→詳細の切り替え |\n\nplain/ は説明を重ねていない画面、marked/ は番号（ピンクの丸）つきです。\n`);
})().catch((e) => { console.error(e); process.exit(1); });
