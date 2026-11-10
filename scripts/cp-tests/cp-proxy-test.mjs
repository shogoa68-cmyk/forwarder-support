// cp-proxy（Supabase Edge Function）の試験。サイバーポートへは接続しない（通信は偽物に差し替える）。
// 使い方：node scripts/cp-tests/cp-proxy-test.mjs   （Node 22.13 以上）
//        CP_TARGET=single node scripts/cp-tests/cp-proxy-test.mjs   （貼り付け用の 1 枚版を試験）
//   ① logic.ts の純粋関数（許可リスト・クエリ・番号の正規化・応答の分類 など）
//   ② index.ts の入口を、Deno と fetch と Supabase を偽物にして動かす（認証・再試行・秘密が漏れないこと）
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/functions/cp-proxy');
const L = await import(path.join(dir, 'logic.ts'));

let pass = 0, failN = 0;
function ok(cond, name, extra = '') { if (cond) { pass++; } else { failN++; console.log('✗ NG:', name, extra); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, ' 実際=' + JSON.stringify(a) + ' 期待=' + JSON.stringify(b)); }

// ============ ① logic.ts ============
// 許可：読み取りの GET だけ
for (const p of [
  '/API/v2/Trades/Search', '/API/v2/Trades/Get/EXP_2026110100000001', '/API/v2/Trades/GetContainers/IMP_20261101',
  '/API/v2/Trades/Histories/GetList', '/API/v2/Trades/Histories/Get/abc-123',
  '/API/v2/Trades/Messages/GetDetails/abc-123', '/API/v2/Trades/Messages/GetHistories/abc-123',
  '/API/v2/ColinsViewers/GetImportContainers', '/API/v2/ColinsViewers/GetExportContainers',
  '/API/v2/ColinsViewers/GetImportVessels/JPTYO', '/API/v2/ColinsViewers/GetExportVessels/JPYOK',
]) ok(L.matchAllowed(p) !== null, '許可される: ' + p);
// 不許可：書き込み系・別の API・すり抜けの工夫
for (const p of [
  '/API/v2/Trades/Messages/Send', '/API/v2/Trades/Messages/Reply', '/API/v2/Trades/Messages/Edit/abc', '/API/v2/Trades/Messages/MarkAsDelete/abc',
  '/API/v2/Trades/Create', '/API/v2/Trades/Delete/EXP_1', '/API/v2/Trades/SetStatus/EXP_1', '/API/v2/Trades/Duplicate',
  '/API/v2/Webhooks/Register', '/API/v2/Organizations/UsedWebhooks/Delete/1', '/vendor-auth/token',
  '/API/v2/Trades/Get/../Delete/x', '/API/v2/Trades/Get/%2e%2e', '/API/v2/Trades/Get/a/b', '/API/v2/Trades/Search?x=1',
  '/API/v2/Trades/Get/', 'API/v2/Trades/Search', '/api/v2/trades/search', '', null, undefined, 123,
]) ok(L.matchAllowed(p) === null, '不許可: ' + String(p));
ok(L.ALLOWED_GET.every((a) => !/Send|Reply|Edit|Delete|Create|Register|Update|Set|Submit|Lock/.test(a.name)), '許可リストに書き込み系の名前が無い');

// クエリ
eq(L.buildQuery(undefined), { ok: true, qs: '' }, 'クエリなし');
eq(L.buildQuery({ blNo: 'ONEYTYOGF8748400', n: 5, f: true, e: '' }), { ok: true, qs: '?blNo=ONEYTYOGF8748400&n=5&f=true' }, 'クエリ：空は付けない');
eq(L.buildQuery({ blNoList: ['A', 'B'] }), { ok: true, qs: '?blNoList=A&blNoList=B' }, 'クエリ：配列は繰り返す');
eq(L.buildQuery({ keyword: 'a b&c=d' }).qs, '?keyword=a+b%26c%3Dd', 'クエリ：値は安全にエンコード');
ok(L.buildQuery({ 'a b': 1 }).ok === false, 'クエリ：不正なキー名');
ok(L.buildQuery({ a: { x: 1 } }).ok === false, 'クエリ：オブジェクトの値');
ok(L.buildQuery({ a: 'x'.repeat(201) }).ok === false, 'クエリ：長すぎる値');
ok(L.buildQuery([1, 2]).ok === false, 'クエリ：配列そのもの');

