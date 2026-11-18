// 🔧 名前の整理（マスター管理のハブ・Design 29 案B ①b）：名寄せの表を「1 行＝名前・件数・状態の札」に畳み、
// 開くと表記の一覧と「主ボタン 1 つ」を出す薄い表示層。既存の表（stats.js _renderGrouped）の DOM・ボタン・onclick は残し、
// 行に要素を足して CSS（css/fix-hub.css）で出し分けるだけ。実際の登録・別名は既存の関数（statsToggleVote／synAddAlias）を呼ぶ。
//   ・［この名前にまとめる］＝表記ゆれのある行（確認ダイアログ → 別名にまとめる → 下のバーに［元に戻す］）
//   ・［☆ マスターに登録］＝未登録の単独の行（→ 下のバーに［元に戻す］）
//   ・メンバー（承認制）は「申請」の文言・元に戻すは出さない（申請は管理者が承認するまで確定しない）
//   ・☆登録・→別名にする・≠別物 などは行の［⋯ その他 ▾］の中
(function () {
  'use strict';
  const FIELD = { sv: 'sv', carrier: 'sv', customer: 'customer', nm: 'nm', un: 'un' };
  let busy = false;
  const $ = (s, r) => (r || document).querySelector(s);
  const toast = (m, t) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, t); };
  const member = () => typeof window.statsAliasNeedsApproval === 'function' && !!window.statsAliasNeedsApproval();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function chipsOf(tr) {
    return [...tr.querySelectorAll('.stats-chip')].map(c => ({ name: (c.querySelector('.stats-chip-text')?.textContent || '').replace(/^\s*⭐\s*/, '').trim(), n: +((c.querySelector('.stats-chip-cnt')?.textContent || '').replace(/[^0-9]/g, '')) || 0, voted: !!c.querySelector('.stats-vote-btn.stats-voted') })).filter(x => x.name);
  }
  function enhanceRow(tr, kind) {
    if (tr.dataset.fh) return; tr.dataset.fh = '1';
    const val = $('td.stats-val', tr), cell = $('td.stats-chips-cell', tr); if (!val || !cell) return;
    const field = FIELD[kind], chips = chipsOf(tr), isSyn = tr.classList.contains('stats-syn-row'), hasV = tr.classList.contains('stats-has-variant') && chips.length > 1;
    const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'fh-tog'; tog.setAttribute('aria-expanded', 'false'); tog.title = '開く／閉じる'; tog.textContent = '▶';
    val.insertBefore(tog, val.firstChild);
    // 状態の札（表記ゆれは既存の「表記ゆれ N種」の札を使う）
    let st = '';
    if (isSyn) st = '<span class="fh-st fh-st-ok">整理済み</span>';
    else if (!hasV) st = chips[0] && chips[0].voted ? '<span class="fh-st fh-st-ok">登録済み</span>' : '<span class="fh-st fh-st-new">未登録</span>';
    if (st) val.insertAdjacentHTML('beforeend', ' ' + st);
    // 開いたときの操作（主ボタン 1 つ＋［⋯ その他 ▾］）
    const bar = document.createElement('div'); bar.className = 'fh-actions';
    const m = member();
    if (hasV) {
      const top = chips.slice().sort((a, b) => b.n - a.n)[0];
      bar.innerHTML = '<label class="fh-canon-l">正しい名前 <select class="fh-canon">' + chips.map(c => '<option value="' + esc(c.name) + '"' + (c.name === top.name ? ' selected' : '') + '>' + esc(c.name) + '（' + c.n + '件）</option>').join('') + '</select></label>' +
        '<button type="button" class="fh-main" data-act="merge">' + (m ? 'まとめるを申請' : 'この名前にまとめる') + '</button>';
    } else if (!isSyn && chips[0] && !chips[0].voted) {
      bar.innerHTML = '<button type="button" class="fh-main" data-act="reg">' + (m ? '登録を申請' : '☆ マスターに登録') + '</button>';
    }
    bar.insertAdjacentHTML('beforeend', '<button type="button" class="fh-more" aria-expanded="false">⋯ その他 ▾</button>');
    cell.insertBefore(bar, cell.firstChild);
    const flip = () => { const o = tr.classList.toggle('fh-open'); tog.setAttribute('aria-expanded', o); tog.textContent = o ? '▼' : '▶'; };
    tog.addEventListener('click', e => { e.stopPropagation(); flip(); });
    val.addEventListener('click', e => { if (e.target.closest('button, a, input, select')) return; flip(); });
    bar.querySelector('.fh-more').addEventListener('click', e => { const o = tr.classList.toggle('fh-more-on'); e.currentTarget.setAttribute('aria-expanded', o); });
    bar.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act, tr, kind, field); });
  }
  function enhance() {
    if (busy) return; busy = true;
    try {
      const pane = $('#statsPane-fix .stats-pane.is-active'); if (!pane) return;
      const kind = pane.id.replace('statsPane-', '');
      if (!FIELD[kind]) return;
      pane.querySelectorAll('.stats-nm-table tbody > tr').forEach(tr => enhanceRow(tr, kind));
    } finally { busy = false; }
  }
  // ---- 実行 ----
  function undoBar(msg, undo) {
    let b = document.getElementById('fhUndo'); if (b) b.remove();
    b = document.createElement('div'); b.id = 'fhUndo'; b.className = 'fh-undo'; b.setAttribute('role', 'status');
    b.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button">元に戻す</button>' : '') + '<button type="button" class="fh-undo-x" aria-label="閉じる">✕</button>';
    document.body.appendChild(b);
    const kill = setTimeout(() => b.remove(), 9000);
    b.querySelector('.fh-undo-x').onclick = () => { clearTimeout(kill); b.remove(); };
    if (undo) b.querySelector('button').onclick = async () => { clearTimeout(kill); b.remove(); try { await undo(); } catch (e) { console.error(e); toast('元に戻せませんでした', 'warn'); } };
  }
  async function act(kind, tr, k, field) {
    const m = member();
    if (kind === 'reg') {
      const name = chipsOf(tr)[0] && chipsOf(tr)[0].name; if (!name) return;
      await window.statsToggleVote(field, name);
      if (!m) undoBar('「' + name + '」をマスターに登録しました', () => window.statsToggleVote(field, name));
    } else if (kind === 'merge') {
      const canon = $('.fh-canon', tr).value, chips = chipsOf(tr), others = chips.filter(c => c.name !== canon);
      if (!others.length) return;
      const total = chips.reduce((s, c) => s + c.n, 0);
      const ok = typeof window.uiConfirm === 'function' ? await window.uiConfirm({ title: m ? 'まとめるを申請します' : 'この名前にまとめます', lines: [others.map(c => c.name).join('・') + '・' + canon + ' → 「' + canon + '」', '集計が ' + chips.length + ' 行 → 1 行に合算されます（' + total + ' 件）。元の入力は変わりません。' + (m ? '管理者が承認すると反映されます。' : '後から元に戻せます。')], okLabel: m ? '申請する' : 'まとめる' }) : true;
      if (!ok) return;
      const wasMaster = typeof window.statsMasterState === 'function' && window.statsMasterState(field, canon) === 'master';
      for (const c of others) await window.synAddAlias(field, c.name, canon);
      if (!m) undoBar('「' + canon + '」にまとめました', async () => {
        for (const c of others) await window.synRemoveAlias(field, c.name, canon);
        if (!wasMaster && typeof window.statsEnsureNotMaster === 'function') await window.statsEnsureNotMaster(field, canon);
        toast('元に戻しました（別名を外しました）');
      });
    }
  }
  function boot() {
    const root = document.getElementById('statsPane-fix'); if (!root) return;
    let raf = 0;
    new MutationObserver(() => { if (busy) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(enhance); }).observe(root, { childList: true, subtree: true });
    enhance();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.fhEnhance = enhance;
})();
