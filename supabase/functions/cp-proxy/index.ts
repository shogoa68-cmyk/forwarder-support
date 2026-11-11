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
import { allowRate, backoffMs, buildQuery, classifyStatus, formBody, isOriginAllowed, matchAllowed, parseOrigins, resolveConfig, safeEqual, tokenFromResponse, truncate } from './logic.ts';
import { runWatchBatch } from './watch.ts';
import type { TargetResult, WatchTarget } from './watch.ts';

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
