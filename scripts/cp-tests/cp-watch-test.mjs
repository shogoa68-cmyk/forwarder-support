// 動静の自動確認（watch.ts）の試験。サイバーポートへは接続しない（通信・保存は偽物に差し替える）。
// 使い方：node scripts/cp-tests/cp-watch-test.mjs   （Node 22.13 以上）
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/functions/cp-proxy');
const W = await import(path.join(dir, 'watch.ts'));
const L = await import(path.join(dir, 'logic.ts'));

let pass = 0, failN = 0;
function ok(cond, name, extra = '') { if (cond) { pass++; } else { failN++; console.log('✗ NG:', name, extra); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, ' 実際=' + JSON.stringify(a) + ' 期待=' + JSON.stringify(b)); }

const NOW = Date.parse('2026-11-12T00:00:00Z');
const DAY = 86_400_000, H = 3_600_000;
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

// ============ 日時・期限 ============
eq(W.parseMs('2026-11-12T00:00:00Z'), NOW, 'ISO（UTC）を読む');
eq(W.parseMs('20261112'), Date.parse('2026-11-11T15:00:00Z'), '日付だけ（20261112）は日本のその日の 0 時');
eq(W.parseMs('2026-11-12'), Date.parse('2026-11-11T15:00:00Z'), '日付だけ（ハイフン付き）');
eq(W.parseMs('abc'), null, '読めない値は null');
eq(W.parseMs(null), null, 'null は null');
eq(W.levelOf(null, NOW), 'none', '期限なし');
eq(W.levelOf(NOW - 1, NOW), 'over', '過ぎた');
eq(W.levelOf(NOW + 47 * H, NOW), 'warn', '48時間以内');
eq(W.levelOf(NOW + 49 * H, NOW), 'ok', '48時間より先');

// ============ 写し（コンテナ・本船） ============
const impC = (o = {}) => Object.assign({
  terminalCode: 'T1', container: { containerNo: 'ABCD1234567' },
  containerStatus: { customClearanceStatus: '許可' }, billOfLadingDetail: { blNo: 'BL1' },
  outboundAvailability: true, doAcquisition: true, inspectionStatus: false,
  loadedContainerPickup: { dueAt: iso(NOW + 5 * DAY), availableAt: iso(NOW - DAY), actualAt: null },
  emptyContainerReturn: { dueAt: iso(NOW + 9 * DAY), actualAt: null },
  vessel: { vesselName: 'EVER TEST', voyageNo: '12E', portOfLoading: { portCode: 'CNSHA', portName: 'SHANGHAI', actualTimeOfDeparture: iso(NOW - 3 * DAY) },
    portOfDischarge: { portCode: 'JPTYO', portName: 'TOKYO', estimatedTimeOfArrival: iso(NOW - DAY), actualTimeOfArrival: iso(NOW - DAY) } },
}, o);
const it1 = W.containerItems(impC(), 'import');
const byK = (items) => Object.fromEntries(items.map((x) => [x.k, x]));
ok(byK(it1)['c:ABCD1234567:pickDue'].dl === true, '輸入：搬出期限は期限の項目');
eq(byK(it1)['c:ABCD1234567:outOk'].val, 'true', '輸入：搬出可否は true を文字で持つ');
eq(byK(it1)['c:ABCD1234567:pickAct'].val, null, '輸入：空の項目は null');
eq(byK(it1)['c:ABCD1234567:retDue'].scope, 'コンテナ ABCD1234567', 'スコープ名');

const expC = (o = {}) => Object.assign({
  terminalCode: 'T9', container: { containerNo: 'EFGH7654321' }, shipmentAvailability: true, gateInDate: null,
  vessel: { vesselName: 'ONE TEST', voyageNo: '33W', bookingNo: 'BK1',
    portOfLoading: { portCode: 'JPYOK', portName: 'YOKOHAMA', estimatedTimeOfDeparture: iso(NOW + 4 * DAY) },
    portOfDischarge: { portCode: 'USLAX', portName: 'LOS ANGELES', estimatedTimeOfArrival: iso(NOW + 18 * DAY), actualTimeOfArrival: null } },
}, o);
const ex1 = W.containerItems(expC(), 'export');
ok('c:EFGH7654321:shipOk' in byK(ex1) && !('c:EFGH7654321:pickDue' in byK(ex1)), '輸出と輸入で項目が違う');

