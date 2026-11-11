// cp-webhook（Supabase Edge Function）の試験。サイバーポートや Supabase へは接続しない（偽物に差し替える）。
// 使い方：node scripts/cp-tests/cp-webhook-test.mjs   （Node 22.13 以上）
//        CP_TARGET=single node scripts/cp-tests/cp-webhook-test.mjs   （貼り付け用の 1 枚版を試験）
//   ① logic.ts の純粋関数（署名の検証・通知の読み取り・重複の印）…署名は Node の crypto で別に計算して答え合わせする
//   ② index.ts の入口を、Deno と Supabase を偽物にして動かす（署名・大きさ・重複・保存の失敗・秘密が漏れないこと）
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHmac, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fnDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/functions/cp-webhook');
const L = await import(path.join(fnDir, 'logic.ts'));

let pass = 0, failN = 0;
function ok(cond, name, extra = '') { if (cond) pass++; else { failN++; console.log('✗ NG:', name, extra); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, ' 実際=' + JSON.stringify(a) + ' 期待=' + JSON.stringify(b)); }

const SECRET = 'whsec-TOP-SECRET-0123456789';
const hmac = (secret, body) => createHmac('sha256', secret).update(body, 'utf8').digest();

// ============ ① logic.ts ============
eq(L.cleanSecret(' "abc" \n'), 'abc', 'シークレット：引用符・空白を除く');
eq(L.cleanSecret('“abc”'), 'abc', 'シークレット：全角の引用符');
eq(L.cleanSecret('a"b'), 'a"b', 'シークレット：中の引用符は残す');
eq(L.cleanSecret(undefined), '', 'シークレット：未設定');

// 署名：Node の crypto で計算した値と照合する（どの表現でも通る／違うものは通らない）
{
  const body = JSON.stringify({ notifyOperation: { historyId: 'H1' }, msg: '日本語（全角）も含む本文 \u{1F6A2}' });
  const mac = hmac(SECRET, body);
  const hex = mac.toString('hex'), b64 = mac.toString('base64'), b64u = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  ok(await L.verifySignature(hex, SECRET, body), '署名：16進（小文字）');
  ok(await L.verifySignature(hex.toUpperCase(), SECRET, body), '署名：16進（大文字）');
  ok(await L.verifySignature('sha256=' + hex, SECRET, body), '署名：sha256= 付きの16進');
  ok(await L.verifySignature('SHA256 = ' + hex, SECRET, body), '署名：接頭辞の空白・大文字小文字');
  ok(await L.verifySignature(b64, SECRET, body), '署名：Base64');
  ok(await L.verifySignature('sha256=' + b64, SECRET, body), '署名：sha256= 付きの Base64');
  ok(await L.verifySignature(b64u, SECRET, body), '署名：Base64url');
  ok(await L.verifySignature('  ' + hex + '  ', SECRET, body), '署名：前後の空白は無視');
  ok(!(await L.verifySignature(hex, 'wrong-secret', body)), '署名：鍵が違えば不一致');
  ok(!(await L.verifySignature(hex, SECRET, body + ' ')), '署名：本文が 1 文字でも違えば不一致');
  ok(!(await L.verifySignature(hex, SECRET, body.replace('H1', 'H2'))), '署名：本文を改ざんすると不一致');
  ok(!(await L.verifySignature(hex.slice(0, -1) + (hex.endsWith('0') ? '1' : '0'), SECRET, body)), '署名：最後の 1 文字が違えば不一致');
  ok(!(await L.verifySignature(hex.slice(0, 32), SECRET, body)), '署名：途中までは不一致');
  ok(!(await L.verifySignature(hex + 'ab', SECRET, body)), '署名：余分な文字があれば不一致');
  ok(!(await L.verifySignature('', SECRET, body)), '署名：空のヘッダーは不一致');
  ok(!(await L.verifySignature(null, SECRET, body)), '署名：ヘッダー無しは不一致');
  ok(!(await L.verifySignature(undefined, SECRET, body)), '署名：undefined は不一致');
  ok(!(await L.verifySignature('sha256=', SECRET, body)), '署名：接頭辞だけは不一致');
  ok(!(await L.verifySignature(hex, '', body)), '署名：鍵が空なら不一致（鍵未設定で通ってしまわない）');
  // 空の本文でも計算は成り立つ（偽物を通さない）
  ok(await L.verifySignature(hmac(SECRET, '').toString('hex'), SECRET, ''), '署名：空の本文でも照合できる');
  // 自分の関数の出力が、Node の計算と一致する（同じコードで答え合わせしていないことの確認）
  eq(L.toHex(await L.hmacSha256(SECRET, body)), hex, 'HMAC：Node の crypto と一致（16進）');
  eq(L.toBase64(await L.hmacSha256(SECRET, body)), b64, 'HMAC：Node の crypto と一致（Base64）');
}
// 比較（長さ・内容の違い）
ok(L.timingSafeEqual('abc', 'abc'), '比較：同じ');
ok(!L.timingSafeEqual('abc', 'abd'), '比較：1 文字違い');
ok(!L.timingSafeEqual('abc', 'abcd'), '比較：長さが違う');
ok(!L.timingSafeEqual('abcd', 'abc'), '比較：長さが違う（逆）');
ok(L.timingSafeEqual('', ''), '比較：空どうし');
ok(!L.timingSafeEqual('', 'a'), '比較：空と非空');
ok(L.timingSafeEqual('日本語', '日本語') && !L.timingSafeEqual('日本語', '日本誤'), '比較：全角');

