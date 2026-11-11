// 全体リマーク・免責事項を、画面下に常時置く「引き出し（ボトムシート）」にする。
//   ・閉じているとき：画面最下部に細い取っ手バー（📝 全体リマーク・文字数・入力ありの点）だけ。
//   ・上へドラッグ／スワイプ（または押す）で開く。開いたあとはつまみをドラッグして高さを変えられる。
//     下へ引き下げる／取っ手を押す／Esc で閉じる。背景（見積もりテーブル）は開いたまま操作できる（モーダルにしない）。
//   ・中身は既存の #section-remark（入力欄・定型文タブ・画像添付）を要素ごと移すだけ（id・保存・出力は変えない）。
//   ・合計バー・保存ドック・🐞・付箋は、引き出しの高さ分だけ上へ持ち上げる（CSS 変数 --rms-lift）。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const KEY = 'quoteRemarkSheetH_v1';
  const BAR_H = 36;                    // 取っ手バーの高さ（px）
  const MIN_OPEN = 140;                // これより小さく引き下げたら閉じる
  let sheet = null, body = null, handle = null, open = false, bodyH = 0, storedH = 0;
  const SEEN_KEY = 'quoteRemarkSheetSeen_v1';   // 一度でも開いたら「存在に気づいた」とみなし、跳ねる合図を出さない
  const NUDGE_FIRST_MS = 1200;                   // 見積入力画面が出てから最初に跳ねるまで
  const NUDGE_REPEAT_MS = 45000;                 // 気づかれないときの再合図の間隔
  const NUDGE_MAX_REPEAT = 3;                    // 再合図の上限（初回のほか、ページを開いている間に最大 3 回）
  let nudgeTimer = null, nudgeRepeats = 0, wasVisible = false;

  const maxH = () => Math.max(MIN_OPEN + 40, Math.round((window.innerHeight || 800) * 0.85) - BAR_H);
  const defH = () => Math.round(Math.min(Math.max((window.innerHeight || 800) * 0.5 - BAR_H, 220), maxH()));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function loadH() {
    let v = 0;
    try { v = parseInt(localStorage.getItem(KEY), 10) || 0; } catch (e) {}
    storedH = clamp(v || defH(), MIN_OPEN, maxH());
  }
  function saveH() { try { localStorage.setItem(KEY, String(Math.round(storedH))); } catch (e) {} }

  // ---- 存在を知らせる「跳ねる」合図（Mac の Dock のアイコンのように、小さくなりながら数回跳ねる）----
  function seen() { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; } }
  function markSeen() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
    clearTimeout(nudgeTimer); nudgeTimer = null;
    if (sheet) sheet.classList.remove('is-nudging');
  }
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isVisible = () => !!sheet && sheet.getClientRects().length > 0;
  function typingNow() {
    const a = document.activeElement;
    return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable));
  }
  // 跳ねてよい状況か：閉じている・未入力・表示中・一度も開いていない・入力中／ドラッグ中ではない
  function canNudge() {
    return !!sheet && !open && isVisible() && !seen() && !reducedMotion()
      && !sheet.classList.contains('has-content') && !sheet.classList.contains('is-dragging') && !typingNow();
  }
  window.rmsNudge = function (force) {
    if (!sheet) return false;
    if (!force && !canNudge()) return false;
    const panel = sheet.querySelector('.rms-panel');
    sheet.classList.remove('is-nudging'); void panel.offsetWidth;      // 連続で呼んでも最初から再生
    sheet.classList.add('is-nudging');
    return true;
  };
  function scheduleNudge(ms) {
    clearTimeout(nudgeTimer);
    if (seen()) return;
    nudgeTimer = setTimeout(() => {
      nudgeTimer = null;
      if (seen()) return;
      // 入力中などで見送ったときは、数秒後にもう一度様子を見る（再合図の回数には数えない）
      if (!window.rmsNudge()) { if (isVisible() && !open && !sheet.classList.contains('has-content')) scheduleNudge(8000); return; }
      if (nudgeRepeats++ < NUDGE_MAX_REPEAT) scheduleNudge(NUDGE_REPEAT_MS);
    }, ms);
  }

  // 引き出しが画面に出ている高さ。ほかの固定要素が上に避けるための値（CSS 変数）
  function publishLift() {
    const root = document.documentElement;
    const vis = !!sheet && sheet.getClientRects().length > 0;   // 他のタブ・ダッシュボードでは出ていない
    // 開閉のアニメーション中でも、最終的な高さ（取っ手＋中身＋下の余白）を先に渡す（ほかの固定要素が一度に避けるように）
    const lift = vis ? Math.round(handle.getBoundingClientRect().height + bodyH + (parseFloat(getComputedStyle(sheet).paddingBottom) || 0) + 1) : 0;
    root.style.setProperty('--rms-lift', lift + 'px');
    document.body.classList.toggle('rms-open', !!(vis && open));
    if (typeof window.totFloatRefresh === 'function') window.totFloatRefresh();
    // 見積入力画面が出たとき（ダッシュボード・他のタブ・オーバーレイから戻ったとき）に、存在を知らせる
    if (vis && !wasVisible && !open) { nudgeRepeats = 0; scheduleNudge(NUDGE_FIRST_MS); }
    else if (!vis && wasVisible) { clearTimeout(nudgeTimer); nudgeTimer = null; if (sheet) sheet.classList.remove('is-nudging'); }
    wasVisible = vis;
  }

  function setH(h, animate) {
    bodyH = clamp(h, 0, maxH());
    sheet.classList.toggle('is-dragging', !animate);
    body.style.height = bodyH + 'px';
    publishLift();
  }
  function setOpen(v, h) {
    open = !!v;
    if (open) markSeen();
    if (open && h) storedH = clamp(h, MIN_OPEN, maxH());
    sheet.dataset.open = open ? '1' : '0';
    handle.setAttribute('aria-expanded', open ? 'true' : 'false');
    body.hidden = false;
    setH(open ? storedH : 0, true);
    if (!open) { const a = document.activeElement; if (a && body.contains(a)) a.blur(); }
    body.inert = !open;   // 閉じている間は中身にフォーカスが入らない
  }
  window.rmsOpen = function (focus) {
    if (!sheet) return;
    setOpen(true);
    if (focus) setTimeout(() => { const t = $('remarkTextarea'); if (t && !t.readOnly) t.focus({ preventScroll: true }); }, 260);
  };
  window.rmsClose = function () { if (sheet) setOpen(false); };
  window.rmsToggle = function () { open ? window.rmsClose() : window.rmsOpen(); };
  window.rmsIsOpen = () => open;

  // 閲覧モード（他メンバーの案件を閲覧中）：引き出しの中は読むだけ（開閉は可）。文章欄は readonly（スクロール・選択は可）、操作類は inert
  window.rmsApplyMode = function (viewOnly) {
    if (!body) return;
    body.dataset.viewOnly = viewOnly ? '1' : '';
    const ta = $('remarkTextarea'); if (ta) ta.readOnly = !!viewOnly;
    body.querySelectorAll('#remarkBody > *:not(#remarkTextarea), #section-remark > .section-desc').forEach(el => { el.inert = !!viewOnly; });
  };

  function updateMeta() {
    const m = $('rmsMeta'); if (!m) return;
    const ta = $('remarkTextarea'), n = ta ? ta.value.length : 0;
    const imgs = document.querySelectorAll('#remarkImgList .remark-img-item, #remarkImgList > *').length;
    m.innerHTML = (n || imgs) ? '<i class="rms-dot"></i>' + n + '文字' + (imgs ? '・画像' + imgs : '') : '<span class="rms-empty">未入力</span>';
    sheet.classList.toggle('has-content', !!(n || imgs));
  }

  // ---- ドラッグ（マウス・タッチ共通）----
  function bindDrag() {
    let sy = 0, sh = 0, moved = false, pid = null;
    handle.addEventListener('pointerdown', e => {
      if (e.button != null && e.button !== 0) return;
      pid = e.pointerId; sy = e.clientY; sh = bodyH; moved = false;
      try { handle.setPointerCapture(pid); } catch (er) {}
    });
    handle.addEventListener('pointermove', e => {
      if (pid == null || e.pointerId !== pid) return;
      const dy = sy - e.clientY;
      if (!moved && Math.abs(dy) < 6) return;
      moved = true;
      body.hidden = false; body.removeAttribute('inert');
      setH(sh + dy, false);
    });
    const end = e => {
      if (pid == null || e.pointerId !== pid) return;
      try { handle.releasePointerCapture(pid); } catch (er) {}
      pid = null;
      if (!moved) return;                                  // 動かさなかった＝クリック（click で開閉）
      handle._justDragged = true; setTimeout(() => { handle._justDragged = false; }, 0);
      if (bodyH < MIN_OPEN * 0.6 || (!open && bodyH < 40)) { setOpen(false); }
      else if (!open && bodyH < MIN_OPEN) { setOpen(true); }         // 少し引いただけでも開く（標準の高さ）
      else { open = true; storedH = clamp(bodyH, MIN_OPEN, maxH()); saveH(); setOpen(true, storedH); }
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('click', e => { if (handle._justDragged) { e.preventDefault(); return; } window.rmsToggle(); });
    handle.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp') { e.preventDefault(); window.rmsOpen(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); window.rmsClose(); }
    });
  }

  function build() {
    const tab = $('tab-quote-make'), sec = $('section-remark');
    if (!tab || !sec || $('rmSheet')) return false;
    sheet = document.createElement('div'); sheet.id = 'rmSheet'; sheet.className = 'rms'; sheet.dataset.open = '0';
    sheet.innerHTML =
      '<div class="rms-panel">' +
        '<button type="button" class="rms-handle" id="rmsHandle" aria-expanded="false" aria-controls="rmsBody" ' +
          'title="上へドラッグ（スワイプ）か押して開く。開いたらつまみをドラッグして高さを変えられます">' +
          '<span class="rms-grab" aria-hidden="true"></span>' +
          '<span class="rms-title">📝 全体リマーク・免責事項</span>' +
          '<span class="rms-meta" id="rmsMeta"></span>' +
          '<span class="rms-chev" aria-hidden="true">⌃</span>' +
        '</button>' +
        '<div class="rms-body" id="rmsBody" role="region" aria-label="全体リマーク・免責事項" hidden></div>' +
      '</div>';
    tab.appendChild(sheet);
    handle = $('rmsHandle'); body = $('rmsBody');
    body.appendChild(sec);                                   // セクションを要素ごと移す
    return true;
  }

  function init() {
    if (window.__rmsInit) return; if (!build()) return; window.__rmsInit = true;
    loadH(); bindDrag(); setOpen(false); updateMeta();
    sheet.addEventListener('animationend', e => { if (e.target === sheet.querySelector('.rms-panel')) sheet.classList.remove('is-nudging'); });
    // 入力欄に触れたら、その時点で「使い始めた」とみなす（リマークの入力が始まったら合図は不要）
    const ta0 = $('remarkTextarea'); if (ta0) ta0.addEventListener('focus', markSeen);
    // 文字数・画像の変化で取っ手の表示を更新
    const rc = $('remarkChar'); if (rc) new MutationObserver(updateMeta).observe(rc, { childList: true, characterData: true, subtree: true });
    const ta = $('remarkTextarea'); if (ta) ta.addEventListener('input', updateMeta);
    const il = $('remarkImgList'); if (il) new MutationObserver(updateMeta).observe(il, { childList: true, attributes: true, attributeFilter: ['hidden'] });
    // タブ・ダッシュボード⇄編集・オーバーレイの切り替え、画面サイズの変化で、持ち上げ量を取り直す
    const tab = $('tab-quote-make');
    new MutationObserver(publishLift).observe(tab, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(publishLift).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', () => { storedH = clamp(storedH, MIN_OPEN, maxH()); if (open) setH(storedH, true); else publishLift(); });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !open) return;
      if (sheet.contains(document.activeElement) || document.activeElement === document.body) { window.rmsClose(); handle.focus({ preventScroll: true }); }
    });
    if (tab.classList.contains('qmode-view')) window.rmsApplyMode(true);
    publishLift();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
  window.rmsRefresh = updateMeta;
})();