const vi = W.vesselItems(expC());
ok('v:ONE TEST|33W:pod:eta' in byK(vi) && 'v:ONE TEST|33W:pod:ata' in byK(vi), '本船：荷揚港の ETA/ATA を拾う');
ok(!('v:ONE TEST|33W:cyCut' in byK(vi)), 'コンテナ側の本船記録には CY カットは出さない');
const vsch = { vessel: expC().vessel, cargoTransfer: { cyOpenAt: iso(NOW + DAY), cyCutAt: iso(NOW + 3 * DAY), cfsCutAt: null }, cargoHandling: { scheduleAt: iso(NOW + 4 * DAY) } };
const vi2 = byK(W.vesselItems(vsch));
ok(vi2['v:ONE TEST|33W:cyCut'].dl === true && vi2['v:ONE TEST|33W:cyCut'].val === iso(NOW + 3 * DAY), '本船の動静の記録：CY カットを拾う（期限）');
ok('v:ONE TEST|33W:cfsCut' in vi2 && vi2['v:ONE TEST|33W:cfsCut'].val === null, '値が空でも項目は持つ（あとで入ったら「新しく入った」と分かる）');
const trV = { vessel: Object.assign({}, expC().vessel, { transhipVessels: [{ vesselName: 'FEEDER', voyageNo: '1', portOfDischarge: { portCode: 'MXZLO', portName: 'MANZANILLO', estimatedTimeOfArrival: iso(NOW + 25 * DAY) } }] }) };
ok(W.vesselItems(trV).some((x) => x.scope.includes('積替 FEEDER')), '積み替え本船の荷揚港も拾う');
eq(W.vesselItems({}), [], '本船が無い記録は空');
const merged = W.uniqItems([{ k: 'a', scope: 's', label: 'l', val: null, cat: 'date' }, { k: 'a', scope: 's', label: 'l', val: 'X', cat: 'date' }, { k: 'b', scope: 's', label: 'l', val: '1', cat: 'text' }, { k: 'b', scope: 's', label: 'l', val: '2', cat: 'text' }]);
eq(merged.map((x) => x.val), ['X', '1'], '重複は 1 つに（空なら値のある方・両方あれば先）');

// ============ 差 ============
eq(W.diffItems(null, it1, NOW), [], '初回（前回なし）は変化なし＝基準を作るだけ');
eq(W.diffItems(it1, it1, NOW), [], '同じなら変化なし');

