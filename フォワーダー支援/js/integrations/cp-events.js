/* cp-events.js — サイバーポート Webhook で受け取った通知（Supabase の表 cp_events）を読む窓口。
 * 書き込みは Edge Function「cp-webhook」だけ。ここは読み取りと、新着のリアルタイム購読だけ（権限は RLS でチームメンバーのみ）。
 * 表の作成は docs/sql/cp-events.sql、手順は docs/サイバーポート連携-Webhook.md。
 *
 *   CpEvents.fetchRecent({limit, kind})   → 新しい順の配列（本文 payload は含まない＝軽くする）
 *   CpEvents.fetchPayload(id)             → その 1 件の本文（サイバーポートが送ってきた JSON）
 *   CpEvents.subscribe(onInsert, onStatus) → 新着（本文つき）を受け取る。戻り値の関数で購読をやめる
 * 失敗は Error（code：login／notready（表が未作成）／error）。 */
(function () {
  'use strict';

  var LIST_COLS = 'id,received_at,kind,history_id,operation_code,operation_name,trade_no,trade_type,bl_no,report_code,report_name,report_id,container_no,to_org_id,operated_at';

  function client() { return typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null; }
  function mkErr(code, msg) { var e = new Error(msg); e.code = code; return e; }
  // 表が無いときのエラー（PostgREST は PGRST205 / 42P01）。SQL を流す前でも、画面は案内を出すだけにする
  function isMissingTable(e) {
    var m = String((e && e.message) || '') + ' ' + String((e && e.code) || '');
    return /42P01|PGRST205|does not exist|schema cache/i.test(m);
  }
  async function ready() {
    var c = client();
    var s = c && c.auth ? (await c.auth.getSession()).data.session : null;
    if (!c || !s) throw mkErr('login', 'ログインが必要です（右上の「Google でログイン」）');
    return c;
  }
  function fail(error) {
    if (isMissingTable(error)) throw mkErr('notready', '通知の保存先（表 cp_events）が未作成です。docs/sql/cp-events.sql を Supabase で実行してください');
    throw mkErr('error', (error && error.message) || '読み込みに失敗しました');
  }

  async function fetchRecent(opts) {
    opts = opts || {};
    var c = await ready();
    var q = c.from('cp_events').select(LIST_COLS).order('received_at', { ascending: false }).limit(opts.limit || 50);
    if (opts.kind) q = q.eq('kind', opts.kind);
    var r = await q;
    if (r.error) fail(r.error);
    return r.data || [];
  }

  async function fetchPayload(id) {
    var c = await ready();
    var r = await c.from('cp_events').select('payload').eq('id', id).limit(1);
    if (r.error) fail(r.error);
    return (r.data && r.data[0] && r.data[0].payload) || null;
  }

  function subscribe(onInsert, onStatus) {
    var c = client();
    if (!c || typeof c.channel !== 'function') return function () {};
    var ch;
    try {
      ch = c.channel('cp-events-live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cp_events' }, function (p) { if (p && p.new) onInsert(p.new); })
        .subscribe(function (status) { if (onStatus) onStatus(status); });
    } catch (e) { if (onStatus) onStatus('ERROR'); return function () {}; }
    return function () { try { c.removeChannel(ch); } catch (e) { /* 何もしない */ } };
  }

  window.CpEvents = { fetchRecent: fetchRecent, fetchPayload: fetchPayload, subscribe: subscribe, isMissingTable: isMissingTable };
})();