// 番号の正規化（検証シートの実例）
eq(L.normalizeNo('ONEY TYOGF8748400'), 'ONEYTYOGF8748400', '正規化：空白除去');
eq(L.normalizeNo(' ecu1 4089549　'), 'ECU14089549', '正規化：全角空白・小文字');
eq(L.normalizeNo('OCL1 HKG-H26OR1E'), 'OCL1HKG-H26OR1E', '正規化：ハイフンは残す');
eq(L.normalizeNo(null), '', '正規化：null');

// アクセス元（CORS）の読み方：貼り付けで混ざりがちな引用符・空白・末尾の / に強い
eq(L.parseOrigins('https://a.github.io'), ['https://a.github.io'], 'アクセス元：そのまま');
eq(L.parseOrigins(' https://a.github.io/ , "http://localhost:18765" '), ['https://a.github.io', 'http://localhost:18765'], 'アクセス元：空白・引用符・末尾の/を除く');
eq(L.parseOrigins('https://A.GitHub.io\nhttp://localhost:1'), ['https://a.github.io', 'http://localhost:1'], 'アクセス元：改行区切り・小文字化');
eq(L.parseOrigins('\u201chttps://a.github.io\u201d'), ['https://a.github.io'], 'アクセス元：全角の引用符');
eq(L.parseOrigins(undefined), [], 'アクセス元：未設定');
ok(L.isOriginAllowed('https://shogoa68-cmyk.github.io', ['https://shogoa68-cmyk.github.io']), 'アクセス元：一致');
ok(!L.isOriginAllowed('https://evil.example', ['https://shogoa68-cmyk.github.io']), 'アクセス元：リスト外は拒否');
ok(!L.isOriginAllowed('https://shogoa68-cmyk.github.io.evil.example', ['https://shogoa68-cmyk.github.io']), 'アクセス元：前方一致ではすり抜けられない');
ok(!L.isOriginAllowed('', ['https://a.github.io']), 'アクセス元：空は拒否');
ok(L.isOriginAllowed('http://localhost:18765', []) && !L.isOriginAllowed('https://a.github.io', []), 'アクセス元：未設定なら localhost だけ');

// トークンの有効期限
const now = 1_800_000_000_000;
eq(L.tokenExpiryMs('opaque-token', now), now + 300_000, '期限：JWT でなければ 5 分');
const mkJwt = (exp) => 'h.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.s';
eq(L.tokenExpiryMs(mkJwt(now / 1000 + 3600), now), now + 3_600_000 - 60_000, '期限：JWT の exp（1 分早め）');
eq(L.tokenExpiryMs(mkJwt(now / 1000 - 10), now), now + 300_000, '期限：すでに過去なら 5 分');

// 応答の分類
eq(L.classifyStatus(401).kind, 'upstream_auth', '分類 401'); eq(L.classifyStatus(403).kind, 'upstream_auth', '分類 403');
eq(L.classifyStatus(404).kind, 'not_found', '分類 404'); eq(L.classifyStatus(400).kind, 'bad_request', '分類 400');
eq([L.classifyStatus(429).kind, L.classifyStatus(429).retry], ['rate_limited', true], '分類 429（再試行）');
eq([L.classifyStatus(503).kind, L.classifyStatus(503).retry], ['upstream_error', true], '分類 503（再試行）');
eq(L.classifyStatus(404).retry, false, '404 は再試行しない');
ok(/ETA前/.test(L.classifyStatus(404).message), '404 の文言にETA前の可能性');
eq([L.backoffMs(0), L.backoffMs(1), L.backoffMs(2)], [500, 1000, 2000], '指数バックオフ');

// 呼び出し回数の制限
{
  const m = new Map(); let allowed = 0;
  for (let i = 0; i < 40; i++) if (L.allowRate(m, 'a@x', 1000 + i)) allowed++;
  eq(allowed, 30, '制限：1 分 30 回まで');
  ok(L.allowRate(m, 'b@x', 1000), '制限：別の人は影響しない');
  ok(L.allowRate(m, 'a@x', 1000 + 61_000), '制限：1 分たてば再開');
}

