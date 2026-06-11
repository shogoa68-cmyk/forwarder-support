// js/quote/right-rail.js
// =====================================================================
// 右カラム再設計「案C：アイコンレール基軸（ポップアウト drawer）」コントローラ
//
// 既存の 3 パネル（#quoteSummaryPanel / #sqPanel / #scPanel）の
// 中身・描画ロジックには一切手を入れず、外側を
//   [細いアイコンレール] ＋ [可変幅ポップアウト drawer]
// で包む“シェル”だけを提供する。
//
// ・既定はレールのみ → 本体テーブルが最大化
// ・アイコン押下で該当モジュールが drawer に展開
// ・📌 ピンで常時表示に固定／解除
// ・左境界ドラッグで幅可変（240–480px）
// ・開いていたモジュール / ピン / 幅 はユーザー単位で localStorage 保存
//
// 読み込み順：index.html の他 quote 系スクリプトの後（ui.js / similar-quotes.js /
// scenario.js より後）に <script src="js/quote/right-rail.js"></script> を追加。
// =====================================================================
(function () {
  'use strict';

  // ---- 保存キー（ユーザー単位） ----------------------------------------
  // 端末ローカルでよければ uid は固定でも可。チームでメンバーごとに分けたい場合は
  // ログインユーザー ID を混ぜる（cloud.js の現在ユーザーを利用）。
  function _uid() {
    try {
      return (window.CloudAuth && CloudAuth.currentUser && CloudAuth.currentUser.id)
          || (window._cloudUser && window._cloudUser.id)
          || 'local';
    } catch (e) { return 'local'; }
  }
  const K = () => 'qrc:' + _uid();
  function _load() {
    try { return JSON.parse(localStorage.getItem(K()) || '{}'); } catch (e) { return {}; }
  }
  function _save(patch) {
    const s = Object.assign(_load(), patch);
    try { localStorage.setItem(K(), JSON.stringify(s)); } catch (e) {}
    return s;
  }

  // ---- モジュール定義 --------------------------------------------------
  // panel: 実在パネルの id。summary は内部タブ（要約/輸送/金額/チャット）を持つ。
  // chat は summary パネルを開いた上で qspSetTab('chat') を呼ぶショートカット。
  const MODS = [
    { id: 'summary',  icon: '📊', label: 'サマリ',  title: '見積サマリ',   panel: 'quoteSummaryPanel' },
    { id: 'chat',     icon: '💬', label: '申し送り', title: '申し送り',     panel: 'quoteSummaryPanel', tab: 'chat' },
    { id: 'similar',  icon: '🔍', label: '類似',    title: '類似見積',     panel: 'sqPanel' },
    { id: 'scenario', icon: '🪜', label: 'シナリオ', title: 'シナリオ比較', panel: 'scPanel' },
  ];

  let state = { active: 'summary', pinned: true, width: 300 };

  // ---- DOM 構築（既存 .quote-right-col を包み替え） ---------------------
  function build() {
    const col = document.querySelector('#tab-quote-make .quote-right-col');
    if (!col || col.dataset.qrcReady) return;

    const saved = _load();
    state.active = ('active' in saved) ? saved.active : 'summary';
    state.pinned = ('pinned' in saved) ? saved.pinned : true;
    state.width  = saved.width || 300;

    // 既存パネルを退避
    const panels = {
      quoteSummaryPanel: document.getElementById('quoteSummaryPanel'),
      sqPanel:           document.getElementById('sqPanel'),
      scPanel:           document.getElementById('scPanel'),
    };

    // シェル骨格
    col.classList.add('quote-right-col--rail');
    col.innerHTML =
      '<div class="qrc-drawer" id="qrcDrawer">' +
        '<div class="qrc-resize" id="qrcResize" title="ドラッグして幅を変更"><span class="qrc-resize-grip"></span></div>' +
        '<div class="qrc-drawer-head">' +
          '<span class="qrc-drawer-title" id="qrcTitle"></span>' +
          '<button class="qrc-pin"  id="qrcPin"  title="常時表示に固定／解除">📌</button>' +
          '<button class="qrc-close" id="qrcClose" title="閉じてレールのみ">×</button>' +
        '</div>' +
        '<div class="qrc-drawer-body" id="qrcBody"></div>' +
      '</div>' +
      '<nav class="qrc-rail" id="qrcRail">' +
        MODS.map(function (m) {
          return '<button class="qrc-rail-btn" data-mod="' + m.id + '" title="' + m.title + '">' +
                   '<span class="qrc-rail-ico">' + m.icon + '</span>' +
                   '<em>' + m.label + '</em>' +
                 '</button>';
        }).join('') +
      '</nav>';

    // 退避したパネルを drawer body へ戻す（各モジュールのペインに）
    const body = col.querySelector('#qrcBody');
    Object.keys(panels).forEach(function (id) {
      if (panels[id]) body.appendChild(panels[id]);
    });

    // イベント
    col.querySelector('#qrcRail').addEventListener('click', function (e) {
      const btn = e.target.closest('.qrc-rail-btn');
      if (!btn) return;
      const mod = btn.dataset.mod;
      setActive(state.active === mod ? null : mod);
    });
    col.querySelector('#qrcClose').addEventListener('click', function () { setActive(null); });
    col.querySelector('#qrcPin').addEventListener('click', function () {
      state.pinned = !state.pinned; _save({ pinned: state.pinned }); render();
    });
    col.querySelector('#qrcResize').addEventListener('pointerdown', startResize);

    col.dataset.qrcReady = '1';
    render();
  }

  // ---- 幅ドラッグ ------------------------------------------------------
  function startResize(e) {
    e.preventDefault();
    const x0 = e.clientX, w0 = state.width;
    function move(ev) {
      const dx = x0 - ev.clientX;               // 左へ動かすと広がる
      state.width = Math.max(240, Math.min(480, w0 + dx));
      const d = document.getElementById('qrcDrawer');
      if (d) d.style.width = state.width + 'px';
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      _save({ width: state.width });
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---- 状態反映 --------------------------------------------------------
  function setActive(mod) {
    state.active = mod;
    _save({ active: mod });
    render();
    // chat ショートカット：summary パネルのチャットタブへ
    const def = MODS.find(function (m) { return m.id === mod; });
    if (def && def.tab && typeof window.qspSetTab === 'function') {
      window.qspSetTab(def.tab);
    }
  }

  function render() {
    const col = document.querySelector('#tab-quote-make .quote-right-col--rail');
    if (!col) return;
    const drawer = col.querySelector('#qrcDrawer');
    const open = !!state.active;

    // drawer 開閉・幅・ピン
    drawer.style.display = open ? 'flex' : 'none';
    drawer.style.width = state.width + 'px';
    drawer.classList.toggle('is-pinned', !!state.pinned);
    col.classList.toggle('qrc-open', open);
    col.querySelector('#qrcPin').classList.toggle('is-on', !!state.pinned);

    // タイトル
    const def = MODS.find(function (m) { return m.id === state.active; });
    col.querySelector('#qrcTitle').textContent = def ? (def.icon + ' ' + def.title) : '';

    // パネル出し分け（active のモジュールの panel だけ表示）
    const showPanel = def ? def.panel : null;
    ['quoteSummaryPanel', 'sqPanel', 'scPanel'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      // sqPanel は内部で hidden 属性を自前制御するため、表示は wrapper 側で行う
      el.style.display = (id === showPanel) ? '' : 'none';
    });

    // レールのアクティブ表示
    col.querySelectorAll('.qrc-rail-btn').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.mod === state.active);
    });

    // バッジ／新着ドット（任意：件数があれば付与）
    _decorateRail(col);
  }

  // レールに件数バッジ・新着ドットを付ける（存在すれば）
  function _decorateRail(col) {
    // 類似見積：sqPanel 内のカード数
    const simBtn = col.querySelector('.qrc-rail-btn[data-mod="similar"]');
    if (simBtn) {
      const n = document.querySelectorAll('#sqPanel .sq-card').length;
      _setBadge(simBtn, n > 0 ? String(n) : '');
    }
    // 申し送り：未読があればドット（ここでは chat リストの有無で簡易表示）
    const chatBtn = col.querySelector('.qrc-rail-btn[data-mod="chat"]');
    if (chatBtn) {
      const has = !!document.querySelector('#qspChatList .cp-chat-item');
      _setDot(chatBtn, has);
    }
  }
  function _setBadge(btn, txt) {
    let b = btn.querySelector('.qrc-rail-badge');
    if (!txt) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'qrc-rail-badge'; btn.appendChild(b); }
    b.textContent = txt;
  }
  function _setDot(btn, on) {
    let d = btn.querySelector('.qrc-rail-dot');
    if (!on) { if (d) d.remove(); return; }
    if (!d) { d = document.createElement('span'); d.className = 'qrc-rail-dot'; btn.appendChild(d); }
  }

  // 外部（類似・チャット更新時）から再装飾できるよう公開
  window.qrcRefresh = function () {
    const col = document.querySelector('#tab-quote-make .quote-right-col--rail');
    if (col) _decorateRail(col);
  };

  // ---- 初期化：見積タブが構築された後に実行 ----------------------------
  function init() {
    if (document.querySelector('#tab-quote-make .quote-right-col')) build();
    else setTimeout(init, 200);   // 遅延構築される画面に追従
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
