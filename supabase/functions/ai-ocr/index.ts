// ============================================================
// 📷 AI OCR（見積書の画像から料金の明細を読む）用 Edge Function（Supabase / Deno）
//
// 役目：メンバーのブラウザと Claude API の間に立つ窓口。
//   ・API の鍵（ANTHROPIC_API_KEY）はここだけが持つ（ブラウザ・リポジトリには置かない）
//   ・送られてくるのは、画面で「表だけ切り抜き・社名などを黒塗り」した画像だけ（画面側で JPEG に作り直し、中の隠れた情報は落としてある）
//   ・画像・読み取り結果は保存しない・記録（ログ）にも書かない
//   ・ログイン済みのチームメンバーだけが使える（cp-proxy と同じ確認）
//
// 呼び方（POST・JSON・Authorization: Bearer <ログイン中のアクセストークン>）
//   {action:'status'}                                  → {ok, ready, reason, model}  使える状態か（鍵があるか・使う設定か）
//   {action:'read', image:'<base64>', mediaType:'image/jpeg'} → {ok, rows:[{name,qty,unit,ccy,price,amount,note}], remarks, unreadable}
//
// 必要な「秘密の設定」（supabase secrets set …・リポジトリには絶対に書かない）
//   ANTHROPIC_API_KEY  … Claude API の鍵（Claude Console で作る。API は法人向けの規約＝既定で学習に使われない）
//   AI_OCR_ENABLED     … 1 にすると使える（準備だけしておき、社内の確認が済んでから 1 にする）
//   AI_OCR_MODEL       … 省略時は claude-opus-5-5
//   AI_OCR_ALLOWED_ORIGINS … 画面を公開している URL（カンマ区切り。未設定なら localhost だけ）
//   ※ SUPABASE_URL / SUPABASE_ANON_KEY は Supabase が自動で渡す
// 手順は docs/AI-OCR-セットアップ.md
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';
import { allowRate, checkImage, cleanResult, isOriginAllowed, OUTPUT_SCHEMA, parseOrigins, readiness, SYSTEM_PROMPT } from './logic.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const rateLog = new Map<string, number[]>();

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const ok = isOriginAllowed(origin, parseOrigins(Deno.env.get('AI_OCR_ALLOWED_ORIGINS')));
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsFor(req), 'Content-Type': 'application/json' } });
const fail = (req: Request, status: number, code: string, message: string) => json(req, { ok: false, error: code, message }, status);

// 本人確認：ログイン中のチームメンバーか
async function authUser(req: Request): Promise<{ email: string } | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const userClient = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data, error } = await userClient.auth.getUser(auth.slice(7));
  if (error || !data?.user?.email) return null;
  const { data: isMember, error: e2 } = await userClient.rpc('is_team_member');
  if (e2 || isMember !== true) return null;
  return { email: data.user.email.toLowerCase() };
}

async function readImage(b64: string, mediaType: string, model: string) {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
        { type: 'text', text: 'この画像の見積の料金の明細を、決められた形の JSON で書き出してください。' },
      ],
    }],
  } as never);
  // deno-lint-ignore no-explicit-any
  const r = response as any;
  if (r.stop_reason === 'refusal') return { refused: true };
  if (r.stop_reason === 'max_tokens') return { tooLong: true };
  const text = (r.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch (_e) { return { badJson: true }; }
  return { result: cleanResult(parsed) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method', 'POST だけ受け付けます');
  const user = await authUser(req);
  if (!user) return fail(req, 401, 'login', 'ログインしたチームメンバーだけが使えます');
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { return fail(req, 400, 'bad_request', '送られた内容を読めませんでした'); }

  const st = readiness((k) => Deno.env.get(k));
  if (body.action === 'status') return json(req, { ok: true, ready: st.ready, reason: st.reason, model: st.model });
  if (body.action !== 'read') return fail(req, 400, 'bad_action', '使えない操作です');
  if (!st.ready) return fail(req, 503, st.reason === 'no_key' ? 'not_configured' : 'disabled', st.reason === 'no_key' ? 'AI 読み取りの鍵がまだ設定されていません（管理者の設定が必要です）' : 'AI 読み取りはまだ使えない設定です（管理者が AI_OCR_ENABLED を 1 にすると使えます）');
  const chk = checkImage(body.image, body.mediaType);
  if (!chk.ok) return fail(req, 400, chk.code, chk.message);
  if (!allowRate(rateLog, user.email, Date.now())) return fail(req, 429, 'rate_limited', '短い時間に続けて使われました。1 分ほど待ってからもう一度お試しください');

  try {
    const out = await readImage(body.image as string, body.mediaType as string, st.model);
    if ('refused' in out) return fail(req, 422, 'refused', 'この画像は読み取れませんでした（AI が読み取りを断りました）');
    if ('tooLong' in out) return fail(req, 422, 'too_long', '明細が多すぎて読み切れませんでした。表を分けて切り抜いてください');
    if ('badJson' in out) return fail(req, 502, 'bad_output', '読み取り結果の形が正しくありませんでした。もう一度お試しください');
    console.log(JSON.stringify({ event: 'ai_ocr_read', rows: out.result.rows.length, bytes: chk.bytes }));   // 件数と大きさだけ（中身・人は書かない）
    return json(req, { ok: true, ...out.result });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return fail(req, 429, 'upstream_rate', 'AI の利用が混み合っています。少し待ってからもう一度お試しください');
    if (e instanceof Anthropic.AuthenticationError) return fail(req, 503, 'bad_key', 'AI 読み取りの鍵が正しくありません（管理者が確認してください）');
    if (e instanceof Anthropic.APIConnectionError) return fail(req, 502, 'network', 'AI に接続できませんでした');
    if (e instanceof Anthropic.APIError) return fail(req, 502, 'upstream_error', 'AI の読み取りでエラーが起きました（' + (e as { status?: number }).status + '）');
    return fail(req, 502, 'network', 'AI に接続できませんでした');
  }
});
