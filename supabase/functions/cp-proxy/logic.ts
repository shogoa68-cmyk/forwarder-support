// ============================================================
// cp-proxy の「判断」部分（外に出ない純粋な関数だけ）。
// Deno（Edge Function）と Node（scripts/cp-tests/cp-proxy-logic-test.mjs）の両方で動かして試験する。
// ※ 型の注釈だけを使い、enum など Node で動かせない書き方はしない。
// ============================================================

// ---------- 通してよい API（読み取りの GET だけ） ----------
// 書き込み系（Send／Reply／Edit／MarkAsDelete／Create／Register／Update／Delete／Set…）は
// ここに入れない＝cp-proxy 経由では呼べない。増やすときは必ず GET の読み取りだけを足す。
const SEG = '[A-Za-z0-9._-]{1,80}'; // パスの可変部分に許す文字（%・/・.. は通さない）
export const ALLOWED_GET: { name: string; re: RegExp }[] = [
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

export function matchAllowed(path: unknown): string | null {
  if (typeof path !== 'string' || path.length > 300) return null;
  if (path.includes('..') || path.includes('%') || path.includes('?') || path.includes('#')) return null;
  for (const a of ALLOWED_GET) if (a.re.test(path)) return a.name;
  return null;
}

// ---------- クエリ（?以降）の整え ----------
// キーは英数字と _ だけ。値は文字・数値・真偽だけ（200 文字まで）。配列は同じ名前を繰り返す。
export function buildQuery(q: unknown): { ok: true; qs: string } | { ok: false; reason: string } {
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
export function normalizeNo(raw: unknown): string {
  return String(raw == null ? '' : raw).replace(/[\s　]+/g, '').toUpperCase();
}

// ---------- トークンの有効期限 ----------
// 期限の決まりが資料に無いため、JWT（x.y.z）なら中の exp を使い、そうでなければ控えめに 5 分だけ使い回す。
export function tokenExpiryMs(token: string, nowMs: number): number {
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
export type Kind = 'upstream_auth' | 'not_found' | 'bad_request' | 'rate_limited' | 'upstream_error' | 'upstream_other';
export function classifyStatus(status: number): { kind: Kind; message: string; retry: boolean } {
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
export function backoffMs(attempt: number): number {
  return 500 * 2 ** Math.max(0, attempt);
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ---------- 1 人あたりの呼び出し回数の制限（相手先を叩きすぎない） ----------
export function allowRate(hits: Map<string, number[]>, who: string, nowMs: number, max = 30, windowMs = 60_000): boolean {
  const arr = (hits.get(who) ?? []).filter((t) => nowMs - t < windowMs);
  if (arr.length >= max) { hits.set(who, arr); return false; }
  arr.push(nowMs);
  hits.set(who, arr);
  return true;
}

// ---------- ブラウザからの呼び出しを許す「アクセス元」 ----------
// CP_ALLOWED_ORIGINS（カンマ・空白・改行区切り）を整える。貼り付けで混ざりがちな
// 引用符（" ' “ ” ‘ ’）・前後の空白・末尾の / を取り除き、小文字にそろえる（アクセス元は大文字小文字を区別しない）。
export function parseOrigins(raw: unknown): string[] {
  return String(raw == null ? '' : raw)
    .split(/[\s,]+/)
    .map((x) => x.replace(/^["'\u2018\u2019\u201c\u201d]+|["'\u2018\u2019\u201c\u201d]+$/g, '').replace(/\/+$/, '').trim().toLowerCase())
    .filter(Boolean);
}

// 許可リストが空のときは localhost だけ通す（うっかり全世界に開けない）。
export function isOriginAllowed(origin: string, list: string[]): boolean {
  const o = String(origin || '').trim().replace(/\/+$/, '').toLowerCase();
  if (!o) return false;
  return list.length ? list.includes(o) : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
}

// ---------- 接続設定（本番／検証環境）と、2 種類のトークン ----------
// 根拠：「Ver.2 API利用ガイダンス Ver.1.0」P.14・P.16〜24（引き継ぎ書 第6章）。
//   ① システム用（X-Authorization）：POST <base>/Token（x-www-form-urlencoded・grant_type=client_credentials）→ access_token
//   ② 利用者用（Authorization: Bearer）：POST <B2C の token>（grant_type=password・橋渡しユーザーのメール/パスワード）→ access_token
export type CpEnvName = 'production' | 'sandbox';
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

export type CpConfig = {
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
export function resolveConfig(get: (k: string) => string | undefined): CpConfig {
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
export function formBody(o: Record<string, string>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) sp.append(k, v);
  return sp.toString();
}

// トークン応答から、使うトークンと有効期限を取り出す（access_token、または旧来の token）。
// 期限は expires_in（秒）→ JWT の exp → 既定 5 分 の順。1 分早めに切れたことにする。
export function tokenFromResponse(j: Record<string, unknown>, nowMs: number): { token: string; exp: number } | null {
  const token = typeof j.access_token === 'string' && j.access_token ? j.access_token : typeof j.token === 'string' ? j.token : '';
  if (!token) return null;
  const ei = Number(j.expires_in);
  const exp = Number.isFinite(ei) && ei > 0 ? nowMs + Math.max(ei * 1000 - 60_000, ei * 500) : tokenExpiryMs(token, nowMs);
  return { token, exp };
}

// 合言葉の比較（長さが違ってもかかる時間が変わらないようにする）。空どうしは一致にしない。
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length));
  return diff === 0;
}
