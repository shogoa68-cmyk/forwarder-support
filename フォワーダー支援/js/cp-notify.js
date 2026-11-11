/* cp-notify.js — 🚢 サイバーポート画面の「📨 受信した通知（Webhook）」と「通知できる操作の一覧」。
 * 通知は Edge Function cp-webhook が表 cp_events に保存したものを、CpEvents（integrations/cp-events.js）で読むだけ。
 * 画面（js/cp-test.js）は、差し込み口 #cptNotify に CpNotify.mount() を呼ぶだけ。手順は docs/サイバーポート連携-Webhook.md。
 * 表示専用：サイバーポートへの書き込みはしない。 */
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $id(i) { return document.getElementById(i); }
  function fmtDt(v) {
    if (!v) return '';
    var d = new Date(v); if (isNaN(d.getTime())) return String(v);
    var f = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    var m = {}; f.forEach(function (x) { m[x.type] = x.value; });
    return m.year + '/' + m.month + '/' + m.day + ' ' + m.hour + ':' + m.minute;
  }
  function g(o, path) { var v = o; path.split('.').forEach(function (k) { v = v == null ? v : v[k]; }); return v == null ? '' : String(v); }
  function msg(kind, text) { return '<div class="cpt-msg is-' + kind + '" role="' + (kind === 'error' ? 'alert' : 'status') + '">' + esc(text) + '</div>'; }
  function errHtml(e) { return msg('error', (e && e.message) || '失敗しました'); }

  var KIND_LABEL = { message: '💬 チャット', report: '📄 帳票', naccs: '🛃 NACCS', trade: '📦 取引', task: '☑ タスク', process: '⚙ プロセス', other: 'その他' };
  var _evKind = '', _evRows = [], _evOpen = {}, _evPayload = {}, _evUnsub = null, _evNew = {}, _evRetry = false, _evLast = '';
  var _ops = null, _opsShown = false;

  // ---------- 通知できる操作の一覧 ----------
  function opsHtml(list) {
    var f = (($id('cptOpFilter') || {}).value || '').trim().toLowerCase();
    var rows = list.filter(function (o) { return !f || JSON.stringify(o).toLowerCase().indexOf(f) >= 0; });
    var edi = list.filter(function (o) { return /edifact/i.test(JSON.stringify(o)); }).length;
    var note = '全 ' + list.length + ' 件　EDIFACT に関する操作：' + edi + ' 件' + (f ? '／「' + f + '」に一致：' + rows.length + ' 件' : '');
    var head = '<div class="cpt-hint">' + esc(note) + '</div>';
    if (!rows.length) return head + msg('info', '一致する操作がありません。');
    var body = rows.slice(0, 200).map(function (x) {
      return '<tr><td>' + esc(g(x, 'notifiableOperationCode')) + '</td><td>' + esc(g(x, 'operationType.operationTypeName') || g(x, 'operationType.operationTypeCode')) + '</td><td>' +
        esc(g(x, 'reportType.reportName')) + '</td><td>' + esc(g(x, 'process.processName')) + '</td></tr>';
    }).join('');
    return head + '<div class="cpt-tablewrap"><table class="cpt-table"><thead><tr><th>コード</th><th>操作</th><th>帳票</th><th>プロセス</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      (rows.length > 200 ? '<div class="cpt-hint">先頭200件を表示しています。</div>' : '');
  }
  async function opsLoad() {
    var box = $id('cptOpsBody'); if (!box) return;
    if (!window.CyberPort) { box.innerHTML = msg('error', 'cyberport.js が読み込まれていません'); return; }
    box.innerHTML = msg('info', '通知できる操作の一覧を取得しています…');
    try {
      if (!_ops) {
        var r = await window.CyberPort.notifiableOperations();
        if (!Array.isArray(r.data)) { box.innerHTML = msg('error', '想定外の形式で返ってきました（一覧ではありません）'); return; }
        _ops = r.data;
      }
      _opsShown = true;
      box.innerHTML = opsHtml(_ops);
    } catch (e) { _opsShown = false; box.innerHTML = errHtml(e); }
  }

  // ---------- 受信した通知 ----------
  function evStatus(html) { var el = $id('cptEvStatus'); if (el) el.innerHTML = html || ''; }
  function evLiveDot(status) {
    return status === 'SUBSCRIBED' ? '<span class="cpt-live-dot is-on" title="リアルタイムで受信待機中"></span>受信待機中'
      : status ? '<span class="cpt-live-dot" title="リアルタイム接続が確立できていません（再読み込みで更新できます）"></span>手動更新のみ' : '';
  }
  function evStatusLine(status) { evStatus('<span>' + _evRows.length + ' 件（新しい順）</span> ' + evLiveDot(status)); }
  function evRender() {
    var box = $id('cptEvBody'); if (!box) return;
    if (!_evRows.length) { box.innerHTML = msg('info', '通知はまだありません。サイバーポート側で Webhook を設定し、操作が行われると、ここに増えます（設定の手順は docs/サイバーポート連携-Webhook.md）。'); return; }
    var head = '<tr><th>受信</th><th>種類</th><th>操作</th><th>取引番号</th><th>B/L</th><th>帳票</th><th>コンテナ</th><th>履歴ID</th><th></th></tr>';
    var rows = _evRows.map(function (x) {
      var open = !!_evOpen[x.id];
      var main = '<tr class="' + (_evNew[x.id] ? 'cpt-ev-new' : '') + '"><td>' + esc(fmtDt(x.received_at)) + '</td><td>' + esc(KIND_LABEL[x.kind] || x.kind) + '</td><td>' +
        esc(x.operation_name || x.operation_code || '') + '</td><td>' + esc(x.trade_no || '') + '</td><td>' + esc(x.bl_no || '') + '</td><td>' + esc(x.report_name || x.report_code || '') +
        '</td><td>' + esc(x.container_no || '') + '</td><td class="cpt-mono">' + esc(x.history_id || '') + '</td><td><button type="button" class="cpt-btn is-s cpt-ev-detail-btn" data-id="' + esc(x.id) + '">' + (open ? '閉じる' : '詳細') + '</button></td></tr>';
      if (!open) return main;
      var p = _evPayload[x.id];
      return main + '<tr class="cpt-ev-detail"><td colspan="9">' +
        (p === undefined ? '<div class="cpt-hint">読み込み中…</div>' : '<pre>' + esc(JSON.stringify(p, null, 2).slice(0, 12000)) + '</pre>') +
        (x.history_id ? '<div class="cpt-form"><button type="button" class="cpt-btn is-s cpt-ev-hist-btn" data-id="' + esc(x.id) + '" data-hid="' + esc(x.history_id) + '">この操作の履歴を取得（読み取り）</button></div><div class="cpt-ev-hist" id="cptEvHist' + esc(x.id) + '"></div>' : '') +
        '</td></tr>';
    }).join('');
    box.innerHTML = '<div class="cpt-tablewrap"><table class="cpt-table cpt-ev-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>';
  }
  function evFail(e) {
    var box = $id('cptEvBody'); if (!box) return;
    box.innerHTML = e && e.code === 'notready' ? msg('info', e.message) : errHtml(e);
    evStatus('');
  }
  async function evLoad(first) {
    if (!window.CpEvents) { var b = $id('cptEvBody'); if (b) b.innerHTML = msg('error', 'cp-events.js が読み込まれていません'); return; }
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
    var t = ev.target; if (!t || !t.closest) return;
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
      var out = $id('cptEvHist' + h.getAttribute('data-id')); if (!out) return;
      h.disabled = true; out.innerHTML = msg('info', '操作の履歴を取得しています…');
      try {
        var r = await window.CyberPort.tradeHistory(h.getAttribute('data-hid'));
        out.innerHTML = '<pre>' + esc(JSON.stringify(r.data, null, 2).slice(0, 12000)) + '</pre>';
      } catch (e) { out.innerHTML = errHtml(e); }
      h.disabled = false;
    }
  }

  // ---------- 画面への差し込み ----------
  function mount(box) {
    if (!box) return;
    box.innerHTML =
      '<div class="cpt-card cpt-notify" id="cptEvCard"><div class="cpt-notify-h">📨 受信した通知（Webhook）</div>' +
      '<p class="cpt-hint">サイバーポートから届いた通知（取引・帳票・チャット・NACCS電文の操作）です。新しく届くと自動で先頭に増えます。表示だけで、書き込みはしません。</p>' +
      '<div class="cpt-form"><select id="cptEvKind" class="cpt-select" aria-label="通知の種類で絞り込み">' +
      '<option value="">すべての種類</option><option value="message">💬 チャット</option><option value="report">📄 帳票</option><option value="naccs">🛃 NACCS</option>' +
      '<option value="trade">📦 取引</option><option value="task">☑ タスク</option><option value="process">⚙ プロセス</option><option value="other">その他</option></select>' +
      '<button type="button" class="cpt-btn is-s" id="cptEvReload">再読み込み</button><span class="cpt-ev-status" id="cptEvStatus" aria-live="polite"></span></div>' +
      '<div id="cptEvBody"></div>' +
      '<details class="cpt-notify-ops"><summary>通知してもらえる操作の一覧（Webhook を設定するときの参考）</summary>' +
      '<div class="cpt-form"><input type="text" id="cptOpFilter" class="cpt-input" maxlength="40" autocomplete="off" placeholder="絞り込み（例：EDIFACT・メッセージ・帳票名）" aria-label="通知できる操作の絞り込み">' +
      '<button type="button" class="cpt-btn is-s" id="cptOps">一覧を取得</button></div><div id="cptOpsBody"></div></details></div>';
    $id('cptOps').addEventListener('click', opsLoad);
    $id('cptOpFilter').addEventListener('input', function () { if (_opsShown) $id('cptOpsBody').innerHTML = opsHtml(_ops); });
    $id('cptOpFilter').addEventListener('keydown', function (e) { if (e.key === 'Enter') opsLoad(); });
    $id('cptEvReload').addEventListener('click', function () { evLoad(); });
    $id('cptEvKind').addEventListener('change', function () { _evKind = this.value; evLoad(); });
    $id('cptEvBody').addEventListener('click', evClick);
    _evUnsub = null; _evKind = ''; _evRows = []; _evOpen = {}; _evNew = {}; _evRetry = false; _evLast = '';
    evLoad(true);
  }

  window.CpNotify = { mount: mount };
})();
