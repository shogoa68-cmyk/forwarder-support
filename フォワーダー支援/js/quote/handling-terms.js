// ================================================================
//  荷役条件（船積条件・Liner terms）：RO/RO・在来船の運賃見積で使う BTBT／FILO／LIFO／FIOS／FIOST
//  インコタームズ（売主・買主のリスク・費用の分担）とは別物で、荷主と船社の間の「積み・揚げの荷役費を誰が持つか」。
//  実務ではインコタームズ（FOB など）と併記するため、インコタームズの選択肢には混ぜず、別の選択欄 #cond-handling に持つ。
//  ・欄はRO/RO・在来船のときだけ出す（値が入っているときは、輸送モードを変えても隠さない）
//  ・選ぶと欄の下に日本語の説明を 1 行出す
//  ・保存は #cond-handling の値のまま（フォーム値として案件データに入る）。出力は getConditions().handling
//  window.htSync()（表示の更新）／window.handlingHint(値)（説明文）
// ================================================================
(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  // コード → 日本語の説明（一般的な理解。実際の取り決めは船社の運送条件・契約による）
  const TERMS = {
    BTBT:  '積み・揚げの荷役費はともに船社負担（運賃に含まれる）。ライナー・ターム（Liner Terms）とも呼ぶ。',
    FILO:  '積みの荷役費は荷主負担（Free In）、揚げは船社負担（Liner Out）。',
    LIFO:  '積みは船社負担（Liner In）、揚げの荷役費は荷受人側の負担（Free Out）。',
    FIOS:  '積み・揚げの荷役費はともに荷主／荷受人側の負担（Free In Out）。船倉内の積み付け（Stowed）の費用も荷主側。',
    FIOST: 'FIOS に加えて、荷均し（Trimmed）の費用も荷主側の負担。主にバラ積み貨物で使う。',
  };

  const codeOf = v => String(v || '').split(/[（(]/)[0].trim().toUpperCase();
  const isHandlingMode = m => /RORO|在来船/.test(String(m || ''));

  window.handlingHint = v => TERMS[codeOf(v)] || '';

  function sync() {
    const sel = $('cond-handling'), grp = $('handlingGroup'), hint = $('cond-handling-hint');
    if (!sel || !grp) return;
    const mode = $('cond-mode')?.value || '';
    // RO/RO・在来船のとき、または値が入っているとき（入力済みの値を気づかないまま隠さない）
    const show = isHandlingMode(mode) || !!sel.value;
    grp.hidden = !show;
    if (hint) {
      const t = show ? (TERMS[codeOf(sel.value)] || '') : '';
      hint.textContent = t; hint.style.display = t ? 'inline-block' : 'none';   // CSS は display:none なので、表示するときは明示する
    }
  }
  window.htSync = sync;
  window.showHandlingHint = sync;   // index.html の onchange から

  function init() {
    const sel = $('cond-handling'); if (!sel || sel.dataset.htInit) return; sel.dataset.htInit = '1';
    sel.addEventListener('change', sync);
    $('cond-mode')?.addEventListener('change', sync);
    // 輸送モードのボタン（setTransport は #cond-mode の値を直接書き換えるため、ボタンの状態変化で追従）
    const btns = $('seaAirBtns');
    if (btns) new MutationObserver(sync).observe(btns, { attributes: true, subtree: true, attributeFilter: ['class'] });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();
