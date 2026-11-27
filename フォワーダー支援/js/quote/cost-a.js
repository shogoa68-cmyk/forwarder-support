/* ==========================================================================
   Design 50 案A（2026-11）：見積入力（新しい画面）のステップ④「費用」＝明細 1 行を 1 段に
   ・明細の <tr> はそのまま。表示だけ CSS グリッドで 1 段（☐｜項目名｜数量×単位｜仕入｜＋乗せ幅｜売｜小計｜粗利｜⋯）に並べる
   ・細かい欄（備考・カテゴリ・課税・売の通貨・単価の扱い・％・MIN・幅・貿易条件・表示条件・有効期間・保険料）は、
     同じ行の中の「行の詳細」パネル（.row-detail-panel）へ「要素ごと」移す（同じ <tr> の中なので計算・保存・出力は従来どおり）
   ・上の操作は 1 行／状態は項目名の後ろの札 1 つ／小計はパターンが 2 つ以上のサブコンだけ／合計は薄い 1 行／選択中は黒い帯
   ・新しい画面（html.editor-v2）のときだけ。外すと元の場所へ戻す（id・onclick・data-* は不変）
   ========================================================================== */
(function () {
  'use strict';
  const root = document.documentElement;
  const $ = id => document.getElementById(id);
  const tab = () => $('tab-quote-make');
  const isOn = () => root.classList.contains('editor-v2');
  const isDataRow = tr => !!tr && tr.tagName === 'TR' && /^row-\d+$/.test(tr.id || '') && !tr.dataset.virtual && !tr.dataset.type;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let on = false;

  // ---- 要素を動かす（元の場所に目印のコメント） ----
  const moved = [];
  function put(el, parent, before) {
    if (!el || !parent) return;
    if (!el.__caHome && el.parentNode) { el.__caHome = document.createComment('ca-home'); el.parentNode.insertBefore(el.__caHome, el); moved.push(el); }
    if (before && before.parentNode === parent) parent.insertBefore(el, before); else parent.appendChild(el);
  }
  function restoreAll() {
    moved.splice(0).reverse().forEach(el => {
      const h = el.__caHome; el.__caHome = null;
      if (h && h.parentNode) { h.parentNode.insertBefore(el, h); h.remove(); }
    });
  }
  const texts = [];
  function setText(el, t) { if (!el) return; if (!texts.some(x => x[0] === el)) texts.push([el, el.innerHTML]); if (el.innerHTML !== t) el.innerHTML = t; }
  function restoreTexts() { texts.splice(0).forEach(([el, h]) => { el.innerHTML = h; }); }

  // ---- 明細 1 行 ----
  const MORE = [['.w-valid', 'valid'], ['.row-mode-btns', 'mode'], ['.pct-group', 'pct'], ['.min-group', 'min'], ['.range-group', 'min'], ['.ic-group', 'ic'], ['.cn-group', 'cn'], ['.ins-group', 'ins'], ['.row-cd', 'cd']];
  const QUICK = [['zero-confirm-btn', '0円で載せる'], ['min-mode-btn', 'MIN'], ['range-mode-btn', '幅'], ['pct-mode-btn', '%']];
  function prepRow(tr) {
    if (!isDataRow(tr) || tr.__caDone) return;
    tr.__caDone = true;
    tr.classList.add('ca-row');
    const q = s => tr.querySelector(s);
    const nameCell = q('td.name-cell'), panel = q('.row-detail-panel');
    if (!nameCell || !panel) return;
    // 項目名の段：項目名＋状態の札＋「· 備考」
    let nm = q('.ca-name');
    if (!nm) {
      nm = document.createElement('div'); nm.className = 'ca-name'; nm.dataset.caNew = '1';
      nm.innerHTML = '<span class="ca-badges"></span><span class="ca-note"></span><button type="button" class="ca-valid" data-ca="valid" hidden></button>';
      nameCell.insertBefore(nm, nameCell.firstChild);
    }
    put(q('input[data-field="nm"]'), nm, nm.firstChild);
    // 行の詳細の開閉ボタン（項目名の左・いつも見える）
    if (!nm.querySelector('.ca-tog')) {
      const tg = document.createElement('button'); tg.type = 'button'; tg.className = 'ca-tog'; tg.dataset.caNew = '1'; tg.dataset.ca = 'tog';
      tg.setAttribute('aria-expanded', 'false'); tg.title = '行の詳細を開く（備考・カテゴリ・課税・単価の扱いなど）';
      tg.innerHTML = '<span class="ca-tog-ic" aria-hidden="true">▸</span><span class="ca-tog-tx">詳細</span>';
      nm.insertBefore(tg, nm.firstChild);
    }
    // 仕入の通貨は仕入の欄の左へ
    const pcWrap = q('td.ccy-cell .stk-cost'), ppWrap = q('td.price-cell .stk-price > .stk-cost');
    if (pcWrap && ppWrap) put(pcWrap, ppWrap, ppWrap.firstChild);
    // 行の詳細（パネル）：見出し・4 つの欄・単価の扱い・さらに
    let head = panel.querySelector('.ca-dhead');
    if (!head) {
      head = document.createElement('div'); head.className = 'ca-dhead'; head.dataset.caNew = '1';
      head.innerHTML = '<b class="ca-dtitle"></b><span class="ca-sp"></span>'
        + '<button type="button" class="ca-dbtn" data-ca="dup">⧉ 複製</button>'
        + '<button type="button" class="ca-dbtn" data-ca="done">✓ 入力完了</button>'
        + '<button type="button" class="ca-dbtn is-danger" data-ca="del">削除</button>';
      const f = document.createElement('div'); f.className = 'ca-dfields'; f.dataset.caNew = '1';
      f.innerHTML = '<label class="ca-f" data-ca-slot="sv"><span>サブコン</span></label>'
        + '<label class="ca-f" data-ca-slot="pt"><span>パターン（任意）</span></label>'
        + '<label class="ca-f" data-ca-slot="note"><span>備考（社内用）</span></label>'
        + '<label class="ca-f" data-ca-slot="cat"><span>カテゴリ</span></label>'
        + '<div class="ca-f ca-f-tax" data-ca-slot="tax"><span>課税</span></div>'  // label にしない＝欄の空いた所・文字を押しても切り替わらない（チェック欄そのものだけ）
        + '<label class="ca-f" data-ca-slot="bc"><span>売の通貨</span></label>';
      const qk = document.createElement('div'); qk.className = 'ca-quick'; qk.dataset.caNew = '1';
      qk.innerHTML = '<span class="ca-qlbl">単価の扱い</span>' + QUICK.map(([c, l]) => `<button type="button" class="ca-chip" data-ca-q="${c}">${l}</button>`).join('')
        + '<button type="button" class="ca-chip ca-chip-more" data-ca="more" aria-expanded="false">さらに ▾</button>';
      const more = document.createElement('div'); more.className = 'ca-dmore'; more.dataset.caNew = '1'; more.hidden = true;
      panel.insertBefore(head, panel.firstChild);
      head.after(f); f.after(qk); qk.after(more);
      // 既存の欄の箱（有効期間・状態・単価のオプション・条件・保険料・CD・内訳）は「さらに」の中へ
      [...panel.querySelectorAll(':scope > .rd-group')].forEach(g => put(g, more));
    }
    const slot = n => panel.querySelector(`[data-ca-slot="${n}"]`);
    // サブコン・パターンは行に出さず詳細の中で直す（変えると、その行は別の枠へ移る）
    put(q('input[data-field="sv"]'), slot('sv'));
    const ptIn = q('input[data-field="pt"]');
    if (ptIn) { if (!ptIn.getAttribute('list')) { ptIn.setAttribute('list', 'ptSuggestions'); ptIn.dataset.caList = '1'; } put(ptIn, slot('pt')); }
    put(q('.w-note-row'), slot('note'));
    put(q('select.w-cat'), slot('cat'));
    put(q('input[data-field="tx"]'), slot('tax'));
    put(q('td.ccy-cell .stk-sell'), slot('bc'));
    MORE.forEach(([sel, s]) => { const el = q(sel), sl = panel.querySelector(`[data-rd-slot="${s}"]`); if (el && sl && !sl.contains(el)) put(el, sl); });
    // 右端の［✓］＝入力完了（いつも見える・押すと元の .row-done-btn を押す）
    const hc = q('td.handle-cell'), hint = q('.row-acts-hint');
    if (hc && !q('.ca-done-btn')) {
      const db = document.createElement('button'); db.type = 'button'; db.className = 'ca-done-btn'; db.dataset.caNew = '1'; db.dataset.ca = 'done';
      db.textContent = '✓'; db.setAttribute('aria-pressed', 'false');
      if (hint && hint.parentNode === hc) hc.insertBefore(db, hint); else hc.appendChild(db);
    }
    // ［✓］の左に［👁］＝見積書に出さない（押すと元の .row-hidequote-btn を押す）
    if (hc && !q('.ca-hide-btn')) {
      const hb = document.createElement('button'); hb.type = 'button'; hb.className = 'ca-hide-btn'; hb.dataset.caNew = '1'; hb.dataset.ca = 'hide';
      hb.setAttribute('aria-pressed', 'false');
      const db = q('.ca-done-btn'); if (db) hc.insertBefore(hb, db); else hc.appendChild(hb);
    }
    syncRow(tr);
  }

  // 状態の札（1 つまで＋「+n」）・備考・売の通貨・粗利 0% の色
  function syncRow(tr) {
    if (!tr.__caDone) return;
    const q = s => tr.querySelector(s);
    const st = [];
    if (tr.classList.contains('row-pending')) st.push(['要調査', 'is-warn']);
    if (tr.classList.contains('row-hidden-quote')) st.push(['見積書に出さない', 'is-mute']);
    const why = tr.dataset.outRange === '1' || tr.classList.contains('row-out-range') ? (tr.dataset.outReason === 'condition' ? '条件外' : tr.dataset.outReason === 'incoterms' ? '条件外' : '期間外') : '';
    if (why) st.push([why, 'is-mute']);
    const done = tr.classList.contains('row-input-done');
    const b = q('.ca-badges');
    if (b) {
      const taxed = tr.classList.contains('taxed');
      const html = (done ? '<span class="ca-done" title="入力完了">✓</span>' : '')
        + (taxed ? '<span class="ca-tax" title="課税の行（消費税 10% を計算します）。外すときは［▸ 詳細］の「課税」のチェックを外します。">課税</span>' : '')
        + (st.length ? `<span class="ca-badge ${st[0][1]}">${esc(st[0][0])}</span>` : '')
        + (st.length > 1 ? `<span class="ca-badge is-more" title="${esc(st.map(x => x[0]).join('・'))}">+${st.length - 1}</span>` : '');
      if (b.__h !== html) { b.innerHTML = html; b.__h = html; }
    }
    const hbtn = q('.ca-hide-btn');
    if (hbtn) {
      const hid = tr.classList.contains('row-hidden-quote');
      hbtn.classList.toggle('is-on', hid); hbtn.setAttribute('aria-pressed', hid ? 'true' : 'false');
      const ic = hid ? '🚫' : '👁'; if (hbtn.textContent !== ic) hbtn.textContent = ic;
      const t = hid ? '見積書に出していません（押すと見積書に出す）' : '見積書に出す（押すと見積書に出さない）';
      if (hbtn.title !== t) { hbtn.title = t; hbtn.setAttribute('aria-label', t); }
    }
    const dbtn = q('.ca-done-btn');
    if (dbtn) {
      dbtn.classList.toggle('is-on', done); dbtn.setAttribute('aria-pressed', done ? 'true' : 'false');
      let t = done ? '入力完了' : '入力完了にする';
      if (done && window.rowDoneInfo) { const di = window.rowDoneInfo(tr); if (di && di.text) t = '入力完了（' + di.text + '）'; }
      t += done ? '（押すと外す）' : '';
      if (dbtn.title !== t) { dbtn.title = t; dbtn.setAttribute('aria-label', t); }
    }
    tr.classList.toggle('ca-mute', st.some(x => x[1] === 'is-mute'));
    // 有効期間：期間が入っている行・サーチャージの行は、項目名の後ろに「📅 期間」（押すと行の詳細の期間の欄へ）
    const vc = q('.ca-valid');
    if (vc) {
      const vf = (q('[data-field="vf"]') || {}).value || '', vt = (q('[data-field="vt"]') || {}).value || '';
      const sur = (q('select[data-field="cat"]') || {}).value === 'surcharge';
      const md = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? (+m[2]) + '/' + (+m[3]) : d; };
      const show = !!(vf || vt || sur);
      const t = vf || vt ? '📅 ' + (vf ? md(vf) : '') + '〜' + (vt ? md(vt) : '') : '📅 期間を設定';
      if (vc.hidden === show) vc.hidden = !show;
      if (vc.textContent !== t) { vc.textContent = t; vc.title = (vf || vt ? '有効期間 ' + (vf || '') + '〜' + (vt || '') : '有効期間が未設定です') + '（押すと期間の欄を開く）'; vc.classList.toggle('is-empty', !(vf || vt)); }
    }
    const nt = q('input[data-field="nt"]'), n = q('.ca-note');
    if (n) { const t = nt && nt.value.trim() ? '· ' + nt.value.trim() : ''; if (n.textContent !== t) { n.textContent = t; n.title = t ? nt.value.trim() : ''; } }
    const pc = q('select[data-field="pc"]'), bc = q('select[data-field="bc"]');
    const diff = !!(pc && bc && pc.value && bc.value && pc.value !== bc.value);
    tr.classList.toggle('ca-ccy-diff', diff);
    const bp = q('.stk-price > .stk-sell');
    if (bp) { let t = bp.querySelector('.ca-bccy'); if (!t) { t = document.createElement('span'); t.className = 'ca-bccy'; bp.insertBefore(t, bp.firstChild); } const v = diff ? bc.value : ''; if (t.textContent !== v) t.textContent = v; }
    const pr = q('td.profit-cell .pr-sub, td.profit-cell .pr-rate');
    tr.classList.toggle('ca-zero-margin', !!pr && /(^|[^\d])0\.0%/.test(pr.textContent));
    const title = q('.ca-dtitle'), name = q('input[data-field="nm"]');
    if (title) { const t = (name && name.value.trim() ? name.value.trim() : '（項目名なし）') + ' の詳細'; if (title.textContent !== t) title.textContent = t; }
    // カテゴリが未設定のときの選択肢は「（なし）」（旧い画面へ戻すと元の文字へ）
    const o0 = q('select.w-cat option[value=""]');
    if (o0 && o0.textContent !== '（なし）') { o0.dataset.caOrig = o0.textContent; o0.textContent = '（なし）'; }
    // 単価の扱いのチップ：元のボタンが ON か
    tr.querySelectorAll('.ca-chip[data-ca-q]').forEach(c => {
      const o = tr.querySelector('.' + c.dataset.caQ);
      const act = !!o && (o.classList.contains('active') || o.classList.contains('is-on') || o.getAttribute('aria-pressed') === 'true');
      c.classList.toggle('is-on', act);
    });
  }

  // ---- 行の詳細の開閉（開くのは 1 行だけ） ----
  function openDetail(tr, focus) {
    if (!isDataRow(tr)) return;
    document.querySelectorAll('#tableBody tr.ca-open').forEach(x => { if (x !== tr) closeDetail(x); });
    syncRow(tr);
    tr.classList.add('ca-open'); syncTog(tr);
    if (needsValid(tr)) setMore(tr, true);
    if (focus) { const f = tr.querySelector('.row-detail-panel input:not([type=hidden]), .row-detail-panel select'); if (f) try { f.focus({ preventScroll: true }); } catch (e) {} }
  }
  function closeDetail(tr) { if (tr) { tr.classList.remove('ca-open'); syncTog(tr); } }
  function syncTog(tr) {
    const b = tr && tr.querySelector('.ca-tog'); if (!b) return;
    const o = tr.classList.contains('ca-open');
    b.setAttribute('aria-expanded', o ? 'true' : 'false');
    b.title = o ? '行の詳細を閉じる' : '行の詳細を開く（備考・カテゴリ・課税・単価の扱いなど）';
    const ic = b.querySelector('.ca-tog-ic'), tx = b.querySelector('.ca-tog-tx');
    if (ic) ic.textContent = o ? '▾' : '▸'; if (tx) tx.textContent = o ? '閉じる' : '詳細';
  }
  function needsValid(tr) {
    const v = n => (tr.querySelector(`[data-field="${n}"]`) || {}).value || '';
    return !!(v('vf') || v('vt') || v('cat') === 'surcharge');
  }
  function setMore(tr, open) {
    const m = tr.querySelector('.ca-dmore'), b = tr.querySelector('[data-ca="more"]'); if (!m) return;
    m.hidden = !open; if (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); b.textContent = open ? 'さらに ▴' : 'さらに ▾'; }
  }
  window.caToggleDetail = function (tr, force) {
    if (typeof tr === 'string') tr = document.getElementById(tr);
    const open = force === undefined ? !tr.classList.contains('ca-open') : !!force;
    if (open) openDetail(tr); else closeDetail(tr);
  };

  // ---- 行の［⋯］のメニュー ----
  let menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function openMenu(tr, anchor) {
    closeMenu();
    const items = [
      ['行の詳細', () => openDetail(tr, true)],
      ['⧉ 複製', () => tr.querySelector('.row-dup-btn')?.click()],
      [tr.classList.contains('row-input-done') ? '✓ 入力完了を外す' : '✓ 入力完了', () => tr.querySelector('.row-done-btn')?.click()],
      [tr.classList.contains('row-pending') ? '要調査を外す' : '🔍 要調査にする', () => tr.querySelector('.row-pending-btn')?.click()],
      [tr.classList.contains('row-hidden-quote') ? '見積書に出す' : '見積書に出さない', () => tr.querySelector('.row-hidequote-btn')?.click()],
      ['＋ 直下に行を追加', () => tr.querySelector('.row-add-btn')?.click()],
      ['削除', () => tr.querySelector('.row-del-btn')?.click(), 'danger'],
    ];
    menu = document.createElement('div'); menu.className = 'ca-menu'; menu.setAttribute('role', 'menu');
    items.forEach(([t, f, d]) => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.className = 'ca-mi' + (d ? ' is-danger' : ''); b.textContent = t; b.addEventListener('click', () => { closeMenu(); f(); }); menu.appendChild(b); });
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = Math.min(innerHeight - menu.offsetHeight - 8, r.bottom + 4) + 'px';
    menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + 'px';
    const first = menu.querySelector('button'); if (first) first.focus();
  }

  // ---- 上の操作の行（1 行）・列見出し ----
  function prepBars() {
    const cm = document.querySelector('#tableWrap .cmdbar-main') || document.querySelector('.cmdbar-main');
    const cb = $('e2CostBar');
    if (cm && cb) {
      const add = cb.querySelector('[data-f="openAddSubconFrame"]') || cm.querySelector(':scope > [data-f="openAddSubconFrame"]'), ch = cb.querySelector('[data-f="lcOpenPicker"]') || cm.querySelector(':scope > [data-f="lcOpenPicker"]');
      // 元の帯（#e2CostBar）が押されたボタンの関数を呼んでいたので、移した先でも同じように呼ぶ
      if (!cm.__caClick) { cm.__caClick = true; cm.addEventListener('click', e => { if (!on) return; const b = e.target.closest('[data-f]'); if (!b || !cm.contains(b)) return; const f = window[b.dataset.f]; if (typeof f === 'function') { try { f(b); } catch (x) {} } }); }
      if (add && add.parentNode !== cm) put(add, cm, cm.firstChild);
      if (ch && ch.parentNode !== cm) { put(ch, cm, add ? add.nextSibling : cm.firstChild); }
      if (ch) setText(ch, '📦 チャージから追加');
      if (!$('caMoreBtn')) {
        const mb = document.createElement('button'); mb.type = 'button'; mb.id = 'caMoreBtn'; mb.className = 'ca-more-btn'; mb.dataset.caNew = '1';
        mb.textContent = '⋯'; mb.title = 'すべて開く・閉じる・小計行・追加する位置・表の設定'; mb.setAttribute('aria-haspopup', 'menu');
        mb.addEventListener('click', e => { e.stopPropagation(); openBarMenu(mb); });
        cm.appendChild(mb);
      }
    }
    // 列見出し：単価の欄を「仕入｜＋乗せ幅｜売」の 3 つに
    const ths = document.querySelectorAll('#quoteTable thead tr:first-child > th');
    if (ths.length >= 10) {
      setText(ths[3], '項目名');
      setText(ths[4], '数量 × 単位');
      setText(ths[6], '<span class="ca-h ca-h-pp" title="仕入単価（左は仕入の通貨）">仕入</span><span class="ca-h ca-h-mk" title="乗せ幅：仕入単価に加算して売単価になります">＋乗せ幅</span><span class="ca-h ca-h-bp" title="売単価＝仕入＋乗せ幅（自動）">売</span>');
      setText(ths[8], '小計（売）');
      setText(ths[9], '粗利');
    }
    // 合計（薄い 1 行）
    const wrap = $('tableScrollWrap');
    if (wrap && !$('caTotal')) { const t = document.createElement('div'); t.id = 'caTotal'; t.className = 'ca-total'; t.dataset.caNew = '1'; wrap.after(t); }
    // 選んだ行の帯（表の上・貼り付く）
    if (wrap && !$('caSel')) {
      const s = document.createElement('div'); s.id = 'caSel'; s.className = 'ca-sel'; s.hidden = true; s.dataset.caNew = '1';
      s.innerHTML = '<b class="ca-sel-n"></b>'
        + '<button type="button" data-cs="dup">⧉ 複製</button>'
        + '<button type="button" data-cs="move">⇄ 別のサブコンへ移す</button>'
        + '<button type="button" data-cs="pat">🔖 パターンを付ける</button>'
        + '<button type="button" data-cs="hide">見積書に出さない</button>'
        + '<button type="button" data-cs="qty">数量をまとめて変更</button>'
        + '<button type="button" data-cs="merge" title="選んだ行を 1 行にまとめます（先頭の行が統合先。仕入・売の合計を反映し、残りの行は見積書に出さない＋「統合先」の印）">🔗 統合</button>'
        + '<button type="button" data-cs="more" title="保持・貼り付け・カテゴリ／通貨／単位／乗せ幅をまとめて変える">⋯ そのほか</button>'
        + '<button type="button" data-cs="del" class="is-danger">削除</button>'
        + '<span class="ca-sp"></span><button type="button" data-cs="clear">✕ 選択を外す</button>';
      s.addEventListener('click', e => { const b = e.target.closest('[data-cs]'); if (b) selAction(b.dataset.cs, b); });
      // 表の上の操作の行（貼り付く）の中に置き、選んでいる間は操作の行の代わりに出す
      const bar = (cm && cm.closest('.quote-cmdbar')) || null;
      if (bar) bar.appendChild(s); else wrap.parentNode.insertBefore(s, wrap);
    }
  }
  function openBarMenu(anchor) {
    closeMenu();
    const pos = $('rowInsertPos');
    const items = [
      ['すべて開く', () => window.expandAllGroups && window.expandAllGroups()],
      ['すべて閉じる', () => window.collapseAllGroups && window.collapseAllGroups()],
      '-',
      ['＝ 小計行を足す', () => window.toolbarInsertSubtotal && window.toolbarInsertSubtotal()],
    ];
    if (pos) {
      items.push('-');
      [...pos.options].forEach(o => items.push([(pos.value === o.value ? '● ' : '○ ') + '追加する位置：' + o.textContent.trim(), () => { pos.value = o.value; pos.dispatchEvent(new Event('change', { bubbles: true })); }]));
    }
    // 入力完了マークがあるときだけ「入力完了をすべて外す」（旧［↺ 一括解除］・要調査は外さない）
    const doneN = document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])[data-done="1"]').length;
    if (doneN && typeof window.clearAllDoneMarks === 'function') {
      items.push('-');
      items.push(['入力完了をすべて外す（' + doneN + '行）', async () => {
        const ok = typeof window.uiConfirm === 'function'
          ? await window.uiConfirm({ title: '入力完了をすべて外しますか？', lines: ['入力完了の印（✓）と、押した日時・名前の記録を ' + doneN + ' 行ぶん外します。', '要調査の印・入力した内容はそのままです。'], okLabel: 'すべて外す', danger: true })
          : confirm('入力完了をすべて外しますか？');
        if (ok) window.clearAllDoneMarks();
      }]);
    }
    items.push('-');
    items.push(['⚙ 表の設定（為替・カテゴリ）', () => { const g = $('cmdbarGear'); if (g) { g.open = true; const s = g.querySelector('summary'); if (s) s.click(); g.open = true; } }]);
    items.push(['そのほか（並び替え・CSV・電卓など）', () => { const m = $('cmdbarMore'); if (m) m.open = true; }]);
    menu = document.createElement('div'); menu.className = 'ca-menu'; menu.setAttribute('role', 'menu');
    items.forEach(it => {
      if (it === '-') { const h = document.createElement('div'); h.className = 'ca-sepl'; menu.appendChild(h); return; }
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.className = 'ca-mi'; b.textContent = it[0];
      b.addEventListener('click', () => { closeMenu(); it[1](); }); menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = Math.min(innerHeight - menu.offsetHeight - 8, r.bottom + 4) + 'px';
    menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + 'px';
  }

  // ---- 選んだ行の帯 ----
  const selected = () => [...document.querySelectorAll('#tableBody .row-select-chk:checked')].map(c => c.closest('tr')).filter(isDataRow);
  function syncSel() {
    const s = $('caSel'); if (!s) return;
    const rows = selected();
    s.hidden = !on || !rows.length;
    const n = s.querySelector('.ca-sel-n'); if (n) n.textContent = rows.length + ' 行を選択';
    const mg = s.querySelector('[data-cs="merge"]');   // 統合は 2 行以上のときだけ
    if (mg) { mg.disabled = rows.length < 2; mg.classList.toggle('is-off', rows.length < 2); }
    document.querySelectorAll('#tableBody tr.ca-row').forEach(tr => tr.classList.toggle('ca-picked', rows.includes(tr)));
  }
  function selAction(k, btn) {
    const rows = selected();
    if (k === 'clear') { if (typeof window.clearRowSelection === 'function') window.clearRowSelection(); else rows.forEach(tr => { const c = tr.querySelector('.row-select-chk'); if (c) { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); } }); syncSel(); return; }
    if (!rows.length) return;
    if (k === 'dup') { if (typeof window.copySelectedRows === 'function') window.copySelectedRows('below'); }
    else if (k === 'del') { if (typeof window.deleteSelectedRows === 'function') window.deleteSelectedRows(); }
    else if (k === 'hide') { rows.forEach(tr => { if (!tr.classList.contains('row-hidden-quote')) tr.querySelector('.row-hidequote-btn')?.click(); }); }
    else if (k === 'qty') {
      const v = prompt('選んだ ' + rows.length + ' 行の数量を入れてください', '');
      if (v == null || v.trim() === '' || isNaN(+v)) return;
      rows.forEach(tr => { const e = tr.querySelector('input[data-field="pq"]'); if (e) { e.value = v.trim(); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } });
      if (typeof window.quoteShowToast === 'function') window.quoteShowToast(rows.length + ' 行の数量を ' + v.trim() + ' にしました', 'success', 2200);
    } else if (k === 'merge') { if (rows.length >= 2 && typeof window.mergeSelectedRowsFromToolbar === 'function') window.mergeSelectedRowsFromToolbar(); }
    else if (k === 'more') openSelMore(btn, rows);
    else if (k === 'move') openMove(btn);
    else if (k === 'pat') openPat(btn, rows);
    setTimeout(syncSel, 50);
  }
  // 小さな入力の吹き出し（文字を 1 つ聞く）。Enter／［OK］で cb(値)・Esc／［キャンセル］で閉じる
  function askText(anchor, o, cb) {
    closeMenu();
    menu = document.createElement('div'); menu.className = 'ca-menu ca-move'; menu.setAttribute('role', 'dialog');
    menu.innerHTML = '<b></b><input type="text" class="ca-move-in" autocomplete="off" maxlength="40"><small class="ca-ask-note"></small><div class="ca-move-row"><button type="button" class="ca-mi" data-x>キャンセル</button><button type="button" class="ca-mi is-primary" data-go></button></div>';
    menu.querySelector('b').textContent = o.title || '';
    const inp = menu.querySelector('input');
    if (o.list) inp.setAttribute('list', o.list);
    inp.placeholder = o.placeholder || ''; inp.value = o.value || '';
    const note = menu.querySelector('.ca-ask-note'); if (o.note) note.textContent = o.note; else note.remove();
    menu.querySelector('[data-go]').textContent = o.ok || 'OK';
    document.body.appendChild(menu);
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { bottom: 120, left: 120 };
    menu.style.top = Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8) + 'px'; menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px';
    inp.focus(); inp.select();
    const go = () => {
      const v = inp.value.trim();
      if (o.required && !v) { inp.focus(); inp.classList.add('is-err'); return; }
      closeMenu(); cb(v);
    };
    menu.querySelector('[data-go]').addEventListener('click', go);
    menu.querySelector('[data-x]').addEventListener('click', closeMenu);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); } });
  }
  window.caAskText = askText;
  // 選んだ行の「⋯ そのほか」＝旧画面の選択バー（#cmdbarContext）にあって帯に無い操作（元の関数・欄をそのまま使う）
  function listMenu(anchor, items) {
    closeMenu();
    menu = document.createElement('div'); menu.className = 'ca-menu'; menu.setAttribute('role', 'menu');
    items.forEach(it => {
      if (it === '-') { const h = document.createElement('div'); h.className = 'ca-sepl'; menu.appendChild(h); return; }
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.className = 'ca-mi'; b.textContent = it[0];
      if (it[2]) { b.disabled = true; b.title = it[2]; }
      b.addEventListener('click', () => { if (b.disabled) return; closeMenu(); it[1](b); }); menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = Math.min(innerHeight - menu.offsetHeight - 8, r.bottom + 4) + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px';
  }
  function pickFromSelect(anchor, selId, title, apply) {
    const sel = $(selId); if (!sel || typeof window[apply] !== 'function') return;
    const opts = [...sel.options].filter(o => o.value && o.value !== '__none__');
    if (!opts.length) { if (typeof window.quoteShowToast === 'function') window.quoteShowToast('選べる項目がありません', 'warn'); return; }
    listMenu(anchor, [[title, () => {}, ' '], '-'].concat(opts.map(o => [o.textContent.trim(), () => { sel.value = o.value; window[apply](sel); setTimeout(syncSel, 80); }])));
  }
  function askBulk(anchor, inputId, apply, o) {
    askText(anchor, o, v => {
      const b = $(inputId); if (!b || typeof window[apply] !== 'function') return;
      b.value = v; window[apply](); setTimeout(syncSel, 80);
    });
  }
  function openSelMore(anchor, rows) {
    const paste = $('btnPasteClipboard');
    listMenu(anchor, [
      ['📋 保持する（あとで貼り付け）', () => window.copyRowsToClipboard && window.copyRowsToClipboard()],
      ['📌 保持した行を貼り付け（選んだ行の前へ）', () => window.pasteClipboardRows && window.pasteClipboardRows(), paste && paste.disabled ? '先に「保持する」で行を保持してください' : ''],
      '-',
      ['カテゴリをまとめて変える', b => pickFromSelect(anchor, 'bulkCatSet', '選んだ ' + rows.length + ' 行のカテゴリ', 'applyBulkCategorySet')],
      ['通貨をまとめて変える', b => pickFromSelect(anchor, 'bulkCurrencySet', '選んだ ' + rows.length + ' 行の通貨', 'applyBulkCurrencySet')],
      ['単位をまとめて変える', () => askBulk(anchor, 'bulkUnitSet', 'applyBulkUnitSet', { title: '選んだ ' + rows.length + ' 行の単位', list: 'unit-list', placeholder: '例）R/T', ok: '変える', required: true })],
      ['乗せ幅をまとめて変える', () => askBulk(anchor, 'bulkMarkupSet', 'applyBulkMarkupSet', { title: '選んだ ' + rows.length + ' 行の乗せ幅（仕入単価に足す額）', placeholder: '例）500', ok: '変える', required: true })],
    ]);
  }
  // 別のサブコンへ移す＝サブコン欄の書き換え（既存の一括設定 applyBulkSubcon と同じ処理）。パターン名はそのまま
  function openMove(anchor) {
    askText(anchor, { title: '移す先のサブコン', list: 'svSuggestions', placeholder: 'サブコン名（候補から選べます）', ok: '移す' }, v => {
      const b = $('bulkSubconSet');
      if (!b || typeof window.applyBulkSubcon !== 'function') return;
      b.value = v; window.applyBulkSubcon(); setTimeout(syncSel, 80);
    });
  }
  // 選んだ行にパターンを付ける（既存の一括設定 applyBulkPattern と同じ処理・空にするとパターンなし）
  function openPat(anchor, rows) {
    const cur = [...new Set(rows.map(tr => (tr.querySelector('input[data-field="pt"]')?.value || '').trim()))];
    askText(anchor, { title: '選んだ ' + rows.length + ' 行のパターン', list: 'ptSuggestions', placeholder: '例）FCL案', value: cur.length === 1 ? cur[0] : '', note: '空にすると「パターンなし」に戻します', ok: '付ける' }, v => {
      const b = $('bulkPatternSet');
      if (!b || typeof window.applyBulkPattern !== 'function') return;
      b.value = v; window.applyBulkPattern(); setTimeout(syncSel, 80);
    });
  }

  // ---- 見出し・小計・合計 ----
  function syncGroups() {
    const rows = [...document.querySelectorAll('#tableBody > tr')];
    let cur = [];
    const flush = () => { const multi = cur.length >= 2; cur.forEach(t => t.classList.toggle('ca-pt-show', multi)); cur = []; };
    rows.forEach(tr => {
      if (tr.classList.contains('subcon-group-header')) flush();
      if (tr.classList.contains('subcon-pattern-subtotal')) cur.push(tr);
    });
    flush();
    // パターン見出し：「🔖 FCL案 · 3行」（行数は次の見出しまでの明細を数える＝テーマに関係なく）
    rows.forEach((tr, i) => {
      if (!tr.classList.contains('subcon-subgroup-header') || !tr.classList.contains('is-pattern')) return;
      let n = 0;
      for (let k = i + 1; k < rows.length; k++) { const x = rows[k]; if (x.classList.contains('subcon-group-header') || x.classList.contains('subcon-subgroup-header')) break; if (isDataRow(x)) n++; }
      const leg = tr.querySelector('.subcon-subgroup-leg'); if (!leg) return;
      let t = tr.querySelector('.ca-ptn');
      if (!t) { t = document.createElement('span'); t.className = 'ca-ptn'; t.dataset.caNew = '1'; leg.after(t); }
      const v = '· ' + n + '行'; if (t.textContent !== v) t.textContent = v;
    });
  }
  function syncTotal() {
    const box = $('caTotal'); if (!box) return;
    const g = id => (($(id) || {}).textContent || '').trim();
    const pr = $('tot-profit');
    const pm = pr ? ((pr.querySelector('.tot-margin, .pr-sub, .pr-rate') || {}).textContent || '').replace(/[()（）]/g, '').trim() : '';
    const rate = (pm.match(/-?\d+(\.\d+)?%/) || [''])[0];
    const sub = g('tot-subtotal'), cost = g('tot-cost');
    const fmt = v => v && v !== '—' ? (/^[¥≈]/.test(v) ? v : '¥' + v) : '—';
    const html = '<span class="ca-tl">合計（JPY 換算）<small>※外貨は換算レートで円にして合算</small></span><span class="ca-sp"></span>'
      + `<span class="ca-tv">売 <b>${esc(fmt(sub))}</b> · 仕入 ${esc(fmt(cost))}${rate ? ' · 粗利 ' + esc(rate) : ''}</span>`;
    if (box.__h !== html) { box.innerHTML = html; box.__h = html; }
  }

  let raf = 0;
  function kick() { if (!on) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(syncAll); }
  function syncAll() {
    if (!on) return;
    prepBars();
    document.querySelectorAll('#tableBody > tr').forEach(tr => { if (isDataRow(tr)) { prepRow(tr); syncRow(tr); } });
    syncGroups(); syncTotal(); syncSel();
  }

  function enable() {
    if (on) return; on = true;
    const t = tab(); if (t) t.classList.add('ca-on');
    prepBars(); syncAll();
  }
  function disable() {
    if (!on) return; on = false;
    const t = tab(); if (t) t.classList.remove('ca-on');
    document.querySelectorAll('#tableBody tr.ca-row').forEach(tr => { tr.classList.remove('ca-row', 'ca-open', 'ca-mute', 'ca-picked', 'ca-ccy-diff', 'ca-zero-margin'); tr.__caDone = false; });
    closeMenu(); restoreAll(); restoreTexts();
    document.querySelectorAll('[data-ca-new]').forEach(e => e.remove());
    document.querySelectorAll('#tableBody input[data-ca-list]').forEach(e => { e.removeAttribute('list'); delete e.dataset.caList; });
    document.querySelectorAll('#tableBody select.w-cat option[data-ca-orig]').forEach(o => { o.textContent = o.dataset.caOrig; delete o.dataset.caOrig; });
  }
  function sync() { if (isOn()) enable(); else disable(); }

  function boot() {
    const tb = $('tableBody'); if (!tb) return setTimeout(boot, 300);
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(kick).observe(tb, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-out-range', 'data-out-reason'] });
    const tf = document.querySelector('#quoteTable tfoot'); if (tf) new MutationObserver(kick).observe(tf, { childList: true, subtree: true, characterData: true });
    ['input', 'change'].forEach(ev => tb.addEventListener(ev, e => { if (!on) return; const tr = e.target.closest && e.target.closest('tr'); if (isDataRow(tr)) syncRow(tr); if (e.target.classList && e.target.classList.contains('row-select-chk')) syncSel(); }));
    document.addEventListener('change', e => { if (on && e.target && e.target.id === 'selectAllChk') setTimeout(syncSel, 0); });
    // ［⋯］・［▸ 詳細］・詳細の中のボタン
    tb.addEventListener('click', e => {
      if (!on) return;
      const tr = e.target.closest('tr'); if (!isDataRow(tr)) return;
      const hint = e.target.closest('.row-acts-hint');
      if (hint) { e.preventDefault(); e.stopPropagation(); openMenu(tr, hint); return; }
      const ca = e.target.closest('[data-ca]');
      if (ca) {
        e.preventDefault();
        const k = ca.dataset.ca;
        if (k === 'dup') tr.querySelector('.row-dup-btn')?.click();
        else if (k === 'done') tr.querySelector('.row-done-btn')?.click();
        else if (k === 'hide') tr.querySelector('.row-hidequote-btn')?.click();
        else if (k === 'tog') { e.stopPropagation(); window.caToggleDetail(tr); }
        else if (k === 'del') tr.querySelector('.row-del-btn')?.click();
        else if (k === 'more') { const m = tr.querySelector('.ca-dmore'); if (m) setMore(tr, m.hidden); }
        else if (k === 'valid') { e.stopPropagation(); openDetail(tr); setMore(tr, true); const f = tr.querySelector('[data-field="vf"]'); if (f) { try { f.focus({ preventScroll: true }); } catch (x) {} f.scrollIntoView({ block: 'nearest' }); } }
        return;
      }
      const qk = e.target.closest('[data-ca-q]');
      if (qk) { e.preventDefault(); const o = tr.querySelector('.' + qk.dataset.caQ); if (o) o.click(); setTimeout(() => syncRow(tr), 30); return; }
      // 行の空いた所を押しても詳細は開かない（開くのは［▸ 詳細］と［⋯］→「行の詳細」だけ・2026-11）
    }, true);
    document.addEventListener('keydown', e => {
      if (!on) return;
      if (e.key === 'Escape') {
        if (menu) { closeMenu(); return; }
        const o = document.querySelector('#tableBody tr.ca-open'); if (o) { closeDetail(o); }
      }
    });
    document.addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target) && !e.target.closest('.row-acts-hint, #caMoreBtn, [data-cs="move"], [data-cs="pat"], .gb-more, #gbMenu')) closeMenu(); }, true);
    // ドラッグで並べ替える前に、開いている詳細は閉じる
    tb.addEventListener('pointerdown', e => { if (on && e.target.closest('.drag-handle')) document.querySelectorAll('#tableBody tr.ca-open').forEach(closeDetail); }, true);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.caSync = () => { if (on) syncAll(); };
})();
