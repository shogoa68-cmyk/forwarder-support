// 管理番号入力（Design 回答 2026-11）の動き：ステータス「その他 ▾」・関連番号／提出期限／タグ等の折りたたみ・
// 有効期限の「変更 ▾」と標準（発行月末）・新規案件の初期値（依頼受信日＝今日、有効期限＝発行月末）。
// 入力欄の id・onclick・保存形式は変えない（隠すだけ）。既存案件を開いたときは保存値のまま（初期値は新規のみ）。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const ymd = d => d.toLocaleDateString('sv', { timeZone: 'Asia/Tokyo' });
  const today = () => ymd(new Date());
  const eom = (base, plus) => { // base: 'YYYY-MM-DD'（空なら今日）。plus ヶ月後の月末
    const s = base || today(); const [y, m] = s.split('-').map(Number);
    return ymd(new Date(Date.UTC(y, m - 1 + plus + 1, 0, 3)));
  };
  const changed = el => { if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
  const MORE_STATUS = ['改定中', '情報待ち', 'ヨコヨコ提示', '受注', '失注', '辞退', '保留'];

  function setOpen(btn, panel, open) {
    if (!btn || !panel) return;
    panel.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function relCount() { try { const a = JSON.parse($('qf-related-data')?.value || '[]'); return Array.isArray(a) ? a.length : 0; } catch (e) { return 0; } }
  function tagCount() { try { const a = JSON.parse($('qf-tags-data')?.value || '[]'); return Array.isArray(a) ? a.length : 0; } catch (e) { return 0; } }

  function syncStatus() {
    const wrap = $('qf-status-btns'); if (!wrap) return;
    const cur = $('qf-status')?.value || '下書き中';
    const isMore = MORE_STATUS.includes(cur);
    const open = wrap.classList.contains('ci-more-open') || isMore;
    wrap.classList.toggle('ci-more-open', open);
    const b = $('ciStatusMore'); if (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); b.textContent = open ? 'その他 ▴' : 'その他 ▾'; }
  }
  function syncValid() {
    const el = $('qf-valid-until'); if (!el) return;
    const badge = $('ciValidBadge'), hint = $('ciValidHint');
    const issue = $('qf-date')?.value || '';
    const std = eom(issue, 0);
    const isStd = el.type === 'date' && el.value && el.value === std;
    if (badge) { badge.hidden = false; badge.textContent = el.type === 'text' ? 'SPOT' : (isStd ? '標準' : (el.value ? '変更済み' : '未設定')); badge.classList.toggle('is-std', !!isStd); }
    if (hint) hint.textContent = el.type === 'text' ? '日付の代わりに文字で表記します（御見積書にそのまま出ます）' : (isStd ? '発行日の属する月の末日（標準）' : (el.value ? '標準（発行日の月末）から変更しています' : ''));
  }
  function syncDates() {
    const d = $('qf-date'); const h = $('ciDateHint');
    if (h) h.textContent = '';
    const due = $('qf-due'); const dueBtn = $('ciDueBtn'), duePanel = $('ciDuePanel');
    if (due && due.value && duePanel && duePanel.hidden) setOpen(dueBtn, duePanel, true);
    if (dueBtn) dueBtn.hidden = !duePanel.hidden;
    syncValid();
  }
  function syncRel() {
    const n = relCount(); const chip = $('ciRelCount');
    if (chip) { chip.hidden = n === 0; chip.textContent = n + '件'; }
    if (n > 0 && $('ciRelPanel')?.hidden) setOpen($('ciRelBtn'), $('ciRelPanel'), true);
  }
  function syncMore() {
    const parts = [];
    const t = tagCount(); if (t) parts.push('タグ' + t);
    if ($('qf-core-ref')?.value.trim()) parts.push('REF#');
    if ($('qf-refurl')?.value.trim()) parts.push('URL');
    const att = document.querySelectorAll('#qfAttachList .qf-attach-item').length; if (att) parts.push('添付' + att);
    const chip = $('ciMoreSum'); if (chip) { chip.hidden = !parts.length; chip.textContent = parts.join('・'); }
    if (parts.length && $('ciMoreBody')?.hidden && !$('ciMore')?.dataset.userClosed) toggleMore(true);
  }
  function toggleMore(open) {
    const b = $('ciMoreBtn'), body = $('ciMoreBody'); if (!b || !body) return;
    body.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false');
    const a = b.querySelector('.ci-fold-arrow'); if (a) a.textContent = open ? '▾' : '▸';
  }
  // スマホ：日付を 1 行の要約に畳む（Design 回答）。PC 幅では要約を出さない
  const mq = window.matchMedia ? window.matchMedia('(max-width: 680px)') : null;
  let datesOpen = false;
  function md(s) { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(s || ''); return m ? m[1] + '/' + m[2] : (s || '—'); }
  function syncDatesSum() {
    const blk = document.querySelector('#section-ref .ci-dates'), b = $('ciDatesSum'); if (!blk || !b) return;
    const mobile = !!(mq && mq.matches);
    const collapsed = mobile && !datesOpen;
    blk.classList.toggle('ci-collapsed', collapsed);
    b.hidden = !mobile; b.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    const v = $('qf-valid-until'), badge = $('ciValidBadge');
    const vt = v ? (v.type === 'text' ? (v.value || 'SPOT') : md(v.value)) : '—';
    b.textContent = '発行 ' + md($('qf-date')?.value) + '・有効期限 ' + vt + (badge && badge.textContent ? '（' + badge.textContent + '）' : '') + (collapsed ? '　［変更］' : '　［閉じる］');
  }
  // 右下の付箋ボタンは隠せる（✕／「⋯」メニュー）。隠しても付箋は「⋯」メニューから開ける
  const FAB_KEY = 'fwd.memoFabHidden';
  function fabHidden() { try { return localStorage.getItem(FAB_KEY) === '1'; } catch (e) { return false; } }
  function applyFab() {
    const off = fabHidden(); document.body.classList.toggle('memo-fab-off', off);
    const s = $('qfMemoFabMenuSub'); if (s) s.textContent = off ? 'いまは隠れています（押すと表示）' : 'いまは表示中（押すと隠す）';
  }
  window.ciToggleMemoFab = function () { try { localStorage.setItem(FAB_KEY, fabHidden() ? '0' : '1'); } catch (e) {} applyFab(); };
  function syncMemoDot() {
    const has = !!($('qf-memo')?.value || '').trim();
    ['qfMemoFab', 'ciMemoBtn'].forEach(id => { const f = $(id); if (f) f.classList.toggle('has-memo', has); });
    const fl = $('qfMemoFloat'); const b = $('ciMemoBtn'); if (b) { const open = !!fl && !fl.hidden; b.classList.toggle('is-open', open); b.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  }
  // 案件名欄の「📝 社内メモ」：付箋を開く／閉じる。開くときは、まだ動かしていなければボタンの近くに出す
  window.ciToggleMemo = function (e) {
    if (e) e.preventDefault();
    const fl = $('qfMemoFloat'), btn = $('ciMemoBtn'); if (!fl || typeof window.toggleMemoFloat !== 'function') return;
    const wasHidden = fl.hasAttribute('hidden'); window.toggleMemoFloat();
    if (wasHidden && btn && !fl.dataset.placed) {
      const r = btn.getBoundingClientRect(), w = fl.offsetWidth || 360, h = fl.offsetHeight || 240;
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)), top = Math.max(8, Math.min(window.innerHeight - h - 8, r.bottom + 6));
      fl.style.left = left + 'px'; fl.style.top = top + 'px'; fl.style.right = 'auto'; fl.style.bottom = 'auto'; fl.dataset.placed = '1';
    }
    setTimeout(syncMemoDot, 0);
  };
  function sync() { syncStatus(); syncRel(); syncDates(); syncMore(); syncDatesSum(); syncMemoDot(); }

  window.ciSync = sync;
  window.ciSetValidEom = function (plus) {
    const el = $('qf-valid-until'); if (!el) return;
    if (el.type === 'text' && typeof window.toggleValidUntilSpot === 'function') window.toggleValidUntilSpot();
    el.value = eom($('qf-date')?.value || '', plus); changed(el); closeMenu(); syncValid();
  };
  function closeMenu() { const m = $('ciValidMenu'); if (m) m.hidden = true; $('ciValidChange')?.setAttribute('aria-expanded', 'false'); }

  // 新規案件の初期値（既存案件は触らない）
  window.ciApplyNewCaseDefaults = function () {
    const r = $('qf-received'), d = $('qf-date'), v = $('qf-valid-until');
    if (r && !r.value) { r.value = today(); changed(r); $('ciAutoRecv') && ($('ciAutoRecv').hidden = false); }
    if (d && !d.value) { d.value = today(); changed(d); $('ciAutoDate') && ($('ciAutoDate').hidden = false); }
    if (v && v.type === 'date' && !v.value) { v.value = eom(d?.value || '', 0); changed(v); }
    sync();
    if (window.cfSync) window.cfSync(); if (window.rfSync) window.rfSync();
  };

  function init() {
    if (!$('ciStatusMore') || window.__ciInit) return; window.__ciInit = true;
    $('ciStatusMore').addEventListener('click', () => { $('qf-status-btns').classList.toggle('ci-more-open'); const w = $('qf-status-btns'); if (!w.classList.contains('ci-more-open') && MORE_STATUS.includes($('qf-status')?.value)) w.classList.add('ci-more-open'); syncStatus(); });
    $('ciRelBtn').addEventListener('click', () => { const p = $('ciRelPanel'); setOpen($('ciRelBtn'), p, p.hidden); if (!p.hidden) $('qfRelInput')?.focus(); });
    $('ciDueBtn').addEventListener('click', () => { setOpen($('ciDueBtn'), $('ciDuePanel'), true); $('ciDueBtn').hidden = true; $('qf-due')?.focus(); });
    $('ciDueRemove').addEventListener('click', () => { const due = $('qf-due'); if (due) { due.value = ''; changed(due); } setOpen($('ciDueBtn'), $('ciDuePanel'), false); $('ciDueBtn').hidden = false; });
    $('ciValidChange').addEventListener('click', e => { e.stopPropagation(); const m = $('ciValidMenu'); m.hidden = !m.hidden; $('ciValidChange').setAttribute('aria-expanded', m.hidden ? 'false' : 'true'); });
    document.addEventListener('click', e => { if (!e.target.closest('#ciValidMenu,#ciValidChange')) closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
    $('qfSpotToggleBtn')?.addEventListener('click', () => { closeMenu(); setTimeout(syncValid, 0); });
    $('ciMoreBtn').addEventListener('click', () => { const open = $('ciMoreBody').hidden; if ($('ciMore')) $('ciMore').dataset.userClosed = open ? '' : '1'; toggleMore(open); });
    const fx = document.querySelector('#qfMemoFab .qmf-x');
    const hideFab = e => { e.preventDefault(); e.stopPropagation(); try { localStorage.setItem(FAB_KEY, '1'); } catch (er) {} applyFab(); if (window.quoteShowToast) window.quoteShowToast('付箋ボタンを隠しました（「⋯」メニューからいつでも開けます）', 'info', 4000); };
    if (fx) { fx.addEventListener('click', hideFab); fx.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') hideFab(e); }); }
    applyFab();
    $('ciDatesSum')?.addEventListener('click', () => { datesOpen = !datesOpen; syncDatesSum(); });
    if (mq && mq.addEventListener) mq.addEventListener('change', syncDatesSum);
    // 「自動」バッジ：ユーザーが値を変えたら消す（プログラムの入力では消さない）
    [['qf-received', 'ciAutoRecv'], ['qf-date', 'ciAutoDate']].forEach(([i, b]) => $(i)?.addEventListener('input', e => { if (e.isTrusted && $(b)) $(b).hidden = true; }));
    { const fl = $('qfMemoFloat'); if (fl) new MutationObserver(syncMemoDot).observe(fl, { attributes: true, attributeFilter: ['hidden'] }); }
    $('qf-memo')?.addEventListener('input', syncMemoDot); $('qf-memo-float-ta')?.addEventListener('input', () => setTimeout(syncMemoDot, 0));
    const sec = $('section-ref');
    ['input', 'change', 'click'].forEach(t => sec.addEventListener(t, () => setTimeout(sync, 0)));
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();
