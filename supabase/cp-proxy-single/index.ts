// ※ このファイルは scripts/cp-tests/build-cp-proxy-single.mjs が自動で作った「貼り付け用の 1 枚版」です。
//    元は supabase/functions/cp-proxy/{index.ts, logic.ts}。手で直さず、元を直してから作り直してください。
// ============================================================
// 🧪 サイバーポート（Cyber Port Ver.2）用 Edge Function（Supabase / Deno）— 読み取り専用
//
// 役目：メンバーのブラウザとサイバーポートの API の間に立つ窓口。
//   ・接続情報（client_id / client_secret）とトークンはここだけが持つ（ブラウザには渡さない）
//   ・通すのは「読み取りの GET」だけ（logic.ts の ALLOWED_GET）。送信・返信・編集・削除などは呼べない
//   ・ログイン済みのチームメンバーだけが使える（workfolder と同じ確認）
//
// 呼び方（POST・JSON・Authorization: Bearer <ログイン中のアクセストークン>）
//   {action:'ping'}                              → 接続情報でトークンが取れるかだけ確かめる（API は呼ばない）
//   {action:'get', path:'/API/v2/…', query:{…}}  → 許可された読み取り API を 1 回呼ぶ
//
// 認証は「2 つのトークン」（Ver.2 API利用ガイダンス Ver.1.0 P.14・16〜24）
//   ① システム用：POST <base>/Token（client_credentials）→ X-Authorization ヘッダー
//   ② 利用者用：B2C の token（grant_type=password・橋渡しユーザーのメール/パスワード）→ Authorization: Bearer ヘッダー
//
// 必要な「秘密の設定」（supabase secrets set …・リポジトリには絶対に書かない）
//   CP_CLIENT_ID / CP_CLIENT_SECRET … システム用の接続情報（管理者の「会社を管理する」＞「API接続」タブ）
//   CP_APP_ID                       … アプリケーションID（同じタブ。OpenID 認証の client_id）
//   CP_USER_EMAIL / CP_USER_PASSWORD … 橋渡し用「API接続用ユーザー」のメールアドレスとパスワード
//   CP_ALLOWED_ORIGINS … 画面を公開している URL（カンマ区切り。例：https://example.github.io。余計な引用符・空白・末尾の / は無視する）
//   CP_ENV        … sandbox にすると検証環境（省略時は本番）。接続情報は同じ環境どうしの組を使う
//   CP_BASE_URL / CP_TOKEN_URL / CP_OPENID_URL / CP_OPENID_SCOPE … 通常は設定しない（環境ごとの公式の既定値を使う）
//   ※ SUPABASE_URL / SUPABASE_ANON_KEY は Supabase が自動で渡す
// 手順は docs/サイバーポート連携-セットアップ.md
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

// ======== logic.ts（判断の部分）ここから ========
// ============================================================
// cp-proxy の「判断」部分（外に出ない純粋な関数だけ）。
// Deno（Edge Function）と Node（scripts/cp-tests/cp-proxy-logic-test.mjs）の両方で動かして試験する。
// ※ 型の注釈だけを使い、enum など Node で動かせない書き方はしない。
// ============================================================

