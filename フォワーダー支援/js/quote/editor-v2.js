// ===== 見積入力画面の新デザイン（Design 28・PC 案B：ステップ式）— 旧画面と切替式（2026-11） =====
//  ・<html class="editor-v2"> のときだけ効く。外せば旧画面にそのまま戻る（保存 localStorage fwd.editorV2＝'1'）。
//    入口：ヘッダー ☰ →「見積入力の画面（新／旧）」、または ?editor=v2|v1。
//  ・既存の DOM・id・onclick は変えず、表示の出し分けだけ（左のステップ・下の合計バー・右パネルの引き出し・右下ボタンの上部への統合）。
//  ・第 1 段：ステップ（①基本 ②ルート ③貨物・物量 ④費用 ⑤リマーク・出力）の切替・上部へのボタン統合・下の合計バー・引き出し。
//    未着手：④費用のサブコン別ツリーの再構成・明細 1 行の最小形・スマホ M2。
(function () {
  'use strict';
  const KEY = 'fwd.editorV2', root = document.documentElement;
  const $ = id => document.getElementById(id);
  const SECS = { 1: ['section-ref', 'section-scope'], 2: ['section-cond'], 3: ['section-cargo', 'section-volume'], 4: ['section-table'], 5: [] };
  const NAMES = { 1: '基本', 2: 'ルート', 3: '貨物・物量', 4: '費用', 5: 'リマーク・出力' };
  let step = 1, built = false, dockHome = null;

  const isOn = () => root.classList.contains('editor-v2');
  const val = id => { const e = $(id); return e ? String(e.value || '').trim() : ''; };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  function summaries() {
    const cust = val('qf-customer'), name = val('qf-case-name'), pol = val('z2Pol'), pod = val('z2Pod'), cargo = val('cond-cargo-name') || val('cargo-name') || val('cond-cargo');
    const rows = document.querySelectorAll('#tableBody tr:not([data-virtual]):not(.tr-sub):not(.tr-remark)').length;
    const sell = ($('tot-subtotal') && $('tot-subtotal').textContent || '').replace(/\s+/g, ' ').trim();
    return {
      1: { s: [cust, name].filter(Boolean).join(' / ') || '未入力', ok: !!(cust && val('qf-person')) },
      2: { s: (pol || pod) ? (pol || '?') + '→' + (pod || '?') : '未入力', ok: !!(pol && pod) },
      3: { s: cargo || '未入力', ok: !!cargo },
      4: { s: rows ? rows + '行' + (sell ? ' / 売 ' + sell : '') : '未入力', ok: rows > 0 },
      5: { s: (val('remarkTextarea') ? 'リマークあり' : '出力へ'), ok: false },
    };
  }

  // ① 基本：最初に入れる 4 つ（番号・お客様・ご担当者・案件名）以外は「その他の情報」にまとめる（CSS で出し分け・DOM は移さない）
  function buildBasics() {
    const sec = $('section-ref'); if (!sec || $('e2MoreBtn')) return;
    ['.ci-cell-recv', '.ci-dates', '#ciRelBtn', '#ciRelPanel', '.ci-more-block'].forEach(sel => sec.querySelectorAll(sel).forEach(e => e.classList.add('e2-other')));
    const first = sec.querySelector('.ci-first'); if (!first) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'e2MoreBtn'; b.setAttribute('aria-expanded', 'false');
    first.parentNode.insertBefore(b, first.nextSibling);
    b.addEventListener('click', () => { const on = !sec.classList.contains('e2-more-open'); sec.classList.toggle('e2-more-open', on); refreshBasics(); });
  }
  function refreshBasics() {
    const sec = $('section-ref'), b = $('e2MoreBtn'); if (!sec || !b) return;
    const open = sec.classList.contains('e2-more-open'), f = id => val(id);
    const chips = [f('qf-received') && '受信 ' + f('qf-received').slice(5), f('qf-date') && '発行 ' + f('qf-date').slice(5), f('qf-valid-until') && '有効 ' + f('qf-valid-until').slice(5)].filter(Boolean);
    const txt = 'その他の情報（受信日・発行日・有効期限・関連番号・タグ・参照資料）' + (chips.length ? '：' + chips.join(' ・ ') : '') + (open ? '  ▴ 畳む' : '  ▾ 入力欄を開く');
    if (b.textContent !== txt) b.textContent = txt;
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // ②ルート・③貨物・物量：入力済みの条件を「チップの 1 行」で見せる（DOM は変えず、ステップの先頭に要約の帯を 1 つ足す）。
  // ③の荷姿・換算の詳細は「詳細 ▾」の奥へ（CSS で出し分け）
  function chipsOf(n) {
    const sel = id => { const e = $(id); return e && e.selectedIndex >= 0 && e.value ? (e.options[e.selectedIndex].text || e.value).replace(/（.*$/, '').trim() : ''; };
    if (n === 2) {
      const pol = val('z2Pol'), pod = val('z2Pod'), dir = val('cond-direction'), dmap = { export: '輸出', import: '輸入', both: '往復', roundtrip: '往復' };
      return [
        val('cond-incoterms') && ['貿易条件', val('cond-incoterms')], dir && ['方向', dmap[dir] || dir], val('cond-mode') && ['モード', val('cond-mode')],
        (pol || pod) && ['航路', (pol || '?') + ' → ' + (pod || '?')], val('z2Icd') && ['ICD', val('z2Icd')], val('z2Carrier') && ['キャリア', val('z2Carrier')],
        val('cond-insurance-on') === 'true' && ['保険', '付保'], val('cond-handling') && ['荷役', sel('cond-handling')],
      ].filter(Boolean);
    }
    const ct = typeof window.getContainerEntries === 'function' ? window.getContainerEntries().filter(e => e.count > 0).map(e => e.type + '×' + e.count).join(' ') : '';
    return [val('cond-cargo') && ['貨物', val('cond-cargo')], val('cond-hs') && ['HS', val('cond-hs')], ct && ['コンテナ', ct], val('cond-hazmat') && ['区分', val('cond-hazmat')]].filter(Boolean);
  }
  function buildChips() {
    [['e2Chips2', 'section-cond'], ['e2Chips3', 'section-cargo']].forEach(a => {
      const sec = $(a[1]); if (!sec || $(a[0])) return;
      const d = document.createElement('div'); d.className = 'e2-chips'; d.id = a[0];
      const h = sec.querySelector(':scope > h2'); sec.insertBefore(d, h ? h.nextSibling : sec.firstChild);
    });
    const vol = $('section-volume');
    if (vol && !$('e2PackBtn')) {
      const b = document.createElement('button'); b.type = 'button'; b.id = 'e2PackBtn'; b.className = 'e2-morebtn';
      const body = $('volumeBody'); if (body) body.parentNode.insertBefore(b, body);
      b.addEventListener('click', () => { vol.classList.toggle('e2-pack-open'); refreshChips(); });
    }
  }
  function refreshChips() {
    [[2, 'e2Chips2'], [3, 'e2Chips3']].forEach(a => {
      const box = $(a[1]); if (!box) return;
      const c = chipsOf(a[0]), html = c.length ? c.map(x => '<span><i>' + x[0] + '</i>' + String(x[1]).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>').join('') : '<em>入力するとここに要約が並びます</em>';
      if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; }
    });
    const vol = $('section-volume'), b = $('e2PackBtn'); if (!vol || !b) return;
    const open = vol.classList.contains('e2-pack-open'), t = '荷姿・換算・シミュレーターなどの詳細' + (open ? '  ▴ 畳む' : '  ▾ 開く');
    if (b.textContent !== t) b.textContent = t; b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  // 上部ツールバー：案件名・状態・緊急・保存状態
  function buildTitle() {
    const tb = $('saveToolbar'); if (!tb || $('e2Title')) return;
    const t = document.createElement('div'); t.id = 'e2Title';
    t.innerHTML = '<b id="e2tName"></b><span id="e2tStatus"></span><span id="e2tSave"></span>';
    const grp = $('qmGroup'); tb.insertBefore(t, grp ? grp.nextSibling : tb.firstChild);
  }
  function refreshTitle() {
    const n = $('e2tName'); if (!n) return;
    const name = val('qf-case-name') || (($('qf-memo') && $('qf-memo').value || '').split('\n')[0].trim()) || val('qf-customer') || '（案件名なし）';
    if (n.textContent !== name) { n.textContent = name; n.title = name; }
    const st = $('e2tStatus'), sv = val('qf-status'); if (st && st.textContent !== sv) st.textContent = sv;
    const sa = $('e2tSave'), q = ($('qmBanner') && $('qmBanner').textContent || '').trim();
    const sat = q ? q : ''; if (sa && sa.textContent !== sat) sa.textContent = sat;
  }

  // ④ 費用：上に［すべて折りたたむ］［すべて展開］［＋ 行を追加］［📦 チャージ］（既存の関数を呼ぶだけ）
  function buildCostBar() {
    const w = $('tableWrap'); if (!w || $('e2CostBar')) return;
    const bar = document.createElement('div'); bar.id = 'e2CostBar';
    bar.innerHTML = '<button type="button" data-f="collapseAllGroups">▶ すべて折りたたむ</button><button type="button" data-f="expandAllGroups">▼ すべて展開</button><button type="button" data-f="addRow">＋ 行を追加</button><button type="button" data-f="lcOpenPicker">📦 チャージ</button>';
    bar.addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; const f = window[b.dataset.f]; if (typeof f === 'function') { try { f(); } catch (x) {} } });
    const c = w.querySelector(':scope > .container') || w.firstElementChild; w.insertBefore(bar, c);
  }

  function build() {
    if (built) return;
    buildCostBar();
    buildBasics(); buildTitle();
    const ws = document.querySelector('#tab-quote-make .quote-workspace'); if (!ws) return;
    const steps = document.createElement('nav'); steps.id = 'e2Steps'; steps.setAttribute('aria-label', '見積入力のステップ');
    ws.parentNode.insertBefore(steps, ws);
    const foot = document.createElement('div'); foot.id = 'e2Nav';
    foot.innerHTML = '<button type="button" id="e2Prev">← 戻る</button><button type="button" id="e2Next">次へ →</button>';
    const main = ws.querySelector('.quote-main'); (main || ws).appendChild(foot);
    const tot = document.createElement('div'); tot.id = 'e2Total';
    tot.innerHTML = '<div class="e2t-amts"><span><i>売</i><b id="e2tSell">—</b></span><span><i>仕入</i><b id="e2tCost">—</b></span><span><i>粗利</i><b id="e2tProfit">—</b></span></div>' +
      '<div class="e2t-btns"><button type="button" data-e2d="digest">費用の内訳 ▸</button><button type="button" data-e2d="ref">参考 ▸</button></div>';
    document.getElementById('tab-quote-make').appendChild(tot);
    steps.addEventListener('click', e => { const b = e.target.closest('[data-e2s]'); if (b) go(+b.dataset.e2s); });
    foot.addEventListener('click', e => { if (e.target.id === 'e2Prev') go(step - 1); if (e.target.id === 'e2Next') go(step + 1); });
    tot.addEventListener('click', e => { const b = e.target.closest('[data-e2d]'); if (!b) return; const on = !document.body.classList.contains('e2-drawer') || document.body.dataset.e2d !== b.dataset.e2d; document.body.classList.toggle('e2-drawer', on); document.body.dataset.e2d = b.dataset.e2d; if (on && typeof window.qspSetTab === 'function') { try { window.qspSetTab(b.dataset.e2d === 'digest' ? 'digest' : 'fin'); } catch (x) {} } });
    built = true;
  }

  // 明細行：空の「有効期間」は行にマウスを乗せる／入力するまで隠す（値があれば常に見せる）
  function tagRows() {
    document.querySelectorAll('#tableBody .w-valid').forEach(v => {
      const empty = [].every.call(v.querySelectorAll('input'), i => !String(i.value || '').trim());
      if ((v.dataset.e2empty === '1') !== empty) v.dataset.e2empty = empty ? '1' : '0';
    });
  }
  function refresh() {
    if (!isOn() || !built) return;
    refreshBasics(); refreshTitle(); tagRows(); buildChips(); refreshChips();
    const s = summaries(), box = $('e2Steps'); if (!box) return;
    const html = [1, 2, 3, 4, 5].map(n => '<button type="button" data-e2s="' + n + '" class="' + (n === step ? 'is-on' : '') + (s[n].ok ? ' is-ok' : '') + '"><i>' + (s[n].ok ? '✓' : n) + '</i><b>' + NAMES[n] + '</b><small>' + s[n].s.replace(/</g, '&lt;') + '</small></button>').join('');
    if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; }
    $('e2Prev').disabled = step <= 1; $('e2Next').disabled = step >= 5;
    const nx = $('e2Next'), nt = step < 5 ? '次へ：' + NAMES[step + 1] + ' →' : '次へ'; if (nx.textContent !== nt) nx.textContent = nt;
    const t = (id, to) => { const a = $(id), b = $(to); if (!a || !b) return; const v = a.textContent.replace(/\s+/g, ' ').replace(/^粗利\s*/, '').replace(/\s*粗利\s*/, '  ').trim() || '—'; if (b.textContent !== v) b.textContent = v; };
    t('tot-subtotal', 'e2tSell'); t('tot-cost', 'e2tCost'); t('tot-profit', 'e2tProfit');
  }

  function go(n, quiet) {
    if (n < 1 || n > 5) return;
    step = n;
    const tab = $('tab-quote-make'); if (tab) tab.dataset.e2 = String(n);
    [].concat.apply([], Object.values(SECS)).forEach(id => { const s = $(id); if (s) s.classList.remove('e2-show'); });
    SECS[n].forEach(id => { const s = $(id); if (!s) return; s.classList.add('e2-show'); if (s.classList.contains('collapsed') && typeof window.toggleQuoteSection === 'function') { try { window.toggleQuoteSection(id); } catch (e) {} } });
    if (typeof window.rmsOpen === 'function' && typeof window.rmsClose === 'function') { try { n === 5 ? window.rmsOpen() : window.rmsClose(); } catch (e) {} }
    refresh(); refreshBasics(); refreshTitle();
    if (!quiet) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 右下の固定ボタン（PDF／プレビュー／保存）を上部ツールバーへ。切り戻すときは元の場所へ
  function moveDock(on) {
    const dock = $('quoteActionDock'), tb = $('saveToolbar'); if (!dock || !tb) return;
    if (on) { if (!dockHome) dockHome = { p: dock.parentNode, n: dock.nextSibling }; tb.appendChild(dock); dock.classList.add('e2-in-toolbar'); }
    else if (dockHome) { dock.classList.remove('e2-in-toolbar'); dockHome.p.insertBefore(dock, dockHome.n); dockHome = null; }
  }

  function apply(on) {
    root.classList.toggle('editor-v2', on);
    ls.set(KEY, on ? '1' : '0');
    if (on) { build(); moveDock(true); go(step, true); } else { moveDock(false); document.body.classList.remove('e2-drawer'); const tab = $('tab-quote-make'); if (tab) delete tab.dataset.e2; try { window.rmsClose && 0; } catch (e) {} }
    syncBtn();
  }
  window.editorV2Set = apply;
  window.editorV2Toggle = () => apply(!isOn());
  window.editorV2Go = go;

  function syncBtn() { const b = $('hdrEditorV2Btn'); if (b) b.textContent = isOn() ? '🧭 見積入力：新しい画面（旧に戻す）' : '🧭 見積入力：旧い画面（新しい画面を試す）'; }
  function addMenuBtn() {
    const panel = $('hdrMenuPanel'); if (!panel) return false;
    if ($('hdrEditorV2Btn')) return true;
    const ref = $('hdrDesignBtn'), b = document.createElement('a');
    b.id = 'hdrEditorV2Btn'; b.href = '#'; b.className = ref ? ref.className : ''; b.setAttribute('role', 'button');
    b.addEventListener('click', e => { e.preventDefault(); window.editorV2Toggle(); });
    panel.appendChild(b); syncBtn(); return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    let tries = 0; const t = setInterval(() => { if (addMenuBtn() || ++tries > 20) clearInterval(t); }, 300);
    if (isOn()) { build(); moveDock(true); go(1, true); }
    // 入力のたびに要約・合計を更新（軽く間引く）
    let raf = 0; const kick = () => { if (!isOn()) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(refresh); };
    document.addEventListener('input', kick, true); document.addEventListener('change', kick, true);
    new MutationObserver(ms => { if (ms.some(m => !(m.target.closest && m.target.closest('#e2Steps, #e2Total, #e2Nav')))) kick(); }).observe(document.getElementById('tab-quote-make') || document.body, { childList: true, subtree: true, characterData: true });
  });
})();
