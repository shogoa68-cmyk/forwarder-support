// ================================================================
//  インコタームズの図解（御見積書・画面プレビューの「貿易条件」の下に出す）
//  選んだ貿易条件ごとに、10 の工程を「売主／買主」で塗り分けた 1 本の帯、
//  リスク移転の位置（⚠）、保険の範囲（CIF／CIP）、海上専用の印（FAS／FOB／CFR／CIF）を描く。
//  図は条件表から自前で組み立てる（外部の画像は使わない）。出力はただの HTML なので PDF・印刷にもそのまま乗る。
//
//  window.incoDiagramHTML(値, {en})  … 図の HTML（未知の条件・空は ''）
//  window.incoDiagramBlockHTML(往路, 復路, {en, legNames}) … 往復で条件が違うときは 2 つ並べる
//  window.incoDiagramEnabled() / setIncoDiagramEnabled(on) … 表示の ON/OFF（既定 OFF・端末に保存）
// ================================================================
(function () {
  'use strict';

  const STORE_KEY = 'quoteDocIncoDiagram_v1';
  function enabled() {
    try { return localStorage.getItem(STORE_KEY) === '1'; } catch (e) { return false; }
  }
  function setEnabled(on) {
    try { localStorage.setItem(STORE_KEY, on ? '1' : '0'); } catch (e) {}
  }

  // 10 の工程（左から右へ）
  const STAGES = [
    ['検品・梱包', 'Inspection / Packing'],
    ['荷積',       'Loading'],
    ['輸送',       'Inland Transport'],
    ['輸出通関',   'Export Clearance'],
    ['荷役',       'Port Handling'],
    ['運送',       'Main Carriage'],
    ['荷役',       'Port Handling'],
    ['輸入通関',   'Import Clearance'],
    ['配送',       'Delivery'],
    ['荷卸',       'Unloading'],
  ];

  // 売主の負担を 1／買主を 0 で並べる。risk＝リスクが移る位置（左から数えた工程の数の直後）。
  // ins＝保険の範囲 [開始工程, 終了工程]（1 始まり）。sea＝海上・内陸水路運送の規則（FAS／FOB／CFR／CIF）
  const upTo = n => Array.from({ length: 10 }, (_, i) => (i < n ? 1 : 0));
  const DATA = {
    EXW: { s: upTo(1), risk: 1, ja: '工場渡し', en: 'Ex Works' },
    FCA: { s: upTo(4), risk: 4, ja: '運送人渡し', en: 'Free Carrier' },
    FAS: { s: upTo(4), risk: 4, sea: true, ja: '船側渡し', en: 'Free Alongside Ship' },
    FOB: { s: upTo(5), risk: 5, sea: true, ja: '本船渡し', en: 'Free On Board' },
    CFR: { s: upTo(6), risk: 5, sea: true, ja: '運賃込み', en: 'Cost and Freight' },
    CIF: { s: upTo(6), risk: 5, sea: true, ins: [3, 6], ja: '運賃保険料込み', en: 'Cost, Insurance and Freight' },
    CPT: { s: upTo(7), risk: 4, ja: '輸送費込み', en: 'Carriage Paid To' },
    CIP: { s: upTo(7), risk: 4, ins: [3, 7], ja: '輸送費保険料込み', en: 'Carriage and Insurance Paid To' },
    DAP: { s: [1, 1, 1, 1, 1, 1, 1, 0, 1, 0], risk: 9, ja: '仕向地持込渡し', en: 'Delivered at Place' },
    DPU: { s: [1, 1, 1, 1, 1, 1, 1, 0, 1, 1], risk: 10, ja: '荷卸込持込渡し', en: 'Delivered at Place Unloaded' },
    DDP: { s: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0], risk: 9, ja: '関税込持込渡し', en: 'Delivered Duty Paid' },
  };

  const L = {
    seller: ['売主', 'Seller'], buyer: ['買主', 'Buyer'],
    risk: ['リスクの移転', 'Transfer of risk'], ins: ['保険', 'Insurance'],
    sea: ['海上・内陸水路運送のみ', 'Sea & inland waterway only'],
    note: ['※ Incoterms® 2020 に基づく費用・リスクの分担の目安です（実際の取り決めは契約・指定場所によります）。',
           'Indicative allocation of cost and risk under Incoterms® 2020 (actual terms depend on the contract and named place).'],
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function codeOf(v) {
    const c = String(v || '').split(/[（(]/)[0].trim().toUpperCase();
    return DATA[c] ? c : '';
  }

  const RISK_SVG = '<svg class="incd-risk" viewBox="0 0 16 14" width="15" height="13" aria-hidden="true">'
    + '<path d="M8 1L15 13H1Z" fill="#f5b800" stroke="#7a5a00" stroke-width="1" stroke-linejoin="round"/>'
    + '<rect x="7.2" y="5" width="1.6" height="4" fill="#4a3600"/><rect x="7.2" y="10" width="1.6" height="1.6" fill="#4a3600"/></svg>';

  function diagramHTML(value, opts) {
    const en = !!(opts && opts.en);
    const code = codeOf(value);
    if (!code) return '';
    const d = DATA[code];
    const i = en ? 1 : 0;

    // 同じ側が続く工程を 1 つの帯にまとめる
    let segs = '';
    for (let k = 0; k < 10;) {
      let e = k;
      while (e + 1 < 10 && d.s[e + 1] === d.s[k]) e++;
      const side = d.s[k] ? 'seller' : 'buyer';
      segs += `<span class="incd-seg is-${side}" style="grid-column:${k + 1} / ${e + 2}">${esc(L[side][i])}</span>`;
      k = e + 1;
    }
    const labels = STAGES.map(st => `<span class="incd-st">${esc(st[i])}</span>`).join('');
    const risk = d.risk ? `<span class="incd-riskwrap" style="left:${d.risk * 10}%">${RISK_SVG}</span>` : '';
    const ins = d.ins
      ? `<div class="incd-grid incd-insrow"><span class="incd-ins" style="grid-column:${d.ins[0]} / ${d.ins[1] + 1}" title="${esc(L.ins[i])}"></span></div>`
      : '';
    const sea = d.sea ? `<span class="incd-sea">${esc(L.sea[i])}</span>` : '';

    return `<div class="incd" data-incd="${code}">`
      + `<div class="incd-head"><span class="incd-code">${code}</span><span class="incd-name">${esc(en ? d.en : d.ja + '（' + d.en + '）')}</span>${sea}</div>`
      + `<div class="incd-grid incd-labels">${labels}</div>`
      + `<div class="incd-grid incd-bar">${segs}${risk}</div>`
      + ins
      + `<div class="incd-legend">`
      + `<span class="incd-lg"><i class="incd-sw is-seller"></i>${esc(L.seller[i])}</span>`
      + `<span class="incd-lg"><i class="incd-sw is-buyer"></i>${esc(L.buyer[i])}</span>`
      + `<span class="incd-lg">${RISK_SVG}${esc(L.risk[i])}</span>`
      + (d.ins ? `<span class="incd-lg"><i class="incd-sw is-ins"></i>${esc(L.ins[i])}</span>` : '')
      + `</div>`
      + `</div>`;
  }

  // 往路と復路で貿易条件が違うとき（往復案件）は 2 つ並べる。同じ・復路なしなら 1 つ
  function blockHTML(out, ret, opts) {
    const en = !!(opts && opts.en);
    const names = (opts && opts.legNames) || {};
    const a = diagramHTML(out, opts);
    const same = !ret || codeOf(ret) === codeOf(out);
    if (same) return a;
    const b = diagramHTML(ret, opts);
    const cap = (txt) => `<div class="incd-leg">${esc(txt)}</div>`;
    const lo = names.out || (en ? 'Outbound' : '往路');
    const lr = names.ret || (en ? 'Return' : '復路');
    return (a ? cap(lo) + a : '') + (b ? cap(lr) + b : '');
  }

  function footnote(en) { return `<div class="incd-note">${esc(L.note[en ? 1 : 0])}</div>`; }

  window.incoDiagramHTML = diagramHTML;
  window.incoDiagramBlockHTML = function (out, ret, opts) {
    const h = blockHTML(out, ret, opts);
    return h ? h + footnote(opts && opts.en) : '';
  };
  window.incoDiagramEnabled = enabled;
  window.setIncoDiagramEnabled = setEnabled;
})();