// ============ ② index.ts（偽の Deno / fetch / Supabase で動かす） ============
const SECRET = 'SUPER-SECRET-VALUE-12345';
const CID = 'client-id-abc';
const TOKEN = 'tok-xyz-789';

const warnings = [];
function makeEnv(extra = {}) {
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', CP_CLIENT_ID: CID, CP_CLIENT_SECRET: SECRET, ...extra };
  return env;
}

function load(env, fetchImpl, { member = true, user = 'taro@example.com' } = {}) {
  // CP_TARGET=single … ダッシュボード貼り付け用の 1 枚版（supabase/cp-proxy-single/index.ts）を試験する
  const entry = process.env.CP_TARGET === 'single' ? path.join(dir, '../../cp-proxy-single/index.ts') : path.join(dir, 'index.ts');
  const src = readFileSync(entry, 'utf8').replace(/^import .*$/gm, '');
  const js = stripTypeScriptTypes(src);
  let handler = null;
  const DenoFake = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  const createClient = () => ({
    auth: { getUser: async () => (user ? { data: { user: { email: user } }, error: null } : { data: null, error: { message: 'x' } }) },
    rpc: async () => ({ data: member, error: null }),
  });
  const fn = new Function('Deno', 'createClient', 'allowRate', 'backoffMs', 'buildQuery', 'classifyStatus', 'matchAllowed', 'tokenExpiryMs', 'truncate', 'isOriginAllowed', 'parseOrigins', 'fetch', 'setTimeout', 'console', js);
  const noWait = (cb) => { cb(); return 0; };
  fn(DenoFake, createClient, L.allowRate, L.backoffMs, L.buildQuery, L.classifyStatus, L.matchAllowed, L.tokenExpiryMs, L.truncate, L.isOriginAllowed, L.parseOrigins, fetchImpl, noWait, { log() {}, error() {}, warn(m) { warnings.push(String(m)); } });
  return handler;
}

