// ================================================================
//  shared/format.js — フォーマット系ユーティリティ共通モジュール
//
//  API:
//    SharedFmt.num(n, opts)              : string  // 数値 → ja-JP 区切り
//    SharedFmt.numOrDash(n, opts)        : string  // NaN/null → '—'
//    SharedFmt.money(n, dec)             : string  // 通貨用（小数桁指定）
//    SharedFmt.escapeHtml(s)             : string
//    SharedFmt.escapeCsv(s)              : string  // CSV セル用（"" エスケープ＋"...")
//    SharedFmt.httpUrl(raw)              : string  // リンクにしてよい URL（http/https）だけ返す。それ以外は ''
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

  // リンク（<a href>）に入れてよい URL かを確かめ、使える形にして返す。使えないときは ''。
  //   ・http:// / https:// だけ許可。javascript: data: vbscript: file: mailto: などは拒否
  //     （クリックしたときに、この画面の中でプログラムが動いてしまうのを防ぐ）
  //   ・「example.com」「www.example.co.jp/path」のようにスキームが無い入力は、https:// を補う
  //   ・空白・改行・制御文字・引用符・< >・バッククォート・バックスラッシュを含むものは拒否
  //     （「java<改行>script:」のように、ブラウザが無視する文字で書き換える手口も止まる）
  //   ・「//example.com」（スキーム省略の形）、「https://good.com@evil.com」のような「@」付き（見せかけ）、
  //     2048 文字を超えるものも拒否
  function httpUrl(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s.length > 2048) return '';
    if (/[\u0000-\u0020\u007f-\u009f\u2028\u2029"<>`\\]/.test(s)) return '';
    if (/^https?:\/\/[^\/?#@:][^\/?#@]*(?:[\/?#]|$)/i.test(s)) return s;           // 例: https://example.com/a（ホスト名が空・先頭が「:」・「user@」付きは通さない）
    if (/^https?:/i.test(s)) return '';                                              // 例: http:///x、https:
    if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?(?:[\/?#]|$)/i.test(s)) return 'https://' + s;
    return '';
  }

  return { num, numOrDash, money, escapeHtml, escapeCsv, httpUrl };
})();
