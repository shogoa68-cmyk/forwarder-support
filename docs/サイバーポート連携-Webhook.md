# サイバーポート連携：Webhook（通知を受け取る）

サイバーポートで操作（帳票の提出・メッセージ送信・EDIFACT 受信など）があると、サイバーポートがこちらへ「通知」を送ってくる仕組みです。
受け口は Supabase の Edge Function `cp-webhook`、保存先は表 `cp_events`、見る場所は CP(TEST) 画面の「📨 受信した通知」です。

> 用語：**Webhook**＝「何かあったら、こちらの住所（URL）へ知らせてね」という仕組み。**署名**＝「本当にサイバーポートから来た通知か」を確かめる合言葉つきの印。

## 手順

1. **秘密のトークンを作る**（自分だけが知る長い文字列）
   `openssl rand -hex 32` の出力をメモ帳などに控える（チャットや GitHub には貼らない）。
2. **表を作る**：Supabase の SQL Editor で `docs/sql/cp-events.sql` を実行。
3. **秘密を登録**：Supabase の Edge Functions → Secrets に `CP_WEBHOOK_SECRET` ＝ 手順 1 の文字列。
4. **受け口を配置**：Edge Functions で `cp-webhook` を作り、`supabase/cp-webhook-single/index.ts` の中身を貼って Deploy。
   **Verify JWT は OFF**（サイバーポートは Supabase のログインを持たないため。代わりに署名で確かめます）。
   CLI なら `supabase functions deploy cp-webhook --no-verify-jwt`。
5. **（cp-proxy を更新）** `supabase/cp-proxy-single/index.ts` を貼り直して Deploy（「通知できる操作の一覧」を見られるようになります）。
6. **サイバーポートの管理メニューで Webhook を登録**：名前、URL `https://<プロジェクトREF>.supabase.co/functions/v1/cp-webhook`、秘密のトークン（手順 1 と同じもの）。
   組織に紐づけ、通知してほしい操作を選ぶ。選ぶ前に CP(TEST) の「⑤ 通知できる操作の一覧」で、EDIFACT に関する操作があるか確認できます。
7. **確認**：CP(TEST) の「📨 受信した通知」に増えれば成功（緑の点＝リアルタイム受信待機中）。

## 自分でテスト送信する
```
CP_WEBHOOK_SECRET=<秘密のトークン> node scripts/cp-tests/send-test-webhook.mjs https://<REF>.supabase.co/functions/v1/cp-webhook
```
`200 {"ok":true,...}` なら受け口は動いています。画面に「テスト通知」が出ます。

## 注意・未確認
- 署名の文字形式（16進／base64／`sha256=` 付き）は資料に無いため、受け口はどれでも受け付けます。通らないときは Edge Function のログ（`bad_signature`）を確認。
- **ONE の EDIFACT 受信が Webhook の対象かは未確認**。⑤の一覧に無ければ、通知ではなく API の取得（`ParseEdifacts/ParsedContents/Search`）で定期的に読む方式にします（次の段階）。
- 通知は本文ごと `cp_events.payload` に保存されます（社内の取引情報を含む）。表は RLS でチームメンバーだけ読めます。
- 同じ通知が重ねて届いても 1 件にまとめます（履歴IDと組織で判定）。
