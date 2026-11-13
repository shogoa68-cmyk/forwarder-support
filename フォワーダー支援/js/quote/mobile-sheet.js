// スマホ幅の見積もりテーブル・段階 2＝編集シート（Design 2026-11-09）。行をタップすると下から開き、その行の入力欄（data-field）を読み書きするだけ。
// データの持ち方は変えない：シートの入力は該当行の欄へ書き込み、input／change を発火して既存の計算・小計・保存の処理をそのまま動かす。
// 状態・操作のボタンは、行の既存ボタン（row-hidequote-btn など）を click して同じ関数を呼ぶ。行の DOM に <tr> は足さない。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rowsNow = () => Array.from(document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])'));
  const fld = (tr, k) => tr && tr.querySelector('[data-field="' + k + '"]');
  let sheet = null, curId = null, obs = null;

  // 状態ボタン（行の既存ボタンを呼ぶ）と、「その他」の単価オプション
  const STATE = [['hide', '見積書に出さない', '.row-hidequote-btn', r => r.dataset.hideQuote === '1'], ['pend', '🔍 要調査', '.row-pending-btn', r => r.dataset.pending === '1'], ['done', '✓ 入力完了', '.row-done-btn', r => r.dataset.done === '1']];
  const MODES = [['.zero-confirm-btn', 'あえて¥0'], ['.actual-cost-btn', '実費'], ['.profit-share-btn', 'PS'], ['.cond-charge-btn', '必要時'], ['.ref-info-btn', '参考'], ['.est-btn', '概算'], ['.sell-mode-btn', '売値ベース']];
  const TABLE_MODES = [['.pct-mode-btn', '％'], ['.min-mode-btn', 'MIN'], ['.range-mode-btn', '幅'], ['.ic-mode-btn', '貿易条件'], ['.cn-mode-btn', '表示条件']];
  const isOn = b => !!b && (b.classList.contains('is-on') || b.classList.contains('active') || b.classList.contains('on') || b.getAttribute('aria-pressed') === 'true');

  function build() {
    if (sheet) return;
    sheet = document.createElement('div'); sheet.id = 'mcSheet'; sheet.className = 'mcs-overlay'; sheet.hidden = true;
    sheet.innerHTML =
      '<div class="mcs-box" role="dialog" aria-modal="true" aria-label="明細の編集">' +
      '<div class="mcs-head"><button type="button" class="mcs-nav" data-nav="-1" aria-label="前の行">‹</button><span class="mcs-pos" id="mcsPos"></span><button type="button" class="mcs-nav" data-nav="1" aria-label="次の行">›</button><button type="button" class="mcs-done" id="mcsDone">完了</button></div>' +
      '<div class="mcs-body">' +
      '<label class="mcs-f">品名 <b class="req">*</b><input type="text" id="mcs-nm" data-bind="nm" list="nmSuggestions" autocomplete="off"></label>' +
      '<div class="mcs-grid"><label class="mcs-f">カテゴリ<select id="mcs-cat" data-bind="cat"></select></label>' +
      '<label class="mcs-f">サブコン <small>任意</small><input type="text" id="mcs-sv" data-bind="sv" list="svSuggestions" autocomplete="off"></label>' +
      '<label class="mcs-f">パターン <small>任意</small><input type="text" id="mcs-pt" data-bind="pt" autocomplete="off"></label></div>' +
      '<div class="mcs-sect">数量・金額</div>' +
      '<div class="mcs-grid"><label class="mcs-f">数量<input type="number" inputmode="decimal" id="mcs-pq" data-bind="pq" min="0"></label>' +
      '<label class="mcs-f">単位<input type="text" id="mcs-un" data-bind="un" list="unit-list" autocomplete="off"></label></div>' +
      '<div class="mcs-grid"><label class="mcs-f"><span class="mcs-tag t-cost">仕</span> 通貨<select id="mcs-pc" data-bind="pc"></select></label>' +
      '<label class="mcs-f"><span class="mcs-tag t-cost">仕</span> 仕入単価<input type="number" inputmode="decimal" id="mcs-pp" data-bind="pp" min="0"></label></div>' +
      '<div class="mcs-grid"><label class="mcs-f">＋ 乗せ幅<input type="number" inputmode="decimal" id="mcs-mk" data-bind="mk" min="0"></label>' +
      '<label class="mcs-f"><span class="mcs-tag t-sell">売</span> 通貨<select id="mcs-bc" data-bind="bc"></select></label></div>' +
      '<div class="mcs-calc"><span>売単価 <b id="mcs-bp">—</b></span><span>売金額 <b id="mcs-st">—</b></span></div>' +
      '<div class="mcs-cd" id="mcs-cd" hidden>仕入と売値の通貨が違います。CD（通貨差調整値）は「その他」で確認できます。</div>' +
      '<label class="mcs-f">備考 <small>任意</small><input type="text" id="mcs-nt" data-bind="nt" autocomplete="off"></label>' +
      '<div class="mcs-row2"><button type="button" class="mcs-btn" data-act="rem">💬 備考行を下に挿入</button><button type="button" class="mcs-btn" data-act="int">🔒 社内メモを下に挿入</button></div>' +
      '<div class="mcs-sect">状態</div><div class="mcs-row3" id="mcsState"></div><div class="mcs-doneinfo" id="mcsDoneInfo" hidden></div>' +
      '<details class="mcs-more" id="mcsMore"><summary>その他</summary>' +
      '<div class="mcs-grid"><label class="mcs-f">有効期間（開始）<input type="date" id="mcs-vf" data-bind="vf"></label><label class="mcs-f">有効期間（終了）<input type="date" id="mcs-vt" data-bind="vt"></label></div>' +
      '<div class="mcs-sect">単価のオプション</div><div class="mcs-chips" id="mcsModes"></div>' +
      '<div class="mcs-sect">表で設定する項目</div><div class="mcs-chips" id="mcsTableModes"></div>' +
      '</details>' +
      '<div class="mcs-sect">操作</div><div class="mcs-row3"><button type="button" class="mcs-btn" data-act="add">➕ 直下に追加</button><button type="button" class="mcs-btn" data-act="dup">📋 複製</button><button type="button" class="mcs-btn is-danger" data-act="del">🗑️ 削除</button></div>' +
      '</div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
    $('mcsDone').addEventListener('click', close);
    sheet.querySelectorAll('.mcs-nav').forEach(b => b.addEventListener('click', () => go(+b.dataset.nav)));
    // 入力 → 行の欄へ（input／change を発火して既存の計算を走らせる）
    sheet.querySelectorAll('[data-bind]').forEach(el => {
      const send = ev => { const tr = $(curId), t = fld(tr, el.dataset.bind); if (!t) return; if (t.value !== el.value) t.value = el.value; t.dispatchEvent(new Event(ev, { bubbles: true })); };
      el.addEventListener('input', () => send('input')); el.addEventListener('change', () => { send('change'); refreshCalc(); });
    });
    sheet.addEventListener('click', e => {
      const a = e.target.closest('[data-act]'); if (!a) return; const tr = $(curId); if (!tr) return;
      const act = a.dataset.act;
      if (act === 'rem') tr.querySelector('.btn-row-rem')?.click();
      else if (act === 'int') tr.querySelector('.btn-row-int')?.click();
      else if (act === 'add' || act === 'dup') {
        const before = new Set(rowsNow().map(r => r.id));
        (tr.querySelector(act === 'add' ? '.row-add-btn' : '.row-dup-btn'))?.click();
        setTimeout(() => { const nu = rowsNow().find(r => !before.has(r.id)); if (nu) open(nu.id); }, 60);
      } else if (act === 'del') {
        const list = rowsNow(), i = list.findIndex(r => r.id === curId), next = list[i + 1] || list[i - 1];
        const n0 = list.length; tr.querySelector('.row-del-btn')?.click();
        setTimeout(() => { if (rowsNow().length < n0) { if (next && $(next.id)) open(next.id); else close(); } }, 60);
      }
    });
    sheet.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet && !sheet.hidden) close(); });
  }

  function copyOptions(sel, src) { if (!src) return; sel.innerHTML = src.innerHTML; }
  function fill() {
    const tr = $(curId); if (!tr) return;
    sheet.querySelectorAll('select[data-bind]').forEach(sel => copyOptions(sel, fld(tr, sel.dataset.bind)));
    sheet.querySelectorAll('[data-bind]').forEach(el => { const t = fld(tr, el.dataset.bind); if (t && document.activeElement !== el) el.value = t.value; });
    refreshCalc(); renderStates(tr);
    const list = rowsNow(), i = list.findIndex(r => r.id === curId);
    $('mcsPos').textContent = (i + 1) + ' / ' + list.length + ' 行目';
    sheet.querySelector('[data-nav="-1"]').disabled = i <= 0; sheet.querySelector('[data-nav="1"]').disabled = i >= list.length - 1;
  }
  function refreshCalc() {
    const tr = $(curId); if (!tr) return;
    $('mcs-bp').textContent = (fld(tr, 'bp')?.value || '—') + ' ' + (fld(tr, 'bc')?.value || '');
    const st = (fld(tr, 'st')?.textContent || '').trim(); const m = /^[^\d\-]*\d[\d,\.]*(?:\s*[〜~]\s*[^\d\-]*\d[\d,\.]*)?/.exec(st);
    $('mcs-st').textContent = (m ? m[0].trim() : st || '—') + ' ' + (fld(tr, 'bc')?.value || '');
    $('mcs-cd').hidden = (fld(tr, 'pc')?.value || '') === (fld(tr, 'bc')?.value || '');
    const bp = $('mcs-bp'); const ro = sheet.querySelector('#mcs-mk'); if (ro) ro.disabled = false;
  }
  function renderStates(tr) {
    $('mcsState').innerHTML = STATE.map(([k, label, sel, on]) => '<button type="button" class="mcs-tg' + (on(tr) ? ' is-on' : '') + '" data-state="' + k + '" aria-pressed="' + (on(tr) ? 'true' : 'false') + '">' + esc(label) + '</button>').join('');
    { const di = $('mcsDoneInfo'), inf = tr.dataset.done === '1' && typeof window.rowDoneInfo === 'function' ? window.rowDoneInfo(tr) : null;   // 入力完了を押した日時・ユーザー
      if (di) { di.textContent = inf ? '✓ 入力完了：' + inf.text : ''; di.hidden = !inf; } }
    $('mcsModes').innerHTML = MODES.map(([sel, label]) => { const b = tr.querySelector(sel); return b ? '<button type="button" class="mcs-tg' + (isOn(b) ? ' is-on' : '') + '" data-mode="' + esc(sel) + '" aria-pressed="' + (isOn(b) ? 'true' : 'false') + '">' + esc(label) + '</button>' : ''; }).join('');
    $('mcsTableModes').innerHTML = TABLE_MODES.map(([sel, label]) => { const b = tr.querySelector(sel); return b ? '<button type="button" class="mcs-tg' + (isOn(b) ? ' is-on' : '') + '" data-tmode="' + esc(sel) + '">' + esc(label) + (isOn(b) ? '（設定中）' : '') + '</button>' : ''; }).join('');
    $('mcsState').querySelectorAll('[data-state]').forEach(b => b.addEventListener('click', () => { const d = STATE.find(s => s[0] === b.dataset.state); tr.querySelector(d[2])?.click(); setTimeout(() => renderStates(tr), 30); }));
    $('mcsModes').querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { tr.querySelector(b.dataset.mode)?.click(); setTimeout(() => { fill(); }, 60); }));
    // 設定の入力欄が行の中にあるもの（％・MIN・幅・貿易条件・表示条件）は、実際の表のその行で設定する
    $('mcsTableModes').querySelectorAll('[data-tmode]').forEach(b => b.addEventListener('click', () => { const id = curId; close(); document.body.classList.add('mc-table-on'); if (window.mcSetMode) window.mcSetMode(); const t = $(id); setTimeout(() => { t && t.scrollIntoView({ block: 'center' }); t && t.querySelector(b.dataset.tmode)?.click(); }, 80); }));
  }
  function go(d) { const list = rowsNow(), i = list.findIndex(r => r.id === curId), n = list[i + d]; if (n) open(n.id); }
  function open(id) {
    build(); curId = id; sheet.hidden = false; document.body.classList.add('mcs-open'); fill();
    if (obs) obs.disconnect();
    const tr = $(id); if (tr) { obs = new MutationObserver(() => { if (sheet && !sheet.hidden) { refreshCalc(); } }); obs.observe(tr, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-pending', 'data-done', 'data-hide-quote'] }); }
    setTimeout(() => $('mcs-nm')?.focus({ preventScroll: true }), 0);
  }
  function close() { if (!sheet || sheet.hidden) return; sheet.hidden = true; document.body.classList.remove('mcs-open'); if (obs) obs.disconnect(); if (window.mcRefresh) window.mcRefresh(); }
  window.mcSheetOpen = open; window.mcSheetClose = close;
})();
