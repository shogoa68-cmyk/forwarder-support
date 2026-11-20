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
  // Design 49：線のアイコン（SVG・currentColor）＋短い名前。desc は［その他］メニューの右の小さな説明
  const _I = function (d) { return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' + d + '</svg>'; };
  const ICONS = {
    digest:   _I('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
    fin:      _I('<circle cx="12" cy="12" r="9"/><path d="M9 8l3 4 3-4M8.5 12h7M8.5 15h7M12 12v6"/>'),
    chat:     _I('<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z"/>'),
    subcon:   _I('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M17 14.2c2.5.3 4.5 2.4 4.5 5"/>'),
    charges:  _I('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
    compare:  _I('<path d="M12 4v16M6 20h12M4 8h16"/><path d="M4 8l-2 6a3 3 0 0 0 6 0zM20 8l-2 6a3 3 0 0 0 6 0z" transform="translate(-1 0)"/>'),
    fcllcl:   _I('<rect x="3" y="11" width="9" height="9" rx="1"/><rect x="13" y="4" width="8" height="8" rx="1"/><rect x="14" y="15" width="6" height="5" rx="1"/>'),
    bookmark: _I('<path d="M6 3h12v18l-6-4-6 4z"/>'),
    similar:  _I('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    scenario: _I('<path d="M9 3L7 21M17 3l-2 18M4 9h17M3 15h17"/>'),
    pattern:  _I('<rect x="4" y="4" width="16" height="5" rx="1"/><rect x="4" y="11" width="16" height="5" rx="1"/><path d="M6 19h12"/>'),
    more:     _I('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
  };
  const MODS = [
    { id: 'digest',   label: '費用', title: '費用テーブル（縮小表示）', panel: 'quoteSummaryPanel', tab: 'digest' },
    { id: 'fin',      label: '金額',    title: '金額',         panel: 'quoteSummaryPanel', tab: 'fin'    },
    { id: 'chat',     label: '申し送り', title: '申し送り',     panel: 'quoteSummaryPanel', tab: 'chat'   },
    { id: 'subcon',   label: 'サブコン', title: 'サブコン別',   panel: 'siPanel' },
    { id: 'charges',  label: 'チャージ', title: '諸チャージ',   panel: 'lcRailPanel' },
    { id: 'compare',  label: '単価比較', more: 1, desc: '同じ品目の仕入', title: '同一項目の最安値比較', panel: 'cmpRailPanel' },
    { id: 'fcllcl',   label: 'FCL/LCL', more: 1, desc: '損益分岐', title: 'FCL/LCL 損益分岐', panel: 'flPanel' },
    { id: 'bookmark', label: 'リンク',  more: 1, desc: 'ブックマーク', title: 'ブックマーク',  panel: 'bmRailPanel' },
    { id: 'similar',  label: '類似',    more: 1, desc: '過去の案件', title: '類似見積',     panel: 'sqPanel' },
    { id: 'scenario', label: '数量', more: 1, desc: 'まとめて変更', title: '単位で数量を一括変更', panel: 'scPanel' },
    { id: 'pattern',  label: '行セット', more: 1, desc: '行パターン', title: '行パターン',   panel: 'rpRailPanel' },
  ];

  // 引き出しの既定幅（モジュール別・Design 33）。最小 300・最大 560。左端ドラッグで変更（モジュールごとに記憶）
  const DEF_W = {};   // Design 49：既定は全モジュール 400px にそろえる
  function _wOf(mod, saved) { return (saved && saved['w:' + mod]) || DEF_W[mod] || 400; }

  // 旧 'summary' モジュールは廃止。保存済み active のマイグレーション用。
  function _migrateActive(a) {
    if (a === 'summary') return 'digest';
    if (a === null) return null;
    return MODS.some(function (m) { return m.id === a; }) ? a : 'digest';
  }

  let state = { active: 'digest', pinned: true, width: 300 };

  function _railBtn(m) {
    return '<button class="qrc-rail-btn" data-mod="' + m.id + '" title="' + m.title + '" aria-label="' + m.label + '">' +
             '<span class="qrc-rail-ico">' + ICONS[m.id] + '</span><em>' + m.label + '</em></button>';
  }
  function _moreItem(m) {
    return '<button class="qrc-rail-btn qrc-more-item" data-mod="' + m.id + '" title="' + m.title + '" aria-label="' + m.label + '">' +
             '<span class="qrc-rail-ico">' + ICONS[m.id] + '</span><em>' + m.label + '</em><small>' + (m.desc || '') + '</small></button>';
  }

  // ---- DOM 構築（既存 .quote-right-col を包み替え） ---------------------
  function build() {
    const col = document.querySelector('#tab-quote-make .quote-right-col');
    if (!col || col.dataset.qrcReady) return;

    const saved = _load();
    state.active = ('active' in saved) ? _migrateActive(saved.active) : 'digest';
    state.pinned = ('pinned' in saved) ? saved.pinned : true;
    state.width  = _wOf(state.active, saved);

    // 既存パネルを退避
    const panels = {
      quoteSummaryPanel: document.getElementById('quoteSummaryPanel'),
      sqPanel:           document.getElementById('sqPanel'),
      scPanel:           document.getElementById('scPanel'),
      cmpRailPanel:      document.getElementById('cmpRailPanel'),
      flPanel:           document.getElementById('flPanel'),
      siPanel:           document.getElementById('siPanel'),
      lcRailPanel:       document.getElementById('lcRailPanel'),
      bmRailPanel:       document.getElementById('bmRailPanel'),
      rpRailPanel:       document.getElementById('rpRailPanel'),
    };

    // シェル骨格
    col.classList.add('quote-right-col--rail');
    col.innerHTML =
      '<div class="qrc-drawer" id="qrcDrawer">' +
        '<div class="qrc-resize" id="qrcResize" title="ドラッグして幅を変更"><span class="qrc-resize-grip"></span></div>' +
        '<div class="qrc-drawer-head">' +
          '<span class="qrc-drawer-ico" id="qrcIco"></span><span class="qrc-drawer-title" id="qrcTitle"></span>' +
          '<button class="qrc-pin"  id="qrcPin"  title="常時表示に固定／解除">📌</button>' +
          '<button class="qrc-close" id="qrcClose" title="閉じてレールのみ">×</button>' +
        '</div>' +
        '<div class="qrc-drawer-status" id="qrcStatus" hidden></div>' +
        '<div class="qrc-drawer-body" id="qrcBody"></div>' +
        '<div class="qrc-drawer-foot" id="qrcFoot" hidden></div>' +
      '</div>' +
      '<nav class="qrc-rail" id="qrcRail">' +
        MODS.filter(function (m) { return !m.more; }).map(_railBtn).join('') +
        '<hr class="qrc-rail-sep">' +
        '<button class="qrc-rail-btn qrc-more2-btn" id="qrcMore2" type="button" title="その他のツール" aria-expanded="false"><span class="qrc-rail-ico">' + ICONS.more + '</span><em>その他</em></button>' +
        '<div class="qrc-rail-more" id="qrcRailMore" role="menu" hidden>' + MODS.filter(function (m) { return m.more; }).map(_moreItem).join('') + '</div>' +
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
      if (btn.id === 'qrcMore2') { toggleMore(); return; }
      const mod = btn.dataset.mod;
      if (btn.classList.contains('qrc-more-item')) toggleMore(false);
      setActive(state.active === mod ? null : mod);
    });
    col.querySelector('#qrcClose').addEventListener('click', function () { setActive(null); });
    col.querySelector('#qrcPin').addEventListener('click', function () {
      state.pinned = !state.pinned; _save({ pinned: state.pinned }); render();
    });
    col.querySelector('#qrcResize').addEventListener('pointerdown', startResize);

    col.dataset.qrcReady = '1';
    render();
    try { new MutationObserver(_statusSoon).observe(body, { childList: true, subtree: true, characterData: true }); } catch (e) {}

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
      state.width = Math.max(300, Math.min(560, w0 + dx));
      const d = document.getElementById('qrcDrawer');
      if (d) d.style.width = state.width + 'px';
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const o = {}; o['w:' + state.active] = state.width; _save(o);
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
    if (state.active === 'pattern' && mod !== 'pattern') _pattBack();
    state.active = mod;
    if (mod === 'pattern') _pattIn();
    if (!mod) document.dispatchEvent(new CustomEvent('qrc:close'));
    if (mod) state.width = _wOf(mod, _load());
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
    // 比較パネル：アクティブ化時に最新の行データで再描画
    if (mod === 'compare' && typeof window.renderCompareRail === 'function') {
      window.renderCompareRail();
    }
    // FCL/LCL 損益分岐パネル：アクティブ化時に最新の物量で再計算
    if (mod === 'fcllcl' && typeof window.renderFclLcl === 'function') {
      window.renderFclLcl();
    }
    // 諸チャージパネル：アクティブ化時にデータロード
    if (mod === 'charges' && typeof window.loadChargesRail === 'function') {
      window.loadChargesRail();
    }
    // ブックマークパネル：アクティブ化時に案件連動チップを描画
    if (mod === 'bookmark' && typeof window.renderQuoteBookmarkRail === 'function') {
      window.renderQuoteBookmarkRail();
    }
    // 類似見積パネル：アクティブ化時に「🔗 関連付けた案件」を最新化
    if (mod === 'similar' && typeof window.sqOnActivate === 'function') {
      window.sqOnActivate();
    }
  }

  function toggleMore(force) {
    const box = document.getElementById('qrcRailMore'), b = document.getElementById('qrcMore2'); if (!box || !b) return;
    const open = (force == null) ? box.hidden : !!force;
    box.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false'); b.classList.toggle('is-open', open);
  }

  // Esc：引き出しを閉じる（モーダル・メニューが開いているときは譲る）
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { const mb = document.getElementById('qrcRailMore'); if (mb && !mb.hidden) { toggleMore(false); return; } }
    if (e.key !== 'Escape' || !state.active) return;
    if (document.querySelector('.confirm-overlay, #previewOverlay.open, #fbOverlay.open, #mdDetailModal.open, .nq-overlay')) return;
    const col = document.querySelector('#tab-quote-make .quote-right-col--rail'); if (!col || !col.getClientRects().length) return;
    if (e.target && /TEXTAREA|SELECT/.test(e.target.tagName)) return;   // 文章の入力中は譲る（欄が 1 行の入力なら Esc で閉じてよい）
    setActive(null);
  });

  // ---- 状態の 1 行（Design 49：.qrc-drawer-status）。読み取りだけ・DOM は触らない ----
  function _yen(n) { return '¥' + Math.round(n || 0).toLocaleString('ja-JP'); }
  function _statusHtml(mod) {
    const L = window._qspLast;
    const B = function (t) { return '<b>' + t + '</b>'; };
    const q = function (sel) { return document.querySelectorAll(sel).length; };
    const pct = L && L.bill ? ((L.bill - L.cost) / L.bill * 100).toFixed(1) + '%' : '—';
    if (mod === 'digest') return L ? B(L.count + ' 項目') + ' · 売 ' + _yen(L.bill) + ' · 粗利 ' + pct : '';
    if (mod === 'fin') return L ? '合計（JPY） ' + B('売 ' + _yen(L.bill) + ' · 粗利 ' + pct) : '';
    if (mod === 'chat') { const n = q('#qspChatList .cp-chat-item'); return n ? B(n + ' 件') : ''; }
    if (mod === 'subcon') { const n = q('#siPanel .rp-sc-card'); return n ? B(n + ' 社') : ''; }
    if (mod === 'compare') { const n = (typeof window.getCompareGroupCount === 'function') ? window.getCompareGroupCount() : 0; return n ? '比べられる品目 ' + B(n) : ''; }
    if (mod === 'bookmark') { const n = q('#bmRailPanel a, #bmRailPanel .bm-chip'); return n ? 'この案件に合うリンク ' + B(n) : ''; }
    if (mod === 'fcllcl') return window._flStatus || '';
    if (mod === 'charges') { const n = q('#lcRailListWrap input[type=checkbox]:checked'), t = q('#lcRailListWrap input[type=checkbox]'); const d = document.querySelector('#lcRailPanel .lc-rail-dir-btn.is-active'); return t ? (d ? d.textContent.replace(/^\S+\s*/, '') + ' · ' : '') + B(n + ' 件選択') + ' · 全 ' + t + ' 件' : ''; }
    if (mod === 'scenario') { const n = q('#scPanel .ud-row'); const m = q('#scPanel .ud-row:not(.ud-row--excluded)'); let rows = 0; document.querySelectorAll('#scPanel .ud-row:not(.ud-row--excluded)').forEach(function (r) { try { rows += JSON.parse(r.dataset.ids || '[]').length; } catch (e) {} }); return n ? '選んだ単位 ' + B(m) + ' · ' + rows + ' 行' : ''; }
    if (mod === 'pattern') { const n = q('#rpRailPanel .preset-item, #rpRailPanel .preset-row, #rpRailPanel .rp-item'); return n ? '行セット ' + B(n) : ''; }
    return '';
  }
  function _foot() {
    const el = document.getElementById('qrcFoot'); if (!el) return;
    let h = '';
    if (state.active === 'digest' && window._qspLast) h = '<span class="qrc-foot-note">行を押すと本文のその行へ移ります</span><button type="button" class="qrc-btn-pri" onclick="qrcAddRow()">＋ 明細を追加</button>';
    if (el.innerHTML !== h) el.innerHTML = h;
    el.hidden = !h;
  }
  window.qrcAddRow = function () { if (typeof window.addRow === 'function') window.addRow(); };
  // ④ 費用のステップ／セクションへ（新画面はステップ、旧画面はスクロール）
  window.qrcGoCost = function () {
    const b = document.querySelector('#e2Steps [data-e2s="4"]');
    if (b) { b.click(); return; }
    const t = document.getElementById('tableWrap') || document.getElementById('tableScrollWrap');
    if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---- 行セット（P1）：#rowPatternModal の中身（.preset-mgr-box）を開いている間だけ引き出しへ移す ----
  function _pattIn() {
    const host = document.getElementById('rpRailPanel'), box = document.querySelector('#rowPatternModal .preset-mgr-box');
    if (!host || !box) return;
    host.appendChild(box);
    if (typeof window.loadRowPatternsFromCloud === 'function') window.loadRowPatternsFromCloud();
    const inp = document.getElementById('rowPatternNameInput');
    if (inp && !inp.value) { const d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; inp.value = '行セット_' + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()); }
  }
  function _pattBack() {
    const modal = document.getElementById('rowPatternModal'), box = document.querySelector('#rpRailPanel .preset-mgr-box');
    if (modal && box) modal.appendChild(box);
  }
  // 外から従来のダイアログが開かれたら、中身をダイアログへ戻す（空のダイアログを出さない）
  (function () {
    const m = document.getElementById('rowPatternModal'); if (!m || !window.MutationObserver) return;
    new MutationObserver(function () {
      if (m.classList.contains('open') && document.querySelector('#rpRailPanel .preset-mgr-box')) { _pattBack(); if (state.active === 'pattern') setActive(null); }
    }).observe(m, { attributes: true, attributeFilter: ['class'] });
  })();
  function _status() {
    const el = document.getElementById('qrcStatus'); if (!el) return;
    const h = state.active ? _statusHtml(state.active) : '';
    if (el.innerHTML !== h) el.innerHTML = h;
    el.hidden = !h;
    _foot();
  }
  let _stT = 0;
  function _statusSoon() { clearTimeout(_stT); _stT = setTimeout(_status, 150); }

  // ［その他］のメニュー：外側クリック・Esc で閉じる
  document.addEventListener('click', function (e) {
    const box = document.getElementById('qrcRailMore'); if (!box || box.hidden) return;
    if (e.target.closest('#qrcRailMore, #qrcMore2')) return;
    toggleMore(false);
  });

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
    col.querySelector('#qrcTitle').textContent = def ? def.label : '';
    col.querySelector('#qrcTitle').title = def ? def.title : '';
    col.querySelector('#qrcIco').innerHTML = def ? ICONS[def.id] : '';
    drawer.dataset.mod = state.active || '';
    _status();

    // パネル出し分け（active のモジュールの panel だけ表示）
    const showPanel = def ? def.panel : null;
    ['quoteSummaryPanel', 'sqPanel', 'scPanel', 'cmpRailPanel', 'flPanel', 'siPanel', 'lcRailPanel', 'bmRailPanel', 'rpRailPanel'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      // sqPanel は内部で hidden 属性を自前制御するため、表示は wrapper 側で行う
      el.style.display = (id === showPanel) ? '' : 'none';
    });

    // レールのアクティブ表示
    col.querySelectorAll('.qrc-rail-btn').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.mod === state.active);
    });

    const ab = col.querySelector('.qrc-rail-more .qrc-rail-btn.is-on');
    col.querySelector('#qrcMore2').classList.toggle('is-on', !!ab);
    document.body.dataset.qrcOpen = state.active || '';
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
    // 比較：同一品名で比較可能な項目数バッジ
    const cmpBtn = col.querySelector('.qrc-rail-btn[data-mod="compare"]');
    if (cmpBtn) {
      const n = (typeof window.getCompareGroupCount === 'function') ? window.getCompareGroupCount() : 0;
      _setBadge(cmpBtn, n > 0 ? String(n) : '');
    }
    // 諸チャージ：期限切れ・期限間近にドット
    const lcBtn = col.querySelector('.qrc-rail-btn[data-mod="charges"]');
    if (lcBtn) {
      const hasAlert = !!document.querySelector('#lcRailPanel .lc-rail-expired, #lcRailPanel .lc-rail-expiring');
      _setDot(lcBtn, hasAlert);
    }
    _moreDot(col);
  }
  function _moreDot(col) {
    const b = col.querySelector('#qrcMore2'); if (!b) return;
    const inner = col.querySelector('#qrcRailMore'); const has = !!(inner && inner.querySelector('.qrc-rail-badge, .qrc-rail-dot')) && inner.hidden;
    _setDot(b, has);
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

  // ❓（困ったとき）はレールの下端に置く（Design 49）。レールが画面に出ている間だけ移し、出ていないとき（他のタブ・ダッシュボード・閉じた引き出し）は body へ戻す
  function _dockHelp() {
    const f = document.getElementById('fbQuickFab'), rail = document.getElementById('qrcRail');
    if (!f || !rail) return;
    const tab = document.getElementById('tab-quote-make');
    const railShown = !!(tab && tab.classList.contains('active') && !document.body.classList.contains('qp-dash-active') &&
      rail.getClientRects().length && window.innerWidth > 600);
    const inRail = f.parentNode === rail;
    if (railShown && !inRail) { f.classList.add('fb-in-rail'); rail.appendChild(f); }
    else if (!railShown && inRail) { f.classList.remove('fb-in-rail'); document.body.appendChild(f); }
  }
  setInterval(_dockHelp, 700);
  window.addEventListener('resize', _dockHelp);

  // 外部（類似・チャット更新時）から再装飾できるよう公開
  window.qrcRefresh = function () {
    const col = document.querySelector('#tab-quote-make .quote-right-col--rail');
    if (col) { _decorateRail(col); _status(); }
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
