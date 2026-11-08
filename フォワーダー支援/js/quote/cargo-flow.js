// 貨物情報（Design 回答 2026-11・案2）：貨物名の右隣に「⚠️ 危険品・特殊貨物」、HS コードの右隣に「％ 関税率」「📚 関連知識・他法令」「WEBタリフ ↗」。
// 押すと下に詳細が開く。冷蔵・冷凍は「温度管理」にまとめ、中で冷蔵／冷凍を切り替える（保存値は「温度管理品（冷蔵）／（冷凍）」のまま）。
// 入力欄・id・onclick・保存値は変えない（要素を移して表示を切り替えるだけ）。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const COLD = ['温度管理品（冷蔵）', '温度管理品（冷凍）'];
  let sync = () => {}, reset = () => {};
  function btn(id, text) { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'cg-opt'; b.setAttribute('aria-expanded', 'false'); b.innerHTML = text; return b; }
  function init() {
    const grid = $('cargoCondGrid'); if (!grid || grid.dataset.cgInit) return;
    const nameF = grid.querySelector('[data-field-id="cargo"]'), hsF = grid.querySelector('[data-field-id="hs"]');
    const kindSub = $('cargoKindSub'), lawSub = $('cargoLawSub'), rate = document.querySelector('#section-cargo .cond-rate-card');
    const nameIn = $('cond-cargo'), hsIn = $('cond-hs'), sel = $('cond-hazmat'), detail = $('hazmatDetail'), chips = $('hazChips');
    if (!nameF || !hsF || !kindSub || !lawSub || !rate || !nameIn || !hsIn || !sel) return;
    grid.dataset.cgInit = '1'; grid.classList.add('cg-flow');
    // 行：入力欄＋オプションのボタン
    const nameRow = document.createElement('div'); nameRow.className = 'cg-row'; nameIn.before(nameRow); nameRow.appendChild(nameIn);
    const hsRow = document.createElement('div'); hsRow.className = 'cg-row'; hsIn.before(hsRow); hsRow.appendChild(hsIn);
    const kindBtn = btn('cargoKindBtn', ''); nameRow.appendChild(kindBtn);
    const taxBtn = btn('cargoTaxBtn', '％ 関税率 <span class="cg-arrow">▾</span>'); hsRow.appendChild(taxBtn);
    const lawBtn = btn('cargoLawBtn', '📚 関連知識・他法令 <span class="cg-badge">11</span> <span class="cg-arrow">▾</span>'); hsRow.appendChild(lawBtn);
    const tariff = hsF.querySelector('.hs-tariff-link'); if (tariff) { tariff.classList.add('cg-opt', 'cg-link'); hsRow.appendChild(tariff); }
    // 詳細の入れ場所：貨物名の下に危険品・特殊貨物、HS の下に関税率・他法令
    // （フィールドは輸送モードで並び順が変わるため、詳細はそれぞれのフィールドの中に置く）
    nameF.appendChild(kindSub); hsF.appendChild(rate); hsF.appendChild(lawSub);
    kindSub.hidden = true; rate.hidden = true; lawSub.hidden = true;
    kindSub.classList.add('cg-panel'); rate.classList.add('cg-panel'); lawSub.classList.add('cg-panel');
    // 温度管理：冷蔵・冷凍の 2 チップを 1 つにまとめ、中で切り替える
    let lastCold = COLD[0];
    const tempChip = document.createElement('button'); tempChip.type = 'button'; tempChip.className = 'haz-chip'; tempChip.id = 'hazTempChip'; tempChip.dataset.tone = 'cold'; tempChip.setAttribute('role', 'radio');
    tempChip.innerHTML = '<span class="haz-dot"></span>温度管理（冷蔵・冷凍）';
    tempChip.addEventListener('click', () => window.setHazmatChip(lastCold));
    const heavyChip = chips && chips.querySelector('[data-haz-value="重量物・大型貨物"]'); if (chips) chips.insertBefore(tempChip, heavyChip || null);
    const tsw = document.createElement('div'); tsw.className = 'cg-temp-switch'; tsw.id = 'hazTempSwitch'; tsw.setAttribute('role', 'group'); tsw.setAttribute('aria-label', '冷蔵か冷凍か'); tsw.hidden = true;
    tsw.innerHTML = '<b>🌡️ 温度管理</b><span class="cg-seg"><button type="button" data-cold="温度管理品（冷蔵）">冷蔵</button><button type="button" data-cold="温度管理品（冷凍）">冷凍</button></span><small>保存値は「温度管理品（冷蔵）」「温度管理品（冷凍）」のまま</small>';
    if (detail) detail.prepend(tsw);
    tsw.addEventListener('click', e => { const b = e.target.closest('button[data-cold]'); if (b) window.setHazmatChip(b.dataset.cold); });

    const st = { kind: null, tax: null, law: false };   // null＝自動（値があれば開く）／true・false＝ユーザーが開閉した
    const kindText = v => v === '危険品あり（クラス要確認）' ? '危険品' : COLD.includes(v) ? '温度管理（' + v.replace(/^.*（|）$/g, '') + '）' : v === '重量物・大型貨物' ? '重量物' : v === 'その他（特記事項参照）' ? 'その他' : '';
    sync = function () {
      const v = sel.value, kt = kindText(v), isCold = COLD.includes(v);
      if (isCold) lastCold = v;
      const kindOpen = st.kind === null ? !!kt : st.kind;
      kindSub.hidden = !kindOpen;
      kindBtn.innerHTML = '⚠️ 危険品・特殊貨物' + (kt ? '：' + kt : '') + ' <span class="cg-arrow">' + (kindOpen ? '▴' : '▾') + '</span>';
      kindBtn.setAttribute('aria-expanded', kindOpen ? 'true' : 'false');
      kindBtn.classList.toggle('has-haz', v === '危険品あり（クラス要確認）'); kindBtn.classList.toggle('has-kind', !!kt);
      tempChip.classList.toggle('is-on', isCold); tempChip.setAttribute('aria-checked', isCold ? 'true' : 'false');
      tsw.hidden = !isCold;
      tsw.querySelectorAll('button[data-cold]').forEach(b => { const on = b.dataset.cold === v; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      const taxHas = !!['cond-hs-basic', 'cond-hs-pref', 'cond-hs-pref-note'].some(i => ($(i)?.value || '').trim());
      const taxOpen = st.tax === null ? taxHas : st.tax; rate.hidden = !taxOpen;
      taxBtn.setAttribute('aria-expanded', taxOpen ? 'true' : 'false'); taxBtn.classList.toggle('has-kind', taxHas);
      taxBtn.innerHTML = '％ 関税率 <span class="cg-arrow">' + (taxOpen ? '▴' : '▾') + '</span>';
      lawSub.hidden = !st.law; lawBtn.setAttribute('aria-expanded', st.law ? 'true' : 'false');
      lawBtn.innerHTML = '📚 関連知識・他法令 <span class="cg-badge">11</span> <span class="cg-arrow">' + (st.law ? '▴' : '▾') + '</span>';
    };
    reset = () => { st.kind = st.tax = null; st.law = false; };
    kindBtn.addEventListener('click', () => { st.kind = kindSub.hidden; sync(); });
    taxBtn.addEventListener('click', () => { st.tax = rate.hidden; sync(); });
    lawBtn.addEventListener('click', () => { st.law = lawSub.hidden; sync(); });
    sel.addEventListener('change', () => setTimeout(sync, 0));
    ['cond-hs-basic', 'cond-hs-pref', 'cond-hs-pref-note'].forEach(i => $(i)?.addEventListener('input', () => setTimeout(sync, 0)));
    sync();
  }
  window.cgSync = () => { reset(); sync(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();
