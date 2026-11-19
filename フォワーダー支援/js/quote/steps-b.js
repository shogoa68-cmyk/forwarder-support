/* ==========================================================================
   見積入力（新画面）ステップ①②③⑤ の「左右 2 列」（Design 46〜48 回答・案B・2026-11）
   左＝入れるもの・右＝この案件の状況／この案の条件／貨物の区分・確認／見積書に添えるもの。
   右の列は「1 行ずつの行」（項目名・値・操作）。押すとその行の下に、既存の入力欄（id そのまま）が開く。
   既存の要素は「移すだけ」（元の場所に目印のコメントを置き、旧画面へ戻すと元へ返す）。
   id・onclick・保存データは変えない。④費用は対象外。
   ========================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const on = () => root.classList.contains('editor-v2');
  const val = id => { const e = $(id); return e ? String(e.value || '').trim() : ''; };
  const txt = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const md = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? (+m[2]) + '/' + (+m[3]) : ''; };
  const shown = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none';

  // ---- 要素を移す／戻す（元の場所に目印を置く） ----
  const marks = new Map();
  function put(el, parent, before) {
    if (!el || !parent) return;
    if (!marks.has(el) && el.parentNode && !el.dataset.sbNew) { const c = document.createComment('sb:' + (el.id || el.className || '')); el.parentNode.insertBefore(c, el); marks.set(el, c); }
    if (el.parentNode !== parent || (before !== undefined && el.nextSibling !== before)) parent.insertBefore(el, before || null);
  }
  function restoreAll() {
    marks.forEach((c, el) => { if (c.parentNode) { c.parentNode.insertBefore(el, c); c.remove(); } });
    marks.clear();
  }
  const texts = [];   // 文字を差し替えたもの [el, 元の HTML]
  function setText(el, html) { if (!el) return; if (!texts.some(t => t[0] === el)) texts.push([el, el.innerHTML]); if (el.innerHTML !== html) el.innerHTML = html; }
  function restoreTexts() { texts.forEach(([el, h]) => { el.innerHTML = h; }); texts.length = 0; }

  // ---- メニュー（⋯・▾） ----
  let menu = null, menuFor = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; if (menuFor) menuFor.setAttribute('aria-expanded', 'false'); menuFor = null; } }
  function openMenu(btn, items) {
    if (menuFor === btn) { closeMenu(); return; }
    closeMenu();
    menu = document.createElement('div'); menu.className = 'sb-menu'; menu.setAttribute('role', 'menu');
    items.forEach(it => {
      if (it === '-') { const s = document.createElement('div'); s.className = 'sb-menu-sep'; menu.appendChild(s); return; }
      if (it.hide && it.hide()) return;
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.className = 'sb-mi' + (it.danger ? ' is-danger' : '');
      b.textContent = it.label;
      b.addEventListener('click', () => { closeMenu(); try { it.run(); } catch (e) { console.error(e); } });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
    let left = Math.min(r.right - w, window.innerWidth - w - 8); left = Math.max(8, left);
    let top = r.bottom + 4; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    menu.style.left = left + 'px'; menu.style.top = top + 'px';
    menuFor = btn; btn.setAttribute('aria-expanded', 'true');
    const f = menu.querySelector('button'); if (f) f.focus();
  }
  document.addEventListener('click', e => { if (menu && !menu.contains(e.target) && !(menuFor && menuFor.contains(e.target))) closeMenu(); }, true);
  document.addEventListener('keydown', e => {
    if (!menu) return;
    if (e.key === 'Escape') { e.stopPropagation(); const b = menuFor; closeMenu(); b && b.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const bs = [...menu.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
      e.preventDefault(); const n = bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]; n && n.focus();
    }
  }, true);
  window.addEventListener('scroll', () => { if (menu) closeMenu(); }, true);
  window.addEventListener('resize', closeMenu);
  function mkBtn(id, cls, html, title) { let b = $(id); if (b) return b; b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = cls; b.innerHTML = html; if (title) b.title = title; b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); return b; }

  // ---- 右の列の行 ----
  // 行の定義：{ k, label, val() → [文字, 灰か], op:'▾'|'＋'|'›'|'sw', body:[要素の取得関数]（開くと出す）, act()（押したときの処理）, show() }
  const DEFS = {};
  const TITLES = { 1: 'この案件の状況', 2: 'この案の条件', 3: '貨物の区分・確認', 5: '見積書に添えるもの' };
  const SUBS = { 1: 'お客様と案件名を入れます', 2: '積み地・揚げ地と、運ぶ会社を入れます', 3: '何を、どのくらい運ぶかを入れます', 5: '見積書に載せる文章を入れて、出力します' };
  let open = {};   // 開いている行 { 1:'k', ... }
  let aside = null;

  function buildAside() {
    if (aside) return aside;
    const main = document.querySelector('#tab-quote-make .quote-workspace .quote-main'); if (!main) return null;
    aside = document.createElement('aside'); aside.id = 'sbAside'; aside.className = 'sb-aside';
    aside.innerHTML = '<div class="sb-in">' + [1, 2, 3, 5].map(n => '<section class="sb-panel" data-sb="' + n + '"><h3 class="sb-h">' + TITLES[n] + '</h3><div class="sb-rows"></div></section>').join('') + '<div class="sb-out-slot"></div></div>';
    const nav = $('e2Nav'); main.insertBefore(aside, nav && nav.parentNode === main ? nav : null);
    aside.addEventListener('click', e => {
      const h = e.target.closest('.sb-rh'); if (!h) return;
      const row = h.closest('.sb-row'), n = +row.closest('.sb-panel').dataset.sb, d = (DEFS[n] || []).find(x => x.k === row.dataset.k);
      if (!d) return;
      if (d.act) { d.act(h); refresh(); return; }
      open[n] = open[n] === d.k ? '' : d.k;
      if (d.onOpen && open[n] === d.k) d.onOpen();
      refresh();
      if (open[n] === d.k) { const f = row.querySelector('.sb-rb input:not([type=hidden]):not([readonly]), .sb-rb select, .sb-rb textarea'); if (f && !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) f.focus({ preventScroll: true }); }
    });
    return aside;
  }
  function rowEl(n, d) {
    const box = aside.querySelector('.sb-panel[data-sb="' + n + '"] .sb-rows');
    let r = box.querySelector(':scope > .sb-row[data-k="' + d.k + '"]');
    if (!r) {
      r = document.createElement('div'); r.className = 'sb-row'; r.dataset.k = d.k;
      r.innerHTML = '<button type="button" class="sb-rh"><i class="sb-l"></i><b class="sb-v"></b><em class="sb-op" aria-hidden="true"></em></button><div class="sb-rb" hidden></div>';
      box.appendChild(r);
    }
    return r;
  }
  function renderRows(n) {
    (DEFS[n] || []).forEach(d => {
      const r = rowEl(n, d), vis = !d.show || d.show();
      r.hidden = !vis;
      const [v, muted] = d.val ? d.val() : ['', false];
      const l = r.querySelector('.sb-l'), b = r.querySelector('.sb-v'), op = r.querySelector('.sb-op'), rh = r.querySelector('.sb-rh'), body = r.querySelector('.sb-rb');
      if (l.textContent !== d.label) l.textContent = d.label;
      const vt = v || (d.op === 'sw' ? '使わない' : 'なし');
      if (b.textContent !== vt) b.textContent = vt;
      b.classList.toggle('is-muted', !v || !!muted);
      b.title = vt;
      const isOpen = d.body && open[n] === d.k;
      let o = d.op;
      if (d.op === 'sw') o = '';
      else if (d.body && d.op !== '›') o = isOpen ? '▴' : d.op;
      if (op.textContent !== o) op.textContent = o;
      op.classList.toggle('sb-sw', d.op === 'sw'); op.classList.toggle('is-on', d.op === 'sw' && !!(d.swOn && d.swOn()));
      rh.setAttribute('aria-expanded', d.body ? String(!!isOpen) : 'false');
      if (d.op === 'sw') { rh.setAttribute('role', 'switch'); rh.setAttribute('aria-checked', String(!!(d.swOn && d.swOn()))); }
      if (d.body) { d.body().forEach(el => el && put(el, body)); body.hidden = !isOpen; }
      r.classList.toggle('is-open', !!isOpen);
      if (d.tone) r.dataset.tone = d.tone(); else delete r.dataset.tone;
    });
  }

  // ======================= ① 基本 =======================
  const ciCellOf = id => { const e = $(id); return e && e.closest('.ci-cell'); };
  DEFS[1] = [
    { k: 'rules', label: '📌 取引ルール', op: '›', tone: () => 'rule',
      show: () => { const b = $('crBanner'); return !!b && !b.hidden && !!b.textContent.trim(); },
      val: () => { const t = txt($('crBanner')); const m = /（([^）]*件[^）]*)）/.exec(t); return [m ? m[1] : (t ? 'あり' : ''), false]; },
      body: () => [$('crBanner')] },
    { k: 'status', label: 'ステータス', op: '▾', val: () => [val('qf-status') || '下書き中', false],
      body: () => [document.querySelector('#section-ref .ci-status-block, #sbAside .ci-status-block'), $('qfLostReasonField')] },
    { k: 'recv', label: '依頼受信', op: '▾',
      val: () => { const d = val('qf-received'); if (!d) return ['', false]; const days = Math.max(0, Math.round((Date.now() - new Date(d + 'T00:00:00').getTime()) / 864e5)); const pres = val('qf-first-presented'); return [md(d) + (pres ? '' : '（' + days + '日）'), false]; },
      body: () => [ciCellOf('qf-received')] },
    { k: 'date', label: '発行日', op: '▾', val: () => [md(val('qf-date')) + (shown($('ciAutoDate')) ? '（自動）' : ''), false], body: () => [ciCellOf('qf-date')] },
    { k: 'valid', label: '有効期限', op: '▾',
      val: () => { const e = $('qf-valid-until'); const v = e && e.type === 'date' ? md(e.value) : val('qf-valid-until'); const b = $('ciValidBadge'); return [v + (v && shown(b) && /標準/.test(txt(b)) ? '（標準）' : ''), false]; },
      body: () => [ciCellOf('qf-valid-until')] },
    { k: 'due', label: '提出期限', op: '＋', val: () => [md(val('qf-due')), false], body: () => [$('ciDuePanel')], onOpen: () => { const p = $('ciDuePanel'); if (p) p.hidden = false; } },
    { k: 'rel', label: '関連番号', op: '＋', val: () => { let n = 0; try { n = (JSON.parse(val('qf-related-data') || '[]') || []).length; } catch (e) {} return [n ? n + '件' : '', false]; }, body: () => [$('ciRelPanel')], onOpen: () => { const p = $('ciRelPanel'); if (p) p.hidden = false; } },
    { k: 'files', label: '案件のファイル', op: '›',
      val: () => { const m = /(\d+)/.exec(txt($('cfRefBtn'))); return [m && +m[1] ? '📎 ' + m[1] + '件' : '', false]; },
      act: () => { if (typeof window.cfOpen === 'function') window.cfOpen('internal'); else if (typeof window.srcAddOpen === 'function') window.srcAddOpen(); } },
    { k: 'tags', label: 'タグ・経路', op: '＋',
      val: () => { let t = []; try { t = JSON.parse(val('qf-tags-data') || '[]') || []; } catch (e) {} return [t.map(x => typeof x === 'string' ? x : (x && (x.name || x.tag)) || '').filter(Boolean).join('・'), false]; },
      body: () => [document.querySelector('.quote-field-tags'), $('qfInquiryField')] },
    { k: 'core', label: '基幹 REF#', op: '＋', show: () => { const f = $('qfCoreRefField'); return !!f && !f.hidden; }, val: () => [val('qf-core-ref'), false], body: () => [$('qfCoreRefField')] },
  ];
  function leftBasic(onB) {
    const sec = $('section-ref'); if (!sec) return;
    const cust = $('qfCustomerDetailBtn'), custLab = document.querySelector('.ci-cell-cust .quote-field > label');
    const refEdit = $('ciRefEdit'), refLab = document.querySelector('.ci-cell-ref .quote-field > label');
    const perLab = document.querySelector('.ci-cell-person .quote-field > label');
    if (!onB) return;
    if (cust && custLab) put(cust, custLab);
    if (refEdit && refLab) put(refEdit, refLab);
    if (perLab) setText(perLab, 'ご担当者 <span class="req-mark" aria-hidden="true">*</span><span class="sb-note">敬称は自動</span>');
    const memo = $('ciMemoBtn'); if (memo) memo.classList.toggle('sb-has-memo', !!val('qf-memo'));
  }

  // ======================= ② ルート =======================
  const crumb = k => document.querySelector('#cfCrumbs .cf-crumb[data-cf="' + k + '"]');
  function reselect(k, focusSel) {
    const c = crumb(k);
    if (c) c.click();
    const t = document.querySelector('#section-cond .cond-primary-bar');
    if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (!c && focusSel) { const s = $(focusSel); s && s.focus(); }
  }
  const optGroup = () => { const b = $('insToggleBtn'); return b && b.closest('.cond-prim-group'); };
  DEFS[2] = [
    { k: 'inco', label: '貿易条件', op: '▾', val: () => { const s = $('cond-incoterms'); const o = s && s.value && s.selectedOptions[0]; return [o ? o.textContent.trim().replace(/（.*$/, '') : '', false]; }, act: () => reselect('inco', 'cond-incoterms') },
    { k: 'dir', label: '方向', op: '▾', val: () => [txt(document.querySelector('#dirBtns .cond-prim-btn.active')), false], act: () => reselect('dir') },
    { k: 'mode', label: 'モード', op: '▾', val: () => [txt(document.querySelector('#seaAirBtns .cond-prim-btn.active')) || val('cond-mode'), false], act: () => reselect('mode') },
    { k: 'handling', label: '荷役条件', op: '▾', show: () => { const g = $('handlingGroup'); return !!g && !g.hidden; }, val: () => [val('cond-handling').replace(/（.*$/, ''), false], body: () => [$('handlingGroup'), $('cond-handling-hint')] },
    { k: 'z1', label: '出発地側', op: 'sw', swOn: () => val('cond-zone1-on') === 'true', val: () => [val('cond-zone1-on') === 'true' ? '使う（集荷地）' : '', false], act: () => { const b = $('zone1Btn'); b && b.click(); } },
    { k: 'z3', label: '到着地側', op: 'sw', swOn: () => val('cond-zone3-on') === 'true', val: () => [val('cond-zone3-on') === 'true' ? '使う（配送地）' : '', false], act: () => { const b = $('zone3Btn'); b && b.click(); } },
    { k: 'ins', label: '保険付保', op: '＋', val: () => [val('cond-insurance-on') === 'true' ? '付保する' + (val('insSubcon') ? '（' + val('insSubcon') + '）' : '') : '', false], body: () => [optGroup()] },
  ];
  function leftRoute(onB) {
    if (!onB) return;
    if (typeof window.rfOpenCarrier === 'function') window.rfOpenCarrier();
    const car = $('z2Carrier'), row = car && car.closest('.z2-row');
    if (row && !$('sbCarHead')) {
      const h = document.createElement('div'); h.id = 'sbCarHead'; h.className = 'sb-field-head';
      h.innerHTML = '<label for="z2Carrier">キャリア（船会社） <span class="sb-note">任意</span></label>';
      row.parentNode.insertBefore(h, row);
    }
    const head = $('sbCarHead');
    if (head && !$('sbCarLinks')) {
      const b = mkBtn('sbCarLinks', 'sb-link', '🔗 リンク ▾', 'このキャリアのスケジュール・追跡などのリンク');
      b.addEventListener('click', () => {
        const panel = $('z2CarrierLinks'); if (!panel) return;
        const items = [...panel.querySelectorAll('a, button')].filter(a => a.textContent.trim()).map(a => ({ label: a.textContent.replace(/\s+/g, ' ').trim(), run: () => a.click() }));
        if (!items.length) { if (typeof window.quoteShowToast === 'function') window.quoteShowToast('キャリアを入れると、スケジュール・追跡などのリンクが出ます', 'info', 2600); return; }
        openMenu(b, items);
      });
      head.appendChild(b);
    }
    const lb = $('sbCarLinks'); if (lb) { const c = val('z2Carrier'); const t = '🔗 ' + (c ? esc(c) + ' の' : '') + 'リンク ▾'; if (lb.innerHTML !== t) lb.innerHTML = t; }
    const add = document.querySelector('#zone2Card .z2-route-add');
    if (add) setText(add, '＋ 別の航路を登録（案を比べる）');
    // 国の説明は 1 行に短く
    const note = $('z2PortCountryNote'); let sn = $('sbCountryNote');
    if (note && !sn) { sn = document.createElement('div'); sn.id = 'sbCountryNote'; sn.className = 'sb-country-note'; note.parentNode.insertBefore(sn, note.nextSibling); }
    if (sn) { const need = note && !note.hidden && /まだありません|登録済み港 は/.test(note.textContent); sn.hidden = !need; sn.textContent = need ? '🌐 登録済みの港がない国です。港名を入れると登録を申請できます。' : ''; }
    // ゾーン構成から見積もり行を生成 → ④費用（表の上）
    const zp = document.querySelector('.zone-preset-section'), tw = $('tableWrap');
    if (zp && tw) put(zp, tw.parentNode, tw);
  }

  // ======================= ③ 貨物・物量 =======================
  const kindLabel = () => { const v = val('cond-hazmat'); if (!v || /^なし|一般/.test(v)) return ''; return v.replace(/（クラス要確認）/, '').replace(/^温度管理品/, '温度管理'); };
  const activePat = () => { const c = document.querySelector('#qtyPatternBar .qpat-chip.is-active .qpat-name'); return txt(c); };
  DEFS[3] = [
    { k: 'kind', label: '危険品・特殊', op: '▾', tone: () => /危険品/.test(val('cond-hazmat')) ? 'warn' : '', val: () => [kindLabel(), false], body: () => [$('cargoKindSub')], onOpen: () => { const s = $('cargoKindSub'), b = $('cargoKindBtn'); if (s && s.hidden && b) b.click(); } },
    { k: 'tax', label: '関税率', op: '▾', val: () => { const b = val('cond-hs-basic'), p = val('cond-hs-pref'); return [[b && '基本 ' + b, p && 'EPA ' + p].filter(Boolean).join('・'), false]; }, body: () => [document.querySelector('.cond-rate-card')], onOpen: () => { const s = document.querySelector('.cond-rate-card'), b = $('cargoTaxBtn'); if (s && s.hidden && b) b.click(); } },
    { k: 'law', label: '関連知識', op: '›', val: () => { const m = /(\d+)/.exec(txt(document.querySelector('#cargoLawBtn .cg-badge'))); return [m ? m[1] + '件' : '', false]; }, body: () => [$('cargoLawSub')], onOpen: () => { const s = $('cargoLawSub'), b = $('cargoLawBtn'); if (s && s.hidden && b) b.click(); } },
    { k: 'pat', label: 'この案', op: '▾', val: () => [activePat(), false],
      act: h => openMenu(h, [
        { label: '＋ 別パターンを作成', run: () => window.addPackingPattern && window.addPackingPattern() },
        { label: '⧉ 複製して作成', run: () => window.duplicatePackingPattern && window.duplicatePackingPattern() },
        { label: 'VS FCL/LCL 比較案を作成', hide: () => typeof window.createFclLclPatterns !== 'function', run: () => window.createFclLclPatterns() },
      ]) },
  ];
  const clearItem = { label: '貨物・ルートの入力をクリア', danger: true, run: () => { const b = document.querySelector('#cargoBody .btn-cond-clear'); if (b) b.click(); else if (window.clearConditions) window.clearConditions(); } };
  function packMenuItems() {
    return [
      { label: '📋 テキストでコピー', run: () => window.copyCargoText && window.copyCargoText('active') },
      { label: '📋 全パターンをコピー', hide: () => { const b = $('cdCopyAllBtn'); return !b || b.style.display === 'none'; }, run: () => window.copyCargoText && window.copyCargoText('all') },
      '-',
      { label: '🧊 バンニングシミュレーター', run: () => window.jumpToVanningSimulator && window.jumpToVanningSimulator() },
      { label: '🔲 パレタイズシミュレーター', run: () => window.jumpToPalletizeSimulator && window.jumpToPalletizeSimulator() },
      '-',
      { label: '＋ 別パターンを作成', run: () => window.addPackingPattern && window.addPackingPattern() },
      { label: '⧉ 複製して作成', run: () => window.duplicatePackingPattern && window.duplicatePackingPattern() },
      { label: 'VS FCL/LCL 比較案を作成', hide: () => typeof window.createFclLclPatterns !== 'function', run: () => window.createFclLclPatterns() },
      '-', clearItem,
    ];
  }
  function leftCargo(onB) {
    if (!onB) return;
    const vol = $('section-volume'); if (!vol) return;
    // コンテナの見出し：特殊コンテナは ▾ の切替
    const cf = vol.querySelector('[data-field-id="container-type"]'), lab = cf && cf.querySelector(':scope > label');
    if (lab) {
      setText(lab, 'コンテナ <span class="sb-note">FCL（種類 × 本数）</span>');
      if (!$('sbCcCat')) { const b = mkBtn('sbCcCat', 'sb-link', '', 'ドライ・特殊を切り替える'); b.removeAttribute('aria-haspopup'); b.addEventListener('click', () => { const sp = document.querySelector('.cc-cat-tab[data-cat="special"]'); const isSp = sp && sp.classList.contains('is-on'); if (typeof window.setContainerCat === 'function') window.setContainerCat(isSp ? 'dry' : 'special'); setTimeout(refresh, 30); }); cf.insertBefore(b, lab.nextSibling); }
      const sp = document.querySelector('.cc-cat-tab[data-cat="special"]'), isSp = sp && sp.classList.contains('is-on');
      const t = isSp ? '📦 ドライコンテナに戻る' : '❄️ 特殊コンテナ ▾'; const b = $('sbCcCat'); if (b && b.textContent !== t) b.textContent = t;
    }
    vol.querySelectorAll('.cc-chip').forEach(c => { const i = c.querySelector('.cc-count'); c.classList.toggle('sb-has', !!(i && +i.value > 0)); });
    // 荷姿・貨物明細：見出し（開閉＋合計の 1 行）
    const pf = vol.querySelector('.cond-field--cargo-detail'), plab = pf && pf.querySelector(':scope > label');
    if (pf && plab) {
      const first = vol.classList.contains('ig-pack-first');
      let hd = $('sbPackHead');
      if (!hd) {
        hd = document.createElement('button'); hd.type = 'button'; hd.id = 'sbPackHead'; hd.className = 'sb-pack-head';
        hd.addEventListener('click', () => { if (vol.classList.contains('ig-pack-first')) return; vol.classList.toggle('e2-pack-open'); refresh(); });
        pf.parentNode.insertBefore(hd, pf);
      }
      const open = first || vol.classList.contains('e2-pack-open');
      const tot = 'R/T ' + (txt($('cdTotRt')) || '0.000') + ' ・ CW ' + (txt($('cdTotCw')) || '0') + ' kg ・ CBM ' + (txt($('cdTotCbm')) || '0.000');
      const h = '<b>荷姿・貨物明細</b><span class="sb-note">' + (first ? '' : '任意（FCL）') + '</span>' + (first ? '' : '<span class="sb-pack-tog">' + (open ? '▾ 畳む' : '▸ 開く') + '</span>') + '<span class="sb-pack-tot">' + tot + '</span>';
      if (hd.innerHTML !== h) hd.innerHTML = h;
      hd.setAttribute('aria-expanded', String(open)); hd.classList.toggle('is-static', first);
      // 合計の行：［→ 費用に数量を入れる ▾］［⋯］
      const td = pf.querySelector('.cargo-detail-derived td');
      if (td && !$('sbReflect')) {
        const r = mkBtn('sbReflect', 'sb-btn', '→ 費用に数量を入れる ▾', '費用の表の数量へ入れる（R/T・CW・CBM）');
        r.addEventListener('click', () => openMenu(r, [
          { label: 'R/T を入れる（単位が RT・R/T の行）', run: () => window.reflectToQuote && window.reflectToQuote('rt') },
          { label: 'CW を入れる（単位が KG・CW の行）', run: () => window.reflectToQuote && window.reflectToQuote('cw') },
          { label: 'CBM を入れる（単位が M3・CBM の行）', run: () => window.reflectToQuote && window.reflectToQuote('cbm') },
        ]));
        const m = mkBtn('sbPackMore', 'sb-btn sb-more', '⋯', '荷姿のそのほかの操作');
        m.addEventListener('click', () => openMenu(m, packMenuItems()));
        td.appendChild(r); td.appendChild(m);
      }
      const unk = pf.querySelector('.cd-unknown-toggle'); const tbl = pf.querySelector('.cargo-detail-scroll');
      if (unk && tbl) put(unk, tbl.parentNode, tbl);
    }
  }

  // ======================= ⑤ リマーク・出力 =======================
  DEFS[5] = [
    { k: 'scope', label: '作業範囲', op: '▾', val: () => [val('qf-scope').split('\n')[0], false], body: () => [$('qf-scope')] },
    { k: 'cargo', label: '品物別', op: '▾', val: () => { const s = $('remarkCargoSel'); const o = s && s.value && s.selectedOptions[0]; return [o ? o.textContent.trim() : '', false]; }, body: () => [document.querySelector('.remark-cargo-row')] },
    { k: 'fixed', label: '常時付記', op: '＋',
      val: () => { const b = $('remarkFixedBox'); const items = b ? [...b.querySelectorAll('.remark-fixed-item, li, .rf-item')] : []; const n = items.length; return [n ? n + '件' + (items[0] ? '・' + txt(items[0]).replace(/✕$/, '').slice(0, 14) : '') : '', false]; },
      body: () => [$('remarkFixedBox')] },
    { k: 'img', label: '画像', op: '＋', val: () => { const l = $('remarkImgList'); const n = l ? l.querySelectorAll('img').length : 0; return [n ? n + '枚' : '', false]; }, body: () => [document.querySelector('.remark-img-section')] },
  ];
  function leftRemark(onB) {
    if (!onB) return;
    const sec = $('section-remark'), body = $('remarkBody'), ta = $('remarkTextarea'); if (!sec || !body || !ta) return;
    let hd = $('sbRmHead');
    if (!hd) {
      hd = document.createElement('div'); hd.id = 'sbRmHead'; hd.dataset.sbNew = '1'; hd.className = 'sb-rm-head';
      hd.innerHTML = '<div><b>リマーク</b><span class="sb-note">見積書の『リマーク』に載ります</span></div>';
      const b = mkBtn('sbRmAdd', 'sb-btn', '＋ 定型文を入れる ▾', '定型文を選んで入れる・外す');
      b.setAttribute('aria-haspopup', 'dialog');
      b.addEventListener('click', () => togglePanel());
      hd.appendChild(b);
    }
    put(hd, body, ta);
    let pn = $('sbRmPanel');
    if (!pn) { pn = document.createElement('div'); pn.id = 'sbRmPanel'; pn.dataset.sbNew = '1'; pn.className = 'sb-rm-panel'; pn.hidden = true; pn.setAttribute('role', 'dialog'); pn.setAttribute('aria-label', '定型文を入れる'); pn.innerHTML = '<div class="sb-rmp-top"><b>定型文を入れる</b><button type="button" class="sb-rmp-x" aria-label="閉じる">✕</button></div>'; pn.querySelector('.sb-rmp-x').addEventListener('click', () => togglePanel(false)); }
    put(pn, body, ta);
    const tabs = $('remarkTabs'), btns = $('presetBtns');
    if (tabs) put(tabs, pn); if (btns) put(btns, pn);
    if (tabs) tabs.querySelectorAll('.rm-tab').forEach(t => { const c = /(\d+)/.exec(txt(t.querySelector('.rm-count'))); const zero = !c || +c[1] === 0; const pop = t.dataset.rt === 'popular'; t.classList.toggle('sb-zero', (zero && t.dataset.rt !== 'preset') || pop); });
    // 入っている定型文のチップ
    let chips = $('sbRmChips');
    if (!chips) { chips = document.createElement('div'); chips.id = 'sbRmChips'; chips.dataset.sbNew = '1'; chips.className = 'sb-rm-chips'; chips.addEventListener('click', e => { const x = e.target.closest('[data-i]'); if (!x) return; const b = (btns ? [...btns.querySelectorAll('.preset-btn.active')] : [])[+x.dataset.i]; if (b) b.click(); setTimeout(refresh, 30); }); }
    const act = btns ? [...btns.querySelectorAll('.preset-btn.active')] : [];
    const h = act.map((b, i) => '<span class="sb-chip">' + esc(txt(b).replace(/✕$/, '').trim()) + '<button type="button" data-i="' + i + '" aria-label="外す" title="この定型文を外す">✕</button></span>').join('');
    if (chips.dataset.h !== h) { chips.dataset.h = h; chips.innerHTML = h; }
    chips.hidden = !act.length;
    const acts = body.querySelector('.remark-actions');
    if (acts) put(chips, body, acts.nextSibling); else put(chips, body);
    // 文章の欄：最初は 6 行、入力に合わせて伸びる（上限は画面の半分）
    if (!ta.dataset.sbGrow) { ta.dataset.sbGrow = '1'; ta.addEventListener('input', grow); }
    grow();
  }
  function grow() { const ta = $('remarkTextarea'); if (!ta || !isB()) return; ta.style.height = 'auto'; const max = Math.round(window.innerHeight / 2); ta.style.height = Math.min(max, Math.max(120, ta.scrollHeight + 2)) + 'px'; ta.style.overflowY = ta.scrollHeight + 2 > max ? 'auto' : 'hidden'; }
  function togglePanel(force) {
    const pn = $('sbRmPanel'), b = $('sbRmAdd'); if (!pn) return;
    const want = force === undefined ? pn.hidden : force;
    pn.hidden = !want; if (b) b.setAttribute('aria-expanded', String(want));
    if (want) { const t = pn.querySelector('.rm-tab.is-on, .rm-tab'); t && t.focus(); }
  }
  document.addEventListener('click', e => { const pn = $('sbRmPanel'); if (!pn || pn.hidden) return; if (pn.contains(e.target) || e.target.closest('#sbRmAdd')) return; togglePanel(false); }, true);
  document.addEventListener('keydown', e => { const pn = $('sbRmPanel'); if (e.key === 'Escape' && pn && !pn.hidden) { e.stopPropagation(); togglePanel(false); const b = $('sbRmAdd'); b && b.focus(); } }, true);

  // ---- 本文の見出しの右の［⋯］（③：入力をクリア） ----
  function headMore() {
    const hd = $('e2Head'); if (!hd) return;
    let m = $('sbHeadMore');
    if (!m) { m = mkBtn('sbHeadMore', 'sb-btn sb-more', '⋯', 'このステップのそのほかの操作'); m.addEventListener('click', () => openMenu(m, [clearItem])); }
    if (m.parentNode !== hd) hd.appendChild(m);
  }

  // ======================= 全体 =======================
  const step = () => { const t = $('tab-quote-make'); return t ? +(t.dataset.e2 || 0) : 0; };
  const isB = () => on() && [1, 2, 3, 5].includes(step());
  let active = false;
  function enable() {
    const tab = $('tab-quote-make'); if (!tab || !buildAside()) return;
    tab.classList.add('sb-on'); active = true;
  }
  function disable() {
    const tab = $('tab-quote-make'); if (tab) tab.classList.remove('sb-on', 'sb-two');
    togglePanel(false); closeMenu();
    restoreAll(); restoreTexts();
    ['sbCarHead', 'sbCountryNote', 'sbPackHead', 'sbReflect', 'sbPackMore', 'sbRmHead', 'sbRmPanel', 'sbRmChips', 'sbHeadMore', 'sbCcCat'].forEach(id => { const e = $(id); if (e) e.remove(); });
    const ta = $('remarkTextarea'); if (ta) { ta.style.height = ''; ta.style.overflowY = ''; }
    if (aside) { aside.remove(); aside = null; }
    open = {}; active = false;
  }
  let busy = false;
  function refresh() {
    if (busy) return;
    if (!on()) { if (active) disable(); return; }
    busy = true;
    try {
      if (!active) enable(); if (!active) return;
      const n = step(), tab = $('tab-quote-make');
      const ws = document.querySelector('#tab-quote-make .quote-workspace');
      const two = !!ws && ws.clientWidth >= 1060 && window.innerWidth > 600;
      if (tab && tab.classList.contains('sb-two') !== two) tab.classList.toggle('sb-two', two);
      { const nav = $('e2Nav'); if (nav && nav.parentNode === aside.parentNode && aside.nextSibling !== nav) aside.parentNode.insertBefore(aside, nav); }
      // 出力する（⑤）：右の列の下へ
      const out = $('e2Out'), slot = aside.querySelector('.sb-out-slot');
      if (out && slot && n === 5) put(out, slot);
      leftBasic(n === 1); leftRoute(n === 2); leftCargo(n === 3); leftRemark(n === 5);
      [1, 2, 3, 5].forEach(k => { const p = aside.querySelector('.sb-panel[data-sb="' + k + '"]'); if (p) p.hidden = k !== n; if (k === n) renderRows(k); });
      aside.hidden = ![1, 2, 3, 5].includes(n);
      if (tab) { const sub = SUBS[n] || ''; if (tab.dataset.sbSub !== sub) tab.dataset.sbSub = sub; }
      const hd = $('e2Head'); if (hd) { let s = $('sbSub'); if (!s) { s = document.createElement('span'); s.id = 'sbSub'; } if (s.parentNode !== hd) hd.appendChild(s); if (s.textContent !== (SUBS[n] || '')) s.textContent = SUBS[n] || ''; }
      if (n === 3) headMore(); else { const m = $('sbHeadMore'); if (m) m.remove(); }
      fitHeight();
    } finally { busy = false; }
  }
  // 右の列（絶対配置）が左より長いとき、本文の高さを足して重ならないようにする
  function fitHeight() {
    const main = aside && aside.parentNode; if (!main) return;
    const inn = aside.querySelector('.sb-in'); if (!inn) return;
    const two = getComputedStyle(aside).position === 'absolute';
    const h = two ? Math.ceil(inn.offsetHeight + 24) + 'px' : '';
    if (main.style.minHeight !== h) main.style.minHeight = h;
  }
  let t = 0; const kick = () => { clearTimeout(t); t = setTimeout(refresh, 80); };
  function init() {
    new MutationObserver(kick).observe(root, { attributes: true, attributeFilter: ['class'] });
    const tab = $('tab-quote-make'); if (tab) new MutationObserver(kick).observe(tab, { attributes: true, attributeFilter: ['data-e2'] });
    document.addEventListener('input', e => { if (isB() && e.target && e.target.closest && e.target.closest('#tab-quote-make')) kick(); }, true);
    document.addEventListener('change', e => { if (isB() && e.target && e.target.closest && e.target.closest('#tab-quote-make')) kick(); }, true);
    document.addEventListener('click', e => { if (isB() && e.target && e.target.closest && e.target.closest('#tab-quote-make')) kick(); }, true);
    window.addEventListener('resize', () => { if (isB()) { fitHeight(); grow(); } });
    setInterval(() => { if (on() && isB()) refresh(); }, 1200);
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.sbRefresh = refresh;
  window.sbOpenRow = (k) => { const n = step(); open[n] = k; refresh(); };
})();
