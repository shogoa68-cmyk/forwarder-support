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

  function init() { syncSwitch(); setTimeout(showHint, 1200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
