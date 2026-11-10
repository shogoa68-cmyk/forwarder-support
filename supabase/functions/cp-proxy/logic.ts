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
