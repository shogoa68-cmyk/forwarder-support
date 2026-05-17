// ================================================================
//  shared/fx.js — 為替レート共通モジュール
//  両アプリ（見積支援・実務支援）から参照される。
//
//  API:
//    SharedFX.fetchRates(base)           : Promise<{ [cur]: rate }>  // 1 base = rate cur
//    SharedFX.getCachedRates(base)       : { rates, ts } | null      // メモリキャッシュ取得
//    SharedFX.getRate(from, to)          : Promise<number>            // 1 from = X to
//    SharedFX.invalidateCache()          : void
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

  return { fetchRates, getCachedRates, getRate, invalidateCache };
})();
