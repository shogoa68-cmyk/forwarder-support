# 外部ストレージ PoC 手順（Google Drive `drive.file` ブローカー）

「ポータルフォルダ作成 ＋ Edge Function ブローカーで1ファイル上げ下げ」を動かすための手順。
設計は Notion「CargoBox 設計書 v1.0」の第3章・3B章を参照。

## 構成物（このリポジトリ）

| ファイル | 役割 |
|---|---|
| `supabase/functions/drive-broker/index.ts` | ブローカー本体（init/list/upload/download） |
| `supabase/config.toml` | `drive-broker` の `verify_jwt=false`（認証は関数内で実施） |
| `docs/supabase-drive-broker-setup.sql` | `app_config` テーブル（portal_folder_id 保持） |
| `フォワーダー支援/drive-poc.html` | 動作確認用の最小ページ |

## 全体の流れ

```
[あなた] GCPでOAuthクライアント作成 → drive.file を認可 → リフレッシュトークン取得
   ↓
[あなた] Supabase に secret 登録 → SQL適用 → 関数デプロイ
   ↓
[確認]  drive-poc.html を開く → ログイン → init → アップロード → 一覧 → ダウンロード
```

---

## STEP 1. Google Cloud で OAuth クライアントを作る

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成（既存でも可）。
2. 「APIとサービス」→「ライブラリ」で **Google Drive API** を有効化。
3. 「OAuth 同意画面」:
   - User Type: **External**
   - 公開ステータス: **テスト中（Testing）** のままでよい（審査不要・テストユーザー最大100人）
   - **テストユーザー**に自分のGoogleアカウント（`shogo.a68@gmail.com`）を追加
   - スコープに `https://www.googleapis.com/auth/drive.file` を追加
4. 「認証情報」→「認証情報を作成」→「OAuthクライアントID」:
   - アプリケーションの種類: **ウェブアプリケーション**
   - 承認済みのリダイレクトURIに **`https://developers.google.com/oauthplayground`** を追加（STEP 2 で使う）
   - 作成後の **クライアントID / クライアントシークレット** を控える

## STEP 2. リフレッシュトークンを取得（OAuth Playground が簡単）

1. [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) を開く。
2. 右上の⚙️（歯車）→ **Use your own OAuth credentials** にチェック → STEP 1 のクライアントID/シークレットを入力。
3. 左の Step 1 で、スコープ欄に手入力: `https://www.googleapis.com/auth/drive.file` → **Authorize APIs**。
4. 自分のGoogleアカウントで承認（「このアプリは確認されていません」→ テストユーザーなら続行可）。
5. Step 2 で **Exchange authorization code for tokens** → 表示される **Refresh token** を控える。
   - ※ `access_type=offline` 相当で refresh token が返る。Playground が付ける redirect URI を STEP 1 に登録済みであること。

## STEP 3. Supabase に secret を登録

Supabase CLI（`npm i -g supabase` などで導入）でログイン・リンク後:

```sh
supabase login
supabase link --project-ref uqofdnsolmrzxckmtpzv

supabase secrets set \
  GOOGLE_CLIENT_ID="＜STEP1のクライアントID＞" \
  GOOGLE_CLIENT_SECRET="＜STEP1のシークレット＞" \
  GOOGLE_REFRESH_TOKEN="＜STEP2のリフレッシュトークン＞"
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` は Supabase が関数に自動注入するため設定不要。

## STEP 4. テーブル（app_config）を作成

Supabase ダッシュボード → SQL Editor で `docs/supabase-drive-broker-setup.sql` を実行。
（`is_team_member()` 関数は既存前提。無い場合はクラウド共有基盤のSQLを先に適用すること）

## STEP 5. Edge Function をデプロイ

```sh
supabase functions deploy drive-broker --project-ref uqofdnsolmrzxckmtpzv
```

`config.toml` の `[functions.drive-broker] verify_jwt = false` が効くため、CORSプリフライトが通り、
認証は関数内の `getUser()` + `is_team_member()` で行われる。

## STEP 6. 動作確認

1. `フォワーダー支援/` をローカルサーバ or 公開URLで開き、`drive-poc.html` にアクセス。
   - 例: `python3 -m http.server 18765` → `http://localhost:18765/フォワーダー支援/drive-poc.html`
   - ⚠️ Supabase の Authentication → URL Configuration の **Redirect URLs** に、開くURL（localhost含む）を登録しておくこと。
2. **Google でログイン**（allowed_emails に登録済みのメンバーであること）。
3. **init 実行** → My Drive 直下に「フォワーダー支援」フォルダが作成され、folderId が返る。
4. **ファイル選択 → アップロード** → そのフォルダ配下に保存される。
5. **一覧を更新 → ダウンロード** で往復を確認。
6. 自分のDriveで「フォワーダー支援」フォルダが出来ており、**私用ファイルには一切触れていない**ことを確認。

---

## PoC の範囲と、本実装への宿題

- **範囲**: 1つのポータルフォルダ直下での upload / list / download。認証＝ログイン＋is_team_member。
- **未対応（本実装で対応）**:
  - スコープ別サブフォルダ（01_ナレッジ/02_見積案件/03_顧客）への振り分け
  - ロール（admin/member/viewer）による操作制限（削除は admin のみ 等）
  - 大容量ファイル（現状 base64・JSON 経由なので小さめ想定。resumable upload 化）
  - ダウンロードの署名付き短時間URL化（現状は関数ストリーム）
  - リフレッシュトークンのローテーション・失効対応
  - アカウント移行（個人→会社代表 / Shared Drive）ランブック
