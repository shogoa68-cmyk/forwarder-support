// ============================================================================
// Supabase Edge Function: drive-broker  （外部ストレージ PoC）
// ----------------------------------------------------------------------------
// Google Drive の `drive.file` ブローカー。オーナーのリフレッシュトークンで
// Drive を操作し、「ポータル親フォルダ」配下だけを扱う。私用ファイルは
// drive.file スコープにより一切見えない。
//
// 呼び出し元は Supabase JWT を持つチームメンバー（is_team_member()）に限定。
//
// 必要な環境変数（`supabase secrets set` で設定）:
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
// Supabase が自動注入: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
//
// アクション（POST JSON の action、または download は GET ?action=download&id=）:
//   init     : ポータルフォルダを用意して folderId を返す（無ければ作成）
//   list     : ポータルフォルダ直下のファイル一覧
//   upload   : { name, contentBase64, mimeType } をポータル配下にアップロード
//   download : ?action=download&id=<fileId> でファイルをストリーム返却
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const PORTAL_FOLDER_NAME = "フォワーダー支援"; // My Drive 直下に作るポータル親フォルダ名
const CONFIG_KEY = "portal_folder_id";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// オーナーのリフレッシュトークン → アクセストークン
async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
    client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
    refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) throw new Error("token refresh failed: " + (await res.text()));
  const data = await res.json();
  return data.access_token as string;
}

// ポータル親フォルダを用意（app_config に folderId を保持。無ければ Drive に作成）
// deno-lint-ignore no-explicit-any
async function ensurePortalFolder(admin: any, accessToken: string): Promise<string> {
  const { data } = await admin.from("app_config").select("value").eq("key", CONFIG_KEY).maybeSingle();
  if (data?.value) {
    const check = await fetch(`${DRIVE_API}/files/${data.value}?fields=id,trashed`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (check.ok) {
      const f = await check.json();
      if (!f.trashed) return data.value as string;
    }
  }
  // drive.file スコープでも My Drive 直下にフォルダを新規作成できる（作成物はアプリがアクセス可）
  const res = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: PORTAL_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!res.ok) throw new Error("folder create failed: " + (await res.text()));
  const folder = await res.json();
  await admin.from("app_config").upsert({ key: CONFIG_KEY, value: folder.id });
  return folder.id as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // --- 呼び出し元の検証（ログイン済み & チームメンバー）---
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await asUser.auth.getUser();
  if (!userData?.user) return json({ error: "unauthorized" }, 401);
  const { data: isMember, error: memErr } = await asUser.rpc("is_team_member");
  if (memErr) return json({ error: "membership check failed: " + memErr.message }, 500);
  if (!isMember) return json({ error: "forbidden (not a team member)" }, 403);

  const admin = createClient(supabaseUrl, serviceKey);

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    return json({ error: "google auth failed: " + String(e) }, 502);
  }

  const url = new URL(req.url);

  // --- download（GET・ストリーム返却）---
  if (req.method === "GET" && url.searchParams.get("action") === "download") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "id required" }, 400);
    const dl = await fetch(`${DRIVE_API}/files/${id}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!dl.ok) return json({ error: "download failed: " + (await dl.text()) }, 502);
    return new Response(dl.body, {
      headers: {
        ...CORS,
        "Content-Type": dl.headers.get("Content-Type") ?? "application/octet-stream",
      },
    });
  }

  // deno-lint-ignore no-explicit-any
  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    /* body 無しの呼び出しは許容 */
  }
  const action = payload.action ?? url.searchParams.get("action");

  try {
    const portalId = await ensurePortalFolder(admin, accessToken);

    if (action === "init") {
      return json({ ok: true, portalFolderId: portalId, portalFolderName: PORTAL_FOLDER_NAME });
    }

    if (action === "list") {
      const q = encodeURIComponent(`'${portalId}' in parents and trashed=false`);
      const res = await fetch(
        `${DRIVE_API}/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=modifiedTime desc`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) return json({ error: "list failed: " + (await res.text()) }, 502);
      const data = await res.json();
      return json({ ok: true, portalFolderId: portalId, files: data.files ?? [] });
    }

    if (action === "upload") {
      const { name, contentBase64, mimeType } = payload;
      if (!name || !contentBase64) return json({ error: "name and contentBase64 required" }, 400);
      const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
      const boundary = "----drivebroker" + crypto.randomUUID();
      const meta = JSON.stringify({ name, parents: [portalId] });
      const enc = new TextEncoder();
      const pre = enc.encode(
        `--${boundary}\r\n` +
          `Content-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
          `--${boundary}\r\n` +
          `Content-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`,
      );
      const post = enc.encode(`\r\n--${boundary}--`);
      const body = new Uint8Array(pre.length + bytes.length + post.length);
      body.set(pre, 0);
      body.set(bytes, pre.length);
      body.set(post, pre.length + bytes.length);
      const res = await fetch(
        `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );
      if (!res.ok) return json({ error: "upload failed: " + (await res.text()) }, 502);
      return json({ ok: true, file: await res.json() });
    }

    return json({ error: "unknown action: " + String(action) }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
