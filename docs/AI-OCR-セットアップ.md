# 📷 画像を AI で読む（AI OCR）— セットアップ（管理者向け）

見積書の写真・スキャン・文字の無い PDF を、AI（Claude）に読ませて明細の行にする機能です。
**いまは「準備だけ」の状態**です。画面（切り抜き・黒塗り・送る前の確認）はすでに使えますが、下の手順で管理者が鍵と「使う」設定を入れるまで、画像は外へ送られません。

## しくみ

1. 見積入力の「📥 取り込み」→「📷 画像を AI で読む」（サブコン見出しの［取り込み］からも開けます）
2. 画像を選び、**表の部分だけ切り抜き、会社名・人名・区間・番号などを黒く塗る**
3. 3 つの確認にチェック（宛先・署名が写っていない／表の中の社名などを塗った／社内の決まりで送ってよい）
4. ［AI で読む（外部に送る）］→ Supabase の Edge Function「ai-ocr」が Claude API に画像を送り、料金の行だけを受け取る
5. 結果は、いつものメール取込の確認画面に入る → 人が確かめてから挿入（サブコン別のルールもそのまま効く）

外に出るのは「切り抜いて黒塗りした画像」だけです。画面は画像を JPEG に作り直してから送るので、元のファイルの中の隠れた情報（作成者名など）も落ちます。どのサブコンの見積かは AI には伝えません。Edge Function は画像も結果も保存せず、記録（ログ）には行数と大きさだけを書きます。

## 使う前に確かめること（必ず）

- **社内の決まり**：料金の表を外部の AI に送ってよいか。
- **お客様・サブコンとの約束**：料金を第三者に見せないという約束（秘密保持の契約）がないか。
- **鍵の契約**：Claude API（Claude Console で作る鍵）は**法人向けの規約（Commercial Terms）**で、送った内容は**既定では学習に使われません**。保存の期間などは、最新の規約とプライバシーポリシーで確認してください。個人の Pro／Max の契約とは別のものです。

## 手順

### 1. Claude API の鍵を作る
Claude Console（console.anthropic.com）で、会社のアカウントの API キーを作ります。使い過ぎを防ぐため、Console で月の上限額（spend limit）も決めておくと安心です。

### 2. Edge Function を置く
- CLI の場合：`supabase functions deploy ai-ocr`（中身は `supabase/functions/ai-ocr/`）
- ダッシュボードに貼る場合：`supabase/ai-ocr-single/index.ts`（1 枚にまとめたもの。元を直したら `node scripts/cp-tests/build-edge-single.mjs ai-ocr` で作り直す）
- 「Verify JWT」は**オンのまま**（ログイン中のメンバーだけが呼べます。さらに中で `is_team_member()` を確かめます）

### 3. 秘密の設定（Secrets）を入れる
**鍵はリポジトリ・チャットに書かないでください。** Supabase の Edge Functions → Secrets（または `supabase secrets set …`）で入れます。

| 名前 | 値 | 必須 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 手順 1 の鍵 | ○ |
| `AI_OCR_ALLOWED_ORIGINS` | 画面を公開している URL（例：`https://example.github.io`・カンマ区切り） | ○ |
| `AI_OCR_ENABLED` | `1`（**社内の確認が済むまでは入れない**。入れるまでは画像を送れません） | ○ |
| `AI_OCR_MODEL` | 省略時は `claude-opus-5-5` | — |

鍵と `AI_OCR_ENABLED=1` の両方がそろって、はじめて画面から送れるようになります（画面を開き直すと反映されます）。止めたいときは `AI_OCR_ENABLED` を消すか `0` にします。

## 制限・未実施
- 1 人 1 分に 6 回まで（目安）。画像は 4.5MB まで（画面で長辺 2000px に縮めるので普段は 1MB 以下）。
- PDF は 1 ページずつ（ページを切り替えて、それぞれ送る）。
- 黒塗りは手作業です。自動で社名を見つけて塗る機能はありません（送る前の確認で目で見てください）。
- 読みにくかった行は確認画面に入れず、件数だけ知らせます。

## 試験
- `node scripts/ai-ocr-tests/ai-ocr-test.mjs`（Edge Function の判断と入口・偽の Claude API。`TARGET=single` で 1 枚版）
- `node scripts/design-tests/ai-ocr-test.js`（画面。`THEME=1`／`W=390` も）
