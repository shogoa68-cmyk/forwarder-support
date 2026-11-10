/* cyberport.js — サイバーポート（Cyber Port Ver.2）連携の「ブラウザ側の窓口」。
 * 通信はすべて Supabase の Edge Function「cp-proxy」を通す（接続情報・トークンはブラウザに置かない）。
 * 第1段階は読み取り専用：cp-proxy が通すのは許可された GET だけ（supabase/functions/cp-proxy/logic.ts）。
 * 画面側（サイバーポート画面など）は、このファイルの CyberPort.* だけを呼ぶ＝連携先が変わってもここだけ直せばよい。
 * 設計は docs/サイバーポート連携_設計案.md、手順は docs/サイバーポート連携-セットアップ.md。
 *
 *   CyberPort.ping()                      → {ok, message, tokenHost, apiHost}  接続情報でトークンが取れるかの確認
 *   CyberPort.get(path, query)            → {ok, api, status, data}            許可された読み取り API を 1 回呼ぶ
 *   CyberPort.tradesSearch(query)         取引の検索（keyword に取引番号・B/L・ブッキング・社内管理番号・インボイス）
 *   CyberPort.colinsVessels(dir, 港コード, query) / colinsContainers(dir, 番号, query)   COLINS の本船の動静・コンテナの状況
 *   CyberPort.normalizeNo(s)              番号の整え（空白除去・大文字化）
 * 失敗は Error（code と message が日本語）。code：login／network／nofunction／cp_not_configured／token_failed／
 *   upstream_auth／not_found／upstream_error／upstream_network／rate_limited／path_not_allowed … */
(function () {
  'use strict';

  function cfg() { return window.CLOUD_CONFIG || {}; }
  function fnUrl() { return String(cfg().url || '').replace(/\/$/, '') + '/functions/v1/cp-proxy'; }
  function client() { return typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null; }
  function mkErr(code, msg, extra) { var e = new Error(msg); e.code = code; if (extra) Object.assign(e, extra); return e; }

  function normalizeNo(raw) {
    return String(raw == null ? '' : raw).replace(/[\s　]+/g, '').toUpperCase();
  }

  async function headers() {
    var c = client();
    var s = c ? (await c.auth.getSession()).data.session : null;
    if (!s) throw mkErr('login', 'ログインが必要です（右上の「Google でログイン」）');
    return { Authorization: 'Bearer ' + s.access_token, apikey: cfg().publishableKey, 'Content-Type': 'application/json' };
  }

  async function post(body) {
    if (!cfg().url) throw mkErr('network', 'クラウドの接続設定がありません');
    var res;
    try {
      res = await fetch(fnUrl(), { method: 'POST', headers: await headers(), body: JSON.stringify(body) });
    } catch (e) {
      if (e && e.code) throw e;
      throw mkErr('network', '通信できませんでした。インターネット接続を確認し、Edge Function の CP_ALLOWED_ORIGINS に「' + (window.location && window.location.origin) + '」が入っているかも確認してください');
    }
    var j = await res.json().catch(function () { return {}; });
    // 関数そのものが無いとき（未デプロイ）は 404。サイバーポート側のエラーは cp-proxy が 502 で返す。
    if (res.status === 404 && !j.error) throw mkErr('nofunction', 'サーバー側が未設定です（Edge Function「cp-proxy」を配置してください）');
    if (!res.ok || j.ok === false) {
      throw mkErr(j.error || 'error', j.message || ('エラー（' + res.status + '）'), { status: res.status, upstreamStatus: j.upstreamStatus || null, detail: j.detail || '' });
    }
    return j;
  }

  window.CyberPort = {
    normalizeNo: normalizeNo,
    ping: function () { return post({ action: 'ping' }); },
    get: function (path, query) { return post({ action: 'get', path: path, query: query || {} }); },
    // ---- 画面向けの入口（名前と取り方をここに集める） ----
    tradesSearch: function (query) { return this.get('/API/v2/Trades/Search', query); },
    tradeHistories: function (query) { return this.get('/API/v2/Trades/Histories/GetList', query); },
    messageDetails: function (historyId) { return this.get('/API/v2/Trades/Messages/GetDetails/' + encodeURIComponent(historyId)); },
    // COLINS（コンテナ物流情報）：direction は 'import'（輸入）／'export'（輸出）。
    //   本船の動静：港コード（UN/LOCODE 5桁・例 JPTYO）必須。query に vesselName・voyageNo・scacCode・callsign（任意）
    colinsVessels: function (direction, portCode, query) {
      var port = String(portCode == null ? '' : portCode).replace(/[\s\u3000]+/g, '').toUpperCase();
      return this.get('/API/v2/ColinsViewers/Get' + (direction === 'export' ? 'Export' : 'Import') + 'Vessels/' + encodeURIComponent(port), query);
    },
    //   コンテナの状況：コンテナ番号、または 輸入＝B/L番号／輸出＝ブッキング番号 のどれかで探す（番号は整えてから送る）
    colinsContainers: function (direction, no, query) {
      var n = normalizeNo(no), q = Object.assign({}, query || {});
      if (n) {
        if (/^[A-Z]{4}\d{7}$/.test(n)) q.containerNo = n;
        else if (direction === 'export') q.bookingNoList = [n];
        else q.blNoList = [n];
      }
      return this.get('/API/v2/ColinsViewers/Get' + (direction === 'export' ? 'Export' : 'Import') + 'Containers', q);
    },
    // ターミナルの一覧（コード→名前）。portCode（UN/LOCODE）で絞れる。応答は [{terminalCode, terminalName, terminalNameAb, terminalNameEn, …}]
    terminals: function (portCode) {
      var port = String(portCode == null ? '' : portCode).replace(/[\s\u3000]+/g, '').toUpperCase();
      return this.get('/API/v2/Terminals/GetList', port ? { portCode: port } : {});
    },
    colinsImportContainers: function (query) { return this.get('/API/v2/ColinsViewers/GetImportContainers', query); },
    colinsExportContainers: function (query) { return this.get('/API/v2/ColinsViewers/GetExportContainers', query); }
  };
})();