const shift = (items, k, val) => items.map((x) => (x.k === k ? Object.assign({}, x, { val }) : x));
// 予定のずれ
const e0 = W.vesselItems(expC());
let ch = W.diffItems(e0, shift(e0, 'v:ONE TEST|33W:pod:eta', iso(NOW + 20 * DAY)), NOW);
eq(ch.length, 1, 'ETA が動いた：1 件');
eq([ch[0].kind, ch[0].sev, ch[0].note], ['changed', 'warn', '＋2日'], 'ETA が 2 日遅れ：警告・「＋2日」');
ch = W.diffItems(e0, shift(e0, 'v:ONE TEST|33W:pod:eta', iso(NOW + 18 * DAY + 3 * H)), NOW);
eq([ch[0].sev, ch[0].note], ['info', '＋3時間'], '3 時間のずれは情報');
ch = W.diffItems(e0, shift(e0, 'v:ONE TEST|33W:pod:eta', iso(NOW + 17 * DAY)), NOW);
eq(ch[0].note, '－24時間', '24 時間早まり（48 時間未満は時間で表す）');
// 実績が入った
ch = W.diffItems(e0, shift(e0, 'v:ONE TEST|33W:pod:ata', iso(NOW + 17 * DAY)), NOW);
eq([ch[0].kind, ch[0].sev], ['new', 'info'], '実績（ATA）が新しく入った：情報');
// 値が消えた
ch = W.diffItems(it1, shift(it1, 'c:ABCD1234567:pickDue', null), NOW);
eq([ch[0].kind, ch[0].sev], ['cleared', 'warn'], '値が消えた：警告');
// 状態（可否）
ch = W.diffItems(it1, shift(it1, 'c:ABCD1234567:outOk', 'false'), NOW);
eq([ch[0].kind, ch[0].sev], ['changed', 'warn'], '搬出可否が変わった：警告');
// 期限の超過
ch = W.diffItems(it1, shift(it1, 'c:ABCD1234567:pickDue', iso(NOW - 2 * H)), NOW);
eq([ch[0].sev, ch[0].note], ['alert', '期限超過'], '搬出期限が過ぎた：要対応');
ch = W.diffItems(it1, shift(it1, 'c:ABCD1234567:pickDue', iso(NOW + 30 * H)), NOW);
eq(ch[0].sev, 'warn', '期限が 48 時間以内に入った：警告');
ok(/48時間以内/.test(ch[0].note || ''), '48 時間以内の注記');
// 新しい項目（前回に無かった）
ch = W.diffItems(it1.slice(0, 3), it1, NOW);
ok(ch.length > 0 && ch.every((c) => c.kind === 'new' || c.from == null), '前回に無かった項目は「新しく入った」');

// urgentAt
eq(W.urgentAt(it1, NOW), iso(NOW + 5 * DAY).replace('Z', '.000Z'), '近い期限（5日後）を優先の目安に');
eq(W.urgentAt(shift(it1, 'c:ABCD1234567:pickDue', iso(NOW + 30 * DAY)).map((x) => (x.k.endsWith('retDue') ? Object.assign({}, x, { val: iso(NOW + 40 * DAY) }) : x)), NOW), null, '1 週間より先の期限は急がない');
ok(W.urgentAt(shift(it1, 'c:ABCD1234567:pickDue', iso(NOW - DAY)), NOW) === new Date(NOW - DAY).toISOString(), '過ぎた期限はいちばん急ぐ');

// ============ 追跡の終わり ============
eq(W.evaluateEnd('import', [], NOW).state, 'active', '輸入：コンテナなし＝追跡中');
eq(W.evaluateEnd('import', [impC()], NOW).state, 'active', '輸入：返却実績なし＝追跡中');
eq(W.evaluateEnd('import', [impC({ emptyContainerReturn: { actualAt: iso(NOW - H) } })], NOW).state, 'done', '輸入：返却実績あり＝終了');
eq(W.evaluateEnd('import', [impC({ emptyContainerReturn: { actualAt: iso(NOW - H) } }), impC({ container: { containerNo: 'WXYZ0000001' } })], NOW).state, 'active', '輸入：1 本でも未返却なら追跡中');
const expArr = (eta, ata, extra = {}) => expC({ vessel: Object.assign({}, expC().vessel, { portOfDischarge: { portName: 'LOS ANGELES', estimatedTimeOfArrival: eta, actualTimeOfArrival: ata } }, extra) });
eq(W.evaluateEnd('export', [expArr(iso(NOW + 5 * DAY), null)], NOW).state, 'active', '輸出：ETA 前＝追跡中');
let r = W.evaluateEnd('export', [expArr(iso(NOW - DAY), iso(NOW - H))], NOW);
eq(r.state, 'done', '輸出：荷揚港の入港実績あり＝終了');
ok(/LOS ANGELES/.test(r.note || ''), '終了の理由に港名');
eq(W.evaluateEnd('export', [expArr(iso(NOW - 2 * DAY), null)], NOW).state, 'active', '輸出：ETA を 2 日過ぎ＝まだ追跡中（3 日以内）');
r = W.evaluateEnd('export', [expArr(iso(NOW - 4 * DAY), null)], NOW);
eq(r.state, 'ask', '輸出：ETA を 4 日過ぎても実績なし＝確認の知らせ');
ok(/終了しますか/.test(r.note || ''), '確認の文面');
eq(W.evaluateEnd('export', [expArr(null, null)], NOW).state, 'active', '輸出：ETA が無ければ判断しない');
// 積み替え：最終の荷揚港で判定
const trExp = expC({ vessel: Object.assign({}, expC().vessel, { portOfDischarge: { portName: 'MID', actualTimeOfArrival: iso(NOW - 5 * DAY) }, transhipVessels: [{ vesselName: 'F', portOfDischarge: { portName: 'FINAL', estimatedTimeOfArrival: iso(NOW + 3 * DAY), actualTimeOfArrival: null } }] }) });
eq(W.evaluateEnd('export', [trExp], NOW).state, 'active', '積み替え：途中の港に着いても最終の港が未到着なら追跡中');
eq(W.finalArrival(trExp.vessel).name, 'FINAL', '最終の荷揚港は最後の積替本船の荷揚港');

