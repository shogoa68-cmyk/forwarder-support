// ================================================================
//  shared/calc.js — フォワーディング業務の純粋計算関数
//  DOM に触らない。両アプリ（見積・実務）から呼べる。
//
//  API:
//    SharedCalc.cbmFromCm(l, w, h, qty)     : number  // cm 寸法 → CBM 合計
//    SharedCalc.saiFromCm(l, w, h, qty)     : number  // cm 寸法 → 才数 合計
//    SharedCalc.airVolWeight(l, w, h)       : number  // cm → 容積重量 kg (/6000)
//    SharedCalc.airCw(weightKg, volWeight)  : number  // CW = max(W, V)
//    SharedCalc.lclRt(cbm, weightKg)        : number  // RT = max(CBM, W/1000)
//    SharedCalc.cbmFactor(unit)             : number  // 'cm'|'mm'|'in'|'m' → m 換算係数
//    SharedCalc.containerSpecs              : 標準コンテナ定義（20'/40'/40HC）
//    SharedCalc.suggestContainers(cbm, kg)  : Array<{name, count}>
//
//  単位変換:
//    cm → m: ×0.01    mm → m: ×0.001    in → m: ×0.0254    m → m: ×1
//    cm → cm: ×1      mm → cm: ×0.1     in → cm: ×2.54     m → cm: ×100
//
//  定数の典拠:
//    - 容積重量 (Air): IATA 6000 cm³/kg
//    - 才数 1才 ≒ 30.3cm立方 = 27826.5 cm³（日本のトラック慣習）
//    - CW per CBM ≒ 167 kg（=1000000/6000）
// ================================================================

window.SharedCalc = (function () {
  // ---- 単位係数 ----
  const TO_M  = { cm: 0.01, mm: 0.001, in: 0.0254, m: 1 };
  const TO_CM = { cm: 1,    mm: 0.1,   in: 2.54,   m: 100 };

  function cbmFactor(unit) {
    return TO_M[unit] || TO_M.cm;
  }

  function cbmFromCm(l, w, h, qty) {
    const q = qty == null ? 1 : qty;
    return (l * w * h * q) / 1e6;
  }

  function saiFromCm(l, w, h, qty) {
    const q = qty == null ? 1 : qty;
    return (l * w * h * q) / 27826.5;
  }

  /** 任意単位の寸法から CBM を返す */
  function cbmFromAny(l, w, h, unit, qty) {
    const F = cbmFactor(unit);
    const q = qty == null ? 1 : qty;
    return l * F * w * F * h * F * q;
  }

  /** 任意単位の寸法から才数を返す（cm 換算 → /27826.5） */
  function saiFromAny(l, w, h, unit, qty) {
    const Fcm = TO_CM[unit] || 1;
    const q = qty == null ? 1 : qty;
    return (l * Fcm * w * Fcm * h * Fcm * q) / 27826.5;
  }

  /** 航空 容積重量 (kg) = (cm³) / 6000 */
  function airVolWeight(l, w, h) {
    return (l * w * h) / 6000;
  }

  /** 航空 CW = max(実重量, 容積重量) */
  function airCw(weightKg, volWeightKg) {
    return Math.max(weightKg || 0, volWeightKg || 0);
  }

  /** 海上 RT = max(CBM, W/1000) */
  function lclRt(cbm, weightKg) {
    return Math.max(cbm || 0, (weightKg || 0) / 1000);
  }

  // ---- 標準コンテナ仕様（CBM 容積／最大ペイロード） ----
  // maxKg: 日本国内陸送を含む場合の実務的推奨上限（道路法・軸重制限考慮）。
  // 海上輸送のみ（ISO上限）は 20'GP ≒ 28,230 kg だが国内トラック輸送時は 21,500 kg が安全圏。
  // バンニング計算（calculator.js）は海上 ISO ベース maxPay:28,000 kg を使用しているため
  // ドアtoドア案件では本定義値（21,500 kg）を参照して重量チェックすること。
  const containerSpecs = Object.freeze([
    { key: '20gp', name: "20'GP", cbm: 25, maxKg: 21500, dims: { l: 589,  w: 235, h: 239 } },
    { key: '40gp', name: "40'GP", cbm: 57, maxKg: 26500, dims: { l: 1203, w: 235, h: 239 } },
    { key: '40hc', name: "40'HQ", cbm: 67, maxKg: 26500, dims: { l: 1203, w: 235, h: 269 } },
    { key: '45hc', name: "45'HC", cbm: 86, maxKg: 26500, dims: { l: 1354, w: 235, h: 269 } },
  ]);

  /** CBM/重量からコンテナ本数の目安を返す */
  function suggestContainers(cbm, kg) {
    return containerSpecs.map(s => {
      const byCbm = cbm > 0 ? Math.ceil(cbm / s.cbm) : 0;
      const byKg  = kg  > 0 ? Math.ceil(kg  / s.maxKg) : 0;
      return { name: s.name, count: Math.max(byCbm, byKg) };
    });
  }

  return {
    cbmFactor,
    cbmFromCm, saiFromCm,
    cbmFromAny, saiFromAny,
    airVolWeight, airCw,
    lclRt,
    containerSpecs,
    suggestContainers,
  };
})();
