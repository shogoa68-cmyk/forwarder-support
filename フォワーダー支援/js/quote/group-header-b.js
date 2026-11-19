/* サブコン見出し・パターン見出しの整理（Design 43・案B「1 段＋［⋯］」・新画面のみ）
 *
 * 見出しの DOM・id・onclick・保存データは変えず、次を「足して」CSS で出し分けるだけの薄い層：
 *   - 金額のまとまり .gb-money（売 → 仕入 → 粗利。元の .subcon-group-sum／.subcon-group-cm、
 *     パターンはその小計行の値を写す）
 *   - 注記の印 .gb-note-mark（注記が入っているときだけ。押すと注記の段を開閉）
 *   - 除外中の札 .gb-ex-tag と［見積書に戻す］.gb-restore（元の「除外」ボタンを押す）
 *   - ［⋯］.gb-more → 共有のメニュー #gbMenu（元のボタンを click() するだけ）
 * 注記の段は見出しの tr に .gb-notes-open を付けて、既存の .hdr-notes を下の段に出す。
 * 旧画面（html.editor-v2 でないとき）は何もしない（CSS もすべて html.editor-v2 に限定）。
 */
(function () {
  'use strict';
  const HDR = 'tr.subcon-group-header, tr.subcon-subgroup-header.is-pattern';
  const openNotes = new Set();          // 注記の段を開いている見出し（svKey / svKey|ptKey）
  let menu = null, menuFor = null;

  const on = () => document.documentElement.classList.contains('editor-v2');
  const keyOf = tr => (tr.dataset.svKey || '') + (tr.classList.contains('subcon-subgroup-header') ? '|' + (tr.dataset.ptKey || '') : '');
  const innerOf = tr => tr.querySelector('.subcon-group-header-inner, .subcon-subgroup-inner');
  const isShown = el => !!el && !el.hidden;

  function el(tag, cls, html, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (attrs) Object.keys(attrs).forEach(k => e.setAttribute(k, attrs[k]));
    return e;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- 見出しへ部品を足す ---------- */
  function enhance(tr) {
    if (tr.dataset.gb === '1') return;
    const inner = innerOf(tr);
    if (!inner) return;
    tr.dataset.gb = '1';
    const isPt = tr.classList.contains('subcon-subgroup-header');
    const notes = inner.querySelector('.hdr-notes');

    // 注記の印（名前・行数の後ろ）
    const mark = el('button', 'gb-note-mark', '📝', { type: 'button', title: '注記があります（押すと注記の段を開く・閉じる）', 'aria-label': '注記を開く' });
    mark.hidden = true;
    mark.addEventListener('click', e => { e.stopPropagation(); toggleNotes(tr); });
    // 除外中の札
    const exTag = el('span', 'gb-ex-tag', '見積書から外しています');
    // 金額
    const money = el('span', 'gb-money');
    money.innerHTML = '<span class="gb-m gb-m-s"><span class="gb-k">売</span><b class="gb-v"></b></span>' +
      '<span class="gb-m gb-m-c"><span class="gb-k">仕入</span><span class="gb-v"></span></span>' +
      '<span class="gb-m gb-m-p"><span class="gb-k">粗利</span><span class="gb-v"></span></span>';
    // 見積書に戻す
    const restore = el('button', 'gb-restore', '↩ 見積書に戻す', { type: 'button', title: 'このまとまりを見積書（出力・合計）に戻す' });
    restore.addEventListener('click', e => { e.stopPropagation(); clickExcl(tr); });
    // ［⋯］
    const more = el('button', 'gb-more', '⋯', { type: 'button', title: 'その他の操作', 'aria-label': 'その他の操作', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    more.addEventListener('click', e => { e.stopPropagation(); if (menuFor === tr && menu && !menu.hidden) closeMenu(); else openMenu(tr, more); });

    // 並び：…名前・行数・印 → 札 → 金額 → 戻す → ＋明細を追加 → ⋯（CSS の order で決める）
    const count = inner.querySelector('.subcon-group-count') || inner.querySelector('.subcon-subgroup-leg');
    (count && count.nextSibling) ? inner.insertBefore(mark, count.nextSibling) : inner.appendChild(mark);
    inner.appendChild(exTag);
    inner.appendChild(money);
    inner.appendChild(restore);
    inner.appendChild(more);

    // 注記の段：見出し（📝 注記：）と［✕ 閉じる］
    if (notes) {
      const close = el('button', 'gb-notes-close', '✕ 閉じる', { type: 'button', title: '注記の段を閉じる' });
      close.addEventListener('click', e => { e.stopPropagation(); toggleNotes(tr, false); });
      notes.appendChild(close);
      const inp = notes.querySelector('.subcon-remark-input');
      if (inp) inp.addEventListener('input', () => syncMark(tr));
      notes.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); toggleNotes(tr, false); more.focus(); } });
    }
    if (openNotes.has(keyOf(tr))) tr.classList.add('gb-notes-open');
    syncMark(tr);
    syncMoney(tr);
    void isPt;
  }

  function syncMark(tr) {
    const mark = tr.querySelector('.gb-note-mark');
    if (!mark) return;
    const inp = tr.querySelector('.hdr-notes .subcon-remark-input');
    const has = !!(inp && inp.value.trim());
    mark.hidden = !has;
    tr.classList.toggle('gb-has-note', has);
  }

  /* ---------- 金額（売 → 仕入 → 粗利） ---------- */
  function setM(tr, s, c, p) {
    const box = tr.querySelector('.gb-money');
    if (!box) return;
    const put = (cls, v) => { const m = box.querySelector(cls); if (!m) return; if (m.hidden !== !v) m.hidden = !v; const t = m.querySelector('.gb-v'); if (t && t.textContent !== (v || '')) t.textContent = v || ''; };
    // 「※」は売の右に小さく（書き換えは値が変わったときだけ＝見張りが自分の書き込みで回り続けないように）
    let mix = false;
    if (s && /※$/.test(s)) { s = s.replace(/※$/, ''); mix = true; }
    put('.gb-m-s', s);
    const sv = box.querySelector('.gb-m-s');
    if (sv) {
      let sm = sv.querySelector('.gb-mix');
      if (mix && !sm) { sm = el('small', 'gb-mix', '※', { title: '複数通貨を JPY 換算して合算（FX パネルのレート使用）' }); sv.appendChild(sm); }
      else if (!mix && sm) sm.remove();
    }
    put('.gb-m-c', c && c.replace(/※$/, ''));
    put('.gb-m-p', p);
    const none = !s && !c && !p; if (box.hidden !== none) box.hidden = none;
  }
  function syncMoney(tr) {
    if (tr.classList.contains('subcon-group-header')) {
      const s = (tr.querySelector('.subcon-group-sum') || {}).textContent || '';
      const cm = ((tr.querySelector('.subcon-group-cm') || {}).textContent || '').trim();
      const m = cm.match(/仕入\s*(\S+?)・粗利\s*([^※]+)/);
      setM(tr, s.trim(), m ? m[1] : '', m ? m[2].trim() : '');
      return;
    }
    // パターン見出し：このパターンの小計行（次の data-pt-sum の行）を写す
    let n = tr.nextElementSibling, sub = null;
    while (n) {
      if (n.dataset.ptSum) { sub = n; break; }
      if (n.matches(HDR) || n.dataset.subSum) break;
      n = n.nextElementSibling;
    }
    if (!sub) { setM(tr, '', '', ''); return; }
    const t = c => ((sub.querySelector(c) || {}).textContent || '').trim();
    const p = t('.subcon-subtotal-margin');
    setM(tr, t('.subcon-subtotal-sum'), t('.subcon-subtotal-cost'), p && p !== '—' ? p : '');
  }

  function syncAll() {
    const tb = document.getElementById('tableBody');
    if (!tb || !on()) return;
    tb.querySelectorAll(HDR).forEach(tr => { enhance(tr); syncMoney(tr); syncMark(tr); });
  }

  /* ---------- 注記の段 ---------- */
  function toggleNotes(tr, force) {
    if (!tr.querySelector('.hdr-notes')) return;
    const k = keyOf(tr);
    const open = force == null ? !tr.classList.contains('gb-notes-open') : !!force;
    tr.classList.toggle('gb-notes-open', open);
    if (open) openNotes.add(k); else openNotes.delete(k);
    if (open) { const inp = tr.querySelector('.hdr-notes .subcon-remark-input'); if (inp) setTimeout(() => inp.focus(), 0); }
    else syncMark(tr);
  }

  /* ---------- 元のボタン ---------- */
  const q = (tr, sel) => tr.querySelector(sel);
  function clickExcl(tr) { const b = q(tr, '.subcon-group-excl, .subcon-subgroup-excl'); if (b) b.click(); }

  function itemsFor(tr) {
    const isPt = tr.classList.contains('subcon-subgroup-header');
    const ex = tr.classList.contains('is-excluded');
    const A = [];
    const add = (ic, label, fn, cls) => A.push({ ic, label, fn, cls });
    const sep = () => { if (A.length && A[A.length - 1] !== '-') A.push('-'); };
    if (!isPt) {
      const imp = q(tr, '.sv-hdr-import');
      if (isShown(imp)) add('📥', '取り込み', () => imp.click());
    }
    if (q(tr, '.hdr-notes')) add('📝', tr.classList.contains('gb-notes-open') ? '注記の段を閉じる' : '注記を書く', () => toggleNotes(tr));
    if (isPt) {
      const rn = q(tr, '.subcon-subgroup-rename'); if (rn) add('✎', rn.title.indexOf('付ける') >= 0 ? 'パターン名を付ける' : 'パターン名を変更', () => rn.click());
      const dp = q(tr, '.subcon-subgroup-dup'); if (dp) add('📋', 'このパターンを複製', () => dp.click());
    } else {
      sep();
      const dt = q(tr, '.sv-hdr-detail'); if (isShown(dt)) add('📇', '詳細（マスター）', () => dt.click());
      const bm = q(tr, '.sv-hdr-bm');     if (isShown(bm)) add('🔖', 'BOOKMARK', () => bm.click());
    }
    sep();
    const so = q(tr, '.subcon-group-sort-btn'); if (so) add('⇅', 'カテゴリ順に並べる', () => so.click());
    sep();
    add(ex ? '↩' : '🚫', ex ? '見積書に戻す' : '見積書から外す', () => clickExcl(tr), ex ? '' : 'is-danger');
    while (A.length && A[A.length - 1] === '-') A.pop();
    return A;
  }

  function ensureMenu() {
    if (menu) return menu;
    menu = el('div', 'gb-menu', '', { id: 'gbMenu', role: 'menu' });
    menu.hidden = true;
    document.body.appendChild(menu);
    menu.addEventListener('click', e => e.stopPropagation());
    menu.addEventListener('keydown', e => {
      const its = [...menu.querySelectorAll('.gb-mi')];
      const i = its.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (its[i + 1] || its[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (its[i - 1] || its[its.length - 1]).focus(); }
    });
    document.addEventListener('click', () => closeMenu());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu && !menu.hidden) { const b = menuFor && menuFor.querySelector('.gb-more'); closeMenu(); if (b) b.focus(); } }, true);
    window.addEventListener('scroll', () => closeMenu(), true);
    window.addEventListener('resize', () => closeMenu());
    return menu;
  }
  function openMenu(tr, btn) {
    const m = ensureMenu();
    const items = itemsFor(tr);
    m.innerHTML = items.map((it, i) => it === '-' ? '<div class="gb-sep" role="separator"></div>'
      : `<button type="button" class="gb-mi ${it.cls || ''}" role="menuitem" data-i="${i}"><span class="gb-ic">${it.ic}</span>${esc(it.label)}</button>`).join('');
    m.querySelectorAll('.gb-mi').forEach(b => b.addEventListener('click', () => { const it = items[+b.dataset.i]; closeMenu(); if (it && it.fn) it.fn(); }));
    m.hidden = false;
    menuFor = tr;
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    let left = r.right - w, top = r.bottom + 4;
    if (left < 8) left = 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    m.style.left = left + 'px'; m.style.top = top + 'px';
    const f = m.querySelector('.gb-mi'); if (f) f.focus();
  }
  function closeMenu() {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    if (menuFor) { const b = menuFor.querySelector('.gb-more'); if (b) b.setAttribute('aria-expanded', 'false'); }
    menuFor = null;
  }

  /* ---------- 見張り ---------- */
  let timer = 0;
  function schedule() { if (timer) return; timer = setTimeout(() => { timer = 0; syncAll(); }, 30); }
  function start() {
    const tb = document.getElementById('tableBody');
    if (!tb) { setTimeout(start, 500); return; }
    new MutationObserver(schedule).observe(tb, { childList: true, subtree: true, characterData: true });
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    syncAll();
  }
  window.gbSync = syncAll;
  window.gbOpenMenu = (tr) => { const b = tr && tr.querySelector('.gb-more'); if (b) openMenu(tr, b); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
