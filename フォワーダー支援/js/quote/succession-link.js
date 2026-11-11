// ========== 🧬 代替わり元（前の案件）をあとから紐づける ==========
// 「コピーして新規作成」だけでなく、新規作成した案件へ、あとから前の案件を選んで代替わり（世代）を設定できる。
//   入口：①編集画面「管理番号入力」の下の「代替わり元（前の案件）を紐づける」（変更・解除もここ）
//         ②ダッシュボードのカードの「⋯」→「🧬 代替わり元を設定…」（案件を開かずに設定）
//   選んだ案件の次の代になる（世代＝選んだ案件の世代＋1。オリジナルは引き継ぐ）。自分自身や自分から代替わりした案件は選べない（循環の防止）。
//   設定・解除・世代の数え直しの本体は cloud.js（cloudSetPredecessor）。ここは選ぶ画面と、編集画面の入口だけ。
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (m, k, ms) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, k || 'info', ms || 3500); };
  const norm = s => String(s == null ? '' : s).normalize('NFKC').toLowerCase();
  const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); };
  const MAX_SHOW = 60;

  function closeModal() { document.getElementById('succModal')?.remove(); }

  // rawId：紐づける側の案件（保存済みなら URL エンコードした id。新規で未保存なら空）
  window.cloudPickPredecessor = async function (rawId) {
    const id = rawId ? decodeURIComponent(rawId) : '';
    if (!(typeof window.quoteCurrentUserEmail === 'function' && window.quoteCurrentUserEmail())) { toast('⚠️ 先に Google でログインしてください', 'warn'); return; }
    // 一覧が未取得なら先に取る（編集画面から直接開いたとき）
    if (typeof window.cloudHasRows === 'function' && !window.cloudHasRows() && typeof window.cloudListPresets === 'function') {
      try { await window.cloudListPresets(true); } catch (e) { /* 取れなければ空の一覧で案内する */ }
    }
    const cands = (typeof window.cloudSuccessionCandidates === 'function') ? window.cloudSuccessionCandidates(id) : [];
    const myCustomer = (document.getElementById('qf-customer')?.value || '').trim();
    const sameCust = c => !!myCustomer && norm(c.customer) === norm(myCustomer);
    // 同じお客様の案件を上に、その中は更新日の新しい順
    cands.sort((a, b) => (sameCust(b) - sameCust(a)) || String(b.updated_at).localeCompare(String(a.updated_at)));
    const childCount = id && typeof window.cloudSuccessionDescendantCount === 'function' ? window.cloudSuccessionDescendantCount(id) : 0;

    closeModal();
    const w = document.createElement('div');
    w.id = 'succModal'; w.className = 'succ-overlay';
    w.innerHTML =
      '<div class="succ-box" role="dialog" aria-label="代替わり元を選ぶ">' +
        '<div class="succ-head"><span>🧬 代替わり元（前の案件）を選ぶ</span><button type="button" class="succ-x" title="閉じる（Esc）">✕</button></div>' +
        '<div class="succ-sub">選んだ案件の「次の代」として、この案件を管理します（世代は選んだ案件＋1）。' +
          (childCount ? '<br><b>※ この案件から代替わりした ' + childCount + ' 件の世代も、あわせて数え直します。</b>' : '') + '</div>' +
        '<input type="text" class="succ-search" placeholder="管理番号・案件名・お客様・担当で絞り込み" autocomplete="off">' +
        '<div class="succ-list" role="listbox"></div>' +
        '<div class="succ-foot"><span class="succ-count"></span><button type="button" class="succ-cancel">キャンセル</button></div>' +
      '</div>';
    (document.getElementById('tab-quote-make') || document.body).appendChild(w);
    const list = w.querySelector('.succ-list'), cnt = w.querySelector('.succ-count'), inp = w.querySelector('.succ-search');
    const close = () => { closeModal(); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);

    const render = () => {
      const terms = norm(inp.value).split(/[\s　]+/).filter(Boolean);
      const hit = cands.filter(c => { const hay = norm([c.ref, c.name, c.customer, c.person].join(' ')); return terms.every(t => hay.indexOf(t) >= 0); });
      const show = hit.slice(0, MAX_SHOW);
      cnt.textContent = hit.length ? hit.length + ' 件' + (hit.length > MAX_SHOW ? '（先頭の ' + MAX_SHOW + ' 件を表示）' : '') : '';
      list.innerHTML = show.length ? show.map((c, i) =>
        '<button type="button" class="succ-item" role="option" data-i="' + i + '">' +
          '<span class="succ-ref">' + esc(c.ref || c.name) + '</span>' +
          (sameCust(c) ? '<span class="succ-badge">同じお客様</span>' : '') +
          (c.gen > 1 ? '<span class="succ-gen">' + c.gen + '代目</span>' : '') +
          '<span class="succ-cust">' + esc(c.customer) + (c.person ? ' / ' + esc(c.person) : '') + '</span>' +
          '<span class="succ-meta">' + esc(c.status) + ' ・ ' + esc(fmtDate(c.updated_at)) + '</span>' +
        '</button>').join('')
        : '<div class="succ-none">' + (cands.length ? '該当する案件がありません' : '選べる案件がありません') + '</div>';
      list._show = show;
    };
    render();
    inp.addEventListener('input', render);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { const f = list.querySelector('.succ-item'); if (f) { e.preventDefault(); f.click(); } } });
    w.addEventListener('click', e => { if (e.target === w) close(); });
    w.querySelector('.succ-x').onclick = close;
    w.querySelector('.succ-cancel').onclick = close;
    list.addEventListener('click', async e => {
      const btn = e.target.closest('.succ-item'); if (!btn) return;
      const pick = list._show[+btn.dataset.i]; if (!pick) return;
      close();
      if (id) {
        await window.cloudSetPredecessor(rawId, pick.id);      // 保存済みの案件：DB を更新（世代の数え直しも）
      } else {
        const cf = typeof window.cloudMakeCopiedFrom === 'function' ? window.cloudMakeCopiedFrom(pick.id) : null;   // 新規で未保存：保存時に一緒に保存される
        if (!cf) { toast('⚠️ 選んだ案件が見つかりません', 'warn'); return; }
        window.qfSetCopiedFrom(cf);
        toast('🧬 「' + (pick.ref || pick.name) + '」の次の代（' + cf.gen + '代目）として設定しました。保存すると確定します', 'success', 4500);
      }
    });
    inp.focus();
  };

  // 編集画面の入口
  window.qfPickPredecessor = function () {
    const id = typeof window.cloudLoadedId === 'function' ? window.cloudLoadedId() : '';
    window.cloudPickPredecessor(id ? encodeURIComponent(id) : '');
  };
  window.qfClearPredecessor = async function () {
    const id = typeof window.cloudLoadedId === 'function' ? window.cloudLoadedId() : '';
    if (!confirm('代替わり元の設定を解除しますか？（この案件はオリジナル＝1代目に戻ります）')) return;
    if (id) await window.cloudSetPredecessor(encodeURIComponent(id), null);
    else { window.qfSetCopiedFrom(null); toast('🧬 代替わり元の設定を解除しました', 'info', 3000); }
  };
})();
