// ※ このファイルは scripts/cp-tests/build-cp-proxy-single.mjs が自動で作った「貼り付け用の 1 枚版」です。
//    元は supabase/functions/cp-proxy/{index.ts, logic.ts, watch.ts}。手で直さず、元を直してから作り直してください。
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
// 予約実行（毎朝・毎夕の動静確認）専用の入口：ヘッダー x-cp-watch-secret に合言葉（CP_WATCH_SECRET）を付けて呼ぶ。
//   {action:'watch_run', n:5}  → 追跡中の案件を古い順・急ぐ順に n 件（最大 10）確認し、結果を表に保存する（Supabase の pg_cron から）
//   ログイン中の人向けの入口とは完全に分けてある（合言葉が無い・違うと 401。ログインでは watch_run は使えない）。
//   読み取りの GET しか呼ばない（許可リストは同じ）。保存先は docs/sql/cp-watch.sql。
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
//   CP_WATCH_SECRET … 予約実行の合言葉（24 文字以上のランダムな文字列。pg_cron 側の Vault にも同じ値を入れる）。未設定なら予約実行は無効
//   CP_ENV        … sandbox にすると検証環境（省略時は本番）。接続情報は同じ環境どうしの組を使う
//   CP_BASE_URL / CP_TOKEN_URL / CP_OPENID_URL / CP_OPENID_SCOPE … 通常は設定しない（環境ごとの公式の既定値を使う）
//   ※ SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で渡す
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

// 合言葉の比較（長さが違ってもかかる時間が変わらないようにする）。空どうしは一致にしない。
function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length));
  return diff === 0;
}
// ======== logic.ts ここまで ========

// ======== watch.ts（動静の自動確認の判断・実行器）ここから ========
// ============================================================
// 動静の自動確認（cp-watch）の「判断」部分。
//   ・外には出ない純粋な関数（COLINS の応答 → 注目項目の写し → 前回との差 → 終わりの判定）
//   ・1 回分の確認を進める実行器 runWatchBatch（通信と保存は外から渡す＝試験では偽物に差し替える）
// Deno（Edge Function）と Node（scripts/cp-tests/cp-watch-test.mjs）の両方で動かして試験する。
// ※ 型の注釈だけを使い、enum など Node で動かせない書き方はしない。
// ※ 読み取りだけ。サイバーポートへ書き込む処理は一切ない。
// 設計：docs/サイバーポート動静自動確認_ロードマップ.md
// ============================================================

type Dir = 'import' | 'export';
type Level = 'over' | 'warn' | 'ok' | 'none';
type Sev = 'alert' | 'warn' | 'info';

// 「写し」の 1 項目（スナップショット）。val は元の文字のまま（日時は ISO か 日付だけ）
interface Item {
  k: string;            // 同じ項目を前回と照らすための印（例：c:ABCD1234567:pickupDueAt）
  scope: string;        // 何についての項目か（例：コンテナ ABCD1234567／本船 EVER GIVEN 123W）
  label: string;        // 項目名（例：搬出期限）
  val: string | null;   // 値（無ければ null）
  cat: 'date' | 'flag' | 'text';
  dl?: boolean;         // 期限の項目（過ぎる・近いを警告する）
  plan?: boolean;       // 予定の項目（ずれたら知らせる）
}

interface Change {
  k: string; scope: string; label: string;
  from: string | null; to: string | null;
  kind: 'new' | 'changed' | 'cleared';
  sev: Sev; note?: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const JST = 9 * HOUR;

// ---------- 小さな道具 ----------
function g(o: unknown, path: string): unknown {
  let v: unknown = o;
  for (const k of String(path).split('.')) {
    v = v == null || typeof v !== 'object' ? undefined : (v as Record<string, unknown>)[k];
  }
  return v;
}
function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v).trim();
  return s === '' ? null : s;
}