// 通知の読み取り（公式の OpenAPI の項目名に基づく実物に近い形）
const realistic = {
  notifyToPartner: { partnerId: 'P1', organizationId: 'ORG-0001', organizationName: '自社', company: { companyId: 'C1' } },
  postToUrl: ['https://example.supabase.co/functions/v1/cp-webhook'],
  notifyOperation: {
    historyId: 'HIST-123',
    operationType: { operationTypeCode: 'ReportSubmit', operationTypeName: '帳票を提出した', apiPath: '/API/v2/Reports/X/Submit', method: 'POST' },
    inTrade: { tradeNo: 'IMP_2026111000000001', tradeType: 'Import', blNo: 'ONEYTYOGF8748400', uniqueNos: ['IMP2609222'] },
    inReport: { reportId: 'R-9', reportType: { reportCode: 'BL', reportName: 'B/L' }, container: { containerNo: 'OOLU3962900' } },
    operatedAt: '2026-11-10T01:02:03Z',
  },
};
{
  const r = await L.summarizeEvent(realistic, JSON.stringify(realistic));
  eq([r.kind, r.history_id, r.operation_code, r.operation_name], ['report', 'HIST-123', 'ReportSubmit', '帳票を提出した'], '通知：種類・履歴ID・操作');
  eq([r.trade_no, r.trade_type, r.bl_no, r.report_code, r.report_name, r.report_id, r.container_no], ['IMP_2026111000000001', 'Import', 'ONEYTYOGF8748400', 'BL', 'B/L', 'R-9', 'OOLU3962900'], '通知：取引・帳票・コンテナ');
  eq([r.to_org_id, r.operated_at], ['ORG-0001', '2026-11-10T01:02:03.000Z'], '通知：通知先の組織・操作日時');
  eq(r.dedupe_key, 'h:HIST-123|ORG-0001', '重複の印：履歴ID＋組織');
  eq(r.payload, realistic, '通知：本文はそのまま保存');
}
{
  const r = await L.summarizeEvent({ notifyOperation: { inMessage: { message: 'こんにちは', isMessageUpdated: false } } }, 'x');
  eq(r.kind, 'message', '種類：チャット（inMessage）');
  ok(r.history_id === null && r.trade_no === null && r.operated_at === null, '通知：項目が無ければ null（落ちない）');
  ok(/^b:[0-9a-f]{64}$/.test(r.dedupe_key), '重複の印：履歴IDが無ければ本文のハッシュ');
  eq(r.dedupe_key, 'b:' + createHash('sha256').update('x').digest('hex'), '重複の印：ハッシュは Node の sha256 と一致');
}
eq(L.eventKind({ notifyOperation: { inNaccs: { naccsBusinessCode: 'X' } } }), 'naccs', '種類：NACCS');
eq(L.eventKind({ notifyOperation: { inReport: {}, inMessage: {} } }), 'message', '種類：メッセージが最優先');
eq(L.eventKind({ notifyOperation: { inTrade: { tradeNo: 'X' } } }), 'trade', '種類：取引');
eq(L.eventKind({ notifyOperation: { inTask: {} } }), 'task', '種類：タスク');
eq(L.eventKind({ notifyOperation: { inProcess: {} } }), 'process', '種類：プロセス');
eq(L.eventKind({}), 'other', '種類：不明');
eq(L.eventKind(null), 'other', '種類：null');
eq((await L.summarizeEvent({ notifyOperation: { operatedAt: 'not-a-date' } }, 'y')).operated_at, null, '通知：読めない日時は null');
eq((await L.summarizeEvent({ notifyOperation: { historyId: 'A' } }, 'y')).dedupe_key, 'h:A|', '重複の印：組織が無ければ空');
ok((await L.summarizeEvent({ notifyOperation: { historyId: 'A' }, notifyToPartner: { organizationId: 'O1' } }, 'y')).dedupe_key !== (await L.summarizeEvent({ notifyOperation: { historyId: 'A' }, notifyToPartner: { organizationId: 'O2' } }, 'y')).dedupe_key, '重複の印：通知先の組織が違えば別');
ok(L.MAX_BODY_BYTES === 262144 && L.MAX_ITEMS === 50, '上限：256KB・50 件');

