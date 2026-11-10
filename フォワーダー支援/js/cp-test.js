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
  // 日時の読み取り。届く形は 2 通り：UTC の ISO（2026-11-12T00:00:00Z）と、日付だけ（20261109 / 2026-11-09）。
  // 日付だけのものは日本の日付としてそのまま見せる（時刻は付けない）。読めない値は null（元の文字のまま見せる）。
  function parseDt(v) {
    if (v == null || v === '') return null;
    var s = String(v).trim(), m;
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)) || (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) {
      return { d: new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00+09:00'), dateOnly: true };
    }
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : { d: d, dateOnly: false };
  }
  function fmtDt(v) {
    if (v == null || v === '') return '';
    var p = parseDt(v);
    if (!p) return String(v);
    var f = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(p.d);
    var m = {}; f.forEach(function (x) { m[x.type] = x.value; });
    return m.year + '/' + m.month + '/' + m.day + (p.dateOnly ? '' : ' ' + m.hour + ':' + m.minute);
  }
  // 期限の色分け：過ぎている＝over、あと 48 時間以内＝warn。日付だけの期限は、その日の終わりまでを期限とみなす。
  function dueClass(v, now) {
    var p = parseDt(v);
    if (!p) return '';
    var endMs = p.d.getTime() + (p.dateOnly ? 24 * 3600 * 1000 : 0);
    var diffH = (endMs - (now == null ? Date.now() : now)) / 3600000;
    return diffH < 0 ? 'cpt-due-over' : diffH <= 48 ? 'cpt-due-warn' : '';
  }
  function yn(v) { return v === true ? '○' : v === false ? '×' : (v == null ? '' : String(v)); }
  function num(v) { return v == null ? '' : String(v); }

  function rawHtml(data) {
    return '<details class="cpt-raw"><summary>返ってきたデータそのもの（確認用）</summary><pre>' + esc(JSON.stringify(data, null, 2).slice(0, 8000)) + '</pre></details>';
  }
  // 配列の応答を、列の定義どおりの表にする（最大 50 行）。列＝[見出し, 値を返す関数, （任意）色の class を返す関数]
  function listTable(list, cols, label, note) {
    var head = '<tr>' + cols.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '</tr>';
    var rows = list.slice(0, 50).map(function (it) {
      return '<tr>' + cols.map(function (c) {
        var cls = c[2] ? c[2](it || {}) : '';
        return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(c[1](it || {})) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="cpt-live-x">実データ（' + esc(label) + '）：' + list.length + ' 件' + (list.length > 50 ? '（先頭50件を表示）' : '') + (note ? '　' + esc(note) : '') + '</div>' +
      '<div class="cpt-tablewrap"><table class="cpt-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ターミナル名（コード→名前）。最初の 1 回だけ取って使い回す。取れなくても表はコードのまま出す。
  var _termNames = null;
  async function ensureTerminalNames() {
    if (_termNames) return _termNames;
    var map = {};
    try {
      var r = await window.CyberPort.terminals('');
      (Array.isArray(r.data) ? r.data : []).forEach(function (x) {
        if (x && x.terminalCode) map[x.terminalCode] = x.terminalNameAb || x.terminalName || x.terminalNameEn || '';
      });
      _termNames = map;
    } catch (e) { return map; } // 今回は名前なしで表示（次回また試す）
    return _termNames;
  }
  function termCell(names) {
    return function (x) {
      var c = g(x, 'terminalCode') || '';
      return names[c] ? names[c] + '（' + c + '）' : c;
    };
  }

  // 本船が「いまの港」に着く／出る日時とバース。港のオブジェクトのうち、問い合わせた港コードと一致するものを使う。
  function atPort(x, port, dir) {
    var keys = ['portOfLoading', 'portOfTranshipment', 'portOfDischarge'];
    for (var i = 0; i < keys.length; i++) {
      var o = g(x, 'vessel.' + keys[i]);
      if (o && o.portCode === port) return o;
    }
    return g(x, 'vessel.' + (dir === 'export' ? 'portOfLoading' : 'portOfDischarge')) || {};
  }
  function vesselCols(dir, port, names) {
    var at = function (x) { return atPort(x, port, dir); };
    return [
      ['ターミナル', termCell(names)],
      ['本船名', function (x) { return g(x, 'vessel.vesselName'); }],
      ['航海番号', function (x) { return g(x, 'vessel.voyageNo'); }],
      ['IMO', function (x) { return g(x, 'vessel.imoNo'); }],
      ['バース', function (x) { return g(at(x), 'berthName') || g(at(x), 'berthCode'); }],
      ['入港 予定(ETA)', function (x) { return fmtDt(g(at(x), 'estimatedTimeOfArrival')); }],
      ['入港 実績(ATA)', function (x) { return fmtDt(g(at(x), 'actualTimeOfArrival')); }],
      ['出港 予定(ETD)', function (x) { return fmtDt(g(at(x), 'estimatedTimeOfDeparture')); }],
      ['出港 実績(ATD)', function (x) { return fmtDt(g(at(x), 'actualTimeOfDeparture')); }],
      ['荷役 予定', function (x) { return fmtDt(g(x, 'cargoHandling.scheduleAt')); }],
      ['荷役 実績', function (x) { return fmtDt(g(x, 'cargoHandling.actualAt')); }],
      ['搬入 予定', function (x) { return fmtDt(g(x, 'cargoIn.scheduleAt') || g(x, 'cargoIn.cargoInDate')); }],
      ['搬入 実績', function (x) { return fmtDt(g(x, 'cargoIn.actualAt')); }],
      ['CYオープン', function (x) { return fmtDt(g(x, 'cargoTransfer.cyOpenAt')); }],
      ['CYカット', function (x) { return fmtDt(g(x, 'cargoTransfer.cyCutAt')); }, function (x) { return dueClass(g(x, 'cargoTransfer.cyCutAt')); }],
      ['CFSカット', function (x) { return fmtDt(g(x, 'cargoTransfer.cfsCutAt')); }, function (x) { return dueClass(g(x, 'cargoTransfer.cfsCutAt')); }],
      ['備考', function (x) { return g(x, 'remark'); }]
    ];
  }
  // 入港の予定が早い順（日時の無いものは最後）。同じなら荷役の予定の早い順。
  function sortVessels(list, port, dir) {
    var key = function (x) {
      var a = parseDt(g(atPort(x, port, dir), 'estimatedTimeOfArrival')), h = parseDt(g(x, 'cargoHandling.scheduleAt'));
      return [a ? a.d.getTime() : Infinity, h ? h.d.getTime() : Infinity];
    };
    return list.map(function (x, i) { return { x: x, k: key(x), i: i }; })
      .sort(function (p, q) { return (p.k[0] - q.k[0]) || (p.k[1] - q.k[1]) || (p.i - q.i); })
      .map(function (o) { return o.x; });
  }

  function containerCols(dir, names) {
    var place = function (x, k) { return g(x, k + '.placeName') || g(x, k + '.placeCode'); };
    var common = [
      ['ターミナル', termCell(names)],
      ['コンテナ', function (x) { return g(x, 'container.containerNo'); }],
      ['サイズ・種類', function (x) { return [g(x, 'container.lengthName'), g(x, 'container.containerTypeName')].filter(Boolean).join(' '); }],
      ['本船／航海', function (x) { return [g(x, 'vessel.vesselName'), g(x, 'vessel.voyageNo')].filter(Boolean).join(' / '); }]
    ];
    if (dir === 'export') {
      return common.concat([
        ['実入り/空', function (x) { return g(x, 'containerStatus.fullOrEmpty'); }],
        ['通関', function (x) { return g(x, 'containerStatus.customClearanceStatus'); }],
        ['船積可否', function (x) { return yn(g(x, 'shipmentAvailability')); }],
        ['空搬出 場所', function (x) { return place(x, 'emptyContainerPickup.pickupPlace'); }],
        ['空搬出 予定', function (x) { return fmtDt(g(x, 'emptyContainerPickup.scheduledAt')); }],
        ['空搬出 実績', function (x) { return fmtDt(g(x, 'emptyContainerPickup.actualAt')); }],
        ['実入り搬入 場所', function (x) { return place(x, 'loadedContainerDelivery.deliveryPlace'); }],
        ['実入り搬入 予定', function (x) { return fmtDt(g(x, 'loadedContainerDelivery.scheduledAt')); }],
        ['実入り搬入 実績', function (x) { return fmtDt(g(x, 'loadedContainerDelivery.actualAt')); }],
        ['ゲートイン', function (x) { return fmtDt(g(x, 'gateInDate')); }],
        ['荷役日', function (x) { return fmtDt(g(x, 'loadingUnloadingDate')); }],
        ['船積日', function (x) { return fmtDt(g(x, 'shipmentDate')); }],
        ['備考', function (x) { return g(x, 'emptyContainerPickup.remark') || g(x, 'loadedContainerDelivery.remark'); }]
      ]);
    }
    var pk = 'loadedContainerPickup', rt = 'emptyContainerReturn';
    return common.concat([
      ['B/L', function (x) { return g(x, 'billOfLadingDetail.blNo'); }],
      ['実入り/空', function (x) { return g(x, 'containerStatus.fullOrEmpty'); }],
      ['通関', function (x) { return g(x, 'containerStatus.customClearanceStatus'); }],
      ['検査対象', function (x) { return yn(g(x, 'inspectionTarget')); }],
      ['検査状況', function (x) { return yn(g(x, 'inspectionStatus')); }],
      ['DO入手', function (x) { return yn(g(x, 'doAcquisition')); }],
      ['搬出可否', function (x) { return yn(g(x, 'outboundAvailability')); }],
      ['搬出可能', function (x) { return fmtDt(g(x, pk + '.availableAt')); }],
      ['搬出期限', function (x) { return fmtDt(g(x, pk + '.dueAt')); }, function (x) { return dueClass(g(x, pk + '.dueAt')); }],
      ['ﾃﾞﾏﾚｰｼﾞFT(日)', function (x) { return num(g(x, pk + '.demurrageFreeTime')); }],
      ['搬出 場所', function (x) { return place(x, pk + '.pickupPlace'); }],
      ['CY搬入', function (x) { return fmtDt(g(x, 'cyCarryInDate')); }],
      ['ゲートイン', function (x) { return fmtDt(g(x, 'gateInDate')); }],
      ['ゲートアウト', function (x) { return fmtDt(g(x, 'gateOutDate')); }],
      ['返却期限', function (x) { return fmtDt(g(x, rt + '.dueAt')); }, function (x) { return dueClass(g(x, rt + '.dueAt')); }],
      ['ﾃﾞｨﾃﾝｼｮﾝFT(日)', function (x) { return num(g(x, rt + '.detentionFreeTime')); }],
      ['返却 場所', function (x) { return place(x, rt + '.deliveryPlace'); }],
      ['危険品', function (x) { return yn(g(x, 'isDangerousGoods')); }],
      ['備考', function (x) { return g(x, 'remark'); }]
    ]);
  }
  // 期限が「過ぎた／48時間以内」のコンテナの数（表の上の案内）
  function dueNote(list) {
    var keys = [['搬出期限', 'loadedContainerPickup.dueAt'], ['返却期限', 'emptyContainerReturn.dueAt']];
    var parts = [];
    keys.forEach(function (k) {
      var over = 0, warn = 0;
      list.forEach(function (x) { var c = dueClass(g(x, k[1])); if (c === 'cpt-due-over') over++; else if (c === 'cpt-due-warn') warn++; });
      if (over || warn) parts.push(k[0] + '：超過 ' + over + ' 件・48時間以内 ' + warn + ' 件');
    });
    return parts.length ? '⚠ ' + parts.join(' ／ ') : '';
  }

  function notArray(data) {
    return msg('is-info', '想定と違う形のデータが返りました。下の「返ってきたデータそのもの」を確認してください。') + rawHtml(data);
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
      var names = await ensureTerminalNames();
      var r = await window.CyberPort.colinsVessels(dir, port, q);
      setLinkStatus(true, '');
      if (!Array.isArray(r.data)) { liveBox().innerHTML = notArray(r.data); return; }
      if (!r.data.length) { liveBox().innerHTML = msg('is-info', port + ' の本船の動静は見つかりませんでした（0件）。') + rawHtml(r.data); return; }
      liveBox().innerHTML = listTable(sortVessels(r.data, port, dir), vesselCols(dir, port, names), 'COLINS・本船の動静', '入港予定の早い順') + rawHtml(r.data);
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
      var names = await ensureTerminalNames();
      var r = await window.CyberPort.colinsContainers(dir, no, {});
      setLinkStatus(true, '');
      if (!Array.isArray(r.data)) { liveBox().innerHTML = notArray(r.data); return; }
      if (!r.data.length) { liveBox().innerHTML = msg('is-info', '「' + no + '」のコンテナは見つかりませんでした（0件）。') + rawHtml(r.data); return; }
      liveBox().innerHTML = listTable(r.data, containerCols(dir, names), 'COLINS・コンテナの状況', dir === 'import' ? dueNote(r.data) : '') + rawHtml(r.data);
    } catch (e) {
      liveBox().innerHTML = errHtml(e);
    } finally { liveBusy(false); }
  }

  // ---------- ⑤ 通知できる操作の一覧（Webhook で何を知らせてもらえるか） ----------
  var _ops = null, _opsShown = false;
  function opsTable(list) {
    var f = (((document.getElementById('cptOpFilter') || {}).value) || '').trim().toLowerCase();
    var rows = list.filter(function (o) { return !f || JSON.stringify(o).toLowerCase().indexOf(f) >= 0; });
    var edi = list.filter(function (o) { return /edifact/i.test(JSON.stringify(o)); }).length;
    var cols = [
      ['コード', function (x) { return g(x, 'notifiableOperationCode'); }],
      ['操作', function (x) { return g(x, 'operationType.operationTypeName') || g(x, 'operationType.operationTypeCode'); }],
      ['帳票', function (x) { return g(x, 'reportType.reportName'); }],
      ['プロセス', function (x) { return g(x, 'process.processName'); }]
    ];
    var note = 'EDIFACT に関する操作：' + edi + ' 件' + (f ? '／「' + f + '」に一致：' + rows.length + ' 件' : '');
    if (!rows.length) return '<div class="cpt-live-x">実データ（通知できる操作）：全 ' + list.length + ' 件　' + esc(note) + '</div>' + msg('is-info', '一致する操作がありません。');
    return listTable(rows.slice(0, 200), cols, '通知できる操作・全 ' + list.length + ' 件中', note + (rows.length > 200 ? '（先頭200件を表示）' : ''));
  }
  function renderOps() {
    if (!Array.isArray(_ops)) return;
    liveBox().innerHTML = opsTable(_ops) + rawHtml(_ops.slice(0, 20));
  }
  async function liveOps() {
    if (!needApi()) return;
    liveBusy(true);
    liveBox().innerHTML = msg('is-info', '通知できる操作の一覧を取得しています…');
    try {
      if (!_ops) {
        var r = await window.CyberPort.notifiableOperations();
        if (!Array.isArray(r.data)) { liveBox().innerHTML = notArray(r.data); return; }
        _ops = r.data;
      }
      setLinkStatus(true, '');
      _opsShown = true;
      renderOps();
    } catch (e) {
      _opsShown = false;
      liveBox().innerHTML = errHtml(e);
    } finally { liveBusy(false); }
  }

  // ---------- 📨 受信した通知（Webhook：Supabase の表 cp_events を読むだけ） ----------
  var _evKind = '', _evRows = [], _evOpen = {}, _evPayload = {}, _evUnsub = null, _evNew = {}, _evRetry = false;
  var KIND_LABEL = { message: '💬 チャット', report: '📄 帳票', naccs: '🛃 NACCS', trade: '📦 取引', task: '☑ タスク', process: '⚙ プロセス', other: 'その他' };
  function evBodyEl() { return document.getElementById('cptEvBody'); }
  function evStatus(html) { var el = document.getElementById('cptEvStatus'); if (el) el.innerHTML = html || ''; }
  function evLiveDot(status) {
    return status === 'SUBSCRIBED' ? '<span class="cpt-live-dot is-on" title="リアルタイムで受信待機中"></span>受信待機中'
      : status ? '<span class="cpt-live-dot" title="リアルタイム接続が確立できていません（再読み込みで更新できます）"></span>手動更新のみ' : '';
  }
  function evRender() {
    var box = evBodyEl(); if (!box) return;
    var n = _evRows.length;
    if (!n) { box.innerHTML = msg('is-info', '通知はまだありません。サイバーポート側で Webhook を設定し、操作が行われると、ここに増えます（設定の手順は docs/サイバーポート連携-Webhook.md）。'); return; }
    var head = '<tr><th>受信</th><th>種類</th><th>操作</th><th>取引番号</th><th>B/L</th><th>帳票</th><th>コンテナ</th><th>履歴ID</th><th></th></tr>';
    var rows = _evRows.map(function (x) {
      var open = !!_evOpen[x.id];
      var main = '<tr class="' + (_evNew[x.id] ? 'cpt-ev-new' : '') + '"><td>' + esc(fmtDt(x.received_at)) + '</td><td>' + esc(KIND_LABEL[x.kind] || x.kind) + '</td><td>' +
        esc(x.operation_name || x.operation_code || '') + '</td><td>' + esc(x.trade_no || '') + '</td><td>' + esc(x.bl_no || '') + '</td><td>' + esc(x.report_name || x.report_code || '') +
        '</td><td>' + esc(x.container_no || '') + '</td><td class="cpt-mono">' + esc(x.history_id || '') + '</td><td><button type="button" class="cpt-btn cpt-ev-detail-btn" data-id="' + esc(x.id) + '">' + (open ? '閉じる' : '詳細') + '</button></td></tr>';
      if (!open) return main;
      var p = _evPayload[x.id];
      var det = '<tr class="cpt-ev-detail"><td colspan="9">' +
        (p === undefined ? '<div class="cpt-hint">読み込み中…</div>' : '<pre>' + esc(JSON.stringify(p, null, 2).slice(0, 12000)) + '</pre>') +
        (x.history_id ? '<div class="cpt-form"><button type="button" class="cpt-btn cpt-ev-hist-btn" data-id="' + esc(x.id) + '" data-hid="' + esc(x.history_id) + '">この操作の履歴を取得（読み取り）</button></div><div class="cpt-ev-hist" id="cptEvHist' + esc(x.id) + '"></div>' : '') +
        '</td></tr>';
      return main + det;
    }).join('');
    box.innerHTML = '<div class="cpt-tablewrap"><table class="cpt-table cpt-ev-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>';
  }
  function evStatusLine(status) {
    evStatus('<span>' + _evRows.length + ' 件（新しい順）</span> ' + evLiveDot(status));
  }
  function evFail(e) {
    var box = evBodyEl(); if (!box) return;
    box.innerHTML = e && e.code === 'notready' ? msg('is-info', e.message) : errHtml(e);
    evStatus('');
  }
  var _evLast = '';
  async function evLoad(first) {
    if (!window.CpEvents) { var b = evBodyEl(); if (b) b.innerHTML = errHtml({ message: 'cp-events.js が読み込まれていません' }); return; }
    evStatus('読み込み中…');
    try {
      _evRows = await window.CpEvents.fetchRecent({ limit: 50, kind: _evKind });
      _evRows.forEach(function (x) { delete _evNew[x.id]; });
      evRender(); evStatusLine(_evLast);
      if (!_evUnsub) {
        _evUnsub = window.CpEvents.subscribe(function (row) {
          if (_evKind && row.kind !== _evKind) return;
          if (_evRows.some(function (x) { return x.id === row.id; })) return;
          if (row.payload !== undefined) _evPayload[row.id] = row.payload;
          var light = Object.assign({}, row); delete light.payload;
          _evNew[row.id] = true;
          _evRows.unshift(light); _evRows = _evRows.slice(0, 100);
          evRender(); evStatusLine(_evLast);
        }, function (status) { _evLast = status; evStatusLine(status); });
      }
    } catch (e) {
      // 起動直後は、ログイン情報の復元が間に合わないことがある。1 度だけ、少し待ってやり直す。
      if (first && e && e.code === 'login' && !_evRetry) { _evRetry = true; evStatus('ログインを確認しています…'); setTimeout(function () { evLoad(); }, 2000); return; }
      evFail(e);
    }
  }
  async function evClick(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var d = t.closest('.cpt-ev-detail-btn');
    if (d) {
      var id = d.getAttribute('data-id');
      _evOpen[id] = !_evOpen[id];
      evRender();
      if (_evOpen[id] && _evPayload[id] === undefined) {
        try { _evPayload[id] = await window.CpEvents.fetchPayload(id); } catch (e) { _evPayload[id] = { error: (e && e.message) || '読み込めませんでした' }; }
        evRender();
      }
      return;
    }
    var h = t.closest('.cpt-ev-hist-btn');
    if (h && window.CyberPort) {
      var out = document.getElementById('cptEvHist' + h.getAttribute('data-id'));
      if (!out) return;
      h.disabled = true; out.innerHTML = msg('is-info', '操作の履歴を取得しています…');
      try {
        var r = await window.CyberPort.tradeHistory(h.getAttribute('data-hid'));
        out.innerHTML = '<pre>' + esc(JSON.stringify(r.data, null, 2).slice(0, 12000)) + '</pre>';
      } catch (e) { out.innerHTML = errHtml(e); }
      h.disabled = false;
    }
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
      '<div class="cpt-head"><h2 class="cpt-title">🧪 CPテスト</h2>' +
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
      '<div class="cpt-form"><input type="text" id="cptOpFilter" class="cpt-input" maxlength="40" autocomplete="off" placeholder="絞り込み（例：EDIFACT・メッセージ・帳票名）" aria-label="通知できる操作の絞り込み">' +
      '<button type="button" class="cpt-btn" id="cptOps">⑤ 通知できる操作の一覧</button></div>' +
      '<div id="cptLive" class="cpt-live" aria-live="polite"></div></div>' +
      // ---- 📨 受信した通知（Webhook）
      '<div class="cpt-card" id="cptEvCard"><div class="cpt-card-h">📨 受信した通知（Webhook）</div>' +
      '<p class="cpt-hint">サイバーポートから届いた通知（取引・帳票・チャット・NACCS電文の操作）です。新しく届くと自動で先頭に増えます。表示だけで、書き込みはしません。</p>' +
      '<div class="cpt-form"><select id="cptEvKind" class="cpt-select" aria-label="通知の種類で絞り込み">' +
      '<option value="">すべての種類</option><option value="message">💬 チャット</option><option value="report">📄 帳票</option><option value="naccs">🛃 NACCS</option>' +
      '<option value="trade">📦 取引</option><option value="task">☑ タスク</option><option value="process">⚙ プロセス</option><option value="other">その他</option></select>' +
      '<button type="button" class="cpt-btn" id="cptEvReload">再読み込み</button>' +
      '<span class="cpt-ev-status" id="cptEvStatus" aria-live="polite"></span></div>' +
      '<div id="cptEvBody" class="cpt-live"></div></div>' +
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
    document.getElementById('cptOps').addEventListener('click', liveOps);
    document.getElementById('cptOpFilter').addEventListener('input', function () { if (_opsShown) renderOps(); });
    document.getElementById('cptOpFilter').addEventListener('keydown', function (e) { if (e.key === 'Enter') liveOps(); });
    document.getElementById('cptEvReload').addEventListener('click', function () { evLoad(); });
    document.getElementById('cptEvKind').addEventListener('change', function () { _evKind = this.value; evLoad(); });
    document.getElementById('cptEvBody').addEventListener('click', evClick);
    run();
    evLoad(true);
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
  window.CpTest = { normalizeNo: normalizeNo, fmtDt: fmtDt, dueClass: dueClass, resetTerminalNames: function () { _termNames = null; } };
})();