// ---------- 通してよい API（読み取りの GET だけ） ----------
// 書き込み系（Send／Reply／Edit／MarkAsDelete／Create／Register／Update／Delete／Set…）は
// ここに入れない＝cp-proxy 経由では呼べない。増やすときは必ず GET の読み取りだけを足す。
const SEG = '[A-Za-z0-9._-]{1,80}'; // パスの可変部分に許す文字（%・/・.. は通さない）
const ALLOWED_GET: { name: string; re: RegExp }[] = [
  { name: 'Trades/Search', re: /^\/API\/v2\/Trades\/Search$/ },
  { name: 'Trades/Get', re: new RegExp('^/API/v2/Trades/Get/' + SEG + '$') },
  { name: 'Trades/GetContainers', re: new RegExp('^/API/v2/Trades/GetContainers/' + SEG + '$') },
  { name: 'Trades/Histories/GetList', re: /^\/API\/v2\/Trades\/Histories\/GetList$/ },
  { name: 'Trades/Histories/Get', re: new RegExp('^/API/v2/Trades/Histories/Get/' + SEG + '$') },
  { name: 'Trades/Messages/GetDetails', re: new RegExp('^/API/v2/Trades/Messages/GetDetails/' + SEG + '$') },
  { name: 'Trades/Messages/GetHistories', re: new RegExp('^/API/v2/Trades/Messages/GetHistories/' + SEG + '$') },
  { name: 'ColinsViewers/Containers', re: /^\/API\/v2\/ColinsViewers\/Get(Import|Export)Containers$/ },
  { name: 'ColinsViewers/Vessels', re: new RegExp('^/API/v2/ColinsViewers/Get(Import|Export)Vessels/' + SEG + '$') },
  // ターミナルの一覧（コードから名前を引くため・読み取りだけ。VesselSchedules 等の別系統は含めない）
  { name: 'Terminals/GetList', re: /^\/API\/v2\/Terminals\/GetList$/ },
  { name: 'Terminals/Get', re: new RegExp('^/API/v2/Terminals/Get/' + SEG + '$') },
];

function matchAllowed(path: unknown): string | null {
  if (typeof path !== 'string' || path.length > 300) return null;
  if (path.includes('..') || path.includes('%') || path.includes('?') || path.includes('#')) return null;
  for (const a of ALLOWED_GET) if (a.re.test(path)) return a.name;
  return null;
}

// ---------- クエリ（?以降）の整え ----------
// キーは英数字と _ だけ。値は文字・数値・真偽だけ（200 文字まで）。配列は同じ名前を繰り返す。
function buildQuery(q: unknown): { ok: true; qs: string } | { ok: false; reason: string } {
  if (q == null) return { ok: true, qs: '' };
  if (typeof q !== 'object' || Array.isArray(q)) return { ok: false, reason: 'query は {名前: 値} の形で渡してください' };
  const sp = new URLSearchParams();
  const entries = Object.entries(q as Record<string, unknown>);
  if (entries.length > 40) return { ok: false, reason: '条件が多すぎます' };
  for (const [k, v] of entries) {
    if (!/^[A-Za-z0-9_]{1,60}$/.test(k)) return { ok: false, reason: '使えない条件名です: ' + k.slice(0, 30) };
    const vals = Array.isArray(v) ? v : [v];
    if (vals.length > 50) return { ok: false, reason: '値が多すぎます: ' + k };
    for (const x of vals) {
      if (x == null || x === '') continue; // 空は付けない
      if (!['string', 'number', 'boolean'].includes(typeof x)) return { ok: false, reason: '値は文字・数値・真偽だけです: ' + k };
      const s = String(x);
      if (s.length > 200) return { ok: false, reason: '値が長すぎます: ' + k };
      sp.append(k, s);
    }
  }
  const qs = sp.toString();
  return { ok: true, qs: qs ? '?' + qs : '' };
}

// ---------- 番号の正規化（検証シートの課題：'ONEY TYOGF8748400' → 'ONEYTYOGF8748400'） ----------
function normalizeNo(raw: unknown): string {
  return String(raw == null ? '' : raw).replace(/[\s　]+/g, '').toUpperCase();
}

// ---------- トークンの有効期限 ----------
// 期限の決まりが資料に無いため、JWT（x.y.z）なら中の exp を使い、そうでなければ控えめに 5 分だけ使い回す。
function tokenExpiryMs(token: string, nowMs: number): number {
  const fallback = nowMs + 5 * 60_000;
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
      if (typeof json.exp === 'number') {
        const exp = json.exp * 1000 - 60_000; // 1 分早めに切れたことにする
        return exp > nowMs ? exp : fallback;
      }
    }
  } catch (_e) { /* JWT でなければ既定の時間 */ }
  return fallback;
}

