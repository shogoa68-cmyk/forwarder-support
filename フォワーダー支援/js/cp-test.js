/* cp-test.js — 🚢 サイバーポート：サイバーポート連携の画面（読み取りのみ）。
 * js/integrations/cyberport.js → Edge Function「cp-proxy」経由で読み取り専用の API を呼ぶ
 * （接続情報が未設定・関数が未配置のときは、その旨をエラーとして表示する）。
 * 設計は docs/サイバーポート連携_設計案.md。
 * 初期化は js/app.js の switchTab() から window.initCpTestTab() が呼ばれる（冪等）。 */
(function () {
  'use strict';

  // ---- 番号の正規化（検証シートの課題：'ONEY TYOGF8748400' → 'ONEYTYOGF8748400'）----
  // 空白（全角含む）をすべて取り除き、英字を大文字にそろえる。ハイフンは番号の一部のため残す。
  function normalizeNo(raw) {
    return String(raw == null ? '' : raw).replace(/[\s　]+/g, '').toUpperCase();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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

  // ターミナル一覧（コード→名前・港の選択肢の元）。最初の 1 回だけ取って使い回す。取れなくても表はコードのまま出す。
  var _termNames = null, _termList = null, _ports = null, _portsTriedAt = 0;
  async function loadTerminals() {
    if (_termList) return _termList;
    var r = await window.CyberPort.terminals('');
    _termList = Array.isArray(r.data) ? r.data : [];
    return _termList;
  }
  async function ensureTerminalNames() {
    if (_termNames) return _termNames;
    var map = {};
    try {
      (await loadTerminals()).forEach(function (x) {
        if (x && x.terminalCode) map[x.terminalCode] = x.terminalNameAb || x.terminalName || x.terminalNameEn || '';
      });
      _termNames = map;
      _ports = portsFromTerminals(_termList);
      renderPortSelect();                 // 港の選択肢を、サイバーポートの港の一覧に置き換える
    } catch (e) { return map; } // 今回は名前なしで表示（次回また試す）
    return _termNames;
  }
  // 港の一覧をこっそり先に取っておく（失敗しても何も出さない。60 秒に 1 回まで）
  function prefetchPorts() {
    if (_termList || !window.CyberPort) return;
    var t = Date.now(); if (t - _portsTriedAt < 60000) return; _portsTriedAt = t;
    ensureTerminalNames();
  }

  // ---- 港の選択（自由入力から選択式へ） ----
  // 「港」は UN/LOCODE の 5 桁コード。ターミナルの一覧（Terminals/GetList）の portLocation から、港ごとに 1 つ作る。
  // 一覧が取れていないあいだは、よく使う港（下の固定リスト）を出す。一覧に無い港は「その他」でコードを入力できる。
  var BASE_PORTS = [['JPTYO', '東京'], ['JPYOK', '横浜'], ['JPKWS', '川崎'], ['JPNGO', '名古屋'], ['JPOSA', '大阪'], ['JPUKB', '神戸'],
    ['JPHKT', '博多'], ['JPTMK', '苫小牧'], ['JPNIG', '新潟'], ['JPYKK', '四日市'], ['JPTAK', '高松']];
  var PORT_OTHER = '__other';
  function portsFromTerminals(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (t, i) {
      var pl = t && t.portLocation;
      var code = pl && String(pl.portCode || '').replace(/[\s\u3000]+/g, '').toUpperCase();
      if (!code || !/^[A-Z]{2}[A-Z0-9]{3}$/.test(code) || seen[code]) return;
      seen[code] = true;
      var ord = Number(pl.displayOrder);
      out.push({ code: code, name: pl.portName || pl.portNameAb || pl.portNameEn || '', order: isFinite(ord) && pl.displayOrder != null && pl.displayOrder !== '' ? ord : 1e9, i: i });
    });
    out.sort(function (a, b) { return (a.order - b.order) || (a.i - b.i); });
    return out;
  }
  function portListNow() {
    return (_ports && _ports.length) ? _ports : BASE_PORTS.map(function (b) { return { code: b[0], name: b[1] }; });
  }
  function portLabel(c) { return (c.name ? c.name + '（' + c.code + '）' : c.code); }
  var _portOther = false;
  function renderPortSelect() {
    var sel = document.getElementById('cptPortSel'), inp = document.getElementById('cptPort');
    if (!sel || !inp) return;
    var cur = String(inp.value || '').replace(/[\s\u3000]+/g, '').toUpperCase();
    var list = portListNow();
    var inList = list.some(function (c) { return c.code === cur; });
    sel.innerHTML = list.map(function (c) { return '<option value="' + esc(c.code) + '">' + esc(portLabel(c)) + '</option>'; }).join('') +
      '<option value="' + PORT_OTHER + '">その他（港コードを入力）</option>';
    // いまの値が一覧に無い（または「その他」を選んでいる）ときは、「その他」のまま入力欄を出しておく
    if (_portOther || !inList) { _portOther = true; sel.value = PORT_OTHER; } else { sel.value = cur; }
    inp.classList.toggle('is-off', !_portOther);
  }
  function onPortSelect() {
    var sel = document.getElementById('cptPortSel'), inp = document.getElementById('cptPort');
    if (!sel || !inp) return;
    if (sel.value === PORT_OTHER) { _portOther = true; inp.classList.remove('is-off'); try { inp.focus(); inp.select(); } catch (e) { /* 何もしない */ } }
    else { _portOther = false; inp.value = sel.value; inp.classList.add('is-off'); }
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
      ['デマレージFT(日)', function (x) { return num(g(x, pk + '.demurrageFreeTime')); }],
      ['搬出 場所', function (x) { return place(x, pk + '.pickupPlace'); }],
      ['CY搬入', function (x) { return fmtDt(g(x, 'cyCarryInDate')); }],
      ['ゲートイン', function (x) { return fmtDt(g(x, 'gateInDate')); }],
      ['ゲートアウト', function (x) { return fmtDt(g(x, 'gateOutDate')); }],
      ['返却期限', function (x) { return fmtDt(g(x, rt + '.dueAt')); }, function (x) { return dueClass(g(x, rt + '.dueAt')); }],
      ['ディテンションFT(日)', function (x) { return num(g(x, rt + '.detentionFreeTime')); }],
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

  // =====================================================================
  //  画面（案C：左で選ぶ、右で流れを見る）。設計は docs/design-handoff の 17・案C。
  //  COLINS に情報が無い項目は、空欄にせず「COLINSに情報がありません」と表示する（取引は「サイバーポートに情報がありません」）。
  // =====================================================================
  var NODATA_C = 'COLINSに情報がありません', NODATA_T = 'サイバーポートに情報がありません';
  var NODATA_C_S = 'COLINSに情報なし', NODATA_T_S = 'サイバーポートに情報なし';
  function has(v) { return !(v == null || v === ''); }
  function nowMs() { return Date.now(); }

  // 期限の段階：'over'（過ぎた）／'warn'（48 時間以内）／'ok'（まだ先）／null（読めない・値なし）
  function levelOf(v, now) {
    var c = dueClass(v, now);
    if (c === 'cpt-due-over') return 'over';
    if (c === 'cpt-due-warn') return 'warn';
    return parseDt(v) ? 'ok' : null;
  }
  // 「あと 6日」「超過 33分」のような目安（日付だけの期限はその日の終わりまで）
  function remainText(v, now) {
    var p = parseDt(v); if (!p) return '';
    var endMs = p.d.getTime() + (p.dateOnly ? 24 * 3600 * 1000 : 0);
    var diff = endMs - (now == null ? nowMs() : now), over = diff < 0, a = Math.abs(diff);
    var mins = Math.floor(a / 60000), hrs = Math.floor(a / 3600000), days = Math.floor(a / 86400000);
    var t = mins < 60 ? Math.max(mins, 1) + '分' : hrs < 48 ? hrs + '時間' : days + '日';
    return (over ? '超過 ' : 'あと ') + t;
  }
  // 予定を過ぎているのに実績が無い（輸出の搬出・搬入）
  function slipped(sched, actual, now) {
    if (has(actual)) return false;
    var p = parseDt(sched); if (!p) return false;
    return p.d.getTime() + (p.dateOnly ? 24 * 3600 * 1000 : 0) < (now == null ? nowMs() : now);
  }

  // ---- 流れの 1 段：{t, v, st: done|over|warn|todo|nodata, b（バッジの上書き）} → 色・バッジつきに整える ----
  function mkSteps(S, nodataText) {
    var first = -1;
    S.forEach(function (p, i) { if (first < 0 && p.st === 'todo') first = i; });
    return S.map(function (p, i) {
      var nd = p.st === 'nodata';
      var badge = p.b ? p.b : nd ? '情報なし' : p.st === 'done' ? '済' : p.st === 'over' ? '超過' : p.st === 'warn' ? '48時間以内' : (i === first ? 'いまここ' : '未');
      var cls = nd ? 'is-nodata' : p.st === 'done' ? 'is-ok' : p.st === 'over' ? 'is-over' : p.st === 'warn' ? 'is-warn' : (i === first ? 'is-now' : '');
      return { t: p.t, v: nd ? nodataText : p.v, st: p.st, badge: badge, cls: cls, now: i === first };
    });
  }
  function place(x, k) { return g(x, k + '.placeName') || g(x, k + '.placeCode') || ''; }
  function sched2(x, k, now) { // 空コン搬出・実入り搬入：{場所・予定・実績}
    var sc = g(x, k + '.scheduledAt'), ac = g(x, k + '.actualAt'), pl = place(x, k === 'emptyContainerPickup' ? 'emptyContainerPickup.pickupPlace' : 'loadedContainerDelivery.deliveryPlace');
    var none = !has(sc) && !has(ac) && !has(pl);
    var slip = slipped(sc, ac, now);
    var parts = [];
    if (pl) parts.push(pl);
    if (has(sc)) parts.push('予定 ' + fmtDt(sc));
    if (has(ac)) parts.push('実績 ' + fmtDt(ac));
    return { none: none, slip: slip, done: has(ac), text: parts.join('／') };
  }
  function stepOf(label, d) { return { t: label, v: d.text, st: d.none ? 'nodata' : d.done ? 'done' : d.slip ? 'warn' : 'todo', b: d.slip ? '予定超過' : '' }; }
  function isPermitted(s) { return /許可|PERMIT/i.test(String(s || '')); }

  // 輸入コンテナ：CY搬入 → 通関 → DO入手 → 搬出可否 → 搬出期限 → 返却期限
  function stepsImportContainer(x, now) {
    var cy = g(x, 'cyCarryInDate'), clr = g(x, 'containerStatus.customClearanceStatus'), dov = g(x, 'doAcquisition'), out = g(x, 'outboundAvailability');
    var pick = g(x, 'loadedContainerPickup.dueAt'), ret = g(x, 'emptyContainerReturn.dueAt'), gout = g(x, 'gateOutDate');
    var lvStep = function (v, doneIf) {
      var l = levelOf(v, now);
      return doneIf ? 'done' : (l === 'over' ? 'over' : l === 'warn' ? 'warn' : 'todo');
    };
    var inspect = g(x, 'inspectionTarget') === true ? '（検査対象）' : '';
    return mkSteps([
      { t: 'CY搬入', v: fmtDt(cy), st: has(cy) ? 'done' : 'nodata' },
      { t: '通関', v: String(clr || '') + inspect, st: !has(clr) ? 'nodata' : isPermitted(clr) ? 'done' : 'todo' },
      { t: 'DO入手', v: dov === true ? '入手済み' : 'まだ入手していません', st: dov == null ? 'nodata' : dov ? 'done' : 'todo' },
      { t: '搬出可否', v: out === true ? '搬出できます' + (has(g(x, 'loadedContainerPickup.availableAt')) ? '（' + fmtDt(g(x, 'loadedContainerPickup.availableAt')) + '〜）' : '') : '搬出できません' + (g(x, 'remark') ? '：' + g(x, 'remark') : ''), st: out == null ? 'nodata' : out ? 'done' : 'todo' },
      { t: '搬出期限', v: has(pick) ? (has(gout) ? fmtDt(pick) + '　搬出済み' : fmtDt(pick) + '　' + remainText(pick, now)) : '', st: !has(pick) ? 'nodata' : lvStep(pick, has(gout)) },
      { t: '返却期限', v: has(ret) ? fmtDt(ret) + '　' + remainText(ret, now) : '', st: !has(ret) ? 'nodata' : lvStep(ret, false) }
    ], NODATA_C);
  }
  // 輸出コンテナ：空コン搬出 → 実入り搬入 → ゲートイン → 通関 → 船積可否 → 荷役 → 船積
  function stepsExportContainer(x, now) {
    var e = sched2(x, 'emptyContainerPickup', now), f = sched2(x, 'loadedContainerDelivery', now);
    var gin = g(x, 'gateInDate'), clr = g(x, 'containerStatus.customClearanceStatus'), sa = g(x, 'shipmentAvailability');
    var wk = g(x, 'loadingUnloadingDate'), sd = g(x, 'shipmentDate');
    var past = function (v) { var p = parseDt(v); return p && p.d.getTime() < (now == null ? nowMs() : now); };
    var remark = g(x, 'emptyContainerPickup.remark') || g(x, 'loadedContainerDelivery.remark') || g(x, 'remark') || '';
    return mkSteps([
      stepOf('空コンの搬出', e),
      stepOf('実入りの搬入', f),
      { t: 'ゲートイン', v: fmtDt(gin), st: has(gin) ? 'done' : 'nodata' },
      { t: '通関', v: String(clr || ''), st: !has(clr) ? 'nodata' : isPermitted(clr) ? 'done' : 'todo' },
      { t: '船積可否', v: sa === true ? '船積できます' : '船積できません' + (remark ? '：' + remark : ''), st: sa == null ? 'nodata' : sa ? 'done' : 'warn', b: sa === false ? '止まっています' : '' },
      { t: '荷役', v: has(wk) ? (past(wk) ? '' : '予定 ') + fmtDt(wk) : '', st: !has(wk) ? 'nodata' : past(wk) ? 'done' : 'todo' },
      { t: '船積', v: has(sd) ? (past(sd) ? '' : '予定 ') + fmtDt(sd) : '', st: !has(sd) ? 'nodata' : past(sd) ? 'done' : 'todo' }
    ], NODATA_C);
  }
  // 本船：入港 → 荷役 → 搬入 → CYオープン → CFSカット → CYカット → 出港
  function stepsVessel(x, port, dir, now) {
    var at = atPort(x, port, dir), eta = g(at, 'estimatedTimeOfArrival'), ata = g(at, 'actualTimeOfArrival'), etd = g(at, 'estimatedTimeOfDeparture'), atd = g(at, 'actualTimeOfDeparture');
    var hs = g(x, 'cargoHandling.scheduleAt'), ha = g(x, 'cargoHandling.actualAt');
    var cs = g(x, 'cargoIn.scheduleAt') || g(x, 'cargoIn.cargoInDate'), ca = g(x, 'cargoIn.actualAt');
    var cyo = g(x, 'cargoTransfer.cyOpenAt'), cfs = g(x, 'cargoTransfer.cfsCutAt'), cyc = g(x, 'cargoTransfer.cyCutAt');
    var pair = function (sc, ac) { return (has(sc) ? '予定 ' + fmtDt(sc) : '') + (has(sc) && has(ac) ? '／' : '') + (has(ac) ? '実績 ' + fmtDt(ac) : ''); };
    var sp = function (label, sc, ac) { return { t: label, v: pair(sc, ac), st: !has(sc) && !has(ac) ? 'nodata' : has(ac) ? 'done' : 'todo' }; };
    var cut = function (label, v) {
      if (!has(v)) return { t: label, v: '', st: 'nodata' };
      if (has(atd)) return { t: label, v: fmtDt(v), st: 'done' };
      var l = levelOf(v, now);
      return { t: label, v: fmtDt(v) + '　' + remainText(v, now), st: l === 'over' ? 'over' : l === 'warn' ? 'warn' : 'todo' };
    };
    var open = !has(cyo) ? { t: 'CYオープン', v: '', st: 'nodata' } : { t: 'CYオープン', v: fmtDt(cyo), st: (parseDt(cyo) && parseDt(cyo).d.getTime() < (now == null ? nowMs() : now)) ? 'done' : 'todo' };
    return mkSteps([sp('入港', eta, ata), sp('荷役', hs, ha), sp('搬入', cs, ca), open, cut('CFSカット', cfs), cut('CYカット', cyc), sp('出港', etd, atd)], NODATA_C);
  }

  // ---- 一覧の 1 行（状態の丸・見出し・小さな説明・札） ----
  function vesselTitle(x) { return [g(x, 'vessel.vesselName'), g(x, 'vessel.voyageNo')].filter(Boolean).join(' / ') || '（本船名なし）'; }
  function levelOfContainerImport(x, now) {
    var a = levelOf(g(x, 'loadedContainerPickup.dueAt'), now), b = levelOf(g(x, 'emptyContainerReturn.dueAt'), now);
    if (a === 'over' || b === 'over') return 'over';
    if (a === 'warn' || b === 'warn') return 'warn';
    return (a || b) ? 'ok' : null;
  }
  function levelOfContainerExport(x, now) {
    var e = sched2(x, 'emptyContainerPickup', now), f = sched2(x, 'loadedContainerDelivery', now);
    if (g(x, 'shipmentAvailability') === false || e.slip || f.slip) return 'warn';
    var any = has(g(x, 'shipmentAvailability')) || !e.none || !f.none;
    return any ? 'ok' : null;
  }
  function levelOfVessel(x, port, dir, now) {
    if (has(g(atPort(x, port, dir), 'actualTimeOfDeparture'))) return 'ok';
    var a = levelOf(g(x, 'cargoTransfer.cyCutAt'), now), b = levelOf(g(x, 'cargoTransfer.cfsCutAt'), now);
    if (a === 'over' || b === 'over') return 'over';
    if (a === 'warn' || b === 'warn') return 'warn';
    return (a || b) ? 'ok' : null;
  }
  var LV_CHIP = { over: '超過', warn: '48時間以内', ok: '順調', none: '情報なし' };

  // ---- 状態（タブごとの結果・選択・絞り込みは、ここに残す＝タブを切り替えても消えない。保存はしない） ----
  var ST = { tab: 'ctn', dir: 'import', mv: 'list', allOpen: false, devOpen: false, conn: 'none', connHost: '', store: {}, devRaw: '', devErr: '', busy: false };
  function keyOf() { return ST.tab === 'trade' ? 'trade' : ST.tab + ':' + ST.dir; }
  function slot() { var k = keyOf(); return ST.store[k] || (ST.store[k] = { items: null, sel: 0, filter: 'all', msg: null, meta: {} }); }
  function root() { return document.getElementById('cptRoot'); }
  function $id(i) { return document.getElementById(i); }

  function itemsOf(k) { var s = ST.store[k]; return s && Array.isArray(s.items) ? s.items : null; }
  // 一覧の行データ（画面用に整える）
  function rowsFor(k, now) {
    var s = ST.store[k]; if (!s || !Array.isArray(s.items)) return [];
    var meta = s.meta || {}, names = meta.names || {}, out = [];
    s.items.forEach(function (x, i) {
      var r;
      if (k === 'trade') {
        var done = /完了|complete/i.test(String(g(x, 'tradeStatus') || ''));
        r = { i: i, title: g(x, 'tradeNo') || '（番号なし）', sub: g(x, 'tradeName') || '', dot: done ? 'ok' : 'now', chip: g(x, 'tradeStatus') || '', cls: done ? 'is-ok' : '', lv: null };
      } else if (k.indexOf('vessel:') === 0) {
        var dir = meta.dir, port = meta.port, at = atPort(x, port, dir), eta = g(at, 'estimatedTimeOfArrival'), ata = g(at, 'actualTimeOfArrival');
        var lv = levelOfVessel(x, port, dir, now), cyc = levelOf(g(x, 'cargoTransfer.cyCutAt'), now);
        var chip = lv === null ? LV_CHIP.none : (lv === 'over' ? 'カット超過' : cyc === 'warn' || lv === 'warn' ? 'CYカット間近' : '順調');
        var when = has(ata) ? fmtDt(ata).slice(5) + '（実績）' : has(eta) ? fmtDt(eta).slice(5) + '（予定）' : NODATA_C_S;
        r = { i: i, title: vesselTitle(x), sub: '入港 ' + when, dot: lv || 'none', chip: chip, cls: lv === 'over' ? 'is-over' : lv === 'warn' ? 'is-warn' : lv === 'ok' ? 'is-ok' : 'is-nodata', lv: lv };
      } else if (k === 'ctn:import') {
        var l = levelOfContainerImport(x, now), outv = g(x, 'outboundAvailability'), pk = g(x, 'loadedContainerPickup.dueAt');
        var size = [g(x, 'container.lengthName'), g(x, 'container.containerTypeName')].filter(Boolean).join(' ');
        r = { i: i, title: g(x, 'container.containerNo') || '（番号なし）', sub: size + (size ? '　' : '') + (outv === false ? '搬出できない' : has(pk) ? '搬出 ' + remainText(pk, now) : NODATA_C_S), dot: l || 'none', chip: l ? LV_CHIP[l] : LV_CHIP.none, cls: l === 'over' ? 'is-over' : l === 'warn' ? 'is-warn' : l === 'ok' ? 'is-ok' : 'is-nodata', lv: l };
      } else {
        var le = levelOfContainerExport(x, now), size2 = [g(x, 'container.lengthName'), g(x, 'container.containerTypeName')].filter(Boolean).join(' ');
        var em = sched2(x, 'emptyContainerPickup', now), fi = sched2(x, 'loadedContainerDelivery', now), sdt = g(x, 'shipmentDate');
        var note = g(x, 'shipmentAvailability') === false ? '船積できない' : (em.slip || fi.slip) ? '予定を過ぎている' : has(sdt) ? '船積 ' + fmtDt(sdt).slice(5) : NODATA_C_S;
        r = { i: i, title: g(x, 'container.containerNo') || '（番号なし）', sub: size2 + (size2 ? '　' : '') + note, dot: le || 'none', chip: le === 'warn' ? '要確認' : le === 'ok' ? '順調' : LV_CHIP.none, cls: le === 'warn' ? 'is-warn' : le === 'ok' ? 'is-ok' : 'is-nodata', lv: le };
      }
      r.k = sortKeys(k, x, meta, now, r);
      out.push(r);
    });
    return out;
  }
  // ---- 並び替え：行ごとの並べ替えの値（日時は ms・無い物は null＝いつも最後） ----
  function msOf(v) { var q = parseDt(v); return q ? q.d.getTime() : null; }
  var LV_RANK = { over: 0, warn: 1, ok: 2 };
  function sortKeys(k, x, meta, now, r) {
    var rank = r.lv == null ? 3 : LV_RANK[r.lv];
    if (k === 'trade') return { no: String(g(x, 'tradeNo') || ''), upd: msOf(g(x, 'updatedAt')), rank: rank };
    if (k.indexOf('vessel:') === 0) { var at = atPort(x, meta.port, meta.dir); return { name: vesselTitle(x), eta: msOf(g(at, 'actualTimeOfArrival')) != null ? msOf(g(at, 'actualTimeOfArrival')) : msOf(g(at, 'estimatedTimeOfArrival')), etd: msOf(g(at, 'actualTimeOfDeparture')) != null ? msOf(g(at, 'actualTimeOfDeparture')) : msOf(g(at, 'estimatedTimeOfDeparture')), cyc: msOf(g(x, 'cargoTransfer.cyCutAt')), cfs: msOf(g(x, 'cargoTransfer.cfsCutAt')), rank: rank }; }
    if (k === 'ctn:import') return { no: String(g(x, 'container.containerNo') || ''), pick: msOf(g(x, 'loadedContainerPickup.dueAt')), ret: msOf(g(x, 'emptyContainerReturn.dueAt')), rank: rank };
    return { no: String(g(x, 'container.containerNo') || ''), ship: msOf(g(x, 'shipmentDate')), gin: msOf(g(x, 'gateInDate')), rank: rank };
  }
  // 並べ替えの選択肢：[値, 表示, 並べ替えのキー, 昇順(1)／降順(-1)]。先頭の 'default' は取得した順（本船は入港予定の早い順）
  function sortOptions(k) {
    if (k === 'trade') return [['default', '取得した順'], ['upd-desc', '更新日時が新しい順', 'upd', -1], ['upd-asc', '更新日時が古い順', 'upd', 1], ['no-asc', '取引番号順', 'no', 1]];
    if (k.indexOf('vessel:') === 0) return [['default', '入港予定の早い順'], ['eta-desc', '入港予定の遅い順', 'eta', -1], ['cyc-asc', 'CYカットが近い順', 'cyc', 1], ['cfs-asc', 'CFSカットが近い順', 'cfs', 1], ['etd-asc', '出港予定の早い順', 'etd', 1], ['name-asc', '本船名順', 'name', 1], ['rank-asc', '要注意が先', 'rank', 1]];
    if (k === 'ctn:import') return [['default', '取得した順'], ['rank-asc', '要注意が先', 'rank', 1], ['pick-asc', '搬出期限が近い順', 'pick', 1], ['ret-asc', '返却期限が近い順', 'ret', 1], ['no-asc', 'コンテナ番号順', 'no', 1]];
    return [['default', '取得した順'], ['rank-asc', '要注意が先', 'rank', 1], ['ship-asc', '船積日が早い順', 'ship', 1], ['gin-asc', 'ゲートインが新しい順', 'gin', -1], ['no-asc', 'コンテナ番号順', 'no', 1]];
  }
  function sortRows(k, rows, sortVal) {
    var opt = sortOptions(k).filter(function (o) { return o[0] === sortVal; })[0];
    if (!opt || !opt[2]) return rows;
    var key = opt[2], dir = opt[3];
    return rows.slice().sort(function (a, b) {
      var x = a.k[key], y = b.k[key];
      if (x == null && y == null) return a.i - b.i;
      if (x == null) return 1;           // 値の無いものはいつも最後
      if (y == null) return -1;
      var c = typeof x === 'string' ? x.localeCompare(y, 'ja') : x - y;
      return (c * dir) || (a.i - b.i);
    });
  }
  function caution(k, now) { // タブの札：期限が危ないコンテナ
    var s = ST.store[k]; if (!s || !Array.isArray(s.items)) return 0;
    return rowsFor(k, now).filter(function (r) { return r.lv === 'over' || r.lv === 'warn'; }).length;
  }

  // ---- 詳細（右）：見出し・流れ・すべての項目 ----
  function detailFor(k, x, now) {
    var meta = (ST.store[k] || {}).meta || {}, names = meta.names || {};
    var colsDl = function (cols, nd) {
      return cols.map(function (c) {
        var v = c[1](x || {}); var cls = c[2] ? c[2](x || {}) : '';
        return { k: c[0], v: has(v) && v !== '' ? String(v) : '', cls: cls, nd: nd };
      });
    };
    if (k === 'trade') {
      var keys = ['tradeNo', 'tradeType', 'tradeStatus', 'tradeName', 'blNo', 'updatedAt'], lbl = { tradeNo: '取引番号', tradeType: '種別', tradeStatus: '状態', tradeName: '取引名', blNo: 'B/L', updatedAt: '更新日時' };
      var dl = keys.map(function (q) { var v = x[q]; return { k: lbl[q], v: has(v) ? (q === 'updatedAt' ? fmtDt(v) : String(v)) : '', cls: '', nd: NODATA_T_S }; });
      return { title: x.tradeNo || '（番号なし）', sub: x.tradeName || '', chips: [x.tradeType, x.tradeStatus].filter(Boolean), flowTitle: '', steps: null, dl: dl, kind: 'trade' };
    }
    if (k.indexOf('vessel:') === 0) {
      var dir = meta.dir, port = meta.port, at = atPort(x, port, dir), term = termCell(names)(x);
      var vSteps = stepsVessel(x, port, dir, now);
      // 流れの全部が「情報なし」のときは、船会社の本船スケジュールへ案内する
      var vGuide = vSteps.every(function (p) { return p.st === 'nodata'; }) && window.CpCarrierGuide ? window.CpCarrierGuide.vesselHtml({ name: g(x, 'vessel.vesselName') }) : '';
      return { title: vesselTitle(x), sub: (dir === 'export' ? '輸出' : '輸入') + '　' + port + (term ? '　／　' + term : ''), chips: [], flowTitle: '本船の流れ', steps: vSteps, dl: colsDl(vesselCols(dir, port, names), NODATA_C_S), kind: 'vessel', extra: vGuide };
    }
    var dirc = k === 'ctn:export' ? 'export' : 'import';
    var size = [g(x, 'container.lengthName'), g(x, 'container.containerTypeName')].filter(Boolean).join(' ');
    var chips = [size, g(x, 'containerStatus.fullOrEmpty'), dirc === 'export' ? '輸出' : ''].filter(Boolean);
    var subBits = [[g(x, 'vessel.vesselName'), g(x, 'vessel.voyageNo')].filter(Boolean).join(' / '), dirc === 'import' ? (g(x, 'billOfLadingDetail.blNo') ? 'B/L ' + g(x, 'billOfLadingDetail.blNo') : '') : '', termCell(names)(x)].filter(Boolean);
    var cSteps = dirc === 'export' ? stepsExportContainer(x, now) : stepsImportContainer(x, now);
    // 流れの全部が「情報なし」（COLINS に載っていない）ときは、船会社のトラッキングへ案内する
    var cGuide = cSteps.every(function (p) { return p.st === 'nodata'; }) ? guideHtml([g(x, 'billOfLadingDetail.blNo'), g(x, 'container.containerNo')]) : '';
    return { title: g(x, 'container.containerNo') || '（番号なし）', sub: subBits.join('　／　'), chips: chips, flowTitle: dirc === 'export' ? '輸出の流れ' : 'いまの流れ', steps: cSteps, dl: colsDl(containerCols(dirc, names), NODATA_C_S), kind: 'ctn', extra: cGuide };
  }

  // ---- 描画 ----
  function dotHtml(lv) { return '<span class="cpt-dot is-' + (lv || 'none') + '" aria-hidden="true"></span>'; }
  // 船会社のトラッキングへの案内（js/cp-carrier-guide.js）。読み込まれていなければ何も出さない
  function guideHtml(nums) { return window.CpCarrierGuide ? window.CpCarrierGuide.html({ numbers: nums }) : ''; }
  function msgHtml(m) {
    if (!m) return '';
    var detail = m.detail ? '<div class="cpt-msg-d">詳細（サポート向け）：' + esc(m.detail) + '</div>' : '';
    return '<div class="cpt-msg is-' + esc(m.kind) + '" role="' + (m.kind === 'error' || m.kind === 'invalid' ? 'alert' : 'status') + '"><b>' + esc(m.title || '') + '</b>' +
      (m.body ? '<div class="cpt-msg-b">' + esc(m.body) + '</div>' : '') + detail + '</div>' + (m.html || '');   // m.html：自分で組み立てた安全な HTML（船会社のトラッキングへの案内）
  }
  function setMsg(m, k) { var s = k ? (ST.store[k] || (ST.store[k] = { items: null, sel: 0, filter: 'all', msg: null, meta: {} })) : slot(); s.msg = m; }

  function paint() {
    var r = root(); if (!r) return;
    var now = nowMs(), k = keyOf(), s = slot(), isCtn = ST.tab === 'ctn', isVessel = ST.tab === 'vessel', isTrade = ST.tab === 'trade';
    // 接続の札・メッセージ
    var conn = $id('cptConn'); if (conn) { conn.className = 'cpt-chip' + (ST.conn === 'ok' ? ' is-ok' : ''); conn.textContent = ST.conn === 'ok' ? '● 接続できています' : '接続は未確認'; }
    r.setAttribute('data-tab', ST.tab);
    [].forEach.call(r.querySelectorAll('.cpt-tab'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === ST.tab ? 'true' : 'false'); });
    var nb = caution('ctn:import', now) + caution('ctn:export', now), bd = $id('cptBadge'); if (bd) { bd.hidden = !nb; bd.textContent = '要注意 ' + nb; }
    [].forEach.call(r.querySelectorAll('[data-for]'), function (e) { e.hidden = e.getAttribute('data-for').split(' ').indexOf(ST.tab) < 0; });
    [].forEach.call(r.querySelectorAll('.cpt-seg [data-dir]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dir') === ST.dir ? 'true' : 'false'); });
    var dirSel = $id('cptDir'); if (dirSel) dirSel.value = ST.dir;
    var vhint = $id('cptDirHintV'); if (vhint) vhint.hidden = !isVessel;
    // メッセージ（入力の誤り・0件・エラーは本体の代わりに出す。進行中・成功は本体の上に出す）
    var live = $id('cptLive'), m = s.msg;
    live.innerHTML = msgHtml(m);
    live.hidden = !m;
    var replace = m && (m.kind === 'error' || m.kind === 'invalid' || m.kind === 'empty');
    var main = $id('cptMain'); main.hidden = !!replace;
    if (replace) { paintDev(); return; }
    var has0 = Array.isArray(s.items), rows = sortRows(k, rowsFor(k, now), s.sort || 'default');
    var sb = $id('cptSortBar');
    if (sb) {
      var opts = sortOptions(k), showS = has0 && s.items.length > 1;
      sb.hidden = !showS;
      if (showS) { var cur0 = s.sort || 'default'; sb.innerHTML = '<label for="cptSort">並び順</label><select id="cptSort" class="cpt-select is-s">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cur0 ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; }
    }
    // 絞り込み（コンテナ）
    var fbar = $id('cptFilter');
    var showF = isCtn && has0 && rows.length;
    fbar.hidden = !showF;
    if (showF) {
      var nOver = rows.filter(function (q) { return q.lv === 'over'; }).length, nWarn = rows.filter(function (q) { return q.lv === 'warn'; }).length;
      var exp = ST.dir === 'export';
      fbar.innerHTML = '<button type="button" class="cpt-gb" data-f="all" aria-pressed="' + (s.filter === 'all') + '">すべて</button>' +
        (exp ? '<button type="button" class="cpt-gb" data-f="warn" aria-pressed="' + (s.filter === 'warn') + '"><i class="cpt-sw is-warn"></i>要確認 ' + nWarn + '</button>'
             : '<button type="button" class="cpt-gb" data-f="over" aria-pressed="' + (s.filter === 'over') + '"><i class="cpt-sw is-over"></i>超過 ' + nOver + '</button>' +
               '<button type="button" class="cpt-gb" data-f="warn" aria-pressed="' + (s.filter === 'warn') + '"><i class="cpt-sw is-warn"></i>48時間以内 ' + nWarn + '</button>') +
        '<div class="cpt-legend">' + (exp ? '黄＝止まっている、または予定を過ぎている（船積可否×・搬出／搬入の予定超過）' : '緑＝順調／黄＝48時間以内／赤＝超過（搬出期限・返却期限）／灰＝' + NODATA_C_S) + '</div>';
    } else fbar.innerHTML = '';
    var note = $id('cptNote'); if (note) { var nt = has0 && s.meta && s.meta.note ? s.meta.note : ''; note.hidden = !nt; note.textContent = nt; }
    var shown = rows.filter(function (q) { return !isCtn || s.filter === 'all' || q.lv === s.filter; });
    var list = $id('cptList');
    if (!has0) list.innerHTML = '<div class="cpt-empty">上の欄に入力して、検索してください。</div>';
    else if (!shown.length) list.innerHTML = '<div class="cpt-empty">この条件に当てはまるものはありません。</div>';
    else list.innerHTML = shown.slice(0, 50).map(function (q) {
      return '<button type="button" class="cpt-row" data-i="' + q.i + '" aria-pressed="' + (q.i === s.sel) + '">' + dotHtml(q.dot) +
        '<span class="cpt-row-m"><b>' + esc(q.title) + '</b><span class="cpt-row-s' + (/情報なし/.test(q.sub) ? ' is-nodata' : '') + '">' + esc(q.sub) + '</span></span>' +
        (q.chip ? '<span class="cpt-chip ' + q.cls + '">' + esc(q.chip) + '</span>' : '') + '<span class="cpt-row-go" aria-hidden="true">›</span></button>';
    }).join('') + (shown.length > 50 ? '<div class="cpt-empty">先頭50件を表示しています（全 ' + shown.length + ' 件）。</div>' : '');
    // 詳細
    var det = $id('cptDetail');
    var cur = has0 && s.items[s.sel] ? s.items[s.sel] : (shown.length ? s.items[shown[0].i] : null);
    if (cur && shown.length && !shown.some(function (q) { return q.i === s.sel; })) { s.sel = shown[0].i; cur = s.items[s.sel]; }
    if (!has0 || !cur) { det.innerHTML = '<div class="cpt-empty">左で 1 件選ぶと、ここに流れと項目が出ます。</div>'; }
    else {
      var d = detailFor(k, cur, now);
      var flow = d.steps ? '<div class="cpt-flow-h">' + esc(d.flowTitle) + '</div><ol class="cpt-flow">' + d.steps.map(function (p) {
        var dot = p.st === 'nodata' ? 'none' : p.st === 'todo' ? (p.now ? 'now' : 'todo') : p.st;
        return '<li class="cpt-step"><span class="cpt-rail"><span class="cpt-node is-' + dot + '"></span><span class="cpt-line"></span></span><span class="cpt-step-b"><b>' + esc(p.t) + '</b> <span class="cpt-chip is-s ' + p.cls + '">' + esc(p.badge) + '</span>' +
          '<div class="cpt-step-v' + (p.st === 'nodata' ? ' is-nodata' : '') + '">' + esc(p.v) + '</div></span></li>';
      }).join('') + '</ol>' : '';
      var future = d.kind === 'trade' ? '<div class="cpt-future"><b>今後ここに入る予定</b><br>この取引に結び付いた案件・本船・コンテナの動静、取引内チャットの読み取り（いまは表示しません）。</div>' : '';
      var dl = ST.allOpen ? '<dl class="cpt-dl">' + d.dl.map(function (q) {
        return '<div><dt>' + esc(q.k) + '</dt><dd' + (q.cls ? ' class="' + q.cls + '"' : '') + (q.v === '' ? ' class="is-nodata"' : '') + '>' + (q.v === '' ? esc(q.nd) : esc(q.v)) + '</dd></div>';
      }).join('') + '</dl>' : '';
      det.innerHTML = '<button type="button" class="cpt-btn is-s cpt-back" data-act="back">← 一覧へ戻る</button>' +
        '<div class="cpt-dh"><div class="cpt-dt"><b>' + esc(d.title) + '</b>' + d.chips.map(function (c) { return '<span class="cpt-chip">' + esc(c) + '</span>'; }).join('') + '</div><div class="cpt-ds">' + esc(d.sub) + '</div></div>' +
        flow + (d.extra || '') + future +
        '<button type="button" class="cpt-btn is-g is-s" data-act="all" aria-expanded="' + ST.allOpen + '">' + (ST.allOpen ? '閉じる' : 'すべての項目を見る') + '</button>' + dl;
    }
    $id('cptSplit').setAttribute('data-mv', ST.mv);
    paintDev();
  }

  // ---- 開発者向け情報（普段は閉じておく）：接続の詳細・返ってきたデータそのもの・応答コードなど ----
  function statusRows() {
    return [
      ['cptStApi', 'サイバーポートAPI', ST.conn === 'ok' ? (ST.connHost ? '接続先を確認（' + ST.connHost + '）' : '接続できています（データを取得できました）') : '未確認（右上の「接続を確認」で確認）', ST.conn === 'ok' ? 'is-ok' : 'is-off'],
      ['cptStFn', '中継役（Supabase Edge Function）', ST.conn === 'ok' ? '動いています' : '未確認', ST.conn === 'ok' ? 'is-ok' : 'is-off'],
      ['cptStAuth', '認証（システム用＋橋渡しユーザーの2つのトークン）', ST.conn === 'ok' ? '2つのトークンを取得できました' : '未確認', ST.conn === 'ok' ? 'is-ok' : 'is-off'],
      ['', '書き込み（送信・返信・編集・削除）', '使いません（読み取り専用）', 'is-ok']
    ].map(function (q) {
      return '<li class="cpt-st ' + q[3] + '"' + (q[0] ? ' id="' + q[0] + '"' : '') + '><span class="cpt-st-k">' + esc(q[1]) + '</span><span class="cpt-st-v">' + esc(q[2]) + '</span></li>';
    }).join('');
  }
  function setLinkStatus(ok, apiHost) { ST.conn = ok ? 'ok' : 'none'; ST.connHost = ok ? (apiHost || '') : ''; paint(); }
  function paintDev() {
    var box = $id('cptDev'); if (!box) return;
    $id('cptDevBtn').setAttribute('aria-expanded', ST.devOpen ? 'true' : 'false');
    $id('cptDevBtn').firstChild.textContent = (ST.devOpen ? '▾ ' : '▸ ');
    box.hidden = !ST.devOpen;
    if (!ST.devOpen) return;
    box.innerHTML = '<ul class="cpt-stlist">' + statusRows() + '</ul>' +
      (ST.devErr ? '<div class="cpt-dev-x">' + esc(ST.devErr) + '</div>' : '') +
      '<details class="cpt-raw"' + (ST.devRaw ? '' : ' hidden') + '><summary>返ってきたデータそのもの（確認用）</summary><pre>' + esc(ST.devRaw) + '</pre></details>';
  }

  // ---- 通信 ----
  function errInfo(e) {
    var extra = [];
    if (e && e.upstreamStatus) extra.push('応答コード ' + e.upstreamStatus);
    if (e && e.code) extra.push('種類 ' + e.code);
    var d = (e && e.detail) ? String(e.detail) : '';
    return { detail: extra.join('／') + (d ? '／' + d : ''), message: (e && e.message) || '失敗しました' };
  }
  function failMsg(e) {
    var i = errInfo(e);
    ST.devErr = i.detail ? '直近のエラー：' + i.detail : '';
    return { kind: 'error', title: i.message, body: '少し待ってからもう一度お試しください。続く場合は、下の「開発者向け情報」にある詳細をサポートに伝えてください。', detail: i.detail };
  }
  function needApi() {
    if (window.CyberPort) return true;
    setMsg({ kind: 'error', title: 'cyberport.js が読み込まれていません', body: '', detail: '' }); paint();
    return false;
  }
  function busy(on) { ST.busy = !!on; ['cptPing', 'cptSearch', 'cptColinsV', 'cptColinsC'].forEach(function (id) { var b = $id(id); if (b) b.disabled = !!on; }); }
  function inVal(id) { var e = $id(id); return e ? e.value : ''; }
  function rawKeep(data) { try { ST.devRaw = JSON.stringify(data, null, 2).slice(0, 8000); } catch (e) { ST.devRaw = ''; } }

  async function livePing() {
    if (!needApi()) return;
    busy(true); setMsg({ kind: 'info', title: 'サイバーポートに接続情報でトークンを取りに行っています…' }); paint();
    try {
      var r = await window.CyberPort.ping();
      ST.devErr = ''; ST.conn = 'ok'; ST.connHost = r.apiHost || ''; _portsTriedAt = 0; if (ST.tab === 'vessel') prefetchPorts();   // 接続できたので、本船タブを見ているなら港の一覧を取り直す（ほかのタブなら、本船タブを開いたときに取る）
      setMsg({ kind: 'ok', title: r.message || '接続情報でトークンを取得できました。', body: '' + (r.tokenHost ? 'トークン取得先：' + r.tokenHost + ' ／ API 接続先：' + (r.apiHost || '') : '') });
    } catch (e) { ST.conn = 'none'; ST.connHost = ''; setMsg(failMsg(e)); }
    busy(false); paint();
  }
  async function runSearch(k, label, kind, call, meta) {
    var s = ST.store[k] || (ST.store[k] = { items: null, sel: 0, filter: 'all', msg: null, meta: {} });
    busy(true); s.msg = { kind: 'info', title: label + 'を取得しています…' }; paint();
    try {
      var r = await call();
      rawKeep(r.data); ST.devErr = ''; ST.conn = 'ok'; ST.connHost = ST.connHost || '';
      var list = Array.isArray(r.data) ? r.data : (r.data && Array.isArray(r.data.items) ? r.data.items : null);
      if (!list) { s.items = null; s.msg = { kind: 'error', title: '想定と違う形のデータが返りました', body: '下の「開発者向け情報」で、返ってきたデータそのものを確認できます。', detail: '' }; }
      else if (!list.length) { s.items = []; s.meta = typeof meta.meta === 'function' ? meta.meta() : (meta.meta || {}); var eb = typeof meta.emptyBody === 'function' ? meta.emptyBody() : meta.emptyBody; s.msg = { kind: 'empty', title: '該当するものはありません（0件）', body: eb || '番号を確かめるか、空欄にして直近30日の更新を見てください。', html: typeof meta.emptyHtml === 'function' ? meta.emptyHtml() : '' }; }
      else { s.items = list; s.sel = 0; s.filter = 'all'; s.meta = typeof meta.meta === 'function' ? meta.meta() : (meta.meta || {}); s.msg = null; ST.mv = 'list'; ST.allOpen = false; }
    } catch (e) { s.msg = failMsg(e); }
    busy(false); paint();
  }

  // 取引の検索（Trades/Search）。番号があれば keyword、空なら「直近 30 日に更新された取引」。
  function liveSearch() {
    if (!needApi()) return;
    var kw = window.CyberPort.normalizeNo(inVal('cptKw'));
    var q = kw ? { keyword: kw } : { updatedAtRange: 30, updatedAtRangeUnit: 'D' };
    return runSearch('trade', '取引（' + (kw ? '番号：' + kw : '直近30日に更新された取引') + '）', 'trade', function () { return window.CyberPort.tradesSearch(q); },
      { emptyBody: (kw ? '番号『' + kw + '』は見つかりませんでした。番号を確かめるか、空欄にして直近30日の更新を見てください。' : '直近30日に更新された取引はありません。') });
  }
  // 本船の動静は、照会した日を中心に前後 2 週間だけを見る（本船・荷役・搬入・カット・入出港のどれかの日時が範囲に入るもの）。
  // 日時がひとつも無い本船は、範囲を判断できないので残す。
  var VESSEL_WINDOW_DAYS = 14;
  function vesselDates(x, port, dir) {
    var at = atPort(x, port, dir);
    return [g(at, 'estimatedTimeOfArrival'), g(at, 'actualTimeOfArrival'), g(at, 'estimatedTimeOfDeparture'), g(at, 'actualTimeOfDeparture'),
      g(x, 'cargoHandling.scheduleAt'), g(x, 'cargoHandling.actualAt'), g(x, 'cargoIn.scheduleAt'), g(x, 'cargoIn.cargoInDate'), g(x, 'cargoIn.actualAt'),
      g(x, 'cargoTransfer.cyOpenAt'), g(x, 'cargoTransfer.cfsCutAt'), g(x, 'cargoTransfer.cyCutAt')]
      .map(function (v) { var q = parseDt(v); return q ? q.d.getTime() : null; }).filter(function (t) { return t != null; });
  }
  function inVesselWindow(x, port, dir, now) {
    var ts = vesselDates(x, port, dir); if (!ts.length) return true;
    var span = VESSEL_WINDOW_DAYS * 86400000, lo = now - span, hi = now + span;
    return ts.some(function (t) { return t >= lo && t <= hi; });
  }
  function windowLabel(now) {
    var f = function (t) { return fmtDt(new Date(t).toISOString()).slice(0, 10); };
    return f(now - VESSEL_WINDOW_DAYS * 86400000) + ' 〜 ' + f(now + VESSEL_WINDOW_DAYS * 86400000);
  }

  async function liveColinsVessels() {
    if (!needApi()) return;
    var dir = ST.dir, port = window.CyberPort.normalizeNo(inVal('cptPort'));
    var k = 'vessel:' + dir;
    if (!/^[A-Z]{2}[A-Z0-9]{3}$/.test(port)) {
      setMsg({ kind: 'invalid', title: '港コードを確かめてください', body: '港コードは、英字2文字＋英数字3文字の5桁で入力してください（例：JPTYO＝東京、JPYOK＝横浜）。' }, k); paint(); return;
    }
    var vn = inVal('cptVessel').trim(), q = vn ? { vesselName: vn } : {};
    var names = {};
    busy(true);
    try { names = await ensureTerminalNames(); } catch (e) { names = {}; }
    busy(false);
    var now0 = nowMs(), outside = 0, total = 0;
    var sortList = function (list) {
      if (!Array.isArray(list)) return list;
      total = list.length;
      var inside = list.filter(function (x) { return inVesselWindow(x, port, dir, now0); });
      outside = total - inside.length;
      return sortVessels(inside, port, dir);
    };
    return runSearch(k, 'COLINS の本船の動静（' + (dir === 'export' ? '輸出' : '輸入') + '・' + port + (vn ? '・' + vn : '') + '）', 'vessel',
      async function () { var r = await window.CyberPort.colinsVessels(dir, port, q); r = Object.assign({}, r, { data: sortList(r.data) }); return r; },
      { emptyHtml: function () { return window.CpCarrierGuide ? window.CpCarrierGuide.vesselHtml({ name: vn }) : ''; },
        emptyBody: function () { return total && !outside ? '' : (total ? port + ' の本船は ' + total + ' 件ありますが、照会の日（' + windowLabel(now0) + '）の前後 ' + VESSEL_WINDOW_DAYS / 7 + ' 週間の範囲に入るものはありません。' : port + ' の本船の動静は見つかりませんでした（COLINS に情報がありません）。'); },
        meta: function () { return { dir: dir, port: port, names: names, note: '照会の日の前後 ' + VESSEL_WINDOW_DAYS / 7 + ' 週間（' + windowLabel(now0) + '）の動静を表示' + (outside ? '。範囲外の ' + outside + ' 件は除きました' : '') }; } });
  }
  async function liveColinsContainers() {
    if (!needApi()) return;
    var dir = ST.dir, no = window.CyberPort.normalizeNo(inVal('cptCtn')), k = 'ctn:' + dir;
    if (!no) {
      setMsg({ kind: 'invalid', title: '番号を入力してください', body: 'コンテナ番号か、' + (dir === 'export' ? 'ブッキング番号' : 'B/L番号') + 'を入力してください。' }, k); paint(); return;
    }
    var names = {};
    busy(true);
    try { names = await ensureTerminalNames(); } catch (e) { names = {}; }
    busy(false);
    return runSearch(k, 'COLINS のコンテナの状況（' + (dir === 'export' ? '輸出' : '輸入') + '・' + no + '）', 'ctn', function () { return window.CyberPort.colinsContainers(dir, no, {}); },
      { emptyBody: '「' + no + '」のコンテナは見つかりませんでした（COLINS に情報がありません）。', emptyHtml: function () { return guideHtml([no]); }, meta: { dir: dir, names: names } });
  }

  function render() {
    var r = root(); if (!r) return;
    r.innerHTML =
      '<div class="cpt-head"><h2 class="cpt-title">🚢 サイバーポート</h2><span class="cpt-chip">読み取りのみ</span>' +
      '<span class="cpt-head-r"><span id="cptConn" class="cpt-chip">接続は未確認</span><button type="button" class="cpt-btn is-s" id="cptPing">接続を確認</button></span></div>' +
      '<div class="cpt-card cpt-shell">' +
      '<div class="cpt-tabs" role="tablist" aria-label="照会の種類">' +
      '<button type="button" role="tab" class="cpt-tab" data-tab="trade" aria-selected="false">取引</button>' +
      '<button type="button" role="tab" class="cpt-tab" data-tab="vessel" aria-selected="false">本船の動静</button>' +
      '<button type="button" role="tab" class="cpt-tab" data-tab="ctn" aria-selected="true">コンテナの状況<span class="cpt-chip is-over is-s" id="cptBadge" hidden></span></button></div>' +
      '<div class="cpt-search">' +
      '<select id="cptDir" class="cpt-select" aria-label="輸入・輸出" hidden><option value="import">輸入</option><option value="export">輸出</option></select>' +
      '<input type="text" id="cptKw" class="cpt-input" data-for="trade" maxlength="45" autocomplete="off" placeholder="取引番号・B/L・ブッキング・社内管理番号（空なら直近30日の更新）" aria-label="取引の検索">' +
      '<button type="button" class="cpt-btn is-primary" id="cptSearch" data-for="trade">取引を検索</button>' +
      '<div class="cpt-seg" data-for="vessel ctn" role="group" aria-label="輸入か輸出か"><button type="button" data-dir="import" aria-pressed="true">輸入</button><button type="button" data-dir="export" aria-pressed="false">輸出</button></div>' +
      '<select id="cptPortSel" class="cpt-select cpt-port-sel" data-for="vessel" aria-label="港を選ぶ"></select>' +
      '<input type="text" id="cptPort" class="cpt-input cpt-input-s is-off" data-for="vessel" maxlength="12" value="JPTYO" autocomplete="off" placeholder="港コード（例 JPTYO）" aria-label="港コード（UN/LOCODE 5桁）">' +
      '<input type="text" id="cptVessel" class="cpt-input cpt-input-m" data-for="vessel" maxlength="60" autocomplete="off" placeholder="本船名（任意）" aria-label="本船名">' +
      '<button type="button" class="cpt-btn is-primary" id="cptColinsV" data-for="vessel">本船の動静を調べる</button>' +
      '<input type="text" id="cptCtn" class="cpt-input" data-for="ctn" maxlength="40" autocomplete="off" placeholder="コンテナ番号／B/L番号（輸入）／ブッキング番号（輸出）" aria-label="コンテナの検索">' +
      '<button type="button" class="cpt-btn is-primary" id="cptColinsC" data-for="ctn">コンテナの状況を調べる</button>' +
      '<div class="cpt-hint" id="cptDirHintV" data-for="vessel">港は一覧から選びます（一覧に無い港は「その他」を選んで、UN/LOCODE の5桁コードを入力します。例：JPTYO＝東京）。「輸入／輸出」はコンテナの照会と共通です。動静は、照会した日の前後2週間のものを表示します。</div></div>' +
      '<div id="cptLive" class="cpt-live" aria-live="polite" hidden></div>' +
      '<div id="cptMain" class="cpt-main"><div class="cpt-split" id="cptSplit" data-mv="list"><div class="cpt-listpane"><div id="cptSortBar" class="cpt-sortbar" hidden></div><div id="cptNote" class="cpt-note" hidden></div><div id="cptFilter" class="cpt-filter"></div><div id="cptList"></div></div><div class="cpt-detailpane" id="cptDetail"></div></div></div></div>' +
      '<div id="cptNotify"></div>' +
      '<div class="cpt-devwrap"><button type="button" class="cpt-btn is-g is-s" id="cptDevBtn" aria-expanded="false">▸ 開発者向け情報（普段は閉じておきます）</button><div id="cptDev" class="cpt-card cpt-dev" hidden></div></div>';

    if (window.CpNotify) window.CpNotify.mount($id('cptNotify'));
    $id('cptPing').addEventListener('click', livePing);
    $id('cptSearch').addEventListener('click', liveSearch);
    $id('cptColinsV').addEventListener('click', liveColinsVessels);
    $id('cptColinsC').addEventListener('click', liveColinsContainers);
    $id('cptKw').addEventListener('keydown', function (e) { if (e.key === 'Enter') liveSearch(); });
    $id('cptPort').addEventListener('keydown', function (e) { if (e.key === 'Enter') liveColinsVessels(); });
    $id('cptPortSel').addEventListener('change', onPortSelect);
    renderPortSelect();
    $id('cptVessel').addEventListener('keydown', function (e) { if (e.key === 'Enter') liveColinsVessels(); });
    $id('cptCtn').addEventListener('keydown', function (e) { if (e.key === 'Enter') liveColinsContainers(); });
    $id('cptDir').addEventListener('change', function () { ST.dir = this.value === 'export' ? 'export' : 'import'; ST.mv = 'list'; paint(); });
    $id('cptDevBtn').addEventListener('click', function () { ST.devOpen = !ST.devOpen; paintDev(); });
    r.addEventListener('change', function (e) { if (e.target && e.target.id === 'cptSort') { slot().sort = e.target.value; paint(); } });
    r.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : null; if (!t) return;
      if (window.CpCarrierGuide) window.CpCarrierGuide.onClick(e);
      var tab = t.closest('.cpt-tab'); if (tab) { ST.tab = tab.getAttribute('data-tab'); ST.mv = 'list'; ST.allOpen = false; paint(); if (ST.tab === 'vessel') prefetchPorts(); return; }
      var sg = t.closest('.cpt-seg [data-dir]'); if (sg) { ST.dir = sg.getAttribute('data-dir'); ST.mv = 'list'; ST.allOpen = false; paint(); return; }
      var gb = t.closest('.cpt-gb'); if (gb) { var s = slot(); var f = gb.getAttribute('data-f'); s.filter = (f !== 'all' && s.filter === f) ? 'all' : f; paint(); return; }
      var row = t.closest('.cpt-row'); if (row) { slot().sel = +row.getAttribute('data-i'); ST.mv = 'detail'; ST.allOpen = false; paint(); return; }
      var act = t.closest('[data-act]'); if (act) { var a = act.getAttribute('data-act'); if (a === 'back') { ST.mv = 'list'; paint(); } else if (a === 'all') { ST.allOpen = !ST.allOpen; paint(); } }
    });
    paint();
  }

  var _inited = false;
  window.initCpTestTab = function () {
    if (_inited) return;
    _inited = true;
    render();
  };
  window.CpTest = {
    inVesselWindow: inVesselWindow, sortOptions: sortOptions,
    normalizeNo: normalizeNo, fmtDt: fmtDt, dueClass: dueClass, resetTerminalNames: function () { _termNames = null; _termList = null; _ports = null; _portsTriedAt = 0; _portOther = false; renderPortSelect(); },
    portsFromTerminals: portsFromTerminals,
    levelOf: levelOf, remainText: remainText, slipped: slipped,
    stepsImportContainer: stepsImportContainer, stepsExportContainer: stepsExportContainer, stepsVessel: stepsVessel
  };
})();
