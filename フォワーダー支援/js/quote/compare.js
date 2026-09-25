// ========== 比較（同一項目の最安値比較） ==========
// 右カラム「⚖️ 比較」パネル。品名（nm）が同じ行が2件以上あるものだけを
// グループ化し、仕入単価（JPY換算）が最も安い行を⭐でハイライトする。
// 削除はせず、既存の「見積書非表示（👁/🚫）」を使って候補を絞り込めるようにする。

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
      const sv = (document.getElementById('sv-' + id)?.value || '').trim();
      const pq = parseFloat(document.getElementById('pq-' + id)?.value) || 0;
      const pp = parseFloat(document.getElementById('pp-' + id)?.value) || 0;
      const pc = document.getElementById('pc-' + id)?.value || 'JPY';
      const hidden = tr.dataset.hideQuote === '1';
      const unitCostJPY  = (typeof toJPY === 'function') ? toJPY(pp, pc) : pp;
      const totalCostJPY = (typeof toJPY === 'function') ? toJPY(pq * pp, pc) : pq * pp;
      rows.push({ id, nm, sv, pq, pp, pc, hidden, unitCostJPY, totalCostJPY });
    });
    return rows;
  }

  function _cmpGroupByName(rows) {
    const map = new Map();
    rows.forEach(r => {
      if (!map.has(r.nm)) map.set(r.nm, []);
      map.get(r.nm).push(r);
    });
    return Array.from(map.values())
      .filter(list => list.length >= 2)
      .map(list => {
        list.sort((a, b) => a.unitCostJPY - b.unitCostJPY);
        return { nm: list[0].nm, rows: list };
      })
      // 最安値と最高値の差（＝比較する意味の大きさ）が大きい項目から表示
      .sort((a, b) => {
        const gapA = a.rows[a.rows.length - 1].unitCostJPY - a.rows[0].unitCostJPY;
        const gapB = b.rows[b.rows.length - 1].unitCostJPY - b.rows[0].unitCostJPY;
        return gapB - gapA;
      });
  }

  function _cmpFmtJpy(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }

  function renderCompareRail() {
    const panel = document.getElementById('cmpRailPanel');
    if (!panel) return;
    _cmpGroups = _cmpGroupByName(_cmpRows());

    if (!_cmpGroups.length) {
      panel.innerHTML =
        '<p class="cmp-empty">同じ品名（項目名）の行が2件以上あると、ここで仕入単価を比較できます。<br>' +
        '同じ費用について複数サブコンから見積を取った場合、それぞれ同じ品名で行を入力してください。</p>';
      return;
    }

    panel.innerHTML =
      '<p class="cmp-hint">同一品名の行を仕入単価（JPY換算）で比較し、最安値を⭐で表示します。<br>' +
      '「👁️ 非表示にする」は見積書への表示/非表示の切替のみで、行は削除されません。</p>' +
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
          <div class="cmp-group-title">${escHtml(g.nm)}
            <button type="button" class="cmp-group-apply-btn" onclick="cmpKeepCheapestOnly(${gi})" title="最安値の行だけ見積書に表示し、他は非表示にします">⭐ 最安値だけ表示</button>
          </div>
          ${rowsHtml}
        </div>`;
      }).join('') +
      '</div>' +
      '</div>';
  }

  // 指定グループの最安値行だけを表示に、他は非表示にする（削除はしない）
  function cmpKeepCheapestOnly(idx) {
    const g = _cmpGroups[idx];
    if (!g) return;
    g.rows.forEach((r, i) => {
      const shouldHide = i !== 0;
      if (r.hidden !== shouldHide && typeof window.toggleRowHideQuoteById === 'function') {
        window.toggleRowHideQuoteById(r.id);
      }
    });
    renderCompareRail();
    if (typeof quoteShowToast === 'function') quoteShowToast('⭐ 最安値の行だけ見積書に表示にしました', 'success', 2500);
  }

  // レールのバッジ表示用：パネルを開いていなくても現在の比較可能件数を返す
  function getCompareGroupCount() {
    return _cmpGroupByName(_cmpRows()).length;
  }

  window.renderCompareRail = renderCompareRail;
  window.cmpKeepCheapestOnly = cmpKeepCheapestOnly;
  window.getCompareGroupCount = getCompareGroupCount;
