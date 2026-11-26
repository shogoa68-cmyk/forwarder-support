/* ==========================================================================
   Design 42-4（2026-11）：スマホ（〜600px）の通知（トースト）は画面の上の 1 か所
   ・ヘッダーのすぐ下（ヘッダーが画面外ならいちばん上）・左右 12px・角丸 8px
   ・同時に出すのは 2 つまで（新しいものが上）・4 秒で消える・押すと消える
   既存の quoteShowToast（#toast-container）はそのまま使い、並びと消え方だけ整える。PC は変えない。
   ========================================================================== */
(function () {
  'use strict';
  const mq = window.matchMedia('(max-width: 600px)');
  const MAX = 2, LIFE = 4000;
  function place(c) {
    const h = document.querySelector('.app > .header, body .header');
    const nav = document.querySelector('.cat-nav');   // ヘッダーの下の上段ナビにも重ねない
    const b = Math.max(h ? h.getBoundingClientRect().bottom : 0, nav ? nav.getBoundingClientRect().bottom : 0);
    c.style.setProperty('--toast-top', Math.max(8, Math.round(b) + 8) + 'px');
  }
  function bye(el) { if (!el || el.__bye) return; el.__bye = 1; el.classList.remove('visible'); setTimeout(() => el.remove(), 320); }
  function tidy(c) {
    const live = [...c.querySelectorAll(':scope > .toast')].filter(t => !t.__bye);
    while (live.length > MAX) bye(live.shift());   // 古いものから消す
  }
  function init() {
    const c = document.getElementById('toast-container');
    if (!c || c.__phone) return;
    c.__phone = 1;
    new MutationObserver(ms => {
      if (!mq.matches) return;
      place(c);
      ms.forEach(m => m.addedNodes.forEach(n => {
        if (!n.classList || !n.classList.contains('toast')) return;
        setTimeout(() => bye(n), LIFE);
      }));
      tidy(c);
    }).observe(c, { childList: true });
    c.addEventListener('click', e => {
      if (!mq.matches) return;
      if (e.target.closest('.toast-action')) return;   // 「元に戻す」などは押せる
      const t = e.target.closest('.toast'); if (t) bye(t);
    });
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
