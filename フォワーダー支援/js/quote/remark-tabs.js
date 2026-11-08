// 全体リマーク・免責事項（Design 回答 2026-11・案1）：定型文を内容ごとのタブで分ける（定型文／区切り線／チーム人気／チーム共有／個人。品物別は区分を選んだときだけ）。
// 定型文のボタンは ui.js の renderRemarkPresets() が作る（id・onclick・保存値は変えない）。ここでは作られたボタンにグループ印を付け、タブで出し分けるだけ。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const TABS = [['cargo', '品物別'], ['preset', '定型文'], ['line', '区切り線'], ['popular', 'チーム人気 ⭐'], ['shared', 'チーム共有 ☁️'], ['personal', '個人']];
  let active = 'preset', hadCargo = false, busy = false, wrap = null, bar = null;

  function groupOf(label) {
    if (/品物別リマーク/.test(label)) return 'cargo';
    if (/^区切り線/.test(label)) return 'line';
    if (/^チーム人気/.test(label)) return 'popular';
    if (/^チーム共有/.test(label)) return 'shared';
    if (/^個人/.test(label)) return 'personal';
    return 'preset';
  }
  function organize() {
    if (!wrap || busy) return; busy = true;
    try {
      const kids = [...wrap.children]; const counts = {}; TABS.forEach(t => counts[t[0]] = 0);
      let cur = 'preset', inCargo = false;
      kids.forEach(k => {
        if (k.classList.contains('preset-tier-label')) { cur = groupOf(k.textContent.trim()); inCargo = cur === 'cargo'; k.dataset.rt = cur; k.classList.add('rt-label'); return; }
        k.dataset.rt = cur;
        if (!k.classList.contains('preset-btn-add')) counts[cur]++;
        if (inCargo && k.classList.contains('preset-btn-add')) { inCargo = false; cur = 'preset'; }   // 品物別の「＋追加」まで。続く標準の定型文は「定型文」へ
      });
      const hasCargo = kids.some(k => k.dataset.rt === 'cargo');
      if (hasCargo && !hadCargo) active = 'cargo';
      if (!hasCargo && active === 'cargo') active = 'preset';
      hadCargo = hasCargo;
      bar.innerHTML = '';
      TABS.forEach(([key, label]) => {
        if (key === 'cargo' && !hasCargo) return;
        const b = document.createElement('button'); b.type = 'button'; b.className = 'rm-tab' + (active === key ? ' is-on' : ''); b.dataset.rt = key;
        b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', active === key ? 'true' : 'false');
        b.innerHTML = label + ' <span class="rm-count">' + counts[key] + '</span>';
        b.addEventListener('click', () => { active = key; apply(); });
        bar.appendChild(b);
      });
      apply();
    } finally { busy = false; }
  }
  function apply() {
    if (!wrap) return;
    [...wrap.children].forEach(k => k.classList.toggle('rt-on', k.dataset.rt === active && !k.classList.contains('rt-label')));
    bar.querySelectorAll('.rm-tab').forEach(b => { const on = b.dataset.rt === active; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  }
  function init() {
    wrap = $('presetBtns'); if (!wrap || wrap.dataset.rtInit) return; wrap.dataset.rtInit = '1';
    bar = document.createElement('div'); bar.id = 'remarkTabs'; bar.className = 'rm-tabs'; bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', '定型文の種類');
    wrap.before(bar); wrap.classList.add('rm-tabbed');
    new MutationObserver(() => organize()).observe(wrap, { childList: true });
    organize();
  }
  window.rtRefresh = () => organize();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();
