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
  // panel: 実在パネルの id。要約/輸送/金額/申し送りは同じ #quoteSummaryPanel を
  // 共有し、tab（digest/flow/fin/chat）で内部ペインを出し分ける。レール側で
  // それぞれ独立アイコンとして並べ、押下時に qspSetTab(tab) で切替える。
  const MODS = [
    { id: 'digest',   icon: '🧭', label: 'ジャンプ', title: 'ジャンプ',     panel: 'quoteSummaryPanel', tab: 'digest' },
    { id: 'flow',     icon: '🚚', label: '輸送',    title: '輸送',         panel: 'quoteSummaryPanel', tab: 'flow'   },
    { id: 'bookmark', icon: '🔖', label: 'ブク',    title: 'ブックマーク',  panel: 'bmRailPanel' },
    { id: 'fin',      icon: '💰', label: '金額',    title: '金額',         panel: 'quoteSummaryPanel', tab: 'fin'    },
    { id: 'chat',     icon: '💬', label: '申し送り', title: '申し送り',     panel: 'quoteSummaryPanel', tab: 'chat'   },
    { id: 'similar',  icon: '🔍', label: '類似',    title: '類似見積',     panel: 'sqPanel' },
    { id: 'scenario', icon: '🪜', label: 'シナリオ', title: 'シナリオ比較', panel: 'scPanel' },
    { id: 'subcon',   icon: '👷', label: 'サブコン', title: 'サブコン別',   panel: 'siPanel' },
    { id: 'charges',  icon: '📦', label: 'チャージ', title: '諸チャージ',   panel: 'lcRailPanel' },
    { id: 'pattern',  icon: '🗜️', label: '行パタ', title: '行パターン',   action: 'openRowPatternMgr' },
  ];

  // 旧 'summary' モジュールは廃止。保存済み active のマイグレーション用。
  function _migrateActive(a) {
    if (a === 'summary') return 'digest';
    if (a === null) return null;
    return MODS.some(function (m) { return m.id === a; }) ? a : 'digest';
  }

  let state = { active: 'digest', pinned: true, width: 300 };

  // ---- DOM 構築（既存 .quote-right-col を包み替え） ---------------------
  function build() {
    const col = document.querySelector('#tab-quote-make .quote-right-col');
    if (!col || col.dataset.qrcReady) return;

    const saved = _load();
    state.active = ('active' in saved) ? _migrateActive(saved.active) : 'digest';
    state.pinned = ('pinned' in saved) ? saved.pinned : true;
    state.width  = saved.width || 300;

    // 既存パネルを退避
    const panels = {
      quoteSummaryPanel: document.getElementById('quoteSummaryPanel'),
      sqPanel:           document.getElementById('sqPanel'),
      scPanel:           document.getElementById('scPanel'),
      siPanel:           document.getElementById('siPanel'),
      lcRailPanel:       document.getElementById('lcRailPanel'),
      bmRailPanel:       document.getElementById('bmRailPanel'),
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

    // 初期表示のサマリ内部ペインをレールの active と一致させる
    const initDef = MODS.find(function (m) { return m.id === state.active; });
    if (initDef && initDef.tab && typeof window.qspSetTab === 'function') {
      window.qspSetTab(initDef.tab);
    }
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
    // アクション型モジュール（パネルを持たず、押下で関数を呼ぶ）：
    // ドロワーは開かず、レールの active 状態も変えない
    const actDef = MODS.find(function (m) { return m.id === mod; });
    if (actDef && actDef.action) {
      if (typeof window[actDef.action] === 'function') window[actDef.action]();
      return;
    }
    state.active = mod;
    _save({ active: mod });
    render();
    // chat ショートカット：summary パネルのチャットタブへ
    const def = MODS.find(function (m) { return m.id === mod; });
    if (def && def.tab && typeof window.qspSetTab === 'function') {
      window.qspSetTab(def.tab);
    }
    // サブコン別パネル：アクティブ化時にデータロード
    if (mod === 'subcon' && typeof window.loadSubconPanel === 'function') {
      window.loadSubconPanel();
    }
    // 諸チャージパネル：アクティブ化時にデータロード
    if (mod === 'charges' && typeof window.loadChargesRail === 'function') {
      window.loadChargesRail();
    }
    // ブックマークパネル：アクティブ化時に案件連動チップを描画
    if (mod === 'bookmark' && typeof window.renderQuoteBookmarkRail === 'function') {
      window.renderQuoteBookmarkRail();
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
    ['quoteSummaryPanel', 'sqPanel', 'scPanel', 'siPanel', 'lcRailPanel', 'bmRailPanel'].forEach(function (id) {
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
    // サブコン別：カード数バッジ
    const siBtn = col.querySelector('.qrc-rail-btn[data-mod="subcon"]');
    if (siBtn) {
      const n = document.querySelectorAll('#siPanel .rp-sc-card').length;
      _setBadge(siBtn, n > 0 ? String(n) : '');
    }
    // 諸チャージ：期限切れ・期限間近にドット
    const lcBtn = col.querySelector('.qrc-rail-btn[data-mod="charges"]');
    if (lcBtn) {
      const hasAlert = !!document.querySelector('#lcRailPanel .lc-rail-expired, #lcRailPanel .lc-rail-expiring');
      _setDot(lcBtn, hasAlert);
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
