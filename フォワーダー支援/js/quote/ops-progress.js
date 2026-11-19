/* 📦 受注後の業務の進捗（ops-progress.js・2026-11）
 * 受注した案件ごとに「ブッキング → SI 提出 → 通関 → 出港 → B/L → 請求」のような作業のチェックリストを持ち、
 * どこまで済んだか・次は何か・期限はいつかをダッシュボードで見られるようにする。
 *  - 保存先：案件データ fields の `qf-ops`（JSON・SQL 不要）。{ v:1, tpl:'exp-fcl', s:[{id, l(作業名), d(済み), at, by, due}] }
 *    まだ一度も触っていない案件は、輸出入の向き（cond-direction）と輸送モード（cond-mode）からひな形を出すだけ（保存しない）。
 *  - 書き込み：cloud.js の cloudWriteCaseFields（案件を開かずに fields の一部だけ更新・他メンバーが編集中なら拒否）。
 *  - 表示：①案件カードの札（受注の案件・または記録のある案件）②ダッシュボード上部の帯（進行中・期限切れ・今日まで）
 *    ③チェックリストの画面（#opmModal）④独立したタブ「📦 進行管理」（#tab-ops・進行中／期限切れ／今日まで／7日以内…の一覧）。
 */
(function () {
  'use strict';
  const FIELD = 'qf-ops';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const toast = (m, t, ms) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, t || 'info', ms || 3000); };

  // ---------- ひな形（よくある作業の並び。案件ごとに足す・消す・名前を変えられる） ----------
  const TPL = {
    'exp-fcl': { name: '輸出・海上（FCL）', s: ['ブッキング依頼', 'ブッキング確定（B/K 番号の受領）', 'バンニング・CY 搬入の手配', 'SI（船積指示）の提出', '輸出通関', '本船出港', 'B/L の発行・送付', '請求書の発行'] },
    'exp-lcl': { name: '輸出・海上（LCL）', s: ['ブッキング依頼', 'ブッキング確定', 'CFS 搬入の手配', 'SI（船積指示）の提出', '輸出通関', '本船出港', 'B/L の発行・送付', '請求書の発行'] },
    'exp-air': { name: '輸出・航空', s: ['ブッキング（スペースの確保）', '搬入の手配', '輸出通関', '搭載・出発', 'AWB の送付', '請求書の発行'] },
    'imp-fcl': { name: '輸入・海上（FCL）', s: ['到着案内（A/N）の受領', '書類の受領（B/L・INV・P/L）', '輸入通関', 'D/O の取得・搬出', '配送', '空コンテナの返却', '請求書の発行'] },
    'imp-lcl': { name: '輸入・海上（LCL）', s: ['到着案内（A/N）の受領', '書類の受領（B/L・INV・P/L）', '輸入通関', '貨物の引き取り（CFS）', '配送', '請求書の発行'] },
    'imp-air': { name: '輸入・航空', s: ['到着案内の受領', '書類の受領（AWB・INV・P/L）', '輸入通関', '貨物の引き取り', '配送', '請求書の発行'] },
    'dom':     { name: '国内の手配', s: ['手配', '実施（集荷・配送など）', '請求書の発行'] },
    'gen':     { name: '一般', s: ['手配（ブッキング）', '書類の準備', '通関', '輸送', '請求書の発行'] },
  };
  function modeKind(mode) {
    mode = String(mode || '');
    if (/航空/.test(mode)) return 'air';
    if (/LCL/i.test(mode)) return 'lcl';
    if (/陸上のみ|国内手配/.test(mode)) return 'dom';
    return 'fcl';   // 海上（FCL・RORO・在来船・海上＋陸上）と未選択
  }
  // 案件データから使うひな形のキー（往復は「往路＋復路」の 2 つ）
  function tplKeysOf(data) {
    const f = (data && data.fields) || {};
    const dir = String(f['cond-direction'] || ''), mk = modeKind(f['cond-mode']);
    if (mk === 'dom') return ['dom'];
    const k = d => d + '-' + mk;
    if (dir === 'export') return [k('exp')];
    if (dir === 'import') return [k('imp')];
    if (dir === 'export_import') return [k('exp'), k('imp')];
    if (dir === 'import_export') return [k('imp'), k('exp')];
    return ['gen'];
  }
  const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function fromTemplate(data) {
    const keys = tplKeysOf(data), two = keys.length > 1;
    const s = [];
    keys.forEach((k, i) => TPL[k].s.forEach(l => s.push({ id: newId(), l: (two ? (i ? '【復路】' : '【往路】') : '') + l, d: false, at: '', by: '', due: '' })));
    return { v: 1, tpl: keys.join('+'), s };
  }
  function tplName(st) { return String((st && st.tpl) || '').split('+').map(k => (TPL[k] || {}).name || '').filter(Boolean).join('＋'); }

  // ---------- 読み取り ----------
  function savedOf(r) {
    try {
      const raw = r && r.data && r.data.fields && r.data.fields[FIELD];
      if (!raw) return null;
      const v = JSON.parse(raw);
      return v && Array.isArray(v.s) ? v : null;
    } catch (e) { return null; }
  }
  const statusOf = r => String((r && (r.status || (r.data && r.data.fields && r.data.fields['qf-status']))) || '').trim();
  // 進捗を出す案件：受注の案件、または（受注を取り消したあとでも）記録がある案件
  const isTarget = r => statusOf(r) === '受注' || !!savedOf(r);
  const stateOf = r => savedOf(r) || fromTemplate(r && r.data);
  const todayStr = () => { const t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
  function summary(st) {
    const total = st.s.length, done = st.s.filter(x => x.d).length;
    const next = st.s.find(x => !x.d) || null;
    const today = todayStr();
    const overdue = st.s.filter(x => !x.d && x.due && x.due < today).length;
    const dueToday = st.s.filter(x => !x.d && x.due === today).length;
    // 期限の近い未完了の作業（期限のあるもののうち最も早い）
    const dues = st.s.filter(x => !x.d && x.due).map(x => x.due).sort();
    return { total, done, next, overdue, dueToday, nearest: dues[0] || '', all: total > 0 && done === total };
  }
  const md = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? (+m[2]) + '/' + (+m[3]) : ''; };
  function whenText(iso) {
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return (d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '/' : '') + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  const nameOf = e => (e && typeof window.cloudNameFor === 'function') ? (window.cloudNameFor(e) || e) : (e || '');
  const rowsAll = () => (typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []);
  const rowById = id => rowsAll().find(r => r.id === id);
  const caseTitle = r => {
    const f = (r && r.data && r.data.fields) || {};
    const memo = String(f['qf-case-name'] || '').trim() || String(f['qf-memo'] || '').split('\n')[0].trim();
    return [f['qf-ref'] || r.ref || '', memo || r.name || ''].filter(Boolean).join(' / ');
  };
  const dueCls = (due, today) => !due ? '' : (due < today ? ' is-over' : (due === today ? ' is-today' : ''));

  // ---------- ①案件カードの札 ----------
  function opsCardHtml(r) {
    if (!isTarget(r)) return '';
    const st = stateOf(r), sm = summary(st), started = !!savedOf(r);
    const idAttr = encodeURIComponent(r.id).replace(/'/g, '%27');
    const today = todayStr();
    const segs = st.s.map(x => '<i class="' + (x.d ? 'is-done' : (x.due && x.due < today ? 'is-over' : '')) + '"></i>').join('');
    let nextH;
    if (sm.all) nextH = '<span class="ops-next is-all">✅ すべて完了</span>';
    else if (!sm.total) nextH = '<span class="ops-next">作業がありません</span>';
    else nextH = '<span class="ops-next">次：<b>' + esc(sm.next.l) + '</b>' + (sm.next.due ? '<span class="ops-due' + dueCls(sm.next.due, today) + '">期限 ' + md(sm.next.due) + '</span>' : '') + '</span>';
    const warn = sm.overdue ? '<span class="ops-warn">⚠ 期限切れ ' + sm.overdue + '</span>' : '';
    return '<div class="ops-card' + (sm.all ? ' is-all' : '') + (sm.overdue ? ' has-over' : '') + '">' +
      '<button type="button" class="ops-chip" onclick="event.stopPropagation();opsOpen(\'' + idAttr + '\')" title="受注後の業務の進み具合（押すとチェックリストを開きます）">' +
        '<span class="ops-lbl">📦 業務</span><span class="ops-segs" aria-hidden="true">' + segs + '</span>' +
        '<span class="ops-n">' + sm.done + '/' + sm.total + '</span>' + nextH + warn +
        (started ? '' : '<span class="ops-new">未着手</span>') +
      '</button></div>';
  }

  // ---------- 書き込み（同じ案件への書き込みは順番に） ----------
  let _queue = Promise.resolve();
  function save(id, st, comment) {
    const run = async () => {
      if (typeof window.cloudWriteCaseFields !== 'function') return false;
      return window.cloudWriteCaseFields(encodeURIComponent(id), { [FIELD]: JSON.stringify(st) }, { comment: comment || '' });
    };
    const p = _queue.then(run, run);
    _queue = p.catch(() => {});
    return p;
  }

  // ---------- ③チェックリストの画面 ----------
  let _cur = null;   // { id, st }
  function ensureModal() {
    if ($('opmModal')) return;
    const ov = document.createElement('div');
    ov.id = 'opmModal'; ov.className = 'opm-overlay'; ov.hidden = true;
    ov.innerHTML = '<div class="opm-box" role="dialog" aria-modal="true" aria-labelledby="opmTitle">' +
      '<div class="opm-head"><div class="opm-head-t"><b id="opmTitle">📦 受注後の業務</b><small id="opmSub"></small></div>' +
      '<button type="button" class="opm-x" data-opm="close" aria-label="閉じる">✕</button></div>' +
      '<div class="opm-body" id="opmBody"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', e => {
      if (e.target === ov) return close();
      const b = e.target.closest('[data-opm]'); if (!b) return;
      const act = b.dataset.opm, i = +b.dataset.i;
      if (act === 'close') close();
      else if (act === 'toggle') toggle(i);
      else if (act === 'up') move(i, -1);
      else if (act === 'down') move(i, 1);
      else if (act === 'del') del(i);
      else if (act === 'add') add();
      else if (act === 'rename') rename(i);
      else if (act === 'reset') reset();
      else if (act === 'list') { close(); opsGoTab('active'); }
    });
    ov.addEventListener('change', e => {
      const t = e.target;
      if (t.matches('.opm-due')) setDue(+t.dataset.i, t.value);
    });
    ov.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.id === 'opmAddIn' && !e.isComposing) { e.preventDefault(); add(); }
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if ($('opmModal') && !$('opmModal').hidden && !document.querySelector('.confirm-overlay')) { e.stopPropagation(); close(); }
    }, true);
  }
  function readOnly() {
    if (!_cur) return true;
    if (typeof window.cloudIsLoggedIn === 'function' && !window.cloudIsLoggedIn()) return true;
    return !!(typeof window.cloudIsLockedByOther === 'function' && window.cloudIsLockedByOther(_cur.id));
  }
  function render() {
    if (!_cur) return;
    const r = rowById(_cur.id);
    const st = _cur.st, sm = summary(st), ro = readOnly(), today = todayStr();
    const lockedBy = typeof window.cloudIsLockedByOther === 'function' ? window.cloudIsLockedByOther(_cur.id) : null;
    $('opmSub').textContent = r ? (caseTitle(r) + (r.customer ? '　' + r.customer : '')) : '';
    const pct = sm.total ? Math.round(sm.done / sm.total * 100) : 0;
    let h = '<p class="opm-note">受注した案件の、手配から請求までの作業を記録します（チームで共有）。チェックを入れると、日時と名前が残ります。</p>';
    if (lockedBy) h += '<p class="opm-lock">🔒 ' + esc(nameOf(lockedBy)) + ' さんがこの案件を編集中のため、いまは見るだけです。</p>';
    else if (ro) h += '<p class="opm-lock">ログインすると記録できます。</p>';
    h += '<div class="opm-prog"><div class="opm-bar"><span style="width:' + pct + '%"></span></div><b>' + sm.done + ' / ' + sm.total + ' 完了</b>' +
      (sm.overdue ? '<span class="ops-warn">⚠ 期限切れ ' + sm.overdue + '</span>' : '') + (tplName(st) ? '<small>ひな形：' + esc(tplName(st)) + '</small>' : '') + '</div>';
    h += '<ol class="opm-steps">' + st.s.map((x, i) => {
      const isNext = sm.next === x;
      return '<li class="opm-step' + (x.d ? ' is-done' : '') + (isNext ? ' is-next' : '') + '">' +
        '<button type="button" class="opm-chk" data-opm="toggle" data-i="' + i + '" role="checkbox" aria-checked="' + x.d + '"' + (ro ? ' disabled' : '') + ' title="' + (x.d ? '完了を取り消す' : '完了にする') + '">' + (x.d ? '✓' : '') + '</button>' +
        '<div class="opm-step-main"><span class="opm-step-l">' + (isNext ? '<em class="opm-next-tag">次</em>' : '') + esc(x.l) + '</span>' +
          (x.d && x.at ? '<small class="opm-done-by">✓ ' + esc(whenText(x.at)) + (x.by ? ' ' + esc(nameOf(x.by)) : '') + '</small>' : '') + '</div>' +
        (x.d ? '' : '<label class="opm-due-w' + dueCls(x.due, today) + '"><span>期限</span><input type="date" class="opm-due" data-i="' + i + '" value="' + esc(x.due || '') + '"' + (ro ? ' disabled' : '') + '></label>') +
        (ro ? '' : '<span class="opm-tools">' +
          '<button type="button" data-opm="rename" data-i="' + i + '" title="作業名を変える">✎</button>' +
          '<button type="button" data-opm="up" data-i="' + i + '" title="上へ"' + (i ? '' : ' disabled') + '>▲</button>' +
          '<button type="button" data-opm="down" data-i="' + i + '" title="下へ"' + (i < st.s.length - 1 ? '' : ' disabled') + '>▼</button>' +
          '<button type="button" data-opm="del" data-i="' + i + '" title="この作業を消す">✕</button></span>') +
        '</li>';
    }).join('') + '</ol>';
    if (!st.s.length) h += '<p class="opm-empty">作業がありません。下から足してください。</p>';
    if (!ro) h += '<div class="opm-add"><input type="text" id="opmAddIn" maxlength="60" placeholder="作業を追加（例：保険の手配）"><button type="button" class="opm-btn" data-opm="add">＋ 追加</button></div>';
    h += '<div class="opm-foot">' + (ro ? '' : '<button type="button" class="opm-link" data-opm="reset">ひな形から作り直す…</button>') +
      '<button type="button" class="opm-link" data-opm="list">📦 進行管理で一覧を見る</button>' +
      '<button type="button" class="opm-btn opm-btn-pri" data-opm="close">閉じる</button></div>';
    $('opmBody').innerHTML = h;
  }
  async function commit(comment) {
    if (!_cur) return;
    const id = _cur.id, snapshot = JSON.parse(JSON.stringify(_cur.st));
    render();
    const ok = await save(id, snapshot, comment);
    renderTab();
    if (!ok && _cur && _cur.id === id) {   // 書けなかったら、保存されている内容へ戻す
      const r = rowById(id); _cur.st = r ? stateOf(r) : _cur.st; render();
    }
    return ok;
  }
  function toggle(i) {
    if (readOnly()) return;
    const x = _cur.st.s[i]; if (!x) return;
    const me = typeof window.cloudCurrentEmail === 'function' ? window.cloudCurrentEmail() : '';
    x.d = !x.d;
    if (x.d) { x.at = new Date().toISOString(); x.by = me; } else { x.at = ''; x.by = ''; }
    const sm = summary(_cur.st);
    commit(x.d ? ('✅ 業務：「' + x.l + '」を完了' + (sm.all ? '（すべての作業が完了）' : '')) : '');
  }
  function move(i, d) {
    if (readOnly()) return;
    const s = _cur.st.s, j = i + d; if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]]; commit();
  }
  async function del(i) {
    if (readOnly()) return;
    const x = _cur.st.s[i]; if (!x) return;
    const ok = typeof window.uiConfirm === 'function' ? await window.uiConfirm({ title: '作業を消しますか？', lines: ['「' + x.l + '」をこの案件のチェックリストから消します。'], okLabel: '消す', danger: true }) : true;
    if (!ok || !_cur) return;
    _cur.st.s.splice(i, 1); commit();
  }
  function add() {
    if (readOnly()) return;
    const inp = $('opmAddIn'); const v = (inp && inp.value || '').trim();
    if (!v) { if (inp) inp.focus(); return; }
    _cur.st.s.push({ id: newId(), l: v, d: false, at: '', by: '', due: '' });
    commit().then(() => { const n = $('opmAddIn'); if (n) n.focus(); });
  }
  function rename(i) {
    if (readOnly()) return;
    const li = $('opmBody').querySelectorAll('.opm-step')[i]; const x = _cur.st.s[i]; if (!li || !x) return;
    const span = li.querySelector('.opm-step-l');
    const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'opm-rename'; inp.maxLength = 60; inp.value = x.l;
    span.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const fin = ok => {
      if (done) return; done = true;
      const v = inp.value.trim();
      if (ok && v && v !== x.l) { x.l = v; commit(); } else render();
    };
    inp.addEventListener('keydown', e => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); fin(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fin(false); } });
    inp.addEventListener('blur', () => fin(true));
  }
  function setDue(i, v) {
    if (readOnly()) return;
    const x = _cur.st.s[i]; if (!x) return;
    x.due = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; commit();
  }
  async function reset() {
    if (readOnly()) return;
    const r = rowById(_cur.id);
    const nt = fromTemplate(r && r.data);
    const ok = typeof window.uiConfirm === 'function' ? await window.uiConfirm({ title: 'ひな形から作り直しますか？', lines: ['いまのチェックリスト（完了の記録・期限を含む）を消して、「' + (tplName(nt) || '一般') + '」のひな形に戻します。', '貿易条件の向き・輸送モードを変えたときに使います。'], okLabel: '作り直す', danger: true }) : true;
    if (!ok || !_cur) return;
    _cur.st = nt; commit('📦 業務のチェックリストをひな形から作り直しました');
  }
  function opsOpen(idAttr) {
    const id = decodeURIComponent(idAttr), r = rowById(id);
    if (!r) { toast('⚠️ 案件が見つかりません', 'warn'); return; }
    ensureModal();
    _cur = { id, st: JSON.parse(JSON.stringify(stateOf(r))) };
    render();
    $('opmModal').hidden = false;
    document.body.classList.add('opm-open');
    const f = $('opmModal').querySelector('.opm-chk:not([disabled])') || $('opmModal').querySelector('.opm-x'); if (f) f.focus();
  }
  function close() {
    if ($('opmModal')) $('opmModal').hidden = true;
    document.body.classList.remove('opm-open');
    _cur = null;
  }

  // ---------- ②ダッシュボード上部の帯（押すと「進行管理」タブへ） ----------
  function collect() {
    return rowsAll().filter(isTarget).map(r => { const st = stateOf(r); return { r, st, sm: summary(st) }; });
  }
  function weekStr() { const t = new Date(); t.setDate(t.getDate() + 7); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
  function groupsOf(all) {
    const today = todayStr(), wk = weekStr();
    const active = all.filter(x => !x.sm.all);
    return {
      active,
      over: active.filter(x => x.sm.overdue),
      today: active.filter(x => !x.sm.overdue && x.sm.dueToday),
      week: active.filter(x => !x.sm.overdue && x.sm.nearest && x.sm.nearest <= wk),
      nodue: active.filter(x => !x.sm.nearest),
      done: all.filter(x => x.sm.all),
      all,
      _today: today,
    };
  }
  function renderBand() {
    const dash = $('qpDashboard'); if (!dash) return;
    let band = $('opsBand');
    if (!band) {
      band = document.createElement('div'); band.id = 'opsBand'; band.className = 'ops-band'; band.setAttribute('role', 'group'); band.setAttribute('aria-label', '受注後の業務');
      const anchor = $('dtFollow') || $('dtChips');
      if (anchor) anchor.after(band);
      else { const lw = $('qpdListWrap'); if (!lw) return; lw.before(band); }
      band.addEventListener('click', e => { const b = e.target.closest('[data-ops-list]'); if (b) opsGoTab(b.dataset.opsList); });
    }
    const g = groupsOf(collect());
    if (!g.all.length) { band.hidden = true; band.innerHTML = ''; return; }
    band.hidden = false;
    band.innerHTML = '<span class="ops-band-l" title="受注した案件の、手配から請求までの作業の進み具合">📦 受注後の業務</span>' +
      '<button type="button" class="ops-band-b" data-ops-list="active">進行中 <b>' + g.active.length + '</b></button>' +
      (g.over.length ? '<button type="button" class="ops-band-b is-over" data-ops-list="over">⚠ 期限切れ <b>' + g.over.length + '</b></button>' : '') +
      (g.today.length ? '<button type="button" class="ops-band-b is-today" data-ops-list="today">今日まで <b>' + g.today.length + '</b></button>' : '') +
      '<button type="button" class="ops-band-b" data-ops-list="done">完了 <b>' + g.done.length + '</b></button>' +
      '<button type="button" class="ops-band-go" data-ops-list="active">進行管理を開く ›</button>';
  }

  // ---------- ④「📦 進行管理」タブ（#tab-ops・独立した画面） ----------
  const TAB = { f: 'active', q: '', sort: 'due', loading: false, asked: false };
  const FILTERS = [['active', '進行中'], ['over', '⚠ 期限切れ'], ['today', '今日まで'], ['week', '7日以内'], ['nodue', '期限なし'], ['done', '完了'], ['all', 'すべて']];
  const SORTS = [['due', '期限の近い順'], ['progress', '進み具合の少ない順'], ['updated', '更新が新しい順'], ['name', '案件名順']];
  const tabActive = () => { const t = $('tab-ops'); return !!(t && t.classList.contains('active')); };
  const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  function sortRows(list) {
    const k = TAB.sort;
    return list.slice().sort((a, b) => {
      if (k === 'progress') return (a.sm.done / (a.sm.total || 1)) - (b.sm.done / (b.sm.total || 1));
      if (k === 'updated') return String(b.r.updated_at || '').localeCompare(String(a.r.updated_at || ''));
      if (k === 'name') return caseTitle(a.r).localeCompare(caseTitle(b.r), 'ja');
      return (b.sm.overdue ? 1 : 0) - (a.sm.overdue ? 1 : 0) || (a.sm.nearest || '9999').localeCompare(b.sm.nearest || '9999') ||
        (a.sm.all ? 1 : 0) - (b.sm.all ? 1 : 0);
    });
  }
  function ensureTab() {
    const root = $('opsRoot'); if (!root || root.dataset.wired) return root;
    root.dataset.wired = '1';
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-opt]'); if (!b) return;
      const a = b.dataset.opt, id = b.dataset.id;
      if (a === 'f') { TAB.f = b.dataset.f; renderTab(); }
      else if (a === 'list') opsOpen(id);
      else if (a === 'quote') openQuote(id);
      else if (a === 'next') quickDone(id, b);
      else if (a === 'dash') goDash();
      else if (a === 'reload') reload();
    });
    root.addEventListener('input', e => { if (e.target.id === 'optQ' && !e.isComposing) { TAB.q = e.target.value; renderTab(true); } });
    root.addEventListener('compositionend', e => { if (e.target.id === 'optQ') { TAB.q = e.target.value; renderTab(true); } });
    root.addEventListener('change', e => { if (e.target.id === 'optSort') { TAB.sort = e.target.value; renderTab(); } });
    return root;
  }
  function renderTab(keepSearch) {
    const root = ensureTab(); if (!root || !tabActive()) return;
    const logged = typeof window.cloudIsLoggedIn === 'function' && window.cloudIsLoggedIn();
    if (!logged) {
      root.innerHTML = '<div class="opt-head"><h2>📦 進行管理</h2></div><div class="opt-empty">ログインすると、受注した案件の作業の進み具合を見られます。<br><small>右上の「ログイン」からどうぞ。</small></div>';
      return;
    }
    const all = collect();
    if (!all.length && !rowsAll().length && !TAB.asked && typeof window.cloudListPresets === 'function') {   // まだ案件一覧を読んでいない（見積タブを開いていない）
      TAB.asked = true; TAB.loading = true;
      Promise.resolve(window.cloudListPresets(true)).catch(() => {}).then(() => { TAB.loading = false; renderTab(); });
    }
    const g = groupsOf(all), today = g._today;
    const q = norm(TAB.q);
    let list = g[TAB.f] || g.active;
    if (q) list = list.filter(x => norm(caseTitle(x.r) + ' ' + (x.r.customer || '') + ' ' + x.st.s.map(s => s.l).join(' ')).includes(q));
    list = sortRows(list);
    const tile = (k, lbl, n, cls) => '<button type="button" class="opt-tile' + (cls ? ' ' + cls : '') + (TAB.f === k ? ' is-on' : '') + '" data-opt="f" data-f="' + k + '" aria-pressed="' + (TAB.f === k) + '"><span>' + lbl + '</span><b>' + n + '</b></button>';
    let h = '<div class="opt-head"><div><h2>📦 進行管理</h2><p class="opt-lead">受注した案件の、手配から請求までの作業を一覧で見ます。チェックリストは案件ごとに、見積ダッシュボードのカードからも開けます。</p></div>' +
      '<div class="opt-head-acts"><button type="button" class="opt-btn" data-opt="reload" title="最新の状態に読み直す">↻ 更新</button><button type="button" class="opt-btn" data-opt="dash">💼 見積ダッシュボードへ</button></div></div>';
    h += '<div class="opt-tiles" role="group" aria-label="絞り込み">' +
      tile('active', '進行中', g.active.length) + tile('over', '⚠ 期限切れ', g.over.length, g.over.length ? 'is-over' : '') +
      tile('today', '今日まで', g.today.length, g.today.length ? 'is-today' : '') + tile('week', '7日以内', g.week.length) +
      tile('done', '完了', g.done.length, 'is-done') + '</div>';
    h += '<div class="opt-bar"><div class="opt-chips">' + FILTERS.filter(f => !['active', 'over', 'today', 'week', 'done'].includes(f[0])).map(f =>
        '<button type="button" class="opt-chip' + (TAB.f === f[0] ? ' is-on' : '') + '" data-opt="f" data-f="' + f[0] + '" aria-pressed="' + (TAB.f === f[0]) + '">' + f[1] + ' <b>' + g[f[0]].length + '</b></button>').join('') + '</div>' +
      '<input type="search" id="optQ" class="opt-q" placeholder="🔍 案件名・お客様・作業名で探す" value="' + esc(TAB.q) + '" aria-label="検索">' +
      '<label class="opt-sort"><span>並び順</span><select id="optSort">' + SORTS.map(s => '<option value="' + s[0] + '"' + (TAB.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>').join('') + '</select></label></div>';
    if (TAB.loading && !all.length) h += '<div class="opt-empty">読み込み中…</div>';
    else if (!all.length) h += '<div class="opt-empty">まだ受注した案件はありません。<br><small>見積ダッシュボードで案件のステータスを「受注」にすると、ここに作業のチェックリストが出ます。</small><br><button type="button" class="opt-btn opt-btn-pri" data-opt="dash">💼 見積ダッシュボードへ</button></div>';
    else if (!list.length) h += '<div class="opt-empty">当てはまる案件はありません。</div>';
    else h += '<ul class="opt-list">' + list.map(x => rowHtml(x, today)).join('') + '</ul>';
    const hadFocus = document.activeElement && document.activeElement.id === 'optQ';
    const pos = hadFocus ? document.activeElement.selectionStart : 0;
    root.innerHTML = h;
    if (hadFocus || keepSearch) { const qi = $('optQ'); if (qi && hadFocus) { qi.focus(); try { qi.setSelectionRange(pos, pos); } catch (e) {} } }
  }
  function rowHtml(x, today) {
    const r = x.r, sm = x.sm, id = esc(encodeURIComponent(r.id));
    const f = (r.data && r.data.fields) || {};
    const lockedBy = typeof window.cloudIsLockedByOther === 'function' ? window.cloudIsLockedByOther(r.id) : null;
    const segs = x.st.s.map(s => '<i class="' + (s.d ? 'is-done' : (s.due && s.due < today ? 'is-over' : '')) + '" title="' + esc(s.l + (s.d ? '（済み）' : (s.due ? '（期限 ' + md(s.due) + '）' : ''))) + '"></i>').join('');
    const nx = sm.next;
    const meta = [r.customer || '', f['cond-mode'] || '', savedOf(r) ? '' : '未着手'].filter(Boolean);
    return '<li class="opt-row' + (sm.all ? ' is-all' : '') + (sm.overdue ? ' has-over' : '') + '">' +
      '<div class="opt-main"><b title="' + esc(caseTitle(r)) + '">' + esc(caseTitle(r) || '（案件名なし）') + '</b><small>' + esc(meta.join(' · ')) + (lockedBy ? ' · 🔒 ' + esc(nameOf(lockedBy)) + ' さんが編集中' : '') + '</small></div>' +
      '<div class="opt-prog"><span class="ops-segs" aria-hidden="true">' + segs + '</span><b>' + sm.done + '/' + sm.total + '</b></div>' +
      '<div class="opt-next">' + (sm.all ? '<span class="ops-next is-all">✅ すべて完了</span>' : (nx ? '次：<b>' + esc(nx.l) + '</b>' + (nx.due ? '<span class="ops-due' + dueCls(nx.due, today) + '">期限 ' + md(nx.due) + '</span>' : '') : '')) +
        (sm.overdue ? ' <span class="ops-warn">⚠ 期限切れ ' + sm.overdue + '</span>' : '') + '</div>' +
      '<div class="opt-acts">' +
        (!sm.all && nx && !lockedBy ? '<button type="button" class="opt-btn opt-btn-ok" data-opt="next" data-id="' + id + '" title="「' + esc(nx.l) + '」を完了にする">✓ 次を完了</button>' : '') +
        '<button type="button" class="opt-btn" data-opt="list" data-id="' + id + '">☑ チェックリスト</button>' +
        '<button type="button" class="opt-btn" data-opt="quote" data-id="' + id + '" title="この案件の見積を開く">💼 見積</button>' +
      '</div></li>';
  }
  async function quickDone(idAttr, btn) {
    const id = decodeURIComponent(idAttr), r = rowById(id); if (!r) return;
    const st = JSON.parse(JSON.stringify(stateOf(r))), x = st.s.find(s => !s.d); if (!x) return;
    x.d = true; x.at = new Date().toISOString(); x.by = typeof window.cloudCurrentEmail === 'function' ? window.cloudCurrentEmail() : '';
    if (btn) btn.disabled = true;
    const all = st.s.every(s => s.d);
    const ok = await save(id, st, '✅ 業務：「' + x.l + '」を完了' + (all ? '（すべての作業が完了）' : ''));
    if (ok) toast('✅ 「' + x.l + '」を完了にしました', 'success', 2500);
    renderTab();
  }
  function openQuote(idAttr) {
    const btn = document.querySelector('.cat-btn[aria-controls="tab-quote-make"]');
    if (typeof window.switchCategory === 'function') window.switchCategory('quote', btn);
    setTimeout(() => { if (typeof window.cloudLoadPreset === 'function') window.cloudLoadPreset(idAttr); }, 0);
  }
  function goDash() {
    const btn = document.querySelector('.cat-btn[aria-controls="tab-quote-make"]');
    if (typeof window.switchCategory === 'function') window.switchCategory('quote', btn);
    if (typeof window.qpShowDashboard === 'function') setTimeout(() => window.qpShowDashboard(), 0);
  }
  async function reload() {
    if (typeof window.cloudListPresets !== 'function') return;
    TAB.loading = true; renderTab();
    try { await window.cloudListPresets(true); } catch (e) {}
    TAB.loading = false; renderTab();
  }
  // ダッシュボードの帯・カードの札から：「進行管理」タブを開いて、その絞り込みにする
  function opsGoTab(filter) {
    if (filter && FILTERS.some(f => f[0] === filter)) TAB.f = filter;
    if (_cur) close();
    const btn = document.querySelector('.cat-btn[aria-controls="tab-ops"]');
    if (typeof window.switchCategory === 'function') window.switchCategory('ops', btn);
    else renderTab();
  }
  window.initOpsTab = function () { renderTab(); };

  // 一覧が描き直されるたび（cloud.js → dtRefresh）に、帯とタブを更新する
  function refreshAll() { renderBand(); renderTab(); }
  function hook() {
    const orig = window.dtRefresh;
    window.dtRefresh = function () { const r = orig ? orig.apply(this, arguments) : undefined; setTimeout(refreshAll, 0); return r; };
  }
  hook();
  document.addEventListener('DOMContentLoaded', () => {
    const lw = $('qpdListWrap');
    if (lw && 'MutationObserver' in window) {
      let t = 0; new MutationObserver(() => { clearTimeout(t); t = setTimeout(refreshAll, 50); }).observe(lw, { childList: true });
    }
  });

  window.opsCardHtml = opsCardHtml;
  window.opsOpen = opsOpen;
  window.opsGoTab = opsGoTab;
  window.opsOpenList = opsGoTab;   // 互換（以前の一覧モーダルの入口）
  window.opsRenderBand = renderBand;
  window.opsRenderTab = renderTab;
  window.opsTemplateKeys = tplKeysOf;   // 試験・ほかの機能から
  window.opsSummaryOf = r => (isTarget(r) ? summary(stateOf(r)) : null);
})();
