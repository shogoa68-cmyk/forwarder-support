// 見積の編集中に、ほかの画面を「サイドピーク（右から出る細長い窓）」か「ポップアップ（中央の大きな窓）」で開く（2026-11）
//  ・見積を開いたまま、上段ナビ（リンク集・実績を見る）を押すと、画面を切り替えずに窓の中へ出す。
//  ・中身は既存の画面（#tab-bookmark など）を「要素ごと」窓へ移して借りるだけ（id・onclick・データは不変・読み直しなし）。
//  ・閉じる／ほかの画面へ切り替える（switchTab）ときは元の場所へ返す。
//  ・Ctrl／⌘／Shift＋クリック・真ん中クリック（新しいタブで開く＝tab-sync.js）はそのまま。スマホ・狭い画面（〜999px）は従来どおり画面ごと切り替え。
(function () {
  'use strict';
  // 窓で開ける画面（aria-controls → [カテゴリ名, 初期化の関数名, 窓の題名]）。増やすときはここに足す。
  const PEEKABLE = {
    'tab-bookmark': ['bookmark', 'initBookmarkTab', '🔖 リンク集'],
    'tab-stats': ['stats', 'initStatsTab', '📊 実績を見る'],
  };
  const LS_MODE = 'fwd.peekMode', LS_W = 'fwd.peekW';
  const MIN_W = 420, DEF_W = 640;
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  let wrap = null, cur = null;   // cur = { id, el, mark, btn }

  const mode = () => (get(LS_MODE) === 'center' ? 'center' : 'side');
  const wide = () => window.innerWidth >= 1000;
  const onEditor = () => {
    const t = document.getElementById('tab-quote-make');
    return !!t && t.classList.contains('active') && !t.classList.contains('qp-dash');
  };

  function build() {
    if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.id = 'pkWrap'; wrap.hidden = true;
    wrap.innerHTML =
      '<div class="pk-scrim" data-pk="close"></div>' +
      '<section class="pk-panel" role="dialog" aria-modal="false" aria-labelledby="pkTitle">' +
        '<div class="pk-resize" title="ドラッグで幅を変える（ダブルクリックで元の幅）" aria-hidden="true"></div>' +
        '<header class="pk-head">' +
          '<h2 id="pkTitle" class="pk-title"></h2>' +
          '<div class="pk-modes" role="group" aria-label="開き方">' +
            '<button type="button" class="pk-mode" data-pk="side" title="右に細長く出す（見積を見ながら使える）">▐ サイドピーク</button>' +
            '<button type="button" class="pk-mode" data-pk="center" title="中央に大きく出す">▣ ポップアップ</button>' +
          '</div>' +
          '<button type="button" class="pk-btn" data-pk="full" title="見積の画面から切り替えて、この画面を全体で開く">⤢ 全体で開く</button>' +
          '<button type="button" class="pk-btn pk-x" data-pk="close" title="閉じる（Esc）" aria-label="閉じる">✕</button>' +
        '</header>' +
        '<div class="pk-body" id="pkBody"></div>' +
      '</section>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-pk]'); if (!b || !wrap.contains(b)) return;
      const a = b.dataset.pk;
      if (a === 'close') close();
      else if (a === 'side' || a === 'center') { set(LS_MODE, a); applyMode(); }
      else if (a === 'full') full();
    });
    // 幅の変更（サイドピークのときだけ）
    const rz = wrap.querySelector('.pk-resize');
    rz.addEventListener('pointerdown', e => {
      if (mode() !== 'side') return;
      e.preventDefault(); rz.setPointerCapture(e.pointerId); wrap.classList.add('pk-dragging');
      const mv = ev => setW(window.innerWidth - ev.clientX);
      const up = () => { rz.removeEventListener('pointermove', mv); rz.removeEventListener('pointerup', up); wrap.classList.remove('pk-dragging'); set(LS_W, String(curW())); };
      rz.addEventListener('pointermove', mv); rz.addEventListener('pointerup', up);
    });
    rz.addEventListener('dblclick', () => { setW(DEF_W); set(LS_W, String(DEF_W)); });
    return wrap;
  }
  const maxW = () => Math.max(MIN_W, Math.round(window.innerWidth * 0.75));
  const curW = () => parseInt(wrap.style.getPropertyValue('--pk-w'), 10) || DEF_W;
  function setW(w) { wrap.style.setProperty('--pk-w', Math.max(MIN_W, Math.min(maxW(), Math.round(w))) + 'px'); }
  function placeTop() {
    // サイドピークは、見積の上のバー（保存・PDF）と下の合計バーの間に収める（どちらも隠さない）
    const vis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const nav = document.querySelector('.cat-nav');
    let top = nav ? nav.getBoundingClientRect().bottom : 0;
    const tb = document.getElementById('saveToolbar');
    if (vis(tb)) { const r = tb.getBoundingClientRect(); if (r.bottom > top && r.top < window.innerHeight / 2) top = r.bottom; }
    let bottom = 0;
    for (const id of ['e2Total', 'totFloat']) {
      const el = document.getElementById(id);
      if (vis(el)) { const r = el.getBoundingClientRect(); if (r.top > window.innerHeight / 2) bottom = Math.max(bottom, window.innerHeight - r.top); }
    }
    wrap.style.setProperty('--pk-top', Math.max(0, Math.round(top)) + 'px');
    wrap.style.setProperty('--pk-bottom', Math.max(0, Math.round(bottom)) + 'px');
  }
  function applyMode() {
    if (!wrap) return;
    const m = mode();
    wrap.classList.toggle('pk-side', m === 'side');
    wrap.classList.toggle('pk-center', m === 'center');
    wrap.querySelectorAll('.pk-mode').forEach(b => { const on = b.dataset.pk === m; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    wrap.querySelector('.pk-panel').setAttribute('aria-modal', m === 'center' ? 'true' : 'false');
    document.body.classList.toggle('pk-open-side', !wrap.hidden && m === 'side');
    document.body.classList.toggle('pk-open-center', !wrap.hidden && m === 'center');
  }

  function restore() {
    if (!cur) return;
    const { el, mark } = cur;
    el.classList.remove('active', 'pk-in'); el.setAttribute('aria-hidden', 'true');
    if (mark && mark.parentNode) { mark.parentNode.insertBefore(el, mark); mark.remove(); }
    if (cur.btn) cur.btn.classList.remove('pk-on');
    cur = null;
  }
  function close() {
    if (!wrap || wrap.hidden) return;
    restore();
    wrap.hidden = true;
    document.body.classList.remove('pk-open', 'pk-open-side', 'pk-open-center');
  }
  function open(id, btn) {
    const def = PEEKABLE[id]; const el = document.getElementById(id);
    if (!def || !el) return false;
    build();
    if (cur && cur.id === id) { close(); return true; }   // 同じボタンをもう一度＝閉じる
    restore();
    // 右の引き出し（費用・金額…）は重なるので閉じる
    if (document.body.classList.contains('e2-drawer')) { document.body.classList.remove('e2-drawer'); document.dispatchEvent(new CustomEvent('qrc:close')); }
    const mark = document.createComment('peek:' + id);
    el.parentNode.insertBefore(mark, el);
    const body = wrap.querySelector('#pkBody');
    body.innerHTML = ''; body.appendChild(el);
    el.classList.add('active', 'pk-in'); el.removeAttribute('aria-hidden');
    cur = { id, el, mark, btn: btn || null };
    if (btn) btn.classList.add('pk-on');
    wrap.querySelector('#pkTitle').textContent = def[2];
    const w = parseInt(get(LS_W), 10); setW(w || DEF_W);
    placeTop();
    wrap.hidden = false;
    document.body.classList.add('pk-open');
    applyMode();
    body.scrollTop = 0;
    try { const fn = window[def[1]]; if (typeof fn === 'function') fn(); } catch (e) { console.error(e); }
    return true;
  }
  function full() {
    if (!cur) return;
    const id = cur.id, def = PEEKABLE[id], btn = cur.btn;
    close();
    if (typeof window.switchCategory === 'function') window.switchCategory(def[0], btn || document.querySelector('.cat-btn[aria-controls="' + id + '"]'));
  }

  // 上段ナビのボタン：見積の編集中は窓で開く（捕捉で先に受け取り、元の onclick は動かさない）
  window.addEventListener('click', e => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const b = e.target.closest && e.target.closest('.cat-btn[aria-controls]'); if (!b) return;
    const id = b.getAttribute('aria-controls');
    if (!PEEKABLE[id] || !onEditor() || !wide()) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    // 開いていた「その他」などのメニューを閉じる（cat-more.js は外側のクリックで閉じる）
    document.querySelectorAll('.cat-more-panel:not([hidden])').forEach(() => document.body.click());
    open(id, b);
  }, true);

  // ほかの画面へ切り替えるときは、先に窓の中身を元へ返す
  function wrapSwitch() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__peek) return false;
    const w = function () { close(); return orig.apply(this, arguments); };
    w.__peek = true; window.switchTab = w; return true;
  }
  if (!wrapSwitch()) window.addEventListener('load', wrapSwitch);
  // tab-sync.js などが後から包み直しても、こちらが外側になるように少し待ってもう一度
  window.addEventListener('load', () => setTimeout(wrapSwitch, 0));

  // Esc：窓の中のダイアログ（確認・詳細など）が開いているときは譲る
  const vis = el => !!el && el.getClientRects().length > 0;
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !wrap || wrap.hidden || e.defaultPrevented) return;
    const busy = [...document.querySelectorAll('.confirm-dialog, .md-modal-overlay, .modal-overlay, [role="dialog"]')].some(x => x !== wrap.querySelector('.pk-panel') && !wrap.contains(x) && vis(x))
      || [...wrap.querySelectorAll('#pkBody [role="dialog"], #pkBody .modal-overlay')].some(vis);
    if (busy) return;
    close();
  });
  window.addEventListener('scroll', () => { if (wrap && !wrap.hidden) placeTop(); }, { passive: true });
  window.addEventListener('resize', () => {
    if (!wrap || wrap.hidden) return;
    if (!wide()) { close(); return; }
    placeTop(); setW(curW());
  });

  window.peekOpen = id => open(String(id).startsWith('tab-') ? id : 'tab-' + id, document.querySelector('.cat-btn[aria-controls="' + (String(id).startsWith('tab-') ? id : 'tab-' + id) + '"]'));
  window.peekClose = close;
  window.peekState = () => ({ open: !!(wrap && !wrap.hidden), id: cur ? cur.id : null, mode: mode() });
  window.peekSetMode = m => { set(LS_MODE, m === 'center' ? 'center' : 'side'); applyMode(); };
})();