const mkReq = (body, { auth = 'Bearer jwt', method = 'POST', origin = 'http://localhost:18765' } = {}) =>
  new Request('https://x.supabase.co/functions/v1/cp-proxy', {
    method, headers: { 'content-type': 'application/json', origin, ...(auth ? { authorization: auth } : {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
async function call(handler, body, opts) {
  const res = await handler(mkReq(body, opts));
  const text = await res.text();
  ok(!text.includes(SECRET), '応答に client_secret が含まれない（' + JSON.stringify(body).slice(0, 40) + '）');
  ok(!text.includes(TOKEN) || body.action === 'x', '応答にトークンが含まれない（' + JSON.stringify(body).slice(0, 40) + '）');
  let j = null; try { j = JSON.parse(text); } catch { /* 本文なし */ }
  return { status: res.status, j, res };
}
const R = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

// ---- 認証まわり
{
  const h = load(makeEnv(), async () => { throw new Error('通信されないはず'); });
  const o = await h(new Request('https://x/y', { method: 'OPTIONS', headers: { origin: 'http://localhost:18765' } }));
  eq(o.status, 204, 'OPTIONS は 204');
  eq(o.headers.get('access-control-allow-origin'), 'http://localhost:18765', 'CORS：localhost は許可');
  const o2 = await h(new Request('https://x/y', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  eq(o2.headers.get('access-control-allow-origin'), 'null', 'CORS：許可リスト外は通さない');
  eq((await call(h, { action: 'ping' }, { auth: '' })).status, 401, 'ログインなし → 401');
  const g = await h(mkReq({}, { method: 'GET' })); eq(g.status, 405, 'GET は 405');
}
{
  const h = load(makeEnv(), async () => { throw new Error('通信されないはず'); }, { member: false });
  eq((await call(h, { action: 'ping' })).status, 401, 'メンバーでない人 → 401');
  const h2 = load(makeEnv(), async () => { throw new Error('通信されないはず'); }, { user: null });
  eq((await call(h2, { action: 'ping' })).status, 401, '不正なトークン → 401');
}

// ---- CORS：公開サイトのアクセス元（実際に起きた不具合の再現）
{
  const PAGES = 'https://shogoa68-cmyk.github.io';
  const pre = (h, origin) => h(new Request('https://x/y', { method: 'OPTIONS', headers: { origin } }));
  // 正しく入っていれば許可
  let h = load(makeEnv({ CP_ALLOWED_ORIGINS: PAGES }), async () => { throw new Error('通信されないはず'); });
  eq((await pre(h, PAGES)).headers.get('access-control-allow-origin'), PAGES, 'CORS：公開サイトのアクセス元を許可');
  // 貼り付けの混入（引用符・空白・末尾の/・複数）でも許可
  for (const v of [`"${PAGES}"`, ` ${PAGES}/ `, `${PAGES}/,http://localhost:18765`, `'${PAGES}'\n`]) {
    h = load(makeEnv({ CP_ALLOWED_ORIGINS: v }), async () => { throw new Error('通信されないはず'); });
    eq((await pre(h, PAGES)).headers.get('access-control-allow-origin'), PAGES, 'CORS：貼り付けの混入に強い ' + JSON.stringify(v));
  }
  // 未設定：公開サイトは拒否（null）・理由をログに残す
  warnings.length = 0;
  h = load(makeEnv(), async () => { throw new Error('通信されないはず'); });
  eq((await pre(h, PAGES)).headers.get('access-control-allow-origin'), 'null', 'CORS：未設定なら公開サイトは拒否');
  ok(warnings.some((w) => w.includes('cors_blocked') && w.includes(PAGES)), 'CORS：拒否した理由（アクセス元）をログに残す');
  // 起動後に secrets を直しても、次の呼び出しから反映される
  const env = makeEnv(); h = load(env, async () => { throw new Error('通信されないはず'); });
  eq((await pre(h, PAGES)).headers.get('access-control-allow-origin'), 'null', 'CORS：直す前は拒否');
  env.CP_ALLOWED_ORIGINS = PAGES;
  eq((await pre(h, PAGES)).headers.get('access-control-allow-origin'), PAGES, 'CORS：直したあとの呼び出しから反映（再起動不要）');
  // 似たアドレスはすり抜けられない
  h = load(makeEnv({ CP_ALLOWED_ORIGINS: PAGES }), async () => { throw new Error('通信されないはず'); });
  eq((await pre(h, PAGES + '.evil.example')).headers.get('access-control-allow-origin'), 'null', 'CORS：似たアドレスは拒否');
}

// ---- 未設定
{
  const h = load(makeEnv({ CP_CLIENT_ID: '', CP_CLIENT_SECRET: '' }), async () => { throw new Error('通信されないはず'); });
  const r = await call(h, { action: 'ping' });
  eq([r.status, r.j.error], [503, 'cp_not_configured'], '未設定 → 503 cp_not_configured');
}

// ---- ping
{
  const calls = [];
  const h = load(makeEnv(), async (url, init) => { calls.push({ url: String(url), init }); return R(200, { token: TOKEN }); });
  const r = await call(h, { action: 'ping' });
  eq(r.status, 200, 'ping 成功'); eq(r.j.ok, true, 'ping ok');
  eq(calls.length, 1, 'ping：通信は 1 回（トークン取得のみ）');
  eq(calls[0].url, 'https://swagger.cyber-port.net/vendor-auth/token', 'ping：既定のトークン取得先（実際に確かめた取得口）');
  eq(JSON.parse(calls[0].init.body), { clientId: CID, clientSecret: SECRET }, 'ping：clientId / clientSecret を JSON で送る');
  eq([r.j.apiHost, r.j.tokenHost], ['api.cyber-port.net', 'swagger.cyber-port.net'], 'ping：API 接続先とトークン取得先のホスト名だけ返す');
  // CP_TOKEN_URL の上書き
  const calls2 = [];
  const h2 = load(makeEnv({ CP_TOKEN_URL: 'https://swagger.example/vendor-auth/token' }), async (u) => { calls2.push(String(u)); return R(200, { token: TOKEN }); });
  await call(h2, { action: 'ping' });
  eq(calls2[0], 'https://swagger.example/vendor-auth/token', 'CP_TOKEN_URL で取得先を変えられる');
}
// ping 失敗：取得先がウェブページだった（実際に起きた事象：200 の HTML）
{
  const html = () => new Response('<!DOCTYPE html><html lang="en"><head><!-- Global site tag (gtag.js) --></head></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  const h = load(makeEnv(), async () => html());
  const r = await call(h, { action: 'ping' });
  eq([r.status, r.j.error, r.j.upstreamStatus], [502, 'token_wrong_endpoint', 200], 'ping：取得先が HTML → token_wrong_endpoint');
  ok(/CP_TOKEN_URL/.test(r.j.message) && !/client_id/.test(r.j.message), 'ping：HTML のときは接続情報のせいにしない');
  const h2 = load(makeEnv(), async () => new Response('<html>', { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
  eq((await call(h2, { action: 'ping' })).j.error, 'token_wrong_endpoint', 'ping：content-type が違っても < で始まれば取得先違い');
}
// ping 失敗：偽のIDに対する実際の応答（problem+json の invalid_client）
{
  const h = load(makeEnv(), async () => new Response(JSON.stringify({ type: 'about:blank', title: 'Vendor authentication failed', status: 400, detail: 'invalid_client', instance: '/vendor-auth/token' }), { status: 400, headers: { 'content-type': 'application/problem+json' } }));
  const r = await call(h, { action: 'ping' });
  eq([r.status, r.j.error, r.j.upstreamStatus, r.j.detail], [502, 'token_failed', 400, 'invalid_client'], 'ping：invalid_client → token_failed');
  ok(/invalid_client/.test(r.j.message) && /同じ組/.test(r.j.message), 'ping：invalid_client の案内（同じ組か確認）');
}
// ping 失敗（接続情報が違う）
{
  const h = load(makeEnv(), async () => R(401, { detail: 'invalid client' }));
  const r = await call(h, { action: 'ping' });
  eq([r.status, r.j.error, r.j.upstreamStatus], [502, 'token_failed', 401], 'ping 失敗 → token_failed');
  ok(r.j.message.includes('client_id'), 'ping 失敗：確認すべき項目を案内');
  const h2 = load(makeEnv(), async () => { throw new Error('net'); });
  eq((await call(h2, { action: 'ping' })).j.error, 'token_network', 'ping：トークン取得先に届かない');
  const h3 = load(makeEnv(), async () => R(200, { notoken: 1 }));
  eq((await call(h3, { action: 'ping' })).j.error, 'token_failed', 'ping：token が無い応答');
}

// ---- get
{
  const calls = [];
  const h = load(makeEnv(), async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/vendor-auth/token')) return R(200, { token: TOKEN });
    return R(200, [{ tradeNo: 'EXP_1' }]);
  });
  const r = await call(h, { action: 'get', path: '/API/v2/Trades/Search', query: { blNo: 'ONEYTYOGF8748400' } });
  eq([r.status, r.j.ok, r.j.api, r.j.status], [200, true, 'Trades/Search', 200], 'get 成功');
  eq(r.j.data, [{ tradeNo: 'EXP_1' }], 'get：データを返す');
  const api = calls.find((c) => !c.url.endsWith('/vendor-auth/token'));
  eq(api.url, 'https://api.cyber-port.net/API/v2/Trades/Search?blNo=ONEYTYOGF8748400', 'get：URL（クエリ付き）');
  eq(api.init.method, 'GET', 'get：メソッドは GET');
  eq(api.init.headers['X-Authorization'], TOKEN, 'get：X-Authorization にトークン（Bearer なし）');
  // 2 回目はトークンを使い回す
  await call(h, { action: 'get', path: '/API/v2/Trades/Histories/GetList' });
  eq(calls.filter((c) => c.url.endsWith('/vendor-auth/token')).length, 1, 'トークンは使い回す（取得は 1 回だけ）');
}
// 許可されない API は、相手先に届かない
{
  let n = 0;
  const h = load(makeEnv(), async () => { n++; return R(200, { token: TOKEN }); });
  for (const p of ['/API/v2/Trades/Messages/Send', '/API/v2/Trades/Messages/Reply', '/API/v2/Trades/Delete/EXP_1', '/vendor-auth/token', '/API/v2/Trades/Get/../Delete/x']) {
    const r = await call(h, { action: 'get', path: p });
    eq([r.status, r.j.error], [403, 'path_not_allowed'], '拒否: ' + p);
  }
  eq(n, 0, '拒否した API では、相手先に一度も通信しない');
  eq((await call(h, { action: 'get', path: '/API/v2/Trades/Search', query: { 'a b': 1 } })).j.error, 'bad_query', '不正なクエリは拒否');
  eq((await call(h, { action: 'delete' })).j.error, 'bad_action', '不明な操作は拒否');
  eq(n, 0, '不正な要求でも、相手先に通信しない');
}
// 401 → トークンを取り直して 1 回やり直す
{
  const seq = []; let apiCalls = 0, tokCalls = 0;
  const h = load(makeEnv(), async (url) => {
    if (String(url).endsWith('/vendor-auth/token')) { tokCalls++; return R(200, { token: tokCalls === 1 ? 'old' : 'new' }); }
    apiCalls++; seq.push(apiCalls);
    return apiCalls === 1 ? R(401, { detail: 'expired' }) : R(200, { ok: 1 });
  });
  const r = await call(h, { action: 'get', path: '/API/v2/Trades/Search' }, {});
  eq([r.status, r.j.ok], [200, true], '401 → 取り直して成功');
  eq([tokCalls, apiCalls], [2, 2], '401：トークンを 1 回取り直し、API を 2 回呼ぶ');
}
// 5xx は最大 3 回まで再試行
{
  let api = 0;
  const h = load(makeEnv(), async (url) => String(url).endsWith('/vendor-auth/token') ? R(200, { token: TOKEN }) : (++api < 3 ? R(503, 'busy') : R(200, { done: true })));
  const r = await call(h, { action: 'get', path: '/API/v2/Trades/Search' });
  eq([r.status, r.j.ok, api], [200, true, 3], '503 が 2 回続いても、3 回目で成功');
}
{
  let api = 0;
  const h = load(makeEnv(), async (url) => String(url).endsWith('/vendor-auth/token') ? R(200, { token: TOKEN }) : (api++, R(500, 'boom')));
  const r = await call(h, { action: 'get', path: '/API/v2/Trades/Search' });
  eq([r.status, r.j.error, r.j.upstreamStatus, api], [502, 'upstream_error', 500, 3], '500 が続く → 3 回で諦めて upstream_error');
}
// 404 は再試行しない・ブラウザが「関数が無い」と取り違えない（502）
{
  let api = 0;
  const h = load(makeEnv(), async (url) => String(url).endsWith('/vendor-auth/token') ? R(200, { token: TOKEN }) : (api++, R(404, { detail: 'none' })));
  const r = await call(h, { action: 'get', path: '/API/v2/Trades/Get/EXP_9' });
  eq([r.status, r.j.error, r.j.upstreamStatus, api], [502, 'not_found', 404, 1], '404 → 再試行せず not_found（HTTP は 502）');
}
// 403・通信エラー・大きすぎる応答
{
  const h = load(makeEnv(), async (url) => String(url).endsWith('/vendor-auth/token') ? R(200, { token: TOKEN }) : R(403, { detail: 'forbidden' }));
  const r = await call(h, { action: 'get', path: '/API/v2/Trades/Search' });
  eq([r.status, r.j.error, r.j.upstreamStatus], [502, 'upstream_auth', 403], '403 → upstream_auth');
  let api = 0;
  const h2 = load(makeEnv(), async (url) => { if (String(url).endsWith('/vendor-auth/token')) return R(200, { token: TOKEN }); api++; throw new Error('net'); });
  const r2 = await call(h2, { action: 'get', path: '/API/v2/Trades/Search' });
  eq([r2.j.error, api], ['upstream_network', 3], '通信エラー → 3 回再試行して upstream_network');
  const h3 = load(makeEnv(), async (url) => String(url).endsWith('/vendor-auth/token') ? R(200, { token: TOKEN }) : R(200, 'x'.repeat(1_000_001)));
  eq((await call(h3, { action: 'get', path: '/API/v2/Trades/Search' })).j.error, 'too_large', '大きすぎる応答は返さない');
}
// 呼び出し回数の制限（30 回/分）
{
  const h = load(makeEnv(), async (url) => String(url).endsWith('/vendor-auth/token') ? R(200, { token: TOKEN }) : R(200, []));
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await call(h, { action: 'get', path: '/API/v2/Trades/Search' })).status;
  eq(last, 429, '1 分に 30 回を超えると 429');
}

console.log(`\ncp-proxy 試験：${pass} 件合格 / ${failN} 件失敗`);
process.exit(failN ? 1 : 0);