// ============ 照合キー ============
eq(W.containerQueries({ direction: 'import', bl_no: ' one y tyo 123 ', booking_no: null, container_nos: [] }), [{ blNoList: ['ONEYTYO123'] }], '輸入：B/L 番号（空白除去・大文字）で 1 回');
eq(W.containerQueries({ direction: 'export', bl_no: null, booking_no: 'bk-1', container_nos: [] }), [{ bookingNoList: ['BK-1'] }], '輸出：ブッキング番号で 1 回');
eq(W.containerQueries({ direction: 'import', bl_no: null, booking_no: null, container_nos: ['abcd1234567', 'bad', 'EFGH7654321'] }), [{ containerNo: 'ABCD1234567' }, { containerNo: 'EFGH7654321' }], '番号だけのときはコンテナ番号ごと（形の合わないものは除く）');
eq(W.containerQueries({ direction: 'import', bl_no: null, booking_no: null, container_nos: null }), [], 'キー無しは空');

// ============ 実行器 ============
const calls = [];
const saved = [];
function mkDeps(targets, handler) {
  return {
    pick: async () => targets,
    get: async (p, q) => { calls.push([p, q]); return handler(p, q); },
    save: async (r) => { saved.push(r); },
    now: () => NOW,
  };
}
const tImp = { preset_id: 'p-imp', direction: 'import', bl_no: 'BL1', booking_no: null, container_nos: [], snapshot: null, consecutive_errors: 0 };
const tExp1 = { preset_id: 'p-e1', direction: 'export', bl_no: null, booking_no: 'BK1', container_nos: [], snapshot: null, consecutive_errors: 0 };
const tExp2 = { preset_id: 'p-e2', direction: 'export', bl_no: null, booking_no: 'BK2', container_nos: [], snapshot: null, consecutive_errors: 0 };
const tNoKey = { preset_id: 'p-nk', direction: 'import', bl_no: null, booking_no: null, container_nos: [], snapshot: null, consecutive_errors: 0 };
const vsched = { terminalCode: 'T9', vessel: expC().vessel, cargoTransfer: { cyOpenAt: iso(NOW + DAY), cyCutAt: iso(NOW + 3 * DAY) } };
const handler = (p, q) => {
  if (p.endsWith('ImportContainers')) return [impC()];
  if (p.endsWith('ExportContainers')) return [expC({ container: { containerNo: q.bookingNoList[0] === 'BK1' ? 'EFGH7654321' : 'IJKL1111111' } })];
  if (p.includes('ExportVessels/')) return [vsched];
  throw new Error('想定外: ' + p);
};
let sum = await W.runWatchBatch(mkDeps([tImp, tExp1, tExp2, tNoKey], handler), 5);
eq([sum.picked, sum.ok, sum.failed], [4, 3, 1], '4 件中 3 件成功・1 件（キー無し）失敗');
eq(saved.length, 4, '成功・失敗にかかわらず 1 件ずつ保存する');
const sNK = saved.find((x) => x.preset_id === 'p-nk');
eq([sNK.ok, sNK.status], [false, 'error'], 'キー無しは error');
ok(/照合キー/.test(sNK.error || '') && /no_keys/.test(sNK.error || ''), 'エラー文に理由');
const vCalls = calls.filter((c) => c[0].includes('ExportVessels/'));
eq(vCalls.length, 1, '同じ港・同じ本船は 1 回だけ呼ぶ（輸出 2 件で共有）');
eq(vCalls[0], ['/API/v2/ColinsViewers/GetExportVessels/JPYOK', { vesselName: 'ONE TEST', voyageNo: '33W' }], '本船の動静は積荷港（輸出）・本船名・航海番号で探す');
ok(calls.every(([p]) => L.matchAllowed(p) !== null), '呼んだ API はすべて許可リスト（読み取りの GET）に入っている');
ok(calls.every(([p]) => /\/ColinsViewers\//.test(p)), '呼ぶのは COLINS の読み取りだけ');
const sE1 = saved.find((x) => x.preset_id === 'p-e1');
ok(sE1.items.some((x) => x.k === 'v:ONE TEST|33W:cyCut'), '本船の動静（CY カット）が写しに入る');
eq(sE1.changes, [], '初回は変化なし');
eq([sE1.state, sE1.status, sE1.ok], ['active', 'ok', true], '輸出：まだ追跡中');
ok(sE1.urgent_at !== null, 'CY カットが近いので優先の目安が付く');
ok(sE1.checked_at === iso(NOW).replace('Z', '.000Z'), '確認した時刻');

// 2 回目：前回の写しを渡す → 変化を検知
calls.length = 0; saved.length = 0;
const prevItems = sE1.items;
const handler2 = (p, q) => (p.includes('ExportContainers') ? [expC({ container: { containerNo: 'EFGH7654321' }, vessel: Object.assign({}, expC().vessel, { portOfDischarge: { portName: 'LOS ANGELES', estimatedTimeOfArrival: iso(NOW + 21 * DAY), actualTimeOfArrival: null } }) })]
  : [Object.assign({}, vsched, { cargoTransfer: { cyOpenAt: iso(NOW + DAY), cyCutAt: iso(NOW + 2 * DAY) } })]);
sum = await W.runWatchBatch(mkDeps([Object.assign({}, tExp1, { snapshot: prevItems })], handler2), 5);
const s2 = saved[0];
eq(sum.changed, 1, '変化のあった件数');
ok(s2.changes.some((c) => c.label.includes('ETA') && c.sev === 'warn' && c.note === '＋3日'), 'ETA が 3 日遅れたことを検知');
ok(s2.changes.some((c) => c.label === 'CYカット' && c.sev === 'warn'), 'CY カットが 1 日早まったことを検知');

// 該当なし（COLINS にまだ無い）
saved.length = 0;
sum = await W.runWatchBatch(mkDeps([tImp], () => []), 5);
eq([sum.nodata, sum.failed, saved[0].status, saved[0].items], [1, 0, 'nodata', null], '該当なし：失敗ではなく nodata・前回の写しは触らない');

// 通信エラー：1 件が失敗しても残りは続く・秘密は出ない
saved.length = 0;
const boom = Object.assign(new Error('サイバーポートに接続できませんでした（通信エラー）'), { code: 'upstream_network', extra: { upstreamStatus: 503 } });
sum = await W.runWatchBatch(mkDeps([tImp, tExp1], (p) => { if (p.includes('Import')) throw boom; return handler(p, { bookingNoList: ['BK1'] }); }), 5);
eq([sum.failed, sum.ok], [1, 1], '1 件失敗しても残りを続ける');
ok(/upstream_network/.test(saved[0].error) && /503/.test(saved[0].error), 'エラーに種類と応答コード');
eq(saved[0].items, null, '失敗したときは写しを上書きしない');

// 本船の動静だけ失敗しても、コンテナの確認は成功にする
saved.length = 0;
sum = await W.runWatchBatch(mkDeps([tExp1], (p, q) => { if (p.includes('Vessels/')) throw boom; return handler(p, q); }), 5);
eq([sum.ok, sum.failed], [1, 0], '本船の動静が取れなくてもコンテナの確認は成功');
ok(!saved[0].items.some((x) => x.k.endsWith(':cyCut')), 'その場合 CY カットの項目は入らない');

// 輸入：返却を確認したら終了
saved.length = 0;
await W.runWatchBatch(mkDeps([tImp], () => [impC({ emptyContainerReturn: { dueAt: iso(NOW), actualAt: iso(NOW - H) } })]), 5);
eq([saved[0].state, /返却/.test(saved[0].state_note || '')], ['done', true], '輸入：返却確認で追跡完了');

// 輸入の本船は荷揚港（日本）で探す
calls.length = 0;
await W.runWatchBatch(mkDeps([tImp], (p) => (p.includes('ImportVessels') ? [] : [impC()])), 5);
ok(calls.some(([p]) => p === '/API/v2/ColinsViewers/GetImportVessels/JPTYO'), '輸入：本船の動静は荷揚港（JPTYO）で探す');

// 「もう少し追う」：確認の知らせ（ask）を、指定の時刻まで出さない
{
  const lateRec = expC({ vessel: Object.assign({}, expC().vessel, { portOfDischarge: { portName: 'LOS ANGELES', estimatedTimeOfArrival: iso(NOW - 4 * DAY), actualTimeOfArrival: null } }) });
  const tt = (o) => Object.assign({}, tExp1, o);
  saved.length = 0;
  await W.runWatchBatch(mkDeps([tt({})], () => [lateRec]), 5);
  eq(saved[0].state, 'ask', '（前提）ETA を 4 日過ぎても実績なし → 確認の知らせ');
  saved.length = 0;
  await W.runWatchBatch(mkDeps([tt({ ask_snooze_until: iso(NOW + 2 * DAY) })], () => [lateRec]), 5);
  eq([saved[0].state, saved[0].state_note], ['active', null], '「もう少し追う」の期間中は知らせない（追跡中のまま）');
  saved.length = 0;
  await W.runWatchBatch(mkDeps([tt({ ask_snooze_until: iso(NOW - H) })], () => [lateRec]), 5);
  eq(saved[0].state, 'ask', '期間が過ぎたら、また知らせる');
}

// 時間切れ：残りは確認も保存もせず、次の回に回す
{
  saved.length = 0; calls.length = 0;
  let t = NOW;
  const d = mkDeps([tImp, tExp1, tExp2], handler);
  d.now = () => { t += 40_000; return t; };       // 1 件ごとに 40 秒進む想定
  d.stopAt = NOW + 100_000;
  const sm = await W.runWatchBatch(d, 5);
  ok(sm.skipped >= 1 && sm.skipped + saved.length === 3, '時間切れ：残りの案件は保存せず skipped に数える', JSON.stringify(sm));
  ok(saved.length < 3, '時間切れ：全件は処理しない');
}

// 保存の失敗：その案件だけ数え、残りは続ける
{
  saved.length = 0;
  let k = 0;
  const d = mkDeps([tImp, tExp1], handler);
  d.save = async (r) => { k++; if (k === 1) throw new Error('db down'); saved.push(r); };
  const sm = await W.runWatchBatch(d, 5);
  eq([sm.saveErrors, saved.length], [1, 1], '1 件の保存失敗で、残りの案件の確認を止めない');
}

console.log(`\n動静の自動確認 試験：${pass} 件合格 / ${failN} 件失敗`);
process.exit(failN ? 1 : 0);
