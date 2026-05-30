// ================================================================
//  shared/fx.js — 為替レート共通モジュール
//  両アプリ（見積支援・実務支援）から参照される。
//
//  API:
//    SharedFX.fetchRates(base)           : Promise<{ [cur]: rate }>  // 1 base = rate cur
//    SharedFX.getCachedRates(base)       : { rates, ts } | null      // メモリキャッシュ取得
//    SharedFX.getRate(from, to)          : Promise<number>            // 1 from = X to
//    SharedFX.toJPY(amount, cur, rates)  : number                     // 純粋換算（下記）
//    SharedFX.invalidateCache()          : void
//
//  SharedFX.toJPY(amount, cur, ratesToJpy):
//    rates は「1 cur = X JPY」のテーブル（見積側 _fxRates と同形）。
//    - cur が falsy または 'JPY' なら amount をそのまま返す
//    - rates[cur] が正の数でなければ NaN（＝換算不可）を返す
//      （かつて rate=1 で暗黙換算していたが、未取得通貨が ¥等倍で混入し
//       合計が静かに桁ずれする事故になるため廃止。NaN を返して呼び出し側で
//       「換算不可」を可視化する方針に変更。docs/バグ台帳.md の A 参照）
//
//  キャッシュ仕様：
//    - メモリキャッシュ：base 別、有効期間 1 時間
//    - 永続化：呼び出し側がそれぞれ localStorage に保存（用途が違うため共通化しない）
//
//  外部 API: open.er-api.com（無料）— 認証不要
// ================================================================

window.SharedFX = (function () {
  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 時間
  const _cache = {}; // { [base]: { rates, ts } }

  async function fetchRates(base) {
    const now = Date.now();
    if (_cache[base] && now - _cache[base].ts < CACHE_TTL_MS) {
      return _cache[base].rates;
    }
    const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.result !== 'success') throw new Error('API error');
    _cache[base] = { rates: data.rates, ts: now };
    return data.rates;
  }

  function getCachedRates(base) {
    return _cache[base] || null;
  }

  async function getRate(from, to) {
    if (from === to) return 1;
    const rates = await fetchRates(from);
    const r = rates[to];
    if (!r || r <= 0) throw new Error(`Rate not found: ${from}->${to}`);
    return r;
  }

  function invalidateCache() {
    for (const k of Object.keys(_cache)) delete _cache[k];
  }

  /**
   * 金額を JPY に換算する純粋関数。
   * @param {number} amount         元の金額
   * @param {string} cur            通貨コード（'JPY' / falsy はそのまま返す）
   * @param {Object} ratesToJpy     { [cur]: 1cur=XJPY } 形式のレート表
   * @returns {number}              JPY 額。レート未取得時は NaN（換算不可）
   */
  function toJPY(amount, cur, ratesToJpy) {
    if (!cur || cur === 'JPY') return amount;
    const rate = ratesToJpy && ratesToJpy[cur];
    if (!(typeof rate === 'number' && rate > 0)) {
      // 暗黙の rate=1 はしない。未取得レートでの等倍換算は桁ずれ事故の元。
      if (typeof console !== 'undefined') {
        console.warn(`[FX] レート未取得のため換算不可: ${cur}（amount=${amount}）`);
      }
      return NaN;
    }
    return amount * rate;
  }

  return { fetchRates, getCachedRates, getRate, toJPY, invalidateCache };
})();
