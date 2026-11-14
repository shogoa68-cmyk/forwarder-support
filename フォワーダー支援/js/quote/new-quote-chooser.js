// 🆕 新規見積の入口（2026-11）：「新規見積を作成」を押すとモーダルを出し、
//   ①一から作成   ②似ている案件を参考に作成（お客様・積み港・揚げ港・モードで絞り込み → 選んだ案件をコピーして新規案件に）
//   のどちらかを選ばせる。
//
// ・「一から作成」は従来の qpNewQuote() そのまま。
// ・「似ている案件を参考に作成」は、チーム共有の案件一覧（cloudGetAllRows＝ダッシュボードで読み込み済みの全件）から探し、
//   選んだ案件の内容を **編集画面に未保存の新規案件として展開**する（メール取込の「新規案件として展開」と同じ作法）。
//   保存するまでクラウドには何も作らない（途中でやめても案件が増えない）。保存は通常どおり Ctrl+S／「保存」。
// ・コピーしないもの（案件に固有の記録）：見積もり番号（新しく自動採番）・ステータス（下書き中に戻す）・
//   依頼受信日／発行日／有効期限／提出期限（新規案件の初期値＝今日／月末）・基幹 REF#・失注理由・引き合いの経路・提示履歴・
//   関連番号・保管した自由入力・入力完了の記録・「代替わり」の印（コピー元との差分表示も付けない）。
// ・既存の「📋 コピー」（案件を保存済みのまま複製）・「サブ案件を作成」とは別の入口。関連付け（メイン／サブ）は作らない。
//
// 依存（window 経由）：cloudGetAllRows, qpNewQuote, _applyQuoteData, ciApplyNewCaseDefaults, maybeAutoFillRef, quoteShowToast, nameCanon
(function () {
  'use strict';

  const MAX_SHOWN = 50;   // 一覧に出す上限（多いときは条件を足して絞ってもらう）
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t, ms) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, t || 'info', ms); };

  // 表記の違い（全角半角・大文字小文字・空白）を無視して比べるための正規化
  const norm = s => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '');
  // お客様名は、マスターの別名・表記ゆれを代表名にそろえて比べる（取れなければそのまま）
  const custKey = s => {
    let v = String(s == null ? '' : s).trim();
    try { if (v && typeof window.nameCanon === 'function') v = window.nameCanon('customer', v) || v; } catch (e) {}
    return norm(v);
  };

  let st = null;   // { step:'choose'|'similar', f:{cust,pol,pod,mode}, sort:'new'|'cust' }
  let lastFocus = null;

  function allRows() { try { return typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []; } catch (e) { return []; } }
  function portsOf(v) { return String(v || '').split(/[,、／/]/).map(x => x.trim()).filter(Boolean); }
  const distinct = arr => Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja'));

  // ---------- 絞り込みと並び順 ----------
  // 入力のある条件だけを効かせる（AND）。お客様・港は部分一致、モードは完全一致。
  function matchInfo(r, f) {
    const hit = { cust: false, pol: false, pod: false, mode: false };
    const used = { cust: !!f.cust.trim(), pol: !!f.pol.trim(), pod: !!f.pod.trim(), mode: !!f.mode };
    let ok = true;
    if (used.cust) { hit.cust = custKey(r.customer).includes(custKey(f.cust)); ok = ok && hit.cust; }
    if (used.pol) { hit.pol = norm(r.pol).includes(norm(f.pol)); ok = ok && hit.pol; }
    if (used.pod) { hit.pod = norm(r.pod).includes(norm(f.pod)); ok = ok && hit.pod; }
    if (used.mode) { hit.mode = (r.transport_mode || '') === f.mode; ok = ok && hit.mode; }
    return { ok, hit, used, score: (hit.cust ? 1 : 0) + (hit.pol ? 1 : 0) + (hit.pod ? 1 : 0) + (hit.mode ? 1 : 0) };
  }
  function results() {
    const f = st.f;
    const list = allRows().map(r => ({ r, m: matchInfo(r, f) })).filter(x => x.m.ok);
    const upd = x => String(x.r.updated_at || '');
    if (st.sort === 'cust') list.sort((a, b) => String(a.r.customer || '￿').localeCompare(String(b.r.customer || '￿'), 'ja') || upd(b).localeCompare(upd(a)));
    else list.sort((a, b) => upd(b).localeCompare(upd(a)));   // 更新が新しい順
    return list;
  }

  // ---------- 描画 ----------
  function fmtDate(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    return (d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '/' : '') + (d.getMonth() + 1) + '/' + d.getDate();
  }
  function statusBadge(s) {
    const t = String(s || '下書き中');
    const cls = /受注/.test(t) ? 'won' : /失注/.test(t) ? 'lost' : /提示|提出/.test(t) ? 'sent' : 'draft';
    return '<span class="nq-st nq-st--' + cls + '">' + esc(t) + '</span>';
  }
  // 明細に出てくるサブコン（案件カードと同じ抽出＝quoteExtractSubcons）。多いときは先頭 6 社＋「他 N 社」
  const SUB_SHOWN = 6;
  function subconsHtml(r) {
    let list = [];
    try { list = (typeof window.quoteExtractSubcons === 'function' ? window.quoteExtractSubcons(r.data) : []) || []; } catch (e) {}
    if (!list.length) return '';
    const chips = list.slice(0, SUB_SHOWN).map(s => '<span class="nq-sub" title="' + esc(s.role ? s.name + '（' + s.role + '）' : s.name) + '">'
      + (s.role ? '<i>' + esc(s.role) + '</i>' : '') + esc(s.name) + '</span>').join('');
    const more = list.length > SUB_SHOWN ? '<span class="nq-sub nq-sub-more">他 ' + (list.length - SUB_SHOWN) + ' 社</span>' : '';
    return '<div class="nq-item-subs"><span class="nq-subs-lbl">サブコン</span>' + chips + more + '</div>';
  }
  function rowCount(r) { const rows = r && r.data && r.data.rows; return Array.isArray(rows) ? rows.filter(x => x && !x.virtual).length : 0; }

  function chooseHtml(n) {
    return '<div class="nq-cards">'
      + '<button type="button" class="nq-card" data-nq="blank"><span class="nq-ico" aria-hidden="true">✨</span>'
      + '<b>一から作成</b><small>空の見積から始めます</small></button>'
      + '<button type="button" class="nq-card" data-nq="similar"' + (n ? '' : ' disabled') + '><span class="nq-ico" aria-hidden="true">🔍</span>'
      + '<b>似ている案件を参考に作成</b>'
      + '<small>' + (n ? '過去の案件（' + n + ' 件）から、お客様・積み港・揚げ港・モードで探して、コピーして始めます' : '参考にできる案件がまだありません（チーム共有にログインすると使えます）') + '</small></button>'
      + '</div>';
  }

  function similarHtml() {
    const rows = allRows();
    const custs = distinct(rows.map(r => r.customer));
    const ports = distinct([].concat.apply([], rows.map(r => portsOf(r.pol).concat(portsOf(r.pod)))));
    const modes = distinct(rows.map(r => r.transport_mode));
    const f = st.f;
    return '<button type="button" class="nq-back" data-nq="back">‹ 戻る</button>'
      + '<div class="nq-filters">'
      + '<label class="nq-f"><span>お客様</span><input type="search" id="nqCust" list="nqCustList" value="' + esc(f.cust) + '" placeholder="例：サンプル商事" autocomplete="off"></label>'
      + '<label class="nq-f"><span>積み港（POL）</span><input type="search" id="nqPol" list="nqPortList" value="' + esc(f.pol) + '" placeholder="例：TOKYO" autocomplete="off"></label>'
      + '<label class="nq-f"><span>揚げ港（POD）</span><input type="search" id="nqPod" list="nqPortList" value="' + esc(f.pod) + '" placeholder="例：SHANGHAI" autocomplete="off"></label>'
      + '<label class="nq-f"><span>モード</span><select id="nqMode"><option value="">すべて</option>'
      + modes.map(m => '<option value="' + esc(m) + '"' + (f.mode === m ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select></label>'
      + '</div>'
      + '<datalist id="nqCustList">' + custs.map(v => '<option value="' + esc(v) + '"></option>').join('') + '</datalist>'
      + '<datalist id="nqPortList">' + ports.map(v => '<option value="' + esc(v) + '"></option>').join('') + '</datalist>'
      + '<div class="nq-bar"><span id="nqCount" class="nq-count" aria-live="polite"></span>'
      + '<span class="nq-bar-r"><button type="button" class="nq-clear" data-nq="clear">条件をクリア</button>'
      + '<label class="nq-sort">並び順 <select id="nqSort"><option value="new"' + (st.sort === 'new' ? ' selected' : '') + '>更新が新しい順</option>'
      + '<option value="cust"' + (st.sort === 'cust' ? ' selected' : '') + '>お客様名順</option></select></label></span></div>'
      + '<ul class="nq-list" id="nqList" aria-label="参考にできる案件"></ul>';
  }

  function renderList() {
    const ul = $('nqList'), cnt = $('nqCount'); if (!ul) return;
    const list = results();
    const used = Object.values(st.f).some(v => String(v || '').trim());
    const shown = list.slice(0, MAX_SHOWN);
    if (cnt) cnt.textContent = list.length + ' 件' + (used ? 'が一致' : '') + (list.length > MAX_SHOWN ? '（新しい順に ' + MAX_SHOWN + ' 件まで表示。条件を足すと絞れます）' : '');
    if (!list.length) {
      ul.innerHTML = '<li class="nq-empty">' + (used ? '条件に合う案件がありません。条件をゆるめるか「条件をクリア」を押してください。' : '案件がありません。') + '</li>';
      return;
    }
    ul.innerHTML = shown.map(({ r, m }) => {
      const route = (r.pol || r.pod) ? esc(r.pol || '—') + ' → ' + esc(r.pod || '—') : '';
      const chip = (k, label) => m.used[k] ? '<span class="nq-hit' + (m.hit[k] ? ' is-on' : '') + '">' + label + '</span>' : '';
      const meta = [r.customer ? '<span class="nq-cust">' + esc(r.customer) + '</span>' : '', route ? '<span>' + route + '</span>' : '',
        r.transport_mode ? '<span>' + esc(r.transport_mode) + '</span>' : '', r.incoterms ? '<span>' + esc(r.incoterms) + '</span>' : ''].filter(Boolean).join('<i aria-hidden="true">・</i>');
      const n = rowCount(r);
      return '<li class="nq-item"><div class="nq-item-main">'
        + '<div class="nq-item-top">' + (r.ref ? '<code class="nq-ref">' + esc(r.ref) + '</code>' : '') + '<span class="nq-name">' + esc(r.name || '（無題）') + '</span>' + statusBadge(r.status) + '</div>'
        + '<div class="nq-item-meta">' + (meta || '<span class="nq-dim">条件の入力なし</span>') + '</div>'
        + subconsHtml(r)
        + '<div class="nq-item-sub">' + (n ? '明細 ' + n + ' 行' : '明細なし') + '・更新 ' + esc(fmtDate(r.updated_at)) + '</div>'
        + '</div>'
        + '<button type="button" class="nq-copy" data-nq="copy" data-id="' + esc(r.id) + '">この案件をコピーして作成</button></li>';
    }).join('');
  }

  function render() {
    const body = $('nqBody'); if (!body) return;
    const ov = $('nqOverlay');
    if (ov) ov.classList.toggle('is-similar', st.step === 'similar');
    if (st.step === 'similar') { body.innerHTML = similarHtml(); renderList(); }
    else body.innerHTML = chooseHtml(allRows().length);
    const t = $('nqTitle'); if (t) t.textContent = st.step === 'similar' ? '🔍 似ている案件を参考に作成' : '🆕 新規見積を作成';
  }

  // ---------- 開閉 ----------
  function close() {
    const ov = $('nqOverlay'); if (ov) ov.remove();
    document.removeEventListener('keydown', onKey, true);
    st = null;
    try { if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus(); } catch (e) {}
    lastFocus = null;
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }
  function open() {
    if ($('nqOverlay')) return;
    lastFocus = document.activeElement;
    st = { step: 'choose', f: { cust: '', pol: '', pod: '', mode: '' }, sort: 'new' };
    const ov = document.createElement('div');
    ov.id = 'nqOverlay'; ov.className = 'nq-overlay';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'nqTitle');
    ov.innerHTML = '<div class="nq-dialog"><div class="nq-head"><h3 id="nqTitle"></h3>'
      + '<button type="button" class="nq-x" data-nq="close" aria-label="閉じる">✕</button></div><div class="nq-body" id="nqBody"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', onClick);
    ov.addEventListener('input', onInput);
    ov.addEventListener('change', onInput);
    document.addEventListener('keydown', onKey, true);
    render();
    const first = ov.querySelector('.nq-card'); if (first) first.focus();
  }

  // ---------- 操作 ----------
  function onInput(e) {
    if (!st || st.step !== 'similar') return;
    const id = e.target && e.target.id;
    if (id === 'nqCust') st.f.cust = e.target.value;
    else if (id === 'nqPol') st.f.pol = e.target.value;
    else if (id === 'nqPod') st.f.pod = e.target.value;
    else if (id === 'nqMode') st.f.mode = e.target.value;
    else if (id === 'nqSort') st.sort = e.target.value;
    else return;
    // 日本語入力の変換中は描き直さない（入力欄そのものは再描画しない＝一覧だけ更新するので焦点は保たれる）
    if (e.isComposing) return;
    renderList();
  }
  function onClick(e) {
    if (e.target === $('nqOverlay')) { close(); return; }   // 背景を押すと閉じる
    const b = e.target.closest && e.target.closest('[data-nq]'); if (!b || b.disabled) return;
    const act = b.getAttribute('data-nq');
    if (act === 'close') close();
    else if (act === 'blank') { close(); if (typeof window.qpNewQuote === 'function') window.qpNewQuote(); }
    else if (act === 'similar') { st.step = 'similar'; render(); const c = $('nqCust'); if (c && !window.matchMedia('(pointer: coarse)').matches) c.focus(); }
    else if (act === 'back') { st.step = 'choose'; render(); const f = document.querySelector('#nqBody .nq-card'); if (f) f.focus(); }
    else if (act === 'clear') { st.f = { cust: '', pol: '', pod: '', mode: '' }; render(); }
    else if (act === 'copy') copyAsNew(b.getAttribute('data-id'));
  }

  // 案件に固有の記録を除いた、新規案件用の内容
  const DROP_FIELDS = ['qf-ref', 'qf-core-ref', 'qf-lost-reason', 'qf-lost-note', 'qf-inq-kind', 'qf-inq-channel', 'qf-inq-spec',
    'qf-first-presented', 'qf-recv-time', 'qf-versions', 'qf-related-data', 'qf-free-entries', 'qf-import-src', 'qf-revision-baseline',
    'qf-received', 'qf-date', 'qf-valid-until', 'qf-due'];
  function freshData(src) {
    const data = JSON.parse(JSON.stringify(src));
    if (!data.fields) data.fields = {};
    DROP_FIELDS.forEach(k => { delete data.fields[k]; });
    data.fields['qf-status'] = '下書き中';
    delete data.copiedFrom;   // 「代替わり」の印・コピー元との差分表示は付けない（別の見積の下敷きであって、次の版ではない）
    if (Array.isArray(data.rows)) data.rows.forEach(r => { if (r) { delete r.done; delete r.doneAt; delete r.doneBy; delete r.srcDoneAt; delete r.srcDoneBy; delete r.srcFrom; } });
    return data;
  }
  function copyAsNew(id) {
    const src = allRows().find(r => r.id === id);
    if (!src || !src.data) { toast('⚠️ コピー元が見つかりません', 'warn'); return; }
    if (typeof window.qpNewQuote !== 'function' || typeof window._applyQuoteData !== 'function') { toast('⚠️ 新規作成の準備ができていません', 'warn'); return; }
    const data = freshData(src.data), name = src.name || '（無題）';
    close();
    window.qpNewQuote();                 // 入力中の内容は従来の「新規作成」と同じく空にして、編集画面を開く
    window._applyQuoteData(data);        // 選んだ案件の内容を展開
    if (typeof window.ciApplyNewCaseDefaults === 'function') window.ciApplyNewCaseDefaults();   // 依頼受信日・発行日＝今日／有効期限＝月末
    if (typeof window.maybeAutoFillRef === 'function') window.maybeAutoFillRef();               // 見積もり番号は新しく自動採番
    // 「保存していない新規案件」であることを、保存前の確認（未保存の警告）に伝える（qpNewQuote 内の未保存フラグの解除より後に）
    setTimeout(() => { const el = $('qf-customer') || $('qf-ref'); if (el) el.dispatchEvent(new Event('input', { bubbles: true })); }, 60);
    toast('📋 「' + name + '」をコピーして新規案件を作成しました（まだ保存していません）', 'success', 5000);
  }

  window.qpNewQuoteChoose = open;
  window.nqOpen = open;
  window.nqClose = close;
})();
