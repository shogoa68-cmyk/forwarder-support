// ================================================================
//  表示モード（かんたん／詳細）  ※ Claude Design「かんたん表示」案
//  ・<html class="mode-simple"> が付いていれば「かんたん」、外せば「詳細」（従来どおりの画面）
//  ・保存：localStorage の fwd.uiMode（'simple' | 'detail'）。早期適用は index.html の <head> インラインスクリプト
//  ・既定は index.html の UI_MODE_DEFAULT（段階導入中は 'detail'）。?mode=simple|detail でも切替可
//  ・隠す項目も DOM には残す（値の保存・計算は継続）。CSS は css/simple-mode.css
// ================================================================
(function () {
  'use strict';
  const KEY = 'fwd.uiMode', HINT = 'fwd.uiHintSeen';
  const root = document.documentElement;
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  window.uiIsSimple = () => root.classList.contains('mode-simple');

  // ---- 切替 ----
  function syncSwitch() {
    const m = window.uiIsSimple() ? 'simple' : 'detail';
    document.querySelectorAll('.uim-switch [data-uim]').forEach(b => {
      const on = b.getAttribute('data-uim') === m;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // 検索ボックスの説明（かんたんは短く）。元の文言は data に退避
    const q = document.getElementById('qpdSearch');
    if (q) {
      if (!q.dataset.phDetail) q.dataset.phDetail = q.getAttribute('placeholder') || '';
      q.setAttribute('placeholder', m === 'simple' ? '🔍 お客様名・案件名で検索' : q.dataset.phDetail);
    }
  }
  window.setUiMode = function (m) {
    m = (m === 'simple') ? 'simple' : 'detail';
    ls.set(KEY, m);
    ls.set(HINT, '1');                       // 自分で切り替えたら、初回の案内は不要
    root.classList.toggle('mode-simple', m === 'simple');
    dismissHint();
    uiCloseMenus();
    syncSwitch();
    if (typeof window.cloudRerenderDash === 'function') window.cloudRerenderDash();   // カードの構造がモードで変わるため描き直す
    if (typeof window.uiEditorRefresh === 'function') window.uiEditorRefresh();      // 見積入力画面（畳み・上級項目の自動表示・道しるべ）
  };

  // ---- ダッシュボード「詳しく絞り込む」（かんたん表示で、詳細検索・タグ・関連付け・ランキングをまとめて出し入れ） ----
  window.qpdToggleMore = function () {
    const d = document.getElementById('qpDashboard'); if (!d) return;
    const open = !d.classList.contains('qpd-more-open');
    d.classList.toggle('qpd-more-open', open);
    const b = document.getElementById('qpdMoreToggle');
    if (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); b.textContent = open ? '🔎 詳しく絞り込む ▼' : '🔎 詳しく絞り込む ▶'; }
  };

  // ---- 「⋯」メニュー（案件カード／リスト行）。開閉・外側クリック・Esc・矢印キー ----
  // 開いている間だけパネルを <body> 直下へ移す：カード一覧が container-type（レイアウト封じ込め）を持つため、
  // 中に置いたままだと position:fixed の基準が一覧の枠になり、位置がずれる／枠で切れる。
  let openBtn = null, openPanel = null, openHome = null;
  function items(panel) { return Array.from(panel.querySelectorAll('.cloud-menu-item:not([disabled])')); }
  window.uiCloseMenus = function (restoreFocus) {
    if (openPanel) {
      openPanel.hidden = true;
      if (openHome && openHome.isConnected) openHome.appendChild(openPanel); else openPanel.remove();
    }
    document.querySelectorAll('.cloud-menu-btn[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    if (restoreFocus && openBtn && openBtn.isConnected) { try { openBtn.focus(); } catch (e) {} }
    openBtn = openPanel = openHome = null;
  };
  window.uiToggleMenu = function (btn) {
    const home = btn.parentElement;
    const panel = home.querySelector('.cloud-menu-panel');
    const wasOpen = !!panel && panel === openPanel;
    window.uiCloseMenus();
    if (!panel || wasOpen) return;
    openBtn = btn; openPanel = panel; openHome = home;
    document.body.appendChild(panel);
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = '0px'; panel.style.left = '0px';
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    const top = (r.bottom + 4 + h > window.innerHeight) ? Math.max(8, r.top - 4 - h) : r.bottom + 4;
    panel.style.left = left + 'px'; panel.style.top = top + 'px';
    const first = items(panel)[0]; if (first) first.focus();
  };
  document.addEventListener('click', e => {
    if (openPanel && !e.target.closest('.cloud-menu-panel') && !e.target.closest('.cloud-menu-btn')) window.uiCloseMenus();
  });
  document.addEventListener('scroll', () => { if (openPanel) window.uiCloseMenus(); }, true);
  window.addEventListener('resize', () => { if (openPanel) window.uiCloseMenus(); });
  document.addEventListener('keydown', e => {
    if (!openPanel) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); window.uiCloseMenus(true); return; }
    const list = items(openPanel), i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (list[(i + 1) % list.length] || list[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (list[(i - 1 + list.length) % list.length] || list[0]).focus(); }
    else if (e.key === 'Tab') { window.uiCloseMenus(true); }
  }, true);

  // ---- 初回の案内（既定が「かんたん」のとき、自分で切り替えたことが無い人にだけ・1回） ----
  let hintEl = null;
  function dismissHint() { if (hintEl) { hintEl.remove(); hintEl = null; } }
  function showHint() {
    if (!window.uiIsSimple() || ls.get(HINT) === '1' || ls.get(KEY) !== null) return;
    if (root.getAttribute('data-ui-mode-default') !== 'simple') return;
    const sw = document.querySelector('#qpDashboard .uim-switch');
    if (!sw || !sw.offsetParent) return;
    hintEl = document.createElement('div');
    hintEl.className = 'uim-hint';
    hintEl.setAttribute('role', 'dialog');
    hintEl.innerHTML =
      '<b>画面が新しくなりました</b>' +
      '<p>よく使う項目だけを表示しています。すべての機能は、右上の「詳細表示」に切り替えるといつでも使えます。</p>' +
      '<div class="uim-hint-acts"><button type="button" class="uim-hint-close">閉じる</button>' +
      '<button type="button" class="uim-hint-detail">詳細表示を見てみる</button></div>';
    document.body.appendChild(hintEl);
    const r = sw.getBoundingClientRect();
    hintEl.style.top = (r.bottom + window.scrollY + 8) + 'px';
    hintEl.style.left = Math.max(8, Math.min(window.innerWidth - 348, r.right - 340)) + 'px';
    const done = () => { ls.set(HINT, '1'); dismissHint(); };
    hintEl.querySelector('.uim-hint-close').addEventListener('click', done);
    hintEl.querySelector('.uim-hint-detail').addEventListener('click', () => { done(); window.setUiMode('detail'); });
  }
  window.uiShowHintIfNeeded = showHint;

  // ================================================================
  //  見積入力画面（かんたん）
  //  ・区分 data-tier：req＝常に表示／opt＝畳む（詳細（任意））／adv＝かんたんでは隠す
  //  ・隠した項目も DOM に残す（値の保存・計算は継続）。上級機能を使っている案件では、その項目を自動で表示する
  // ================================================================
  const $ = id => document.getElementById(id);
  const OPT_SECS = ['section-scope', 'section-remark'];     // かんたんでは畳む任意セクション
  const optInit = new Set();                                  // かんたん中に初期の畳みを済ませたセクション

  // 「詳細（任意）」の開閉（#refBody／#cargoBody などの host に tier-opt-open を付け外し）
  window.uiToggleOpt = function (btn) {
    const host = $(btn.getAttribute('data-opt-host'));
    if (!host) return;
    const open = !host.classList.contains('tier-opt-open');
    host.classList.toggle('tier-opt-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    const c = btn.querySelector('.tier-opt-caret'); if (c) c.textContent = open ? '▼' : '▶';
  };

  // 任意セクション（作業範囲・全体リマーク）：かんたんでは既定で畳み、見出しクリックで開閉
  function applyOptSections() {
    const simple = window.uiIsSimple();
    OPT_SECS.forEach(id => {
      const el = $(id); if (!el) return;
      if (!simple) { el.classList.remove('collapsed'); return; }
      if (!optInit.has(id)) { optInit.add(id); el.classList.add('collapsed'); }
    });
  }
  document.addEventListener('click', e => {
    if (!window.uiIsSimple()) return;
    const head = e.target.closest && e.target.closest('#tab-quote-make .section-toggle-head');
    if (!head || !OPT_SECS.includes(head.parentElement.id)) return;
    e.stopImmediatePropagation(); e.preventDefault();      // 既存の「スクロールのみ」処理より先に開閉する
    head.parentElement.classList.toggle('collapsed');
  }, true);

  // 上級機能を使っている案件：該当項目を自動で表示し、上部の帯で知らせる
  function scanAdv() {
    const found = [];
    const mark = (el, label, on) => { if (!el) return; el.toggleAttribute('data-adv-inuse', !!on); if (on) found.push(label); };
    mark($('zone1Card'), '出発地ゾーン（集荷など）', $('zone1Card') && !$('zone1Card').classList.contains('zone-off'));
    mark($('zone3Card'), '到着地ゾーン（配送など）', $('zone3Card') && !$('zone3Card').classList.contains('zone-off'));
    const hz = ($('cond-hazmat') && $('cond-hazmat').value || '').trim();
    document.querySelectorAll('[data-adv-key="hazmat"]').forEach(el => mark(el, '危険品・特殊貨物', hz && !/^なし/.test(hz)));
    let multi = false, modes = false;
    try { multi = Array.isArray(_packingPatterns) && (_packingPatterns.length > 1 || _packingPatterns.some(p => p && p.name)); modes = Array.isArray(_packingPatterns) && _packingPatterns.some(p => p && p.mode); } catch (e) {}
    mark($('cdPatternTabs'), '複数の荷姿パターン', multi || modes);
    const fl = document.querySelector('.qrc-rail-btn[data-mod="fcllcl"]');
    if (fl) fl.toggleAttribute('data-adv-inuse', modes);
    if (modes) found.push('FCL/LCL比較');
    const bar = $('uimAdvBar');
    if (bar) {
      const uniq = Array.from(new Set(found));
      const show = window.uiIsSimple() && uniq.length > 0;
      bar.hidden = !show;
      if (show) $('uimAdvBarText').textContent = '一部の上級項目も表示しています：この見積は「' + uniq.join('」「') + '」を使っています。';
    }
  }

  // 手順の道しるべ（① 条件 → ② 貨物 → ③ 費用 → ④ 出力）
  const HINTS = {
    0: 'いまは①です。まず上の「見積もり番号・お客様名・ご担当者」を入力し、続けて貿易条件（インコタームズ・輸送モード・航路）を選びましょう。',
    1: 'いまは①です。貿易条件（インコタームズ・輸送モード・航路）を入力しましょう。',
    2: 'いまは②です。貨物の情報（品名・物量）を入力しましょう。',
    3: 'いまは③です。費用の明細（仕入れ値・売値）を入力しましょう。',
    4: 'いまは④です。内容を確認して、プレビューや PDF で出力しましょう。',
    5: '出力まで進んでいます。内容を直す場合は、各セクションへ戻ってください。',
  };
  function updateGuide() {
    const g = $('qpGuide'); if (!g || !window.uiIsSimple() || typeof window.quoteCalcProgress !== 'function') return;
    let d, st;
    try { d = window.gatherAllData(); st = window.quoteCalcProgress(d).steps; } catch (e) { return; }
    const f = (d && d.fields) || {};
    const arr = k => { try { const a = JSON.parse(f[k] || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
    // ① 条件：インコタームズ・輸送モード・航路（積み地／揚げ地）が入っている
    const hasRoute = !!((f['z2Pol'] || '').trim() || (f['z2Pod'] || '').trim() || arr('z2-routes-data').length);
    const s1 = !!((f['cond-incoterms'] || '').trim() && (f['cond-incoterms'] || '').trim() !== '設定なし' && (f['cond-mode'] || '').trim() && hasRoute);
    // ② 貨物：品名、またはコンテナ／荷姿が入っている
    const s2 = !!((f['cond-cargo'] || '').trim() || arr('cond-container-data').some(e => e && +e.count > 0) || arr('cond-packing-data').some(e => e && e.pkg));
    const done = [s1, s2, !!(st[2] && st[3]), !!st[4]];
    const cur = done.findIndex(x => !x);                       // 0..3、すべて完了なら -1
    g.querySelectorAll('.qp-guide-step').forEach((b, i) => {
      b.classList.toggle('is-done', !!done[i]);
      b.classList.toggle('is-current', i === cur);
      b.setAttribute('aria-current', i === cur ? 'step' : 'false');
    });
    const noName = !(($('qf-customer') && $('qf-customer').value || '').trim());
    $('qpHint').textContent = cur < 0 ? HINTS[5] : (cur === 0 ? (noName ? HINTS[0] : HINTS[1]) : HINTS[cur + 1]);
  }
  window.uiGuideGo = function (n) {
    if (n === 4) { if (typeof window.openPreview === 'function') window.openPreview(); return; }
    const el = $({ 1: 'section-cond', 2: 'section-cargo', 3: 'section-table' }[n]);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  // 任意セクションの畳み時の要約（作業範囲・全体リマーク）
  function updateOptSummaries() {
    const one = (v, n) => { v = (v || '').replace(/\s+/g, ' ').trim(); return v ? '— ' + (v.length > n ? v.slice(0, n) + '…' : v) : '— 未入力'; };
    const a = $('sumScope'); if (a) a.textContent = one($('qf-scope') && $('qf-scope').value, 40);
    const b = $('sumRemark'); if (b) b.textContent = one($('remarkTextarea') && $('remarkTextarea').value, 40);
  }

  // 右レール：上級のツールは「その他のツール」にまとめる（かんたんのみ。CSS で出し分け）
  function ensureRailMore() {
    const rail = $('qrcRail'); if (!rail) return;
    let b = rail.querySelector('.qrc-more-btn');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button'; b.className = 'qrc-rail-btn qrc-more-btn'; b.title = 'その他のツール';
      b.innerHTML = '<span class="qrc-rail-ico">⋯</span><em>その他</em>';
      b.addEventListener('click', e => { e.stopPropagation(); rail.classList.toggle('qrc-more-open'); });
      rail.appendChild(b);
    }
    // 開いている上級ツールのボタンが隠れないよう、その場合は自動で展開
    if (rail.querySelector('.qrc-rail-btn.is-on:not([data-mod="digest"]):not([data-mod="fin"]):not([data-mod="chat"]):not(.qrc-more-btn)')) rail.classList.add('qrc-more-open');
  }

  function editorTick() {
    if (!window.uiIsSimple()) return;
    const tab = $('tab-quote-make'); if (!tab || !window.__quoteInitialized) return;
    applyOptSections(); scanAdv(); updateGuide(); updateOptSummaries(); ensureRailMore();
  }
  window.uiEditorRefresh = function () {
    optInit.clear(); applyOptSections();
    if (!window.uiIsSimple()) { const bar = $('uimAdvBar'); if (bar) bar.hidden = true; return; }
    editorTick();
  };
  setInterval(editorTick, 1500);
  document.addEventListener('input', () => { if (window.uiIsSimple()) { clearTimeout(editorTick._t); editorTick._t = setTimeout(editorTick, 700); } }, true);
  document.addEventListener('change', () => { if (window.uiIsSimple()) { clearTimeout(editorTick._t); editorTick._t = setTimeout(editorTick, 300); } }, true);

  function init() { syncSwitch(); setTimeout(showHint, 1200); setTimeout(() => { if (window.uiEditorRefresh) window.uiEditorRefresh(); }, 1500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
