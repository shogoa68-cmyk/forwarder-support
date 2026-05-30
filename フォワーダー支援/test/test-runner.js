// ================================================================
//  test-runner.js — ビルド不要の極小テストランナー
//
//  方針: npm / Node / ビルドを一切要求しない。
//    - ブラウザ:  test/index.html を開くだけ。結果が画面に出る。
//    - Node(任意): `node test/run-node.js` で CI からも回せる（おまけ）。
//
//  API:
//    describe(name, fn)              テストグループ
//    it(name, fn)                    1テスト
//    expect(actual).toBe(v)          厳密一致 (===)
//    expect(actual).toBeCloseTo(v,d) 小数 d 桁まで一致（既定6桁）
//    expect(actual).toEqual(v)       JSON 深さ比較
//    expect(actual).toThrow()        例外を投げること
//
//  実行環境を問わず使えるよう、結果は TestRunner.results に貯め、
//  ブラウザでは render()、Node では printSummary() で出力する。
// ================================================================
(function (root) {
  const groups = [];
  let current = null;

  function describe(name, fn) {
    current = { name, tests: [] };
    groups.push(current);
    fn();
    current = null;
  }

  function it(name, fn) {
    const t = { name, status: 'pass', error: null };
    try {
      fn();
    } catch (e) {
      t.status = 'fail';
      t.error = (e && e.message) || String(e);
    }
    if (!current) throw new Error('it() must be called inside describe()');
    current.tests.push(t);
  }

  function fail(msg) { throw new Error(msg); }

  function expect(actual) {
    return {
      toBe(expected) {
        if (actual !== expected) fail(`期待値 ${fmt(expected)} / 実際 ${fmt(actual)}`);
      },
      toBeCloseTo(expected, digits) {
        const d = digits == null ? 6 : digits;
        const diff = Math.abs(actual - expected);
        const tol = Math.pow(10, -d) / 2;
        if (!(diff <= tol)) fail(`期待値 ≈${fmt(expected)}(±${tol}) / 実際 ${fmt(actual)} / 差 ${diff}`);
      },
      toEqual(expected) {
        const a = JSON.stringify(actual), b = JSON.stringify(expected);
        if (a !== b) fail(`期待値 ${b} / 実際 ${a}`);
      },
      toThrow() {
        if (typeof actual !== 'function') fail('toThrow() には関数を渡してください');
        let threw = false;
        try { actual(); } catch (_) { threw = true; }
        if (!threw) fail('例外が投げられませんでした');
      },
    };
  }

  function fmt(v) {
    if (typeof v === 'number') return String(v);
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }

  function summary() {
    let pass = 0, failc = 0;
    groups.forEach(g => g.tests.forEach(t => (t.status === 'pass' ? pass++ : failc++)));
    return { pass, fail: failc, total: pass + failc, groups };
  }

  // ---- ブラウザ描画 ----
  function render(el) {
    const s = summary();
    const lines = [];
    lines.push(`<div class="tr-head ${s.fail ? 'tr-bad' : 'tr-good'}">`
      + `${s.fail ? '✖ FAIL' : '✔ PASS'} — ${s.pass}/${s.total} passed`
      + (s.fail ? `, ${s.fail} failed` : '') + `</div>`);
    s.groups.forEach(g => {
      lines.push(`<div class="tr-grp">${esc(g.name)}</div>`);
      g.tests.forEach(t => {
        lines.push(`<div class="tr-test tr-${t.status}">`
          + `${t.status === 'pass' ? '✔' : '✖'} ${esc(t.name)}`
          + (t.error ? `<div class="tr-err">${esc(t.error)}</div>` : '')
          + `</div>`);
      });
    });
    el.innerHTML = lines.join('');
  }

  function esc(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // ---- Node 出力 ----
  function printSummary() {
    const s = summary();
    s.groups.forEach(g => {
      console.log('\n• ' + g.name);
      g.tests.forEach(t => {
        if (t.status === 'pass') console.log('  ✔ ' + t.name);
        else console.log('  ✖ ' + t.name + '\n      ' + t.error);
      });
    });
    console.log(`\n${s.fail ? '✖ FAIL' : '✔ PASS'} — ${s.pass}/${s.total} passed`
      + (s.fail ? `, ${s.fail} failed` : ''));
    return s.fail === 0;
  }

  root.TestRunner = { describe, it, expect, render, printSummary, summary };
  // グローバルにも生やす（テストファイルが describe/it/expect を直接使えるように）
  root.describe = describe;
  root.it = it;
  root.expect = expect;
})(typeof window !== 'undefined' ? window : globalThis);
