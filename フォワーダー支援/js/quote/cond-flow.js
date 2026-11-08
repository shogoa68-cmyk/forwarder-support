// 貿易条件・輸送モード（Design 回答 2026-11・案2）：選んだ項目は 1 行の要約にし、いま入れる項目だけを開く。
// 順序：インコタームズ → 方向 → 輸送モード。保険付保は任意（「＋ 保険付保」）。
// 入力欄・ボタン・id・onclick・保存値は変えない（表示を切り替えるだけ）。読み込み・コピーで値が入っても観察して追従する。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let sync = () => {}; let reset = () => {};
  function init() {
    const bar = document.querySelector('#section-cond .cond-primary-bar');
    if (!bar || bar.dataset.cfInit) return; bar.dataset.cfInit = '1';
    const groups = [...bar.querySelectorAll(':scope > .cond-prim-group')];
    const gInco = $('cond-incoterms')?.closest('.cond-prim-group');
    const gDir = $('dirBtns')?.closest('.cond-prim-group');
    const gMode = $('seaAirBtns')?.closest('.cond-prim-group');
    const gOpt = groups.find(g => g.querySelector('#insToggleBtn'));
    if (!gInco || !gDir || !gMode) return;
    gInco.dataset.cf = 'inco'; gDir.dataset.cf = 'dir'; gMode.dataset.cf = 'mode'; if (gOpt) gOpt.dataset.cf = 'opt';
    bar.classList.add('cf-flow');
    const crumbs = document.createElement('div');
    crumbs.className = 'cf-crumbs'; crumbs.id = 'cfCrumbs'; crumbs.setAttribute('aria-label', '選んだ内容');
    bar.parentNode.insertBefore(crumbs, bar);
    const edit = { inco: false, dir: false, mode: false, opt: false };

    const incoVal = () => { const v = $('cond-incoterms')?.value || ''; return v; };
    const incoText = () => { const s = $('cond-incoterms'); const o = s && s.selectedOptions[0]; return o && s.value ? o.textContent.trim().replace(/（.*$/, '') || o.textContent.trim() : ''; };
    const dirBtn = () => bar.querySelector('#dirBtns .cond-prim-btn.active');
    const modeBtn = () => bar.querySelector('#seaAirBtns .cond-prim-btn.active');
    const dirVal = () => ($('cond-direction')?.value || (dirBtn() ? dirBtn().dataset.dir : ''));
    const modeVal = () => ($('cond-mode')?.value || (modeBtn() ? 'x' : ''));
    const txt = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    const insOn = () => $('cond-insurance-on')?.value === 'true' || /ON/.test($('insToggleBtn')?.textContent || '') && !/OFF/.test($('insToggleBtn')?.textContent || '');

    sync = function () {
      const iD = !!incoVal(), dD = !!dirVal(), mD = !!modeVal();
      const show = {
        inco: !iD || edit.inco,
        dir: (iD || dD) && (!dD || edit.dir),
        mode: (dD || mD) && (!mD || edit.mode),
        opt: insOn() || edit.opt,
      };
      gInco.classList.toggle('cf-hide', !show.inco);
      gDir.classList.toggle('cf-hide', !show.dir);
      gMode.classList.toggle('cf-hide', !show.mode);
      if (gOpt) gOpt.classList.toggle('cf-hide', !show.opt);
      const items = [];
      if (iD && !show.inco) items.push(['inco', 'インコタームズ', incoVal() === '設定なし' ? '設定なし' : incoText()]);
      if (dD && !show.dir) items.push(['dir', '方向', txt(dirBtn())]);
      if (mD && !show.mode) items.push(['mode', '輸送モード', modeBtn() ? txt(modeBtn()) : ($('cond-mode')?.value || '')]);
      crumbs.innerHTML = '';
      items.forEach(([k, lbl, v], i) => {
        if (i) { const a = document.createElement('span'); a.className = 'cf-arrow'; a.textContent = '→'; a.setAttribute('aria-hidden', 'true'); crumbs.appendChild(a); }
        const b = document.createElement('button'); b.type = 'button'; b.className = 'cf-crumb'; b.dataset.cf = k;
        b.title = lbl + 'を選び直す'; b.innerHTML = '<small>' + lbl + '</small><b></b><i aria-hidden="true">✎</i>'; b.querySelector('b').textContent = v;
        b.addEventListener('click', () => { edit[k] = true; sync(); const f = ({ inco: gInco, dir: gDir, mode: gMode })[k].querySelector('select,button'); f && f.focus(); });
        crumbs.appendChild(b);
      });
      if (gOpt && !show.opt) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'cf-opt'; b.textContent = '＋ 保険付保（任意）';
        b.addEventListener('click', () => { edit.opt = true; sync(); });
        crumbs.appendChild(b);
      }
      crumbs.hidden = !crumbs.children.length;
      const hint = $('cond-incoterms-hint'); if (hint) hint.classList.toggle('cf-hint-top', !iD);
    };
    reset = () => { edit.inco = edit.dir = edit.mode = edit.opt = false; };
    // 選んだら要約へ戻す（選び直しの途中は開いたまま）
    gInco.addEventListener('change', () => { edit.inco = false; setTimeout(sync, 0); });
    gDir.addEventListener('click', e => { if (e.target.closest('.cond-prim-btn')) { edit.dir = false; setTimeout(sync, 0); } });
    gMode.addEventListener('click', e => { if (e.target.closest('.cond-prim-btn')) { edit.mode = false; setTimeout(sync, 0); } });
    const mo = new MutationObserver(() => sync());
    ['dirBtns', 'seaAirBtns'].forEach(id => { const el = $(id); el && mo.observe(el, { attributes: true, subtree: true, attributeFilter: ['class'] }); });
    const ins = $('insToggleBtn'); if (ins) mo.observe(ins, { childList: true, characterData: true, subtree: true, attributes: true });
    ['cond-incoterms', 'cond-mode'].forEach(id => $(id)?.addEventListener('change', () => setTimeout(sync, 0)));
    sync();
  }
  // 読み込み・新規作成のあとに呼ぶ：手で開いた状態をやめる
  window.cfSync = () => { reset(); sync(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();