// 日時の読み取り。届く形は 2 通り：UTC の ISO（2026-11-12T00:00:00Z）と、日付だけ（20261109 / 2026-11-09）。
// 日付だけのものは日本の日付（その日の 0 時）として扱う。読めない値は null。
function parseMs(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  let m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) - JST;
  m = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.exec(s);
  if (m) {
    const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

// 期限の色分け（画面と同じ考え方）：過ぎた＝over・48時間以内＝warn
function levelOf(dueMs: number | null, nowMs: number): Level {
  if (dueMs == null) return 'none';
  if (nowMs > dueMs) return 'over';
  if (dueMs - nowMs <= 48 * HOUR) return 'warn';
  return 'ok';
}

// ---------- ① COLINS の応答 → 注目項目の写し ----------
function item(k: string, scope: string, label: string, v: unknown, cat: Item['cat'], extra: Partial<Item> = {}): Item {
  return Object.assign({ k, scope, label, val: str(v), cat }, extra) as Item;
}

// コンテナ 1 件ぶん
function containerItems(rec: unknown, dir: Dir): Item[] {
  const no = str(g(rec, 'container.containerNo')) || '(番号なし)';
  const scope = 'コンテナ ' + no;
  const I = (f: string, label: string, path: string, cat: Item['cat'], extra: Partial<Item> = {}) =>
    item('c:' + no + ':' + f, scope, label, g(rec, path), cat, extra);
  if (dir === 'export') {
    return [
      I('customs', '通関', 'containerStatus.customClearanceStatus', 'text'),
      I('shipOk', '船積可否', 'shipmentAvailability', 'flag'),
      I('emptyOut', '空コン搬出（実績）', 'emptyContainerPickup.actualAt', 'date'),
      I('delivSched', '実入り搬入（予定）', 'loadedContainerDelivery.scheduledAt', 'date', { plan: true }),
      I('delivAct', '実入り搬入（実績）', 'loadedContainerDelivery.actualAt', 'date'),
      I('gateIn', 'ゲートイン', 'gateInDate', 'date'),
      I('handling', '荷役日', 'loadingUnloadingDate', 'date', { plan: true }),
      I('shipDate', '船積日', 'shipmentDate', 'date'),
    ];
  }
  return [
    I('customs', '通関', 'containerStatus.customClearanceStatus', 'text'),
    I('inspect', '検査状況', 'inspectionStatus', 'flag'),
    I('doAcq', 'DO入手', 'doAcquisition', 'flag'),
    I('outOk', '搬出可否', 'outboundAvailability', 'flag'),
    I('pickAvail', '搬出可能', 'loadedContainerPickup.availableAt', 'date', { plan: true }),
    I('pickDue', '搬出期限', 'loadedContainerPickup.dueAt', 'date', { dl: true }),
    I('pickAct', '搬出（実績）', 'loadedContainerPickup.actualAt', 'date'),
    I('cyIn', 'CY搬入', 'cyCarryInDate', 'date'),
    I('gateOut', 'ゲートアウト', 'gateOutDate', 'date'),
    I('retDue', '返却期限', 'emptyContainerReturn.dueAt', 'date', { dl: true }),
    I('retAct', '返却（実績）', 'emptyContainerReturn.actualAt', 'date'),
  ];
}

// 港のオブジェクト（vessel.portOfLoading など）1 つぶん
function portItems(vk: string, scope: string, tag: string, p: unknown, want: ('eta' | 'ata' | 'etd' | 'atd')[]): Item[] {
  if (!p || typeof p !== 'object') return [];
  const name = str(g(p, 'portName')) || str(g(p, 'portCode')) || '';
  const out: Item[] = [];
  const map: Record<string, [string, string, boolean]> = {
    eta: ['estimatedTimeOfArrival', '入港 予定(ETA)', true], ata: ['actualTimeOfArrival', '入港 実績(ATA)', false],
    etd: ['estimatedTimeOfDeparture', '出港 予定(ETD)', true], atd: ['actualTimeOfDeparture', '出港 実績(ATD)', false],
  };
  for (const w of want) {
    const [path, label, plan] = map[w];
    out.push(item(vk + ':' + tag + ':' + w, scope, (name ? name + ' ' : '') + label, g(p, path), 'date', plan ? { plan: true } : {}));
  }
  return out;
}

// 本船の写し。rec は「コンテナの応答の vessel を含む記録」か「本船の動静の記録」のどちらでもよい。
// 本船の動静の記録（cargoTransfer などを持つもの）のときは、CY オープン／カットなどもあわせて拾う。
function vesselItems(rec: unknown): Item[] {
  const v = g(rec, 'vessel');
  if (!v || typeof v !== 'object') return [];
  const name = str(g(v, 'vesselName')) || '(本船名なし)';
  const voy = str(g(v, 'voyageNo')) || '';
  const vk = 'v:' + name + '|' + voy;
  const scope = '本船 ' + name + (voy ? ' ' + voy : '');
  const out: Item[] = [];
  out.push(...portItems(vk, scope, 'pol', g(v, 'portOfLoading'), ['etd', 'atd']));
  out.push(...portItems(vk, scope, 'pod', g(v, 'portOfDischarge'), ['eta', 'ata']));
  const tr = g(v, 'transhipVessels');
  if (Array.isArray(tr)) {
    tr.forEach((t, i) => {
      const tn = (str(g(t, 'vesselName')) || '積替本船' + (i + 1)) + ' ' + (str(g(t, 'voyageNo')) || '');
      out.push(...portItems(vk, scope + '／積替 ' + tn.trim(), 'tr' + i + 'pod', g(t, 'portOfDischarge'), ['eta', 'ata']));
    });
  }
  const I = (f: string, label: string, path: string, extra: Partial<Item> = {}) => {
    const val = g(rec, path);
    if (val === undefined) return;       // この記録に無い項目は拾わない（コンテナ側の vessel には無い）
    out.push(item(vk + ':' + f, scope, label, val, 'date', extra));
  };
  I('cyOpen', 'CYオープン', 'cargoTransfer.cyOpenAt');
  I('cyCut', 'CYカット', 'cargoTransfer.cyCutAt', { dl: true, plan: true });
  I('cfsCut', 'CFSカット', 'cargoTransfer.cfsCutAt', { dl: true, plan: true });
  I('hdlSched', '荷役開始（予定）', 'cargoHandling.scheduleAt', { plan: true });
  I('hdlAct', '荷役開始（実績）', 'cargoHandling.actualAt');
  return out;
}

// 同じ k の項目は 1 つにまとめる（コンテナ間で同じ本船が重なるため）。先に入れたものを優先するが、
// 先のものが空で後のものに値があるときは、値のある方を使う。
function uniqItems(list: Item[]): Item[] {
  const at = new Map<string, number>(); const out: Item[] = [];
  for (const it of list) {
    const i = at.get(it.k);
    if (i == null) { at.set(it.k, out.length); out.push(it); }
    else if (out[i].val == null && it.val != null) out[i] = it;
  }
  return out;
}

// ---------- ② 前回との差 ----------
const isDueLabel = (it: Item) => it.dl === true;
function diffItems(prev: Item[] | null, next: Item[], nowMs: number): Change[] {
  if (!prev) return [];                  // 初回は「基準」を作るだけ（変化とは数えない）
  const before = new Map(prev.map((x) => [x.k, x]));
  const out: Change[] = [];
  for (const n of next) {
    const p = before.get(n.k);
    const from = p ? p.val : null;
    if (from === n.val) continue;
    const kind: Change['kind'] = from == null ? 'new' : n.val == null ? 'cleared' : 'changed';
    let sev: Sev = 'info'; let note: string | undefined;
    if (n.cat === 'date') {
      const a = parseMs(from), b = parseMs(n.val);
      if (kind === 'changed' && a != null && b != null) {
        const d = b - a;
        const h = Math.round(Math.abs(d) / HOUR);
        if (n.plan || n.dl) {
          // 予定・期限が動いた：1 日以上のずれは警告
          if (Math.abs(d) >= DAY) sev = 'warn';
          note = (d > 0 ? '＋' : '－') + (h >= 48 ? Math.round(h / 24) + '日' : h + '時間');
        }
      }
      if (n.dl && b != null) {
        const lv = levelOf(b, nowMs);
        if (lv === 'over') { sev = 'alert'; note = '期限超過'; }
        else if (lv === 'warn') { sev = 'warn'; note = note ? note + '・48時間以内' : '48時間以内'; }
      }
      if (kind === 'cleared') sev = 'warn';
    } else if (n.cat === 'flag') {
      sev = 'warn';                       // 可否・入手などの状態が変わった
    } else {
      sev = kind === 'cleared' ? 'warn' : 'info';
    }
    out.push({ k: n.k, scope: n.scope, label: n.label, from, to: n.val, kind, sev, note });
  }
  return out;
}

// いちばん近い（または過ぎた）期限。確認の優先順位に使う（無ければ null）
function urgentAt(items: Item[], nowMs: number): string | null {
  let best: number | null = null;
  for (const it of items) {
    if (!isDueLabel(it)) continue;
    const ms = parseMs(it.val);
    if (ms == null) continue;
    if (levelOf(ms, nowMs) === 'ok' && ms - nowMs > 7 * DAY) continue; // 1 週間より先は急がない
    if (best == null || ms < best) best = ms;
  }
  return best == null ? null : new Date(best).toISOString();
}

// ---------- ③ 追跡の終わりの判定 ----------
interface EndResult { state: 'active' | 'done' | 'ask'; note: string | null; }

// 最終の荷揚港（積み替えがあれば最後の積替本船の荷揚港）
function finalArrival(vessel: unknown): { name: string; eta: string | null; ata: string | null } | null {
  if (!vessel || typeof vessel !== 'object') return null;
  let p: unknown = g(vessel, 'portOfDischarge');
  const tr = g(vessel, 'transhipVessels');
  if (Array.isArray(tr) && tr.length) {
    const last = g(tr[tr.length - 1], 'portOfDischarge');
    if (last && typeof last === 'object') p = last;
  }
  if (!p || typeof p !== 'object') return null;
  return {
    name: str(g(p, 'portName')) || str(g(p, 'portCode')) || '',
    eta: str(g(p, 'estimatedTimeOfArrival')), ata: str(g(p, 'actualTimeOfArrival')),
  };
}

// 輸入：すべてのコンテナの返却実績がそろったら終了。
// 輸出：荷揚港（最終）の入港実績が確認できたら終了。実績が無いまま ETA を askAfterDays 日過ぎたら「確認の知らせ」。
function evaluateEnd(dir: Dir, containers: unknown[], nowMs: number, askAfterDays = 3): EndResult {
  if (!containers.length) return { state: 'active', note: null };
  if (dir === 'import') {
    const all = containers.every((c) => str(g(c, 'emptyContainerReturn.actualAt')) != null);
    return all ? { state: 'done', note: 'コンテナの返却を確認しました' } : { state: 'active', note: null };
  }
  const arr = containers.map((c) => finalArrival(g(c, 'vessel'))).filter((a): a is NonNullable<typeof a> => a != null);
  if (!arr.length) return { state: 'active', note: null };
  if (arr.every((a) => a.ata != null)) {
    return { state: 'done', note: (arr[0].name ? arr[0].name + ' ' : '') + 'への入港（実績）を確認しました' };
  }
  const pending = arr.filter((a) => a.ata == null);
  const late = pending.every((a) => { const e = parseMs(a.eta); return e != null && nowMs > e + askAfterDays * DAY; });
  if (late) return { state: 'ask', note: '入港予定を過ぎて' + askAfterDays + '日たちましたが、入港の実績を確認できません。終了しますか？' };
  return { state: 'active', note: null };
}

// ---------- ④ 1 回分の確認（実行器） ----------
interface WatchTarget {
  preset_id: string;
  direction: Dir;
  bl_no: string | null;
  booking_no: string | null;
  container_nos: string[] | null;
  snapshot: Item[] | null;
  consecutive_errors: number;
  state?: 'active' | 'done' | 'ask';
  state_note?: string | null;
  ask_snooze_until?: string | null;   // 「もう少し追う」を選んだとき、この時刻まで確認の知らせを止める
}
interface TargetResult {
  preset_id: string;
  ok: boolean;
  status: 'ok' | 'nodata' | 'error';
  items: Item[] | null;          // 新しい写し（失敗・該当なしのときは null＝前回のまま）
  changes: Change[];
  state: 'active' | 'done' | 'ask';
  state_note: string | null;
  urgent_at: string | null;
  error: string | null;
  checked_at: string;
  calls: number;
}
interface WatchDeps {
  pick(n: number): Promise<WatchTarget[]>;
  // 許可リストを通ったパスだけを呼ぶ（cp-proxy の callGet）。失敗は例外（code・message を持つ）
  get(path: string, query: Record<string, unknown>): Promise<unknown>;
  save(r: TargetResult): Promise<void>;
  now(): number;
  stopAt?: number;     // この時刻（ms）を過ぎたら、残りの案件は確認せず次の回に回す（実行時間の上限対策）
}
interface BatchSummary { picked: number; ok: number; nodata: number; failed: number; changed: number; calls: number; skipped: number; saveErrors: number; }

function errText(e: unknown): string {
  const o = e as { code?: string; message?: string; extra?: { upstreamStatus?: number } };
  const parts = [o?.code, o?.extra?.upstreamStatus ? String(o.extra.upstreamStatus) : '', o?.message].filter(Boolean);
  return truncate(parts.join(' / ') || '不明なエラー', 200);
}
const asArray = (d: unknown): unknown[] => (Array.isArray(d) ? d : d && typeof d === 'object' && Array.isArray((d as { items?: unknown[] }).items) ? (d as { items: unknown[] }).items : []);

// 取引の探し方：輸入＝B/L番号（まとめて 1 回）／輸出＝ブッキング番号（まとめて 1 回）。無ければコンテナ番号ごと（最大 10 本）。
function containerQueries(t: WatchTarget): Record<string, unknown>[] {
  const bl = normalizeNo(t.bl_no), bk = normalizeNo(t.booking_no);
  if (t.direction === 'import' && bl) return [{ blNoList: [bl] }];
  if (t.direction === 'export' && bk) return [{ bookingNoList: [bk] }];
  return (t.container_nos || []).map((c) => normalizeNo(c)).filter((c) => /^[A-Z]{4}\d{7}$/.test(c)).slice(0, 10).map((c) => ({ containerNo: c }));
}

async function runWatchBatch(deps: WatchDeps, n: number): Promise<BatchSummary> {
  const sum: BatchSummary = { picked: 0, ok: 0, nodata: 0, failed: 0, changed: 0, calls: 0, skipped: 0, saveErrors: 0 };
  const targets = await deps.pick(n);
  sum.picked = targets.length;
  const vesselCache = new Map<string, Promise<unknown | null>>();   // 同じ港・同じ本船は 1 回だけ呼ぶ
  for (const t of targets) {
    const nowMs = deps.now();
    if (deps.stopAt != null && nowMs > deps.stopAt) { sum.skipped++; continue; }   // 時間切れ：次の回に回す（保存もしない）
    const r: TargetResult = {
      preset_id: t.preset_id, ok: false, status: 'error', items: null, changes: [], state: 'active', state_note: null,
      urgent_at: null, error: null, checked_at: new Date(nowMs).toISOString(), calls: 0,
    };
    try {
      const qs = containerQueries(t);
      if (!qs.length) throw Object.assign(new Error('照合キー（B/L番号・ブッキング番号・コンテナ番号）が入っていません'), { code: 'no_keys' });
      const prefix = '/API/v2/ColinsViewers/Get' + (t.direction === 'export' ? 'Export' : 'Import');
      const recs: unknown[] = [];
      for (const q of qs) { r.calls++; sum.calls++; recs.push(...asArray(await deps.get(prefix + 'Containers', q))); }
      if (!recs.length) {
        r.ok = true; r.status = 'nodata'; r.state_note = 'COLINS に該当するコンテナがまだありません';
        sum.nodata++;
      } else {
        let items: Item[] = [];
        for (const rec of recs) items.push(...containerItems(rec, t.direction), ...vesselItems(rec));
        // 本船の動静（CY オープン／カットなど）：コンテナ側の本船の港と本船名・航海番号で探す（同じ本船は 1 回だけ）
        const seen = new Set<string>();
        for (const rec of recs) {
          const v = g(rec, 'vessel');
          const port = str(g(v, t.direction === 'export' ? 'portOfLoading.portCode' : 'portOfDischarge.portCode'));
          const name = str(g(v, 'vesselName')), voy = str(g(v, 'voyageNo'));
          if (!port || !name) continue;
          const key = port + '|' + name + '|' + (voy || '');
          if (seen.has(key)) continue; seen.add(key);
          let p = vesselCache.get(key);
          if (!p) {
            const q: Record<string, unknown> = { vesselName: name }; if (voy) q.voyageNo = voy;
            r.calls++; sum.calls++;
            p = deps.get(prefix + 'Vessels/' + encodeURIComponent(port), q).then((d) => {
              const list = asArray(d);
              return list.find((x) => str(g(x, 'vessel.vesselName')) === name && (!voy || str(g(x, 'vessel.voyageNo')) === voy)) ?? null;
            }).catch(() => null);   // 本船の動静が取れなくても、コンテナの確認は続ける
            vesselCache.set(key, p);
          }
          const vrec = await p;
          if (vrec) items.push(...vesselItems(vrec));
        }
        items = uniqItems(items);
        r.items = items;
        r.changes = diffItems(t.snapshot, items, nowMs);
        r.urgent_at = urgentAt(items, nowMs);
        const end = evaluateEnd(t.direction, recs, nowMs);
        r.state = end.state; r.state_note = end.note;
        // 「もう少し追う」を選んだ案件は、その時刻まで終了の確認を出さない
        const snooze = parseMs(t.ask_snooze_until);
        if (end.state === 'ask' && snooze != null && nowMs < snooze) { r.state = 'active'; r.state_note = null; }
        r.ok = true; r.status = 'ok';
        sum.ok++;
        if (r.changes.length) sum.changed++;
      }
    } catch (e) {
      r.ok = false; r.status = 'error'; r.error = errText(e);
      sum.failed++;
    }
    try { await deps.save(r); } catch (_e) { sum.saveErrors++; }   // 1 件の保存失敗で、残りの案件の確認を止めない
  }
  return sum;
}
// ======== watch.ts ここまで ========

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

// ---------- 予約実行（動静の自動確認）：合言葉を持つ予約からだけ呼ばれる ----------
const WATCH_BUDGET_MS = 100_000; // 1 回の実行は 100 秒まで（残りの案件は次の回に回す）

async function handleWatchRun(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { return fail(req, 400, 'bad_json', '送る内容（JSON）が読めません'); }
  if (body.action !== 'watch_run') return fail(req, 400, 'bad_action', '予約実行で使えるのは watch_run だけです');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey) return fail(req, 503, 'watch_not_configured', '予約実行に必要な設定（SUPABASE_SERVICE_ROLE_KEY）がありません');
  const n = Math.max(1, Math.min(10, Math.floor(Number(body.n)) || 5));
  const sb = createClient(SB_URL, serviceKey, { auth: { persistSession: false } });
  const started = Date.now();
  const ins = await sb.from('cp_watch_runs').insert({ started_at: new Date(started).toISOString() }).select('id').single();
  if (ins.error) return fail(req, 503, 'watch_tables_missing', '自動確認の表がありません（docs/sql/cp-watch.sql を実行してください）');
  const runId = (ins.data as { id: number } | null)?.id ?? null;

  const byId = new Map<string, WatchTarget>();
  const deps = {
    pick: async (k: number): Promise<WatchTarget[]> => {
      const r = await sb.rpc('cp_watch_pick', { p_n: k });
      if (r.error) throw new CpError('watch_pick_failed', 500, '確認する案件を選べませんでした（docs/sql/cp-watch.sql を実行してください）');
      const list = (r.data ?? []) as WatchTarget[];
      for (const t of list) byId.set(t.preset_id, t);
      return list;
    },
    get: async (path: string, query: Record<string, unknown>): Promise<unknown> => {
      if (!matchAllowed(path)) throw new CpError('path_not_allowed', 403, 'この API は許可されていません');
      const q = buildQuery(query);
      if (!q.ok) throw new CpError('bad_query', 400, q.reason);
      return (await callGet(path + q.qs)).data;
    },
    save: async (r: TargetResult): Promise<void> => {
      const tg = byId.get(r.preset_id);
      const upd: Record<string, unknown> = {
        last_checked_at: r.checked_at, last_status: r.status, last_error: r.error, updated_at: r.checked_at,
        consecutive_errors: r.status === 'error' ? (tg?.consecutive_errors ?? 0) + 1 : 0,
      };
      if (r.status === 'ok') {   // 該当なし・失敗のときは前回の写しを残す
        upd.snapshot = r.items; upd.urgent_at = r.urgent_at; upd.state = r.state; upd.state_note = r.state_note;
        if (r.state !== (tg?.state ?? 'active')) upd.state_at = r.checked_at;
      }
      const u = await sb.from('cp_watch_targets').update(upd).eq('preset_id', r.preset_id);
      if (u.error) throw new Error(truncate(u.error.message, 200));
      const rows: Record<string, unknown>[] = r.changes.slice(0, 200).map((c) => ({
        preset_id: r.preset_id, run_id: runId, detected_at: r.checked_at, k: c.k, scope: c.scope, label: c.label,
        old_val: c.from, new_val: c.to, kind: c.kind, sev: c.sev, note: c.note ?? null,
      }));
      if (r.status === 'ok' && r.state !== 'active') {
        rows.push({ preset_id: r.preset_id, run_id: runId, detected_at: r.checked_at, k: 'state', scope: '追跡',
          label: r.state === 'done' ? '追跡完了' : '終了の確認', old_val: null, new_val: r.state_note, kind: 'state',
          sev: r.state === 'done' ? 'info' : 'warn', note: null });
      }
      if (rows.length) {
        const c = await sb.from('cp_changes').insert(rows);
        if (c.error) throw new Error(truncate(c.error.message, 200));
      }
    },
    now: () => Date.now(),
    stopAt: started + WATCH_BUDGET_MS,
  };

  try {
    const sum = await runWatchBatch(deps, n);
    const note = sum.skipped ? '時間切れで ' + sum.skipped + ' 件を次回に回しました' : sum.saveErrors ? '保存に失敗した案件が ' + sum.saveErrors + ' 件あります' : null;
    await sb.from('cp_watch_runs').update({
      finished_at: new Date().toISOString(), picked: sum.picked, ok: sum.ok, nodata: sum.nodata, failed: sum.failed, changed: sum.changed, calls: sum.calls, note,
    }).eq('id', runId);
    console.log(JSON.stringify({ at: new Date().toISOString(), action: 'watch_run', run: runId, summary: sum }));
    return json(req, { ok: true, run_id: runId, summary: sum });   // 集計は summary にまとめる（sum.ok は「成功した件数」で、応答の ok と名前がぶつかるため）
  } catch (e) {
    const code = e instanceof CpError ? e.code : 'internal';
    const msg = e instanceof CpError ? e.message : '予期しないエラーです';
    await sb.from('cp_watch_runs').update({ finished_at: new Date().toISOString(), note: code + ': ' + truncate(msg, 150) }).eq('id', runId);
    console.log(JSON.stringify({ at: new Date().toISOString(), action: 'watch_run', run: runId, error: code }));
    return fail(req, e instanceof CpError ? e.status : 500, code, msg);
  }
}

// ---------- 入口 ----------
const hits = new Map<string, number[]>();

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsFor(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method', 'POST だけ使えます');

  // 予約実行（動静の自動確認）：合言葉のヘッダーが付いているときだけ。ログイン中の人向けの処理とは完全に分ける。
  const watchSecret = req.headers.get('x-cp-watch-secret');
  if (watchSecret !== null) {
    const expected = Deno.env.get('CP_WATCH_SECRET') ?? '';
    if (expected.length < 24 || !safeEqual(watchSecret, expected)) return fail(req, 401, 'unauthorized', '予約実行の合言葉が正しくありません');
    try { return await handleWatchRun(req); } catch (e) {
      console.error('cp-proxy watch unexpected', e instanceof Error ? e.message : e);
      return fail(req, 500, 'internal', '予期しないエラーです');
    }
  }

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
