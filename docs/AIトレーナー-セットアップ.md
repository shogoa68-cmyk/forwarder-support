# 🎓 AI トレーナーのセットアップ（管理者向け）

AI トレーナーは 2 つの働きを持ちます。

| 働き | AI を使う？ | 準備 |
|---|---|---|
| **練習（ツアー）**：実際の画面に印を付けて 1 歩ずつ案内 | 使わない | 不要（すぐ使える） |
| **質問**：ふだんの言葉の質問に、マニュアルをもとに答える | 使う（Claude API） | 下の手順が必要 |

準備が済むまでは、質問は「マニュアルの中から近い章を探して出す」動きになります（画面は壊れません）。

## 送られる情報

- 質問の文・直前のやりとり（6 件まで）・いま開いている画面の名前（例「💼 見積を作る（入力画面・ステップ 4）」）・関係しそうなマニュアルの章の文。
- **案件の中身（お客様名・金額・明細）は送らない作り**です。ただし、質問の文に本人が書いたものは送られるため、画面に「お客様名・金額などは書かないでください」と出しています。
- 質問・答えは保存しません。記録（ログ）には件数と文字数だけを書きます。
- Claude API は法人向けの規約で、既定では学習に使われません。社内の決まりで外部の AI に質問の文を送ってよいか、先に確認してください。

## 手順

1. **Edge Function を置く**：Supabase の画面 → Edge Functions → 「Deploy a new function」→ 名前 `ai-trainer` → `supabase/ai-trainer-single/index.ts` の中身を貼り付けて保存（Verify JWT はオンのまま）。
   CLI なら `supabase functions deploy ai-trainer`。
2. **秘密の設定**（Edge Functions → Secrets。**リポジトリ・チャットには書かない**）
   - `ANTHROPIC_API_KEY`：Claude API の鍵（AI OCR を使っていれば同じ鍵でよい）
   - `AI_TRAINER_ENABLED`：`1`（社内の確認が済んでから）
   - `AI_TRAINER_ALLOWED_ORIGINS`：画面の URL（例 `https://<ユーザー名>.github.io`）。未設定なら `AI_OCR_ALLOWED_ORIGINS` を使う
   - `AI_TRAINER_MODEL`：省略可（既定 `claude-opus-5-5`）
3. 画面で ❓ →「🎓 AI トレーナーに聞く」→ 質問して、答えと「📘 章」のボタンが出れば完了。

## 止めたいとき

`AI_TRAINER_ENABLED` を `0` にする（すぐに「準備中」の動きに戻る。練習は使える）。

## 費用の目安

1 回の質問は、マニュアルの抜き書き（多くて約 1 万文字）＋質問で、入力 数千トークン・出力 数百トークン程度です。1 人 1 分 10 回までに制限しています。

## 開発者向け

- 判断の部分：`supabase/functions/ai-trainer/logic.ts`（指示文・送られた内容の確認・答えの整え方）。直したら `node scripts/cp-tests/build-edge-single.mjs ai-trainer` で 1 枚版を作り直す。
- 試験：`node scripts/ai-trainer-tests/ai-trainer-test.mjs`。画面は `scripts/design-tests/manual-test.js`（AI は偽物）。
