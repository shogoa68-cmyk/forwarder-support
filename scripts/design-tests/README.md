# デザイン改修の動作確認スクリプト（Playwright）

見積入力画面を実際に操作して、デザイン変更で機能が壊れていないかを確かめる。サーバーは自動で立ち上がる（`http` で リポジトリ直下を配信）。

```sh
export NODE_PATH=$(npm root -g)          # playwright / playwright-core が見える場所
THEME=1 node scripts/design-tests/table-test.js          # 見積テーブル（Industry）17項目＋α
THEME=1 node scripts/design-tests/editor-test.js         # かんたん表示（見積入力）26項目
node scripts/design-tests/mode-test.js                   # かんたん表示（ダッシュボード）18項目
node scripts/design-tests/as-removed-test.js             # 自動保存の廃止
node scripts/design-tests/remark-copy-test.js            # 類似見積→行追加（リマークも一緒に）
THEME=1 node scripts/design-tests/sell-mode-test.js        # 売値ベースのオン／オフ
node scripts/design-tests/master-cloud-test.js             # マスターのクラウド必須化・名前の突き合わせ（偽の Supabase）
```

- 末尾に `OK` が出れば全項目成功。失敗は `❌` / `FAIL` の行に出る。
- `THEME=1` で Industry テーマ、`MODE=simple` でかんたん表示。table-test を `THEME` なし（現行デザイン）で回すと「最終行の操作ボタン」の項目だけ NG になる（Industry 専用の検証のため。想定どおり）。
- 他の確認：`node scripts/ui-smoke.js [--theme both]`（主要操作 12 項目）、`node scripts/check-ui-contract.js`（id／handler／class の基準）、`node scripts/build-industry-theme.js --check`（テーマ CSS が最新か）。
