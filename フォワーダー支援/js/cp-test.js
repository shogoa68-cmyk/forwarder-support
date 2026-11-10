/* cp-test.js — 🧪 CP(TEST)：サイバーポート連携の画面テスト。
 * 「（サンプル）」と書いた欄（動静・チャット）は サイバーポートに接続せず、サンプルを表示するだけ。
 * 「🔌 実接続テスト」の欄だけが、js/integrations/cyberport.js → Edge Function「cp-proxy」経由で
 * 読み取り専用の API を呼ぶ（接続情報が未設定・関数が未配置のときは、その旨をエラーとして表示する）。
 * 設計は docs/サイバーポート連携_設計案.md。
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
    // 確かめていないことは「未確認」と正直に表示する（接続済みに見せない）。
    // 「実接続テスト」の① が成功したら、上 3 行を「確認済み」にする（setLinkStatus）。
    return [
      ['cptStApi', 'サイバーポートAPI', '未確認（下の「実接続テスト」で確認）', 'is-off'],
      ['cptStFn', '中継役（Supabase Edge Function）', '未確認', 'is-off'],
      ['cptStAuth', '認証（システム用＋橋渡しユーザーの2つのトークン）', '未確認', 'is-off'],
      ['', '書き込み（送信・返信・編集・削除）', '使いません（読み取り専用）', 'is-ok']
    ].map(function (r) {
      return '<li class="cpt-st ' + r[3] + '"' + (r[0] ? ' id="' + r[0] + '"' : '') + '><span class="cpt-st-k">' + esc(r[1]) +
        '</span><span class="cpt-st-v">' + esc(r[2]) + '</span></li>';
    }).join('');
  }

  function setLinkStatus(ok, apiHost) {
    var rows = {
      cptStApi: ok ? (apiHost ? '接続先を確認（' + apiHost + '）' : '接続できています（データを取得できました）') : '未確認（下の「実接続テスト」で確認）',
      cptStFn: ok ? '動いています' : '未確認',
      cptStAuth: ok ? '2つのトークンを取得できました' : '未確認'
    };
    Object.keys(rows).forEach(function (id) {
      var li = document.getElementById(id);
      if (!li) return;
      li.className = 'cpt-st ' + (ok ? 'is-ok' : 'is-off');
      li.querySelector('.cpt-st-v').textContent = rows[id];
    });
  }

  // ---------- 実接続テスト（読み取りのみ・cp-proxy 経由） ----------
  function liveBox() { return document.getElementById('cptLive'); }
  function liveBusy(on) {
    ['cptPing', 'cptSearch', 'cptColinsV', 'cptColinsC'].forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = !!on; });
  }
  function errHtml(e) {
    var extra = [];
    if (e && e.upstreamStatus) extra.push('サイバーポートの応答コード：' + e.upstreamStatus);
    if (e && e.detail) extra.push('詳細：' + e.detail);
    if (e && e.code) extra.push('種類：' + e.code);
    return '<div class="cpt-msg is-error"><strong>' + esc((e && e.message) || '失敗しました') + '</strong>' +
      (extra.length ? '<div class="cpt-live-x">' + extra.map(esc).join('<br>') + '</div>' : '') + '</div>';
  }
  function needApi() {
    if (window.CyberPort) return true;
    liveBox().innerHTML = errHtml({ message: 'cyberport.js が読み込まれていません' });
    return false;
  }

  async function livePing() {
    if (!needApi()) return;
    liveBusy(true);
    liveBox().innerHTML = msg('is-info', 'サイバーポートに接続情報でトークンを取りに行っています…');
    try {
      var r = await window.CyberPort.ping();
      setLinkStatus(true, r.apiHost || '');
      liveBox().innerHTML = '<div class="cpt-msg is-ok">✅ ' + esc(r.message) + '<div class="cpt-live-x">トークン取得先：' + esc(r.tokenHost || '') + ' ／ API 接続先：' + esc(r.apiHost || '') + '</div></div>';
    } catch (e) {
      setLinkStatus(false);
      liveBox().innerHTML = errHtml(e);
    } finally { liveBusy(false); }
  }

  // 取引の検索（Trades/Search）。番号があれば keyword（取引番号・B/L・ブッキング・社内管理番号・インボイスの完全一致）、
  // 空なら「直近 30 日に更新された取引」。
  async function liveSearch() {
    if (!needApi()) return;
    var kw = window.CyberPort.normalizeNo((document.getElementById('cptKw') || {}).value);
    var q = kw ? { keyword: kw } : { updatedAtRange: 30, updatedAtRangeUnit: 'D' };
    liveBusy(true);
    liveBox().innerHTML = msg('is-info', '取引を検索しています…（' + (kw ? '番号：' + kw : '直近30日に更新された取引') + '）');
    try {
      var r = await window.CyberPort.tradesSearch(q);
      setLinkStatus(true, '');
      liveBox().innerHTML = tradesHtml(r.data, kw);
    } catch (e) {
      liveBox().innerHTML = errHtml(e);
    } finally { liveBusy(false); }
  }

  // ---------- COLINS（本船の動静・コンテナの状況） ----------
  // 入れ子の項目を安全に取り出す（途中が無くても落ちない）
  function g(o, path) {
    var v = o;
    String(path).split('.').forEach(function (k) { v = v == null ? undefined : v[k]; });
    return v;
  }
  // 日時は UTC（YYYY-MM-DDThh:mm:ssZ）で届く。日本時間にして「月/日 時:分」で見せる。読めない値はそのまま。
  function fmtDt(v) {
    if (v == null || v === '') return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    var p = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    var m = {}; p.forEach(function (x) { m[x.type] = x.value; });
    return m.year + '/' + m.month + '/' + m.day + ' ' + m.hour + ':' + m.minute;
  }
  function yn(v) { return v === true ? '○' : v === false ? '×' : (v == null ? '' : String(v)); }

  function rawHtml(data) {
    return '<details class="cpt-raw"><summary>返ってきたデータそのもの（確認用）</summary><pre>' + esc(JSON.stringify(data, null, 2).slice(0, 8000)) + '</pre></details>';
  }
  // 配列の応答を、列の定義どおりの表にする（最大 50 行）
  function listTable(data, cols, emptyText, label) {
    var list = Array.isArray(data) ? data : null;
    if (!list) return msg('is-info', '想定と違う形のデータが返りました。下の「返ってきたデータそのもの」を確認してください。') + rawHtml(data);
    if (!list.length) return msg('is-info', emptyText) + rawHtml(data);
    var head = '<tr>' + cols.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '</tr>';
    var rows = list.slice(0, 50).map(function (it) {
      return '<tr>' + cols.map(function (c) { return '<td>' + esc(c[1](it || {})) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="cpt-live-x">実データ（' + esc(label) + '）：' + list.length + ' 件' + (list.length > 50 ? '（先頭50件を表示）' : '') + '</div>' +
      '<div class="cpt-tablewrap"><table class="cpt-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' + rawHtml(data);
  }

  var VESSEL_COLS = [
    ['ターミナル', function (x) { return g(x, 'terminalCode'); }],
    ['本船名', function (x) { return g(x, 'vessel.vesselName'); }],
    ['航海番号', function (x) { return g(x, 'vessel.voyageNo'); }],
    ['IMO', function (x) { return g(x, 'vessel.imoNo'); }],
    ['荷役 予定', function (x) { return fmtDt(g(x, 'cargoHandling.scheduleAt')); }],
    ['荷役 実績', function (x) { return fmtDt(g(x, 'cargoHandling.actualAt')); }],
    ['搬入 予定', function (x) { return fmtDt(g(x, 'cargoIn.scheduleAt')); }],
    ['搬入 実績', function (x) { return fmtDt(g(x, 'cargoIn.actualAt')); }],
    ['CYオープン', function (x) { return fmtDt(g(x, 'cargoTransfer.cyOpenAt')); }],
    ['CYカット', function (x) { return fmtDt(g(x, 'cargoTransfer.cyCutAt')); }]
  ];
  function containerCols(dir) {
    var common = [
      ['ターミナル', function (x) { return g(x, 'terminalCode'); }],
      ['コンテナ', function (x) { return g(x, 'container.containerNo'); }],
      ['サイズ・種類', function (x) { return [g(x, 'container.lengthName'), g(x, 'container.containerTypeName')].filter(Boolean).join(' '); }],
      ['本船／航海', function (x) { return [g(x, 'vessel.vesselName'), g(x, 'vessel.voyageNo')].filter(Boolean).join(' / '); }],
      ['実入り/空', function (x) { return g(x, 'containerStatus.fullOrEmpty'); }]
    ];
    if (dir === 'export') {
      return common.concat([
        ['船積可否', function (x) { return yn(g(x, 'shipmentAvailability')); }],
        ['ゲートイン', function (x) { return fmtDt(g(x, 'gateInDate')); }],
        ['船積日', function (x) { return fmtDt(g(x, 'shipmentDate')); }]
      ]);
    }
    return common.concat([
      ['通関', function (x) { return g(x, 'containerStatus.customClearanceStatus'); }],
      ['搬出可否', function (x) { return yn(g(x, 'outboundAvailability')); }],
      ['CY搬入', function (x) { return fmtDt(g(x, 'cyCarryInDate')); }],
      ['ゲートイン', function (x) { return fmtDt(g(x, 'gateInDate')); }],
      ['ゲートアウト', function (x) { return fmtDt(g(x, 'gateOutDate')); }],
      ['DO', function (x) { return yn(g(x, 'doAcquisition')); }]
    ]);
  }

  async function liveColinsVessels() {
    if (!needApi()) return;
    var dir = (document.getElementById('cptDir') || {}).value === 'export' ? 'export' : 'import';
    var port = window.CyberPort.normalizeNo((document.getElementById('cptPort') || {}).value);
    if (!/^[A-Z]{2}[A-Z0-9]{3}$/.test(port)) {
      liveBox().innerHTML = msg('is-error', '港コードは、英字2文字＋英数字3文字の5桁で入力してください（例：JPTYO＝東京、JPYOK＝横浜）。');
      return;
    }
    var vn = ((document.getElementById('cptVessel') || {}).value || '').trim();
    var q = vn ? { vesselName: vn } : {};
    liveBusy(true);
    liveBox().innerHTML = msg('is-info', 'COLINS の本船の動静を取得しています…（' + (dir === 'export' ? '輸出' : '輸入') + '・' + port + (vn ? '・' + vn : '') + '）');
    try {
      var r = await window.CyberPort.colinsVessels(dir, port, q);
      setLinkStatus(true, '');
      liveBox().innerHTML = listTable(r.data, VESSEL_COLS, port + ' の本船の動静は見つかりませんでした（0件）。', 'COLINS・本船の動静');
    } catch (e) {
      liveBox().innerHTML = errHtml(e);
    } finally { liveBusy(false); }
  }

  async function liveColinsContainers() {
    if (!needApi()) return;
    var dir = (document.getElementById('cptDir') || {}).value === 'export' ? 'export' : 'import';
    var no = window.CyberPort.normalizeNo((document.getElementById('cptCtn') || {}).value);
    if (!no) {
      liveBox().innerHTML = msg('is-error', 'コンテナ番号か、' + (dir === 'export' ? 'ブッキング番号' : 'B/L番号') + 'を入力してください。');
      return;
    }
    liveBusy(true);
    liveBox().innerHTML = msg('is-info', 'COLINS のコンテナの状況を取得しています…（' + (dir === 'export' ? '輸出' : '輸入') + '・' + no + '）');
    try {
      var r = await window.CyberPort.colinsContainers(dir, no, {});
      setLinkStatus(true, '');
      liveBox().innerHTML = listTable(r.data, containerCols(dir), '「' + no + '」のコンテナは見つかりませんでした（0件）。', 'COLINS・コンテナの状況');
    } catch (e) {
      liveBox().innerHTML = errHtml(e);
    } finally { liveBusy(false); }
  }

  function tradesHtml(data, kw) {
    var list = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : null);
    var raw = '<details class="cpt-raw"><summary>返ってきたデータそのもの（確認用）</summary><pre>' +
      esc(JSON.stringify(data, null, 2).slice(0, 6000)) + '</pre></details>';
    if (!list) return msg('is-info', '想定と違う形のデータが返りました。下の「返ってきたデータそのもの」を確認してください。') + raw;
    if (!list.length) {
      return msg('is-info', (kw ? '番号「' + kw + '」' : '直近30日') + 'に該当する取引はありません（0件）。') + raw;
    }
    var rows = list.slice(0, 50).map(function (t) {
      t = t || {};
      return '<tr><td>' + esc(t.tradeNo) + '</td><td>' + esc(t.tradeType) + '</td><td>' + esc(t.tradeStatus) + '</td><td>' +
        esc(t.tradeName) + '</td><td>' + esc(t.blNo) + '</td><td>' + esc(t.updatedAt) + '</td></tr>';
    }).join('');
    return '<div class="cpt-live-x">実データ（サイバーポート）：' + list.length + ' 件' + (list.length > 50 ? '（先頭50件を表示）' : '') + '</div>' +
      '<div class="cpt-tablewrap"><table class="cpt-table"><thead><tr><th>取引番号</th><th>種別</th><th>状態</th><th>取引名</th><th>B/L</th><th>更新日時</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' + raw;
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
      '<div class="cpt-banner" role="note">⚠️ これは<strong>テスト画面</strong>です。「（サンプル）」と書いた欄は<strong>サンプル</strong>で、実際の案件のデータではありません。' +
      '「🔌 実接続テスト」の欄だけが、サイバーポートに<strong>読み取りで</strong>接続します（書き込みはしません）。</div>' +
      '<div class="cpt-card"><div class="cpt-card-h">接続状態</div><ul class="cpt-stlist">' + statusRows() + '</ul></div>' +
      '<div class="cpt-card"><div class="cpt-card-h">🔌 実接続テスト（読み取りのみ）</div>' +
      '<div class="cpt-form"><button type="button" class="cpt-btn is-primary" id="cptPing">① 接続情報の確認</button>' +
      '<span class="cpt-hint">2つのトークン（システム用・橋渡しユーザー）が取れるかだけを確かめます（データは取りません）</span></div>' +
      '<div class="cpt-form"><input type="text" id="cptKw" class="cpt-input" maxlength="45" autocomplete="off" ' +
      'placeholder="取引番号・B/L・ブッキング・社内管理番号（空なら直近30日の更新）">' +
      '<button type="button" class="cpt-btn" id="cptSearch">② 取引を検索</button></div>' +
      '<div class="cpt-sep"></div>' +
      '<div class="cpt-form"><select id="cptDir" class="cpt-select" aria-label="輸入・輸出"><option value="import">輸入</option><option value="export">輸出</option></select>' +
      '<input type="text" id="cptPort" class="cpt-input cpt-input-s" maxlength="12" value="JPTYO" autocomplete="off" placeholder="港コード（例 JPTYO）" aria-label="港コード（UN/LOCODE 5桁）">' +
      '<input type="text" id="cptVessel" class="cpt-input cpt-input-s" maxlength="60" autocomplete="off" placeholder="本船名（任意）" aria-label="本船名">' +
      '<button type="button" class="cpt-btn" id="cptColinsV">③ COLINS 本船の動静</button></div>' +
      '<div class="cpt-form"><input type="text" id="cptCtn" class="cpt-input" maxlength="40" autocomplete="off" placeholder="コンテナ番号／B/L番号（輸入）／ブッキング番号（輸出）">' +
      '<button type="button" class="cpt-btn" id="cptColinsC">④ COLINS コンテナの状況</button></div>' +
      '<div id="cptLive" class="cpt-live" aria-live="polite"></div></div>' +
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
    document.getElementById('cptPing').addEventListener('click', livePing);
    document.getElementById('cptSearch').addEventListener('click', liveSearch);
    document.getElementById('cptKw').addEventListener('keydown', function (e) { if (e.key === 'Enter') liveSearch(); });
    document.getElementById('cptColinsV').addEventListener('click', liveColinsVessels);
    document.getElementById('cptColinsC').addEventListener('click', liveColinsContainers);
    document.getElementById('cptPort').addEventListener('keydown', function (e) { if (e.key === 'Enter') liveColinsVessels(); });
    document.getElementById('cptCtn').addEventListener('keydown', function (e) { if (e.key === 'Enter') liveColinsContainers(); });
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
