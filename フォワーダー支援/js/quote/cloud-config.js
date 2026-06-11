// ========== ☁️ クラウド共有 接続設定 (Supabase) ==========
//
// ※ ここに書く publishableKey は「ブラウザ公開前提」の安全なキー。
//    アクセス制御は Supabase 側の RLS（行レベルセキュリティ）と
//    allowed_emails テーブルで行うため、リポジトリにコミットして問題ない。
//
// ※ secret key（sb_secret_... / service_role）は絶対にここへ書かない・コミットしない。
//
// 別プロジェクトに差し替えるときは、この 2 値を書き換えるだけでよい。

window.CLOUD_CONFIG = {
  url:            'https://uqofdnsolmrzxckmtpzv.supabase.co',
  publishableKey: 'sb_publishable_lZE95xEK5bHMI_CWPTg8-g_L6lLeAi7',
  table:          'quote_presets',
  attachmentBucket: 'quote-attachments',
};
