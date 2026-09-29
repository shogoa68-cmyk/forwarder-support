// ========== 比較（同一項目の最安値比較） ==========
// 右カラム「⚖️ 比較」パネル。品名（nm）・単位（un）が一致する行が2件以上あるものを
// グループ化し、仕入単価（JPY換算）が最も安い行を⭐でハイライトする。
// 見積書本体（明細テーブル）側の該当行にも自動でハイライト表示する（行の削除・
// 非表示は行わない。個別の見積書非表示切替は既存の「👁/🚫」をそのまま利用）。

  let _cmpGroups = [];   // 直近描画したグループ（クリックはインデックス経由・quote-tag-chips と同じ安全策）

  function _cmpRows() {
    const rows = [];
    document.querySelectorAll('#tableBody tr[id^="row-"]').forEach(tr => {
      if (tr.dataset.type || tr.dataset.virtual) return;   // 小計・リマーク行・サブコングループ見出し（仮想行）は対象外
      if (tr.dataset.mergedInto) return;                   // 他行へ統合済みの行は対象外
      if (tr.dataset.actual === '1' || tr.dataset.cond === '1') return;   // 実費（金額未確定）・都度請求（発生時のみ）は単価比較の対象外
      const id = tr.id.replace('row-', '');
      const nm = (document.getElementById('nm-' + id)?.value || '').trim();
      if (!nm) return;
      const un = (document.getElementById('un-' + id)?.value || '').trim();
      const sv = (document.getElementById('sv-' + id)?.value || '').trim();
      const pq = parseFloat(document.getElementById('pq-' + id)?.value) || 0;
      const pp = parseFloat(document.getElementById('pp-' + id)?.value) || 0;
      const pc = document.getElementById('pc-' + id)?.value || 'JPY';
      const hidden = tr.dataset.hideQuote === '1';
      const unitCostJPY  = (typeof toJPY === 'function') ? toJPY(pp, pc) : pp;
      const totalCostJPY = (typeof toJPY === 'function') ? toJPY(pq * pp, pc) : pq * pp;
      rows.push({ id, nm, un, sv, pq, pp, pc, hidden, unitCostJPY, totalCostJPY });
    });
    return rows;
  }

  function _cmpGroupByName(rows) {
    const map = new Map();   // key: 品名 \x00 単位 → 行配列（単位まで一致するものだけを比較対象にする）
    rows.forEach(r => {
      const key = r.nm + '\x00' + r.un;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return Array.from(map.values())
      .filter(list => list.length >= 2)
      .map(list => {
        list.sort((a, b) => a.unitCostJPY - b.unitCostJPY);
        return { nm: list[0].nm, un: list[0].un, rows: list };
      })
      // 最安値と最高値の差（＝比較する意味の大きさ）が大きい項目から表示
      .sort((a, b) => {
        const gapA = a.rows[a.rows.length - 1].unitCostJPY - a.rows[0].unitCostJPY;
        const gapB = b.rows[b.rows.length - 1].unitCostJPY - b.rows[0].unitCostJPY;
        return gapB - gapA;
      });
  }

  function _cmpFmtJpy(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }

  // 見積書本体（明細テーブル）側の行ハイライトを、現在の比較結果に合わせて同期する。
  // 一旦全部クリアしてから各グループの最安値行にだけ付け直す（価格変更等で最安値の
  // 行が入れ替わっても古いハイライトが残らないようにするため）。
  function _cmpSyncTableHighlight(groups) {
    document.querySelectorAll('#tableBody tr.row-cmp-best').forEach(tr => tr.classList.remove('row-cmp-best'));
    groups.forEach(g => {
      const tr = document.getElementById('row-' + g.rows[0].id);
      if (tr) tr.classList.add('row-cmp-best');
    });
  }

  function renderCompareRail() {
    const panel = document.getElementById('cmpRailPanel');
    if (!panel) return;
    _cmpGroups = _cmpGroupByName(_cmpRows());
    _cmpSyncTableHighlight(_cmpGroups);

    if (!_cmpGroups.length) {
      panel.innerHTML =
        '<p class="cmp-empty">品名・単位の両方が一致する行が2件以上あると、ここで仕入単価を比較できます。<br>' +
        '同じ費用について複数サブコンから見積を取った場合、それぞれ同じ品名・単位で行を入力してください。</p>';
      return;
    }

    panel.innerHTML =
      '<p class="cmp-hint">品名・単位が一致する行を仕入単価（JPY換算）で比較し、最安値を⭐で表示します。<br>' +
      '見積書本体の該当行も自動でハイライトされます。「👁️ 非表示にする」は見積書への表示/非表示の切替のみで、行は削除されません。</p>' +
      '<div class="cmp-scroll">' +
      '<div class="cmp-list">' +
      _cmpGroups.map((g, gi) => {
        const cheapestJPY = g.rows[0].unitCostJPY;
        const rowsHtml = g.rows.map((r, ri) => {
          const isCheapest = ri === 0;
          const gap = r.unitCostJPY - cheapestJPY;
          const gapPct = cheapestJPY > 0 ? (gap / cheapestJPY * 100) : 0;
          const gapHtml = isCheapest ? ''
            : `<span class="cmp-row-gap">+${_cmpFmtJpy(gap)}（+${gapPct.toFixed(1)}%）</span>`;
          const priceLine = r.pc !== 'JPY'
            ? `${_cmpFmtJpy(r.unitCostJPY)}（${r.pp.toLocaleString('ja-JP')} ${escHtml(r.pc)}）`
            : _cmpFmtJpy(r.unitCostJPY);
          const hideLabel = r.hidden ? '🚫 非表示中' : '👁️ 非表示にする';
          return `<div class="cmp-row${isCheapest ? ' cmp-row--best' : ''}${r.hidden ? ' cmp-row--hidden' : ''}">
            <span class="cmp-row-star">${isCheapest ? '⭐' : ''}</span>
            <span class="cmp-row-sv">${escHtml(r.sv || '（サブコン未設定）')}</span>
            <span class="cmp-row-price">${priceLine}</span>
            ${gapHtml}
            <button type="button" class="cmp-row-hide-btn" onclick="toggleRowHideQuoteById('${r.id}');renderCompareRail();" title="この行の見積書表示/非表示を切り替え">${hideLabel}</button>
          </div>`;
        }).join('');
        return `<div class="cmp-group">
          <div class="cmp-group-title">
            <span class="cmp-group-name">${escHtml(g.nm)}${g.un ? '<span class="cmp-group-unit">（' + escHtml(g.un) + '）</span>' : ''}</span>
            <button type="button" class="cmp-group-apply-btn" onclick="cmpJumpToCheapest(${gi})" title="見積書本体の最安値行へジャンプします（表示中はハイライトされています）">📍 表で見る</button>
          </div>
          ${rowsHtml}
        </div>`;
      }).join('') +
      '</div>' +
      '</div>';
  }

  // 指定グループの最安値行（見積書本体側）へスクロールして一瞬フラッシュする。
  // ハイライト自体は renderCompareRail() のたびに自動で同期されているため、
  // ここでは「今どこにあるか」を見せるだけで行の表示/非表示には触れない。
  function cmpJumpToCheapest(idx) {
    const g = _cmpGroups[idx];
    if (!g) return;
    const tr = document.getElementById('row-' + g.rows[0].id);
    if (!tr) return;
    tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tr.classList.add('jump-target-flash');
    setTimeout(() => tr.classList.remove('jump-target-flash'), 1200);
  }

  // レールのバッジ表示用：パネルを開いていなくても現在の比較可能件数を返す
  function getCompareGroupCount() {
    return _cmpGroupByName(_cmpRows()).length;
  }

  window.renderCompareRail = renderCompareRail;
  window.cmpJumpToCheapest = cmpJumpToCheapest;
  window.getCompareGroupCount = getCompareGroupCount;
