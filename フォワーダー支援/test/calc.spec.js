// ================================================================
//  calc.spec.js — shared/calc.js (SharedCalc) の仕様テスト
//
//  位置づけ:
//    shared/calc.js は DOM 非依存の純粋関数群で、実装は業界定義に
//    ほぼ忠実（÷6000・RT=max(CBM,W/1000) 等）。これを「正解の基準」とし、
//    Step1 で各タブ（cargo/conditions/calculator）の散在計算をここへ
//    一本化する際の、移行先の正しさを保証する土台とする。
//
//  注意: いくつかの値には【台帳】タグで docs/バグ台帳.md の該当項目を記す。
//    「現状の挙動を固定する」ためのテストには [現状] と明記する。
// ================================================================
(function () {
  const C = (typeof window !== 'undefined' ? window : globalThis).SharedCalc;

  describe('SharedCalc.nonNeg — 入力健全化（負値/NaN→0）【台帳 I】', () => {
    it('正の数はそのまま', () => expect(C.nonNeg(60)).toBe(60));
    it('小数もそのまま', () => expect(C.nonNeg(0.5)).toBe(0.5));
    it('負値は 0', () => expect(C.nonNeg(-60)).toBe(0));
    it('0 は 0', () => expect(C.nonNeg(0)).toBe(0));
    it('NaN は 0', () => expect(C.nonNeg(NaN)).toBe(0));
    it('null/undefined は 0', () => { expect(C.nonNeg(null)).toBe(0); expect(C.nonNeg(undefined)).toBe(0); });
    it('数値文字列をパース', () => expect(C.nonNeg('45')).toBe(45));
    it('負の文字列は 0', () => expect(C.nonNeg('-5')).toBe(0));
    it('非数文字列は 0', () => expect(C.nonNeg('abc')).toBe(0));
    it('Infinity は 0（暴走値を採用しない）', () => expect(C.nonNeg(Infinity)).toBe(0));
  });

  describe('SharedCalc.containersNeeded — 必要本数（0除算/Infinity防止）【台帳 H】', () => {
    it('30個 / 10個積 = 3本', () => expect(C.containersNeeded(30, 10)).toBe(3));
    it('割り切れなければ切り上げ（31/10=4）', () => expect(C.containersNeeded(31, 10)).toBe(4));
    it('1本あたり0（積載不可）は null（Infinityにしない）', () => expect(C.containersNeeded(30, 0)).toBe(null));
    it('数量0は null', () => expect(C.containersNeeded(0, 10)).toBe(null));
    it('負の数量は null', () => expect(C.containersNeeded(-5, 10)).toBe(null));
    it('負の積載数は null', () => expect(C.containersNeeded(30, -2)).toBe(null));
  });

  describe('SharedCalc.cbmFactor — 単位→m換算係数', () => {
    it('cm = 0.01', () => expect(C.cbmFactor('cm')).toBe(0.01));
    it('mm = 0.001', () => expect(C.cbmFactor('mm')).toBe(0.001));
    it('in = 0.0254', () => expect(C.cbmFactor('in')).toBe(0.0254));
    it('m = 1', () => expect(C.cbmFactor('m')).toBe(1));
    it('未知の単位は cm にフォールバック', () => expect(C.cbmFactor('尺')).toBe(0.01));
  });

  describe('SharedCalc.cbmFromCm — cm寸法→CBM合計', () => {
    it('100×100×100cm = 1 CBM', () => expect(C.cbmFromCm(100, 100, 100)).toBeCloseTo(1, 6));
    it('数量を掛ける (×3)', () => expect(C.cbmFromCm(100, 100, 100, 3)).toBeCloseTo(3, 6));
    it('qty 省略時は ×1', () => expect(C.cbmFromCm(50, 40, 30)).toBeCloseTo(0.06, 6));
    it('60×40×30cm ×1 = 0.072 CBM', () => expect(C.cbmFromCm(60, 40, 30, 1)).toBeCloseTo(0.072, 6));
    it('qty=0 なら 0', () => expect(C.cbmFromCm(100, 100, 100, 0)).toBe(0));
  });

  describe('SharedCalc.cbmFromAny — 任意単位→CBM', () => {
    it('cm: 100×100×100 = 1 CBM', () => expect(C.cbmFromAny(100, 100, 100, 'cm')).toBeCloseTo(1, 6));
    it('mm: 1000×1000×1000 = 1 CBM', () => expect(C.cbmFromAny(1000, 1000, 1000, 'mm')).toBeCloseTo(1, 6));
    it('m: 1×1×1 = 1 CBM', () => expect(C.cbmFromAny(1, 1, 1, 'm')).toBeCloseTo(1, 6));
    it('in: 10×10×10 inch ≈ 0.016387 CBM', () => expect(C.cbmFromAny(10, 10, 10, 'in')).toBeCloseTo(0.016387064, 6));
    it('数量を掛ける', () => expect(C.cbmFromAny(100, 100, 100, 'cm', 5)).toBeCloseTo(5, 6));
  });

  describe('SharedCalc.airVolWeight — 航空容積重量 (÷6000)', () => {
    // 【台帳 F】IATA 標準 ÷6000。cargo.js の CBM×166.67 ではなくこちらが基準。
    it('100×100×100cm = 1,000,000/6000 ≈ 166.667 kg', () =>
      expect(C.airVolWeight(100, 100, 100)).toBeCloseTo(166.6666667, 4));
    it('60×40×30cm = 72000/6000 = 12 kg', () =>
      expect(C.airVolWeight(60, 40, 30)).toBeCloseTo(12, 6));
    it('1 CBM 相当の容積重量は 166.667 kg（166.67 リテラルとは別）', () => {
      // 166.67×1 = 166.67 だが正は 1e6/6000 = 166.6667。差が出ることを記録。
      expect(C.airVolWeight(100, 100, 100)).toBeCloseTo(1000000 / 6000, 6);
    });
  });

  describe('SharedCalc.airVolWeightFromCbm — CBM→容積重量', () => {
    it('1 CBM = 166.667 kg（÷6000 と等価・166.67リテラルではない）', () =>
      expect(C.airVolWeightFromCbm(1)).toBeCloseTo(1000000 / 6000, 6));
    it('cm³÷6000 と一致: 60×40×30cm=0.072CBM → 12kg', () =>
      expect(C.airVolWeightFromCbm(0.072)).toBeCloseTo(12, 6));
    it('null は 0', () => expect(C.airVolWeightFromCbm(null)).toBe(0));
  });

  describe('SharedCalc.airCw — CW = max(実重量, 容積重量)（丸めなし素材）', () => {
    it('実重量勝ち', () => expect(C.airCw(200, 166.67)).toBe(200));
    it('容積重量勝ち', () => expect(C.airCw(100, 166.67)).toBe(166.67));
    it('同値', () => expect(C.airCw(150, 150)).toBe(150));
    it('null/undefined は 0 扱い', () => {
      expect(C.airCw(undefined, 120)).toBe(120);
      expect(C.airCw(80, null)).toBe(80);
      expect(C.airCw(null, null)).toBe(0);
    });
  });

  describe('SharedCalc.fmtCw — CW表示（0.5kg精度を保つ）', () => {
    it('12.5 は 12.5 のまま（Math.round で 13 にしない）', () => expect(C.fmtCw(12.5)).toBe('12.5'));
    it('12 は 12（整数は小数点なし）', () => expect(C.fmtCw(12)).toBe('12'));
    it('1234.5 は 1,234.5（整数部カンマ区切り）', () => expect(C.fmtCw(1234.5)).toBe('1,234.5'));
    it('0 は 0', () => expect(C.fmtCw(0)).toBe('0'));
    it('null は 0', () => expect(C.fmtCw(null)).toBe('0'));
  });

  describe('SharedCalc.airChargeableWeight — 課金CW（0.5kg切上・IATA）', () => {
    it('12.3kg → 12.5kg（0.5kg単位に切上）', () => expect(C.airChargeableWeight(12.3, 0)).toBe(12.5));
    it('12.5kg ちょうどはそのまま', () => expect(C.airChargeableWeight(12.5, 0)).toBe(12.5));
    it('12.6kg → 13.0kg', () => expect(C.airChargeableWeight(12.6, 0)).toBe(13));
    it('容積重量が勝つ場合も切上', () => expect(C.airChargeableWeight(10, 166.67)).toBe(167));
    it('実重量が勝つ場合', () => expect(C.airChargeableWeight(200.1, 166.67)).toBe(200.5));
    it('0 は 0', () => expect(C.airChargeableWeight(0, 0)).toBe(0));
  });

  describe('SharedCalc.lclRt — 海上 RT = max(CBM, 重量t)', () => {
    it('容積勝ち: 5 CBM / 3000kg → 5', () => expect(C.lclRt(5, 3000)).toBe(5));
    it('重量勝ち: 2 CBM / 4000kg → 4', () => expect(C.lclRt(2, 4000)).toBe(4));
    it('1000kg = 1t = 1RT 境界', () => expect(C.lclRt(0.5, 1000)).toBe(1));
    it('null は 0 扱い', () => {
      expect(C.lclRt(3, null)).toBe(3);
      expect(C.lclRt(null, 2000)).toBe(2);
      expect(C.lclRt(null, null)).toBe(0);
    });
  });

  describe('SharedCalc.containerSpecs — 標準コンテナ定義', () => {
    it('20/40/40HC/45HC の4種', () => expect(C.containerSpecs.length).toBe(4));
    it('20GP: 25CBM / 21,500kg', () => {
      const s = C.containerSpecs[0];
      expect(s.cbm).toBe(25);
      expect(s.maxKg).toBe(21500);
    });
    it('40HQ: 67CBM', () => expect(C.containerSpecs[2].cbm).toBe(67));
    it('Object.freeze されている（不変）', () => {
      expect(Object.isFrozen(C.containerSpecs)).toBe(true);
    });
  });

  describe('SharedCalc.suggestContainers — コンテナ本数目安', () => {
    it('CBM=0 & kg=0 は全て count:0', () => {
      const r = C.suggestContainers(0, 0);
      expect(r.every(x => x.count === 0)).toBe(true);
    });
    it('30CBM → 20GP(25)は2本', () => {
      const r = C.suggestContainers(30, 0);
      expect(r[0].count).toBe(2); // ceil(30/25)
    });
    it('重量勝ち: 50,000kg → 20GP(21500)は3本', () => {
      const r = C.suggestContainers(0, 50000);
      expect(r[0].count).toBe(3); // ceil(50000/21500)
    });
    it('CBMと重量の大きい方を採用', () => {
      // 30CBM(→2本) と 50,000kg(→3本) なら 3本
      const r = C.suggestContainers(30, 50000);
      expect(r[0].count).toBe(3);
    });
  });

  describe('SharedCalc.saiFromCm / saiFromAny — 才数', () => {
    // 【台帳 Q】定数 27826.5 は 30.3³(=27818.13) とも 1立方フィート(28316.85) とも一致しない。
    // ここでは「現状の実装挙動」を固定する（将来 Q を直すときにこのテストを更新する）。
    it('[現状] 100×100×100cm = 1e6/27826.5 ≈ 35.937 才', () =>
      expect(C.saiFromCm(100, 100, 100)).toBeCloseTo(1000000 / 27826.5, 4));
    it('[現状] saiFromAny(mm) は cm 換算して算出', () =>
      expect(C.saiFromAny(1000, 1000, 1000, 'mm')).toBeCloseTo(1000000 / 27826.5, 4));
    it('数量を掛ける', () =>
      expect(C.saiFromCm(100, 100, 100, 2)).toBeCloseTo(2000000 / 27826.5, 4));
  });
})();
