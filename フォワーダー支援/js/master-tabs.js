// お客様マスター詳細のタブ化（Design 回答 2026-11・案1）：上に基本情報（名称・ふりがな・英語名称・取引形態・経由する同業者／先のお客様）、
// タブ「担当者｜会社の詳細・タグ｜取引ルール｜メモ・添付」（要約つき）、保存バーは下に常時表示。
// stats.js の statsToggleMasterDetail が作る詳細（#mdDetailModal）の要素を並べ替えるだけ（入力欄の id・保存処理・添付・取引ルールは変えない）。
(function () {
  'use strict';
  const $ = (r, s) => r.querySelector(s);
  function holder(root, id, cls) { const e = root.querySelector('#' + id); return e ? (e.closest(cls) || e) : null; }
  function organize(modal) {
    const form = $(modal, '.master-detail-form'), body = $(modal, '.md-modal-body'), box = $(modal, '.md-modal');
    if (!form || !body || !box || modal.dataset.mtDone) return; modal.dataset.mtDone = '1';
    const actions = $(form, '.master-detail-actions'), attach = $(modal, '.master-attach-box'), cr = $(modal, '.cr-section'), mn = $(modal, '.mn-section'), cc = $(modal, '.cc-section');
    const L = (id) => holder(form, id, '.master-detail-label');
    const isSv = modal.dataset.mtField === 'sv';
    const basic = [L('md_furigana'), L('md_enName'), L('md_dealType'), L('md_via'), holder(form, 'md_viaChildren', '.master-detail-via')].filter(Boolean);
    const people = [holder(form, 'md_contacts', '.master-detail-contacts')].filter(Boolean);
    const company = isSv
      ? [L('md_website'), holder(form, 'md_svTypes', '.master-detail-tags'), holder(form, 'md_areas', '.master-detail-areas'), L('md_group')].filter(Boolean)
      : [L('md_location'), L('md_mainGoods'), L('md_destCountry'), L('md_tendency'), L('md_website'), holder(form, 'md_tags', '.master-detail-tags')].filter(Boolean);
    const memo = [L('md_memo')].filter(Boolean);
    // 基本情報
    const top = document.createElement('div'); top.className = 'mt-basic';
    basic.forEach(e => top.appendChild(e));
    // タブ
    const bar = document.createElement('div'); bar.className = 'mt-tabs'; bar.setAttribute('role', 'tablist');
    const panels = {};
    const defs = isSv
      ? [['people', '担当者'], ['company', '会社の詳細・種別・エリア'], ['news', 'ニュース'], ['memo', 'メモ・添付']]
      : [['people', '担当者'], ['company', '会社の詳細・タグ'], ['cases', '顧客カルテ'], ['rules', '取引ルール'], ['news', 'ニュース'], ['memo', 'メモ・添付']];
    defs.forEach(([k, label]) => {
      const p = document.createElement('div'); p.className = 'mt-panel'; p.dataset.mt = k; p.setAttribute('role', 'tabpanel'); panels[k] = p;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mt-tab'; b.dataset.mt = k; b.setAttribute('role', 'tab');
      b.innerHTML = label + ' <span class="mt-sum"></span>'; b.addEventListener('click', () => show(k)); bar.appendChild(b);
    });
    people.forEach(e => panels.people.appendChild(e)); company.forEach(e => panels.company.appendChild(e));
    if (cr) panels.rules.appendChild(cr); if (mn) panels.news.appendChild(mn); if (cc) panels.cases.appendChild(cc); memo.forEach(e => panels.memo.appendChild(e)); if (attach) panels.memo.appendChild(attach);
    form.innerHTML = ''; form.appendChild(top); form.appendChild(bar); defs.forEach(([k]) => form.appendChild(panels[k]));
    // 保存バー：下に常時表示（本文のスクロールの外）
    if (actions) { const foot = document.createElement('div'); foot.className = 'mt-foot'; foot.appendChild(actions); box.appendChild(foot); }
    body.classList.add('mt-body');
    function show(k) {
      bar.querySelectorAll('.mt-tab').forEach(b => { const on = b.dataset.mt === k; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      defs.forEach(([kk]) => panels[kk].hidden = kk !== k);
    }
    // 取引形態に応じた条件表示：同業者のときだけ「先のお客様」を出す
    const deal = modal.querySelector('#md_dealType'), kids = holder(form, 'md_viaChildren', '.master-detail-via');
    const fwd = window.MD_DEAL_FWD || '同業者（フォワーダー・代理店）';
    const cond = () => { if (kids) kids.hidden = !!deal && deal.value !== fwd && deal.value !== '海外代理店' && !kids.querySelector('.stats-md-via-chip'); };
    if (deal) deal.addEventListener('change', cond); cond();
    // 要約
    const sum = (k, t) => { const s = bar.querySelector('.mt-tab[data-mt="' + k + '"] .mt-sum'); if (s) { s.textContent = t || ''; s.hidden = !t; } };
    function refresh() {
      const named = [...modal.querySelectorAll('#md_contacts .md-contact-name')].filter(i => i.value.trim()).length;
      sum('people', named ? named + '名' : '');
      const tags = modal.querySelectorAll(isSv ? '#md_svTypes .stats-md-tag-chip, #md_areas .stats-md-tag-chip' : '#md_tags .stats-md-tag-chip').length;
      const filled = (isSv ? ['md_website', 'md_group'] : ['md_location', 'md_mainGoods', 'md_destCountry', 'md_tendency', 'md_website']).filter(i => (modal.querySelector('#' + i)?.value || '').trim()).length;
      sum('company', [filled ? filled + '項目' : '', tags ? (isSv ? '種別・エリア' : 'タグ') + tags : ''].filter(Boolean).join('・'));
      const items = modal.querySelectorAll('#crPanel .cr-item:not(.is-retired)'), strict = modal.querySelectorAll('#crPanel .cr-item.cr-lv-strict:not(.is-retired)').length;
      sum('rules', items.length ? items.length + '件' + (strict ? '・厳守' + strict : '') : '');
      const cItems = modal.querySelectorAll('#ccPanel .cc-item'), cOpen = modal.querySelectorAll('#ccPanel .cc-st-open').length; sum('cases', cItems.length ? cItems.length + '件' + (cOpen ? '・未解決' + cOpen : '') : '');
      const nItems = modal.querySelectorAll('#mnPanel .mn-item').length; sum('news', nItems ? nItems + '件' : '');
      const att = modal.querySelectorAll('#mdAttachList .master-attach-item').length, memoV = (modal.querySelector('#md_memo')?.value || '').trim();
      sum('memo', [memoV ? 'メモあり' : '', att ? '添付' + att : ''].filter(Boolean).join('・'));
    }
    ['input', 'change', 'click'].forEach(t => modal.addEventListener(t, () => setTimeout(refresh, 0)));
    ['#mdAttachList', '#crPanel', '#mnPanel', '#ccPanel'].forEach(s => { const e = modal.querySelector(s); if (e) new MutationObserver(refresh).observe(e, { childList: true, subtree: true }); });
    const strictInit = () => modal.querySelector('#crPanel .cr-item.cr-lv-strict:not(.is-retired)');
    show('people'); refresh();
    // 厳守の取引ルールがあるときは「取引ルール」タブを開いて見せる（取りこぼし防止）
    setTimeout(() => { if (strictInit()) show('rules'); refresh(); }, 600);
  }
  function hook() {
    const orig = window.statsToggleMasterDetail;
    if (typeof orig !== 'function' || orig.__mt) return false;
    const w = function (field, value, btn) {
      const r = orig.apply(this, arguments);
      if (field === 'customer' || field === 'sv') { const m = document.getElementById('mdDetailModal'); if (m) { m.dataset.mtField = field; organize(m); } }
      return r;
    };
    w.__mt = true; window.statsToggleMasterDetail = w; return true;
  }
  if (!hook()) window.addEventListener('load', hook);
})();
