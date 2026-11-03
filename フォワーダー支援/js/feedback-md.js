/* feedback-md.js — 不具合報告を AI が読みやすい Markdown に整形する（純粋関数）
 *
 *   FeedbackMd.toMarkdown(rows, { nameOf, title, maxResolved })
 *
 * ブラウザ（不具合報告ページの「AI 用にコピー」）と Node（scripts/fetch-feedback.js）の
 * 両方から同じ出力にするため、DOM や Supabase には依存しない。
 * 個人情報の配慮：メールアドレスは出力しない（nameOf で表示名に変換、無ければ @ 前のみ）。
 */
(function (root) {
  'use strict';

  var ST_LABEL = { open: '未対応', in_progress: '対応中', resolved: '解決済み', wontfix: '対応しない' };
  var ST_ORDER = ['open', 'in_progress', 'resolved', 'wontfix'];
  var CAT_ICON = { 'バグ報告': '🐛', '改善要望': '💡', '質問': '❓', 'その他': '📌' };

  // YYYY-MM-DD HH:mm（日本時間。ブラウザ/Node どちらでも同じ表記になるよう sv-SE を使う）
  function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16); }
    catch (e) { return String(iso); }
  }
  function oneLine(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  function noOf(r) { return r.report_no != null ? '#' + r.report_no : '#' + String(r.id || '').slice(0, 6); }
  function titleOf(r) { return r.title ? oneLine(r.title, 60) : oneLine(r.body, 40); }

  function who(r, nameOf) {
    var e = r.reporter_email || '';
    if (!e) return '匿名（未ログイン）';
    if (typeof nameOf === 'function') { var n = nameOf(e); if (n) return n; }
    return String(e).split('@')[0];
  }

  function itemMd(r, opts) {
    var st = ST_LABEL[r.status] || r.status || '不明';
    var icon = CAT_ICON[r.category] || '📌';
    var lines = [];
    lines.push('### ' + noOf(r) + ' [' + st + '] ' + icon + ' ' + (r.category || '') + '｜' + (r.section || '全体') + '｜' + titleOf(r));
    lines.push('- 報告: ' + fmtDate(r.created_at) + ' / ' + who(r, opts.nameOf));
    var ctx = r.context || {};
    var env = [];
    if (ctx.tab) env.push('画面=' + ctx.tab);
    if (ctx.viewport) env.push('表示=' + ctx.viewport);
    if (ctx.browser) env.push(ctx.browser);
    if (ctx.theme) env.push('テーマ=' + ctx.theme);
    if (env.length) lines.push('- 環境: ' + env.join(' / '));
    var attN = r.attachment_count != null ? r.attachment_count : (Array.isArray(r.attachments) ? r.attachments.length : 0);
    if (attN) {
      var kinds = Array.isArray(r.attachments)
        ? r.attachments.reduce(function (a, x) { a[x.kind] = (a[x.kind] || 0) + 1; return a; }, {}) : {};
      var detail = (kinds.image ? '画像' + kinds.image : '') + (kinds.video ? ' 動画' + kinds.video : '');
      lines.push('- 添付: ' + attN + '件' + (detail ? '（' + detail.trim() + '）' : '') + '（画面で確認。AI には本文のみ渡る）');
    }
    lines.push('');
    lines.push(String(r.body || '').trim().split('\n').map(function (l) { return '> ' + l; }).join('\n'));
    if (Array.isArray(ctx.errors) && ctx.errors.length) {
      lines.push('');
      lines.push('コンソールエラー（直近）:');
      ctx.errors.slice(-5).forEach(function (e) { lines.push('- `' + oneLine(e, 200).replace(/`/g, "'") + '`'); });
    }
    if (r.response) {
      lines.push('');
      lines.push('**対応メモ**（' + fmtDate(r.responded_at) + '）: ' + String(r.response).trim());
    }
    lines.push('');
    return lines.join('\n');
  }

  function toMarkdown(rows, opts) {
    opts = opts || {};
    rows = Array.isArray(rows) ? rows : [];
    var counts = {};
    rows.forEach(function (r) { var k = r.status || 'open'; counts[k] = (counts[k] || 0) + 1; });
    var out = [];
    out.push('# ' + (opts.title || '不具合報告一覧'));
    out.push('');
    out.push('取得: ' + fmtDate(new Date().toISOString()) + '（日本時間） / 全' + rows.length + '件 — ' +
      ST_ORDER.map(function (k) { return ST_LABEL[k] + ' ' + (counts[k] || 0); }).join(' / '));
    out.push('');
    var maxResolved = opts.maxResolved == null ? 10 : opts.maxResolved;
    ST_ORDER.forEach(function (k) {
      var list = rows.filter(function (r) { return (r.status || 'open') === k; });
      if (!list.length) return;
      out.push('## ' + ST_LABEL[k] + '（' + list.length + '件）');
      out.push('');
      var closed = (k === 'resolved' || k === 'wontfix');
      var shown = closed ? list.slice(0, maxResolved) : list;
      shown.forEach(function (r) { out.push(itemMd(r, opts)); });
      if (closed && list.length > shown.length) out.push('（ほか ' + (list.length - shown.length) + ' 件は省略）\n');
    });
    if (!rows.length) out.push('（報告はありません）');
    return out.join('\n');
  }

  var api = { toMarkdown: toMarkdown, fmtDate: fmtDate, ST_LABEL: ST_LABEL, ST_ORDER: ST_ORDER, CAT_ICON: CAT_ICON, noOf: noOf, titleOf: titleOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FeedbackMd = api;
})(typeof window !== 'undefined' ? window : globalThis);
