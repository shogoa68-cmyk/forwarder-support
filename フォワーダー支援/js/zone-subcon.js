// 出発地側・到着地側の「デフォルトサブコン」欄：その側の国を得意エリアに持つサブコン（マスター）だけが入力候補に出る。
//   出発地側（zone1）＝POL 側／到着地側（zone3）＝POD 側。国は、次の順で決める（分かったものを使う）：
//     ① 出発地側・到着地側の「国」欄（#z1Country／#z3Country）
//     ② 幹線輸送の POL・POD の「🌐 国」（#z2PolCountry／#z2PodCountry）
//     ③ POL・POD の港名からの推測（マスターの港の国 → data/countries.js guessPortCountry。YOKOHAMA → 日本）
//   候補の条件：マスター詳細「得意エリア」（details.areas）がその国をカバーするもの（areaCovers：「東南アジア」を得意とする会社は
//   ベトナムでもヒット／日本は「日本全国」「関東」などの国内エリアを持つ会社）。得意エリアが未設定のサブコンは出さない。
//   国が分からないときは、従来どおり全サブコンが候補（#svSuggestions）。国の欄は見積の項目として一緒に保存・復元される。
(function () {
  'use strict';

  const ALL_LIST = 'svSuggestions';
  const ZONES = [
    { n: 1, area: 'z1DefaultScArea', zoneCountry: 'z1Country', polpod: 'z2PolCountry', port: 'z2Pol', list: 'z1ScList', note: 'z1ScNote', side: '出発地側' },
    { n: 3, area: 'z3DefaultScArea', zoneCountry: 'z3Country', polpod: 'z2PodCountry', port: 'z2Pod', list: 'z3ScList', note: 'z3ScNote', side: '到着地側' },
  ];
  const $ = id => document.getElementById(id);
  const findCountry = t => (typeof window.findCountry === 'function' ? window.findCountry(t) : null);

  // 港名から国を逆引き（マスターの港の国 → 主要港の名前の対応表）
  function _countryForPort(name) {
    const v = String(name || '').trim();
    if (!v) return null;
    const all = typeof window.mdGetAll === 'function' ? window.mdGetAll('port') : [];
    const same = typeof window.nameSame === 'function' ? window.nameSame : (a, b) => a === b;
    const m = all.find(x => x.value === v) || all.find(x => { try { return same('port', x.value, v); } catch (e) { return false; } });
    const code = m && (m.details || {}).country;
    const c = code ? findCountry(String(code)) : null;
    if (c) return c;
    const g = typeof window.guessPortCountry === 'function' ? window.guessPortCountry(v) : null;
    return g ? findCountry(g) : null;
  }

  // その側の国（認識できたときだけ）。{ c, src } ／ null
  function countryOfZone(z) {
    const a = $(z.zoneCountry), b = $(z.polpod), p = $(z.port);
    const t1 = a && a.value.trim() ? findCountry(a.value) : null;
    if (t1) return { c: t1, src: z.side + 'の国' };
    const t2 = b && b.value.trim() ? findCountry(b.value) : null;
    if (t2) return { c: t2, src: z.n === 1 ? 'POL の国' : 'POD の国' };
    const t3 = p ? _countryForPort(p.value) : null;
    if (t3) return { c: t3, src: (z.n === 1 ? 'POL' : 'POD') + ' の港' };
    return null;
  }
  window.zscCountryOf = n => { const z = ZONES.find(x => x.n === n); return z ? countryOfZone(z) : null; };

  // 得意エリア（details.areas）がその国をカバーするか。日本は「日本全国」「関東」など国内のどのエリアでも該当
  function _covers(areas, code) {
    const keys = Array.isArray(areas) ? areas : [];
    if (!keys.length) return false;                                // 未設定は出さない
    if (code === 'JP') return keys.some(k => k === 'JP' || String(k).indexOf('JP-') === 0) ||
      (typeof window.areaCovers === 'function' && window.areaCovers(keys, 'JP'));
    return typeof window.areaCovers === 'function' ? window.areaCovers(keys, code) : false;
  }

  function _vendorsOf(code) {
    const all = typeof window.mdGetAll === 'function' ? window.mdGetAll('sv') : [];
    return all.filter(m => _covers((m.details || {}).areas, code))
      .sort((a, b) => String(a.value).localeCompare(String(b.value), 'ja'));
  }

  function _inputs(z) { return Array.from(document.querySelectorAll('#' + z.area + ' .sc-input')); }

  function _apply(z) {
    const found = countryOfZone(z);
    const ins = _inputs(z);
    const noteEl = $(z.note);
    if (!found) {
      ins.forEach(i => { if (i.getAttribute('list') !== ALL_LIST) i.setAttribute('list', ALL_LIST); });
      if (noteEl) { noteEl.hidden = true; noteEl.textContent = ''; }
      return;
    }
    let dl = $(z.list);
    if (!dl) { dl = document.createElement('datalist'); dl.id = z.list; document.body.appendChild(dl); }
    const vendors = _vendorsOf(found.c.code);
    dl.innerHTML = '';
    vendors.forEach(m => {
      const d = m.details || {};
      const o = document.createElement('option');
      o.value = m.value;
      const lab = [d.furigana, d.enName].filter(Boolean).join(' / ');
      if (lab) o.label = lab;
      if (d.furigana) o.dataset.furi = d.furigana;
      if (d.enName) o.dataset.en = d.enName;
      o.dataset.master = '1';
      dl.appendChild(o);
    });
    ins.forEach(i => { if (i.getAttribute('list') !== z.list) i.setAttribute('list', z.list); });
    if (noteEl) {
      noteEl.hidden = false;
      noteEl.textContent = '🌐 ' + found.c.ja + '（' + found.src + '）を得意エリアとする登録済みサブコン ' +
        (vendors.length ? vendors.length + ' 件から選べます' : 'はまだありません（マスター管理で、サブコンの「得意エリア」を設定してください）');
    }
  }

  function refresh() { ZONES.forEach(_apply); }
  // マスターの読込・変更のあと（alias-rules.js arRefreshDatalist から）や、保存した案件を開いたあとに、候補を作り直す
  window.zscRefreshLists = refresh;

  function init() {
    const watch = ['z1Country', 'z3Country', 'z2PolCountry', 'z2PodCountry'];
    watch.forEach(id => { const el = $(id); if (el) { el.addEventListener('input', refresh); el.addEventListener('change', refresh); } });
    ['z2Pol', 'z2Pod'].forEach(id => { const el = $(id); if (el) { el.addEventListener('change', () => setTimeout(refresh, 0)); el.addEventListener('input', () => setTimeout(refresh, 0)); } });
    // 「＋」で足したサブコン欄にも同じ候補を付ける。欄を触る前に、案件の読み込み・新規作成で変わった国にも合わせる
    document.addEventListener('focusin', e => {
      const t = e.target;
      if (t && t.classList && t.classList.contains('sc-input') && t.closest && t.closest('#z1DefaultScArea, #z3DefaultScArea')) refresh();
    });
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