// ---------- 相手先の応答の分類 ----------
type Kind = 'upstream_auth' | 'not_found' | 'bad_request' | 'rate_limited' | 'upstream_error' | 'upstream_other';
function classifyStatus(status: number): { kind: Kind; message: string; retry: boolean } {
  if (status === 401 || status === 403) {
    return { kind: 'upstream_auth', retry: false, message: 'サイバーポートに認証を拒否されました（接続情報・権限・利用者ログインの要否を確認してください）' };
  }
  if (status === 404) return { kind: 'not_found', retry: false, message: '該当するデータが見つかりませんでした（NACCS未登録／ETA前の可能性もあります）' };
  if (status === 400 || status === 422) return { kind: 'bad_request', retry: false, message: '条件の指定が正しくありません' };
  if (status === 429) return { kind: 'rate_limited', retry: true, message: '呼び出しが多すぎます。少し待って再試行してください' };
  if (status >= 500) return { kind: 'upstream_error', retry: true, message: 'サイバーポート側のエラーです。時間をおいて再試行してください' };
  return { kind: 'upstream_other', retry: false, message: 'サイバーポートから想定外の応答がありました（' + status + '）' };
}

// 再試行の待ち時間（指数バックオフ：0.5 秒 → 1 秒 → 2 秒）。attempt は 0 始まり。
function backoffMs(attempt: number): number {
  return 500 * 2 ** Math.max(0, attempt);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ---------- 1 人あたりの呼び出し回数の制限（相手先を叩きすぎない） ----------
function allowRate(hits: Map<string, number[]>, who: string, nowMs: number, max = 30, windowMs = 60_000): boolean {
  const arr = (hits.get(who) ?? []).filter((t) => nowMs - t < windowMs);
  if (arr.length >= max) { hits.set(who, arr); return false; }
  arr.push(nowMs);
  hits.set(who, arr);
  return true;
}

// ---------- ブラウザからの呼び出しを許す「アクセス元」 ----------
// CP_ALLOWED_ORIGINS（カンマ・空白・改行区切り）を整える。貼り付けで混ざりがちな
// 引用符（" ' “ ” ‘ ’）・前後の空白・末尾の / を取り除き、小文字にそろえる（アクセス元は大文字小文字を区別しない）。
function parseOrigins(raw: unknown): string[] {
  return String(raw == null ? '' : raw)
    .split(/[\s,]+/)
    .map((x) => x.replace(/^["'\u2018\u2019\u201c\u201d]+|["'\u2018\u2019\u201c\u201d]+$/g, '').replace(/\/+$/, '').trim().toLowerCase())
    .filter(Boolean);
}

// 許可リストが空のときは localhost だけ通す（うっかり全世界に開けない）。
function isOriginAllowed(origin: string, list: string[]): boolean {
  const o = String(origin || '').trim().replace(/\/+$/, '').toLowerCase();
  if (!o) return false;
  return list.length ? list.includes(o) : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
}

// ---------- 接続設定（本番／検証環境）と、2 種類のトークン ----------
// 根拠：「Ver.2 API利用ガイダンス Ver.1.0」P.14・P.16〜24（引き継ぎ書 第6章）。
//   ① システム用（X-Authorization）：POST <base>/Token（x-www-form-urlencoded・grant_type=client_credentials）→ access_token
//   ② 利用者用（Authorization: Bearer）：POST <B2C の token>（grant_type=password・橋渡しユーザーのメール/パスワード）→ access_token
type CpEnvName = 'production' | 'sandbox';
const ENV_PRESETS: Record<CpEnvName, { base: string; openidUrl: string; scopeBase: string }> = {
  production: {
    base: 'https://api.cyber-port.net',
    openidUrl: 'https://mlitcyberport.b2clogin.com/mlitcyberport.onmicrosoft.com/oauth2/v2.0/token?p=b2c_1_cyberport_ropc_auth',
    scopeBase: 'https://mlitcyberport.onmicrosoft.com/cyberport.api',
  },
  sandbox: {
    base: 'https://api-sandbox.cyber-port.net',
    openidUrl: 'https://mlitcyberport.b2clogin.com/mlitcyberport.onmicrosoft.com/oauth2/v2.0/token?p=b2c_1_sandboxcp_ropc_auth',
    scopeBase: 'https://mlitcyberport.onmicrosoft.com/sandboxcp.api',
  },
};

type CpConfig = {
  env: CpEnvName; base: string; clientTokenUrl: string; openidUrl: string; openidScope: string;
  clientId: string; clientSecret: string; appId: string; userEmail: string; userPassword: string;
};

// 貼り付けで混ざりがちな前後の空白・引用符を取り除く（ID・URL 用）。
function cleanVal(v: unknown): string {
  return String(v == null ? '' : v).trim().replace(/^["'‘’“”]+|["'‘’“”]+$/g, '').trim();
}

// secrets（環境変数）から設定を作る。省略したものは、環境（CP_ENV）に応じた公式の既定値になる。
//   CP_ENV=sandbox で検証環境。CP_BASE_URL / CP_TOKEN_URL / CP_OPENID_URL / CP_OPENID_SCOPE で個別に上書きできる。
//   スコープの既定は「読み取り（read）」だけ（write は要求しない＝万一トークンが漏れても読み取りまで）。
function resolveConfig(get: (k: string) => string | undefined): CpConfig {
  const env: CpEnvName = cleanVal(get('CP_ENV')).toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
  const pre = ENV_PRESETS[env];
  const base = (cleanVal(get('CP_BASE_URL')) || pre.base).replace(/\/+$/, '');
  return {
    env,
    base,
    clientTokenUrl: cleanVal(get('CP_TOKEN_URL')) || base + '/Token',
    openidUrl: cleanVal(get('CP_OPENID_URL')) || pre.openidUrl,
    openidScope: cleanVal(get('CP_OPENID_SCOPE')) || 'openid ' + pre.scopeBase + '/read',
    clientId: cleanVal(get('CP_CLIENT_ID')),
    clientSecret: cleanVal(get('CP_CLIENT_SECRET')),
    appId: cleanVal(get('CP_APP_ID')),
    userEmail: cleanVal(get('CP_USER_EMAIL')),
    userPassword: String(get('CP_USER_PASSWORD') ?? '').replace(/^\s+|\s+$/g, ''), // パスワードは前後の空白だけ除く（引用符は中身かもしれない）
  };
}

// x-www-form-urlencoded の本文（空白は + に・記号は %XX に）
function formBody(o: Record<string, string>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) sp.append(k, v);
  return sp.toString();
}

// トークン応答から、使うトークンと有効期限を取り出す（access_token、または旧来の token）。
// 期限は expires_in（秒）→ JWT の exp → 既定 5 分 の順。1 分早めに切れたことにする。
function tokenFromResponse(j: Record<string, unknown>, nowMs: number): { token: string; exp: number } | null {
  const token = typeof j.access_token === 'string' && j.access_token ? j.access_token : typeof j.token === 'string' ? j.token : '';
  if (!token) return null;
  const ei = Number(j.expires_in);
  const exp = Number.isFinite(ei) && ei > 0 ? nowMs + Math.max(ei * 1000 - 60_000, ei * 500) : tokenExpiryMs(token, nowMs);
  return { token, exp };
}
// ======== logic.ts ここまで ========

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const MAX_BODY = 1_000_000; // 相手の応答は 1MB まで（大きすぎる応答は返さない）
const MAX_ATTEMPTS = 3;     // 通信エラー／相手先のエラーは最大 3 回まで（指数バックオフ）

// ---------- 共通：CORS ----------
// 許可するアクセス元は、呼び出しのたびに読む（起動時の 1 回だけだと、あとから secrets を直しても反映されないため）。
// 余計な引用符・空白・末尾の / は parseOrigins が取り除く。許可されないときは、記録（ログ）に理由を残す。
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const list = parseOrigins(Deno.env.get('CP_ALLOWED_ORIGINS'));
  const ok = isOriginAllowed(origin, list);
  if (origin && !ok) {
    console.warn(JSON.stringify({ event: 'cors_blocked', origin, allowed: list.length ? list : '(未設定: localhostだけ許可)' }));
  }
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsFor(req), 'Content-Type': 'application/json' } });
const fail = (req: Request, status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  json(req, { ok: false, error: code, message, ...extra }, status);

// ---------- 本人確認：ログイン中のチームメンバーか ----------
async function authUser(req: Request): Promise<{ email: string } | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const userClient = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser(auth.slice(7));
  if (error || !data?.user?.email) return null;
  const { data: isMember, error: e2 } = await userClient.rpc('is_team_member');
  if (e2 || isMember !== true) return null;
  return { email: data.user.email.toLowerCase() };
}

// ---------- 設定（鍵は呼び出しのたびに読む＝secrets を更新しても再デプロイ不要） ----------
const cfg = () => resolveConfig((k) => Deno.env.get(k));

class CpError extends Error {
  code: string; status: number; extra: Record<string, unknown>;
  constructor(code: string, status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message); this.code = code; this.status = status; this.extra = extra;
  }
}

// 相手先の応答を読む共通処理（JSON でなくても落ちない）
async function readJson(r: Response): Promise<{ j: Record<string, unknown>; text: string; ctype: string }> {
  const text = await r.text().catch(() => '');
  const ctype = r.headers.get('content-type') ?? '';
  let j: Record<string, unknown> = {};
  try { const x = JSON.parse(text); if (x && typeof x === 'object') j = x as Record<string, unknown>; } catch (_e) { /* JSON でないとき */ }
  return { j, text, ctype };
}
const looksLikeHtml = (ctype: string, text: string) => /html/i.test(ctype) || /^\s*</.test(text);

// ---------- ① システム用トークン（X-Authorization）：client_id / client_secret ----------
//   公式：POST <base>/Token（x-www-form-urlencoded・grant_type=client_credentials）→ access_token（Bearer は付けずにそのまま使う）。
//   CP_TOKEN_URL が旧来の Swagger 用の取得口（…/vendor-auth/token）のときだけ、JSON（clientId/clientSecret）で送り token を受け取る。
let _clientTok: { v: string; exp: number } | null = null;
async function getClientToken(force = false): Promise<string> {
  if (!force && _clientTok && _clientTok.exp > Date.now()) return _clientTok.v;
  const c = cfg();
  if (!c.clientId || !c.clientSecret) throw new CpError('cp_not_configured', 503, 'サイバーポートの接続情報が未設定です（CP_CLIENT_ID / CP_CLIENT_SECRET）');
  const legacy = /\/vendor-auth\/token\/?$/.test(c.clientTokenUrl);
  let r: Response;
  try {
    r = await fetch(c.clientTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': legacy ? 'application/json' : 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: legacy ? JSON.stringify({ clientId: c.clientId, clientSecret: c.clientSecret })
        : formBody({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (_e) {
    throw new CpError('token_network', 502, 'システム用トークンの取得先に接続できませんでした（CP_TOKEN_URL・接続先を確認してください）');
  }
  const { j, text, ctype } = await readJson(r);
  const got = r.ok ? tokenFromResponse(j, Date.now()) : null;
  if (!got && looksLikeHtml(ctype, text)) {
    // 取得先が API ではなくウェブページだった（接続情報の間違いではない）
    throw new CpError('token_wrong_endpoint', 502, 'システム用トークンの取得先がAPIではありません（ウェブページが返りました）。取得先（CP_TOKEN_URL）を確認してください', { upstreamStatus: r.status });
  }
  if (!got) {
    // 秘密（client_secret）は送り返さない。相手先の説明（detail / error）だけを短く添える。
    const raw = typeof j.detail === 'string' ? j.detail : typeof j.error === 'string' ? j.error : '';
    const detail = raw ? truncate(raw, 200) : truncate(text, 120);
    const bad = raw === 'invalid_client' || raw === 'invalid_client_credentials';
    const msg = bad
      ? 'client_id / client_secret が正しくありません（invalid_client）。ID とシークレットが同じ組（本番どうし・検証環境どうし）か確認してください'
      : 'システム用トークンを取得できませんでした（' + r.status + '）。client_id / client_secret を確認してください';
    throw new CpError('token_failed', 502, msg, { upstreamStatus: r.status, detail });
  }
  _clientTok = { v: got.token, exp: got.exp };
  return got.token;
}

// ---------- ② 利用者用トークン（Authorization: Bearer）：橋渡しユーザーのメール・パスワード ----------
//   公式：POST <B2C の token>（grant_type=password・client_id＝アプリケーションID・scope）→ access_token。
//   スコープは既定で読み取り（read）だけ（logic.ts resolveConfig）。
let _userTok: { v: string; exp: number } | null = null;
async function getUserToken(force = false): Promise<string> {
  if (!force && _userTok && _userTok.exp > Date.now()) return _userTok.v;
  const c = cfg();
  if (!c.appId || !c.userEmail || !c.userPassword) {
    throw new CpError('cp_user_not_configured', 503, 'API接続用ユーザーの情報が未設定です（CP_APP_ID / CP_USER_EMAIL / CP_USER_PASSWORD）');
  }
  let r: Response;
  try {
    r = await fetch(c.openidUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: formBody({ grant_type: 'password', client_id: c.appId, username: c.userEmail, password: c.userPassword, response_type: 'token id_token', scope: c.openidScope }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (_e) {
    throw new CpError('user_token_network', 502, '利用者用トークンの取得先に接続できませんでした（CP_OPENID_URL を確認してください）');
  }
  const { j, text, ctype } = await readJson(r);
  const got = r.ok ? tokenFromResponse(j, Date.now()) : null;
  if (!got && looksLikeHtml(ctype, text)) {
    throw new CpError('user_token_wrong_endpoint', 502, '利用者用トークンの取得先がAPIではありません（ウェブページが返りました）。CP_OPENID_URL を確認してください', { upstreamStatus: r.status });
  }
  if (!got) {
    // B2C のエラー（error と、AADB2C で始まる説明）。パスワードは相手先も返さないが、念のため短く切る。
    const err = typeof j.error === 'string' ? j.error : '';
    const desc = typeof j.error_description === 'string' ? truncate(j.error_description.split(/\r?\n/)[0], 200) : '';
    const detail = [err, desc].filter(Boolean).join(': ') || truncate(text, 120);
    throw new CpError('user_token_failed', 502,
      'API接続用ユーザーのトークンを取得できませんでした（' + r.status + '）。アプリケーションID・メールアドレス・パスワードと、そのユーザーがAPI用に登録されているかを確認してください',
      { upstreamStatus: r.status, detail });
  }
  _userTok = { v: got.token, exp: got.exp };
  return got.token;
}

// ---------- 読み取り API を 1 回呼ぶ（認証切れ 1 回・通信/5xx は最大 3 回まで再試行） ----------
async function callGet(pathAndQuery: string): Promise<{ status: number; data: unknown }> {
  const c = cfg();
  let refreshed = false;
  let lastErr: CpError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const clientToken = await getClientToken();
    const userToken = await getUserToken();
    let r: Response;
    try {
      r = await fetch(c.base + pathAndQuery, {
        method: 'GET',
        // 2 つのヘッダーが両方必要：X-Authorization（システム用・Bearer なし）と Authorization（利用者用・Bearer ＋ 空白 1 つ）
        headers: { 'X-Authorization': clientToken, Authorization: 'Bearer ' + userToken, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (_e) {
      lastErr = new CpError('upstream_network', 502, 'サイバーポートに接続できませんでした（通信エラー）');
      if (attempt < MAX_ATTEMPTS - 1) { await new Promise((ok) => setTimeout(ok, backoffMs(attempt))); continue; }
      throw lastErr;
    }
    const text = await r.text().catch(() => '');
    if (r.ok) {
      if (text.length > MAX_BODY) throw new CpError('too_large', 502, '応答が大きすぎます。条件を絞ってください');
      let data: unknown = null;
      if (text) { try { data = JSON.parse(text); } catch (_e) { data = text; } }
      return { status: r.status, data };
    }
    // 認証が切れたかもしれない：トークンを取り直して 1 回だけやり直す（回数は消費しない）
    if ((r.status === 401) && !refreshed) { refreshed = true; _clientTok = null; _userTok = null; attempt--; continue; }
    const cls = classifyStatus(r.status);
    // 相手先のエラーは常に 502 で返す（404 を返すと、ブラウザ側が「この関数が無い」と取り違えるため）。
    // 本当の状態は error（種類）と upstreamStatus で伝える。
    lastErr = new CpError(cls.kind, 502, cls.message, { upstreamStatus: r.status, detail: truncate(text, 300) });
    if (cls.retry && attempt < MAX_ATTEMPTS - 1) { await new Promise((ok) => setTimeout(ok, backoffMs(attempt))); continue; }
    throw lastErr;
  }
  throw lastErr ?? new CpError('upstream_error', 502, 'サイバーポート側のエラーです');
}

// ---------- 入口 ----------
const hits = new Map<string, number[]>();

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsFor(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method', 'POST だけ使えます');

  const user = await authUser(req);
  if (!user) return fail(req, 401, 'unauthorized', 'ログインが必要です（チームメンバーのみ使えます）');
  if (!allowRate(hits, user.email, Date.now())) return fail(req, 429, 'rate_limited', '呼び出しが多すぎます。少し待ってください');

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { return fail(req, 400, 'bad_json', '送る内容（JSON）が読めません'); }

  try {
    if (body.action === 'ping') {
      const c = cfg();
      await getClientToken(true); // 取り直して、いまの接続情報で本当に通るか確かめる
      await getUserToken(true);
      console.log(JSON.stringify({ at: new Date().toISOString(), who: user.email, action: 'ping', ok: true }));
      return json(req, {
        ok: true,
        message: 'システム用と利用者用の両方のトークンを取得できました（接続情報・API接続用ユーザーは有効です）',
        env: c.env, apiHost: new URL(c.base).host, tokenHost: new URL(c.clientTokenUrl).host, openidHost: new URL(c.openidUrl).host,
      });
    }
    if (body.action === 'get') {
      const name = matchAllowed(body.path);
      if (!name) return fail(req, 403, 'path_not_allowed', 'この API は許可されていません（読み取り用の一部だけ使えます）');
      const q = buildQuery(body.query);
      if (!q.ok) return fail(req, 400, 'bad_query', q.reason);
      const res = await callGet((body.path as string) + q.qs);
      console.log(JSON.stringify({ at: new Date().toISOString(), who: user.email, action: 'get', api: name, status: res.status }));
      return json(req, { ok: true, api: name, status: res.status, data: res.data });
    }
    return fail(req, 400, 'bad_action', '不明な操作です');
  } catch (e) {
    if (e instanceof CpError) {
      console.log(JSON.stringify({ at: new Date().toISOString(), who: user.email, action: String(body.action), error: e.code, upstream: e.extra.upstreamStatus ?? null }));
      return fail(req, e.status, e.code, e.message, e.extra);
    }
    console.error('cp-proxy unexpected', e instanceof Error ? e.message : e);
    return fail(req, 500, 'internal', '予期しないエラーです');
  }
});
