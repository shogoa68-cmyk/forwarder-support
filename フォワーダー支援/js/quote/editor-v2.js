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
  const SECS = { 1: ['section-ref', 'section-scope'], 2: ['section-cond'], 3: ['section-cargo', 'section-volume'], 4: ['section-table'], 5: ['section-remark'] };
  const NAMES = { 1: '基本', 2: 'ルート', 3: '貨物・物量', 4: '費用', 5: 'リマーク・出力' };
  let step = 1, built = false, dockHome = null, railOpen = false;
  // 左のレール：画面が広いとき（1400px 以上）は最初から開いた「固定」表示（本文をずらし、暗幕なし）。開閉は任意で、広い画面では選んだ状態を覚える
  const wideRail = () => !!(window.matchMedia && window.matchMedia('(min-width: 1400px)').matches) && !(window.matchMedia && window.matchMedia('(max-width: 600px)').matches);
  // 値が変わるときだけ hidden を書く（同じ値でも書くと、:has() の規則のせいで画面全体の CSS の計算し直しが起きる）
  const H = (el, v) => { if (el && el.hidden !== !!v) el.hidden = !!v; };
  const railPref = () => { try { return localStorage.getItem('fwd.e2Rail'); } catch (e) { return null; } };
  const isDock = () => railOpen && wideRail();
  // 右レールを常時表示する広い画面（1500px 以上）では、最初は引き出しを閉じた状態で始める（右レールの既定は「費用」を開いた状態で、本文に重なるため）。1 回だけ
  let rrClosed = false;
  const closeRightOnce = () => {
    if (rrClosed || !window.matchMedia || !window.matchMedia('(min-width: 1500px)').matches || document.body.classList.contains('e2-drawer')) return;
    const on = document.querySelector('#qrcRail .qrc-rail-btn.is-on'), rail = document.getElementById('qrcRail'); if (!rail) return;
    rrClosed = true; if (on) on.click();
  };
  const visited = {};   // 開いたことのあるステップ（必須が欠けた「!」の印はここだけに出す＝順番は強制しない）

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
    const back = $('qmDash'); if (back) back.setAttribute('aria-label', 'ダッシュボードに戻る');
    // 作業状態の札（1 つだけ・題名の右）。長い説明は押したときのポップアップに
    const st = document.createElement('button'); st.type = 'button'; st.id = 'e2State'; st.setAttribute('aria-haspopup', 'true');
    const pop = document.createElement('div'); pop.id = 'e2StatePop'; pop.hidden = true;
    st.addEventListener('click', e => { e.stopPropagation(); pop.hidden = !pop.hidden; });
    document.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true; });
    t.after(st); st.after(pop);
    // 数量パターン（2 つ以上のときだけ「数量：FCL案 ▾ N案」）
    const pat = document.createElement('div'); pat.id = 'e2Pat'; pat.hidden = true;
    pat.innerHTML = '<button type="button" id="e2PatBtn" aria-haspopup="true"></button><div id="e2PatMenu" hidden></div>';
    pop.after(pat);
    const need = document.createElement('button'); need.type = 'button'; need.id = 'e2PatNeed'; need.hidden = true;
    need.addEventListener('click', () => { if (typeof window.jumpToQtyNeedsCheck === 'function') window.jumpToQtyNeedsCheck(); });
    pat.after(need);
    // Design 42r-2：関連が 1 件以上のときだけ「🔗 関連 N件」（押すと右の「類似」の引き出し＝上に関連付けた案件）
    const rel = document.createElement('button'); rel.type = 'button'; rel.id = 'e2Rel'; rel.hidden = true; rel.title = '関連付けた案件を見る';
    rel.addEventListener('click', e => { e.stopPropagation(); openRel(); });
    st.after(rel);
    const menu = $('tbMenuMore');
    if (menu && !$('e2RelMi')) {
      const mi = document.createElement('button'); mi.type = 'button'; mi.id = 'e2RelMi'; mi.className = 'tb-menu-item e2-rel-mi'; mi.hidden = true;
      mi.innerHTML = '<span class="tb-mi-icon">🔗</span><span class="tb-mi-body"><span class="tb-mi-title"></span><span class="tb-mi-sub">関連付けた案件を見る</span></span>';
      mi.addEventListener('click', () => { if (typeof window.closeTbMenus === 'function') window.closeTbMenus(); openRel(); });
      menu.insertBefore(mi, menu.firstChild);
    }
    const br = document.createElement('span'); br.id = 'e2Br'; t.after(br);
    $('e2PatBtn').addEventListener('click', e => { e.stopPropagation(); $('e2PatMenu').hidden = !$('e2PatMenu').hidden; });
    $('e2PatMenu').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; $('e2PatMenu').hidden = true; if (typeof window.switchPackingPattern === 'function') window.switchPackingPattern(+b.dataset.i); });
    document.addEventListener('click', e => { const m = $('e2PatMenu'); if (m && !m.hidden && !$('e2Pat').contains(e.target)) m.hidden = true; });
  }
  // 関連の件数（ダッシュボードのカードと同じ数え方＝メイン・サブ・孫・ただの関連をまとめる）。案件が変わったとき・60 秒ごとに読み直す
  let relId = null, relAt = 0, relN = 0, relBusy = false;
  function openRel() {
    const btn = document.querySelector('#qrcRail .qrc-rail-btn[data-mod="similar"]');
    if (document.body.classList.contains('e2-drawer') && document.body.dataset.e2drawer === 'similar') return;
    toggleDrawer('similar');
    if (!btn) return;
    setTimeout(() => { const sec = document.querySelector('#sqPanel .sq-links-section'); if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: 'start' }); }, 300);
  }
  window.e2OpenRelated = openRel;
  function paintRel() {
    const b = $('e2Rel'), mi = $('e2RelMi'), t = relN > 0 ? '🔗 関連 ' + relN + '件' : '';
    if (b) { H(b, !t); if (b.textContent !== t) b.textContent = t; }
    if (mi) { H(mi, !t); const tt = mi.querySelector('.tb-mi-title'); if (tt && tt.textContent !== t) tt.textContent = t; }
  }
  function refreshRel(force) {
    const id = typeof window.quoteCloudLoadedId === 'function' ? window.quoteCloudLoadedId() : null;
    if (!id) { relId = null; relN = 0; paintRel(); return; }
    if (relBusy || (!force && id === relId && Date.now() - relAt < 60000)) { paintRel(); return; }
    if (typeof window.cloudFetchPresetLinks !== 'function') return;
    relBusy = true; relId = id; relAt = Date.now();
    Promise.resolve(window.cloudFetchPresetLinks(id)).then(list => {
      const seen = new Set([id]);
      const walk = l => (l || []).forEach(x => { const oid = x.otherId || x.id || (x.preset && x.preset.id); if (oid && !seen.has(oid)) seen.add(oid); walk(x.kids); });
      walk(list);
      if (id === relId) relN = seen.size - 1;
    }).catch(() => {}).finally(() => { relBusy = false; paintRel(); });
  }
  window.e2RefreshRelated = () => refreshRel(true);
  function refreshTitle() {
    const n = $('e2tName'); if (!n) return;
    const name = val('qf-case-name') || (($('qf-memo') && $('qf-memo').value || '').split('\n')[0].trim()) || val('qf-customer') || '（案件名なし）';
    const ref = val('qf-ref'), full = (ref ? ref + ' / ' : '') + name;   // 案件番号 / 案件名
    if (n.textContent !== full) { n.textContent = full; n.title = full; }
    const st = $('e2tStatus'), sv = val('qf-status'); if (st && st.textContent !== sv) st.textContent = sv;
    const sa = $('e2tSave'), q = ($('qmBanner') && $('qmBanner').textContent || '').trim();
    const sat = /編集中|閲覧モード/.test(q) ? '' : q;   // 「編集中（あなたが作業中）」はツールバー側のチップに出ているので重ねて出さない
    if (sa && sa.textContent !== sat) sa.textContent = sat;
    refreshState(q); refreshPat(); refreshRel();
  }
  // 作業状態の札：閲覧中／編集中（未保存なら足す）／ロック（他の人が編集中＝この画面では判定できないため、押したときの案内に出る）
  function refreshState(q) {
    const b = $('e2State'); if (!b) return;
    const view = /閲覧モード/.test(q || ''), edit = /編集中/.test(q || '');
    const dirty = !!(window.quoteIsDirty && window.quoteIsDirty());
    const lk = view && typeof window.quoteLockedByOther === 'function' ? window.quoteLockedByOther() : null;   // 他の人が編集中（一覧の情報＝目安）
    const ro = window._myRole === 'viewer';   // 閲覧のみ権限（チーム管理のロール）
    const t = ro ? '🔒 閲覧のみ（権限）' : lk ? '🔒 ' + lk.name + 'さんが編集中' : view ? '👁 閲覧中' : edit ? '✏️ 編集中' + (dirty ? '　● 未保存' : '') : '';
    H(b, !t); if (b.textContent !== t) b.textContent = t;
    const bc = (lk || ro) ? 'is-lock' : view ? 'is-view' : edit ? 'is-edit' : ''; if (b.className !== bc) b.className = bc;
    const mb = $('qadMode');   // ロック中・閲覧のみ権限のとき：［✏️ 編集を始める］が［🔒 閲覧のみ］（押せない）になる（文字は syncMode が決める。保存ボタンは「保存」のまま押せない）。ロックが外れたら元に戻る
    if (mb) { if (lk || ro) { if (mb.dataset.e2lock !== '1') mb.dataset.e2lock = '1'; if (!mb.disabled) mb.disabled = true; } else if (mb.dataset.e2lock === '1') { delete mb.dataset.e2lock; mb.disabled = false; } }
    syncMode();
    const pop = $('e2StatePop'); if (pop && pop.textContent !== (q || '')) pop.textContent = q || '';
    if (b.title !== (q || '')) b.title = q || '';
  }
  function refreshPat() {
    const chips = [].slice.call(document.querySelectorAll('#qtyPatternBar .qpat-chip'));
    const box = $('e2Pat'); if (!box) return;
    const multi = chips.length >= 2; H(box, !multi);
    const need = $('e2PatNeed'), nb = document.querySelector('#qtyPatternBar .qpat-need');
    if (need) { H(need, !(multi && nb)); if (nb) { const t = nb.textContent.trim(); if (need.textContent !== t) need.textContent = t; } }
    if (!multi) return;
    const nm = c => (c.querySelector('.qpat-name') || c).textContent.trim();
    const act = chips.find(c => c.classList.contains('is-active')) || chips[0];
    const bt = '数量：' + nm(act) + ' ▾ ' + chips.length + '案'; const btn = $('e2PatBtn'); if (btn.textContent !== bt) btn.textContent = bt;
    const html = chips.map((c, i) => '<button type="button" data-i="' + i + '"' + (c === act ? ' class="is-on"' : '') + '>' + nm(c).replace(/</g, '&lt;') + (c.querySelector('.qpat-mode') ? ' <small>' + c.querySelector('.qpat-mode').textContent + '</small>' : '') + '</button>').join('');
    const m = $('e2PatMenu'); if (m.dataset.h !== html) { m.dataset.h = html; m.innerHTML = html; }
  }

  // 「⋯」メニューを「案件」「その他」の 2 区分に（出力の PDF／プレビューは上部ツールバーにあるため置かない）。見出しに印を付けるだけで、並べ替え・見出し名は CSS（order・::after）
  function tagMenu() {
    const m = $('tbMenuMore'); if (!m) return;
    m.querySelectorAll('.tb-menu-group').forEach(g => { const t = g.textContent.trim(); g.dataset.e2mg = t === '操作' ? 'misc' : t === '取り込み・送る' ? 'case' : 'set'; });
  }
  // ④ 費用：上に［すべて折りたたむ］［すべて展開］［＋ サブコンを追加］［📦 チャージ］（既存の関数を呼ぶだけ）
  function buildCostBar() {
    const w = $('tableWrap'); if (!w || $('e2CostBar')) return;
    const bar = document.createElement('div'); bar.id = 'e2CostBar';
    bar.innerHTML = '<button type="button" data-f="collapseAllGroups">▶ すべて折りたたむ</button><button type="button" data-f="expandAllGroups">▼ すべて展開</button><button type="button" data-f="openAddSubconFrame" class="e2-primary" title="先にサブコン（費用の取引先）の枠をつくり、その中へ明細を入力します">＋ サブコンを追加</button><button type="button" data-f="lcOpenPicker">📦 チャージ</button>';
    bar.addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; const f = window[b.dataset.f]; if (typeof f === 'function') { try { f(b); } catch (x) {} } });
    const c = w.querySelector(':scope > .container') || w.firstElementChild; w.insertBefore(bar, c);
  }

  function build() {
    if (built) return;
    buildCostBar(); tagMenu();
    buildBasics(); buildTitle();
    const ws = document.querySelector('#tab-quote-make .quote-workspace'); if (!ws) return;
    const steps = document.createElement('nav'); steps.id = 'e2Steps'; steps.setAttribute('aria-label', '見積入力のステップ');
    ws.parentNode.insertBefore(steps, ws);
    const head = document.createElement('div'); head.id = 'e2Head'; ws.parentNode.insertBefore(head, ws);
    const scrim = document.createElement('div'); scrim.id = 'e2Scrim'; scrim.addEventListener('click', () => setRail(false));
    const tabEl = $('tab-quote-make'); if (tabEl) tabEl.appendChild(scrim);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && railOpen && !isDock()) { e.stopPropagation(); setRail(false); } }, true);
    const foot = document.createElement('div'); foot.id = 'e2Nav';
    foot.innerHTML = '<button type="button" id="e2Prev">← 戻る</button><button type="button" id="e2Next">次へ →</button>';
    const main = ws.querySelector('.quote-main'); (main || ws).appendChild(foot);
    const tot = document.createElement('div'); tot.id = 'e2Total';
    tot.innerHTML = '<div class="e2t-amts"><span><i>売</i><b id="e2tSell">—</b></span><span><i>仕入</i><b id="e2tCost">—</b></span><span><i>粗利</i><b id="e2tProfit">—</b></span></div>' +
      '<div class="e2t-btns"><button type="button" data-e2q="1" class="e2t-q" title="単位ごとの数量をまとめて登録・変更する">数量登録</button><button type="button" data-e2d="digest">費用の内訳 ▸</button><button type="button" data-e2d="ref">参考 ▸</button></div>';
    document.getElementById('tab-quote-make').appendChild(tot);
    steps.addEventListener('click', e => {
      if (e.target.closest('.e2-rail-toggle')) { setRail(!railOpen, true); return; }
      const b = e.target.closest('[data-e2s]'); if (!b) return;
      go(+b.dataset.e2s);
      if (railOpen && !isDock()) setRail(false);   // 重ねて開いているときは、選んだら自動でしまう（固定表示のときは開いたまま）
    });
    document.addEventListener('keydown', e => {
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || !isOn() || phone()) return;
      const a = document.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || (a && a.isContentEditable)) return;
      const tab = $('tab-quote-make'); if (!tab || !tab.classList.contains('active') && tab.classList.contains('qp-dash')) return;
      e.preventDefault(); setRail(!railOpen, true);
    });
    foot.addEventListener('click', e => { if (e.target.id === 'e2Prev') go(step - 1); if (e.target.id === 'e2Next') go(step + 1); });
    tot.addEventListener('click', e => {
      if (e.target.closest('[data-e2f]')) { if (window.rmsIsOpen && window.rmsIsOpen() && window.rmsPane && window.rmsPane() === 'files') window.rmsClose(); else if (window.rmsShowFiles) window.rmsShowFiles(); return; }
      if (e.target.closest('[data-e2q]')) toggleDrawer('scenario');
      if (e.target.closest('[data-e2p]') && typeof window.addPackingPattern === 'function') window.addPackingPattern();
    });
    tot.addEventListener('click', e => { const b = e.target.closest('#e2Total [data-e2d]'); if (b) toggleDrawer(b.dataset.e2d === 'digest' ? 'digest' : 'similar'); });
    built = true;
  }

  // 明細行：空の「有効期間」は行にマウスを乗せる／入力するまで隠す（値があれば常に見せる）
  function tagRows() {
    document.querySelectorAll('#tableBody select.w-cat').forEach(c => { const e = !String(c.value || '').trim(); if ((c.dataset.e2empty === '1') !== e) c.dataset.e2empty = e ? '1' : '0'; });
    document.querySelectorAll('#tableBody .w-valid').forEach(v => {
      const empty = [].every.call(v.querySelectorAll('input'), i => !String(i.value || '').trim());
      if ((v.dataset.e2empty === '1') !== empty) v.dataset.e2empty = empty ? '1' : '0';
    });
  }
  function refresh() {
    if (!isOn() || !built) return;
    kickRailTop(); closeRightOnce(); refreshBasics(); refreshTitle(); tagRows(); buildChips(); refreshChips();
    const s = summaries(), box = $('e2Steps'); if (!box) return;
    const REQ = { 1: 1, 2: 1, 4: 1 };   // 印は選択中でも 3 種のまま（選択中は印でなく行の線・背景で示す）
    const toggle = '<button type="button" class="e2-rail-toggle" aria-expanded="' + railOpen + '" title="' + (railOpen ? 'ステップをしまう（[ キー）' : 'ステップを開く（[ キー）') + '"><i>' + (railOpen ? '«' : '»') + '</i><b>しまう</b></button>';
    const html = toggle + [1, 2, 3, 4, 5].map(n => { const warn = !s[n].ok && REQ[n] && visited[n]; const mark = n; const sm = s[n].s.replace(/</g, '&lt;'); return '<button type="button" data-e2s="' + n + '" title="' + NAMES[n] + '：' + sm + '" class="' + (n === step ? 'is-on' : '') + (s[n].ok ? ' is-ok' : '') + (warn ? ' is-warn' : '') + '"><i>' + mark + '</i><b>' + NAMES[n] + '</b><small>' + sm + '</small></button>'; }).join('');
    if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; }
    const hd = $('e2Head'); if (hd) { const ht = '<b>' + step + ' ' + NAMES[step] + '</b><span>' + s[step].s.replace(/</g, '&lt;') + '</span>'; if (hd.dataset.h !== ht) { hd.dataset.h = ht; hd.innerHTML = ht; } }
    const pv = $('e2Prev'), nv = $('e2Next'); if (pv.disabled !== (step <= 1)) pv.disabled = step <= 1; if (nv.disabled !== (step >= 5)) nv.disabled = step >= 5;
    const nx = $('e2Next'), nt = step < 5 ? '次へ：' + NAMES[step + 1] + ' →' : '次へ'; if (nx.textContent !== nt) nx.textContent = nt;
    const t = (id, to) => { const a = $(id), b = $(to); if (!a || !b) return; const v = a.textContent.replace(/\s+/g, ' ').replace(/^粗利\s*/, '').replace(/\s*粗利\s*/, '  ').trim() || '—'; if (b.textContent !== v) b.textContent = v; };
    t('tot-subtotal', 'e2tSell'); t('tot-cost', 'e2tCost'); t('tot-profit', 'e2tProfit');
  }

  // 右の引き出し：右パネル（右レール）のモジュールを開く／同じものをもう一度押すと閉じる
  // 合計バーのボタンを「押された見た目」に：費用の内訳＝費用・金額／参考＝比較など／数量登録＝数量
  function syncDrawerBtns() {
    const on = document.body.classList.contains('e2-drawer') ? (document.body.dataset.e2drawer || '') : '';
    const g = { d: ['digest', 'fin'], s: ['similar', 'compare', 'fcllcl', 'bookmark', 'subcon', 'charges', 'chat'], q: ['scenario'] };
    document.querySelectorAll('#e2Total [data-e2d]').forEach(b => b.classList.toggle('is-open', !!on && (b.dataset.e2d === 'digest' ? g.d : g.s).includes(on)));
    document.querySelectorAll('#e2Total [data-e2q]').forEach(b => b.classList.toggle('is-open', !!on && g.q.includes(on)));
  }
  document.addEventListener('qrc:close', () => { document.body.classList.remove('e2-drawer'); syncDrawerBtns(); });
  function toggleDrawer(mod) {
    toggleDrawer0(mod); syncDrawerBtns();
  }
  function toggleDrawer0(mod) {
    const open = document.body.classList.contains('e2-drawer'), same = document.body.dataset.e2drawer === mod;
    if (open && same) { document.body.classList.remove('e2-drawer'); return; }
    const btn = document.querySelector('#qrcRail .qrc-rail-btn[data-mod="' + mod + '"]');
    if (btn && !btn.classList.contains('is-on')) btn.click();   // レールの選択を切り替える（パネルの出し分け・読み込みは右レール側）
    document.body.classList.add('e2-drawer'); document.body.dataset.e2drawer = mod;
  }
  function setRail(on, byUser) {
    railOpen = !!on; const tab = $('tab-quote-make');
    if (byUser && wideRail()) { try { localStorage.setItem('fwd.e2Rail', railOpen ? '1' : '0'); } catch (e) {} }
    if (tab) { tab.classList.toggle('e2-rail-open', railOpen); tab.classList.toggle('e2-rail-dock', isDock()); }
    refresh();
  }
  // 広い画面に変わったら開いた状態へ、狭くなったら重ねる表示（しまった状態）へ
  // 画面幅が「広い／狭い」の境目をまたいだときだけ動かす（ドラッグで幅を変えている間、毎回 refresh() で画面全体の CSS を計算し直させない＝重くなる原因だった）
  let lastWide = null;
  const syncRailWidth = () => { if (!isOn() || !built) return; const w = wideRail(); if (w === lastWide) return; lastWide = w; if (w) { if (!railOpen && railPref() !== '0') setRail(true); else setRail(railOpen); } else if (railOpen) setRail(false); };
  window.addEventListener('resize', () => syncRailWidth());
  // 右レールの帯は、ツールバー（保存・PDF）の下に付いて動く（スクロール後も上に隙間ができない）
  let railTopRaf = 0;
  const syncRailTop = () => { railTopRaf = 0; const tb = $('saveToolbar'), tab = $('tab-quote-make'); if (!tb || !tab) return; const r = tb.getBoundingClientRect(); tab.style.setProperty('--e2-rail-top', Math.max(0, Math.round(r.bottom + 8)) + 'px'); };
  const kickRailTop = () => { if (!railTopRaf) railTopRaf = requestAnimationFrame(syncRailTop); };
  window.addEventListener('scroll', kickRailTop, { passive: true }); window.addEventListener('resize', kickRailTop);
  function go(n, quiet) {
    if (n < 1 || n > 5) return;
    step = n; visited[n] = true;
    const tab = $('tab-quote-make'); if (tab) tab.dataset.e2 = String(n);
    [].concat.apply([], Object.values(SECS)).forEach(id => { const s = $(id); if (s) s.classList.remove('e2-show'); });
    SECS[n].forEach(id => { const s = $(id); if (!s) return; s.classList.add('e2-show'); if (s.classList.contains('collapsed') && typeof window.toggleQuoteSection === 'function') { try { window.toggleQuoteSection(id); } catch (e) {} } });
    refresh(); refreshBasics(); refreshTitle();
    if (!quiet) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ⑤リマーク：下の引き出しではなく、ステップの本文としてそのまま入力できるようにする（要素ごと移して、旧画面へ戻すときは引き出しへ返す）
  let remarkHome = null;
  function moveRemark(on) {
    const sec = $('section-remark'); if (!sec) return;
    if (on) {
      const nav = $('e2Nav'); if (!nav || !nav.parentNode) return;
      if (!remarkHome) remarkHome = { p: sec.parentNode, n: sec.nextSibling };
      if (sec.parentNode !== nav.parentNode || sec.nextSibling !== nav) nav.parentNode.insertBefore(sec, nav);
      sec.classList.remove('collapsed');
    } else if (remarkHome) {
      remarkHome.p.insertBefore(sec, remarkHome.n && remarkHome.n.parentNode === remarkHome.p ? remarkHome.n : null);
      remarkHome = null;
    }
  }
  // 右下の固定ボタン（PDF／プレビュー／保存）を上部ツールバーへ。切り戻すときは元の場所へ
  const phone = () => window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
  // 出力ボタンは［📄 PDF］［📋 プレビュー］［💾 保存］を別々に見せる（以前は PDF を［プレビュー ▾］の中に入れていたが、新人が見つけられなかった＝ボタン配置レビュー）。
  // ここでは、以前の▾メニューが残っていれば元に戻すだけ。［✏️ 編集］は閲覧中だけ保存ボタンの隣に出す（下の syncMode）
  function pvMenu(dock, on) {
    if (on) return;
    const pdf = dock.querySelector('.qad-pdf'); const m = $('e2PvMenu');
    if (m) { const p = m.querySelector('.qad-pdf'); if (p) dock.insertBefore(p, dock.firstChild); m.remove(); }
    const mo = $('e2PvMore'); if (mo) mo.remove();
  }
  // ［✏️ 編集］と［💾 保存］を別のボタンにする：閲覧中は［✏️ 編集を始める］と、押せない［💾 保存］（見た目だけの別ボタン）を出し、本物の保存ボタン（#qadMode）は隠す。
  // 編集中は本物の［💾 保存］だけ出す。#qadMode の文字・動きは cloud.js が決めるので、ここでは書き換えない（書き換えると cloud.js と取り合いになる）
  let modeObs = null;
  function syncMode() {
    const mb = $('qadMode'), dock = $('quoteActionDock'); if (!mb || !dock) return;
    let eb = $('e2EditBtn'), gh = $('e2SaveGhost');
    if (!eb) { eb = document.createElement('button'); eb.type = 'button'; eb.id = 'e2EditBtn'; eb.className = 'qad-btn qad-edit-start'; eb.addEventListener('click', () => { if (!eb.disabled && typeof window.qpDockAction === 'function') window.qpDockAction(); }); dock.insertBefore(eb, mb); }
    if (!gh) { gh = document.createElement('button'); gh.type = 'button'; gh.id = 'e2SaveGhost'; gh.className = 'qad-btn qad-save'; gh.disabled = true; gh.textContent = '💾 保存'; gh.title = '編集を始めると保存できます'; dock.insertBefore(gh, mb); }
    const locked = mb.dataset.e2lock === '1';
    const view = mb.classList.contains('qad-edit') || locked;
    // 閲覧中（ロックでない）だけ［✏️ 編集を始める］（主）。ロック／閲覧のみ権限は［🔒 閲覧のみ］（薄い・押せない）を保存の位置に出す
    H(eb, !view || locked); H(gh, !view);
    if (eb.textContent !== '✏️ 編集を始める') eb.textContent = '✏️ 編集を始める';
    if (eb.disabled) eb.disabled = false;
    const gt = locked ? '🔒 閲覧のみ' : '💾 保存';
    if (gh.textContent !== gt) gh.textContent = gt;
    const ght = locked ? '他の人が編集中、または閲覧のみの権限です' : '編集を始めると保存できます'; if (gh.title !== ght) gh.title = ght;
    // 未保存の点（保存ボタンの右上・編集中で未保存のときだけ）
    const dirty = !view && dirtyNow();
    if (mb.classList.contains('is-dirty') !== dirty) mb.classList.toggle('is-dirty', dirty);
    const tt = dirty ? '未保存の変更があります' : '保存して作業終了';
    if (!view && mb.title !== tt) mb.title = tt;
    // ⑤の「出力する」枠：閲覧中の編集ボタン・保存の薄い表示・未保存の一文
    const out = $('e2Out');
    if (out) {
      const oe = out.querySelector('[data-e2o="edit"]'), os = out.querySelector('[data-e2o="save"]'), ow = out.querySelector('.e2o-warn');
      if (oe) H(oe, !view || locked);
      if (os) { if (os.classList.contains('is-off') !== view) os.classList.toggle('is-off', view); const ot = locked ? '🔒 閲覧のみ' : '💾 保存'; if (os.textContent !== ot) os.textContent = ot; }
      if (ow) H(ow, !dirty);
    }
  }
  const dirtyNow = () => !!(window.quoteIsDirty && window.quoteIsDirty());
  function watchMode() {
    const mb = $('qadMode'); if (!mb || modeObs) return;
    modeObs = new MutationObserver(() => syncMode());
    modeObs.observe(mb, { attributes: true, attributeFilter: ['class'] });
  }
  function unwatchMode() {
    if (modeObs) { modeObs.disconnect(); modeObs = null; }
    ['e2EditBtn', 'e2SaveGhost'].forEach(id => { const e = $(id); if (e) e.remove(); });
    const mb = $('qadMode'); if (mb) { mb.classList.remove('is-dirty'); mb.removeAttribute('title'); mb.title = '閲覧中は編集を開始／編集中は保存して作業終了'; }
  }
  // ステップ⑤の最後に、出力の 3 つのボタン（PDF・プレビュー・保存）をもう一度出す。上のバーのボタンは残したまま、元の関数を呼ぶだけ
  function buildOut() {
    if ($('e2Out')) return;
    const nav = $('e2Nav'); if (!nav || !nav.parentNode) return;
    const out = document.createElement('div'); out.id = 'e2Out';
    out.innerHTML = '<p class="e2o-t">出力する</p><p class="e2o-d">できあがったら、ここから御見積書を出せます。</p>' +
      '<p class="e2o-warn" hidden>● 未保存の変更があります。先に［💾 保存］をおすすめします。</p>' +
      '<div class="e2o-btns"><button type="button" data-e2o="pv" class="e2o-pv">📋 プレビュー</button><button type="button" data-e2o="pdf" class="e2o-pdf">📄 PDF 出力</button><button type="button" data-e2o="files" class="e2o-files" title="見積に添えて送るファイル（3時間）や、案件の資料（14日）を、まとめて見る・置く">📁 案件のファイル</button><button type="button" data-e2o="edit" class="e2o-edit" hidden>✏️ 編集を始める</button><button type="button" data-e2o="save" class="e2o-save">💾 保存</button></div>';
    nav.parentNode.insertBefore(out, nav);
    out.addEventListener('click', e => {
      const b = e.target.closest('[data-e2o]'); if (!b) return;
      if (b.dataset.e2o === 'files') { if (typeof window.cfOpen === 'function') window.cfOpen('send'); else if (window.rmsShowFiles) window.rmsShowFiles(); return; }
      if (b.dataset.e2o === 'edit') { if (typeof window.qpDockAction === 'function') window.qpDockAction(); }
      else if (b.dataset.e2o === 'pdf' && typeof window.quickQuotePdf === 'function') window.quickQuotePdf();
      else if (b.dataset.e2o === 'pv' && typeof window.openQuotePreview === 'function') window.openQuotePreview();
      else if (b.dataset.e2o === 'save') { const mb = $('qadMode'); if (b.classList.contains('is-off')) return; if (mb && !mb.disabled) mb.click(); else if (typeof window.quoteShowToast === 'function') window.quoteShowToast('編集を始めると保存できます（上の［✏️ 編集を始める］）', 'info', 3000); }
    });
  }
  const placeOut = () => { const out = $('e2Out'), nav = $('e2Nav'); if (out && nav && nav.parentNode && out.nextSibling !== nav) nav.parentNode.insertBefore(out, nav); };

  function moveDock(on) {
    const dock = $('quoteActionDock'), tb = $('saveToolbar'); if (!dock || !tb) return;
    if (on && phone()) { pvMenu(dock, true); return; }   // スマホ幅はドックを下に固定のまま、［プレビュー ▾］だけ付ける
    if (on) { if (dock.parentNode === tb && dock.classList.contains('e2-in-toolbar')) return;   // もう上部にある（幅を変えるたびに入れ直すと、画面全体の CSS の計算し直しが起きて重い）
      if (!dockHome) dockHome = { p: dock.parentNode, n: dock.nextSibling }; tb.appendChild(dock); dock.classList.add('e2-in-toolbar'); pvMenu(dock, true); }
    else { pvMenu(dock, false); if (dockHome) { dock.classList.remove('e2-in-toolbar'); dockHome.p.insertBefore(dock, dockHome.n); dockHome = null; } }
  }

  function apply(on) {
    root.classList.toggle('editor-v2', on);
    ls.set(KEY, on ? '1' : '0');
    if (on) { build(); buildOut(); moveDock(true); moveRemark(true); placeOut(); watchMode(); syncMode(); try { window.lcCheck && window.lcCheck(); } catch (e) {} go(step, true); lastWide = null; syncRailWidth(); } else { { const t0 = $('tab-quote-make'); if (t0) t0.classList.remove('e2-rail-open', 'e2-rail-dock'); railOpen = false; } unwatchMode(); { const o = $('e2Out'); if (o) o.remove(); } moveRemark(false); try { window.lcCheck && window.lcCheck(); } catch (e) {} moveDock(false); document.body.classList.remove('e2-drawer'); const tab = $('tab-quote-make'); if (tab) delete tab.dataset.e2; try { window.rmsClose && 0; } catch (e) {} }
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
    const lab = document.createElement('p'); lab.className = 'hdr-panel-label'; lab.textContent = '画面の切替';
    // Design 42-6：旧い画面は動く状態を保つだけ（新しい機能・見た目の改修は新しい画面だけ）
    const note = document.createElement('p'); note.id = 'hdrEditorV2Note'; note.className = 'hdr-panel-note';
    note.textContent = '旧い画面では一部の新しい機能は使えません';
    panel.appendChild(lab); panel.appendChild(b); panel.appendChild(note); syncBtn(); return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    let tries = 0; const t = setInterval(() => { if (addMenuBtn() || ++tries > 20) clearInterval(t); }, 300);
    if (isOn()) { build(); buildOut(); moveDock(true); moveRemark(true); placeOut(); watchMode(); syncMode(); try { window.lcCheck && window.lcCheck(); } catch (e) {} go(1, true); lastWide = null; syncRailWidth(); }
    // 入力のたびに要約・合計を更新（軽く間引く）
    let raf = 0; const kick = () => { if (!isOn()) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(refresh); };
    window.addEventListener('resize', () => { if (isOn()) moveDock(true); });
    document.addEventListener('input', kick, true); document.addEventListener('change', kick, true);
    new MutationObserver(ms => { if (ms.some(m => !(m.target.closest && m.target.closest('#e2Steps, #e2Total, #e2Nav')))) kick(); }).observe(document.getElementById('tab-quote-make') || document.body, { childList: true, subtree: true, characterData: true });
  });
})();
