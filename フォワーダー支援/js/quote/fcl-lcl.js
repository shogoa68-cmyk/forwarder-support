// ========== 🆚 FCL/LCL 損益分岐（右カラム「FCL/LCL」パネル） ==========
// 仕入ベースで、同じ貨物を FCL（コンテナ貸切）と LCL（混載）で運んだときの費用を比べ、
//   ・現在の物量でどちらが有利か
//   ・何 CBM から FCL（20'GP/40'GP/40'HQ 各1本）が LCL より安くなるか（損益分岐 CBM）
// を出す。単価は #flPanel の入力欄（案件に自動保存される）から読む。
//
// 前提と割り切り：
//  ・LCL＝ 固定費/BL ＋ max(R/T, 最低R/T) × (運賃/RT ＋ 諸チャージ/RT)
//  ・FCL＝ 固定費/BL ＋ 本数 × 1本あたり費用（運賃＋THC等を含めて入力）
//  ・本数は容積・重量の大きい方で ceil（SharedCalc.containerSpecs。種別ごとに単独で手配する前提で、
//    20'＋40' の混載組み合わせは考慮しない）
//  ・R/T は max(CBM, 重量t)。物量を CBM 単位で動かすときは、案件（または手入力）の
//    比重（kg/CBM）を保ったまま増減させる
(function () {
  const FMT = n => '¥' + Math.round(n).toLocaleString('ja-JP');
  const $ = id => document.getElementById(id);
  const num = id => { const v = parseFloat($(id)?.value); return isFinite(v) && v >= 0 ? v : 0; };
  const cur = id => $(id)?.value || 'USD';

  // 入力欄の通貨で与えられた金額を JPY へ。換算不可（為替未取得）なら NaN
  function _jpy(amount, c) {
    if (!amount) return 0;
    return (typeof toJPY === 'function') ? toJPY(amount, c) : (c === 'JPY' ? amount : NaN);
  }

  // 現在の入力（単価・通貨）をまとめる。JPY 換算済み。
  function readRates() {
    const lc = cur('fl-lcl-cur'), fc = cur('fl-fcl-cur');
    const lcl = {
      ratePerRT: _jpy(num('fl-lcl-rate'), lc) + _jpy(num('fl-lcl-perrt'), lc),
      hasRate:   num('fl-lcl-rate') > 0 || num('fl-lcl-perrt') > 0,
      fix:       _jpy(num('fl-lcl-fix'), lc),
      minRT:     num('fl-lcl-min') || 1,
    };
    const specs = (window.SharedCalc && SharedCalc.containerSpecs) || [];
    const byKey = {};
    specs.forEach(s => { byKey[s.key] = s; });
    const fcl = {
      fix: _jpy(num('fl-fcl-fix'), fc),
      types: [
        { id: 'fl-f20',   spec: byKey['20gp'], perBox: _jpy(num('fl-f20'),   fc), has: num('fl-f20')   > 0 },
        { id: 'fl-f40',   spec: byKey['40gp'], perBox: _jpy(num('fl-f40'),   fc), has: num('fl-f40')   > 0 },
        { id: 'fl-f40hq', spec: byKey['40hc'], perBox: _jpy(num('fl-f40hq'), fc), has: num('fl-f40hq') > 0 },
      ].filter(t => t.spec && t.has),
    };
    return { lcl, fcl };
  }

  // 貨物（CBM・kg）。手入力があればそれ、無ければ案件の貨物情報
  function readCargo() {
    const m = (typeof window.getCargoMetrics === 'function') ? window.getCargoMetrics() : { cbm: 0, kg: 0 };
    const manualCbm = num('fl-cbm'), manualKg = num('fl-kg');
    const cbm = manualCbm || m.cbm || 0;
    const kg  = manualKg  || m.kg  || 0;
    return { cbm, kg, fromCase: !(manualCbm || manualKg) };
  }

  // 比重（t/CBM）。CBM・重量の両方があるときのみ。無ければ 0（＝CBMだけで R/T を決める）
  function density(c) { return (c.cbm > 0 && c.kg > 0) ? (c.kg / 1000) / c.cbm : 0; }
  const rtOf = (cbm, d) => Math.max(cbm, cbm * d);

  function lclCost(rates, cbm, d) {
    if (!rates.lcl.hasRate) return NaN;
    return rates.lcl.fix + Math.max(rtOf(cbm, d), rates.lcl.minRT) * rates.lcl.ratePerRT;
  }
  function boxesFor(spec, cbm, d) {
    const byCbm = Math.ceil(cbm / spec.cbm);
    const byKg  = Math.ceil((cbm * d * 1000) / spec.maxKg);
    return Math.max(1, byCbm, byKg);
  }
  // FCL で最安の種別（本数込み）。入力のある種別だけが対象。無ければ null
  function fclBest(rates, cbm, d) {
    let best = null;
    rates.fcl.types.forEach(t => {
      const n = boxesFor(t.spec, cbm, d);
      const cost = rates.fcl.fix + n * t.perBox;
      if (!isFinite(cost)) return;
      if (!best || cost < best.cost) best = { name: t.spec.name, n, cost };
    });
    return best;
  }

  // 種別ごとの損益分岐。「この CBM 以上なら 1 本貸切の FCL のほうが LCL より安い」
  // 戻り値 { name, cbm|null, kind } kind: 'at'（cbmから）/'always'（常にFCL）/'never'（1本満載でもLCL）/'noweight'
  function breakEven(rates, t, d) {
    if (!rates.lcl.hasRate) return null;
    const F = rates.fcl.fix + t.perBox;                 // 1本の FCL 総額
    const r = rates.lcl.ratePerRT;
    if (!(r > 0) || !isFinite(F)) return null;
    // 比重が高く、1本に積める CBM が重量制限で小さくなる場合は、積める上限を使う
    const capCbm = d > 0 ? Math.min(t.spec.cbm, t.spec.maxKg / (d * 1000)) : t.spec.cbm;
    const rtAtMin = rates.lcl.minRT;
    const lclAtMin = rates.lcl.fix + rtAtMin * r;
    if (lclAtMin >= F) return { name: t.spec.name, kind: 'always', cbm: 0, cap: capCbm };
    const rtStar = (F - rates.lcl.fix) / r;            // LCL 総額 = F となる R/T
    const cbmStar = rtStar / Math.max(1, d);           // R/T = cbm × max(1, d)
    if (cbmStar > capCbm) return { name: t.spec.name, kind: 'never', cbm: cbmStar, cap: capCbm };
    return { name: t.spec.name, kind: 'at', cbm: cbmStar, cap: capCbm };
  }

  const STEPS = [1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 40, 50, 60, 70];

  // 外部（FCL/LCL 併記出力など）からも使えるよう、計算結果をまとめて返す
  function calc() {
    const rates = readRates();
    const cargo = readCargo();
    const d = density(cargo);
    const out = { rates, cargo, d, now: null, breakEvens: [], table: [] };
    if (cargo.cbm > 0) {
      const l = lclCost(rates, cargo.cbm, d), f = fclBest(rates, cargo.cbm, d);
      out.now = { lcl: l, fcl: f };
    }
    rates.fcl.types.forEach(t => { const b = breakEven(rates, t, d); if (b) out.breakEvens.push(b); });
    const pts = STEPS.slice();
    if (cargo.cbm > 0 && !pts.includes(Math.round(cargo.cbm * 10) / 10)) pts.push(Math.round(cargo.cbm * 10) / 10);
    pts.sort((a, b) => a - b).forEach(c => {
      out.table.push({ cbm: c, lcl: lclCost(rates, c, d), fcl: fclBest(rates, c, d), isNow: cargo.cbm > 0 && Math.abs(c - cargo.cbm) < 0.05 });
    });
    return out;
  }

  function _esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  window.flCalc = calc;

  window.renderFclLcl = function () {
    const box = $('flResult');
    if (!box) return;
    const r = calc();
    const { cargo, d } = r;

    const now = $('flCargoNow');
    if (now) {
      now.textContent = cargo.cbm > 0
        ? `使用する物量：${cargo.cbm.toFixed(3)} CBM${cargo.kg > 0 ? ' / ' + Math.round(cargo.kg).toLocaleString() + ' kg（比重 ' + (d).toFixed(2) + ' t/CBM）' : ''}${cargo.fromCase ? '（案件の貨物情報）' : '（手入力）'}`
        : '物量が未入力です（案件の貨物情報、または上の CBM を入れてください）。損益分岐CBMは物量なしでも出ます。';
    }

    if (!r.rates.lcl.hasRate || !r.rates.fcl.types.length) {
      box.innerHTML = '<div class="fl-verdict is-warn">LCL の運賃/諸チャージと、FCL の1本あたり費用（20\'/40\'/40\'HQ のいずれか）を入れると比較結果が出ます。</div>';
      return;
    }
    // 為替が未取得の通貨があると NaN になる
    if (!isFinite(r.rates.lcl.ratePerRT) || r.rates.fcl.types.some(t => !isFinite(t.perBox))) {
      box.innerHTML = '<div class="fl-verdict is-warn">選んだ通貨の為替レートが未取得です。通貨を JPY にするか、為替が取得できてから再度お試しください。</div>';
      return;
    }

    let html = '';
    if (r.now && isFinite(r.now.lcl) && r.now.fcl) {
      const l = r.now.lcl, f = r.now.fcl.cost;
      const fclWin = f < l;
      const diff = Math.abs(l - f);
      html += `<div class="fl-verdict ${fclWin ? '' : 'is-lcl'}">
        現在の物量（${cargo.cbm.toFixed(2)} CBM）では
        <b>${fclWin ? 'FCL（' + _esc(r.now.fcl.name) + ' × ' + r.now.fcl.n + '）' : 'LCL'}</b> が
        <b>${FMT(diff)}</b> 有利<br>
        <span style="font-size:11px;color:#6a5a40">LCL ${FMT(l)} ／ FCL ${FMT(f)}（${_esc(r.now.fcl.name)} × ${r.now.fcl.n}）</span>
      </div>`;
    }
    if (r.breakEvens.length) {
      html += '<ul class="fl-be">' + r.breakEvens.map(b => {
        if (b.kind === 'always') return `<li>${_esc(b.name)}：最低R/T でもすでに <b>FCL が安い</b></li>`;
        if (b.kind === 'never')  return `<li>${_esc(b.name)}：1本に積める ${b.cap.toFixed(0)} CBM までは <b>LCL が安い</b>（逆転は約 ${b.cbm.toFixed(0)} CBM）</li>`;
        return `<li>${_esc(b.name)}：約 <b>${b.cbm.toFixed(1)} CBM</b> 以上なら FCL（1本）が安い</li>`;
      }).join('') + '</ul>';
    }
    html += '<table class="fl-tbl"><thead><tr><th>CBM</th><th>LCL</th><th>FCL(最安)</th><th>有利</th></tr></thead><tbody>' +
      r.table.map(row => {
        const lOk = isFinite(row.lcl), fOk = !!row.fcl;
        const win = (lOk && fOk) ? (row.fcl.cost < row.lcl ? 'F' : 'L') : '';
        return `<tr class="${row.isNow ? 'is-now' : ''}"><td>${row.cbm}</td>
          <td class="${win === 'L' ? 'is-win' : ''}">${lOk ? FMT(row.lcl) : '—'}</td>
          <td class="${win === 'F' ? 'is-win' : ''}">${fOk ? FMT(row.fcl.cost) + '<br><small>' + _esc(row.fcl.name) + '×' + row.fcl.n + '</small>' : '—'}</td>
          <td>${win === 'F' ? 'FCL' : (win === 'L' ? 'LCL' : '—')}</td></tr>`;
      }).join('') + '</tbody></table>';
    html += '<div class="fl-note">※ 仕入ベースの目安です。FCL は種別ごとに単独手配（20\'と40\'の組み合わせは考慮しません）。R/T は容積と重量の大きい方で、物量を変えるときは現在の比重を保ちます。為替は画面の換算レートを使用しています。</div>';
    box.innerHTML = html;
  };

  document.addEventListener('DOMContentLoaded', () => { try { window.renderFclLcl(); } catch (e) {} });
})();
