// ※ このファイルは scripts/cp-tests/build-edge-single.mjs が自動で作った「貼り付け用の 1 枚版」です。
//    元は supabase/functions/cp-webhook/{index.ts, logic.ts}。手で直さず、元を直してから作り直してください。
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

// ======== logic.ts（判断の部分）ここから ========
// ============================================================
// cp-webhook の「判断」部分（外に出ない純粋な関数だけ）。
// Deno（Edge Function）と Node（scripts/cp-tests/cp-webhook-test.mjs）の両方で動かして試験する。
// ※ 型の注釈だけを使い、enum など Node で動かせない書き方はしない。
// ============================================================

// 1 回の通知として受け付ける大きさの上限（これを超えるものは保存しない）
const MAX_BODY_BYTES = 256 * 1024;
// 1 回の呼び出しで保存する通知の最大件数（配列で届いたとき）
const MAX_ITEMS = 50;

// 貼り付けで混ざりがちな前後の空白・引用符を取り除く（シークレットトークン用）
function cleanSecret(v: unknown): string {
  return String(v == null ? '' : v).trim().replace(/^["'‘’“”]+|["'‘’“”]+$/g, '').trim();
}

// ---------- 署名の検証（HMAC-SHA256） ----------
// 仕様（引き継ぎ書 4.4・API利用ガイダンス P.34〜37）：受信した本文（文字列）を、シークレットトークンを鍵にして
// HMAC-SHA256 でハッシュし、ヘッダー x-cyberport-signature-256 と一致するかを確かめる。
// ヘッダーの文字表現（16進／Base64・「sha256=」の接頭辞の有無）は資料に明記がないため、どれでも受け付ける。
async function hmacSha256(secret: string, body: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
}
function toHex(u: Uint8Array): string {
  let s = '';
  for (const b of u) s += b.toString(16).padStart(2, '0');
  return s;
}
function toBase64(u: Uint8Array): string {
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
// 長さや途中の違いで処理時間が変わらないように、最後まで比べる（タイミング攻撃対策）
function timingSafeEqual(a: string, b: string): boolean {
  const A = new TextEncoder().encode(a), B = new TextEncoder().encode(b);
  let diff = A.length ^ B.length;
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) diff |= (A[i] ?? 0) ^ (B[i] ?? 0);
  return diff === 0;
}
async function verifySignature(header: string | null | undefined, secret: string, body: string): Promise<boolean> {
  if (!header || !secret) return false;
  let h = String(header).trim();
  h = h.replace(/^sha256\s*=\s*/i, '').trim();
  if (!h) return false;
  const mac = await hmacSha256(secret, body);
  const hex = toHex(mac), b64 = toBase64(mac);
  const b64url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // どの表現でも、全部の候補と比べる（一致の有無を、比べた順番から推測されないように）
  let ok = false;
  if (timingSafeEqual(h.toLowerCase(), hex)) ok = true;
  if (timingSafeEqual(h, b64)) ok = true;
  if (timingSafeEqual(h.replace(/=+$/, ''), b64.replace(/=+$/, ''))) ok = true;
  if (timingSafeEqual(h, b64url)) ok = true;
  return ok;
}

// ---------- 通知（PostToPartnerByWebhook）の読み取り ----------
// 項目名は公式の OpenAPI 仕様（v2.PostToPartnerByWebhook）に基づく。途中が欠けていても落ちないように読む。
function g(o: unknown, path: string): unknown {
  let v: unknown = o;
  for (const k of path.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}
function s(o: unknown, path: string): string | null {
  const v = g(o, path);
  return typeof v === 'string' && v !== '' ? v : null;
}

type EventRow = {
  dedupe_key: string;
  kind: string;
  history_id: string | null;
  operation_code: string | null;
  operation_name: string | null;
  trade_no: string | null;
  trade_type: string | null;
  bl_no: string | null;
  report_code: string | null;
  report_name: string | null;
  report_id: string | null;
  container_no: string | null;
  to_org_id: string | null;
  operated_at: string | null;
  payload: unknown;
};

// 何についての通知か（画面で絞り込みやすいように、ざっくり分ける）
function eventKind(p: unknown): string {
  if (g(p, 'notifyOperation.inMessage') != null) return 'message';   // 取引内のチャット
  if (g(p, 'notifyOperation.inNaccs') != null) return 'naccs';       // NACCS の電文
  if (g(p, 'notifyOperation.inReport') != null) return 'report';     // 帳票
  if (g(p, 'notifyOperation.inTask') != null) return 'task';
  if (g(p, 'notifyOperation.inProcess') != null) return 'process';
  if (g(p, 'notifyOperation.inTrade') != null) return 'trade';       // 取引そのもの
  return 'other';
}

function isoOrNull(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(buf));
}

// 同じ通知が再送されても 1 件だけ保存するための印。
// 履歴ID（操作 1 件ごとの ID）＋通知先の組織があればそれ、無ければ本文のハッシュ。
async function dedupeKey(p: unknown, fallbackText: string): Promise<string> {
  const hid = s(p, 'notifyOperation.historyId');
  const org = s(p, 'notifyToPartner.organizationId') ?? '';
  if (hid) return 'h:' + hid + '|' + org;
  return 'b:' + (await sha256Hex(fallbackText));
}

async function summarizeEvent(p: unknown, rawForHash: string): Promise<EventRow> {
  return {
    dedupe_key: await dedupeKey(p, rawForHash),
    kind: eventKind(p),
    history_id: s(p, 'notifyOperation.historyId'),
    operation_code: s(p, 'notifyOperation.operationType.operationTypeCode'),
    operation_name: s(p, 'notifyOperation.operationType.operationTypeName'),
    trade_no: s(p, 'notifyOperation.inTrade.tradeNo'),
    trade_type: s(p, 'notifyOperation.inTrade.tradeType'),
    bl_no: s(p, 'notifyOperation.inTrade.blNo'),
    report_code: s(p, 'notifyOperation.inReport.reportType.reportCode'),
    report_name: s(p, 'notifyOperation.inReport.reportType.reportName'),
    report_id: s(p, 'notifyOperation.inReport.reportId'),
    container_no: s(p, 'notifyOperation.inReport.container.containerNo'),
    to_org_id: s(p, 'notifyToPartner.organizationId'),
    operated_at: isoOrNull(s(p, 'notifyOperation.operatedAt')),
    payload: p,
  };
}
// ======== logic.ts ここまで ========

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
