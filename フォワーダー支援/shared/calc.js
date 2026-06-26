// ================================================================
//  shared/calc.js — フォワーディング業務の純粋計算関数
//  DOM に触らない。両アプリ（見積・実務）から呼べる。
//
//  API:
//    SharedCalc.cbmFromCm(l, w, h, qty)     : number  // cm 寸法 → CBM 合計
//    SharedCalc.saiFromCm(l, w, h, qty)     : number  // cm 寸法 → 才数 合計
//    SharedCalc.airVolWeight(l, w, h)       : number  // cm → 容積重量 kg (/6000)
//    SharedCalc.airVolWeightFromCbm(cbm)    : number  // CBM → 容積重量 kg (×1e6/6000)
//    SharedCalc.airCw(weightKg, volWeight)  : number  // CW = max(W, V)（丸めなし・素材）
//    SharedCalc.airChargeableWeight(w, v)   : number  // 課金CW = max(W,V) を 0.5kg 切上（IATA）
//    SharedCalc.fmtCw(kg)                    : string  // CW 表示: 0.5kg 精度を保ち整数部はカンマ区切り
//    SharedCalc.lclRt(cbm, weightKg)        : number  // RT = max(CBM, W/1000)
//    SharedCalc.cbmFactor(unit)             : number  // 'cm'|'mm'|'in'|'m' → m 換算係数
//    SharedCalc.containerSpecs              : 標準コンテナ定義（20'/40'/40HC）
//    SharedCalc.suggestContainers(cbm, kg)  : Array<{name, count}>
//    SharedCalc.grossMarginPct(bill, cost)  : number  // 粗利率(%) = (売上-原価)/売上×100
//    SharedCalc.markupPct(bill, cost)       : number  // マークアップ率(%) = (売上-原価)/原価×100
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

  /** CBM から航空容積重量 (kg)。cm³÷6000 と等価（1 CBM = 1e6/6000 ≒ 166.667 kg）。
   *  従来コードの「CBM × 166.67」リテラルは丸め誤差。こちらを正とする。 */
  function airVolWeightFromCbm(cbm) {
    return (cbm || 0) * (1000000 / 6000);
  }

  /** 航空 CW = max(実重量, 容積重量)（丸めなしの素材値） */
  function airCw(weightKg, volWeightKg) {
    return Math.max(weightKg || 0, volWeightKg || 0);
  }

  /** 航空 課金重量 = max(実重量, 容積重量) を 0.5kg 単位で切り上げ（IATA 準拠）。
   *  画面・出力に出す CW はこれに統一する（docs/バグ台帳.md の F）。 */
  function airChargeableWeight(weightKg, volWeightKg) {
    const cw = Math.max(weightKg || 0, volWeightKg || 0);
    return Math.ceil(cw * 2) / 2;
  }

  /** CW 表示用フォーマット。0.5kg 精度を保ったまま整数部を 3 桁カンマ区切りで返す。
   *  Math.round してしまうと 12.5→13 と 0.5kg 精度が潰れるため専用化（docs/バグ台帳.md F 表示）。 */
  function fmtCw(kg) {
    const v = kg || 0;
    return v.toLocaleString('ja-JP', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
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
  // dims = 内寸（cm）／ext = 外寸（cm・ISO 標準値）。表示は m 換算（÷100）。
  const containerSpecs = Object.freeze([
    { key: '20gp', name: "20'GP", cbm: 25, maxKg: 21500, dims: { l: 589,  w: 235, h: 239 }, ext: { l: 606,  w: 244, h: 259 } },
    { key: '40gp', name: "40'GP", cbm: 57, maxKg: 26500, dims: { l: 1203, w: 235, h: 239 }, ext: { l: 1219, w: 244, h: 259 } },
    { key: '40hc', name: "40'HQ", cbm: 67, maxKg: 26500, dims: { l: 1203, w: 235, h: 269 }, ext: { l: 1219, w: 244, h: 290 } },
    { key: '45hc', name: "45'HC", cbm: 86, maxKg: 26500, dims: { l: 1354, w: 235, h: 269 }, ext: { l: 1372, w: 244, h: 290 } },
  ]);

  /** CBM/重量からコンテナ本数の目安を返す */
  function suggestContainers(cbm, kg) {
    return containerSpecs.map(s => {
      const byCbm = cbm > 0 ? Math.ceil(cbm / s.cbm) : 0;
      const byKg  = kg  > 0 ? Math.ceil(kg  / s.maxKg) : 0;
      return { name: s.name, count: Math.max(byCbm, byKg) };
    });
  }

  // ---- 利益指標 ----
  // 業界標準の「粗利率(Gross Margin)」は売上ベース＝(売上-原価)/売上。
  // 「マークアップ率(値入率)」は原価ベース＝(売上-原価)/原価。両者は別物。
  // 見積の3画面で定義が割れていた（docs/バグ台帳.md の B）ため共通化する。

  /** 粗利率(%) = (売上 - 原価) / 売上 × 100。売上が 0 以下なら 0 */
  function grossMarginPct(billing, cost) {
    const b = billing || 0;
    if (b <= 0) return 0;
    return ((b - (cost || 0)) / b) * 100;
  }

  // ---- JPY 換算の丸め（全経路で統一） ----
  // 外貨建て金額を JPY 換算するとき、各「行」ごとにこの関数で丸めてから合計する。
  // 御見積書・メール・Excel の明細列は行ごとに丸めた JPY を表示し、合計はその積み上げと
  // 一致する必要があるため、丸めは「行ごと」が正準。Math.ceil（切り上げ）で統一。
  // 画面サマリ／プレビュー総額も必ずこの規約で集計し、4 経路の数値を一致させる。
  // （以前は経路ごとに round-of-sum / 行ごと ceil / 生の小数表示が混在し ±数円ズレた）
  function jpyRound(v) { return Math.ceil(v || 0); }

  /** マークアップ率(値入率)(%) = (売上 - 原価) / 原価 × 100。原価が 0 以下なら 0 */
  function markupPct(billing, cost) {
    const c = cost || 0;
    if (c <= 0) return 0;
    return (((billing || 0) - c) / c) * 100;
  }

  return {
    cbmFactor,
    cbmFromCm, saiFromCm,
    cbmFromAny, saiFromAny,
    airVolWeight, airVolWeightFromCbm, airCw, airChargeableWeight, fmtCw,
    lclRt,
    containerSpecs,
    suggestContainers,
    grossMarginPct, markupPct,
    jpyRound,
  };
})();
