// ============================================================
// 📁 作業フォルダ用 Edge Function（Supabase / Deno）
//
// 役目：メンバーのブラウザと「管理者の Google ドライブ」の間に立つ窓口。
//   ・メンバーは Google ドライブを直接さわらない（管理者のドライブの鍵はここだけが持つ）
//   ・ファイルの持ち主は常に管理者になる → 容量は管理者のドライブから使われる
//   ・誰がどれだけ使っているか／どのフォルダにあるかは Supabase の wf_nodes 表で管理
//
// 呼び方（POST・JSON・Authorization: Bearer <ログイン中のアクセストークン>）
//   {action:'init',     parent_id, name, size, mime}   → ブラウザからドライブへ直接アップロードするための入口 URL を返す
//   {action:'complete', parent_id, name, drive_file_id, mime} → アップロード完了の登録（サイズはドライブ側で再確認）
//   {action:'download', id}                            → ファイルの中身をそのまま返す（ストリーム）
//   {action:'purge',    ids:[...]}                     → ドライブのファイルごと完全に削除（フォルダは中身も）
//
// 必要な「秘密の設定」（supabase secrets set …・リポジトリには絶対に書かない）
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN … 管理者のドライブの鍵
//   WF_ALLOWED_ORIGINS … 画面を公開している URL（カンマ区切り。例：https://example.github.io）
//   WF_MAX_FILE_BYTES  … 1 ファイルの上限（省略時 2GB）
//   ※ SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で渡す
// 手順は docs/作業フォルダ-セットアップ.md
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ORIGINS = (Deno.env.get('WF_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_FILE = Number(Deno.env.get('WF_MAX_FILE_BYTES') ?? 2 * 1024 * 1024 * 1024);

const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

// ---------- 共通：CORS（ブラウザから呼べるようにする） ----------
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  // 許可リストが空のときは localhost だけ通す（うっかり全世界に開けない）
  const ok = ORIGINS.length ? ORIGINS.includes(origin) : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'content-disposition, content-length',
    'Vary': 'Origin',
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsFor(req), 'Content-Type': 'application/json' } });
const fail = (req: Request, status: number, code: string, message: string) => json(req, { error: code, message }, status);

// ---------- 本人確認：ログイン中のメンバーか ----------
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

// ---------- Google ドライブ ----------
let _tok: { v: string; exp: number } | null = null;
async function driveToken(): Promise<string> {
  if (_tok && _tok.exp > Date.now() + 60_000) return _tok.v;
  // 鍵は毎回読む（`supabase secrets set` で更新したとき、起動済みのインスタンスが古い鍵を持ち続けないように）
  const gId = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
  const gSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
  const gRefresh = Deno.env.get('GOOGLE_REFRESH_TOKEN') ?? '';
  if (!gId || !gSecret || !gRefresh) throw new Error('drive_not_configured');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: gId, client_secret: gSecret, refresh_token: gRefresh, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('drive_auth_failed:' + (j.error ?? r.status));
  _tok = { v: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return _tok.v;
}
async function drive(path: string, init: RequestInit = {}, base = 'https://www.googleapis.com/drive/v3'): Promise<Response> {
  const t = await driveToken();
  return fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), Authorization: 'Bearer ' + t } });
}

