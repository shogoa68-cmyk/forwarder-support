// ================================================================
//  行 選択モード
//  いずれかの行の選択チェック（.row-select-chk）が ON のあいだは
//  「選択モード」になり、行のどこをクリックしても選択を ON/OFF できる。
//  全チェックが外れると通常モード（セル編集）に戻る。
//  document へのイベント委譲で動的行にも対応。見積タブ内のみ動作。
// ================================================================
(function () {
  'use strict';

  function tbody() { return document.getElementById('tableBody'); }

  // 選択モード判定：チェック済みの行が1つでもあれば ON
  function isActive() {
    const tb = tbody();
    return !!tb && tb.querySelectorAll('.row-select-chk:checked').length > 0;
  }

  function refresh() {
    const tb = tbody();
    if (!tb) return;
    tb.classList.toggle('selection-mode', isActive());
  }

  // クリック対象が「選択トグルの対象外」(操作ボタン・ドラッグハンドル・チェック自身)か
  function isExempt(target) {
    return !!(target.closest('.btn-del, .btn-add, .btn-subtotal, .btn-remark-ins, .drag-handle')
           || (target.classList && target.classList.contains('row-select-chk')));
  }

  function rowCheckbox(target) {
    const tr = target.closest('#tableBody tr');
    if (!tr) return null;
    return tr.querySelector('.row-select-chk'); // 小計/リマーク行には無い → null
  }

  // mousedown を先取りして、選択モード中は入力欄へのフォーカス／select展開を抑止
  document.addEventListener('mousedown', function (e) {
    if (!isActive()) return;
    if (isExempt(e.target)) return;
    if (!rowCheckbox(e.target)) return;
    e.preventDefault();
  }, true);

  // click で選択を ON/OFF
  document.addEventListener('click', function (e) {
    if (!isActive()) return;
    if (isExempt(e.target)) return;
    const chk = rowCheckbox(e.target);
    if (!chk) return;
    e.preventDefault();
    chk.checked = !chk.checked;
    chk.dispatchEvent(new Event('change', { bubbles: true }));
  }, true);

  // チェック状態の変化（行・全選択）でモードを更新
  document.addEventListener('change', function (e) {
    const t = e.target;
    if (t && t.classList && (t.classList.contains('row-select-chk') || t.id === 'selectAllChk')) {
      refresh();
    }
  });
  // 全選択チェックは .checked を JS 代入する経路があり change が飛ばないことがあるため click でも更新
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'selectAllChk') setTimeout(refresh, 0);
  });

  window.refreshRowSelectionMode = refresh;
})();
