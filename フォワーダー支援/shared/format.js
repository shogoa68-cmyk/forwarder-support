// ================================================================
//  shared/format.js — フォーマット系ユーティリティ共通モジュール
//
//  API:
//    SharedFmt.num(n, opts)              : string  // 数値 → ja-JP 区切り
//    SharedFmt.numOrDash(n, opts)        : string  // NaN/null → '—'
//    SharedFmt.money(n, dec)             : string  // 通貨用（小数桁指定）
//    SharedFmt.escapeHtml(s)             : string
//    SharedFmt.escapeCsv(s)              : string  // CSV セル用（"" エスケープ＋"...")
// ================================================================

window.SharedFmt = (function () {
  function num(n, opts) {
    if (n == null || isNaN(n)) return '';
    const o = Object.assign(
      { minimumFractionDigits: 0, maximumFractionDigits: 2 },
      opts || {}
    );
    return Number(n).toLocaleString('ja-JP', o);
  }

  function numOrDash(n, opts) {
    if (n == null || isNaN(n)) return '—';
    return num(n, opts);
  }

  function money(n, dec) {
    if (n == null || isNaN(n)) return '';
    const d = dec == null ? 0 : dec;
    return Number(n).toLocaleString('ja-JP', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeCsv(s) {
    if (s == null) return '';
    const v = String(s);
    if (/[",\n\r]/.test(v)) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  }

  return { num, numOrDash, money, escapeHtml, escapeCsv };
})();
