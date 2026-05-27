// ================================================================
//  shared/storage.js — localStorage キー一元管理＋安全ラッパ
//
//  目的：localStorage キーを一箇所で定数化し、JSON 例外を握りつぶす
//        ラッパで両アプリの保存ロジックを揃える。
//
//  API:
//    SharedStorage.KEYS                  : 定数列挙
//    SharedStorage.getJSON(key, fallback): JSON.parse 安全版
//    SharedStorage.setJSON(key, value)   : JSON.stringify して保存
//    SharedStorage.get(key, fallback)    : 生文字列
//    SharedStorage.set(key, value)       : 生文字列
//    SharedStorage.remove(key)
// ================================================================

window.SharedStorage = (function () {
  const KEYS = Object.freeze({
    // 見積支援
    QUOTE_DATA:        'quoteData',           // 見積の自動保存
    USER_CATEGORIES:   'userCategories_v1',   // 自作カテゴリ
    FX_RATES:          'fxRates_v1',          // 為替レート（ユーザ上書き含む）
    FX_AUTO_MODE:      'fxAutoMode_v1',       // 為替自動取得モード
    FX_LAST_FETCHED:   'fxLastFetched_v1',    // 為替最終取得時刻
    QUOTE_PRESETS:     'quotePresets_v1',     // 見積プリセット
    // 実務支援
    TRACKING_HISTORY:  'trackingHistory_v1',  // コンテナ追跡履歴
  });

  function getJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function setJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function get(key, fallback) {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  }

  function set(key, value) {
    localStorage.setItem(key, value);
  }

  function remove(key) {
    localStorage.removeItem(key);
  }

  return { KEYS, getJSON, setJSON, get, set, remove };
})();
