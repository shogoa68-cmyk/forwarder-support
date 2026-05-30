// ================================================================
//  fx.spec.js — SharedFX.toJPY（純粋換算）の仕様テスト
//
//  【台帳 A】未取得レートの暗黙 rate=1 換算を廃止し、NaN（換算不可）を
//  返す方針に変更したことを固定する。
// ================================================================
(function () {
  const FX = (typeof window !== 'undefined' ? window : globalThis).SharedFX;
  const RATES = { USD: 150, EUR: 165, KRW: 0.11 };

  describe('SharedFX.toJPY — JPY換算（純粋関数）', () => {
    it('JPY はそのまま返す', () => expect(FX.toJPY(1000, 'JPY', RATES)).toBe(1000));
    it('cur が falsy（空/未指定）はそのまま返す', () => {
      expect(FX.toJPY(1000, '', RATES)).toBe(1000);
      expect(FX.toJPY(1000, undefined, RATES)).toBe(1000);
    });
    it('USD 100 → 15,000 JPY', () => expect(FX.toJPY(100, 'USD', RATES)).toBe(15000));
    it('EUR 10 → 1,650 JPY', () => expect(FX.toJPY(10, 'EUR', RATES)).toBe(1650));
    it('KRW 1,000,000 → 110,000 JPY（小数レートでも正しく）', () =>
      expect(FX.toJPY(1000000, 'KRW', RATES)).toBeCloseTo(110000, 4));

    // ここがバグ A の核心 ----------------------------------------
    it('レート未取得の通貨は NaN（暗黙 rate=1 で等倍換算しない）', () => {
      // 旧実装ならここで 1,000,000（¥等倍）が返り、合計が桁ずれしていた。
      expect(Number.isNaN(FX.toJPY(1000000, 'CHF', RATES))).toBe(true);
    });
    it('rates テーブル自体が無い場合も NaN（JPY/falsy を除く）', () => {
      expect(Number.isNaN(FX.toJPY(100, 'USD', undefined))).toBe(true);
      expect(FX.toJPY(100, 'JPY', undefined)).toBe(100); // JPY は table 不要
    });
    it('rate が 0 や負値なら NaN（壊れたレートを採用しない）', () => {
      expect(Number.isNaN(FX.toJPY(100, 'USD', { USD: 0 }))).toBe(true);
      expect(Number.isNaN(FX.toJPY(100, 'USD', { USD: -5 }))).toBe(true);
    });
    it('NaN は合計加算に伝播し「合計も NaN（=換算不可）」になる（loud failure）', () => {
      // 呼び出し側の totBillJPY += toJPY(...) 相当。1件でも未取得があれば総額が信用できない
      let tot = 0;
      tot += FX.toJPY(100, 'USD', RATES);   // 15000
      tot += FX.toJPY(50, 'CHF', RATES);    // NaN
      expect(Number.isNaN(tot)).toBe(true);
    });
  });
})();
