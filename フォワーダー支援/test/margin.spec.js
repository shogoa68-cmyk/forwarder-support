// ================================================================
//  margin.spec.js — 利益指標（粗利率 / マークアップ率）の仕様テスト
//
//  【台帳 B】「粗利率」が3画面で食い違っていた（原価ベース vs 売上ベース）。
//  売上ベース＝粗利率に統一したことを固定する。
// ================================================================
(function () {
  const C = (typeof window !== 'undefined' ? window : globalThis).SharedCalc;

  describe('SharedCalc.grossMarginPct — 粗利率(売上ベース)', () => {
    it('原価100・売上150 → 33.3%（売上ベース）', () =>
      expect(C.grossMarginPct(150, 100)).toBeCloseTo(33.3333333, 4));
    it('原価0・売上100 → 100%', () => expect(C.grossMarginPct(100, 0)).toBe(100));
    it('原価=売上 → 0%', () => expect(C.grossMarginPct(100, 100)).toBe(0));
    it('赤字（原価>売上）→ 負の率', () =>
      expect(C.grossMarginPct(80, 100)).toBeCloseTo(-25, 6));
    it('売上0以下は 0%（0除算回避）', () => {
      expect(C.grossMarginPct(0, 100)).toBe(0);
      expect(C.grossMarginPct(-10, 50)).toBe(0);
    });
    it('null/undefined を 0 扱い', () => {
      expect(C.grossMarginPct(100, null)).toBe(100);
      expect(C.grossMarginPct(100, undefined)).toBe(100);
    });
  });

  describe('SharedCalc.markupPct — マークアップ率(原価ベース)', () => {
    it('原価100・売上150 → 50%（原価ベース）', () =>
      expect(C.markupPct(150, 100)).toBeCloseTo(50, 6));
    it('粗利率33.3%と同じ案件でもマークアップ率は50%（別指標）', () => {
      expect(C.grossMarginPct(150, 100)).toBeCloseTo(33.3333333, 4);
      expect(C.markupPct(150, 100)).toBeCloseTo(50, 6);
    });
    it('原価0以下は 0%（0除算回避）', () => {
      expect(C.markupPct(150, 0)).toBe(0);
      expect(C.markupPct(150, -10)).toBe(0);
    });
  });
})();
