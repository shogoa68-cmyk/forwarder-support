// 幹線輸送：POD の国がインドのとき、「ICD（インランドデポ）」を入力できるようにする。
//   ICD＝インドの内陸通関拠点（例：ICD Tughlakabad）。名称だけを持つ（入力欄 #z2Icd・見積の項目として保存・復元される）。
//   候補は、マスター管理の「ICD」（field='icd'・詳細の country が POD の国）。マスターに無い名称を確定すると、
//   その国のICDとして登録（承認制のメンバーは申請）できる（確認の吹き出しは alias-rules.js _checkIcdMaster）。
//   欄は「POD の国（#z2PodCountry・港名から自動入力もされる）」が対象の国のときだけ出す。値が入っているときは、国を変えても隠さない。
//   出力：御見積書（PDF）の条件欄・画面プレビュー（getConditions().icd）。航路ごとに ICD を持つ（route.icd）。
//   対象の国を増やすときは ICD_COUNTRIES に国コードを足す。
(function () {
  'use strict';
  const ICD_COUNTRIES = ['IN'];
  const $ = id => document.getElementById(id);

  // いまの POD の国（認識できたときだけ）。alias-rules.js の登録確認からも使う
  function icdCountry() {
    const ci = $('z2PodCountry');
    const c = ci && typeof window.findCountry === 'function' ? window.findCountry(ci.value) : null;
    return c && ICD_COUNTRIES.includes(c.code) ? c : null;
  }
  window.icdCountry = icdCountry;

  // その国の ICD のマスター（詳細の country が一致、または国が未設定のもの）。別名も候補に出す
  function icdCandidates(code) {
    const masters = typeof window.statsGetMasters === 'function' ? window.statsGetMasters().filter(m => m.field === 'icd').map(m => m.value) : [];
    const groups = typeof window.synGetGroups === 'function' ? window.synGetGroups('icd') : [];
    const names = new Set(masters);
    groups.forEach(g => names.add(g.canonical));
    const out = [];
    names.forEach(v => {
      const d = (typeof window.mdGet === 'function' && window.mdGet('icd', v) || {}).details || {};
      const cc = String(d.country || '').toUpperCase();
      if (!code || !cc || cc === code) out.push({ value: v, d });
    });
    out.sort((a, b) => String(a.value).localeCompare(String(b.value), 'ja'));
    groups.forEach(g => (g.aliases || []).forEach(a => {
      if (out.some(o => o.value === g.canonical)) out.push({ value: a, d: {}, alias: g.canonical });
    }));
    return out;
  }

  function sync() {
    const row = $('z2IcdRow'), inp = $('z2Icd');
    if (!row || !inp) return;
    const c = icdCountry();
    const has = !!inp.value.trim();
    row.hidden = !(c || has);
    if (row.hidden) return;
    const code = c ? c.code : null;
    let dl = $('z2IcdList');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'z2IcdList'; document.body.appendChild(dl); }
    const list = icdCandidates(code);
    dl.innerHTML = '';
    list.forEach(o => {
      const op = document.createElement('option');
      op.value = o.value;
      const lab = o.alias ? '別名 → ' + o.alias : [o.d.furigana, o.d.enName].filter(Boolean).join(' / ');
      if (lab) op.label = lab;
      if (o.d.furigana) op.dataset.furi = o.d.furigana;
      if (o.d.enName) op.dataset.en = o.d.enName;
      op.dataset.master = '1';
      dl.appendChild(op);
    });
    const note = $('z2IcdNote');
    if (note) {
      const n = list.filter(o => !o.alias).length;
      note.textContent = c
        ? (n ? '🚉 ' + c.ja + 'の登録済みICD ' + n + ' 件から選べます（ない名称は入力すると、ICDとして登録できます）'
          : '🚉 ' + c.ja + 'のICDはまだ登録がありません。名称を入力すると、ICDとして登録できます')
        : '🚉 POD の国が対象外ですが、ICD が入力されています';
    }
  }
  window.icdRefresh = sync;

  function init() {
    const pod = $('z2Pod'), pc = $('z2PodCountry'), ic = $('z2Icd');
    if (!ic) return;
    if (pc) { pc.addEventListener('input', sync); pc.addEventListener('change', sync); }
    if (pod) { pod.addEventListener('change', () => setTimeout(sync, 0)); pod.addEventListener('input', () => setTimeout(sync, 0)); }
    ic.addEventListener('input', sync);
    ic.addEventListener('focus', sync);   // 案件の読み込み・新規作成のあと、触る前に候補を合わせる
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