// ============ ② index.ts（偽の Deno / Supabase で動かす） ============
const warnings = [], logs = [], errors = [];
function load(env, { dbError = null } = {}) {
  const single = process.env.CP_TARGET === 'single';
  const entry = single ? path.join(fnDir, '../../cp-webhook-single/index.ts') : path.join(fnDir, 'index.ts');
  const src = readFileSync(entry, 'utf8').replace(/^import .*$/gm, '');
  const js = stripTypeScriptTypes(src);
  let handler = null;
  const dbCalls = [];
  const DenoFake = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  const createClient = () => ({ from: (table) => ({ upsert: async (rows, opts) => { dbCalls.push({ table, rows, opts }); return { error: dbError }; } }) });
  // 1 枚版は logic を中に持つので、外からは渡さない（const の二重宣言になるため）
  const names = single ? [] : Object.keys(L);
  const fn = new Function('Deno', 'createClient', 'console', ...names, js);
  fn(DenoFake, createClient, { log: (m) => logs.push(String(m)), warn: (m) => warnings.push(String(m)), error: (m) => errors.push(String(m)) }, ...names.map((k) => L[k]));
  return { handler, dbCalls };
}
const mkEnv = (extra = {}) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-KEY-xyz', CP_WEBHOOK_SECRET: SECRET, ...extra });
const post = (body, headers = {}, method = 'POST') => new Request('https://x.supabase.co/functions/v1/cp-webhook', { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' ? body : undefined });
const signed = (obj, secret = SECRET) => { const b = typeof obj === 'string' ? obj : JSON.stringify(obj); return post(b, { 'x-cyberport-signature-256': hmac(secret, b).toString('hex') }); };
async function call(h, req) {
  const res = await h.handler(req); const text = await res.text();
  ok(!text.includes(SECRET) && !text.includes('service-role-KEY-xyz'), '応答に秘密が含まれない');
  let j = null; try { j = JSON.parse(text); } catch { /* 本文なし */ }
  return { status: res.status, j, text };
}

{
  let h = load(mkEnv());
  eq((await call(h, post('{}', {}, 'GET'))).status, 405, 'GET は 405');
  eq((await call(h, post('{}', {}, 'PUT'))).status, 405, 'PUT は 405');
  eq(h.dbCalls.length, 0, '405：保存しない');

  // 未設定
  h = load(mkEnv({ CP_WEBHOOK_SECRET: '' }));
  let r = await call(h, signed(realistic, ''));
  eq([r.status, r.j.error, h.dbCalls.length], [503, 'not_configured', 0], '鍵が未設定 → 503・保存しない（空の鍵で署名を作っても通さない）');

  // 正しい署名（16進）
  h = load(mkEnv());
  r = await call(h, signed(realistic));
  eq([r.status, r.j.ok, r.j.received], [200, true, 1], '正しい署名 → 200・1 件');
  eq(h.dbCalls.length, 1, '正しい署名：保存は 1 回');
  eq([h.dbCalls[0].table, h.dbCalls[0].opts], ['cp_events', { onConflict: 'dedupe_key', ignoreDuplicates: true }], '保存：cp_events へ・重複は無視');
  eq([h.dbCalls[0].rows.length, h.dbCalls[0].rows[0].history_id, h.dbCalls[0].rows[0].trade_no, h.dbCalls[0].rows[0].kind], [1, 'HIST-123', 'IMP_2026111000000001', 'report'], '保存：読み取った項目');
  eq(h.dbCalls[0].rows[0].payload, realistic, '保存：本文そのまま');

  // 署名の表現いろいろ
  const b = JSON.stringify(realistic), mac = hmac(SECRET, b);
  for (const [label, v] of [['sha256=hex', 'sha256=' + mac.toString('hex')], ['base64', mac.toString('base64')], ['sha256=base64', 'sha256=' + mac.toString('base64')]]) {
    h = load(mkEnv());
    eq((await call(h, post(b, { 'x-cyberport-signature-256': v }))).status, 200, '署名の表現：' + label);
  }

  // 署名が違う／無い → 401・保存しない・本文は記録しない
  warnings.length = 0;
  h = load(mkEnv());
  r = await call(h, signed(realistic, 'wrong-secret'));
  eq([r.status, r.j.error, h.dbCalls.length], [401, 'bad_signature', 0], '署名が違う → 401・保存しない');
  ok(!r.text.includes('HIST-123'), '401：本文の内容を返さない');
  ok(warnings.some((w) => w.includes('webhook_bad_signature') && w.includes('"hasHeader":true')), '401：理由を記録（ヘッダーの有無）');
  ok(warnings.every((w) => !w.includes('HIST-123') && !w.includes(SECRET)), '401：記録に本文・鍵を含めない');
  r = await call(h, post(JSON.stringify(realistic)));
  eq([r.status, h.dbCalls.length], [401, 0], '署名のヘッダーが無い → 401・保存しない');
  ok(warnings.some((w) => w.includes('"hasHeader":false')), '署名無し：記録にヘッダー無しと残る');
  r = await call(h, post(JSON.stringify(realistic), { 'x-cyberport-signature-256': '' }));
  eq(r.status, 401, '署名のヘッダーが空 → 401');
  // 本文を改ざんしたもの
  const good = JSON.stringify(realistic);
  r = await call(h, post(good.replace('HIST-123', 'HIST-999'), { 'x-cyberport-signature-256': hmac(SECRET, good).toString('hex') }));
  eq([r.status, h.dbCalls.length], [401, 0], '署名のあと本文を書き換えたもの → 401');

  // 不正な本文（署名は正しい）
  r = await call(h, signed('this is not json'));
  eq([r.status, r.j.error, h.dbCalls.length], [400, 'bad_json', 0], 'JSON でない → 400・保存しない');
  r = await call(h, signed('[]'));
  eq([r.status, r.j.error], [400, 'empty'], '空の配列 → 400');
  r = await call(h, signed('[1,"a",null]'));
  eq([r.status, r.j.error], [400, 'empty'], 'オブジェクトでないものだけ → 400');
  r = await call(h, signed('"just a string"'));
  eq(r.status, 400, '文字列だけ → 400');

  // 配列で届いた／多すぎる
  h = load(mkEnv());
  r = await call(h, signed([realistic, { notifyOperation: { historyId: 'H2' } }]));
  eq([r.status, r.j.received, h.dbCalls[0].rows.map((x) => x.history_id)], [200, 2, ['HIST-123', 'H2']], '配列で届いた通知は、全部保存する');
  h = load(mkEnv());
  r = await call(h, signed(Array.from({ length: 60 }, (_, i) => ({ notifyOperation: { historyId: 'H' + i } }))));
  eq([r.status, r.j.received], [200, 50], '60 件届いても、保存は最大 50 件');

  // 大きすぎる
  h = load(mkEnv());
  const big = JSON.stringify({ x: 'a'.repeat(262144) });
  r = await call(h, post(big, { 'content-length': String(big.length), 'x-cyberport-signature-256': hmac(SECRET, big).toString('hex') }));
  eq([r.status, r.j.error, h.dbCalls.length], [413, 'too_large', 0], '大きすぎる（ヘッダーで分かる）→ 413');
  const big2 = JSON.stringify({ x: 'a'.repeat(262144) });
  r = await call(h, signed(big2));
  eq([r.status, h.dbCalls.length], [413, 0], '大きすぎる（本文で分かる）→ 413・保存しない');
  const justOk = JSON.stringify({ notifyOperation: { historyId: 'H' }, pad: 'a'.repeat(200000) });
  r = await call(load(mkEnv()), signed(justOk));
  eq(r.status, 200, '上限以下の大きな本文は受け付ける');

  // 保存の失敗 → 500（サイバーポート側の再送に期待できる）・詳細は返さない
  errors.length = 0;
  h = load(mkEnv(), { dbError: { message: 'relation "cp_events" does not exist' } });
  r = await call(h, signed(realistic));
  eq([r.status, r.j.error], [500, 'store_failed'], '保存に失敗 → 500');
  ok(!r.text.includes('relation'), '500：DB のエラー内容は返さない');
  ok(errors.some((e) => e.includes('webhook_store_failed')), '500：理由を記録');
  ok(errors.every((e) => !e.includes(SECRET) && !e.includes('HIST-123')), '500：記録に鍵・本文を含めない');

  // 重複：同じ通知を 2 回 → どちらも 200 で、重複の印は同じ
  h = load(mkEnv());
  await call(h, signed(realistic)); await call(h, signed(realistic));
  eq([h.dbCalls.length, h.dbCalls[0].rows[0].dedupe_key === h.dbCalls[1].rows[0].dedupe_key], [2, true], '再送：同じ重複の印で保存を依頼（表の unique で 1 件になる）');

  // 鍵は呼び出しのたびに読む／引用符・空白は除く
  const env = mkEnv({ CP_WEBHOOK_SECRET: 'old-secret' });
  h = load(env);
  eq((await call(h, signed(realistic))).status, 401, '鍵を直す前：新しい鍵の署名は拒否');
  env.CP_WEBHOOK_SECRET = SECRET;
  eq((await call(h, signed(realistic))).status, 200, '鍵を直したあとの呼び出しから反映（再起動不要）');
  h = load(mkEnv({ CP_WEBHOOK_SECRET: ` "${SECRET}"\n` }));
  eq((await call(h, signed(realistic))).status, 200, '鍵の前後の引用符・空白・改行を除いて照合');

  // 成功時の記録に本文・鍵を含めない
  logs.length = 0;
  h = load(mkEnv()); await call(h, signed(realistic));
  ok(logs.some((l) => l.includes('webhook_stored')) && logs.every((l) => !l.includes('HIST-123') && !l.includes(SECRET) && !l.includes('ONEYTYO')), '成功：記録に件数と種類だけ（本文・鍵は含めない）');
}

console.log(`\ncp-webhook 試験：${pass} 件合格 / ${failN} 件失敗`);
process.exit(failN ? 1 : 0);
