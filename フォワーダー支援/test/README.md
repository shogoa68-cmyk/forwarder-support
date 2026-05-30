# テスト — フォワーダー支援

計算ロジックの軽量テスト。**ビルド不要**（npm / インストール一切なし）。

## 実行方法

### 1. ブラウザで開くだけ（推奨・いちばん簡単）

```sh
cd "github/202605_コード改修"   # or リポジトリ直下
python3 -m http.server 18765
# → http://localhost:18765/フォワーダー支援/test/index.html
```

緑なら全部 PASS、赤が出たら失敗箇所と期待値/実際値が表示される。
タブのタイトルにも `✔ 37/37` のように出る。

> `file://` で直接開いても動くが、相対パスの都合で簡易サーバ経由が確実。

### 2. Node で（CI と同じ・ターミナル派向け）

```sh
node "フォワーダー支援/test/run-node.js"
```

PASS なら exit code 0、FAIL なら 1。GitHub Actions（`.github/workflows/test.yml`）でも
push / PR のたびにこれが走る。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | ブラウザ用。`shared/calc.js` を読み込んでテストを実行・描画 |
| `test-runner.js` | 極小テストランナー（`describe/it/expect`）。ブラウザ/Node 両対応 |
| `calc.spec.js` | `shared/calc.js` の仕様テスト |
| `run-node.js` | Node 実行エントリ（CI 用） |

## テストの書き方

```js
describe('グループ名', () => {
  it('テスト名', () => {
    expect(actual).toBe(expected);          // === 一致
    expect(actual).toBeCloseTo(expected, 6); // 小数6桁まで一致
    expect(actual).toEqual({ a: 1 });        // JSON 深さ比較
    expect(() => fn()).toThrow();            // 例外を投げる
  });
});
```

## 方針（なぜこれを置いたか）

`docs/バグ台帳.md` 参照。計算が複数ファイルに散在し「1か所直しても別経路で再発」する
状態を脱するため、`shared/calc.js` を「正解の基準」と定め、各タブの計算をここへ
一本化していく。その移行の安全網がこのテスト。

新しい計算関数を `shared/` に足したら、対応する `*.spec.js` も足して `index.html` と
`run-node.js` の読み込みリストに追加すること。
