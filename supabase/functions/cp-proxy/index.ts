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
// 必要な「秘密の設定」（supabase secrets set …・リポジトリには絶対に書かない）
//   CP_CLIENT_ID / CP_CLIENT_SECRET … サイバーポートから払い出された接続情報
//   CP_ALLOWED_ORIGINS … 画面を公開している URL（カンマ区切り。例：https://example.github.io）
//   CP_BASE_URL   … 省略時 https://api.cyber-port.net
//   CP_TOKEN_URL  … 省略時 <CP_BASE_URL>/vendor-auth/token（トークンの取得先が違うと分かったときだけ設定）
//   ※ SUPABASE_URL / SUPABASE_ANON_KEY は Supabase が自動で渡す
// 手順は docs/サイバーポート連携-セットアップ.md
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { allowRate, backoffMs, buildQuery, classifyStatus, matchAllowed, tokenExpiryMs, truncate } from './logic.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const ORIGINS = (Deno.env.get('CP_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_BODY = 1_000_000; // 相手の応答は 1MB まで（大きすぎる応答は返さない）
const MAX_ATTEMPTS = 3;     // 通信エラー／相手先のエラーは最大 3 回まで（指数バックオフ）

// ---------- 共通：CORS ----------
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  // 許可リストが空のときは localhost だけ通す（うっかり全世界に開けない）
  const ok = ORIGINS.length ? ORIGINS.includes(origin) : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
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
function cfg() {
  const base = (Deno.env.get('CP_BASE_URL') ?? 'https://api.cyber-port.net').replace(/\/$/, '');
  return {
    id: Deno.env.get('CP_CLIENT_ID') ?? '',
    secret: Deno.env.get('CP_CLIENT_SECRET') ?? '',
    base,
    tokenUrl: Deno.env.get('CP_TOKEN_URL') ?? base + '/vendor-auth/token',
  };
}

class CpError extends Error {
  code: string; status: number; extra: Record<string, unknown>;
  constructor(code: string, status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message); this.code = code; this.status = status; this.extra = extra;
  }
}

// ---------- トークン（ベンダー/システム認証） ----------
let _tok: { v: string; exp: number } | null = null;
async function getToken(force = false): Promise<string> {
  if (!force && _tok && _tok.exp > Date.now()) return _tok.v;
  const c = cfg();
  if (!c.id || !c.secret) throw new CpError('cp_not_configured', 503, 'サイバーポートの接続情報が未設定です（CP_CLIENT_ID / CP_CLIENT_SECRET）');
  let r: Response;
  try {
    r = await fetch(c.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ clientId: c.id, clientSecret: c.secret }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (_e) {
    throw new CpError('token_network', 502, 'トークンの取得先に接続できませんでした（CP_TOKEN_URL を確認してください）');
  }
  const text = await r.text().catch(() => '');
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text); } catch (_e) { /* 本文が JSON でないとき */ }
  const token = typeof j.token === 'string' ? j.token : '';
  if (!r.ok || !token) {
    // 秘密（client_secret）は送り返さない。相手先の説明（detail）だけを短く添える。
    const detail = typeof j.detail === 'string' ? truncate(j.detail, 200) : truncate(text, 120);
    throw new CpError('token_failed', 502, 'トークンを取得できませんでした（' + r.status + '）。client_id / client_secret を確認してください', { upstreamStatus: r.status, detail });
  }
  _tok = { v: token, exp: tokenExpiryMs(token, Date.now()) };
  return token;
}

// ---------- 読み取り API を 1 回呼ぶ（認証切れ 1 回・通信/5xx は最大 3 回まで再試行） ----------
async function callGet(pathAndQuery: string): Promise<{ status: number; data: unknown }> {
  const c = cfg();
  let refreshed = false;
  let lastErr: CpError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const token = await getToken();
    let r: Response;
    try {
      r = await fetch(c.base + pathAndQuery, {
        method: 'GET',
        headers: { 'X-Authorization': token, Accept: 'application/json' },
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
    if ((r.status === 401) && !refreshed) { refreshed = true; _tok = null; attempt--; continue; }
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
      await getToken(true); // 取り直して、いまの接続情報で本当に通るか確かめる
      console.log(JSON.stringify({ at: new Date().toISOString(), who: user.email, action: 'ping', ok: true }));
      return json(req, { ok: true, message: 'トークンを取得できました（接続情報は有効です）', tokenHost: new URL(c.tokenUrl).host, apiHost: new URL(c.base).host });
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
