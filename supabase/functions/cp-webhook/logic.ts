// ============================================================
// cp-webhook の「判断」部分（外に出ない純粋な関数だけ）。
// Deno（Edge Function）と Node（scripts/cp-tests/cp-webhook-test.mjs）の両方で動かして試験する。
// ※ 型の注釈だけを使い、enum など Node で動かせない書き方はしない。
// ============================================================

// 1 回の通知として受け付ける大きさの上限（これを超えるものは保存しない）
export const MAX_BODY_BYTES = 256 * 1024;
// 1 回の呼び出しで保存する通知の最大件数（配列で届いたとき）
export const MAX_ITEMS = 50;

// 貼り付けで混ざりがちな前後の空白・引用符を取り除く（シークレットトークン用）
export function cleanSecret(v: unknown): string {
  return String(v == null ? '' : v).trim().replace(/^["'‘’“”]+|["'‘’“”]+$/g, '').trim();
}

// ---------- 署名の検証（HMAC-SHA256） ----------
// 仕様（引き継ぎ書 4.4・API利用ガイダンス P.34〜37）：受信した本文（文字列）を、シークレットトークンを鍵にして
// HMAC-SHA256 でハッシュし、ヘッダー x-cyberport-signature-256 と一致するかを確かめる。
// ヘッダーの文字表現（16進／Base64・「sha256=」の接頭辞の有無）は資料に明記がないため、どれでも受け付ける。
export async function hmacSha256(secret: string, body: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
}
export function toHex(u: Uint8Array): string {
  let s = '';
  for (const b of u) s += b.toString(16).padStart(2, '0');
  return s;
}
export function toBase64(u: Uint8Array): string {
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
// 長さや途中の違いで処理時間が変わらないように、最後まで比べる（タイミング攻撃対策）
export function timingSafeEqual(a: string, b: string): boolean {
  const A = new TextEncoder().encode(a), B = new TextEncoder().encode(b);
  let diff = A.length ^ B.length;
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) diff |= (A[i] ?? 0) ^ (B[i] ?? 0);
  return diff === 0;
}
export async function verifySignature(header: string | null | undefined, secret: string, body: string): Promise<boolean> {
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

export type EventRow = {
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
export function eventKind(p: unknown): string {
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

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(buf));
}

// 同じ通知が再送されても 1 件だけ保存するための印。
// 履歴ID（操作 1 件ごとの ID）＋通知先の組織があればそれ、無ければ本文のハッシュ。
export async function dedupeKey(p: unknown, fallbackText: string): Promise<string> {
  const hid = s(p, 'notifyOperation.historyId');
  const org = s(p, 'notifyToPartner.organizationId') ?? '';
  if (hid) return 'h:' + hid + '|' + org;
  return 'b:' + (await sha256Hex(fallbackText));
}

export async function summarizeEvent(p: unknown, rawForHash: string): Promise<EventRow> {
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
