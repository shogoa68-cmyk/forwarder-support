/* cp-test.js — 🧪 CP(TEST)：サイバーポート連携の「画面の試作」。
 * 重要：この画面は サイバーポートに接続しません。表示はすべて「サンプル」です。
 * 設計は docs/サイバーポート連携_設計案.md。本物のAPI呼び出し（Supabase Edge Function 経由）は
 * 公式APIの仕様を確認してから、この画面の「接続状態」と入れ替える。
 * 初期化は js/app.js の switchTab() から window.initCpTestTab() が呼ばれる（冪等）。 */
(function () {
  'use strict';

  // ---- 番号の正規化（検証シートの課題：'ONEY TYOGF8748400' → 'ONEYTYOGF8748400'）----
  // 空白（全角含む）をすべて取り除き、英字を大文字にそろえる。ハイフンは番号の一部のため残す。
  function normalizeNo(raw) {
    return String(raw == null ? '' : raw).replace(/[\s　]+/g, '').toUpperCase();
  }

  // ---- サンプルデータ（本物ではない）----
  var SAMPLE_MOVEMENT = [
    { at: '2026-11-02 10:30', label: 'ブッキング確認', note: 'B/L番号は照会時に入力した番号' },
    { at: '2026-11-05 14:00', label: '搬入（CY）', note: 'サンプルターミナル' },
    { at: '2026-11-06 09:15', label: '本船 出港', note: 'SAMPLE MARU 001E' },
    { at: '2026-11-18 08:00', label: '本船 入港予定（ETA）', note: '予定。変更されることがある' }
  ];
  var SAMPLE_CHAT = [
    { from: 'サンプル港運（相手先）', at: '2026-11-06 10:02', body: 'CY搬入は予定どおりです。' },
    { from: '自社', at: '2026-11-06 10:20', body: '了解しました。ありがとうございます。' },
    { from: 'サンプル港運（相手先）', at: '2026-11-07 16:45', body: 'ETAが1日遅れる見込みです。' }
  ];

  var STATES = {
    ok:   { label: '成功（サンプル）' },
    eta:  { label: 'NACCS未登録（ETA前）' },
    err:  { label: '通信エラー' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function statusRows() {
    // 「未接続」を正直に表示する（接続済みに見せない）
    return [
      ['サイバーポートAPI', '未接続（この画面はサンプル表示）', 'is-off'],
      ['中継役（Supabase Edge Function）', '未作成', 'is-off'],
      ['認証（連携専用アカウント）', '未設定', 'is-off'],
      ['書き込み（送信・返信・編集・削除）', '使いません（読み取り専用）', 'is-ok']
    ].map(function (r) {
      return '<li class="cpt-st ' + r[2] + '"><span class="cpt-st-k">' + esc(r[0]) +
        '</span><span class="cpt-st-v">' + esc(r[1]) + '</span></li>';
    }).join('');
  }

  function render() {
    var root = document.getElementById('cptRoot');
    if (!root) return;
    var stateOpts = Object.keys(STATES).map(function (k) {
      return '<option value="' + k + '">' + esc(STATES[k].label) + '</option>';
    }).join('');
    root.innerHTML =
      '<div class="cpt-head"><h2 class="cpt-title">🧪 CP(TEST)</h2>' +
      '<span class="cpt-sub">サイバーポート連携の画面テスト（読み取りのみ）</span></div>' +
      '<div class="cpt-banner" role="note">⚠️ これは<strong>テスト画面</strong>です。サイバーポートには接続していません。' +
      '表示される動静・チャットは<strong>すべてサンプル</strong>で、実際の案件のデータではありません。</div>' +
      '<div class="cpt-card"><div class="cpt-card-h">接続状態</div><ul class="cpt-stlist">' + statusRows() + '</ul></div>' +
      '<div class="cpt-card"><div class="cpt-card-h">照会</div>' +
      '<div class="cpt-form">' +
      '<input type="text" id="cptNo" class="cpt-input" placeholder="B/L番号・搬入確認番号・JOB番号（例: ONEY TYOGF8748400）" autocomplete="off">' +
      '<select id="cptState" class="cpt-select" aria-label="サンプルの状態">' + stateOpts + '</select>' +
      '<button type="button" class="cpt-btn is-primary" id="cptRun">照会（サンプル）</button></div>' +
      '<div class="cpt-norm" id="cptNorm" aria-live="polite"></div></div>' +
      '<div class="cpt-cols">' +
      '<section class="cpt-card" aria-labelledby="cptMvH"><div class="cpt-card-h" id="cptMvH">🚢 動静（サンプル）</div><div id="cptMv" class="cpt-body"></div></section>' +
      '<section class="cpt-card" aria-labelledby="cptChH"><div class="cpt-card-h" id="cptChH">💬 取引内チャット（サンプル・読み取り専用）</div><div id="cptCh" class="cpt-body"></div></section>' +
      '</div>';

    var no = document.getElementById('cptNo');
    var norm = document.getElementById('cptNorm');
    function showNorm() {
      var raw = no.value, n = normalizeNo(raw);
      norm.textContent = raw && n !== raw ? '照会に使う番号：' + n + '（空白を除き、大文字にそろえました）' : '';
    }
    no.addEventListener('input', showNorm);
    document.getElementById('cptRun').addEventListener('click', run);
    no.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    run();
  }

  function msg(cls, text) {
    return '<div class="cpt-msg ' + cls + '">' + esc(text) + '</div>';
  }

  function run() {
    var st = (document.getElementById('cptState') || {}).value || 'ok';
    var mv = document.getElementById('cptMv'), ch = document.getElementById('cptCh');
    if (!mv || !ch) return;
    if (st === 'eta') {
      var t = 'NACCS側にまだ情報がありません（入港予定日の前は、登録されていないことがあります）。日をおいて、もう一度試してください。';
      mv.innerHTML = msg('is-info', t); ch.innerHTML = msg('is-info', t); return;
    }
    if (st === 'err') {
      var e = '通信かシステムのエラーです。少し待って再試行してください（本番では最大3回、間隔をあけて自動で再試行します）。';
      mv.innerHTML = msg('is-error', e); ch.innerHTML = msg('is-error', e); return;
    }
    mv.innerHTML = '<ol class="cpt-tl">' + SAMPLE_MOVEMENT.map(function (m) {
      return '<li><span class="cpt-tl-at">' + esc(m.at) + '</span><span class="cpt-tl-l">' + esc(m.label) +
        '</span><span class="cpt-tl-n">' + esc(m.note) + '</span></li>';
    }).join('') + '</ol>';
    ch.innerHTML = SAMPLE_CHAT.map(function (c) {
      var mine = c.from === '自社';
      return '<div class="cpt-bubble' + (mine ? ' is-mine' : '') + '"><div class="cpt-bubble-h">' + esc(c.from) +
        ' <span>' + esc(c.at) + '</span></div><div>' + esc(c.body) + '</div></div>';
    }).join('') + '<div class="cpt-note">送信・返信はできません（第1段階は読み取りのみ）。</div>';
  }

  var _inited = false;
  window.initCpTestTab = function () {
    if (_inited) return;
    _inited = true;
    render();
  };
  window.CpTest = { normalizeNo: normalizeNo };
})();
