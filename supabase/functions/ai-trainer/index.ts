// ============================================================
// 🎓 AI トレーナー（アプリの使い方の質問に答える）用 Edge Function（Supabase / Deno）
//
// 役目：メンバーのブラウザと Claude API の間に立つ窓口（作りは ai-ocr と同じ）。
//   ・API の鍵（ANTHROPIC_API_KEY）はここだけが持つ（ブラウザ・リポジトリには置かない）
//   ・送られてくるのは「質問の文・直前のやりとり・いまの画面の名前・マニュアルの抜き書き」だけ（案件の中身は送らない作り）
//   ・質問・答えは保存しない・記録（ログ）にも書かない（件数と文字数だけ）
//   ・ログイン済みのチームメンバーだけが使える
//
// 呼び方（POST・JSON・Authorization: Bearer <ログイン中のアクセストークン>）
//   {action:'status'} → {ok, ready, reason, model}
//   {action:'ask', question, history:[{role,text}], screen, level, excerpts:[{id,title,text,lessons}], toc:[{id,title}]}
//     → {ok, answer, chapters:[id], lesson}
//
// 必要な「秘密の設定」（supabase secrets set …・リポジトリには絶対に書かない）
//   ANTHROPIC_API_KEY   … Claude API の鍵（AI OCR と同じ鍵でよい）
//   AI_TRAINER_ENABLED  … 1 にすると使える（社内の確認が済んでから 1 にする）
//   AI_TRAINER_MODEL    … 省略時は claude-opus-5-5
//   AI_TRAINER_ALLOWED_ORIGINS … 画面を公開している URL（カンマ区切り。未設定なら AI_OCR_ALLOWED_ORIGINS、それも無ければ localhost だけ）
// 手順は docs/AIトレーナー-セットアップ.md
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';
import { allowRate, buildMessages, checkAsk, cleanAnswer, isOriginAllowed, OUTPUT_SCHEMA, parseOrigins, readiness, SYSTEM_PROMPT } from './logic.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const rateLog = new Map<string, number[]>();

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const raw = Deno.env.get('AI_TRAINER_ALLOWED_ORIGINS') || Deno.env.get('AI_OCR_ALLOWED_ORIGINS');
  const ok = isOriginAllowed(origin, parseOrigins(raw));
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method', 'POST だけ受け付けます');
  const user = await authUser(req);
  if (!user) return fail(req, 401, 'login', 'ログインしたチームメンバーだけが使えます');
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { return fail(req, 400, 'bad_request', '送られた内容を読めませんでした'); }

  const st = readiness((k) => Deno.env.get(k));
  if (body.action === 'status') return json(req, { ok: true, ready: st.ready, reason: st.reason, model: st.model });
  if (body.action !== 'ask') return fail(req, 400, 'bad_action', '使えない操作です');
  if (!st.ready) return fail(req, 503, st.reason === 'no_key' ? 'not_configured' : 'disabled', 'AI トレーナーはまだ使えない設定です（管理者の設定が必要です）');
  const chk = checkAsk(body);
  if (!chk.ok) return fail(req, 400, chk.code, chk.message);
  if (!allowRate(rateLog, user.email, Date.now())) return fail(req, 429, 'rate_limited', '短い時間に続けて質問されました。1 分ほど待ってからもう一度どうぞ');

  try {
    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
    const response = await client.beta.messages.create({
      model: st.model,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: buildMessages(chk.ask),
    } as never);
    // deno-lint-ignore no-explicit-any
    const r = response as any;
    if (r.stop_reason === 'refusal') return fail(req, 422, 'refused', 'この質問には答えられませんでした。言葉を変えて聞いてみてください');
    if (r.stop_reason === 'max_tokens') return fail(req, 422, 'too_long', '答えが長くなりすぎました。質問を短くしてみてください');
    const text = (r.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch (_e) { return fail(req, 502, 'bad_output', '答えの形が正しくありませんでした。もう一度どうぞ'); }
    const out = cleanAnswer(parsed, chk.ask);
    console.log(JSON.stringify({ event: 'ai_trainer_ask', qlen: chk.ask.question.length, excerpts: chk.ask.excerpts.length }));   // 件数と長さだけ（中身・人は書かない）
    return json(req, { ok: true, ...out });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return fail(req, 429, 'upstream_rate', 'AI が混み合っています。少し待ってからもう一度どうぞ');
    if (e instanceof Anthropic.AuthenticationError) return fail(req, 503, 'bad_key', 'AI の鍵が正しくありません（管理者が確認してください）');
    if (e instanceof Anthropic.APIConnectionError) return fail(req, 502, 'network', 'AI に接続できませんでした');
    if (e instanceof Anthropic.APIError) return fail(req, 502, 'upstream_error', 'AI でエラーが起きました（' + (e as { status?: number }).status + '）');
    return fail(req, 502, 'network', 'AI に接続できませんでした');
  }
});
