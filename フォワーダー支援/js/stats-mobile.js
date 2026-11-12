// 統計画面のスマホ版（Design 案B「今日の確認」・2026-11・第1回）。
// 〜600px のときだけ、既存の #tab-stats（タブ 14 個・数字カード・各ペイン）の上に薄い表示層を足す。
// 既存の DOM・id・onclick は変えず、CSS（css/stats-mobile.css）で「今日の確認」か「中身」のどちらかを出し分ける。
//  ・今日の確認：カード 3 枚（ゆらぎ／粗利率の低い明細／受注率と失注）＋「すべての集計を選ぶ」
//  ・集計を選ぶシート：名寄せ／分析／指標の 3 系統から 14 タブを選ぶ（statsSetPane をそのまま呼ぶ）
//  ・書き込みの確認シート：☆登録・→別名にする は、押すと下から確認シート（実行後に「元に戻す」を数秒出す）
// 数字は stats.js の window.statsTodaySummary()（読み取りだけ）から取る。
(function () {
  'use strict';
  const mq = window.matchMedia('(max-width: 600px)');
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GROUPS = [
    ['名寄せ', [['sv', 'サブコン'], ['carrier', 'キャリア'], ['customer', 'お客様'], ['nm', '品名'], ['un', '単位'], ['charges', 'チャージ']]],
    ['分析', [['svport', 'サブコン×港'], ['custitem', 'お客様×品名'], ['ledger', '明細台帳'], ['margindiff', 'マージンばらつき'], ['winrate', '受注分析'], ['pattern', 'パターン別']]],
    ['指標', [['data', 'データ'], ['kpi', 'KPI']]],
  ];
  const LABEL = {}; GROUPS.forEach(g => g[1].forEach(t => { LABEL[t[0]] = t[1]; }));
  let view = 'home', cur = 'sv', inited = false;

  function root() { return $('tab-stats'); }
  function mobile() { return mq.matches; }

  function build() {
    const r = root(); if (!r || $('smHome')) return;
    const home = document.createElement('div'); home.id = 'smHome'; home.className = 'sm-home';
    const bar = document.createElement('div'); bar.id = 'smBar'; bar.className = 'sm-bar';
    bar.innerHTML = '<button type="button" class="sm-back" id="smBack">‹ 今日の確認へ</button><b class="sm-cur" id="smCur"></b><button type="button" class="sm-pick" id="smPick">集計を選ぶ ▾</button>';
    const tool = r.querySelector('.stats-toolbar');
    (tool || r.firstElementChild).after(bar); bar.after(home);
    home.addEventListener('click', onHomeClick);
    bar.addEventListener('click', e => {
      if (e.target.closest('#smBack')) show('home');
      else if (e.target.closest('#smPick')) openSheet();
    });
  }

  function show(v) {
    view = v;
    const r = root(); if (!r) return;
    r.classList.toggle('sm-on', mobile());
    r.classList.toggle('sm-view-home', mobile() && v === 'home');
    r.classList.toggle('sm-view-pane', mobile() && v === 'pane');
    const c = $('smCur'); if (c) c.textContent = LABEL[cur] || '';
    if (v === 'home') render();
    try { window.scrollTo({ top: 0 }); } catch (e) {}
  }

  function open(id) {
    cur = id;
    if (typeof window.statsSetPane === 'function') window.statsSetPane(id);
    show('pane');
  }

  function card(go, icon, title, sub, tone) {
    return '<button type="button" class="sm-act' + (tone ? ' is-' + tone : '') + '" data-go="' + go + '"><span class="sm-ico">' + icon + '</span>' +
      '<span class="sm-body"><b>' + title + '</b><span class="sm-sub">' + sub + '</span></span><span class="sm-chev">›</span></button>';
  }
  function render() {
    const h = $('smHome'); if (!h) return;
    const S = typeof window.statsTodaySummary === 'function' ? window.statsTodaySummary() : null;
    if (!S) { h.innerHTML = '<p class="sm-note">集計しています…（🔄 を押すと更新します）</p>'; return; }
    const th = S.low.th, w = S.win;
    const low = S.low.n
      ? card('ledger', '⚠', '粗利率の低い明細', th + '%未満 ' + S.low.n + '件' + (S.low.worst ? '（' + esc(S.low.worst.nm) + ' ' + Math.round(S.low.worst.margin) + '%）' : ''), 'warn')
      : card('ledger', '✅', '粗利率の低い明細', th + '%未満はありません');
    const name = (S.unorg || S.blur)
      ? card('sv', '🏢', '名前のゆらぎを整理', '未整理 ' + S.unorg + '件・ゆらぎ ' + S.blur + '件', 'warn')
      : card('sv', '✅', '名前のゆらぎを整理', '整理が必要な名前はありません');
    const win = w.sent
      ? card('winrate', '🎲', '受注率 ' + (w.rate == null ? '—' : w.rate + '%') + '　失注 ' + w.lost + '件',
        w.topReason ? '失注の最多は「' + esc(w.topReason) + '」' + w.topN + '件（失注理由が入っている案件のみ）' : (w.lost ? '失注理由が入っている案件がまだありません' : '失注はありません'))
      : card('winrate', '🎲', '受注率', '提示後の案件がまだありません');
    h.innerHTML = '<b class="sm-h">今日、見ておきたいこと</b>' + name + low + win +
      '<b class="sm-h2">ほかの集計</b><div class="sm-list"><button type="button" class="sm-row" id="smAll"><span>すべての集計を選ぶ（14）</span><span>›</span></button></div>' +
      '<div class="sm-set">粗利率の基準：<button type="button" class="sm-link" id="smTh">' + th + '% 未満を「低い」とする（変更）</button></div>';
    const tha = $('smTh'); if (tha) tha.onclick = changeTh;
    const al = $('smAll'); if (al) al.onclick = openSheet;
  }
  function onHomeClick(e) {
    const b = e.target.closest('[data-go]'); if (!b) return;
    const go = b.getAttribute('data-go');
    if (go === 'ledger' && typeof window.statsLedgerSet === 'function') {   // 粗利率の低い順に並べて開く（先に条件を入れてから画面を作る）
      try { window.statsLedgerSet('sort', 'mlow'); window.statsLedgerSet('status', 'all'); } catch (er) {}
    }
    open(go);
  }
  function changeTh() {
    const cur0 = window.statsLowMarginPct();
    const v = window.prompt('粗利率が何％未満を「低い」としますか（1〜99）', String(cur0));
    if (v == null) return;
    const n = parseFloat(v);
    if (!isFinite(n) || n <= 0 || n >= 100) { toast('1〜99 の数字を入れてください'); return; }
    window.statsLowMarginPct(n); render();
  }

  // ---- 下から出るシート（集計の選択・書き込みの確認 共通） ----
  function sheet(html, cls) {
    closeSheet();
    const o = document.createElement('div'); o.id = 'smSheet'; o.className = 'sm-sheet-wrap';
    o.innerHTML = '<div class="sm-sheet-bg" data-x="1"></div><div class="sm-sheet ' + (cls || '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    o.addEventListener('click', e => { if (e.target.closest('[data-x]')) closeSheet(); });
    document.body.appendChild(o);
    document.body.classList.add('sm-sheet-open');
    return o;
  }
  function closeSheet() {
    const o = $('smSheet'); if (o) o.remove();
    document.body.classList.remove('sm-sheet-open');
  }
  function openSheet() {
    const html = '<div class="sm-sheet-head"><b>見る画面を選ぶ</b><button type="button" class="sm-btn" data-x="1">閉じる</button></div>' +
      GROUPS.map(g => '<div class="sm-grp">' + g[0] + '</div>' + g[1].map(t =>
        '<button type="button" class="sm-row' + (view === 'pane' && cur === t[0] ? ' is-on' : '') + '" data-pane="' + t[0] + '"><span>' + t[1] + '</span><span>' + (view === 'pane' && cur === t[0] ? '✓' : '') + '</span></button>').join('')).join('');
    const o = sheet(html);
    o.addEventListener('click', e => { const b = e.target.closest('[data-pane]'); if (b) { closeSheet(); open(b.getAttribute('data-pane')); } });
  }
  // 書き込みの確認シート：見出し（何を）＋一文（どう変わるか）＋「やめる／実行」
  function confirmSheet(title, line, okLabel, onOk) {
    const o = sheet('<div class="sm-sheet-head"><b>' + esc(title) + '</b></div><p class="sm-line">' + esc(line) + '</p>' +
      '<div class="sm-btns"><button type="button" class="sm-btn" data-x="1">やめる</button><button type="button" class="sm-btn is-main" id="smOk">' + esc(okLabel || '実行') + '</button></div>', 'is-confirm');
    $('smOk').onclick = () => { closeSheet(); onOk(); };
    return o;
  }
  // 実行後に数秒出す「元に戻す」
  let undoT = null;
  function undoBar(msg, undo) {
    const o0 = $('smUndo'); if (o0) o0.remove(); clearTimeout(undoT);
    const o = document.createElement('div'); o.id = 'smUndo'; o.className = 'sm-undo';
    o.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button" id="smUndoBtn">元に戻す</button>' : '');
    document.body.appendChild(o);
    const b = $('smUndoBtn'); if (b) b.onclick = () => { o.remove(); clearTimeout(undoT); undo(); };
    undoT = setTimeout(() => o.remove(), 6000);
  }
  function toast(m) { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, 'warn'); }

  // ---- ☆登録／→別名にする をスマホ幅だけ確認シート経由にする（PC の動作は変えない） ----
  function wrapWrites() {
    const tv = window.statsToggleVote;
    if (typeof tv === 'function' && !tv.__sm) {
      const w = function (field, value) {
        if (!mobile()) return tv.apply(this, arguments);
        const was = typeof window.statsMasterState === 'function' ? window.statsMasterState(field, value) : 'none';
        const demote = was === 'master';
        confirmSheet(demote ? '「' + value + '」のマスター登録を外しますか？' : '「' + value + '」をマスターに登録しますか？',
          demote ? '正しい名前の一覧から外れます（過去の案件は変わりません）。' : '登録すると、見積入力で選べる正しい名前になります（過去の案件は変わりません）。',
          demote ? '外す' : '登録する', async () => {
            await tv.call(this, field, value);
            const now = typeof window.statsMasterState === 'function' ? window.statsMasterState(field, value) : '';
            // 承認制のメンバーは「申請」になるので、元に戻すは出さない
            if (!demote && now === 'master') undoBar('「' + value + '」をマスターに登録しました', () => tv.call(this, field, value));
            else if (demote) undoBar('「' + value + '」のマスター登録を外しました', () => tv.call(this, field, value));
          });
      };
      w.__sm = true; window.statsToggleVote = w;
    }
    const cm = window.statsSynConfirmMerge;
    if (typeof cm === 'function' && !cm.__sm) {
      const w2 = function (field, value, btn) {
        if (!mobile()) return cm.apply(this, arguments);
        const sel = btn && btn.closest('.stats-syn-picker') && btn.closest('.stats-syn-picker').querySelector('select');
        const target = sel && sel.value; if (!target || target === value) return;
        confirmSheet('「' + value + '」を「' + target + '」の別名にしますか？', '件数は「' + target + '」にまとめて数えます（過去の案件は書き換えません）。', '別名にする', async () => {
          await cm.call(this, field, value, btn);
          const rm = window.synRemoveAlias;
          const st = typeof window.statsMasterState === 'function' ? window.statsMasterState(field, value) : '';
          // 承認制で申請になったときは元に戻せない（申請の取り消しは申請一覧から）
          if (typeof rm === 'function' && st !== 'pending') undoBar('「' + value + '」を別名にしました', () => rm(field, value, target));
        });
      };
      w2.__sm = true; window.statsSynConfirmMerge = w2;
    }
  }


  // ---- 名寄せの画面：絞り込みチップ（すべて／未整理のみ N／ゆらぎあり N）。既存の 2 つのチェックを操作するだけ ----
  const NAME_PANES = ['sv', 'carrier', 'customer', 'nm', 'un', 'port'];
  function injectFilter(paneKey) {
    const pane = $('statsPane-' + paneKey); if (!pane || !mobile()) return;
    const un = pane.querySelector('.sm-f-unorg input'), fl = pane.querySelector('.sm-f-fluct input');
    let bar = pane.querySelector(':scope > .sm-fbar');
    if (!un || !fl) { if (bar) bar.remove(); return; }
    const S = typeof window.statsTodaySummary === 'function' ? window.statsTodaySummary({ names: true }) : null;
    const c = (S && S.byPane && S.byPane[paneKey]) || null;
    const all = !un.checked && !fl.checked;
    const html = '<button type="button" class="sm-fchip" data-f="all" aria-pressed="' + all + '">すべて</button>' +
      '<button type="button" class="sm-fchip" data-f="unorg" aria-pressed="' + un.checked + '">未整理のみ' + (c ? ' ' + c.unorg : '') + '</button>' +
      '<button type="button" class="sm-fchip" data-f="fluct" aria-pressed="' + fl.checked + '">ゆらぎあり' + (c ? ' ' + c.blur : '') + '</button>';
    if (bar && bar.dataset.h === html) return;
    if (!bar) { bar = document.createElement('div'); bar.className = 'sm-fbar'; pane.insertBefore(bar, pane.firstChild); bar.addEventListener('click', e => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      const p2 = pane, u = p2.querySelector('.sm-f-unorg input'), f2 = p2.querySelector('.sm-f-fluct input'); if (!u || !f2) return;
      const k = b.getAttribute('data-f');
      if (k === 'all') { if (u.checked) u.click(); const f3 = (p2.querySelector('.sm-f-fluct input')); if (f3 && f3.checked) f3.click(); }
      else if (k === 'unorg') { if (f2.checked) { f2.click(); } const u2 = $('statsPane-' + paneKey).querySelector('.sm-f-unorg input'); if (u2) u2.click(); }
      else { if (u.checked) { u.click(); } const f4 = $('statsPane-' + paneKey).querySelector('.sm-f-fluct input'); if (f4) f4.click(); }
    }); }
    bar.dataset.h = html; bar.innerHTML = html;
  }
  let moT = null;
  function watchPanes() {
    NAME_PANES.forEach(k => {
      const pane = $('statsPane-' + k); if (!pane || pane.__smMo) return; pane.__smMo = true;
      new MutationObserver(() => { clearTimeout(moT); moT = setTimeout(() => injectFilter(k), 30); }).observe(pane, { childList: true });
    });
  }

  // stats.js が集計を終えたとき（案件・マスターの読み込み後など）に今日の確認を更新する
  window.smOnStatsReady = function () { if (inited && mobile() && view === 'home') render(); };
  window.smShowHome = function () { if (!inited) init(); show('home'); };

  function init() {
    if (inited) return;
    build(); wrapWrites(); watchPanes(); inited = true; show('home');
  }
  function onMq() { const r = root(); if (!r) return; if (!mobile()) { r.classList.remove('sm-on', 'sm-view-home', 'sm-view-pane'); closeSheet(); } else { init(); show(view); } }
  if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);

  // 統計タブを開くたび（initStatsTab）に、スマホ幅なら「今日の確認」から入る
  function hook() {
    const it = window.initStatsTab;
    if (typeof it !== 'function' || it.__sm) return false;
    const w = async function () {
      if (mobile()) { init(); view = 'home'; show('home'); }
      const r = await it.apply(this, arguments);
      if (mobile()) { cur = 'sv'; show('home'); }
      return r;
    };
    w.__sm = true; window.initStatsTab = w; return true;
  }
  function boot() { hook(); wrapWrites(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('load', boot);
})();
