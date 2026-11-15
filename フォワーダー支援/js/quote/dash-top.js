// 見積ダッシュボード上部の整理（Design 20「案D＋タグ T2」・2026-11）。
// 既存の DOM（統計タイル・範囲チップ・検索・並び替え・カード／リスト・詳細検索・タグ欄）は残したまま、表示だけ組み替える薄い層。
//  ・見出し行：要フォロー／未取込の札（0 件は出さない）・［＋ 新しい見積を作る］・［▶ 作業中の見積に戻る］（作業中だけ）・［⋯］（自由入力で保管／かんたん・詳細表示）
//  ・ステータスのチップ 1 行（全体・作業中・提示済み・受注＋「その他 ▾」）…隠したタイルを押して既存の絞り込みを動かす
//  ・道具の 1 行：範囲 ▾／検索／🏷 タグ ▾／🔎 絞り込み／表示 ▾（スマホは下から出るシート）
//  ・タグのパネル：検索・選択中（すべて含む／どれか含む）・よく使う 10・最近使った・すべてのタグ・N 件を見る
// 絞り込みの状態は cloud.js が持つ（cloudTagState／cloudTagToggle ほか）。ここは見せ方だけ。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const OTHERS = ['ヨコヨコ提示', '失注', '辞退', '保留'];
  let built = false, tagQuery = '', tagAll = false, openId = '', raf = 0;

  function root() { return $('qpDashboard'); }

  function build() {
    const d = root(); if (!d || built) return;
    const head = d.querySelector('.qpd-head'), tools = d.querySelector('.qpd-tools'), stats = $('qpdStats');
    if (!head || !tools || !stats) return;
    built = true;
    d.classList.add('dt-on');

    // --- 見出し行 ---
    const title = head.querySelector('.qpd-title');
    const badges = document.createElement('span'); badges.id = 'dtBadges'; badges.className = 'dt-badges';
    title.after(badges);
    const acts = head.querySelector('.qpd-head-actions');
    const more = document.createElement('div'); more.className = 'dt-pop-wrap';
    more.innerHTML = '<button type="button" class="dt-icon-btn" id="dtMoreBtn" aria-haspopup="true" aria-expanded="false" title="その他（自由入力で保管・かんたん／詳細表示）">⋯</button>' +
      '<div class="dt-pop dt-pop-right" id="dtMorePop" role="menu" hidden><p class="dt-pop-lbl">表示モード</p><div id="dtUimSlot"></div><hr><div id="dtStoreSlot"></div></div>';
    acts.appendChild(more);
    const sw = acts.querySelector('.uim-switch'); if (sw) $('dtUimSlot').appendChild(sw);
    const st = acts.querySelector('.qpd-store'); if (st) $('dtStoreSlot').appendChild(st);

    // --- ステータスのチップ ---
    const chips = document.createElement('div'); chips.id = 'dtChips'; chips.className = 'dt-chips'; chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'ステータス');
    stats.before(chips);

    // --- 道具の 1 行 ---
    const bar = document.createElement('div'); bar.id = 'dtBar'; bar.className = 'dt-bar';
    bar.innerHTML =
      '<label class="dt-scope" id="dtScopeWrap"><span class="dt-sr">案件の範囲</span><select id="dtScope" aria-label="案件の範囲"></select></label>' +
      '<div class="dt-search-slot" id="dtSearchSlot"></div>' +
      '<div class="dt-pop-wrap"><button type="button" class="dt-btn" id="dtTagBtn" aria-haspopup="true" aria-expanded="false">🏷 タグ <span class="dt-n" id="dtTagN" hidden></span> ▾</button>' +
        '<div class="dt-pop dt-sheet" id="dtTagPop" role="dialog" aria-label="タグで絞り込み" hidden></div></div>' +
      '<div class="dt-pop-wrap"><button type="button" class="dt-btn" id="dtFilterBtn" aria-haspopup="true" aria-expanded="false">🔎 絞り込み <span class="dt-n" id="dtFilterN" hidden></span></button>' +
        '<div class="dt-pop dt-sheet" id="dtFilterPop" role="dialog" aria-label="絞り込み" hidden><div class="dt-sheet-head"><b>🔎 絞り込み</b><button type="button" class="dt-x" data-dt-close aria-label="閉じる">✕</button></div><div id="dtFilterSlot"></div></div></div>' +
      '<div class="dt-pop-wrap"><button type="button" class="dt-btn" id="dtViewBtn" aria-haspopup="true" aria-expanded="false">表示 ▾</button>' +
        '<div class="dt-pop dt-sheet" id="dtViewPop" role="dialog" aria-label="表示" hidden><div class="dt-sheet-head"><b>表示</b><button type="button" class="dt-x" data-dt-close aria-label="閉じる">✕</button></div><div id="dtViewSlot"></div></div></div>';
    tools.prepend(bar);
    const sel = $('qpdSelectedTags') || document.createElement('div');   // 選んだタグの行（道具の下）
    sel.id = 'dtSelTags'; sel.className = 'dt-seltags'; sel.hidden = true; bar.after(sel);

    // 既存の部品を新しい場所へ「要素ごと」移す（id・onclick・状態はそのまま）
    const sw2 = tools.querySelector('.qpd-search-wrap'); if (sw2) $('dtSearchSlot').appendChild(sw2);
    const adv = $('qpdAdv'); if (adv) { adv.classList.add('dt-adv'); $('dtFilterSlot').appendChild(adv); adv.hidden = false; }
    const sort = tools.querySelector('.qpd-sort'); if (sort) $('dtViewSlot').appendChild(sort);
    const seg = tools.querySelector('.qpd-view-seg'); if (seg) $('dtViewSlot').appendChild(seg);
    const link = $('qpdLinkModeBtn'); if (link) $('dtViewSlot').appendChild(link);
    $('dtViewSlot').insertAdjacentHTML('beforeend', '<div class="dt-pop-foot"><button type="button" class="dt-btn dt-primary" data-dt-close>閉じる</button></div>');
    $('dtFilterSlot').insertAdjacentHTML('beforeend', '<div class="dt-pop-foot"><button type="button" class="dt-btn dt-primary" data-dt-close>この条件で見る</button></div>');

    wire();
    refresh();
  }

  // ---- 開閉 ----
  const POPS = { dtMore: ['dtMoreBtn', 'dtMorePop'], dtTag: ['dtTagBtn', 'dtTagPop'], dtFilter: ['dtFilterBtn', 'dtFilterPop'], dtView: ['dtViewBtn', 'dtViewPop'], dtChipMore: ['dtChipMoreBtn', 'dtChipMorePop'] };
  function closeAll(except) {
    Object.keys(POPS).forEach(k => {
      if (k === except) return;
      const b = $(POPS[k][0]), p = $(POPS[k][1]); if (!b || !p) return;
      p.hidden = true; b.setAttribute('aria-expanded', 'false');
    });
    if (!except) { openId = ''; document.body.classList.remove('dt-sheet-open'); }
  }
  function toggle(key) {
    const b = $(POPS[key][0]), p = $(POPS[key][1]); if (!b || !p) return;
    const open = p.hidden; closeAll(open ? key : null);
    p.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false'); openId = open ? key : '';
    document.body.classList.toggle('dt-sheet-open', open && /Tag|Filter|View|ChipMore/.test(key) && window.matchMedia('(max-width:600px)').matches);
    if (open && key === 'dtTag') { renderTagPop(); const i = $('dtTagSearch'); if (i && !window.matchMedia('(pointer:coarse)').matches) i.focus(); }
  }
  function wire() {
    const d = root();
    d.addEventListener('click', e => {
      const b = e.target.closest('#dtMoreBtn,#dtTagBtn,#dtFilterBtn,#dtViewBtn,#dtChipMoreBtn');
      if (b) { e.stopPropagation(); toggle({ dtMoreBtn: 'dtMore', dtTagBtn: 'dtTag', dtFilterBtn: 'dtFilter', dtViewBtn: 'dtView', dtChipMoreBtn: 'dtChipMore' }[b.id]); return; }
      if (e.target.closest('[data-dt-close]')) { closeAll(null); return; }
      if (e.target.closest('#dtChipMorePop button[data-dt-st]')) { setTimeout(() => closeAll(null), 0); }
      if (e.target.closest('#dtMorePop .uim-switch button, #dtMorePop .qpd-store')) { setTimeout(() => closeAll(null), 0); }
    });
    document.addEventListener('click', e => { if (openId && !e.target.closest('.dt-pop-wrap')) closeAll(null); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && openId) { const k = POPS[openId][0]; closeAll(null); const b = $(k); if (b) b.focus(); } });
    // ステータスのチップ：隠したタイルを押す（既存の絞り込みがそのまま動く）
    $('dtChips').addEventListener('click', e => {
      const c = e.target.closest('[data-dt-st]'); if (!c) return;
      const tile = tileOf(c.dataset.dtSt); if (tile) tile.click();
    });
    $('dtBadges').addEventListener('click', e => {
      const c = e.target.closest('[data-dt-tile]'); if (!c) return;
      const t = document.querySelector('#qpdStats .qpd-stat--' + c.dataset.dtTile); if (t) t.click();
    });
    $('dtScope').addEventListener('change', e => { if (typeof window.cloudFilterScope === 'function') window.cloudFilterScope(e.target.value); });
    // タグのパネル
    $('dtTagPop').addEventListener('click', onTagClick);
    $('dtTagPop').addEventListener('input', e => { if (e.target.id === 'dtTagSearch') { tagQuery = e.target.value; renderTagPop(true); } });
    $('dtTagPop').addEventListener('keydown', e => {
      if (e.target.id === 'dtTagSearch' && e.key === 'Enter' && !e.isComposing) {
        e.preventDefault(); const q = tagQuery.trim().toLowerCase(); if (!q) return;
        const st = window.cloudTagState(); const hit = st.list.find(c => c.tag.toLowerCase() === q) || st.list.find(c => c.tag.toLowerCase().includes(q));
        if (hit) { window.cloudTagToggle(hit.tag); tagQuery = ''; }
        else if (typeof window.quoteShowToast === 'function') window.quoteShowToast('⚠️ 該当するタグが見つかりません', 'warn', 2000);
      }
    });
    $('dtSelTags').addEventListener('click', onTagClick);
    // 絞り込み欄は入力のたびに件数バッジを更新
    $('dtFilterPop').addEventListener('input', schedule);
    $('dtFilterPop').addEventListener('change', schedule);
  }
  function tileOf(val) {
    const tiles = [...document.querySelectorAll('#qpdStats .qpd-stat')];
    return tiles.find(t => (t.getAttribute('onclick') || '').indexOf("cloudFilterStatus('" + val + "')") >= 0);
  }

  // ---- タグ ----
  function onTagClick(e) {
    const t = e.target.closest('[data-dt-tag],[data-dt-tagx],[data-dt-mode],[data-dt-tagclear],[data-dt-tagall]'); if (!t) return;
    e.stopPropagation();
    if (t.dataset.dtTag != null) window.cloudTagToggle(t.dataset.dtTag);
    else if (t.dataset.dtTagx != null) window.cloudTagToggle(t.dataset.dtTagx);
    else if (t.dataset.dtMode) window.cloudTagSetMode(t.dataset.dtMode);
    else if (t.dataset.dtTagclear != null) window.cloudTagClear();
    else if (t.dataset.dtTagall != null) { tagAll = !tagAll; renderTagPop(); }
  }
  function renderSelTags() {
    const st = window.cloudTagState(), box = $('dtSelTags'); if (!box) return;
    box.hidden = !st.tags.length;
    box.innerHTML = st.tags.length ? '<span class="dt-seltags-l">タグ</span>' + st.tags.map(t => '<button type="button" class="dt-tagchip is-on" data-dt-tagx="' + esc(t) + '" title="外す">🏷 ' + esc(t) + ' ✕</button>').join('') +
      (st.tags.length > 1 ? '<span class="dt-seltags-m">' + (st.mode === 'or' ? 'どれか含む' : 'すべて含む') + '</span>' : '') +
      '<button type="button" class="dt-link" data-dt-tagclear>すべて外す</button>' : '';
    const n = $('dtTagN'); if (n) { n.hidden = !st.tags.length; n.textContent = st.tags.length; }
  }
  function renderTagPop(keepFocus) {
    const pop = $('dtTagPop'); if (!pop) return;
    const st = window.cloudTagState(), q = tagQuery.trim().toLowerCase();
    const chip = c => '<button type="button" class="dt-tagchip' + (st.tags.includes(c.tag) ? ' is-on' : '') + '" data-dt-tag="' + esc(c.tag) + '">🏷 ' + esc(c.tag) + '<span class="dt-tagn">' + c.count + '</span></button>';
    const byTag = new Map(st.list.map(c => [c.tag, c]));
    let h = '<div class="dt-sheet-head"><b>🏷 タグで絞り込み</b><button type="button" class="dt-x" data-dt-close aria-label="閉じる">✕</button></div>' +
      '<input type="search" id="dtTagSearch" class="dt-tagsearch" autocomplete="off" placeholder="タグ名で絞り込み（候補から選択 or Enter）" value="' + esc(tagQuery) + '">';
    if (q) {
      const hits = st.list.filter(c => c.tag.toLowerCase().includes(q));
      h += '<p class="dt-pop-lbl">候補 ' + hits.length + ' 件</p><div class="dt-tagwrap">' + (hits.map(chip).join('') || '<span class="dt-muted">該当するタグはありません</span>') + '</div>';
    } else {
      if (st.tags.length) {
        h += '<p class="dt-pop-lbl">選択中</p><div class="dt-tagwrap">' + st.tags.map(t => '<button type="button" class="dt-tagchip is-on" data-dt-tagx="' + esc(t) + '">🏷 ' + esc(t) + ' ✕</button>').join('') + '</div>' +
          (st.tags.length > 1 ? '<div class="dt-seg" role="group" aria-label="複数タグの組み合わせ"><button type="button" class="' + (st.mode === 'and' ? 'is-on' : '') + '" data-dt-mode="and">すべて含む</button><button type="button" class="' + (st.mode === 'or' ? 'is-on' : '') + '" data-dt-mode="or">どれか含む</button></div>' : '');
      }
      const top = st.list.slice(0, 10);
      h += '<p class="dt-pop-lbl">よく使う</p><div class="dt-tagwrap">' + (top.map(chip).join('') || '<span class="dt-muted">タグが付いた案件がありません</span>') + '</div>';
      const recent = st.recent.map(t => byTag.get(t)).filter(Boolean).slice(0, 3);
      if (recent.length) h += '<p class="dt-pop-lbl">最近使った</p><div class="dt-tagwrap">' + recent.map(chip).join('') + '</div>';
      if (st.list.length > 10) {
        h += '<button type="button" class="dt-link dt-allbtn" data-dt-tagall>' + (tagAll ? '▲ 折りたたむ' : 'すべてのタグを見る（' + st.list.length + '）') + '</button>';
        if (tagAll) h += '<div class="dt-tagwrap dt-tagall">' + st.list.map(chip).join('') + '</div>';
      }
    }
    h += '<div class="dt-pop-foot"><button type="button" class="dt-btn dt-primary" data-dt-close>' + st.shown + ' 件を見る</button></div>';
    pop.innerHTML = h;
    if (keepFocus) { const i = $('dtTagSearch'); if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) {} } }
  }

  // ---- 更新（絞り込みや描き直しのたびに）----
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; refresh(); }); }
  function refresh() {
    if (!built) { build(); if (!built) return; }
    // 作業中の見積に戻る：作業中のときだけ
    const rs = document.querySelector('#qpDashboard .qpd-resume');
    if (rs) rs.hidden = !(typeof window.qpHasWorkingQuote === 'function' && window.qpHasWorkingQuote());
    // ステータスのチップ・札
    const tiles = [...document.querySelectorAll('#qpdStats .qpd-stat')];
    const info = {};
    tiles.forEach(t => {
      const m = /cloudFilterStatus\('([^']*)'\)/.exec(t.getAttribute('onclick') || '');
      const val = m ? m[1] : null; if (val == null) return;
      info[val] = { n: (t.querySelector('.qpd-stat-n') || {}).textContent || '0', on: t.classList.contains('is-active') };
    });
    const chip = (val, label) => {
      const i = info[val] || { n: '0', on: false };
      return '<button type="button" class="dt-chip' + (i.on ? ' is-on' : '') + '" data-dt-st="' + esc(val) + '" aria-pressed="' + i.on + '">' + esc(label) + '<span class="dt-chip-n">' + esc(i.n) + '</span></button>';
    };
    const otherOn = OTHERS.find(o => (info[o] || {}).on);
    let h = chip('', '全体') + chip('__draft_revising__', '作業中') + chip('提出済み', '提示済み') + chip('受注', '受注');
    h += '<div class="dt-pop-wrap"><button type="button" class="dt-chip dt-chip-more' + (otherOn ? ' is-on' : '') + '" id="dtChipMoreBtn" aria-haspopup="true" aria-expanded="false">' + esc(otherOn || 'その他') + ' ▾</button>' +
      '<div class="dt-pop dt-sheet dt-chipmore" id="dtChipMorePop" role="menu" hidden><div class="dt-sheet-head"><b>その他のステータス</b><button type="button" class="dt-x" data-dt-close aria-label="閉じる">✕</button></div>' +
      OTHERS.map(o => '<button type="button" class="dt-menu' + ((info[o] || {}).on ? ' is-on' : '') + '" data-dt-st="' + esc(o) + '">' + esc(o) + '<span class="dt-chip-n">' + esc((info[o] || { n: '0' }).n) + '</span></button>').join('') + '</div></div>';
    const keepOpen = $('dtChipMorePop') && !$('dtChipMorePop').hidden;
    $('dtChips').innerHTML = h;
    if (keepOpen) { $('dtChipMorePop').hidden = false; $('dtChipMoreBtn').setAttribute('aria-expanded', 'true'); }
    // 札（要フォロー・未取込：0 件なら出ない＝タイルが無い）
    const bd = [];
    const fl = tiles.find(t => t.classList.contains('qpd-stat--follow')), pe = tiles.find(t => t.classList.contains('qpd-stat--pend'));
    if (fl) bd.push('<button type="button" class="dt-badge' + (fl.classList.contains('is-active') ? ' is-on' : '') + '" data-dt-tile="follow">🔔 要フォロー ' + esc((fl.querySelector('.qpd-stat-n').textContent || '').replace(/[^\d]/g, '')) + '</button>');
    if (pe) bd.push('<button type="button" class="dt-badge' + (pe.classList.contains('is-active') ? ' is-on' : '') + '" data-dt-tile="pend">📩 未取込 ' + esc((pe.querySelector('.qpd-stat-n').textContent || '').replace(/[^\d]/g, '')) + '</button>');
    $('dtBadges').innerHTML = bd.join('');
    // 範囲（select）
    const chipsS = [...document.querySelectorAll('#qpdScope .qpd-scope-chip')];
    const sc = $('dtScope'), wrap = $('dtScopeWrap');
    if (sc && wrap) {
      wrap.hidden = !chipsS.length;
      sc.innerHTML = chipsS.map(c => {
        const m = /cloudFilterScope\('([^']*)'\)/.exec(c.getAttribute('onclick') || ''); const v = m ? m[1] : '';
        const lab = (c.firstChild ? c.firstChild.textContent : '').trim(), n = (c.querySelector('.cloud-chip-n') || {}).textContent || '';
        return '<option value="' + esc(v) + '"' + (c.classList.contains('is-active') ? ' selected' : '') + '>' + esc(lab + ' ' + n) + '</option>';
      }).join('');
    }
    // タグ・絞り込みのバッジ
    renderSelTags();
    if ($('dtTagPop') && !$('dtTagPop').hidden) renderTagPop(document.activeElement && document.activeElement.id === 'dtTagSearch');
    const adv = ['qpdFilterMode', 'qpdFilterInco', 'qpdFilterPol', 'qpdFilterPod', 'qpdFilterCarrier'].filter(id => { const e = $(id); return e && String(e.value || '').trim(); }).length;
    const fn = $('dtFilterN'); if (fn) { fn.hidden = !adv; fn.textContent = adv; }
  }

  window.dtRefresh = schedule;
  function init() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
