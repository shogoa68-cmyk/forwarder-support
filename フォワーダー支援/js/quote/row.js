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
    // 有効期限（vf/vt）はサーチャージ専用。サーチャージ以外に変更したら値を消す
    // （CSS で欄は隠れるが、値が残るとプレビューのバッジ・期間外判定に漏れるため）。
    // 復元時は _applyCells で値をセットした後にここが呼ばれるので、旧データの掃除も兼ねる。
    if (cat !== 'surcharge') {
      const vf = document.getElementById(`vf-${id}`);
      const vt = document.getElementById(`vt-${id}`);
      if (vf && vf.value) vf.value = '';
      if (vt && vt.value) vt.value = '';
      if (tr) { delete tr.dataset.outRange; tr.classList.remove('row-out-of-range'); }
    }
  }

  // サーチャージ有効期限：開始日だけ入れたとき、終了日が未入力ならその月の月末を自動セットする
  function autoFillValidTo(id) {
    const vf = document.getElementById(`vf-${id}`);
    const vt = document.getElementById(`vt-${id}`);
    if (!vf || !vt) return;
    if (vf.value && !vt.value) {
      const d = new Date(vf.value + 'T00:00:00');
      if (!isNaN(d)) {
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); // 翼月 0 日 = 当月末日
        const z = n => String(n).padStart(2, '0');
        vt.value = `${last.getFullYear()}-${z(last.getMonth() + 1)}-${z(last.getDate())}`;
      }
    }
    updateTotals();   // 適用期間の再判定（客先非表示・合計除外）を反映
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }

  // ===== サーチャージ適用期間（vf〜vt）の判定 =====
  // 基準日（＝見積もり提示日）：見積全体の有効期限(qf-valid-until) → 発行日(qf-date) → 今日
  function _quoteRefDate() {
    const v = (document.getElementById('qf-valid-until')?.value || '').trim()
           || (document.getElementById('qf-date')?.value || '').trim();
    if (v) return v;
    const d = new Date();
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }
  // 行の適用期間が基準日を外れていれば true（期間未設定の行は常に有効＝false）。
  // 日付は ISO(YYYY-MM-DD) なので文字列比較で大小判定できる。
  function isRowOutOfRange(tr) {
    if (!tr || !tr.id || !tr.id.startsWith('row-')) return false;
    const id = tr.id.replace('row-', '');
    // 有効期限はサーチャージ専用。他カテゴリの行は（値が残っていても）対象外
    if ((document.getElementById(`cat-${id}`)?.value || '') !== 'surcharge') return false;
    const vf = document.getElementById(`vf-${id}`)?.value || '';
    const vt = document.getElementById(`vt-${id}`)?.value || '';
    if (!vf && !vt) return false;        // 適用期間の指定がない行は対象外
    const ref = _quoteRefDate();
    if (vf && ref < vf) return true;     // 提示日が適用開始より前
    if (vt && ref > vt) return true;     // 提示日が適用終了より後
    return false;
  }
  window.isRowOutOfRange = isRowOutOfRange;

  // 全データ行の適用期間状態を再計算し dataset.outRange とクラスを更新。期間外の件数を返す。
  function recomputeRowValidity() {
    let n = 0;
    document.querySelectorAll('#tableBody tr[id^="row-"]').forEach(tr => {
      if (isRowOutOfRange(tr)) {
        tr.dataset.outRange = '1';
        tr.classList.add('row-out-of-range');
        n++;
      } else {
        delete tr.dataset.outRange;
        tr.classList.remove('row-out-of-range');
      }
    });
    return n;
  }
  window.recomputeRowValidity = recomputeRowValidity;

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
      // 詳細行に子リマーク行がある場合は dragSrcRows に展開して一緒に移動させる
      {
        const addedIds = new Set(dragSrcRows.map(r => r.id));
        const expanded = [];
        dragSrcRows.forEach(r => {
          expanded.push(r);
          if (!r.dataset.type) {
            const rid = r.id.replace('row-', '');
            getChildRemarks(rid).forEach(c => {
              if (!addedIds.has(c.id)) { expanded.push(c); addedIds.add(c.id); }
            });
          }
        });
        dragSrcRows = expanded;
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
      renderSubconGroups();   // 移動後にグループ見出し・小計・ツリー帰属を再評価
    });
    tr.addEventListener('dragover', e => {
      if (!dragSrcRows || !dragSrcRows.length) return;
      e.preventDefault();
      e.stopPropagation();
      // ドラッグ中の行群の上には挿入インジケータを出さない
      if (dragSrcRows.includes(tr)) return;
      // データ行同士のときだけ、異なるサブコングループへのドロップを禁止（揺らぎ吸収：正規化キーで判定）。
      // リマーク・社内メモ・小計行（dataset.type 付き＝_rowSubcon が null）は自由に移動可。
      const _srcSv = _rowSubcon(dragSrcRows[0]);
      if (_srcSv !== null && subconNormKey(_srcSv) !== subconNormKey(_rowSubcon(tr))) {
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
      // サイドパネルからのドラッグはドキュメントレベルのハンドラに委ねる
      if (e.dataTransfer.types.includes('application/x-si-item')) return;
      e.preventDefault();
      e.stopPropagation();
      if (!dragSrcRows || !dragSrcRows.length || dragSrcRows.includes(tr)) return;
      // データ行同士のときだけグループ跨ぎ禁止（リマーク・社内メモ・小計行は自由移動可）
      const _srcSv = _rowSubcon(dragSrcRows[0]);
      if (_srcSv !== null && subconNormKey(_srcSv) !== subconNormKey(_rowSubcon(tr))) return;
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

  // 行を「見積書（客先出力）に出さない」状態に切り替える。
  // 作業テーブル・社内プレビューには目印付きで残り、合計・PDF・Excel・CSV・客先プレビューからは除外。
  function toggleRowHideQuote(btn) {
    const tr = btn?.closest('tr');
    if (!tr) return;
    const hidden = tr.dataset.hideQuote === '1';
    if (hidden) {
      delete tr.dataset.hideQuote;
      tr.classList.remove('row-hidden-quote');
      btn.classList.remove('is-on');
      btn.textContent = '👁';
      btn.title = 'この行を見積書（プレビュー客先表示・PDF・Excel・CSV）に出力しない';
    } else {
      tr.dataset.hideQuote = '1';
      tr.classList.add('row-hidden-quote');
      btn.classList.add('is-on');
      btn.textContent = '🚫';
      btn.title = '見積書で非表示中（クリックで出力に戻す）';
    }
    updateTotals();   // グループ小計（_updateGroupSums）も内部で更新される
    // ※ renderSubconGroups() は呼ばない：行の並べ替え（同名サブコンの集約）が走り、
    //   下方の行が上のグループへ移動してしまうため。非表示は並び順を変える操作ではない。
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  window.toggleRowHideQuote = toggleRowHideQuote;

  // 行を「要調査（後で記入）」状態に切り替える。
  // サーチャージ等、最新情報を調べてから埋める項目を見失わないための目印。
  // 合計・出力には通常どおり含まれるが、視覚的に強調し、出力前ゲートで警告される。
  function toggleRowPending(btn) {
    const tr = btn?.closest('tr');
    if (!tr) return;
    const on = tr.dataset.pending === '1';
    if (on) {
      delete tr.dataset.pending;
      tr.classList.remove('row-pending');
      btn.classList.remove('is-on');
      btn.title = '後で調べて記入（要調査マーク）。サーチャージ等、最新情報を調べてから埋める項目に。';
    } else {
      tr.dataset.pending = '1';
      tr.classList.add('row-pending');
      btn.classList.add('is-on');
      btn.title = '要調査（後で記入）中。最新情報を調べたらクリックで解除。';
      // 完了と要調査は排他：要調査にしたら完了マークを外す
      if (tr.dataset.done === '1') {
        delete tr.dataset.done;
        tr.classList.remove('row-input-done');
        const db = tr.querySelector('.row-done-btn');
        if (db) { db.classList.remove('is-on'); db.title = '入力完了の目印。作成を再開したとき、どこまで終わったか分かります（もう一度クリックで解除）。'; }
        if (typeof updateDoneCounter === 'function') updateDoneCounter();
      }
    }
    updatePendingCounter();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  window.toggleRowPending = toggleRowPending;

  // 行を「入力完了」状態に切り替える。作成再開時にどこまで終わったかの目印。
  // 合計・出力には通常どおり含まれる（純粋な作業マーカー）。要調査とは排他。
  function toggleRowDone(btn) {
    const tr = btn?.closest('tr');
    if (!tr) return;
    const on = tr.dataset.done === '1';
    if (on) {
      delete tr.dataset.done;
      tr.classList.remove('row-input-done');
      btn.classList.remove('is-on');
      btn.title = '入力完了の目印。作成を再開したとき、どこまで終わったか分かります（もう一度クリックで解除）。';
    } else {
      tr.dataset.done = '1';
      tr.classList.add('row-input-done');
      btn.classList.add('is-on');
      btn.title = '入力完了（クリックで解除）';
      // 完了と要調査は排他：完了にしたら要調査マークを外す
      if (tr.dataset.pending === '1') {
        delete tr.dataset.pending;
        tr.classList.remove('row-pending');
        const pb = tr.querySelector('.row-pending-btn');
        if (pb) { pb.classList.remove('is-on'); pb.title = '後で調べて記入（要調査マーク）。サーチャージ等、最新情報を調べてから埋める項目に。'; }
        updatePendingCounter();
      }
    }
    updateDoneCounter();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  window.toggleRowDone = toggleRowDone;

  // 行アイコンからの 追加(➕)／複製(📋)／削除(🗑️)
  function rowAddBelow(btn) {
    const tr = btn?.closest('tr');
    if (!tr) return;
    const id = tr.id.replace('row-', '');
    const newId = addRowAfter(id);
    updateTotals();
    const savedScrollY = window.scrollY;
    renderSubconGroups();
    window.scrollTo({ top: savedScrollY, behavior: 'instant' });
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    setTimeout(() => document.getElementById(`nm-${newId}`)?.focus(), 0);
  }
  window.rowAddBelow = rowAddBelow;

  function rowDuplicate(btn) {
    const tr = btn?.closest('tr');
    if (!tr) return;
    duplicateRow(tr.id.replace('row-', ''));  // 内部で renderSubconGroups + 自動保存
    updateTotals();
  }
  window.rowDuplicate = rowDuplicate;

  function rowDelete(btn) {
    const tr = btn?.closest('tr');
    if (!tr) return;
    const id = tr.id.replace('row-', '');
    if (!window.confirm('この行を削除します。よろしいですか？')) return;
    delRow(id);
    const savedScrollY = window.scrollY;
    renderSubconGroups();
    window.scrollTo({ top: savedScrollY, behavior: 'instant' });
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  window.rowDelete = rowDelete;

  // 入力完了の進捗バッジ（完了件数 / データ行総数）を更新。0 行なら非表示。
  function updateDoneCounter() {
    const dataRows = document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])');
    const total = dataRows.length;
    let done = 0;
    dataRows.forEach(tr => { if (tr.dataset.done === '1') done++; });
    const ind = document.getElementById('doneIndicator');
    if (ind) ind.hidden = (done === 0);
    const dc = document.getElementById('doneCount');  if (dc) dc.textContent = done;
    const dt = document.getElementById('doneTotal');  if (dt) dt.textContent = total;
  }
  window.updateDoneCounter = updateDoneCounter;

  // 未完了（＝続きから作業する）行へ移動。完了マークの無い最初のデータ行へスクロール。
  function jumpToNextUnfinished() {
    const rows = Array.from(document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])'));
    const target = rows.find(tr => tr.dataset.done !== '1');
    if (!target) { if (window.quoteShowToast) quoteShowToast('すべての行が入力完了です 🎉', 'success'); return; }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const nm = target.querySelector('[data-field="nm"]');
    if (nm) { nm.focus(); if (nm.select) nm.select(); }
  }
  window.jumpToNextUnfinished = jumpToNextUnfinished;

  // 要調査（後で記入）行の件数バッジを更新。0 件なら非表示。
  function updatePendingCounter() {
    const n = document.querySelectorAll('#tableBody tr[data-pending="1"]').length;
    const ind = document.getElementById('pendingIndicator');
    if (ind) ind.hidden = (n === 0);
    const cnt = document.getElementById('pendingCount');
    if (cnt) cnt.textContent = n;
  }
  window.updatePendingCounter = updatePendingCounter;

  // 要調査行を順に巡回スクロール（クリックのたびに次の要調査行へ）。
  function jumpToFirstPending() {
    const rows = Array.from(document.querySelectorAll('#tableBody tr[data-pending="1"]'));
    if (!rows.length) return;
    const cur = window.__pendingJumpIdx || 0;
    const tr  = rows[cur % rows.length];
    window.__pendingJumpIdx = (cur + 1) % rows.length;
    tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const nm = tr.querySelector('[data-field="nm"]');
    if (nm) { nm.focus(); if (nm.select) nm.select(); }
  }
  window.jumpToFirstPending = jumpToFirstPending;

  function moveRow(tr, dir) {
    const tbody = document.getElementById('tableBody');
    // 詳細行の場合は子リマーク（data-parent-id が一致するリマーク行）を連動させる
    const rowId = tr.dataset.type ? null : tr.id.replace('row-', '');
    const children = rowId ? getChildRemarks(rowId) : [];

    // 子リマークをまとめて親の直後に再配置するヘルパー
    const reattachChildren = () => {
      let after = tr;
      children.forEach(c => { after.insertAdjacentElement('afterend', c); after = c; });
    };

    if (dir < 0) {
      let prev = tr.previousElementSibling;
      while (prev?.dataset?.virtual) prev = prev.previousElementSibling;
      if (prev) {
        tbody.insertBefore(tr, prev);
        reattachChildren();
      }
    } else {
      // 下移動：自分の子リマークをスキップして次の行を探す
      let next = tr.nextElementSibling;
      while (next && children.includes(next)) next = next.nextElementSibling;
      while (next?.dataset?.virtual) next = next.nextElementSibling;
      if (next) {
        tbody.insertBefore(next, tr);
        reattachChildren();
      }
    }
    updateTotals();
    renderSubconGroups();
  }

  // ========== 十字キー（↑↓）移動 ==========
  // Phase 2b：DOMContentLoaded ではなく initQuoteKeyNav() として呼び出すように変更
  function initQuoteKeyNav() {
    // ホイールスクロールで input[type=number] の値が変わるブラウザ標準動作を抑制
    document.getElementById('tableBody').addEventListener('wheel', e => {
      if (e.target && e.target.type === 'number') e.preventDefault();
    }, { passive: false });

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

    // テキスト・数値・日付フィールドをコピー（zc = 0円確認済みフラグ／vf・vt = 有効期限を含む）
    ['nm','pq','un','pp','mk','nt','sv','pt','zc','ac','ps','co','vf','vt','lu'].forEach(f => {
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

    // 子リマーク行の複製：srcId の子リマークを新親（newId）の下に複製する。
    // addRowAfter は srcId の直後に挿入するため、srcId の子リマーク群の後ろへ移動してから複製。
    const srcChildren = getChildRemarks(srcId);
    const newRow = document.getElementById(`row-${newId}`);
    if (newRow && srcChildren.length) {
      // newId_row を子リマーク群の末尾の後ろへ移動（元の挿入位置が子リマークの前になるため）
      const lastChild = srcChildren[srcChildren.length - 1];
      lastChild.insertAdjacentElement('afterend', newRow);
      // 子リマークを複製して newId_row の直後に挿入
      let insertAfter = newRow;
      srcChildren.forEach(srcR => {
        remarkCount++;
        const cloned = srcR.cloneNode(true);
        cloned.id = `row-remark-${remarkCount}`;
        cloned.dataset.parentId = String(newId);
        insertAfter.insertAdjacentElement('afterend', cloned);
        initSubtotalDrag(cloned);
        insertAfter = cloned;
      });
    }

    // subcon-child クラス等のグループ連結を即時反映（DOM並替でスクロール位置が変わらないよう保持）
    const savedScrollY = window.scrollY;
    renderSubconGroups();
    window.scrollTo({ top: savedScrollY, behavior: 'instant' });
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();

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

  // サブコン別 / サブコン×パターン別グループ内のみカテゴリ順ソート
  function sortGroupByCategory(svKey, ptKey) {
    const tbody = document.getElementById('tableBody');
    const members = _groupMemberRows(svKey, ptKey);
    if (members.length < 2) return;
    const catOrder = cat => { const i = CAT_VALUES.indexOf(cat); return i === -1 ? 999 : i; };
    const sorted = [...members].sort((a, b) => {
      const idA = a.id.replace('row-', ''), idB = b.id.replace('row-', '');
      return catOrder(document.getElementById(`cat-${idA}`)?.value || '') -
             catOrder(document.getElementById(`cat-${idB}`)?.value || '');
    });
    // すでにソート済みなら skip
    const alreadySorted = members.every((tr, i) => tr === sorted[i]);
    if (alreadySorted) return;
    // 先頭メンバー行の直前に sorted を順に移動
    const anchor = members[0];
    sorted.forEach(tr => tbody.insertBefore(tr, anchor));
    updateTotals();
    renderSubconGroups();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  window.sortGroupByCategory = sortGroupByCategory;

  function buildRowHTML(id, initCat = '', initCur = 'JPY', initSv = '') {
    const tpl  = document.getElementById('row-tpl');
    const frag = tpl.content.cloneNode(true);
    const q    = f => frag.querySelector(`[data-field="${f}"]`);

    // IDs
    ['cat','tx','nm','pq','un','pc','pp','cd','bq','bc','bp','mk','st','pr','nt','sv','pt','zc','ac','ps','co','vf','vt','lu']
      .forEach(f => { const el = q(f); if (el) el.id = `${f}-${id}`; });
    const zcBtn = frag.querySelector('.zero-confirm-btn');
    if (zcBtn) zcBtn.onclick = () => toggleZeroConfirmed(id);;
    const acBtn = frag.querySelector('.actual-cost-btn');
    if (acBtn) acBtn.onclick = () => toggleActualCost(id);
    const psBtn = frag.querySelector('.profit-share-btn');
    if (psBtn) psBtn.onclick = () => toggleProfitShare(id);
    const coBtn = frag.querySelector('.cond-charge-btn');
    if (coBtn) coBtn.onclick = () => toggleConditional(id);
    const remBtn = frag.querySelector('.btn-row-rem');
    const intBtn = frag.querySelector('.btn-row-int');
    if (remBtn) remBtn.onclick = () => rowInsertRemarkBelow(id);
    if (intBtn) intBtn.onclick = () => rowInsertInternalBelow(id);

    // Select options & initial values
    q('cat').innerHTML = catOpts(initCat);
    q('pc').innerHTML  = curOpts(initCur);
    q('bc').innerHTML  = curOpts('JPY');
    if (initSv) q('sv').value = initSv;

    // Event handlers
    q('cat').onchange  = () => { onCatChange(id); updateTotals(); };  // 期間外判定・合計を即反映
    q('tx').onchange   = () => toggleTax(id);
    q('tx').onkeydown  = e  => { if (e.key === 'Enter') { e.preventDefault(); e.target.checked = !e.target.checked; toggleTax(id); } };
    q('nm').oninput    = () => checkUnfilled(id);
    q('pq').oninput    = () => onPay(id);
    q('pc').onchange   = () => onPay(id);
    q('pp').oninput    = () => onPay(id);
    q('mk').oninput    = () => calc(id);
    q('sv').onchange   = () => renderSubconGroups();
    { const ptEl = q('pt'); if (ptEl) { ptEl.onchange = () => renderSubconGroups(); ptEl.onfocus = () => _showPatternPopup(ptEl); } }  // パターン変更でグループ再描画＋航路サジェスト
    // サーチャージ有効期限：開始日を入れたら終了日を月末で自動補完（「通常はひと月」）
    q('vf').onchange   = () => autoFillValidTo(id);
    q('vt').onchange   = () => updateTotals();   // 終了日変更で適用期間の再判定
    // 最終更新日（lu）：全カテゴリ共通の社内メタ。個別変更で見出しの集約表示を更新
    { const luEl = q('lu'); if (luEl) luEl.onchange = () => { _syncGroupUpdatedHeaders(); if (typeof scheduleAutoSave === 'function') scheduleAutoSave(); }; }

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
    // 実費フラグ（金額未確定・別途精算）。単価・金額を「実費」表示し合計から除外
    const isActualCost = document.getElementById(`ac-${id}`)?.value === '1';
    const trEl0 = document.getElementById(`row-${id}`);
    if (trEl0) {
      trEl0.classList.toggle('row-actual-cost', isActualCost);
      if (isActualCost) trEl0.dataset.actual = '1'; else delete trEl0.dataset.actual;
    }
    const acBtn0 = trEl0?.querySelector('.actual-cost-btn');
    if (acBtn0) acBtn0.classList.toggle('is-on', isActualCost);
    // PROFIT SHARE（代理店収益）：客先非表示・社内利益に計上。金額は通常表示
    const isProfitShare = document.getElementById(`ps-${id}`)?.value === '1';
    if (trEl0) {
      trEl0.classList.toggle('row-profit-share', isProfitShare);
      if (isProfitShare) trEl0.dataset.profitShare = '1'; else delete trEl0.dataset.profitShare;
    }
    const psBtn0 = trEl0?.querySelector('.profit-share-btn');
    if (psBtn0) psBtn0.classList.toggle('is-on', isProfitShare);
    // 都度請求（発生時のみ）：金額は通常表示、合計には加算しない
    const isConditional = document.getElementById(`co-${id}`)?.value === '1';
    if (trEl0) {
      trEl0.classList.toggle('row-conditional', isConditional);
      if (isConditional) trEl0.dataset.cond = '1'; else delete trEl0.dataset.cond;
    }
    const coBtn0 = trEl0?.querySelector('.cond-charge-btn');
    if (coBtn0) coBtn0.classList.toggle('is-on', isConditional);
    // 小計セル
    const st = document.getElementById(`st-${id}`);
    if (st) {
      let stHTML;
      const isZeroConfirmed = document.getElementById(`zc-${id}`)?.value === '1';
      if (isActualCost) {
        stHTML = '<span class="actual-cost-badge actual-cost-badge--cell">実費</span>';
        st.innerHTML = stHTML;
        st.className = 'subtotal-cell subtotal-actual';
        // 利益は算出不能 → —
        const prAc = document.getElementById(`pr-${id}`);
        if (prAc) { prAc.textContent = '—'; prAc.className = 'profit-cell profit-zero'; }
        // ¥0✓ とは排他：0円バッジ/ボタンの ON を解除
        const zcBtnA = trEl0?.querySelector('.zero-confirm-btn');
        if (zcBtnA) zcBtnA.classList.remove('is-on');
        updateTotals();
        return;
      }
      if (bc !== 'JPY' && canFx && subtotal) {
        const jpySub = Math.ceil(toJPY(subtotal, bc));
        stHTML = fmt(subtotal) + '<br><small class="jpy-conv-hint">(≈¥' + fmt(jpySub) + ')</small>';
        if (taxed) stHTML += '<br><small class="tax-hint">（消費税：≈¥' + fmt(Math.ceil(jpySub * taxRate)) + '）</small>';
      } else {
        if (subtotal) {
          stHTML = fmt(subtotal);
          if (taxed) stHTML += '<br><small class="tax-hint">（消費税：' + fmt(Math.ceil(subtotal * taxRate)) + '円）</small>';
        } else if (isZeroConfirmed) {
          stHTML = '<span class="zero-confirmed-badge">¥0 ✓</span>';
        } else {
          stHTML = '—';
        }
      }
      st.innerHTML = stHTML;
      st.className = 'subtotal-cell' + (subtotal ? ' subtotal-has-value' : '');
      // ¥0✓ボタンの表示状態を同期
      const zcBtn = document.getElementById(`row-${id}`)?.querySelector('.zero-confirm-btn');
      if (zcBtn) zcBtn.classList.toggle('is-on', isZeroConfirmed);
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

  // ¥0✓ / 実費 / PS / 都度 は排他。指定 id 以外のフラグをクリア
  function _clearRowFlagsExcept(id, keep) {
    ['zc', 'ac', 'ps', 'co'].forEach(f => {
      if (f === keep) return;
      const el = document.getElementById(`${f}-${id}`);
      if (el) el.value = '';
    });
  }
  // ========== 0円確認済みトグル ==========
  function toggleZeroConfirmed(id) {
    const zcEl = document.getElementById(`zc-${id}`);
    if (!zcEl) return;
    zcEl.value = zcEl.value === '1' ? '' : '1';
    if (zcEl.value === '1') _clearRowFlagsExcept(id, 'zc');
    calc(id);
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }

  // ========== 実費トグル（金額未確定・合計から除外） ==========
  function toggleActualCost(id) {
    const acEl = document.getElementById(`ac-${id}`);
    if (!acEl) return;
    acEl.value = acEl.value === '1' ? '' : '1';
    if (acEl.value === '1') _clearRowFlagsExcept(id, 'ac');
    calc(id);
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  window.toggleActualCost = toggleActualCost;

  // ========== PROFIT SHARE トグル（客先非表示・社内利益に計上） ==========
  function toggleProfitShare(id) {
    const psEl = document.getElementById(`ps-${id}`);
    if (!psEl) return;
    psEl.value = psEl.value === '1' ? '' : '1';
    if (psEl.value === '1') _clearRowFlagsExcept(id, 'ps');
    calc(id);
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  window.toggleProfitShare = toggleProfitShare;

  // ========== 都度請求トグル（発生時のみ／必要時のみ。金額は表示・合計に加算しない） ==========
  function toggleConditional(id) {
    const coEl = document.getElementById(`co-${id}`);
    if (!coEl) return;
    coEl.value = coEl.value === '1' ? '' : '1';
    if (coEl.value === '1') _clearRowFlagsExcept(id, 'co');
    calc(id);
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  window.toggleConditional = toggleConditional;

  function val(id) {
    let v = document.getElementById(id)?.value;
    if (v == null || v === '') return 0;
    // 全角数字・小数点・マイナスを半角化（IME 確定ミスやコピペでの 0 欠落を防ぐ）
    v = String(v).replace(/[０-９．－]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    return parseFloat(v) || 0;
  }

  function updateTotals() {
    updatePendingCounter();
    updateDoneCounter();      // 入力完了の進捗バッジを更新
    recomputeRowValidity();   // 適用期間外の行を判定（客先非表示・合計除外）
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
    let psBillJPY = 0, psCostJPY = 0;   // PROFIT SHARE（代理店収益）社内計上分（JPY）
    let hasFx = false;
    // 通貨別集計: { bc: { sub, taxedSub, exemptSub } }
    const ccyData = {};
    rows.forEach(tr => {
      if (tr.dataset.type === 'subtotal') return; // 小計行をスキップ
      if (tr.dataset.excluded === '1') return;    // 除外グループはスキップ
      if (tr.dataset.hideQuote === '1') return;   // 見積書非表示の行は合計から除外
      if (tr.dataset.outRange === '1') return;    // 適用期間外のサーチャージは合計から除外
      if (tr.dataset.actual === '1') return;      // 実費（金額未確定）の行は合計から除外
      if (tr.dataset.cond === '1') return;        // 都度請求（発生時のみ）の行は合計に加算しない
      if (tr.dataset.profitShare === '1') {       // PROFIT SHARE：客先合計から除外し社内利益へ計上
        const pid = tr.id.replace('row-', '');
        const ppc = document.getElementById(`pc-${pid}`)?.value || 'JPY';
        const pbc = document.getElementById(`bc-${pid}`)?.value || 'JPY';
        psBillJPY += SharedCalc.jpyRound(toJPY(val(`bq-${pid}`) * val(`bp-${pid}`), pbc));
        psCostJPY += SharedCalc.jpyRound(toJPY(val(`pq-${pid}`) * val(`pp-${pid}`), ppc));
        return;
      }
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
    // 社内利益（PROFIT SHARE 込み）行：PS 行があるときだけ表示
    const psRow = document.getElementById('totPsRow');
    if (psRow) {
      if (psBillJPY || psCostJPY) {
        psRow.hidden = false;
        const psProfit = psBillJPY - psCostJPY;
        const internalProfit = totPrJPY + psProfit;     // 客先利益(JPY) ＋ 代理店収益の利益
        const internalBill   = totBillJPY + psBillJPY;
        const mk = (window.SharedCalc ? SharedCalc.grossMarginPct(internalBill, totCostJPY + psCostJPY) : 0);
        const revEl = document.getElementById('tot-ps-rev');
        const prEl  = document.getElementById('tot-ps-profit');
        if (revEl) revEl.textContent = '¥' + fmt(Math.round(psBillJPY));
        if (prEl) {
          prEl.innerHTML = '¥' + fmt(Math.round(internalProfit)) + `<small class="tot-margin">粗利 ${mk.toFixed(1)}%</small>`;
          prEl.className = `profit-cell pr-cell ${pClass(internalProfit)}`;
        }
      } else {
        psRow.hidden = true;
      }
    }
    updateSubtotalRows();
    _updateGroupSums();
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
      renderSubconGroups();   // 移動後にグループ見出し・小計・ツリー帰属を再評価
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
      <td class="subtotal-group-profit profit-cell profit-zero"><span class="stp-amt">—</span></td>
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
    // 親明細行の紐づけ：afterId が詳細行なら直接の親、リマーク行なら同じ親を引き継ぐ
    if (afterId) {
      const afterRow = document.getElementById(`row-${afterId}`);
      if (afterRow) {
        if (!afterRow.dataset.type) {
          tr.dataset.parentId = String(afterId);
        } else if (afterRow.dataset.type === 'remark' && afterRow.dataset.parentId) {
          tr.dataset.parentId = afterRow.dataset.parentId;
        }
      }
    }
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
    const inp = tr.querySelector('.remark-row-input');
    if (opts?.text) inp.value = opts.text;
    // テキスト付き挿入（ツールバー入力欄から）はフォーカスしない（入力欄に戻るため）
    if (!opts?.noFocus && !opts?.text) inp?.focus();
  }

  function removeRemarkRow(id) {
    document.getElementById(`row-${id}`)?.remove();
  }

  // 明細行 id の直後に続く「子リマーク行」を順に返す。
  // data-parent-id が id に一致するリマーク行のみ対象（連続している間だけ）。
  function getChildRemarks(parentId) {
    const result = [];
    const parentRow = document.getElementById(`row-${parentId}`);
    if (!parentRow) return result;
    let sib = parentRow.nextElementSibling;
    while (sib && sib.dataset.type === 'remark' && sib.dataset.parentId === String(parentId)) {
      result.push(sib);
      sib = sib.nextElementSibling;
    }
    return result;
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
    const inpI = tr.querySelector('.internal-row-input');
    if (opts?.text) inpI.value = opts.text;
    if (!opts?.noFocus && !opts?.text) inpI?.focus();
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
          const amtEl = profitEl.querySelector('.stp-amt') || profitEl;
          amtEl.textContent = (billAmt || costAmt) ? prefix + fmt(profit) + curSuffix : '—';
          // 粗利率（売上ベース）を総合計と同じ書式で併記。プレビューは dataset から読む
          const mPct = (billAmt && window.SharedCalc) ? SharedCalc.grossMarginPct(billAmt, costAmt) : null;
          let mEl = profitEl.querySelector('.tot-margin');
          if (mPct !== null) {
            if (!mEl) { mEl = document.createElement('small'); mEl.className = 'tot-margin'; profitEl.appendChild(mEl); }
            mEl.textContent = `粗利 ${mPct.toFixed(1)}%`;
            mEl.classList.toggle('pv-neg', mPct < 0);
            tr.dataset.marginPct = mPct.toFixed(1);
          } else {
            if (mEl) mEl.remove();
            delete tr.dataset.marginPct;
          }
          profitEl.className = `subtotal-group-profit profit-cell ${pClass(profit)}`;
          profitEl.title = pureSame ? '' : '通貨を JPY に換算して合計（FX パネルのレート使用）';
        }
        groupBillJPY = 0; groupCostJPY = 0;
        groupBillRaw = 0; groupCostRaw = 0;
        groupBillCurrencies = new Set(); groupCostCurrencies = new Set();
      } else {
        // 見積書非表示・適用期間外の行は小計セパレータの集計に含めない
        if (tr.dataset.hideQuote === '1' || tr.dataset.outRange === '1' || tr.dataset.actual === '1' || tr.dataset.profitShare === '1' || tr.dataset.cond === '1') return;
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
    // 子リマーク行（data-parent-id が一致するリマーク）を先に削除
    getChildRemarks(id).forEach(r => r.remove());
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
  function toolbarInsertRemark() {
    insertRemarkRow(_toolbarInsertAfterId());
    if (typeof updateTotals === 'function') updateTotals();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  function toolbarInsertInternal() {
    insertInternalRow(_toolbarInsertAfterId());
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }

  // ========== 行直下への備考行・社内メモ挿入（w-note フィールドのテキストを引用） ==========
  function rowInsertRemarkBelow(id) {
    const nt = document.getElementById(`nt-${id}`);
    const text = nt ? nt.value.trim() : '';
    insertRemarkRow(id, text ? { text } : undefined);
    if (nt) { nt.value = ''; checkUnfilled(id); }
    if (typeof updateTotals === 'function') updateTotals();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  function rowInsertInternalBelow(id) {
    const nt = document.getElementById(`nt-${id}`);
    const text = nt ? nt.value.trim() : '';
    insertInternalRow(id, text ? { text } : undefined);
    if (nt) { nt.value = ''; checkUnfilled(id); }
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }

  // 未入力行（row-unfilled）を一括削除
  function deleteEmptyRows() {
    // row-unfilled（名前空）かつ単価・請求単価もゼロの行のみ削除（E-8：価格入力済み行の誤削除防止）
    const empties = [...document.querySelectorAll('#tableBody tr.row-unfilled')].filter(tr => {
      if (tr.dataset.pending === '1') return false; // 要調査マーク行は誤削除しない
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
  // 行のパターン名（サブコン内の入れ子キー）。無ければ空
  function _rowPattern(tr) {
    if (!tr || tr.dataset.virtual || tr.dataset.type) return '';
    const id = tr.id?.replace('row-', '');
    return (document.getElementById(`pt-${id}`)?.value || '').trim();
  }
  // サブコン内の内側グループキー：パターン優先、無ければ港ペア（航路）
  function _rowInnerKey(tr) {
    return _rowPattern(tr) || (tr.dataset.portPair || '').trim();
  }
  function _rowInnerKind(tr) {
    // 港ペアはパターンへ一本化したため、内側キーがあれば常にパターン扱い（小計付き・🔖）
    return _rowInnerKey(tr) ? 'pattern' : '';
  }

  // ===== 最終更新日（lu）：見出し⇄行の集約・伝播 =====
  function _isoToday() {
    const d = new Date();
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }
  // サブコン（svKey）／サブコン×パターン（svKey+ptKey）に属する実データ行を返す
  function _groupMemberRows(svKey, ptKey) {
    return Array.from(document.querySelectorAll('#tableBody tr:not([data-virtual])'))
      .filter(tr => !tr.dataset.type && tr.id && tr.id.startsWith('row-'))
      .filter(tr => {
        const k = subconNormKey(_rowSubcon(tr) ?? '') || _UNSET_KEY;
        if (k !== svKey) return false;
        return ptKey ? (_rowInnerKey(tr) === ptKey) : true;
      });
  }
  // グループ配下の lu 集約：全行同値なら {value, mixed:false}、バラつき（空との混在含む）なら {value:'', mixed:true}
  function _groupUpdatedDate(svKey, ptKey) {
    const states = new Set();
    _groupMemberRows(svKey, ptKey).forEach(tr => {
      const id = tr.id.replace('row-', '');
      states.add((document.getElementById(`lu-${id}`)?.value || '').trim());
    });
    if (states.size <= 1) return { value: states.values().next().value || '', mixed: false };
    return { value: '', mixed: true };
  }
  // 見出しで設定した日付を配下の全行へ反映
  function _setGroupUpdatedDate(svKey, ptKey, dateStr) {
    _groupMemberRows(svKey, ptKey).forEach(tr => {
      const id = tr.id.replace('row-', '');
      const el = document.getElementById(`lu-${id}`);
      if (el) el.value = dateStr;
    });
    _syncGroupUpdatedHeaders();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  // 全グループ見出しの日付表示（入力値・「混在」バッジ）を現在の行から再計算（再描画不要）
  function _syncGroupUpdatedHeaders() {
    document.querySelectorAll('#tableBody tr.subcon-group-header, #tableBody tr.subcon-subgroup-header.is-pattern')
      .forEach(hdr => {
        const svKey = hdr.dataset.svKey || _UNSET_KEY;
        const ptKey = hdr.classList.contains('subcon-subgroup-header') ? (hdr.dataset.ptKey || '') : '';
        const info  = _groupUpdatedDate(svKey, ptKey);
        const inp   = hdr.querySelector('.grp-updated-input');
        const badge = hdr.querySelector('.grp-updated-mixed');
        if (inp)   inp.value = info.mixed ? '' : info.value;
        if (badge) badge.style.display = info.mixed ? '' : 'none';
      });
  }
  // 見出しに最終更新日コントロールを差し込み、初期値・ハンドラを設定する
  function _attachGroupUpdatedControl(hdr, svKey, ptKey) {
    const inp   = hdr.querySelector('.grp-updated-input');
    const today = hdr.querySelector('.grp-updated-today');
    const badge = hdr.querySelector('.grp-updated-mixed');
    if (!inp) return;
    const info = _groupUpdatedDate(svKey, ptKey);
    inp.value = info.mixed ? '' : info.value;
    if (badge) badge.style.display = info.mixed ? '' : 'none';
    inp.addEventListener('change', () => _setGroupUpdatedDate(svKey, ptKey, inp.value));
    inp.addEventListener('click', e => e.stopPropagation());   // 折りたたみトグル等への伝播を防ぐ
    if (today) today.addEventListener('click', e => {
      e.stopPropagation();
      inp.value = _isoToday();
      _setGroupUpdatedDate(svKey, ptKey, inp.value);
    });
  }
  // 見出しセル用の最終更新日コントロール HTML
  function _groupUpdatedHtml() {
    return `<span class="grp-updated" title="このグループの最終更新日（社内管理用・客先出力には含まれません）。設定すると配下の全行に反映されます。">` +
      `<span class="grp-updated-lbl">🕒 更新</span>` +
      `<input type="date" class="grp-updated-input" />` +
      `<button type="button" class="grp-updated-today" title="今日に一括設定">今日</button>` +
      `<span class="grp-updated-mixed" style="display:none">混在</span>` +
    `</span>`;
  }

  // ===== パターン入力：幹線輸送の航路チップ（POL→via→POD、サブコン=キャリア除く）をサジェスト =====
  function _patternRouteOptions() {
    try {
      const rts = JSON.parse(document.getElementById('z2-routes-data')?.value || '[]');
      const seen = new Set(), out = [];
      (Array.isArray(rts) ? rts : []).forEach(r => {
        const s = [r.pol, r.via, r.pod].map(x => (x || '').trim()).filter(Boolean).join(' → ');
        if (s && !seen.has(s)) { seen.add(s); out.push(s); }
      });
      return out;
    } catch (e) { return []; }
  }
  let _ptPopupEl = null;
  function _hidePtPopup() { if (_ptPopupEl) _ptPopupEl.hidden = true; }
  window._hidePtPopup = _hidePtPopup;
  function _ensurePtPopup() {
    if (_ptPopupEl) return _ptPopupEl;
    const p = document.createElement('div');
    p.id = 'ptRoutePopup'; p.className = 'pt-route-popup'; p.hidden = true;
    document.body.appendChild(p);
    document.addEventListener('mousedown', (e) => {
      if (_ptPopupEl && !_ptPopupEl.hidden && !_ptPopupEl.contains(e.target)
        && !(e.target.classList && e.target.classList.contains('w-pattern'))) _hidePtPopup();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') _hidePtPopup(); });
    window.addEventListener('scroll', _hidePtPopup, true);
    _ptPopupEl = p; return p;
  }
  function _showPatternPopup(input) {
    const opts = _patternRouteOptions();
    if (!opts.length) return;                 // 航路が無ければ出さない
    const p = _ensurePtPopup();
    p.innerHTML = '<div class="pt-route-popup-ttl">🚢 幹線航路からパターンを選択</div>' +
      opts.map(s => `<button type="button" class="pt-route-opt">${_escHdr(s)}</button>`).join('') +
      '<button type="button" class="pt-route-opt pt-route-clear">（パターンなしにする）</button>';
    Array.from(p.querySelectorAll('.pt-route-opt')).forEach((b, i) => {
      b.addEventListener('mousedown', (e) => {   // blur より先に発火させる
        e.preventDefault();
        input.value = b.classList.contains('pt-route-clear') ? '' : opts[i];
        input.dispatchEvent(new Event('change', { bubbles: true }));
        _hidePtPopup();
      });
    });
    const r = input.getBoundingClientRect();
    p.style.left = (window.scrollX + r.left) + 'px';
    p.style.top  = (window.scrollY + r.bottom + 2) + 'px';
    p.style.minWidth = Math.max(180, r.width) + 'px';
    p.hidden = false;
  }
  window._showPatternPopup = _showPatternPopup;

  // サブコン別グループヘッダーを再描画する
  // ---- 折りたたみ・除外状態（セッション中保持・再描画後も維持） ----
  const _UNSET_KEY       = '￿';
  const _collapsedGroups   = new Set();
  const _excludedGroups    = new Set();
  const _collapsedPatterns = new Set(); // svKey + '\x00' + ptKey
  const _excludedPatterns  = new Set(); // svKey + '\x00' + ptKey
  // サブコン別小計の「客先用表示名」（sv キー → 置換テキスト）。客先向け出力でサブコン名を隠すために使う。
  const _subconAlias     = Object.create(null);
  // グループ（サブコンブロック）ドラッグ並べ替え中の掴んでいるグループキー
  let _draggingGroupKey  = null;

  function toggleSubconGroup(key) {
    if (_collapsedGroups.has(key)) _collapsedGroups.delete(key);
    else                            _collapsedGroups.add(key);
    _applyGroupStates();
  }

  function toggleSubconExclude(key) {
    if (_excludedGroups.has(key)) {
      _excludedGroups.delete(key);
    } else {
      _excludedGroups.add(key);
      _collapsedGroups.add(key); // 除外時は自動折りたたみ
    }
    _applyGroupStates();
    if (typeof updateTotals === 'function') updateTotals();
    if (typeof window.updateSectionSummaries === 'function') window.updateSectionSummaries();
  }

  function togglePatternGroup(compKey) {
    if (_collapsedPatterns.has(compKey)) _collapsedPatterns.delete(compKey);
    else _collapsedPatterns.add(compKey);
    _applyGroupStates();
  }

  function togglePatternExclude(compKey) {
    if (_excludedPatterns.has(compKey)) {
      _excludedPatterns.delete(compKey);
    } else {
      _excludedPatterns.add(compKey);
      _collapsedPatterns.add(compKey); // 除外時は自動折りたたみ
    }
    _applyGroupStates();
    if (typeof updateTotals === 'function') updateTotals();
    if (typeof window.updateSectionSummaries === 'function') window.updateSectionSummaries();
  }

  function _applyGroupStates() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    // DOM 順に全行を走査し、直前の仮想ヘッダーのグループキーを引き継ぐ
    // → 小計・リマーク行は「直前のサブコングループ」に属するとして扱う
    let currentKey = null, currentCompKey = null;
    Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
      if (tr.dataset.ptSum) {
        // パターン小計行：所属サブコン折りたたみ OR パターン折りたたみに追従
        const svKey = tr.dataset.svKey || null;
        const ptKey = tr.dataset.ptKey || null;
        const compKey   = svKey && ptKey != null ? svKey + '\x00' + ptKey : null;
        const collapsed = (svKey && _collapsedGroups.has(svKey)) || (compKey && _collapsedPatterns.has(compKey));
        const excluded  = (svKey && _excludedGroups.has(svKey))  || (compKey && _excludedPatterns.has(compKey));
        tr.style.display = collapsed ? 'none' : '';
        tr.classList.toggle('is-collapsed', !!collapsed);
        tr.classList.toggle('is-excluded',  !!excluded);
        return;
      }
      if (tr.dataset.subSum) {
        // グループ小計行：自分の svKey の折りたたみ・除外状態に追従
        const key = tr.dataset.svKey || null;
        const collapsed = key && _collapsedGroups.has(key);
        const excluded  = key && _excludedGroups.has(key);
        tr.style.display = collapsed ? 'none' : '';
        tr.classList.toggle('is-collapsed', !!collapsed);
        tr.classList.toggle('is-excluded',  !!excluded);
        return;
      }
      if (tr.dataset.subGroup) {
        // パターンサブヘッダー：サブコン折りたたみ OR パターン折りたたみ/除外に追従
        const svKey = tr.dataset.svKey || null;
        const ptKey = tr.dataset.ptKey || null;
        const compKey   = svKey && ptKey != null ? svKey + '\x00' + ptKey : null;
        const scCollapsed = svKey && _collapsedGroups.has(svKey);
        const ptCollapsed = compKey && _collapsedPatterns.has(compKey);
        const excluded    = compKey && _excludedPatterns.has(compKey);
        tr.style.display = scCollapsed ? 'none' : '';
        tr.classList.toggle('is-collapsed', !!(scCollapsed || ptCollapsed));
        tr.classList.toggle('is-excluded',  !!excluded);
        const toggleBtn = tr.querySelector('.subcon-subgroup-toggle');
        const exclBtn   = tr.querySelector('.subcon-subgroup-excl');
        if (toggleBtn) toggleBtn.textContent = ptCollapsed ? '▶' : '▼';
        if (exclBtn) {
          exclBtn.textContent = excluded ? '含む' : '除外';
          exclBtn.classList.toggle('is-excluded', !!excluded);
        }
        currentCompKey = compKey;
        return;
      }
      if (tr.dataset.virtual) {
        currentKey = tr.dataset.svKey || null;
        currentCompKey = null; // サブコンヘッダーでパターン追跡をリセット
        if (!currentKey) return;
        const collapsed = _collapsedGroups.has(currentKey);
        const excluded  = _excludedGroups.has(currentKey);
        const toggleBtn = tr.querySelector('.subcon-group-toggle');
        const exclBtn   = tr.querySelector('.subcon-group-excl');
        if (toggleBtn) toggleBtn.textContent = collapsed ? '▶' : '▼';
        if (exclBtn) {
          exclBtn.textContent = excluded ? '含む' : '除外';
          exclBtn.classList.toggle('is-excluded', excluded);
        }
        tr.classList.toggle('is-collapsed', collapsed);
        tr.classList.toggle('is-excluded',  excluded);
        return;
      }
      if (!tr.dataset.type) {
        // データ行：サブコン除外 OR パターン除外を確認
        const sv        = _rowSubcon(tr) ?? '';
        const key       = subconNormKey(sv) || _UNSET_KEY;
        const scCollapsed = _collapsedGroups.has(key);
        const ptCollapsed = currentCompKey && _collapsedPatterns.has(currentCompKey);
        const scExcluded  = _excludedGroups.has(key);
        const ptExcluded  = currentCompKey && _excludedPatterns.has(currentCompKey);
        const collapsed   = scCollapsed || ptCollapsed;
        const excluded    = scExcluded  || ptExcluded;
        tr.style.display    = collapsed ? 'none' : '';
        tr.dataset.excluded = excluded ? '1' : '';
        tr.classList.toggle('row-excluded', excluded);
      } else if (tr.dataset.type === 'subtotal' || tr.dataset.type === 'remark' || tr.dataset.type === 'internal') {
        // 小計・リマーク・社内メモ行：DOM 上の位置で直前のグループに属する
        if (currentKey !== null) {
          const scCollapsed = _collapsedGroups.has(currentKey);
          const ptCollapsed = currentCompKey && _collapsedPatterns.has(currentCompKey);
          const scExcluded  = _excludedGroups.has(currentKey);
          const ptExcluded  = currentCompKey && _excludedPatterns.has(currentCompKey);
          const collapsed   = scCollapsed || ptCollapsed;
          const excluded    = scExcluded  || ptExcluded;
          tr.style.display    = collapsed ? 'none' : '';
          tr.dataset.excluded = excluded ? '1' : '';
          // ツリー帰属：レール表示用。リマーク・社内メモは明細の1段下（nested）
          tr.classList.add('subcon-grp-member');
          tr.classList.toggle('subcon-grp-nested',
            tr.dataset.type === 'remark' || tr.dataset.type === 'internal');
        } else {
          tr.style.display    = '';
          tr.dataset.excluded = '';
          tr.classList.remove('subcon-grp-member', 'subcon-grp-nested');
        }
      }
    });
  }
  // サブコングループ別アクセント色（案B：カードの左スパイン＋ヘッダーティント）。
  // 出現順にパレットを循環。同じサブコン名は再描画後も同色を維持（_grpColorMap でキャッシュ）。
  const _GRP_PALETTE = ['#b0772f', '#2a6f9e', '#3d7a52', '#9c5a3c', '#6f5aa0', '#1f7d8c', '#c2722e', '#4a6aa0'];
  const _grpColorMap = new Map();
  let _grpColorSeq = 0;
  function _groupAccent(key) {
    if (key === _UNSET_KEY) return '#b9a883';
    if (!_grpColorMap.has(key)) {
      _grpColorMap.set(key, _GRP_PALETTE[_grpColorSeq % _GRP_PALETTE.length]);
      _grpColorSeq++;
    }
    return _grpColorMap.get(key);
  }

  // - 仮想 TR（data-virtual）を全削除してから再挿入
  // - グループ順：出現順。未設定グループは末尾
  // - グループが 1 つ以下のとき（全行同サブコン or 全行未設定）はヘッダー不要
  function renderSubconGroups() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    // DOM 再構築でブラウザがスクロール位置をリセットするのを防ぐ
    const _savedScrollY = window.scrollY;
    _inGroupRender = true;
    try {
      // 既存の仮想ヘッダーを削除
      tbody.querySelectorAll('[data-virtual]').forEach(r => r.remove());

      // 実データ行を DOM 順に収集してサブコンごとにグルーピング
      const realRows = Array.from(tbody.querySelectorAll('tr:not([data-virtual])'))
        .filter(tr => !tr.dataset.type); // 小計・リマーク・社内メモは対象外
      if (!realRows.length) return;

      const groupOrder = [];
      const groups = Object.create(null);
      const groupLabel = Object.create(null);  // 正規化キー → 表示名（最初に出現した綴り）
      realRows.forEach(tr => {
        const svRaw = _rowSubcon(tr) ?? '';
        const key = subconNormKey(svRaw) || _UNSET_KEY;  // 揺らぎ吸収：正規化キーで判定
        if (!groups[key]) { groups[key] = []; groupOrder.push(key); groupLabel[key] = svRaw.trim(); }
        groups[key].push(tr);
      });

      // 港ペア（子グループ）の有無：サブコンが1つでも、港ペアが2つ以上あればグループ表示する
      const distinctPP = new Set(realRows.map(tr => _rowInnerKey(tr)).filter(Boolean));

      // サブコンが1つ以下かつ港ペアも1つ以下なら表示不要（折りたたみ状態はリセット）
      if (groupOrder.length < 2 && distinctPP.size < 2) {
        _collapsedGroups.clear();
        realRows.forEach(tr => { tr.style.display = ''; tr.classList.remove('subcon-child', 'subcon-subchild'); });
        // ツリー帰属クラス（リマーク・社内メモ・小計行）も解除
        tbody.querySelectorAll('.subcon-grp-member, .subcon-grp-nested')
          .forEach(tr => tr.classList.remove('subcon-grp-member', 'subcon-grp-nested'));
        return;
      }

      // グループ表示中：配下の各データ行をツリー風インデント（subcon-child）にする
      realRows.forEach(tr => tr.classList.add('subcon-child'));

      // 物理的にグループを連続化：同名サブコン行を1つのグループへ集約する。
      // （テーブル末尾に追加した同名サブコン行が、既存グループへ自動で移動する）
      // 各データ行に「直後の付随行（リマーク/社内メモ/手動小計）」を束ねたブロック単位で並べ替え、
      // グループの出現順・グループ内の並びを保持したまま DOM を再配置する。
      (function reorderToGroups() {
        const blocks  = [];   // { key, pp, rows: [dataTr, ...付随行] }
        const leading = [];   // 先頭データ行より前の非データ行（通常なし）
        let cur = null;
        // この時点で仮想行は削除済み。tbody 直下の行のみを走査
        Array.from(tbody.children).forEach(tr => {
          if (!tr.dataset.type) {                 // データ行
            const key = subconNormKey(_rowSubcon(tr) ?? '') || _UNSET_KEY;
            cur = { key, pp: _rowInnerKey(tr), rows: [tr] };
            blocks.push(cur);
          } else if (cur) {                       // 直前データ行の付随行
            cur.rows.push(tr);
          } else {                                // 先頭データ行より前の行
            leading.push(tr);
          }
        });
        const byKey = Object.create(null);
        blocks.forEach(b => { (byKey[b.key] || (byKey[b.key] = [])).push(b); });
        // サブコン内では港ペアの出現順でブロックを安定ソートし、同じ港ペアの行を連続させる
        Object.keys(byKey).forEach(k => {
          const ppOrder = [];
          byKey[k].forEach(b => { if (!ppOrder.includes(b.pp)) ppOrder.push(b.pp); });
          byKey[k].sort((a, b) => ppOrder.indexOf(a.pp) - ppOrder.indexOf(b.pp));
        });
        const frag = document.createDocumentFragment();
        leading.forEach(tr => frag.appendChild(tr));
        // groupOrder（出現順）に従ってブロックを再配置
        groupOrder.forEach(k => {
          (byKey[k] || []).forEach(b => b.rows.forEach(tr => frag.appendChild(tr)));
        });
        tbody.appendChild(frag);
      })();

      // reorder 後の DOM 順で groups を再構築（港ペア並べ替えで先頭/末尾行がずれるため、
      // ヘッダー/小計の挿入位置を DOM 順に正す）
      groupOrder.forEach(k => { groups[k] = []; });
      Array.from(tbody.children).forEach(tr => {
        if (tr.dataset.type || tr.dataset.virtual) return;
        const key = subconNormKey(_rowSubcon(tr) ?? '') || _UNSET_KEY;
        if (groups[key]) groups[key].push(tr);
      });

      // グループヘッダー TR を各グループの先頭行の直前に挿入
      groupOrder.forEach(key => {
        const label     = key === _UNSET_KEY ? '（サブコン未設定）' : (groupLabel[key] || '');
        const firstRow  = groups[key][0];
        const count     = groups[key].length;
        const collapsed = _collapsedGroups.has(key);
        const hdr = document.createElement('tr');
        hdr.dataset.virtual = '1';
        hdr.dataset.svKey   = key;
        hdr.className = 'subcon-group-header' + (collapsed ? ' is-collapsed' : '');
        const excluded = _excludedGroups.has(key);
        hdr.innerHTML =
          `<td colspan="10" class="subcon-group-header-cell">` +
            `<span class="subcon-group-grip" title="ドラッグでグループ（ブロック）を並び替え">⠿</span>` +
            `<button type="button" class="subcon-group-toggle" title="折りたたみ/展開">${collapsed ? '▶' : '▼'}</button>` +
            `<span class="subcon-group-label">📦 ${_escHdr(label)}</span>` +
            `<span class="subcon-group-count">${count} 行</span>` +
            `<span class="subcon-group-sum"></span>` +
            `<button type="button" class="subcon-group-excl${excluded ? ' is-excluded' : ''}" ` +
              `title="見積もりへの含める/除外を切り替え">${excluded ? '含む' : '除外'}</button>` +
            `<button type="button" class="subcon-group-add-btn" ` +
              `data-sv="${_escAttr(key === _UNSET_KEY ? '' : label)}" ` +
              `title="${_escAttr(label)} に行を追加">＋</button>` +
            `<button type="button" class="subcon-group-sort-btn" title="このグループ内をカテゴリ順に並び替え">⇅カテゴリ</button>` +
            _groupUpdatedHtml() +
          `</td>`;
        hdr.querySelector('.subcon-group-toggle').addEventListener('click', () => toggleSubconGroup(key));
        hdr.querySelector('.subcon-group-excl').addEventListener('click', () => toggleSubconExclude(key));
        hdr.querySelector('.subcon-group-add-btn').addEventListener('click', () => {
          addRowToSubconGroup(key === _UNSET_KEY ? '' : label);
        });
        hdr.querySelector('.subcon-group-sort-btn').addEventListener('click', e => {
          e.stopPropagation();
          sortGroupByCategory(key, '');
        });
        _attachGroupUpdatedControl(hdr, key, '');
        initGroupHeaderDrag(hdr, key);
        // 案B：グループ別アクセント色をヘッダー＋配下データ行に伝播（左スパイン／ティント用）
        const _accent = _groupAccent(key);
        hdr.style.setProperty('--grp-accent', _accent);
        groups[key].forEach(tr => tr.style.setProperty('--grp-accent', _accent));
        tbody.insertBefore(hdr, firstRow);
      });

      // 各グループの末尾行の直後に、グループ小計の仮想行（data-virtual）を挿入。
      // 金額は _updateGroupSums で同期。保存・CSV/Excel/PDF 出力には含まれない。
      groupOrder.forEach(key => {
        const label    = key === _UNSET_KEY ? '（サブコン未設定）' : (groupLabel[key] || '');
        const lastRow  = groups[key][groups[key].length - 1];
        const sub = document.createElement('tr');
        sub.dataset.virtual = '1';
        sub.dataset.svKey   = key;
        sub.dataset.subSum  = '1';
        sub.className = 'subcon-group-subtotal';
        sub.innerHTML =
          `<td colspan="10" class="subcon-group-subtotal-cell">` +
            `<div class="subcon-subtotal-inner">` +
              `<span class="subcon-subtotal-label">↳ ${_escHdr(label)} 小計</span>` +
              `<span class="st-metric st-cost"><i>仕入合計</i><b class="subcon-subtotal-cost">¥0</b></span>` +
              `<span class="st-metric st-sell"><i>売値合計</i><b class="subcon-subtotal-sum">¥0</b></span>` +
              `<span class="st-metric st-margin"><i>粗利率</i><b class="subcon-subtotal-margin">—</b></span>` +
              `<span class="st-alias" title="客先向け出力（プレビュー・御見積書PDF）で、この小計の「${_escAttr(label)}」をここに入力した名前へ置換します。空欄ならサブコン名のまま。">` +
                `<i>客先表示名</i>` +
                `<input type="text" class="subcon-alias-input" placeholder="例）国内諸費用 一式（任意）" value="${_escAttr(_subconAlias[key] || '')}" />` +
              `</span>` +
            `</div>` +
          `</td>`;
        // 末尾行の次（既存の小計・リマーク行があればその手前）に挿入
        const aliasInp = sub.querySelector('.subcon-alias-input');
        if (aliasInp) {
          aliasInp.addEventListener('input', () => {
            const v = aliasInp.value.trim();
            if (v) _subconAlias[key] = v; else delete _subconAlias[key];
            if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
          });
          // 入力欄クリックで折りたたみ等の親ハンドラに伝播しないように
          aliasInp.addEventListener('click', e => e.stopPropagation());
        }
        // lastRow の直後に付随する typed 行（社内メモ・備考等）をスキップして小計を挿入
        let lastGroupRow = lastRow;
        let nextSib = lastGroupRow.nextSibling;
        while (nextSib && !nextSib.dataset.virtual && nextSib.dataset.type) {
          lastGroupRow = nextSib;
          nextSib = lastGroupRow.nextSibling;
        }
        sub.style.setProperty('--grp-accent', _groupAccent(key));
        tbody.insertBefore(sub, lastGroupRow.nextSibling);
      });
      // 内側グループ（サブコン配下のパターン／港ペア）を挿入：
      //   ・境界に区切り見出し（🔖 パターン ／ 🛳 港ペア）を入れ、配下行を深インデント化。
      //   ・パターンの内側グループには末尾に小計行（data-ptSum）も挿入し、入れ子テーブル化する。
      (function insertInnerGroups() {
        let curSvKey = null, curKey = null, curKind = null, runOpen = false;
        const closeRun = (beforeNode) => {
          if (runOpen && curKind === 'pattern' && curKey) {
            const sub = document.createElement('tr');
            sub.dataset.virtual = '1';
            sub.dataset.ptSum   = '1';
            sub.dataset.svKey   = curSvKey || _UNSET_KEY;
            sub.dataset.ptKey   = curKey || '';
            sub.className = 'subcon-pattern-subtotal';
            sub.innerHTML =
              `<td colspan="10" class="subcon-pattern-subtotal-cell">` +
                `<div class="subcon-subtotal-inner subcon-subtotal-inner--pt">` +
                  `<span class="subcon-subtotal-label">↳ 🔖 ${_escHdr(curKey)} 小計</span>` +
                  `<span class="st-metric st-cost"><i>仕入合計</i><b class="subcon-subtotal-cost">¥0</b></span>` +
                  `<span class="st-metric st-sell"><i>売値合計</i><b class="subcon-subtotal-sum">¥0</b></span>` +
                  `<span class="st-metric st-margin"><i>粗利率</i><b class="subcon-subtotal-margin">—</b></span>` +
                `</div>` +
              `</td>`;
            tbody.insertBefore(sub, beforeNode);
          }
          runOpen = false; curKey = null; curKind = null;
        };
        Array.from(tbody.children).forEach(tr => {
          if (tr.dataset.ptSum) return;             // 既存のパターン小計（再描画では作り直し済み）
          if (tr.dataset.subSum) { closeRun(tr); return; }  // サブコン小計の直前で内側を締める
          if (tr.dataset.virtual) {                 // サブコングループ見出し → 新サブコン
            closeRun(tr);
            if (tr.classList.contains('subcon-group-header')) curSvKey = tr.dataset.svKey || _UNSET_KEY;
            return;
          }
          if (tr.dataset.type) return;              // 付随行（リマーク等）は直前の内側グループに属する
          const key = _rowInnerKey(tr), kind = _rowInnerKind(tr);
          if (key) {
            tr.classList.add('subcon-subchild');
            if (!runOpen || key !== curKey) {
              closeRun(tr);                          // 直前の内側グループを締める（小計を tr の前に挿入）
              const sh = document.createElement('tr');
              const _svK = curSvKey || _UNSET_KEY;
              const _compK = _svK + '\x00' + key;
              const _ptCollapsed = _collapsedPatterns.has(_compK);
              const _ptExcluded  = _excludedPatterns.has(_compK);
              sh.dataset.virtual  = '1';
              sh.dataset.subGroup = '1';
              sh.dataset.svKey    = _svK;
              sh.dataset.ptKey    = key;
              sh.className = 'subcon-subgroup-header is-pattern' + (_ptExcluded ? ' is-excluded' : '');
              const icon = '🔖';
              sh.innerHTML =
                `<td colspan="10" class="subcon-subgroup-cell">` +
                  `<button type="button" class="subcon-subgroup-toggle" title="${_ptCollapsed ? '展開' : '折りたたみ/展開'}">${_ptCollapsed ? '▶' : '▼'}</button>` +
                  `<span class="subcon-subgroup-leg">${icon} ${_escHdr(key)}</span>` +
                  `<button type="button" class="subcon-subgroup-excl${_ptExcluded ? ' is-excluded' : ''}" title="見積もりへの含める/除外を切り替え">${_ptExcluded ? '含む' : '除外'}</button>` +
                  `<button type="button" class="subcon-group-sort-btn" title="このパターン内をカテゴリ順に並び替え">⇅カテゴリ</button>` +
                  _groupUpdatedHtml() +
                `</td>`;
              sh.querySelector('.subcon-subgroup-toggle').addEventListener('click', () => togglePatternGroup(_compK));
              sh.querySelector('.subcon-subgroup-excl').addEventListener('click', () => togglePatternExclude(_compK));
              sh.querySelector('.subcon-group-sort-btn').addEventListener('click', e => {
                e.stopPropagation();
                sortGroupByCategory(_svK, key);
              });
              _attachGroupUpdatedControl(sh, _svK, key);
              tbody.insertBefore(sh, tr);
              curKey = key; curKind = kind; runOpen = true;
            }
          } else {
            closeRun(tr);
            tr.classList.remove('subcon-subchild');
          }
        });
        closeRun(null);   // 末尾グループを締める
      })();

      // 全行の折りたたみ・除外状態を適用（小計・リマーク行を含む）
      _applyGroupStates();
      _updateGroupSums();
    } finally {
      _inGroupRender = false;
      // DOM 再構築後にスクロール位置を復元（パターン変更時のページトップへの強制移動を防ぐ）
      if (window.scrollY !== _savedScrollY) window.scrollTo({ top: _savedScrollY, behavior: 'instant' });
      // 右サマリ「要約」のテーブル内ジャンプリンクをグループ構成に追従させる
      if (typeof window.renderQuoteSectionDigest === 'function') window.renderQuoteSectionDigest();
    }
  }

  // ---- グループ（サブコンブロック）のドラッグ並べ替え ----
  // グループヘッダーのグリップを掴んでドラッグし、別グループのヘッダー上にドロップすると、
  // 掴んだグループの配下行（データ行＋付随する社内メモ/備考/小計行）をブロックごと移動する。
  function initGroupHeaderDrag(hdr, key) {
    hdr.setAttribute('draggable', 'true');
    const grip = hdr.querySelector('.subcon-group-grip');
    let _fromGrip = false;
    if (grip) {
      grip.addEventListener('mousedown', () => { _fromGrip = true; });
      document.addEventListener('mouseup', () => { _fromGrip = false; }, { capture: true });
    }
    const clearMarks = () => document.querySelectorAll('#tableBody .subcon-group-header')
      .forEach(h => h.classList.remove('grp-drop-before', 'grp-drop-after'));

    hdr.addEventListener('dragstart', e => {
      if (!grip || !_fromGrip) { e.preventDefault(); return; }
      _fromGrip = false;
      _draggingGroupKey = key;
      hdr.classList.add('grp-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', 'grp:' + key); } catch (_) {}
    });
    hdr.addEventListener('dragend', () => {
      _draggingGroupKey = null;
      hdr.classList.remove('grp-dragging');
      clearMarks();
    });
    hdr.addEventListener('dragover', e => {
      if (_draggingGroupKey == null || _draggingGroupKey === key) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const r = hdr.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      clearMarks();
      hdr.classList.add(after ? 'grp-drop-after' : 'grp-drop-before');
    });
    hdr.addEventListener('dragleave', () =>
      hdr.classList.remove('grp-drop-before', 'grp-drop-after'));
    hdr.addEventListener('drop', e => {
      if (_draggingGroupKey == null || _draggingGroupKey === key) return;
      e.preventDefault();
      e.stopPropagation();
      const r = hdr.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      const src = _draggingGroupKey;
      clearMarks();
      moveSubconGroupBlock(src, key, after);
    });
  }

  // srcKey のグループブロックを targetKey の前／後ろへ移動して再描画する
  function moveSubconGroupBlock(srcKey, targetKey, placeAfter) {
    const tbody = document.getElementById('tableBody');
    if (!tbody || srcKey === targetKey) return;
    _inGroupRender = true;
    try {
      // 仮想行（ヘッダー・小計）を一旦除去して実行行ブロックのみで並べ替える
      tbody.querySelectorAll('[data-virtual]').forEach(r => r.remove());

      // ブロック化：データ行＋直後の付随行（社内メモ/備考/手動小計）を1単位に
      const blocks = [];
      const leading = [];
      let cur = null;
      Array.from(tbody.children).forEach(tr => {
        if (!tr.dataset.type) {
          const k = subconNormKey(_rowSubcon(tr) ?? '') || _UNSET_KEY;
          cur = { key: k, rows: [tr] };
          blocks.push(cur);
        } else if (cur) {
          cur.rows.push(tr);
        } else {
          leading.push(tr);
        }
      });

      // 現在のグループ出現順
      const keyOrder = [];
      blocks.forEach(b => { if (!keyOrder.includes(b.key)) keyOrder.push(b.key); });
      const without = keyOrder.filter(k => k !== srcKey);
      const ti = without.indexOf(targetKey);
      if (ti < 0) { return; }   // 対象が見つからなければ何もしない（finally で復帰）
      without.splice(placeAfter ? ti + 1 : ti, 0, srcKey);

      // 新しい順でブロックを再配置
      const byKey = Object.create(null);
      blocks.forEach(b => { (byKey[b.key] || (byKey[b.key] = [])).push(b); });
      const frag = document.createDocumentFragment();
      leading.forEach(tr => frag.appendChild(tr));
      without.forEach(k => (byKey[k] || []).forEach(b => b.rows.forEach(tr => frag.appendChild(tr))));
      tbody.appendChild(frag);
    } finally {
      _inGroupRender = false;
    }
    renderSubconGroups();   // ヘッダー・小計を新しい順で再生成
    if (typeof updateTotals === 'function') updateTotals();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }

  // 各サブコングループヘッダーに、その配下データ行の請求小計合計（¥）を表示する。
  // DOM 順に走査し、仮想ヘッダーごとに直後のデータ行の billing 小計（bq×bp）を集計。
  // 非 JPY 行は toJPY があれば換算して合算（無ければ素の値）。
  function _updateGroupSums() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    // サブコン小計（外側）とパターン小計（内側）の2階層を同時集計する
    let scSumEl = null, scSubRow = null, scSell = 0, scCost = 0, scMixed = false;
    let ptSell = 0, ptCost = 0, ptMixed = false;
    const writeSub = (row, sell, cost, mixed) => {
      const mark = mixed ? '※' : '';
      const ttl = mixed ? '複数通貨を JPY 換算して合算（FX パネルのレート使用）' : '';
      const cEl = row.querySelector('.subcon-subtotal-cost');
      const sEl = row.querySelector('.subcon-subtotal-sum');
      const mEl = row.querySelector('.subcon-subtotal-margin');
      if (cEl) { cEl.textContent = '¥' + fmt(Math.round(cost)) + mark; cEl.title = ttl; }
      if (sEl) { sEl.textContent = '¥' + fmt(Math.round(sell)) + mark; sEl.title = ttl; }
      if (mEl) {
        if (Math.round(sell) > 0) {
          const m = (sell - cost) / sell * 100;
          mEl.textContent = m.toFixed(1) + '%';
          mEl.classList.toggle('is-neg', m < 0);
        } else { mEl.textContent = '—'; mEl.classList.remove('is-neg'); }
      }
    };
    const flushSc = () => {
      const ttl = scMixed ? '複数通貨を JPY 換算して合算（FX パネルのレート使用）' : '';
      if (scSumEl) { const s = Math.round(scSell); scSumEl.textContent = s ? '¥' + fmt(s) + (scMixed ? '※' : '') : ''; scSumEl.title = ttl; }
      if (scSubRow) writeSub(scSubRow, scSell, scCost, scMixed);
    };
    const resetPt = () => { ptSell = 0; ptCost = 0; ptMixed = false; };
    Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
      if (tr.dataset.ptSum) {                // パターン小計行：内側累計を書き込み、内側だけリセット
        writeSub(tr, ptSell, ptCost, ptMixed);
        resetPt();
        return;
      }
      if (tr.dataset.subGroup) { resetPt(); return; }  // 内側グループ見出し：内側累計を開始（透過）
      if (tr.dataset.subSum) {               // サブコン小計行
        scSubRow = tr; flushSc(); return;
      }
      if (tr.dataset.virtual) {              // サブコングループ見出し
        flushSc();
        scSumEl = tr.querySelector('.subcon-group-sum');
        scSubRow = null; scSell = 0; scCost = 0; scMixed = false; resetPt();
        return;
      }
      if (tr.dataset.type) return;           // 小計・リマーク・社内メモ行は除外
      if (tr.dataset.hideQuote === '1') return;
      if (tr.dataset.outRange === '1') return;
      if (tr.dataset.actual === '1') return;
      if (tr.dataset.profitShare === '1') return;   // PROFIT SHARE は客先小計から除外
      if (tr.dataset.cond === '1') return;          // 都度請求は客先小計から除外
      const id = tr.id?.replace('row-', '');
      if (!id || !scSumEl) return;
      const bq = val(`bq-${id}`) || val(`pq-${id}`) || 0;
      const bp = val(`bp-${id}`) || 0;
      const pp = val(`pp-${id}`) || 0;
      let sell = bq * bp, cost = bq * pp;
      const bc = document.getElementById(`bc-${id}`)?.value || 'JPY';
      const pc = document.getElementById(`pc-${id}`)?.value || 'JPY';
      let mixed = false;
      if (bc !== 'JPY') { mixed = true; if (typeof toJPY === 'function') sell = toJPY(sell, bc); }
      if (pc !== 'JPY') { mixed = true; if (typeof toJPY === 'function') cost = toJPY(cost, pc); }
      scSell += sell; scCost += cost; if (mixed) scMixed = true;
      ptSell += sell; ptCost += cost; if (mixed) ptMixed = true;
    });
    flushSc();
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
    // グループの末尾行を探す（揺らぎ吸収：正規化キーで一致判定）
    const targetKey = subconNormKey(sv);
    let lastInGroup = null;
    realRows.forEach(tr => {
      const rowSv = _rowSubcon(tr) ?? '';
      if (subconNormKey(rowSv) === targetKey) lastInGroup = tr;
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
  window.addRowToSubconGroup  = addRowToSubconGroup;
  window.toggleSubconGroup    = toggleSubconGroup;
  window.toggleSubconExclude  = toggleSubconExclude;
  // サブコン別小計の「客先用表示名」マップ（保存・復元・客先出力で参照）
  window.getSubconAliases = () => Object.assign({}, _subconAlias);
  window.setSubconAliases = (obj) => {
    Object.keys(_subconAlias).forEach(k => delete _subconAlias[k]);
    if (obj && typeof obj === 'object') {
      // 旧プリセットは生の綴りでキー化されている場合があるため正規化キーへ寄せる（idempotent）
      Object.keys(obj).forEach(k => {
        if (!obj[k]) return;
        const nk = subconNormKey(k) || k;
        _subconAlias[nk] = obj[k];
      });
    }
  };

  // ========== 行クリップボード（任意位置貼り付け） ==========
  let _rowClipboard = [];

  function _gatherRowData(id) {
    const data = {};
    ['nm','pq','un','pp','mk','nt','sv','pt','zc','ac','ps','co','vf','vt','lu','cat','pc','bc'].forEach(f => {
      const el = document.getElementById(`${f}-${id}`);
      if (el) data[f] = el.value;
    });
    data.tx = !!document.getElementById(`tx-${id}`)?.checked;
    return data;
  }

  function _pasteOneRow(data, insertBefore) {
    rowCount++;
    const newId = rowCount;
    const newTr = document.createElement('tr');
    newTr.id = `row-${newId}`;
    newTr.replaceChildren(buildRowHTML(newId, data.cat || '', data.pc || 'JPY', data.sv || ''));
    const tbody = document.getElementById('tableBody');
    if (insertBefore?.parentNode === tbody) {
      tbody.insertBefore(newTr, insertBefore);
    } else {
      tbody.appendChild(newTr);
    }
    ['nm','pq','un','pp','mk','nt','pt','zc','ac','ps','co','vf','vt','lu'].forEach(f => {
      const el = document.getElementById(`${f}-${newId}`);
      if (el && data[f] !== undefined) el.value = data[f];
    });
    ['cat','pc','bc'].forEach(f => {
      const el = document.getElementById(`${f}-${newId}`);
      if (el && data[f] !== undefined) el.value = data[f];
    });
    initDrag(newTr);
    onCatChange(newId);
    if (data.tx) toggleTax(newId);
    checkUnfilled(newId);
    onPay(newId);
    return newId;
  }

  function _syncClipboardUI() {
    const count = _rowClipboard.length;
    const ind = document.getElementById('clipboardIndicator');
    if (ind) {
      ind.hidden = count === 0;
      const cnt = document.getElementById('clipIndicatorCount');
      if (cnt) cnt.textContent = count;
    }
    const pasteBtn = document.getElementById('btnPasteClipboard');
    if (pasteBtn) pasteBtn.disabled = count === 0;
  }

  window.copyRowsToClipboard = function () {
    const checkboxes = document.querySelectorAll('.row-select-chk:checked');
    if (!checkboxes.length) {
      quoteShowToast('⚠️ コピーしたい行のチェックボックスにチェックを入れてください', 'warn', 3000);
      return;
    }
    const srcRows = Array.from(checkboxes)
      .map(chk => chk.closest('tr'))
      .filter(tr => tr && !tr.dataset.type);
    if (!srcRows.length) {
      quoteShowToast('⚠️ 小計行・リマーク行はコピーできません。通常行を選択してください', 'warn', 3000);
      return;
    }
    _rowClipboard = srcRows.map(tr => _gatherRowData(tr.id.replace('row-', ''))).filter(Boolean);
    _syncClipboardUI();
    quoteShowToast(`📋 ${_rowClipboard.length}行を保持しました。挿入したい行を選択して「📌 貼付」を押してください`, 'success', 4000);
  };

  window.pasteClipboardRows = function () {
    if (!_rowClipboard.length) {
      quoteShowToast('⚠️ クリップボードが空です。先に行を選択して「📋 保持」してください', 'warn', 3000);
      return;
    }
    const checkboxes = document.querySelectorAll('.row-select-chk:checked');
    const insertBefore = checkboxes.length ? checkboxes[0].closest('tr') : null;
    _rowClipboard.forEach(data => _pasteOneRow(data, insertBefore));
    updateTotals();
    quoteShowToast(`📌 ${_rowClipboard.length}行を貼り付けました`, 'success');
    _rowClipboard = [];
    _syncClipboardUI();
    window.refreshRowSelectionMode?.();
  };

  window.clearRowClipboard = function () {
    _rowClipboard = [];
    _syncClipboardUI();
    quoteShowToast('クリップボードをクリアしました', 'info', 2000);
  };

  window.syncClipboardUI = _syncClipboardUI;

  // ローカルチャージから見積行を一括追加（local-charges.js から呼ぶ）
  window.addChargeRows = function (charges) {
    if (!charges || !charges.length) return;
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    const lastPc = document.querySelector('#tableBody tr:last-child [id^="pc-"]');
    const lastCur = lastPc?.value || 'JPY';
    charges.forEach(ch => {
      rowCount++;
      const id = rowCount;
      const tr = document.createElement('tr');
      tr.id = 'row-' + id;
      tr.replaceChildren(buildRowHTML(id, ch.cat || '', ch.currency || lastCur, ch.sv || ''));
      tbody.appendChild(tr);
      const set = (prefix, val) => { const e = document.getElementById(prefix + id); if (e) e.value = val ?? ''; };
      set('nm-', ch.name  || '');
      set('nt-', ch.note  || '');
      set('un-', ch.unit  || '');
      set('pp-', ch.amount != null ? ch.amount : '');
      set('bp-', ch.amount != null ? ch.amount : '');
      // 通貨を両欄に適用
      const pcEl = document.getElementById('pc-' + id);
      if (pcEl) pcEl.value = ch.currency || lastCur;
      initDrag(tr);
      onCatChange(id);
      onPay(id);
    });
    updateTotals();
    if (typeof quoteShowToast === 'function')
      quoteShowToast('✅ ローカルチャージ ' + charges.length + '件を追加しました', 'success');
  };