// 保存先フォルダ（管理者のドライブの中。無ければ最初の 1 回だけ自動で作る）
async function rootFolderId(): Promise<string> {
  const get = async () => (await admin.from('wf_config').select('value').eq('key', 'drive_root_id').maybeSingle()).data?.value as string | undefined;
  const have = await get();
  if (have) return have;
  const r = await drive('/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'フォワーダー支援 作業フォルダ', mimeType: 'application/vnd.google-apps.folder' }),
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error('drive_root_failed:' + r.status);
  await admin.from('wf_config').upsert({ key: 'drive_root_id', value: j.id }, { onConflict: 'key', ignoreDuplicates: true });
  const final = (await get()) ?? j.id;
  if (final !== j.id) await drive('/files/' + j.id, { method: 'DELETE' });   // 同時に作った余りを片付ける
  return final;
}

async function quotaBytes(): Promise<number> {
  const { data } = await admin.from('wf_config').select('value').eq('key', 'quota_bytes_drive').maybeSingle();
  return Number(data?.value ?? 5 * 1024 * 1024 * 1024);
}
async function usedBytes(email: string): Promise<number> {
  const { data, error } = await admin.rpc('wf_used_bytes', { p_email: email });
  if (error) throw new Error('db_error:' + error.message);
  return Number(data ?? 0);
}

// ---------- 入力の検査 ----------
function cleanName(n: unknown): string | null {
  if (typeof n !== 'string') return null;
  const s = n.normalize('NFC').trim();
  if (!s || s.length > 255 || /[\/\\]/.test(s) || s === '.' || s === '..') return null;
  return s;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function checkParent(email: string, parentId: unknown): Promise<string | null | false> {
  if (parentId === null || parentId === undefined || parentId === '') return null;
  if (typeof parentId !== 'string' || !UUID.test(parentId)) return false;
  const { data } = await admin.from('wf_nodes').select('id,kind,owner_email,trashed_at').eq('id', parentId).maybeSingle();
  if (!data || data.kind !== 'folder' || data.owner_email !== email || data.trashed_at) return false;
  return parentId;
}
async function nameTaken(email: string, parentId: string | null, name: string): Promise<boolean> {
  let q = admin.from('wf_nodes').select('id').eq('owner_email', email).is('trashed_at', null).ilike('name', name.replace(/[%_\\]/g, (m) => '\\' + m));
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  const { data } = await q.limit(1);
  return (data ?? []).length > 0;
}

// ---------- 各操作 ----------
async function actInit(req: Request, email: string, b: any) {
  const name = cleanName(b.name);
  const size = Number(b.size);
  if (!name) return fail(req, 400, 'bad_name', 'ファイル名が正しくありません');
  if (!Number.isFinite(size) || size < 0 || size > MAX_FILE) {
    return fail(req, 413, 'too_large', `1 ファイルの上限は ${Math.floor(MAX_FILE / 1048576)}MB です`);
  }
  const parent = await checkParent(email, b.parent_id);
  if (parent === false) return fail(req, 400, 'bad_parent', '保存先のフォルダが見つかりません');
  if (await nameTaken(email, parent, name)) return fail(req, 409, 'name_exists', '同じ名前のファイルがあります');
  const [used, quota] = [await usedBytes(email), await quotaBytes()];
  if (used + size > quota) return fail(req, 507, 'quota', '容量の上限を超えます（空き容量が足りません）');

  const root = await rootFolderId();
  const mime = typeof b.mime === 'string' && b.mime ? b.mime : 'application/octet-stream';
  // ブラウザが直接アップロードできるよう、リクエスト元の Origin を添えて「再開できるアップロード」を開始する
  const origin = req.headers.get('origin') ?? '';
  const r = await drive('/files?uploadType=resumable&fields=id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(size),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ name, parents: [root], appProperties: { wf_owner: email } }),
  }, 'https://www.googleapis.com/upload/drive/v3');
  const loc = r.headers.get('location');
  if (!r.ok || !loc) return fail(req, 502, 'drive_error', 'ドライブへの接続に失敗しました（' + r.status + '）');
  return json(req, { upload_url: loc });
}

async function actComplete(req: Request, email: string, b: any) {
  const name = cleanName(b.name);
  const fid = typeof b.drive_file_id === 'string' ? b.drive_file_id : '';
  if (!name || !/^[A-Za-z0-9_-]{10,}$/.test(fid)) return fail(req, 400, 'bad_request', '登録の内容が正しくありません');
  const parent = await checkParent(email, b.parent_id);
  if (parent === false) return fail(req, 400, 'bad_parent', '保存先のフォルダが見つかりません');

  // ドライブ側で実在・持ち主・大きさを確認（ブラウザの申告は信用しない）
  const root = await rootFolderId();
  const r = await drive('/files/' + fid + '?fields=id,size,parents,appProperties');
  const f = await r.json().catch(() => ({}));
  if (!r.ok || !f.id || !(f.parents ?? []).includes(root) || f.appProperties?.wf_owner !== email) {
    return fail(req, 400, 'not_found', 'アップロードしたファイルを確認できません');
  }
  const size = Number(f.size ?? 0);
  const discard = () => drive('/files/' + fid, { method: 'DELETE' }).catch(() => {});
  if (await usedBytes(email) + size > await quotaBytes()) { await discard(); return fail(req, 507, 'quota', '容量の上限を超えます'); }
  if (await nameTaken(email, parent, name)) { await discard(); return fail(req, 409, 'name_exists', '同じ名前のファイルがあります'); }

  const { data, error } = await admin.from('wf_nodes').insert({
    owner_email: email, parent_id: parent, kind: 'file', name, size,
    mime: typeof b.mime === 'string' ? b.mime.slice(0, 200) : null, drive_file_id: fid,
  }).select().single();
  if (error) { await discard(); return fail(req, 409, 'db_error', error.message); }
  return json(req, { node: data });
}

async function actDownload(req: Request, email: string, b: any) {
  if (typeof b.id !== 'string' || !UUID.test(b.id)) return fail(req, 400, 'bad_request', 'id が正しくありません');
  const { data } = await admin.from('wf_nodes').select('name,mime,size,drive_file_id,kind')
    .eq('id', b.id).eq('owner_email', email).maybeSingle();
  if (!data || data.kind !== 'file' || !data.drive_file_id) return fail(req, 404, 'not_found', 'ファイルが見つかりません');
  const r = await drive('/files/' + data.drive_file_id + '?alt=media');
  if (!r.ok || !r.body) return fail(req, 502, 'drive_error', 'ドライブからの取得に失敗しました（' + r.status + '）');
  return new Response(r.body, {
    status: 200,
    headers: {
      ...corsFor(req),
      'Content-Type': data.mime || 'application/octet-stream',
      'Content-Length': String(data.size),
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(data.name),
      'Cache-Control': 'private, no-store',
    },
  });
}

async function actPurge(req: Request, email: string, b: any) {
  const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === 'string' && UUID.test(x)) : [];
  if (!ids.length || ids.length > 500) return fail(req, 400, 'bad_request', '削除する項目の指定が正しくありません');
  // 自分の持ち物だけに絞り、フォルダは中身（子孫）まで SQL でまとめて集める（1000 行の上限に引っかからない）
  const { data: tree, error: te } = await admin.rpc('wf_collect_tree', { p_email: email, p_ids: ids });
  if (te) return fail(req, 500, 'db_error', te.message);
  const driveIds: string[] = (tree ?? []).map((r: { drive_file_id: string | null }) => r.drive_file_id).filter(Boolean);
  const topIds: string[] = (tree ?? []).map((r: { node_id: string }) => r.node_id).filter((id: string) => ids.includes(id));
  // 先にドライブのファイルを消す（既に無い 404/410 は成功扱い）。1 つでも失敗したら表は消さない＝取り残しを防ぐ
  for (const fid of driveIds) {
    const r = await drive('/files/' + fid, { method: 'DELETE' });
    if (!r.ok && r.status !== 404 && r.status !== 410) return fail(req, 502, 'drive_error', 'ドライブ上の削除に失敗しました（' + r.status + '）');
  }
  const { error } = await admin.from('wf_nodes').delete().eq('owner_email', email).in('id', topIds);   // 子は on delete cascade
  if (error) return fail(req, 500, 'db_error', error.message);
  return json(req, { deleted: topIds.length, files: driveIds.length });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method', 'POST のみ');
  try {
    const user = await authUser(req);
    if (!user) return fail(req, 401, 'unauthorized', 'ログインが必要です（チームメンバーのみ使えます）');
    const b = await req.json().catch(() => ({}));
    switch (b.action) {
      case 'init': return await actInit(req, user.email, b);
      case 'complete': return await actComplete(req, user.email, b);
      case 'download': return await actDownload(req, user.email, b);
      case 'purge': return await actPurge(req, user.email, b);
      default: return fail(req, 400, 'bad_action', '不明な操作です');
    }
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (m.startsWith('drive_not_configured')) return fail(req, 503, 'not_configured', '管理者のドライブの接続が未設定です');
    // 鍵の期限切れ（Google の「テスト中」のアプリは、鍵が 7 日で切れる）。メンバーには管理者へ知らせるよう案内する
    if (m.startsWith('drive_auth_failed')) {
      console.error('[workfolder] drive token problem:', m);
      return fail(req, 503, 'token_expired', '管理者のドライブとの接続が切れています。管理者に「作業フォルダの鍵の更新」を依頼してください。');
    }
    console.error('[workfolder]', m);
    return fail(req, 500, 'server_error', 'サーバーでエラーが起きました');
  }
});
