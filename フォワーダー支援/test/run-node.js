// ================================================================
//  run-node.js — Node から CI 等でテストを回す（おまけ。ビルド不要）
//
//  使い方:  node フォワーダー支援/test/run-node.js
//
//  shared/calc.js は `window.SharedCalc = ...` の IIFE。Node には window が
//  無いので globalThis を window として与えてから読み込む。同様にランナーと
//  spec も globalThis のグローバル（describe/it/expect）を使う。
// ================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// window エイリアス（calc.js の `window.SharedCalc=` を受けるため）
globalThis.window = globalThis;

const dir = __dirname;
function load(rel) {
  const code = fs.readFileSync(path.resolve(dir, rel), 'utf8');
  vm.runInThisContext(code, { filename: rel });
}

load('../shared/calc.js'); // → globalThis.SharedCalc
load('./test-runner.js');  // → globalThis.{describe,it,expect,TestRunner}
load('./calc.spec.js');    // テスト実行（describe/it 即時評価）

const ok = globalThis.TestRunner.printSummary();
process.exit(ok ? 0 : 1);
