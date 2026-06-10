// ========== 行管理 (app-row.js) ==========

  // ========== カテゴリ変更 ==========
  function onCatChange(id) {
    const tr = document.getElementById(`row-${id}`);
    const cat = document.getElementById(`cat-${id}`)?.value;
    // cat-* クラスを全削除
    tr.className = tr.className.split(' ').filter(c => !c.startsWith('cat-')).join(' ').trim();
    if (cat) {
      const catObj = getAllCategories().find(c => c.value === cat);
      if (catObj?.cls) tr.classList.add(catObj.cls);
    }
  }

  // ========== 未入力グレーアウト ==========
  function checkUnfilled(id) {
    const tr = document.getElementById(`row-${id}`);
    const nm = document.getElementById(`nm-${id}`);
    if (!tr || !nm) return;
    nm.value.trim() === ''
      ? tr.classList.add('row-unfilled')
      : tr.classList.remove('row-unfilled');
  }

  // ========== ドラッグ＆ドロップ ==========
  function initDrag(tr) {
    // tr は常に draggable="true"。ハンドル以外からのドラッグは dragstart で防ぐ
    tr.setAttribute('draggable', 'true');
    const handle = tr.querySelector('.drag-handle');

    // dragstart の e.target は tr 自身になるため、mousedown でフラグを立てる
    let _dragFromHandle = false;
    if (handle) {
      handle.addEventListener('mousedown', () => { _dragFromHandle = true; });
      document.addEventListener('mouseup', () => { _dragFromHandle = false; }, { capture: true });
    }

    tr.addEventListener('dragstart', e => {
      // ハンドルを掴んでいない場合はドラッグ無効
      if (!handle || !_dragFromHandle) {
        e.preventDefault(); return;
      }
      _dragFromHandle = false;
      dragSrcRow = tr;
      // 多選択ドラッグ：掴んだ行がチェック済みなら、チェックされている全行をまとめて移動
      const myChk = tr.querySelector('.row-select-chk');
      if (myChk?.checked) {
        const selected = Array.from(
          document.querySelectorAll('#tableBody tr .row-select-chk:checked')
        ).map(c => c.closest('tr')).filter(Boolean);
        dragSrcRows = selected.length > 1 ? selected : [tr];
      } else {
        dragSrcRows = [tr];
      }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tr.id);
      const movingRows = dragSrcRows;
      setTimeout(() => movingRows.forEach(r => r.classList.add('dragging')), 0);
    });
    tr.addEventListener('dragend', () => {
      (dragSrcRows || [tr]).forEach(r => r.classList.remove('dragging'));
      document.querySelectorAll('#tableBody tr').forEach(r =>
        r.classList.remove('drag-over-top', 'drag-over-bottom'));
      dragSrcRow = null;
      dragSrcRows = null;
      updateTotals();
    });
    tr.addEventListener('dragover', e => {
      if (!dragSrcRows || !dragSrcRows.length) return;
      e.preventDefault();
      e.stopPropagation();
      // ドラッグ中の行群の上には挿入インジケータを出さない
      if (dragSrcRows.includes(tr)) return;
      // 異なるサブコングループへのドロップは不可
      if (_rowSubcon(dragSrcRows[0]) !== _rowSubcon(tr)) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.dataTransfer.dropEffect = 'move';
      const mid = tr.getBoundingClientRect().top + tr.getBoundingClientRect().height / 2;
      document.querySelectorAll('#tableBody tr').forEach(r =>
        r.classList.remove('drag-over-top', 'drag-over-bottom'));
      tr.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
    });
    tr.addEventListener('dragleave', () =>
      tr.classList.remove('drag-over-top', 'drag-over-bottom'));
    tr.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!dragSrcRows || !dragSrcRows.length || dragSrcRows.includes(tr)) return;
      // 異なるサブコングループへのドロップは不可
      if (_rowSubcon(dragSrcRows[0]) !== _rowSubcon(tr)) return;
      const mid = tr.getBoundingClientRect().top + tr.getBoundingClientRect().height / 2;
      const tbody = document.getElementById('tableBody');
      // 仮想グループヘッダーをスキップして実行行の隣に挿入
      let insertBefore = e.clientY < mid ? tr : tr.nextSibling;
      while (insertBefore?.dataset?.virtual) insertBefore = insertBefore.nextSibling;
      // document 順で挿入することで元の並びを保持
      dragSrcRows.forEach(srcTr => {
        tbody.insertBefore(srcTr, insertBefore);
      });
      tr.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    // ▲▼ ボタンによる行移動
    const upBtn   = tr.querySelector('.row-move-up');
    const downBtn = tr.querySelector('.row-move-down');
    if (upBtn)   upBtn.addEventListener('click',  () => moveRow(tr, -1));
    if (downBtn) downBtn.addEventListener('click', () => moveRow(tr, +1));
  }

  function moveRow(tr, dir) {
    const tbody = document.getElementById('tableBody');
    if (dir < 0) {
      let prev = tr.previousElementSibling;
      while (prev?.dataset?.virtual) prev = prev.previousElementSibling;
      if (prev) tbody.insertBefore(tr, prev);
    } else {
      let next = tr.nextElementSibling;
      while (next?.dataset?.virtual) next = next.nextElementSibling;
      if (next) tbody.insertBefore(next, tr);
    }
    updateTotals();
    renderSubconGroups();
  }

  // ========== 十字キー（↑↓）移動 ==========
  // Phase 2b：DOMContentLoaded ではなく initQuoteKeyNav() として呼び出すように変更
  function initQuoteKeyNav() {
    document.getElementById('tableBody').addEventListener('keydown', e => {
      // Ctrl+D: 現在行を複製して直下に挿入
      if (e.ctrlKey && e.key === 'd') {
        const tr = e.target.closest('tr');
        if (!tr || !tr.id.startsWith('row-')) return;
        e.preventDefault();
        const col   = e.target.dataset.col;
        const newId = duplicateRow(tr.id.replace('row-', ''));
        setTimeout(() => {
          const target = col
            ? document.querySelector(`#row-${newId} [data-col="${col}"]`)
            : document.getElementById(`nm-${newId}`);
          if (target) { target.focus(); if (target.select) target.select(); }
        }, 0);
        return;
      }

      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const el  = e.target;
      const col = el.dataset.col;
      if (col === undefined) return;
      e.preventDefault();
      const tr = el.closest('tr');

      // ===== 単価セル内の縦スタック移動（仕入(pp/col=4) ↕ 乗せ幅(mk/col=5)）=====
      // 視覚順は 仕→＋乗せ幅→売(自動) の縦並び。編集可能な 仕↔＋ を ↑↓ で行き来し、
      // 端では隣の行の対応フィールドへ連続接続（↓連打で 仕→＋→次行の仕→＋… と縦に流れる）。
      if (col === '4' || col === '5') {
        const id = tr.id.replace('row-', '');
        const dataRows = Array.from(document.querySelectorAll('#tableBody tr'))
                          .filter(r => r.querySelector('[data-field="pp"]'));
        const di = dataRows.indexOf(tr);
        const focusField = (rowEl, field) => {
          const t = rowEl && rowEl.querySelector(`[data-field="${field}"]`);
          if (t) { t.focus(); if (t.select) t.select(); }
          return !!t;
        };
        if (col === '4') {                 // 仕入れ単価
          if (e.key === 'ArrowDown') focusField(tr, 'mk');           // ↓ → ＋乗せ幅
          else if (di > 0)           focusField(dataRows[di - 1], 'mk'); // ↑ → 前行の＋乗せ幅
        } else {                            // 乗せ幅（＋）
          if (e.key === 'ArrowUp')   focusField(tr, 'pp');           // ↑ → 仕入れ単価
          else if (di < dataRows.length - 1) focusField(dataRows[di + 1], 'pp'); // ↓ → 次行の仕入れ
          else {                            // 末尾なら新規行を追加して仕入れへ
            const newId = addRowAfter(id);
            setTimeout(() => focusField(document.getElementById(`row-${newId}`), 'pp'), 0);
          }
        }
        return;
      }

      // 小計行・リマーク行をスキップして data-col を持つ行のみでナビゲーション（E-12）
      const navRows = Array.from(document.querySelectorAll('#tableBody tr'))
                       .filter(r => r.querySelector(`[data-col="${col}"]`));
      const navIdx  = navRows.indexOf(tr);
      const navNext = e.key === 'ArrowUp' ? navIdx - 1 : navIdx + 1;
      if (navNext >= 0 && navNext < navRows.length) {
        const nextEl = navRows[navNext].querySelector(`[data-col="${col}"]`);
        if (nextEl) {
          nextEl.focus();
          if (nextEl.type === 'text' || nextEl.type === 'number') nextEl.select();
        }
      } else if (e.key === 'ArrowDown' && navNext === navRows.length) {
        const newId = addRowAfter(tr.id.replace('row-', ''));
        setTimeout(() => {
          document.querySelector(`#row-${newId} [data-col="${col}"]`)?.focus();
        }, 0);
      }
    });
  }

  // ========== 行操作 ==========
  // Tabで行追加するかどうか（tabAddEnabledはapp-constants.jsで宣言済み）
  function toggleTabAdd(on) {
    tabAddEnabled = !!on;
    localStorage.setItem('tabAddEnabled', on ? '1' : '0');
    showSaveStatus('Tabで行追加: ' + (on ? 'ON' : 'OFF'));
  }
  function noteKeydown(e, id) {
    if (e.key === 'Tab' && !e.shiftKey && tabAddEnabled) {
      e.preventDefault();
      const newId = addRowAfter(id);
      setTimeout(() => document.getElementById(`nm-${newId}`)?.focus(), 0);
    }
  }

  function addRowAfter(afterId) {
    rowCount++;
    const id = rowCount;
    const tr = document.createElement('tr');
    tr.id = `row-${id}`;
    // 継承元の行からカテゴリ・通貨・サブコンを取得
    const srcCat = document.getElementById(`cat-${afterId}`)?.value || '';
    const srcCur = document.getElementById(`pc-${afterId}`)?.value  || 'JPY';
    const srcSv  = document.getElementById(`sv-${afterId}`)?.value  || '';
    tr.replaceChildren(buildRowHTML(id, srcCat, srcCur, srcSv));
    tr.classList.add('row-unfilled');
    const refRow = document.getElementById(`row-${afterId}`);
    if (refRow?.nextSibling) refRow.parentNode.insertBefore(tr, refRow.nextSibling);
    else if (refRow)         refRow.parentNode.appendChild(tr);
    else                     document.getElementById('tableBody').appendChild(tr);
    initDrag(tr);
    onCatChange(id);  // カテゴリ色を適用
    onPay(id);
    return id;
  }

  function addRow() {
    rowCount++;
    const id = rowCount;
    // 末尾行からカテゴリ・通貨・サブコンを継承（仮想グループヘッダーはスキップ）
    const rows = Array.from(document.querySelectorAll('#tableBody tr')).filter(r => !r.dataset.virtual);
    const lastRow = rows.length ? rows[rows.length - 1] : null;
    const lastId  = lastRow ? lastRow.id.replace('row-', '') : null;
    const srcCat  = lastId ? (document.getElementById(`cat-${lastId}`)?.value || '') : '';
    const srcCur  = lastId ? (document.getElementById(`pc-${lastId}`)?.value  || 'JPY') : 'JPY';
    const srcSv   = lastId ? (document.getElementById(`sv-${lastId}`)?.value  || '')    : '';
    const tr = document.createElement('tr');
    tr.id = `row-${id}`;
    tr.replaceChildren(buildRowHTML(id, srcCat, srcCur, srcSv));
    tr.classList.add('row-unfilled');
    document.getElementById('tableBody').appendChild(tr);
    initDrag(tr);
    onCatChange(id);  // カテゴリ色を適用
    onPay(id);
  }

  // ========== 行複製（Ctrl+D） ==========
  function duplicateRow(srcId) {
    const newId = addRowAfter(srcId);

    // テキスト・数値フィールドをコピー
    ['nm','pq','un','pp','mk','nt','sv'].forEach(f => {
      const srcEl = document.getElementById(`${f}-${srcId}`);
      const dstEl = document.getElementById(`${f}-${newId}`);
      if (srcEl && dstEl) dstEl.value = srcEl.value;
    });

    // セレクトをコピー（請求通貨 bc を含む）
    ['cat','pc','bc'].forEach(f => {
      const srcEl = document.getElementById(`${f}-${srcId}`);
      const dstEl = document.getElementById(`${f}-${newId}`);
      if (srcEl && dstEl) dstEl.value = srcEl.value;
    });

    // チェックボックスをコピー
    const srcTx = document.getElementById(`tx-${srcId}`);
    const dstTx = document.getElementById(`tx-${newId}`);
    if (srcTx && dstTx) dstTx.checked = srcTx.checked;

    // 再計算・色・状態の更新
    onCatChange(newId);
    if (dstTx?.checked) toggleTax(newId);
    checkUnfilled(newId);
    onPay(newId);

    return newId;
  }

  // ========== カテゴリー順ソート ==========
  function sortBy(type) {
    const tbody = document.getElementById('tableBody');
    const allRows = Array.from(tbody.querySelectorAll('tr:not([data-virtual])'));
    if (allRows.length < 2) return;
    // 小計行・リマーク行はソート対象外（末尾に移動）（E-6）
    const dataRows  = allRows.filter(tr => !tr.dataset.type);
    const otherRows = allRows.filter(tr =>  tr.dataset.type);
    const getId = tr => tr.id.replace('row-', '');
    const catOrder = cat => { const i = CAT_VALUES.indexOf(cat); return i === -1 ? 999 : i; };

    dataRows.sort((a, b) => {
      const idA = getId(a), idB = getId(b);
      switch (type) {
        case 'category': {
          const cA = document.getElementById(`cat-${idA}`)?.value || '';
          const cB = document.getElementById(`cat-${idB}`)?.value || '';
          return catOrder(cA) - catOrder(cB);
        }
        case 'currency': {
          const cA = document.getElementById(`pc-${idA}`)?.value || '';
          const cB = document.getElementById(`pc-${idB}`)?.value || '';
          return cA.localeCompare(cB);
        }
        case 'unit': {
          const uA = document.getElementById(`un-${idA}`)?.value.trim() || '';
          const uB = document.getElementById(`un-${idB}`)?.value.trim() || '';
          if (!uA && !uB) return 0;
          if (!uA) return 1;
          if (!uB) return -1;
          return uA.localeCompare(uB, 'ja');
        }
        case 'tax': {
          const tA = document.getElementById(`tx-${idA}`)?.checked ? 0 : 1;
          const tB = document.getElementById(`tx-${idB}`)?.checked ? 0 : 1;
          return tA - tB;
        }
        case 'subcon': {
          const sA = document.getElementById(`sv-${idA}`)?.value.trim() || '';
          const sB = document.getElementById(`sv-${idB}`)?.value.trim() || '';
          if (!sA && !sB) return 0;
          if (!sA) return 1;
          if (!sB) return -1;
          return sA.localeCompare(sB, 'ja');
        }
        default: return 0;
      }
    });
    [...dataRows, ...otherRows].forEach(r => tbody.appendChild(r));
    updateTotals();
    renderSubconGroups();
  }

  function sortByCategory() { sortBy('category'); }

  function buildRowHTML(id, initCat = '', initCur = 'JPY', initSv = '') {
    const tpl  = document.getElementById('row-tpl');
    const frag = tpl.content.cloneNode(true);
    const q    = f => frag.querySelector(`[data-field="${f}"]`);

    // IDs
    ['cat','tx','nm','pq','un','pc','pp','cd','bq','bc','bp','mk','st','pr','nt','sv']
      .forEach(f => { q(f).id = `${f}-${id}`; });

    // Select options & initial values
    q('cat').innerHTML = catOpts(initCat);
    q('pc').innerHTML  = curOpts(initCur);
    q('bc').innerHTML  = curOpts('JPY');
    if (initSv) q('sv').value = initSv;

    // Event handlers
    q('cat').onchange  = () => onCatChange(id);
    q('tx').onchange   = () => toggleTax(id);
    q('tx').onkeydown  = e  => { if (e.key === 'Enter') { e.preventDefault(); e.target.checked = !e.target.checked; toggleTax(id); } };
    q('nm').oninput    = () => checkUnfilled(id);
    q('pq').oninput    = () => onPay(id);
    q('pc').onchange   = () => onPay(id);
    q('pp').oninput    = () => onPay(id);
    q('mk').oninput    = () => calc(id);
    q('nt').onkeydown  = e  => noteKeydown(e, id);
    q('sv').onchange   = () => renderSubconGroups();

    return frag;
  }

  function toggleTax(id) {
    const tr = document.getElementById(`row-${id}`);
    const nm = document.getElementById(`nm-${id}`);
    if (!tr || !nm) return;
    const checked = document.getElementById(`tx-${id}`)?.checked;
    if (checked) {
      tr.classList.add('taxed');
      // 課税マーク * は「自動付与した場合」だけ後で外す。ユーザーが品名先頭に自分で
      // 打った * を税OFF時に消してデータを壊さないよう、付与有無を data 属性で記録する。
      if (!nm.value.startsWith('*')) { nm.value = '*' + nm.value; tr.dataset.taxAuto = '1'; }
      else { tr.dataset.taxAuto = '0'; }
    } else {
      tr.classList.remove('taxed');
      // 自動付与した * のみ除去（taxAuto 未設定＝リロード後の旧データは従来通り先頭1文字除去）
      if (nm.value.startsWith('*') && tr.dataset.taxAuto !== '0') nm.value = nm.value.slice(1);
      delete tr.dataset.taxAuto;
    }
    // 消費税サマリ更新 + st セルの消費税表示を再描画（calc が updateTotals を内包）
    calc(id);
  }

  // ========== 計算 ==========
  function onPay(id) {
    const pq = val(`pq-${id}`);
    const pc = document.getElementById(`pc-${id}`)?.value;
    const pp = val(`pp-${id}`);
    const mk = val(`mk-${id}`);
    const bqEl = document.getElementById(`bq-${id}`);
    const bcEl = document.getElementById(`bc-${id}`);
    const bpEl = document.getElementById(`bp-${id}`);
    if (bqEl) bqEl.value = pq;
    if (bcEl) bcEl.value = pc;
    if (bpEl) { bpEl.dataset.base = pp; bpEl.value = pp + mk; }
    calc(id);
  }

  function calc(id) {
    const pq = val(`pq-${id}`);
    const pp = val(`pp-${id}`);
    const bq = val(`bq-${id}`);
    const mk = val(`mk-${id}`);
    const bpEl = document.getElementById(`bp-${id}`);
    if (bpEl) bpEl.value = (parseFloat(bpEl.dataset.base) || 0) + mk;
    const bp = val(`bp-${id}`);
    const pc = document.getElementById(`pc-${id}`)?.value || 'JPY';
    const bc = document.getElementById(`bc-${id}`)?.value || 'JPY';
    const subtotal = bq * bp;             // 行の請求小計（数量 × 単価）
    const profit   = subtotal - pq * pp;  // 行の利益（小計 - 支払い合計）
    const canFx = typeof toJPY === 'function';
    const taxed = document.getElementById(`tx-${id}`)?.checked;
    const taxRate = (typeof getEffectiveTaxRate === 'function') ? getEffectiveTaxRate() : 0.10;
    // 小計セル
    const st = document.getElementById(`st-${id}`);
    if (st) {
      let stHTML;
      if (bc !== 'JPY' && canFx && subtotal) {
        const jpySub = Math.ceil(toJPY(subtotal, bc));
        stHTML = fmt(subtotal) + '<br><small class="jpy-conv-hint">(≈¥' + fmt(jpySub) + ')</small>';
        if (taxed) stHTML += '<br><small class="tax-hint">（消費税：≈¥' + fmt(Math.ceil(jpySub * taxRate)) + '）</small>';
      } else {
        stHTML = subtotal ? fmt(subtotal) : '—';
        if (taxed && subtotal) stHTML += '<br><small class="tax-hint">（消費税：' + fmt(Math.ceil(subtotal * taxRate)) + '円）</small>';
      }
      st.innerHTML = stHTML;
      st.className = 'subtotal-cell' + (subtotal ? ' subtotal-has-value' : '');
    }
    // 利益セル
    const pr = document.getElementById(`pr-${id}`);
    const isFx = canFx && (bc !== 'JPY' || pc !== 'JPY') && (subtotal || profit);
    if (isFx) {
      const jpyProfit = Math.ceil(toJPY(subtotal, bc) - toJPY(pq * pp, pc));
      pr.innerHTML = fmt(profit) + '<br><small class="jpy-conv-hint">(≈¥' + fmt(jpyProfit) + ')</small>';
    } else {
      pr.textContent = fmt(profit);
    }
    pr.className = `profit-cell ${pClass(profit)}`;
    updateTotals();
  }

  function pClass(p) {
    return p > 0 ? 'profit-pos' : p < 0 ? 'profit-neg' : 'profit-zero';
  }

  function val(id) {
    let v = document.getElementById(id)?.value;
    if (v == null || v === '') return 0;
    // 全角数字・小数点・マイナスを半角化（IME 確定ミスやコピペでの 0 欠落を防ぐ）
    v = String(v).replace(/[０-９．－]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    return parseFloat(v) || 0;
  }

  function updateTotals() {
    const rows = document.querySelectorAll('#tableBody tr');
    if (!rows.length) {
      ['tot-cost','tot-billing','tot-subtotal','tot-profit'].forEach(id =>
        document.getElementById(id).textContent = '—');
      document.getElementById('tot-profit').className = 'profit-cell profit-zero';
      const lbl0 = document.getElementById('tot-row-label');
      if (lbl0) lbl0.textContent = '合　計';
      window.renderQuoteFxBar?.();
      return;
    }
    let totCost = 0, totBill = 0, totMk = 0, totSub = 0;
    let totCostJPY = 0, totBillJPY = 0, totSubJPY = 0;
    let hasFx = false;
    // 通貨別集計: { bc: { sub, taxedSub, exemptSub } }
    const ccyData = {};
    rows.forEach(tr => {
      if (tr.dataset.type === 'subtotal') return; // 小計行をスキップ
      const id  = tr.id.replace('row-', '');
      const pc  = document.getElementById(`pc-${id}`)?.value || 'JPY';
      const bc  = document.getElementById(`bc-${id}`)?.value || 'JPY';
      const pq  = val(`pq-${id}`);
      const pp  = val(`pp-${id}`);
      const bq  = val(`bq-${id}`);
      const bp  = val(`bp-${id}`);
      const taxed = document.getElementById(`tx-${id}`)?.checked || false;
      const cost = pq * pp;
      const sub  = bq * bp;
      totCost += cost;
      totBill += sub;
      totSub  += sub;
      totMk   += val(`mk-${id}`);
      // JPY換算（行ごとに SharedCalc.jpyRound で丸めてから合計・4経路統一）
      totCostJPY += SharedCalc.jpyRound(toJPY(cost, pc));
      totBillJPY += SharedCalc.jpyRound(toJPY(sub, bc));
      totSubJPY  += SharedCalc.jpyRound(toJPY(sub, bc));
      if (pc !== 'JPY' || bc !== 'JPY') hasFx = true;
      // 通貨別集計
      if (!ccyData[bc]) ccyData[bc] = { sub: 0, taxedSub: 0, exemptSub: 0 };
      ccyData[bc].sub += sub;
      if (taxed) ccyData[bc].taxedSub += sub;
      else       ccyData[bc].exemptSub += sub;
    });
    const totPr    = totBill - totCost;
    const totPrJPY = totBillJPY - totCostJPY;
    const labelEl  = document.getElementById('tot-row-label');
    const pEl      = document.getElementById('tot-profit');
    if (hasFx) {
      // 外貨混在時：単純加算は無意味なので JPY 換算合計を「合計」行に表示
      if (labelEl) labelEl.innerHTML = '合計<small class="tot-jpy-note">（JPY換算）</small>';
      document.getElementById('tot-cost').textContent     = '¥' + fmt(Math.round(totCostJPY));
      document.getElementById('tot-subtotal').textContent = '¥' + fmt(Math.round(totSubJPY));
      const mkPctJpy = (window.SharedCalc ? SharedCalc.grossMarginPct(totBillJPY, totCostJPY) : 0);
      pEl.innerHTML = '¥' + fmt(Math.round(totPrJPY)) + `<small class="tot-margin">粗利 ${mkPctJpy.toFixed(1)}%</small>`;
      pEl.className = `profit-cell ${pClass(totPrJPY)}`;
    } else {
      if (labelEl) labelEl.textContent = '合　計';
      document.getElementById('tot-cost').textContent     = fmt(Math.round(totCost));
      document.getElementById('tot-billing').textContent  = fmt(Math.round(totBill));
      document.getElementById('tot-subtotal').textContent = fmt(Math.round(totSub));
      const mkPct = (window.SharedCalc ? SharedCalc.grossMarginPct(totBill, totCost) : 0);
      pEl.innerHTML = fmt(Math.round(totPr)) + `<small class="tot-margin">粗利 ${mkPct.toFixed(1)}%</small>`;
      pEl.className = `profit-cell ${pClass(totPr)}`;
    }
    updateSubtotalRows();
    window.updateQuoteSummary?.();
    window.renderQuoteFxBar?.();
  }

  // ========== 小計行 ==========
  let subtotalCount = 0;
  let remarkCount   = 0;

  // 小計行ドラッグ初期化（通常行の initDrag と同じロジック）
  function initSubtotalDrag(tr) {
    tr.setAttribute('draggable', 'true');
    const handle = tr.querySelector('.drag-handle');
    let _dragFromHandle = false;
    if (handle) {
      handle.addEventListener('mousedown', () => { _dragFromHandle = true; });
      document.addEventListener('mouseup', () => { _dragFromHandle = false; }, { capture: true });
    }
    tr.addEventListener('dragstart', e => {
      if (!handle || !_dragFromHandle) { e.preventDefault(); return; }
      _dragFromHandle = false;
      dragSrcRow = tr;
      // 小計行はチェックボックスを持たない → 常に単一行ドラッグ
      dragSrcRows = [tr];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tr.id);
      setTimeout(() => tr.classList.add('dragging'), 0);
    });
    tr.addEventListener('dragend', () => {
      (dragSrcRows || [tr]).forEach(r => r.classList.remove('dragging'));
      document.querySelectorAll('#tableBody tr').forEach(r =>
        r.classList.remove('drag-over-top', 'drag-over-bottom'));
      dragSrcRow = null;
      dragSrcRows = null;
      updateTotals();
    });
    tr.addEventListener('dragover', e => {
      if (!dragSrcRows || !dragSrcRows.length) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (dragSrcRows.includes(tr)) return;
      const mid = tr.getBoundingClientRect().top + tr.getBoundingClientRect().height / 2;
      document.querySelectorAll('#tableBody tr').forEach(r =>
        r.classList.remove('drag-over-top', 'drag-over-bottom'));
      tr.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
    });
    tr.addEventListener('dragleave', () =>
      tr.classList.remove('drag-over-top', 'drag-over-bottom'));
    tr.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      if (!dragSrcRows || !dragSrcRows.length || dragSrcRows.includes(tr)) return;
      const mid = tr.getBoundingClientRect().top + tr.getBoundingClientRect().height / 2;
      const tbody = document.getElementById('tableBody');
      const insertBefore = e.clientY < mid ? tr : tr.nextSibling;
      dragSrcRows.forEach(srcTr => {
        tbody.insertBefore(srcTr, insertBefore);
      });
      tr.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    const upBtn   = tr.querySelector('.subtotal-move-up');
    const downBtn = tr.querySelector('.subtotal-move-down');
    if (upBtn)   upBtn.addEventListener('click',  () => moveRow(tr, -1));
    if (downBtn) downBtn.addEventListener('click', () => moveRow(tr, +1));
  }

  /**
   * 小計行を挿入する。
   * afterId が指定された場合はその行の直後に、省略時は末尾に追加。
   */
  function insertSubtotalRow(afterId) {
    subtotalCount++;
    const id = `subtotal-${subtotalCount}`;
    const tr = document.createElement('tr');
    tr.id = `row-${id}`;
    tr.dataset.type = 'subtotal';
    tr.className = 'subtotal-row';
    // 19 列構成（tfoot の合計行と同じ列レイアウト）。
    // 行アクションは左端へ統一（regular row のアクションセル位置に合わせる）。
    tr.innerHTML = `
      <td class="check-cell">
        <input type="checkbox" class="row-select-chk" tabindex="-1" title="この行を選択（パターン保存・削除用）" style="width:13px;height:13px;cursor:pointer;margin:0;vertical-align:middle;" />
      </td>
      <td class="subtotal-drag-cell">
        <span class="drag-handle" title="ドラッグして並び替え">⠿</span>
      </td>
      <td colspan="6" class="subtotal-label-cell">
        <span class="subtotal-marker">━━ 小計</span>
        <input type="text" class="subtotal-label" placeholder="グループ名（任意）" oninput="updateSubtotalRows()" />
        <span class="subtotal-group-billing" style="display:none;">—</span>
      </td>
      <td class="subtotal-group-subtotal subtotal-cell">—</td>
      <td class="subtotal-group-profit profit-cell profit-zero">—</td>
    `;
    const tbody = document.getElementById('tableBody');
    if (afterId) {
      const afterRow = document.getElementById(`row-${afterId}`);
      if (afterRow?.nextSibling) tbody.insertBefore(tr, afterRow.nextSibling);
      else if (afterRow)         tbody.appendChild(tr);
      else                       tbody.appendChild(tr);
    } else {
      tbody.appendChild(tr);
    }
    initSubtotalDrag(tr);
    updateSubtotalRows();
  }

  function removeSubtotalRow(id) {
    document.getElementById(`row-${id}`)?.remove();
    updateSubtotalRows();
    updateTotals();
  }

  // ========== リマーク行 ==========
  function insertRemarkRow(afterId, opts) {
    remarkCount++;
    const id = `remark-${remarkCount}`;
    const tr = document.createElement('tr');
    tr.id = `row-${id}`;
    tr.dataset.type = 'remark';
    tr.className = 'remark-row';
    tr.innerHTML = `
      <td class="check-cell">
        <input type="checkbox" class="row-select-chk" tabindex="-1" title="この行を選択（パターン保存・削除用）" style="width:13px;height:13px;cursor:pointer;margin:0;vertical-align:middle;" />
      </td>
      <td class="remark-drag-cell">
        <span class="drag-handle" title="ドラッグして並び替え">⠿</span>
      </td>
      <td colspan="8" class="remark-row-cell">
        <span class="remark-row-marker">💬 リマーク</span>
        <input type="text" class="remark-row-input" placeholder="テーブル内コメント・注記を入力" />
        <button type="button" class="remark-scope-btn" onclick="toggleRemarkInternal(this)"
                title="クリックで「社内メモ（見積書には出力しない）」に切替">📄 見積書に表示</button>
      </td>
    `;
    if (opts?.internal) applyRemarkInternalState(tr, true);
    const tbody = document.getElementById('tableBody');
    if (afterId) {
      const afterRow = document.getElementById(`row-${afterId}`);
      if (afterRow?.nextSibling) tbody.insertBefore(tr, afterRow.nextSibling);
      else if (afterRow)         tbody.appendChild(tr);
      else                       tbody.appendChild(tr);
    } else {
      tbody.appendChild(tr);
    }
    initSubtotalDrag(tr);
    if (!opts?.noFocus) tr.querySelector('.remark-row-input')?.focus();
  }

  function removeRemarkRow(id) {
    document.getElementById(`row-${id}`)?.remove();
  }

  // ========== 社内メモ行（出力対象外・独立行タイプ）==========
  let internalCount = 0;
  function insertInternalRow(afterId, opts) {
    internalCount++;
    const id = `internal-${internalCount}`;
    const tr = document.createElement('tr');
    tr.id = `row-${id}`;
    tr.dataset.type = 'internal';
    tr.className = 'internal-row';
    tr.innerHTML = `
      <td class="check-cell">
        <input type="checkbox" class="row-select-chk" tabindex="-1" title="この行を選択（パターン保存・削除用）" style="width:13px;height:13px;cursor:pointer;margin:0;vertical-align:middle;" />
      </td>
      <td class="remark-drag-cell">
        <span class="drag-handle" title="ドラッグして並び替え">⠿</span>
      </td>
      <td colspan="9" class="internal-row-cell">
        <span class="internal-row-marker">🔒 社内メモ</span>
        <input type="text" class="internal-row-input" placeholder="社内用メモ（プレビュー・PDF・CSV・Excel には出力されません）" />
      </td>
    `;
    const tbody = document.getElementById('tableBody');
    if (afterId) {
      const afterRow = document.getElementById(`row-${afterId}`);
      if (afterRow?.nextSibling) tbody.insertBefore(tr, afterRow.nextSibling);
      else if (afterRow)         tbody.appendChild(tr);
      else                       tbody.appendChild(tr);
    } else {
      tbody.appendChild(tr);
    }
    initSubtotalDrag(tr);
    if (!opts?.noFocus) tr.querySelector('.internal-row-input')?.focus();
  }

  // リマーク行：見積書に表示 ⇔ 社内メモ（見積書・PDF・メールに出力しない）の切替
  function applyRemarkInternalState(tr, internal) {
    if (!tr) return;
    tr.dataset.internal = internal ? '1' : '0';
    tr.classList.toggle('remark-internal', internal);
    const marker = tr.querySelector('.remark-row-marker');
    const btn = tr.querySelector('.remark-scope-btn');
    const inp = tr.querySelector('.remark-row-input');
    if (marker) marker.textContent = internal ? '🔒 社内メモ' : '💬 リマーク';
    if (inp) inp.placeholder = internal ? '社内向けメモ（見積書には出力されません）' : 'テーブル内コメント・注記を入力';
    if (btn) {
      btn.textContent = internal ? '🔒 社内メモ' : '📄 見積書に表示';
      btn.title = internal
        ? 'クリックで「見積書に表示」に切替（現在：見積書・PDF・メールには出力されない社内メモ）'
        : 'クリックで「社内メモ（見積書には出力しない）」に切替';
    }
  }
  window.applyRemarkInternalState = applyRemarkInternalState;
  window.toggleRemarkInternal = function (btn) {
    const tr = btn.closest('tr');
    applyRemarkInternalState(tr, tr.dataset.internal !== '1');
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  };

  function updateSubtotalRows() {
    const tbody = document.getElementById('tableBody');
    const allRows = Array.from(tbody.querySelectorAll('tr'));
    // 通貨は混在し得るため、JPY 換算で集計する（_fxRates 経由）
    // ただし単一通貨グループは原通貨のまま表示する
    let groupBillJPY = 0;     // JPY 換算後の請求合計
    let groupCostJPY = 0;     // JPY 換算後の支払い合計
    let groupBillRaw = 0;     // 原通貨の請求合計（単一通貨グループ用）
    let groupCostRaw = 0;     // 原通貨の支払い合計（単一通貨グループ用）
    let groupBillCurrencies = new Set();  // 請求通貨セット（単一通貨判定用）
    let groupCostCurrencies = new Set();  // 支払い通貨セット
    allRows.forEach(tr => {
      if (tr.dataset.type === 'subtotal') {
        const billingEl  = tr.querySelector('.subtotal-group-billing');
        const subtotalEl = tr.querySelector('.subtotal-group-subtotal');
        const profitEl   = tr.querySelector('.subtotal-group-profit');
        const mixedBill = groupBillCurrencies.size > 1;
        const mixedCost = groupCostCurrencies.size > 1;
        const billCur0 = (!mixedBill && groupBillCurrencies.size === 1) ? [...groupBillCurrencies][0] : null;
        const costCur0 = (!mixedCost && groupCostCurrencies.size === 1) ? [...groupCostCurrencies][0] : null;
        // native 表示は「請求・仕入が完全に同一の単一通貨」のときだけ。
        // それ以外（通貨混在 or 請求通貨≠仕入通貨）は通貨混同を避け全て JPY 換算で表示する。
        const pureSame = !!(billCur0 && costCur0 && billCur0 === costCur0);
        const billCur  = pureSame ? billCur0 : null;
        const billAmt  = pureSame ? groupBillRaw : groupBillJPY;
        const costAmt  = pureSame ? groupCostRaw : groupCostJPY;
        const profit   = billAmt - costAmt;
        const prefix   = pureSame ? '' : '≈ ';
        const curSuffix = (billCur && billCur !== 'JPY') ? ' ' + billCur : '';

        if (billingEl) {
          billingEl.textContent = billAmt ? prefix + fmt(billAmt) + curSuffix : '—';
          billingEl.title = pureSame ? '' : '通貨を JPY に換算して合計（FX パネルのレート使用）';
        }
        if (subtotalEl) {
          subtotalEl.textContent = billAmt ? prefix + fmt(billAmt) + curSuffix : '—';
          subtotalEl.className   = 'subtotal-group-subtotal subtotal-cell' + (billAmt ? ' subtotal-has-value' : '');
          subtotalEl.title = pureSame ? '' : '通貨を JPY に換算して合計（FX パネルのレート使用）';
        }
        if (profitEl) {
          profitEl.textContent = (billAmt || costAmt) ? prefix + fmt(profit) + curSuffix : '—';
          profitEl.className   = `subtotal-group-profit profit-cell ${pClass(profit)}`;
          profitEl.title = pureSame ? '' : '通貨を JPY に換算して合計（FX パネルのレート使用）';
        }
        groupBillJPY = 0; groupCostJPY = 0;
        groupBillRaw = 0; groupCostRaw = 0;
        groupBillCurrencies = new Set(); groupCostCurrencies = new Set();
      } else {
        const id = tr.id.replace('row-', '');
        const bq = val(`bq-${id}`);
        const bp = val(`bp-${id}`);
        const pq = val(`pq-${id}`);
        const pp = val(`pp-${id}`);
        const bc = document.getElementById(`bc-${id}`)?.value || 'JPY';
        const pc = document.getElementById(`pc-${id}`)?.value || 'JPY';
        const billRaw = bq * bp;
        const costRaw = pq * pp;
        // JPY 換算は行ごと ceil で積み上げ（小計セパレータの小数表示を排除・合計と整合）
        groupBillJPY += SharedCalc.jpyRound(toJPY(billRaw, bc));
        groupCostJPY += SharedCalc.jpyRound(toJPY(costRaw, pc));
        // 単一通貨グループ表示用。JPY は行ごと ceil で整数化（外貨は native のまま）
        groupBillRaw += (bc === 'JPY' ? Math.ceil(billRaw) : billRaw);
        groupCostRaw += (pc === 'JPY' ? Math.ceil(costRaw) : costRaw);
        if (billRaw && bc) groupBillCurrencies.add(bc);
        if (costRaw && pc) groupCostCurrencies.add(pc);
      }
    });
  }

  function delRow(id) {
    document.getElementById(`row-${id}`)?.remove();
    updateTotals();
  }

  // ========== ツールバーからの行挿入（末尾／選択行の下） ==========
  // 挿入位置セレクト #rowInsertPos の値で afterId を決定。
  // 'selected' かつチェック行ありなら最後のチェック行の直後、なければ末尾(null)。
  function _toolbarInsertAfterId() {
    const sel = document.getElementById('rowInsertPos');
    if (sel && sel.value === 'selected') {
      const checked = document.querySelectorAll('#tableBody tr .row-select-chk:checked');
      if (checked.length) {
        const lastTr = checked[checked.length - 1].closest('tr');
        if (lastTr) return lastTr.id.replace('row-', '');
      } else {
        quoteShowToast('⚠️ 選択行がありません。末尾に追加します', 'warn', 3000);
      }
    }
    return null; // 末尾
  }
  function toolbarInsertRow() {
    const newId = addRowAfter(_toolbarInsertAfterId());
    updateTotals();
    const nm = document.getElementById(`nm-${newId}`);
    if (nm) nm.focus();
  }
  function toolbarInsertSubtotal() { insertSubtotalRow(_toolbarInsertAfterId()); }
  function toolbarInsertRemark()   { insertRemarkRow(_toolbarInsertAfterId()); }
  function toolbarInsertInternal() { insertInternalRow(_toolbarInsertAfterId()); }

  // 未入力行（row-unfilled）を一括削除
  function deleteEmptyRows() {
    // row-unfilled（名前空）かつ単価・請求単価もゼロの行のみ削除（E-8：価格入力済み行の誤削除防止）
    const empties = [...document.querySelectorAll('#tableBody tr.row-unfilled')].filter(tr => {
      const id = tr.id.replace('row-', '');
      const pp = parseFloat(document.getElementById(`pp-${id}`)?.value) || 0;
      const bp = parseFloat(document.getElementById(`bp-${id}`)?.value) || 0;
      return pp === 0 && bp === 0;
    });
    if (!empties.length) {
      quoteShowToast('🧹 未入力行はありません', 'success', 2500);
      return;
    }
    empties.forEach(tr => tr.remove());
    updateTotals();
    quoteShowToast(`🧹 未入力行を ${empties.length} 件削除しました`, 'success');
  }

  function resetAll() {
    document.getElementById('tableBody').innerHTML = '';
    rowCount = 0;
    updateTotals();
    quoteShowToast('🗑️ 全行をリセットしました（Ctrl+Z で元に戻せます）', 'info', 4000);
  }

  // ========== サブコン別グループ表示 ==========

  // 行のサブコン値を返す（仮想行・非データ行は null）
  function _rowSubcon(tr) {
    if (!tr || tr.dataset.virtual) return null;
    const id = tr.id?.replace('row-', '');
    if (!id || tr.dataset.type) return null;
    return document.getElementById(`sv-${id}`)?.value.trim() ?? '';
  }

  // サブコン別グループヘッダーを再描画する
  // - 仮想 TR（data-virtual）を全削除してから再挿入
  // - グループ順：出現順。未設定グループは末尾
  // - グループが 1 つ以下のとき（全行同サブコン or 全行未設定）はヘッダー不要
  function renderSubconGroups() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    _inGroupRender = true;
    try {
      // 既存の仮想ヘッダーを削除
      tbody.querySelectorAll('[data-virtual]').forEach(r => r.remove());

      // 実データ行を DOM 順に収集してサブコンごとにグルーピング
      const realRows = Array.from(tbody.querySelectorAll('tr:not([data-virtual])'))
        .filter(tr => !tr.dataset.type); // 小計・リマーク・社内メモは対象外
      if (!realRows.length) return;

      const UNSET_KEY = '￿'; // 未設定グループは末尾（￿ はソートで末尾）
      const groupOrder = [];
      const groups = Object.create(null);
      realRows.forEach(tr => {
        const sv = _rowSubcon(tr) ?? '';
        const key = sv || UNSET_KEY;
        if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
        groups[key].push(tr);
      });

      // グループが 1 つだけなら表示不要
      if (groupOrder.length < 2) return;

      // グループヘッダー TR を各グループの先頭行の直前に挿入
      groupOrder.forEach(key => {
        const label = key === UNSET_KEY ? '（サブコン未設定）' : key;
        const firstRow = groups[key][0];
        const count = groups[key].length;
        const hdr = document.createElement('tr');
        hdr.dataset.virtual = '1';
        hdr.className = 'subcon-group-header';
        hdr.innerHTML =
          `<td colspan="14" class="subcon-group-header-cell">` +
            `<span class="subcon-group-label">📦 ${_escHdr(label)}</span>` +
            `<span class="subcon-group-count">${count} 行</span>` +
            `<button type="button" class="subcon-group-add-btn" ` +
              `data-sv="${_escAttr(key === UNSET_KEY ? '' : key)}" ` +
              `title="${_escAttr(label)} に行を追加">＋</button>` +
          `</td>`;
        hdr.querySelector('.subcon-group-add-btn').addEventListener('click', () => {
          addRowToSubconGroup(key === UNSET_KEY ? '' : key);
        });
        tbody.insertBefore(hdr, firstRow);
      });
    } finally {
      _inGroupRender = false;
    }
  }

  function _escHdr(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function _escAttr(s) {
    return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  }

  // 指定サブコングループの末尾に行を追加
  function addRowToSubconGroup(sv) {
    const tbody = document.getElementById('tableBody');
    const realRows = Array.from(tbody.querySelectorAll('tr:not([data-virtual])'))
      .filter(tr => !tr.dataset.type);
    // グループの末尾行を探す
    let lastInGroup = null;
    realRows.forEach(tr => {
      const rowSv = _rowSubcon(tr) ?? '';
      if (rowSv === sv) lastInGroup = tr;
    });
    let newId;
    if (lastInGroup) {
      newId = addRowAfter(lastInGroup.id.replace('row-', ''));
    } else {
      addRow();
      const all = Array.from(tbody.querySelectorAll('tr:not([data-virtual])')).filter(tr => !tr.dataset.type);
      newId = all.length ? all[all.length - 1].id.replace('row-', '') : null;
    }
    if (newId && sv) {
      const svEl = document.getElementById(`sv-${newId}`);
      if (svEl) svEl.value = sv;
    }
    renderSubconGroups();
    setTimeout(() => document.getElementById(`nm-${newId}`)?.focus(), 40);
  }
  window.addRowToSubconGroup = addRowToSubconGroup;
