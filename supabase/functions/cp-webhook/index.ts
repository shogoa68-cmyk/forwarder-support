// ============================================================
// 📨 サイバーポート（Cyber Port Ver.2）Webhook の受け口 Edge Function（Supabase / Deno）
//
// 役目：サイバーポートが「取引・帳票・メッセージ・NACCS電文などの操作があった」と POST で知らせてくる通知を受け取り、
//       **署名（HMAC-SHA256）が正しいものだけ**を Supabase の表 `cp_events` に保存する。画面（CP(TEST)）が新着を表示する。
//   ・この関数は、ブラウザではなく**サイバーポートのサーバーから**呼ばれる（ログイン情報は付かない）＝ JWT の検証はオフで置く
//   ・代わりに、シークレットトークンでの署名の照合が、入口の確認になる（合わないものは 401 で捨てる）
//   ・保存できるのは、この関数だけ（表の書き込み権限は service_role のみ）
//
// 受ける通知：POST・JSON（本文は v2.PostToPartnerByWebhook。配列で届いても受け付ける）
//   ヘッダー x-cyberport-signature-256 … 本文を HMAC-SHA256（鍵＝シークレットトークン）でハッシュした値
//
// 必要な「秘密の設定」（supabase secrets set …・リポジトリには絶対に書かない）
//   CP_WEBHOOK_SECRET … サイバーポートの管理者画面で、この Webhook に設定した「シークレットトークン」と同じ値
//   ※ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で渡す
// 表の作成は docs/sql/cp-events.sql。手順は docs/サイバーポート連携-Webhook.md
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { MAX_BODY_BYTES, MAX_ITEMS, cleanSecret, summarizeEvent, verifySignature } from './logic.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  // 鍵は呼び出しのたびに読む（secrets を直したあとも、再デプロイなしで反映される）
  const secret = cleanSecret(Deno.env.get('CP_WEBHOOK_SECRET'));
  if (!secret) {
    console.error(JSON.stringify({ event: 'webhook_not_configured' }));
    return json({ ok: false, error: 'not_configured' }, 503);
  }

  // 大きすぎるものは、読み込む前に断る
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ ok: false, error: 'too_large' }, 413);
  const body = await req.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return json({ ok: false, error: 'too_large' }, 413);

  // 署名の確認（合わなければ、本文は読まずに捨てる。記録に残すのは「ヘッダーの有無」と大きさだけ）
  const sig = req.headers.get('x-cyberport-signature-256');
  if (!(await verifySignature(sig, secret, body))) {
    console.warn(JSON.stringify({ event: 'webhook_bad_signature', hasHeader: !!sig, bytes: body.length }));
    return json({ ok: false, error: 'bad_signature' }, 401);
  }

  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch (_e) { return json({ ok: false, error: 'bad_json' }, 400); }
  const items = (Array.isArray(parsed) ? parsed : [parsed]).filter((x) => x && typeof x === 'object').slice(0, MAX_ITEMS);
  if (!items.length) return json({ ok: false, error: 'empty' }, 400);

  const rows = [];
  for (const it of items) rows.push(await summarizeEvent(it, JSON.stringify(it)));

  // 同じ通知が再送されても 1 件だけ（dedupe_key が同じものは無視する）
  const { error } = await admin.from('cp_events').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  if (error) {
    // 保存できなかったときは 500 を返す（サイバーポート側が再送してくれる可能性がある）
    console.error(JSON.stringify({ event: 'webhook_store_failed', message: String(error.message ?? error).slice(0, 200) }));
    return json({ ok: false, error: 'store_failed' }, 500);
  }
  console.log(JSON.stringify({ event: 'webhook_stored', n: rows.length, kinds: rows.map((r) => r.kind) }));
  return json({ ok: true, received: rows.length });
});
