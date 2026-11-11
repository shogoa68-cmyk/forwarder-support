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
const WT = await import(path.join(dir, 'watch.ts'));

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
  '/API/v2/Terminals/GetList', '/API/v2/Terminals/Get/TYOAJ00C',
  '/API/v2/Master/NotifiableOperations/GetList', '/API/v2/Master/NotifiableOperations/Get/OP-001',
]) ok(L.matchAllowed(p) !== null, '許可される: ' + p);
// 不許可：書き込み系・別の API・すり抜けの工夫
for (const p of [
  '/API/v2/Trades/Messages/Send', '/API/v2/Trades/Messages/Reply', '/API/v2/Trades/Messages/Edit/abc', '/API/v2/Trades/Messages/MarkAsDelete/abc',
  '/API/v2/Trades/Create', '/API/v2/Trades/Delete/EXP_1', '/API/v2/Trades/SetStatus/EXP_1', '/API/v2/Trades/Duplicate',
  '/API/v2/Webhooks/Register', '/API/v2/Organizations/UsedWebhooks/Delete/1', '/vendor-auth/token',
  '/API/v2/Trades/Get/../Delete/x', '/API/v2/Trades/Get/%2e%2e', '/API/v2/Trades/Get/a/b', '/API/v2/Trades/Search?x=1',
  '/API/v2/Trades/Get/', 'API/v2/Trades/Search', '/api/v2/trades/search', '', null, undefined, 123,
  '/API/v2/Terminals/VesselSchedules/GetList', '/API/v2/Terminals/VesselSchedules/Register', '/API/v2/Terminals/DemurrageSettings/GetList',
  '/API/v2/Terminals/GateOpenWindows/GetList/JPTYO', '/API/v2/Terminals/TerminalNotices/GetList', '/API/v2/Terminals/Register', '/API/v2/Terminals/GetList/x',
  // Webhook の設定は、シークレットトークンが返るので許可しない（登録・更新・削除も当然ふくむ）
  '/API/v2/Webhooks/GetList', '/API/v2/Webhooks/Get/W1', '/API/v2/Webhooks/Register', '/API/v2/Webhooks/Update/W1', '/API/v2/Webhooks/Delete/W1',
  '/API/v2/Organizations/UsedWebhooks/GetList', '/API/v2/Organizations/UsedWebhooks/Get/U1', '/API/v2/Organizations/UsedWebhooks/Register',
  '/API/v2/Organizations/UsedWebhooks/NotifyOperations/GetList/U1', '/API/v2/Organizations/UsedWebhooks/NotifyOperations/Register',
  '/API/v2/Master/NotifiableOperations/Register', '/API/v2/Master/NotifiableOperations/GetList/x',
  '/API/v2/Trades/Histories/GetNotifyOperationByWebhooksAdmin/H1', '/API/v2/Trades/Histories/MarkAsRead',
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

// 接続設定（本番／検証環境・公式の既定値）
{
  const mk = (o) => L.resolveConfig((k) => o[k]);
  const p = mk({});
  eq([p.env, p.base, p.clientTokenUrl], ['production', 'https://api.cyber-port.net', 'https://api.cyber-port.net/Token'], '設定：本番の既定（接続先・システム用トークンの取得先）');
  eq(p.openidUrl, 'https://mlitcyberport.b2clogin.com/mlitcyberport.onmicrosoft.com/oauth2/v2.0/token?p=b2c_1_cyberport_ropc_auth', '設定：本番の利用者トークン取得先（B2C）');
  eq(p.openidScope, 'openid https://mlitcyberport.onmicrosoft.com/cyberport.api/read', '設定：スコープの既定は読み取り（read）だけ');
  ok(!/write/.test(p.openidScope), '設定：既定のスコープに write を含まない');
  const sb = mk({ CP_ENV: ' Sandbox ' });
  eq([sb.env, sb.base, sb.clientTokenUrl], ['sandbox', 'https://api-sandbox.cyber-port.net', 'https://api-sandbox.cyber-port.net/Token'], '設定：検証環境（CP_ENV=sandbox）の接続先');
  eq(sb.openidUrl, 'https://mlitcyberport.b2clogin.com/mlitcyberport.onmicrosoft.com/oauth2/v2.0/token?p=b2c_1_sandboxcp_ropc_auth', '設定：検証環境の利用者トークン取得先');
  eq(sb.openidScope, 'openid https://mlitcyberport.onmicrosoft.com/sandboxcp.api/read', '設定：検証環境のスコープ（read）');
  eq(mk({ CP_ENV: 'nonsense' }).env, 'production', '設定：sandbox 以外の値は本番の既定（検証環境の ID を本番へ送っても、認証で弾かれるだけ）');
  const ov = mk({ CP_BASE_URL: 'https://x.example/', CP_TOKEN_URL: 'https://t.example/vendor-auth/token', CP_OPENID_URL: 'https://o.example/tok', CP_OPENID_SCOPE: 'openid a b' });
  eq([ov.base, ov.clientTokenUrl, ov.openidUrl, ov.openidScope], ['https://x.example', 'https://t.example/vendor-auth/token', 'https://o.example/tok', 'openid a b'], '設定：個別に上書きできる（末尾の/は除く）');
  eq(mk({ CP_BASE_URL: 'https://x.example', CP_ENV: 'sandbox' }).clientTokenUrl, 'https://x.example/Token', '設定：接続先を上書きするとシステム用トークンの取得先も追従');
  const q = mk({ CP_CLIENT_ID: ' "abc" ', CP_CLIENT_SECRET: "'sec'\n", CP_APP_ID: '“appid”', CP_USER_EMAIL: ' a@b.c ', CP_USER_PASSWORD: '  pa ss"w\'d\r\n' });
  eq([q.clientId, q.clientSecret, q.appId, q.userEmail], ['abc', 'sec', 'appid', 'a@b.c'], '設定：ID・メールの前後の空白と引用符を除く');
  eq(q.userPassword, 'pa ss"w\'d', '設定：パスワードは前後の空白だけ除く（中の空白・引用符は残す）');
}
// フォーム本文・トークン応答
eq(L.formBody({ grant_type: 'password', scope: 'openid https://a/b', password: 'p&=+ %' }), 'grant_type=password&scope=openid+https%3A%2F%2Fa%2Fb&password=p%26%3D%2B+%25', 'フォーム本文：記号を正しくエンコード');
eq(new URLSearchParams(L.formBody({ response_type: 'token id_token' })).get('response_type'), 'token id_token', 'フォーム本文：戻すと元の値');
{
  const t0 = 1_800_000_000_000;
  eq(L.tokenFromResponse({ access_token: 'A', expires_in: 3600 }, t0), { token: 'A', exp: t0 + 3_540_000 }, 'トークン応答：access_token と expires_in（1分早め）');
  eq(L.tokenFromResponse({ access_token: 'A', expires_in: '3600' }, t0)?.exp, t0 + 3_540_000, 'トークン応答：expires_in が文字列でも');
  eq(L.tokenFromResponse({ access_token: 'A', expires_in: 30 }, t0)?.exp, t0 + 15_000, 'トークン応答：短い期限は半分に');
  eq(L.tokenFromResponse({ token: 'T' }, t0), { token: 'T', exp: t0 + 300_000 }, 'トークン応答：旧来の token・期限なしは5分');
  eq(L.tokenFromResponse({ access_token: '' }, t0), null, 'トークン応答：空は失敗');
  eq(L.tokenFromResponse({}, t0), null, 'トークン応答：何も無ければ失敗');
}

// ============ ② index.ts（偽の Deno / fetch / Supabase で動かす） ============
const SECRET = 'SUPER-SECRET-VALUE-12345';
const CID = 'client-id-abc';
const CTOK = 'client-token-AAA';
const UTOK = 'user-token-BBB';
const PASS = 'p@ss word&1';
const APPID = 'app-id-123';
const EMAIL = 'bridge@example.com';

const warnings = [];
function makeEnv(extra = {}) {
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', CP_CLIENT_ID: CID, CP_CLIENT_SECRET: SECRET, CP_APP_ID: APPID, CP_USER_EMAIL: EMAIL, CP_USER_PASSWORD: PASS, ...extra };
  return env;
}

function load(env, fetchImpl, { member = true, user = 'taro@example.com', sb = null } = {}) {
  // CP_TARGET=single … ダッシュボード貼り付け用の 1 枚版（supabase/cp-proxy-single/index.ts）を試験する
  const entry = process.env.CP_TARGET === 'single' ? path.join(dir, '../../cp-proxy-single/index.ts') : path.join(dir, 'index.ts');
  const src = readFileSync(entry, 'utf8').replace(/^import .*$/gm, '');
  const js = stripTypeScriptTypes(src);
  let handler = null;
  const DenoFake = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  const createClient = (_url, key) => (key === 'SERVICE-KEY-123' && sb) ? sb : ({
    auth: { getUser: async () => (user ? { data: { user: { email: user } }, error: null } : { data: null, error: { message: 'x' } }) },
    rpc: async () => ({ data: member, error: null }),
  });
  const fn = new Function('Deno', 'createClient', 'safeEqual', 'runWatchBatch', 'allowRate', 'backoffMs', 'buildQuery', 'classifyStatus', 'matchAllowed', 'truncate', 'isOriginAllowed', 'parseOrigins', 'formBody', 'resolveConfig', 'tokenFromResponse', 'fetch', 'setTimeout', 'console', js);
  const noWait = (cb) => { cb(); return 0; };
  fn(DenoFake, createClient, L.safeEqual, WT.runWatchBatch, L.allowRate, L.backoffMs, L.buildQuery, L.classifyStatus, L.matchAllowed, L.truncate, L.isOriginAllowed, L.parseOrigins, L.formBody, L.resolveConfig, L.tokenFromResponse, fetchImpl, noWait, { log() {}, error() {}, warn(m) { warnings.push(String(m)); } });
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
  const tag = JSON.stringify(body).slice(0, 40);
  ok(!text.includes(SECRET), '応答に client_secret が含まれない（' + tag + '）');
  ok(!text.includes(PASS) && !text.includes(encodeURIComponent(PASS)), '応答にパスワードが含まれない（' + tag + '）');
  ok(!text.includes(CTOK) && !text.includes(UTOK), '応答にトークンが含まれない（' + tag + '）');
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

// ---- 偽のネットワーク（システム用トークン・B2C・API を見分けて返す）
const isClientTok = (u) => u.endsWith('/Token') || u.endsWith('/vendor-auth/token');
const isUserTok = (u) => u.includes('b2clogin.com');
function net(h = {}) {
  const calls = [];
  const f = async (url, init) => {
    const u = String(url); calls.push({ url: u, init });
    if (isClientTok(u)) return (h.client || (() => R(200, { access_token: CTOK, expires_in: 3600 })))(init, u);
    if (isUserTok(u)) return (h.user || (() => R(200, { access_token: UTOK, expires_in: 3600, token_type: 'Bearer' })))(init, u);
    return (h.api || (() => R(200, [])))(init, u);
  };
  f.calls = calls;
  f.api = () => calls.filter((c) => !isClientTok(c.url) && !isUserTok(c.url));
  f.client = () => calls.filter((c) => isClientTok(c.url));
  f.user = () => calls.filter((c) => isUserTok(c.url));
  return f;
}
const form = (init) => Object.fromEntries(new URLSearchParams(String(init.body)));

// ---- 未設定
{
  let f = net();
  let h = load(makeEnv({ CP_CLIENT_ID: '', CP_CLIENT_SECRET: '' }), f);
  let r = await call(h, { action: 'ping' });
  eq([r.status, r.j.error, f.calls.length], [503, 'cp_not_configured', 0], '未設定（システム用）→ 503 cp_not_configured・通信しない');
  f = net();
  h = load(makeEnv({ CP_APP_ID: '', CP_USER_EMAIL: '', CP_USER_PASSWORD: '' }), f);
  r = await call(h, { action: 'ping' });
  eq([r.status, r.j.error], [503, 'cp_user_not_configured'], '未設定（API接続用ユーザー）→ 503 cp_user_not_configured');
  ok(/CP_APP_ID/.test(r.j.message) && /CP_USER_EMAIL/.test(r.j.message) && /CP_USER_PASSWORD/.test(r.j.message), '未設定：足りない項目名を案内');
  for (const k of ['CP_APP_ID', 'CP_USER_EMAIL', 'CP_USER_PASSWORD']) {
    h = load(makeEnv({ [k]: '' }), net());
    eq((await call(h, { action: 'ping' })).j.error, 'cp_user_not_configured', '未設定：1 つでも欠ければ未設定扱い ' + k);
  }
}

// ---- ping（2 つのトークンを、公式の方法で取る）
{
  const f = net();
  const h = load(makeEnv(), f);
  const r = await call(h, { action: 'ping' });
  eq([r.status, r.j.ok, r.j.env], [200, true, 'production'], 'ping 成功（本番）');
  eq(f.calls.length, 2, 'ping：通信は 2 回（システム用トークン＋利用者トークン）。API は呼ばない');
  const c = f.client()[0], u = f.user()[0];
  eq(c.url, 'https://api.cyber-port.net/Token', 'システム用トークン：公式の取得先');
  eq(c.init.method, 'POST', 'システム用トークン：POST');
  eq(c.init.headers['Content-Type'], 'application/x-www-form-urlencoded', 'システム用トークン：form 形式');
  eq(form(c.init), { grant_type: 'client_credentials', client_id: CID, client_secret: SECRET }, 'システム用トークン：本文（client_credentials）');
  eq(u.url, 'https://mlitcyberport.b2clogin.com/mlitcyberport.onmicrosoft.com/oauth2/v2.0/token?p=b2c_1_cyberport_ropc_auth', '利用者トークン：公式の取得先（B2C・本番）');
  eq(u.init.headers['Content-Type'], 'application/x-www-form-urlencoded', '利用者トークン：form 形式');
  eq(form(u.init), { grant_type: 'password', client_id: APPID, username: EMAIL, password: PASS, response_type: 'token id_token', scope: 'openid https://mlitcyberport.onmicrosoft.com/cyberport.api/read' },
    '利用者トークン：本文（password・アプリケーションID・メール・パスワード・読み取りスコープだけ）');
  eq([r.j.apiHost, r.j.tokenHost, r.j.openidHost], ['api.cyber-port.net', 'api.cyber-port.net', 'mlitcyberport.b2clogin.com'], 'ping：ホスト名だけ返す');
}
// 検証環境（CP_ENV=sandbox）
{
  const f = net();
  const h = load(makeEnv({ CP_ENV: 'sandbox' }), f);
  const r = await call(h, { action: 'ping' });
  eq(r.j.env, 'sandbox', 'ping：検証環境');
  eq(f.client()[0].url, 'https://api-sandbox.cyber-port.net/Token', '検証環境：システム用トークンの取得先');
  eq(f.user()[0].url, 'https://mlitcyberport.b2clogin.com/mlitcyberport.onmicrosoft.com/oauth2/v2.0/token?p=b2c_1_sandboxcp_ropc_auth', '検証環境：利用者トークンの取得先');
  eq(form(f.user()[0].init).scope, 'openid https://mlitcyberport.onmicrosoft.com/sandboxcp.api/read', '検証環境：スコープ');
  await call(h, { action: 'get', path: '/API/v2/Trades/Search' });
  eq(f.api()[0].url, 'https://api-sandbox.cyber-port.net/API/v2/Trades/Search', '検証環境：API の接続先');
}
// 貼り付けの混入・スコープの上書き・旧来の取得口
{
  const f = net();
  const h = load(makeEnv({ CP_CLIENT_ID: ` "${CID}" `, CP_USER_EMAIL: ` ${EMAIL}\n`, CP_USER_PASSWORD: PASS + '\r\n', CP_OPENID_SCOPE: 'openid https://x/read https://x/write' }), f);
  await call(h, { action: 'ping' });
  eq(form(f.client()[0].init).client_id, CID, '混入：ID の引用符・空白を除く');
  eq(form(f.user()[0].init).username, EMAIL, '混入：メールの空白を除く');
  eq(form(f.user()[0].init).password, PASS, '混入：パスワードの末尾の改行を除く・中の空白は残す');
  eq(form(f.user()[0].init).scope, 'openid https://x/read https://x/write', 'CP_OPENID_SCOPE で、スコープを上書きできる');
}
{
  const f = net({ client: () => R(200, { token: CTOK }) });
  const h = load(makeEnv({ CP_TOKEN_URL: 'https://swagger.cyber-port.net/vendor-auth/token' }), f);
  const r = await call(h, { action: 'ping' });
  eq(r.status, 200, '旧来の取得口（vendor-auth/token）でも取れる');
  eq([f.client()[0].init.headers['Content-Type'], JSON.parse(f.client()[0].init.body)], ['application/json', { clientId: CID, clientSecret: SECRET }], '旧来の取得口：JSON（clientId / clientSecret）で送る');
  await call(h, { action: 'get', path: '/API/v2/Trades/Search' });
  eq(f.api()[0].init.headers['X-Authorization'], CTOK, '旧来の取得口：token をそのまま X-Authorization に使う');
}

// ---- ping 失敗（システム用トークン）
{
  const html = () => new Response('<!DOCTYPE html><html lang="en"><head><!-- Global site tag (gtag.js) --></head></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  let r = await call(load(makeEnv(), net({ client: html })), { action: 'ping' });
  eq([r.status, r.j.error, r.j.upstreamStatus], [502, 'token_wrong_endpoint', 200], 'システム用：取得先が HTML → token_wrong_endpoint');
  ok(/CP_TOKEN_URL/.test(r.j.message) && !/client_id/.test(r.j.message), 'システム用：HTML のときは接続情報のせいにしない');
  r = await call(load(makeEnv(), net({ client: () => new Response('<html>', { status: 200, headers: { 'content-type': 'application/octet-stream' } }) })), { action: 'ping' });
  eq(r.j.error, 'token_wrong_endpoint', 'システム用：content-type が違っても < で始まれば取得先違い');
  for (const body of [{ detail: 'invalid_client' }, { error: 'invalid_client' }]) {
    r = await call(load(makeEnv(), net({ client: () => new Response(JSON.stringify(body), { status: 400, headers: { 'content-type': 'application/problem+json' } }) })), { action: 'ping' });
    eq([r.status, r.j.error, r.j.upstreamStatus], [502, 'token_failed', 400], 'システム用：invalid_client → token_failed ' + JSON.stringify(body));
    ok(/invalid_client/.test(r.j.message) && /同じ組/.test(r.j.message), 'システム用：invalid_client の案内');
  }
  r = await call(load(makeEnv(), net({ client: () => R(401, { detail: 'invalid client' }) })), { action: 'ping' });
  eq([r.j.error, r.j.upstreamStatus], ['token_failed', 401], 'システム用：401 → token_failed');
  r = await call(load(makeEnv(), net({ client: () => R(200, { notoken: 1 }) })), { action: 'ping' });
  eq(r.j.error, 'token_failed', 'システム用：token が無い応答');
  r = await call(load(makeEnv(), async () => { throw new Error('net'); }), { action: 'ping' });
  eq(r.j.error, 'token_network', 'システム用：取得先に届かない');
}
// ---- ping 失敗（利用者トークン：B2C）
{
  const f = net({ user: () => R(400, { error: 'invalid_grant', error_description: `AADB2C90225: The username or password provided in the request are invalid.\r\nCorrelation ID: abc\r\nTimestamp: 2026-11-10` }) });
  const h = load(makeEnv(), f);
  let r = await call(h, { action: 'ping' });
  eq([r.status, r.j.error, r.j.upstreamStatus], [502, 'user_token_failed', 400], '利用者：パスワード違い → user_token_failed');
  ok(/invalid_grant/.test(r.j.detail) && /AADB2C90225/.test(r.j.detail), '利用者：相手先の理由（error と AADB2C の番号）を詳細に出す');
  ok(!/Correlation/.test(r.j.detail), '利用者：説明は 1 行目だけ（追跡番号などは出さない）');
  ok(/アプリケーションID/.test(r.j.message) && /パスワード/.test(r.j.message), '利用者：確認すべき項目を案内');
  r = await call(load(makeEnv(), net({ user: () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }) })), { action: 'ping' });
  eq(r.j.error, 'user_token_wrong_endpoint', '利用者：取得先が HTML');
  r = await call(load(makeEnv(), net({ user: () => { throw new Error('net'); } })), { action: 'ping' });
  eq(r.j.error, 'user_token_network', '利用者：取得先に届かない');
  // 利用者トークンが取れなければ、API は呼ばない
  const f2 = net({ user: () => R(400, { error: 'invalid_grant' }) });
  r = await call(load(makeEnv(), f2), { action: 'get', path: '/API/v2/Trades/Search' });
  eq([r.j.error, f2.api().length], ['user_token_failed', 0], '利用者トークンが取れなければ、API は呼ばない');
}

// ---- get（2 つのヘッダー）
{
  const f = net({ api: () => R(200, [{ tradeNo: 'EXP_1' }]) });
  const h = load(makeEnv(), f);
  const r = await call(h, { action: 'get', path: '/API/v2/Trades/Search', query: { blNo: 'ONEYTYOGF8748400' } });
  eq([r.status, r.j.ok, r.j.api, r.j.status], [200, true, 'Trades/Search', 200], 'get 成功');
  eq(r.j.data, [{ tradeNo: 'EXP_1' }], 'get：データを返す');
  const api = f.api()[0];
  eq(api.url, 'https://api.cyber-port.net/API/v2/Trades/Search?blNo=ONEYTYOGF8748400', 'get：URL（クエリ付き）');
  eq(api.init.method, 'GET', 'get：メソッドは GET');
  eq(api.init.headers['X-Authorization'], CTOK, 'get：X-Authorization にシステム用トークン（Bearer なし）');
  eq(api.init.headers['Authorization'], 'Bearer ' + UTOK, 'get：Authorization に「Bearer ＋ 空白 1 つ ＋ 利用者トークン」');
  await call(h, { action: 'get', path: '/API/v2/Trades/Histories/GetList' });
  eq([f.client().length, f.user().length], [1, 1], 'トークンは使い回す（どちらも取得は 1 回だけ）');
}
// 許可されない API は、相手先に届かない
{
  const f = net();
  const h = load(makeEnv(), f);
  for (const p of ['/API/v2/Trades/Messages/Send', '/API/v2/Trades/Messages/Reply', '/API/v2/Trades/Delete/EXP_1', '/vendor-auth/token', '/Token', '/API/v2/Trades/Get/../Delete/x']) {
    const r = await call(h, { action: 'get', path: p });
    eq([r.status, r.j.error], [403, 'path_not_allowed'], '拒否: ' + p);
  }
  eq((await call(h, { action: 'get', path: '/API/v2/Trades/Search', query: { 'a b': 1 } })).j.error, 'bad_query', '不正なクエリは拒否');
  eq((await call(h, { action: 'delete' })).j.error, 'bad_action', '不明な操作は拒否');
  eq(f.calls.length, 0, '拒否・不正な要求では、相手先に一度も通信しない（トークンも取らない）');
}
// 401 → 2 つのトークンを取り直して 1 回だけやり直す
{
  let n = 0;
  const f = net({
    client: () => R(200, { access_token: 'c' + (++n), expires_in: 3600 }),
    api: (init) => (init.headers['X-Authorization'] === 'c1' ? R(401, { detail: 'expired' }) : R(200, { ok: 1 })),
  });
  const r = await call(load(makeEnv(), f), { action: 'get', path: '/API/v2/Trades/Search' });
  eq([r.status, r.j.ok], [200, true], '401 → 取り直して成功');
  eq([f.client().length, f.user().length, f.api().length], [2, 2, 2], '401：トークンを両方取り直し、API を 2 回呼ぶ');
}
// 5xx は最大 3 回まで再試行
{
  let api = 0;
  const f = net({ api: () => (++api < 3 ? R(503, 'busy') : R(200, { done: true })) });
  const r = await call(load(makeEnv(), f), { action: 'get', path: '/API/v2/Trades/Search' });
  eq([r.status, r.j.ok, api], [200, true, 3], '503 が 2 回続いても、3 回目で成功');
  eq([f.client().length, f.user().length], [1, 1], '再試行でもトークンは取り直さない');
}
{
  const f = net({ api: () => R(500, 'boom') });
  const r = await call(load(makeEnv(), f), { action: 'get', path: '/API/v2/Trades/Search' });
  eq([r.status, r.j.error, r.j.upstreamStatus, f.api().length], [502, 'upstream_error', 500, 3], '500 が続く → 3 回で諦めて upstream_error');
}
// 404 は再試行しない・ブラウザが「関数が無い」と取り違えない（502）
{
  const f = net({ api: () => R(404, { detail: 'none' }) });
  const r = await call(load(makeEnv(), f), { action: 'get', path: '/API/v2/Trades/Get/EXP_9' });
  eq([r.status, r.j.error, r.j.upstreamStatus, f.api().length], [502, 'not_found', 404, 1], '404 → 再試行せず not_found（HTTP は 502）');
}
// 403・通信エラー・大きすぎる応答
{
  const r = await call(load(makeEnv(), net({ api: () => R(403, { detail: 'forbidden' }) })), { action: 'get', path: '/API/v2/Trades/Search' });
  eq([r.status, r.j.error, r.j.upstreamStatus], [502, 'upstream_auth', 403], '403 → upstream_auth');
  let api = 0;
  const r2 = await call(load(makeEnv(), net({ api: () => { api++; throw new Error('net'); } })), { action: 'get', path: '/API/v2/Trades/Search' });
  eq([r2.j.error, api], ['upstream_network', 3], '通信エラー → 3 回再試行して upstream_network');
  const r3 = await call(load(makeEnv(), net({ api: () => R(200, 'x'.repeat(1_000_001)) })), { action: 'get', path: '/API/v2/Trades/Search' });
  eq(r3.j.error, 'too_large', '大きすぎる応答は返さない');
}
// 呼び出し回数の制限（30 回/分）
{
  const h = load(makeEnv(), net());
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await call(h, { action: 'get', path: '/API/v2/Trades/Search' })).status;
  eq(last, 429, '1 分に 30 回を超えると 429');
}


// ---- 予約実行（動静の自動確認・合言葉つきの入口）
{
  const WS = 'watch-secret-0123456789-abcdefghij';   // 24 文字以上
  const SK = 'SERVICE-KEY-123';
  const NOW = Date.now();
  const impRec = { terminalCode: 'T1', container: { containerNo: 'ABCD1234567' }, outboundAvailability: true,
    loadedContainerPickup: { dueAt: new Date(NOW + 5 * 86400000).toISOString() }, emptyContainerReturn: { actualAt: null },
    vessel: { vesselName: 'EVER TEST', voyageNo: '12E', portOfDischarge: { portCode: 'JPTYO', portName: 'TOKYO', estimatedTimeOfArrival: new Date(NOW - 86400000).toISOString() } } };
  function mkSb(st) {
    const q = (t) => ({
      insert(rows) {
        st.inserts.push([t, rows]);
        const o = { select: () => ({ single: async () => (st.noTables ? { data: null, error: { message: 'relation does not exist' } } : { data: { id: 77 }, error: null }) }), then: (res) => res({ error: st.insertError || null }) };
        return o;
      },
      update(u) { st.updates.push([t, u]); return { eq: async (c, v) => { st.eqs.push([t, c, v]); return { error: st.updateError || null }; } }; },
    });
    return { from: q, rpc: async (name, a) => { st.rpcs.push([name, a]); return name === 'cp_watch_pick' ? (st.pickError ? { data: null, error: { message: 'x' } } : { data: st.targets, error: null }) : { data: true, error: null }; } };
  }
  const st0 = () => ({ inserts: [], updates: [], eqs: [], rpcs: [], targets: [{ preset_id: 'p1', direction: 'import', bl_no: 'BL1', booking_no: null, container_nos: [], snapshot: null, consecutive_errors: 1, state: 'active' }] });
  const wreq = (body, { secret = WS, auth = 'Bearer anon' } = {}) =>
    new Request('https://x.supabase.co/functions/v1/cp-proxy', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}), ...(secret === null ? {} : { 'x-cp-watch-secret': secret }) }, body: JSON.stringify(body) });
  const runW = async (h, body, o) => { const res = await h(wreq(body, o)); const text = await res.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ } return { status: res.status, j, text }; };

  // 合言葉：なし・違う・短い・未設定は通さない
  let st = st0();
  let f = net({ api: () => R(200, [impRec]) });
  let h = load(makeEnv({ CP_WATCH_SECRET: WS, SUPABASE_SERVICE_ROLE_KEY: SK }), f, { sb: mkSb(st) });
  eq((await runW(h, { action: 'watch_run' }, { secret: 'wrong-secret-0123456789-abcdefghij' })).status, 401, '予約実行：合言葉が違う → 401');
  eq((await runW(h, { action: 'watch_run' }, { secret: '' })).status, 401, '予約実行：合言葉が空 → 401');
  eq(f.calls.length + st.rpcs.length + st.inserts.length, 0, '予約実行：合言葉が違うときは何も通信・保存しない');
  h = load(makeEnv({ SUPABASE_SERVICE_ROLE_KEY: SK }), f, { sb: mkSb(st) });
  eq((await runW(h, { action: 'watch_run' }, { secret: 'anything-long-enough-0123456789' })).status, 401, '予約実行：合言葉が未設定なら無効（401）');
  h = load(makeEnv({ CP_WATCH_SECRET: 'short', SUPABASE_SERVICE_ROLE_KEY: SK }), f, { sb: mkSb(st) });
  eq((await runW(h, { action: 'watch_run' }, { secret: 'short' })).status, 401, '予約実行：短すぎる合言葉は受け付けない（401）');
  h = load(makeEnv({ CP_WATCH_SECRET: WS, SUPABASE_SERVICE_ROLE_KEY: SK }), f, { sb: mkSb(st) });
  // ログイン中の人は、合言葉なしでは watch_run を使えない
  const lr = await call(h, { action: 'watch_run' });
  eq([lr.status, lr.j.error], [400, 'bad_action'], 'ログイン中の人は watch_run を使えない（不明な操作）');
  eq(st.rpcs.length + st.inserts.length, 0, 'ログインの入口からは確認も保存も動かない');
  // 合言葉があっても、watch_run 以外は使えない（ping / get は通らない）
  eq((await runW(h, { action: 'ping' })).j.error, 'bad_action', '予約実行の入口では watch_run 以外は使えない');
  eq((await runW(h, { action: 'get', path: '/API/v2/Trades/Search' })).j.error, 'bad_action', '予約実行の入口から任意の API は呼べない');
  eq(f.calls.length, 0, '上の呼び出しで、サイバーポートへは通信していない');

  // 設定の不足
  h = load(makeEnv({ CP_WATCH_SECRET: WS }), f, { sb: mkSb(st0()) });
  eq((await runW(h, { action: 'watch_run' })).j.error, 'watch_not_configured', 'サービス用の鍵が無い → 503 watch_not_configured');
  st = st0(); st.noTables = true;
  h = load(makeEnv({ CP_WATCH_SECRET: WS, SUPABASE_SERVICE_ROLE_KEY: SK }), f, { sb: mkSb(st) });
  eq((await runW(h, { action: 'watch_run' })).j.error, 'watch_tables_missing', '表が無い → 503 watch_tables_missing（SQL の案内）');

  // 正常：1 件確認して保存
  st = st0(); f = net({ api: (init, u) => (u.includes('ImportContainers') ? R(200, [impRec]) : R(200, [])) });
  h = load(makeEnv({ CP_WATCH_SECRET: WS, SUPABASE_SERVICE_ROLE_KEY: SK }), f, { sb: mkSb(st) });
  let r = await runW(h, { action: 'watch_run', n: 3 });
  eq([r.status, r.j.ok, r.j.summary.picked, r.j.summary.ok, r.j.summary.failed], [200, true, 1, 1, 0], '予約実行：1 件を確認して成功（応答の ok と集計の件数が別になっている）');
  ok(!r.text.includes(WS) && !r.text.includes(SK) && !r.text.includes(SECRET) && !r.text.includes(CTOK) && !r.text.includes(UTOK) && !r.text.includes(PASS), '応答に合言葉・鍵・トークン・パスワードが含まれない');
  eq(st.rpcs[0], ['cp_watch_pick', { p_n: 3 }], '確認する件数（n）を選ぶ関数に渡す');
  const apiCalls = f.api();
  ok(apiCalls.length >= 1 && apiCalls.every((c) => (c.init.method || 'GET') === 'GET'), 'サイバーポートへは GET だけ');
  ok(apiCalls.every((c) => /\/ColinsViewers\//.test(c.url)), '呼ぶのは COLINS の読み取りだけ');
  const upd = st.updates.find((x) => x[0] === 'cp_watch_targets');
  ok(upd && upd[1].last_status === 'ok' && Array.isArray(upd[1].snapshot) && upd[1].consecutive_errors === 0 && upd[1].state === 'active', '名簿：確認結果（写し・状態・失敗回数 0）を保存');
  eq(st.eqs.find((x) => x[0] === 'cp_watch_targets'), ['cp_watch_targets', 'preset_id', 'p1'], '名簿は案件の ID で更新');
  const runUpd = st.updates.find((x) => x[0] === 'cp_watch_runs');
  ok(runUpd && runUpd[1].picked === 1 && runUpd[1].ok === 1 && runUpd[1].finished_at, '実行記録：件数と終了時刻を保存');
  eq(st.inserts.filter((x) => x[0] === 'cp_changes').length, 0, '初回は変化の記録なし（基準を作るだけ）');
  // n の範囲
  st = st0(); h = load(makeEnv({ CP_WATCH_SECRET: WS, SUPABASE_SERVICE_ROLE_KEY: SK }), net({ api: () => R(200, []) }), { sb: mkSb(st) });
  await runW(h, { action: 'watch_run', n: 999 }); eq(st.rpcs[0][1].p_n, 10, 'n は 10 まで');
  st = st0(); h = load(makeEnv({ CP_WATCH_SECRET: WS, SUPABASE_SERVICE_ROLE_KEY: SK }), net({ api: () => R(200, []) }), { sb: mkSb(st) });
  await runW(h, { action: 'watch_run', n: 'abc' }); eq(st.rpcs[0][1].p_n, 5, 'n が不正なら 5');

  // 2 回目：前回の写しとの差が変化の記録になる
  const prevItems = upd[1].snapshot.map((x) => (x.k === 'c:ABCD1234567:outOk' ? Object.assign({}, x, { val: 'false' }) : x));
  st = st0(); st.targets[0].snapshot = prevItems;
  h = load(makeEnv({ CP_WATCH_SECRET: WS, SUPABASE_SERVICE_ROLE_KEY: SK }), net({ api: (init, u) => (u.includes('ImportContainers') ? R(200, [impRec]) : R(200, [])) }), { sb: mkSb(st) });
  r = await runW(h, { action: 'watch_run' });
  const chIns = st.inserts.find((x) => x[0] === 'cp_changes');
  ok(chIns && chIns[1].length === 1 && chIns[1][0].label === '搬出可否' && chIns[1][0].old_val === 'false' && chIns[1][0].new_val === 'true' && chIns[1][0].run_id === 77, '変化（搬出可否 false→true）が実行 ID つきで記録される');
  eq(r.j.summary.changed, 1, '応答に変化のあった件数');

  // 通信エラー：失敗を数え、連続失敗の回数を増やし、写しは触らない
  st = st0();
  h = load(makeEnv({ CP_WATCH_SECRET: WS, SUPABASE_SERVICE_ROLE_KEY: SK }), net({ api: () => R(500, { message: 'boom' }) }), { sb: mkSb(st) });
  r = await runW(h, { action: 'watch_run' });
  eq([r.status, r.j.summary.failed, r.j.ok], [200, 1, true], '相手先が失敗しても入口は成功（失敗 1 件として数える）');
  const eu = st.updates.find((x) => x[0] === 'cp_watch_targets')[1];
  ok(eu.last_status === 'error' && eu.consecutive_errors === 2 && !('snapshot' in eu) && /upstream/.test(eu.last_error || ''), '失敗：連続失敗 1→2・写しは更新しない・理由を記録');

  // 追跡の終わり：状態の変化が記録される
  st = st0();
  const retRec = JSON.parse(JSON.stringify(impRec)); retRec.emptyContainerReturn.actualAt = new Date(NOW - 3600000).toISOString();
  h = load(makeEnv({ CP_WATCH_SECRET: WS, SUPABASE_SERVICE_ROLE_KEY: SK }), net({ api: (init, u) => (u.includes('ImportContainers') ? R(200, [retRec]) : R(200, [])) }), { sb: mkSb(st) });
  await runW(h, { action: 'watch_run' });
  const du = st.updates.find((x) => x[0] === 'cp_watch_targets')[1];
  ok(du.state === 'done' && du.state_at && /返却/.test(du.state_note), '追跡完了：状態・時刻・理由を保存');
  ok(st.inserts.some((x) => x[0] === 'cp_changes' && x[1].some((c) => c.kind === 'state' && c.label === '追跡完了')), '追跡完了が変化の記録（ダイジェストの元）に入る');

  // 選ぶ関数が無い（SQL 未実行）→ 失敗として記録して返す
  st = st0(); st.pickError = true;
  h = load(makeEnv({ CP_WATCH_SECRET: WS, SUPABASE_SERVICE_ROLE_KEY: SK }), net(), { sb: mkSb(st) });
  r = await runW(h, { action: 'watch_run' });
  eq([r.status, r.j.error], [500, 'watch_pick_failed'], '選ぶ関数が無い → 500 watch_pick_failed');
  ok(st.updates.some((x) => x[0] === 'cp_watch_runs' && /watch_pick_failed/.test(x[1].note || '')), '実行記録に失敗の理由を残す');

  // 保存の失敗（表への書き込み失敗）は、実行記録の注意に出る
  st = st0(); st.updateError = { message: 'boom' };
  h = load(makeEnv({ CP_WATCH_SECRET: WS, SUPABASE_SERVICE_ROLE_KEY: SK }), net({ api: (init, u) => (u.includes('ImportContainers') ? R(200, [impRec]) : R(200, [])) }), { sb: mkSb(st) });
  r = await runW(h, { action: 'watch_run' });
  eq([r.status, r.j.summary.saveErrors], [200, 1], '保存に失敗しても入口は落ちない・件数を返す');
}

console.log(`\ncp-proxy 試験：${pass} 件合格 / ${failN} 件失敗`);
process.exit(failN ? 1 : 0);
