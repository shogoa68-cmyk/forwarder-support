// 📚 参照資料（URL・ファイル）を追加するダイアログ。Gemini NotebookLM の「ソースを追加」風。
//   ・見積入力「管理番号入力」の「参照資料」カード（#qfSources）の「＋ 資料を追加」から開く。
//   ・URL は #qf-refurl（保存用の隠しテキスト・改行区切り）に足す＝保存形式は従来のまま。一覧の描画は
//     conditions.js の renderRefUrlLinks()。ファイルは cloud.js の qfAttachUpload()／qfRenderAttachments()。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const isOpen = () => !!$('srcAddModal') && $('srcAddModal').classList.contains('open');

  // 一覧が空のときだけ「資料はまだありません」を出す（URL もファイルも無く、ファイル側の案内も無いとき）
  window.srcSyncEmpty = function () {
    const e = $('qfSrcEmpty'); if (!e) return;
    const hasUrl = !!document.querySelector('#qfSrcUrls .qf-attach-item');
    const hasFile = !!document.querySelector('#qfAttachList .qf-attach-item');
    const hasNote = !!document.querySelector('#qfAttachList .qf-attach-empty');
    e.hidden = hasUrl || hasFile || hasNote;
  };

  function msg(text, isErr) {
    const m = $('srcUrlMsg'); if (!m) return;
    m.textContent = text || ''; m.classList.toggle('is-err', !!isErr);
  }
  // ファイルを添付できない状態（未ログイン・未保存）のときは、ダイアログの中で先に伝える
  function refreshNote() {
    const n = $('srcAddNote'); if (!n) return;
    const st = typeof window.qfAttachState === 'function' ? window.qfAttachState() : { loggedIn: false, saved: false };
    let t = '';
    if (!st.loggedIn) t = 'ファイルを添付するにはログインが必要です（URL はログインなしでも追加できます）。';
    else if (!st.saved) t = 'ファイルは、先に案件を保存（💾 保存）してから添付できます（URL はすぐ追加できます）。';
    n.textContent = t; n.hidden = !t;
    const drop = $('qfAttachDrop'); if (drop) drop.classList.toggle('is-disabled', !!t);
  }
  function grow() {
    const t = $('srcUrlInput'); if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 132) + 'px';
  }

  window.srcAddOpen = function () {
    const m = $('srcAddModal'); if (!m) return;
    m.classList.add('open');
    msg('');
    refreshNote();
    if (typeof window.qfRenderStorageMeter === 'function') window.qfRenderStorageMeter();   // 容量の最新の値
    setTimeout(() => { const t = $('srcUrlInput'); if (t) t.focus(); }, 0);
  };
  window.srcAddClose = function () {
    const m = $('srcAddModal'); if (!m) return;
    m.classList.remove('open');
    const b = $('srcAddBtn'); if (b && b.offsetParent) b.focus();
  };
  window.srcFocusUrl = function () { const t = $('srcUrlInput'); if (t) t.focus(); };

  // 入力欄の URL を、この案件の参照URLへ追加（重複は除く）。複数行・空白区切りでまとめて追加できる
  window.srcAddUrlsFromInput = function () {
    const inp = $('srcUrlInput'), ta = $('qf-refurl');
    if (!inp || !ta) return;
    const extract = window.refUrlExtract;
    if (typeof extract !== 'function') return;
    const found = extract(inp.value);
    if (!found.length) { msg(inp.value.trim() ? 'http:// または https:// で始まる URL を入力してください。' : 'URL を貼り付けてください。', true); return; }
    const have = new Set(extract(ta.value));
    const add = found.filter(u => !have.has(u));
    const dup = found.length - add.length;
    if (!add.length) { msg('すでに追加済みの URL です。', true); inp.value = ''; grow(); return; }
    const cur = ta.value.replace(/\s+$/, '');
    ta.value = (cur ? cur + '\n' : '') + add.join('\n');
    ta.dispatchEvent(new Event('input', { bubbles: true }));    // 未保存の印・元に戻す履歴
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    inp.value = ''; grow();
    if (typeof window.renderRefUrlLinks === 'function') window.renderRefUrlLinks();
    if (typeof window.ciSync === 'function') window.ciSync();
    msg('🔗 ' + add.length + ' 件の URL を追加しました' + (dup ? '（追加済みの ' + dup + ' 件は除きました）' : '') + '。', false);
  };

  function init() {
    const inp = $('srcUrlInput'); if (!inp || window.__srcInit) return; window.__srcInit = true;
    inp.addEventListener('input', () => { grow(); if ($('srcUrlMsg') && $('srcUrlMsg').textContent) msg(''); });
    inp.addEventListener('keydown', e => {
      // Enter で追加（Shift+Enter は改行。日本語入力の確定の Enter では追加しない）
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); window.srcAddUrlsFromInput(); }
    });
    // 貼り付けた直後に複数行ならそのまま追加はせず、確認できるよう入力欄に残す（Enter／→ で追加）
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); window.srcAddClose(); }
    }, true);
    window.srcSyncEmpty();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();
