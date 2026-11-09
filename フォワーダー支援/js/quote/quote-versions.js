// ========== 📜 提示履歴（版管理） ==========
// 見積は「提示 → 改定 → 提示」を繰り返す。ステータスを「提示済み／ヨコヨコ提示」にした時点の、客先に見える内容
// （品名・数量・単位・通貨・単価・備考＋合計）を版（v1, v2…）として案件データに積んでおく。
//   ・保存先：案件データ fields['qf-versions']（hidden #qf-versions・JSON 配列）＝列追加・SQL 不要。最大 MAX_VERSIONS 版
//   ・記録のきっかけ：編集画面のステータス変更（setQuoteStatus）／ダッシュボードのステータス変更（cloudSetStatus）／手動「＋ 現在の内容を提示版として記録」
//   ・内容が直前の版と同じなら増やさない（ステータスの切り替えだけで版が増えないように）
//   ・表示：編集画面のステータス欄の下「📜 提示履歴」（内容／前の版との差分／現在との差分／この版を比較元にする）、ダッシュボードのカードに版数
//   ・「この版を比較元にする」＝既存の「前回提示分」（qf-revision-baseline）をその版にする → PDF・メールの変更点がその版との差分になる
(function () {
  'use strict';

  const MAX_VERSIONS = 30;
  const MAX_FULL = 5;   // 明細の全項目（full）を持つのは直近この版数まで（案件データの肥大化を防ぐ）
  const PRESENTED = ['提示済み', '提出済み', 'ヨコヨコ提示'];
  const FIELDS = ['nm', 'bq', 'un', 'bc', 'bp', 'nt'];
  const LABELS = { nm: '品名', bq: '数量', un: '単位', bc: '通貨', bp: '単価', nt: '備考' };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (m, k, ms) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, k || 'info', ms || 3500); };
  const nameOf = e => (typeof window.quoteDisplayName === 'function' ? window.quoteDisplayName(e) : e) || e || '';
  const isPresented = st => PRESENTED.indexOf(String(st || '').trim()) >= 0;

  function parseList(json) {
    try { const a = JSON.parse(json || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  const getList = () => parseList($('qf-versions') && $('qf-versions').value);
  function setList(list) {
    const el = $('qf-versions');
    if (!el) return;
    el.value = JSON.stringify(list);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    render();
  }

  // 2 つのスナップショットの内容が同じか（合計は片方が不明（空）なら比べない）
  function sameContent(a, b) {
    if (!a || !b) return false;
    const ra = a.rows || [], rb = b.rows || [];
    if (ra.length !== rb.length) return false;
    for (let i = 0; i < ra.length; i++) {
      if (ra[i].uid !== rb[i].uid) return false;
      for (const f of FIELDS) if (String(ra[i][f] ?? '') !== String(rb[i][f] ?? '')) return false;
    }
    if (a.total && b.total && a.total !== b.total) return false;
    return true;
  }
  // 現在の画面の客先向け内容
  const currentSnap = () => (typeof window.buildRevisionSnapshot === 'function' ? window.buildRevisionSnapshot() : null);
  const currentFull = () => { try { return (typeof gatherAllData === 'function') ? gatherAllData().rows : null; } catch (e) { return null; } };

  // 版を 1 つ積んだ配列を返す（積まない＝内容が前の版と同じ／明細なし のときは null）
  // full：明細の全項目（gatherAllData().rows）。「この版に戻す」に使う。無ければ閲覧・差分のみ
  function appended(list, snap, status, by, full) {
    if (!snap || !Array.isArray(snap.rows) || !snap.rows.length) return null;
    const last = list[list.length - 1];
    if (last && sameContent(last, snap)) return null;
    const v = (last ? last.v : 0) + 1;
    const entry = { v, ts: snap.ts || new Date().toISOString(), by: by || '', status: status || '', total: snap.total || '', rows: snap.rows };
    if (Array.isArray(full) && full.length) entry.full = JSON.parse(JSON.stringify(full));
    let next = list.concat([entry]);
    if (next.length > MAX_VERSIONS) next = next.slice(next.length - MAX_VERSIONS);
    next.forEach((e, i) => { if (e.full && i < next.length - MAX_FULL) delete e.full; });   // 古い版は全項目を手放す
    return next;
  }

  // ---- 編集画面：ステータスが提示済みになった（setQuoteStatus から） ----
  window.qvOnStatus = function (status) {
    if (!isPresented(status)) return;
    const user = (window._cloudUserEmail || (typeof window.quoteCurrentUserEmail === 'function' ? window.quoteCurrentUserEmail() : '')) || '';
    const next = appended(getList(), currentSnap(), status, user, currentFull());
    if (!next) return;
    setList(next);
    toast('📜 提示 v' + next[next.length - 1].v + ' を履歴に記録しました', 'success', 3000);
  };

  // ---- ダッシュボード：ステータスを提示済みにした（cloudSetStatus から。保存済みの案件データが対象） ----
  // newData（更新後の案件データ）の fields['qf-versions'] に積んだ JSON を返す。積まなければ null
  window.qvOnPresentedData = function (newData, status, by) {
    if (!isPresented(status) || !newData || !newData.fields) return null;
    const snap = (typeof window.buildRevisionSnapshotFromRowsData === 'function') ? window.buildRevisionSnapshotFromRowsData(newData.rows) : null;
    const next = appended(parseList(newData.fields['qf-versions']), snap, status, by, newData.rows);
    return next ? JSON.stringify(next) : null;
  };

  // ---- 差分 ----
  function diff(a, b) {   // a → b
    const A = new Map((a.rows || []).map(r => [r.uid, r])), B = new Map((b.rows || []).map(r => [r.uid, r]));
    const added = [], removed = [], changed = [];
    (b.rows || []).forEach(r => { if (!A.has(r.uid)) added.push(r); });
    (a.rows || []).forEach(r => { if (!B.has(r.uid)) removed.push(r); });
    (a.rows || []).forEach(r => {
      const c = B.get(r.uid); if (!c) return;
      const fs = FIELDS.filter(f => String(r[f] ?? '') !== String(c[f] ?? '')).map(f => ({ f, from: r[f], to: c[f] }));
      if (fs.length) changed.push({ name: c.nm || r.nm, fs });
    });
    return { added, removed, changed };
  }
  const rowTxt = r => esc(r.nm || '（品名なし）') + '　' + esc(r.bq) + (r.un ? ' ' + esc(r.un) : '') + ' × ' + esc(r.bp) + ' ' + esc(r.bc);

  // ---- モーダル ----
  function modal(title, bodyHtml) {
    document.getElementById('qvModal')?.remove();
    const w = document.createElement('div');
    w.id = 'qvModal'; w.className = 'qv-overlay';
    w.innerHTML = '<div class="qv-box" role="dialog"><div class="qv-title">' + title + '<button type="button" class="qv-close" title="閉じる">✕</button></div><div class="qv-body">' + bodyHtml + '</div></div>';
    document.body.appendChild(w);
    const close = () => w.remove();
    w.addEventListener('click', e => { if (e.target === w) close(); });
    w.querySelector('.qv-close').onclick = close;
    w.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    w.tabIndex = -1; w.focus();
  }
  const fmtTs = ts => { const d = new Date(ts); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  function diffHtml(d, labelFrom, labelTo) {
    if (!d.added.length && !d.removed.length && !d.changed.length) return '<p class="qv-none">差分はありません（内容は同じです）</p>';
    let h = '<p class="qv-hint">' + esc(labelFrom) + ' → ' + esc(labelTo) + '</p>';
    if (d.added.length)   h += '<div class="qv-sec qv-add"><b>＋ 追加</b>' + d.added.map(r => '<div>' + rowTxt(r) + '</div>').join('') + '</div>';
    if (d.removed.length) h += '<div class="qv-sec qv-del"><b>− 削除</b>' + d.removed.map(r => '<div>' + rowTxt(r) + '</div>').join('') + '</div>';
    if (d.changed.length) h += '<div class="qv-sec qv-chg"><b>✎ 変更</b>' + d.changed.map(c =>
      '<div>' + esc(c.name) + '：' + c.fs.map(x => esc(LABELS[x.f]) + ' <s>' + esc(x.from) + '</s> → <b>' + esc(x.to) + '</b>').join(' ／ ') + '</div>').join('') + '</div>';
    return h;
  }

  window.qvShow = function (v) {
    const e = getList().find(x => x.v === v); if (!e) return;
    modal('📜 提示 v' + e.v + ' の内容 <small>' + esc(fmtTs(e.ts)) + ' ' + esc(nameOf(e.by)) + (e.total ? ' ／ 合計 ' + esc(e.total) : '') + '</small>',
      '<div class="qv-rows">' + (e.rows || []).map(r => '<div>' + rowTxt(r) + (r.nt ? ' <small>※' + esc(r.nt) + '</small>' : '') + '</div>').join('') + '</div>');
  };
  window.qvDiffPrev = function (v) {
    const list = getList(), i = list.findIndex(x => x.v === v); if (i < 0) return;
    if (i === 0) { modal('📜 v' + v + ' の差分', '<p class="qv-none">最初の版です（前の版がありません）</p>'); return; }
    modal('📜 v' + list[i - 1].v + ' → v' + v + ' の差分', diffHtml(diff(list[i - 1], list[i]), 'v' + list[i - 1].v, 'v' + v));
  };
  window.qvDiffNow = function (v) {
    const e = getList().find(x => x.v === v), cur = currentSnap(); if (!e || !cur) return;
    modal('📜 v' + v + ' → 現在の編集内容 の差分', diffHtml(diff(e, cur), 'v' + v, '現在'));
  };
  window.qvUseAsBase = function (v) {
    const e = getList().find(x => x.v === v); if (!e) return;
    if (!confirm('v' + v + ' を「前回提示分」（御見積書PDF・メール本文の「変更点」の比較元）にします。よろしいですか？')) return;
    const hid = $('qf-revision-baseline');
    if (!hid) return;
    hid.value = JSON.stringify({ ts: e.ts, total: e.total || '', rows: e.rows || [] });
    hid.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof window.updateQuoteStatusUI === 'function') window.updateQuoteStatusUI();
    toast('📜 v' + v + ' を比較元にしました。PDF・メールには v' + v + ' からの変更点が出ます', 'success', 4500);
  };
  // この版の明細に戻す（明細を丸ごと置き換え。条件・貨物情報は現在のまま。Ctrl+Z で取り消せる）
  window.qvRestore = function (v) {
    const e = getList().find(x => x.v === v); if (!e) return;
    if (!e.full) { toast('ℹ️ v' + v + ' は古いため明細の詳細（仕入・乗せ幅など）を保持しておらず、戻せません（内容・差分の確認のみ可能）。戻せるのは直近 ' + MAX_FULL + ' 版です', 'info', 6000); return; }
    const cur = currentSnap();
    const last = getList()[getList().length - 1];
    const unrecorded = cur && last && !sameContent(last, cur);
    if (!confirm('v' + v + ' の明細に戻します。現在の明細は置き換わります（Ctrl+Z で元に戻せます）。\n条件・貨物情報などの明細以外は変わりません。' +
        (unrecorded ? '\n\n⚠️ 現在の編集内容は、まだ提示版として記録されていません。' : '') + '\nよろしいですか？')) return;
    if (typeof window.quoteReplaceRows !== 'function' || !window.quoteReplaceRows(e.full)) { toast('⚠️ 戻せませんでした', 'warn'); return; }
    toast('📜 v' + v + ' の明細に戻しました（Ctrl+Z で取り消せます）。このまま提示済みにすると、新しい版として記録されます', 'success', 6000);
  };
  window.qvRecordNow = function () {
    const st = ($('qf-status') && $('qf-status').value) || '';
    const user = (window._cloudUserEmail || (typeof window.quoteCurrentUserEmail === 'function' ? window.quoteCurrentUserEmail() : '')) || '';
    const next = appended(getList(), currentSnap(), st, user, currentFull());
    if (!next) { toast('ℹ️ 内容が直前の版と同じ（または明細なし）のため、版は追加しません', 'info', 3500); return; }
    setList(next);
    toast('📜 提示 v' + next[next.length - 1].v + ' を記録しました', 'success', 3000);
  };

  // ---- 編集画面のパネル ----
  function render() {
    const box = $('qvPanel');
    if (!box) return;
    const list = getList();
    const st = ($('qf-status') && $('qf-status').value) || '';
    box.hidden = !(list.length || isPresented(st) || st === '改定中');   // 提示・改定の段階になるまでは出さない
    const rows = list.slice().reverse().map(e =>
      '<div class="qv-item"><b class="qv-v">v' + e.v + '</b><span class="qv-meta">' + esc(fmtTs(e.ts)) + ' ' + esc(nameOf(e.by)) + (e.status ? ' ・' + esc(e.status) : '') + (e.total ? ' ・合計 ' + esc(e.total) : '') + '</span>' +
        '<span class="qv-acts"><button type="button" onclick="qvShow(' + e.v + ')">内容</button>' +
        '<button type="button" onclick="qvDiffPrev(' + e.v + ')">前の版との差</button>' +
        '<button type="button" onclick="qvDiffNow(' + e.v + ')">現在との差</button>' +
        '<button type="button" onclick="qvUseAsBase(' + e.v + ')" title="PDF・メールの「変更点」の比較元をこの版にします">比較元にする</button>' +
        '<button type="button" class="qv-restore' + (e.full ? '' : ' is-off') + '" onclick="qvRestore(' + e.v + ')" title="' + (e.full ? 'この版の明細に戻します（Ctrl+Z で取り消せます）' : '古い版のため明細の詳細を保持しておらず戻せません（直近 ' + MAX_FULL + ' 版のみ）') + '">この版に戻す</button></span></div>').join('');
    box.innerHTML = '<div class="qv-head">📜 提示履歴 <small>' + (list.length ? list.length + '版' : 'まだありません') + '</small>' +
      '<button type="button" class="qv-rec" onclick="qvRecordNow()" title="現在の内容を提示した版として記録します（提示済みにしたときは自動で記録されます）">＋ 現在の内容を提示版として記録</button></div>' + rows;
  }
  window.qvRender = render;

  // ---- ダッシュボードのカード用：版数の表示 ----
  window.qvCardBadge = function (data) {
    const list = parseList(data && data.fields && data.fields['qf-versions']);
    if (!list.length) return '';
    const tip = list.slice().reverse().map(e => 'v' + e.v + '  ' + fmtTs(e.ts) + ' ' + nameOf(e.by)).join('\n');
    const last = list[list.length - 1];
    return '<div class="cloud-card-ver" title="' + esc(tip) + '">📜 提示 v' + last.v + '（' + esc(fmtTs(last.ts)) + '）' + (list.length > 1 ? ' <small>全' + list.length + '版</small>' : '') + '</div>';
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
