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
    'imp-fcl': { name: '輸入・海上（FCL）', s: ['到着案内（A/N）の受領', '本船の入港（到着）', '書類の受領（B/L・INV・P/L）', '輸入通関', 'D/O の取得・搬出', '配送', '空コンテナの返却', '請求書の発行'] },
    'imp-lcl': { name: '輸入・海上（LCL）', s: ['到着案内（A/N）の受領', '本船の入港（到着）', '書類の受領（B/L・INV・P/L）', '輸入通関', '貨物の引き取り（CFS）', '配送', '請求書の発行'] },
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
  const AUTO_BY = 'auto:colins';   // サイバーポートの自動確認（COLINS の実績）で入ったチェックの印
  const nameOf = e => e === AUTO_BY ? '🛰 サイバーポート（自動）' : (e && typeof window.cloudNameFor === 'function') ? (window.cloudNameFor(e) || e) : (e || '');
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
  let _cur = null;   // 見積の進行＝{ id, st }／見積なしの進行＝{ kind:'job', jobId, shipId, st }
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
      if ($('opmModal') && !$('opmModal').hidden && !document.querySelector('.confirm-overlay')) { e.stopPropagation(); e.__opsHandled = true; close(); }
    }, true);
  }
  function readOnly() {
    if (!_cur) return true;
    if (typeof window.cloudIsLoggedIn === 'function' && !window.cloudIsLoggedIn()) return true;
    if (_cur.kind === 'job') return false;
    return !!(typeof window.cloudIsLockedByOther === 'function' && window.cloudIsLockedByOther(_cur.id));
  }
  function render() {
    if (!_cur) return;
    const isJob = _cur.kind === 'job';
    const r = isJob ? null : rowById(_cur.id);
    const st = _cur.st, sm = summary(st), ro = readOnly(), today = todayStr();
    const lockedBy = (!isJob && typeof window.cloudIsLockedByOther === 'function') ? window.cloudIsLockedByOther(_cur.id) : null;
    if (isJob) {
      const j = jobById(_cur.jobId), sh = j && _cur.shipId ? (j.data.ships || []).find(x => x.id === _cur.shipId) : null;
      $('opmSub').textContent = j ? (KIND_LBL[j.kind] + '　' + (j.title || '') + (sh ? '　' + (sh.label || '') : '') + (j.customer ? '　' + j.customer : '')) : '';
    } else $('opmSub').textContent = r ? (caseTitle(r) + (r.customer ? '　' + r.customer : '')) : '';
    $('opmTitle').textContent = isJob ? '☑ 作業の進み具合' : '📦 受注後の業務';
    const pct = sm.total ? Math.round(sm.done / sm.total * 100) : 0;
    let h = isJob ? '<p class="opm-note">' + (_cur.shipId ? 'この便の' : 'この進行の') + '、手配から請求までの作業を記録します（チームで共有）。チェックを入れると、日時と名前が残ります。</p>' : '<p class="opm-note">受注した案件の、手配から請求までの作業を記録します（チームで共有）。チェックを入れると、日時と名前が残ります。</p>';
    if (!isJob && AUTO.map && AUTO.map.has(_cur.id) || isJob && autoTargetOfJob(jobById(_cur.jobId), _cur.shipId)) h += '<p class="opm-auto">🛰 サイバーポートで追跡中：出港・入港の実績、空コンテナの返却が入ると、当てはまる作業に自動でチェックが入ります（朝夕の自動確認の結果から）。</p>';
    if (lockedBy) h += '<p class="opm-lock">🔒 ' + esc(nameOf(lockedBy)) + ' さんがこの案件を編集中のため、いまは見るだけです。</p>';
    else if (ro) h += '<p class="opm-lock">ログインすると記録できます。</p>';
    h += '<div class="opm-prog"><div class="opm-bar"><span style="width:' + pct + '%"></span></div><b>' + sm.done + ' / ' + sm.total + ' 完了</b>' +
      (sm.overdue ? '<span class="ops-warn">⚠ 期限切れ ' + sm.overdue + '</span>' : '') + (tplName(st) ? '<small>ひな形：' + esc(tplName(st)) + '</small>' : '') + '</div>';
    h += '<ol class="opm-steps">' + st.s.map((x, i) => {
      const isNext = sm.next === x;
      return '<li class="opm-step' + (x.d ? ' is-done' : '') + (isNext ? ' is-next' : '') + '">' +
        '<button type="button" class="opm-chk" data-opm="toggle" data-i="' + i + '" role="checkbox" aria-checked="' + x.d + '"' + (ro ? ' disabled' : '') + ' title="' + (x.d ? '完了を取り消す' : '完了にする') + '">' + (x.d ? '✓' : '') + '</button>' +
        '<div class="opm-step-main"><span class="opm-step-l">' + (isNext ? '<em class="opm-next-tag">次</em>' : '') + esc(x.l) + '</span>' +
          (x.d && x.at ? '<small class="opm-done-by">✓ ' + esc(whenText(x.at)) + (x.by ? ' ' + esc(nameOf(x.by)) : '') + (x.src ? '（' + esc(x.src) + '）' : '') + '</small>' : '') + '</div>' +
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
    if (_cur.kind === 'job') return commitJobSteps();
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
    x.src = '';   // 自動で入ったチェックを外しても、同じ作業へは二度と自動で入れない（st.ax に残る）
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
    let nt;
    if (_cur.kind === 'job') { const j = jobById(_cur.jobId); nt = fromTemplate(jobTplData(j)); }
    else { const r = rowById(_cur.id); nt = fromTemplate(r && r.data); }
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
    const wasJob = _cur && _cur.kind === 'job' ? _cur.jobId : null;
    _cur = null;
    if (wasJob && $('ojModal') && !$('ojModal').hidden) renderJob();   // 進行の画面の上から開いていたら、そちらを描き直す
    else if (!$('ojModal') || $('ojModal').hidden) document.body.classList.remove('opm-open');
  }

  // ================================================================
  // ---------- 見積とつながらない進行（スポット／レギュラー）＝表 ops_jobs ----------
  // ================================================================
  // 1 行＝1 進行。kind：spot（1 回きり）／regular（同じ料金で繰り返す取引）。status：active（進行中）／done（完了）／archived（しまう）
  // data：{ dir（輸出入の向き）, mode（輸送モード）, route（区間の文字）, note, charges:[{id,name,qty,unit,ccy,price}]（請求料金の控え・1 回あたり）,
  //         st:{v,tpl,s}（スポットのチェックリスト）, ships:[{id,label,date,billed,note,st}]（レギュラーの便・新しい順） }
  // preset_id：紐づけた見積の案件（無ければ null）。SQL は docs/sql/ops-jobs.sql（未実行の間は「見積から」の進行だけ動く）
  const KIND_LBL = { quote: '💼 見積から', spot: '⚡ スポット', regular: '🔁 レギュラー' };
  const DIRS = [['', '（未設定）'], ['export', '輸出'], ['import', '輸入'], ['export_import', '往復（輸出→輸入）'], ['import_export', '往復（輸入→輸出）']];
  const MODES = ['', '海上（FCL）', '海上（LCL）', '海上（RORO）', '海上（在来船）', '航空（AIR）', '海上＋陸上', '航空＋陸上', '陸上のみ', '国内手配のみ'];
  const CCYS = ['JPY', 'USD', 'EUR', 'CNY', 'HKD', 'SGD', 'THB', 'KRW', 'TWD', 'GBP', 'AUD'];
  const JOBS = { list: [], loaded: false, loading: false, missing: false, err: '' };
  const me = () => (typeof window.cloudCurrentEmail === 'function' ? window.cloudCurrentEmail() : '');
  const client = () => (typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null);
  const jobById = id => JOBS.list.find(j => j.id === id) || null;
  const jobTplData = j => ({ fields: { 'cond-direction': (j && j.data && j.data.dir) || '', 'cond-mode': (j && j.data && j.data.mode) || '' } });
  const isMissingTable = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /ops_jobs/.test(e.message || '') && /(does not exist|Could not find)/i.test(e.message || ''));
  function normJob(j) {
    j = Object.assign({}, j);
    j.data = Object.assign({ dir: '', mode: '', route: '', note: '', charges: [], ships: [] }, j.data || {});
    if (!Array.isArray(j.data.charges)) j.data.charges = [];
    if (!Array.isArray(j.data.ships)) j.data.ships = [];
    if (j.kind === 'spot' && !(j.data.st && Array.isArray(j.data.st.s))) j.data.st = fromTemplate(jobTplData(j));
    j.data.ships.forEach(sh => { if (!(sh.st && Array.isArray(sh.st.s))) sh.st = fromTemplate(jobTplData(j)); });
    return j;
  }
  async function loadJobs(force) {
    if (JOBS.loading || (JOBS.loaded && !force)) return;
    const c = client(); if (!c || typeof window.cloudIsLoggedIn !== 'function' || !window.cloudIsLoggedIn()) return;
    JOBS.loading = true;
    try {
      const { data, error } = await c.from('ops_jobs').select('*').neq('status', 'archived').order('updated_at', { ascending: false });
      if (error) { if (isMissingTable(error)) JOBS.missing = true; else JOBS.err = error.message || String(error); }
      else { JOBS.list = (data || []).map(normJob); JOBS.missing = false; JOBS.err = ''; }
    } catch (e) { JOBS.err = String(e && e.message || e); }
    JOBS.loading = false; JOBS.loaded = true;
    refreshAll();
  }
  // 書き込みは順番に（同じ進行へ続けて書いても取りこぼさない）。失敗したら元の内容へ戻す
  function saveJob(id, patch) {
    const run = async () => {
      const c = client(), j = jobById(id); if (!c || !j) return false;
      const before = JSON.parse(JSON.stringify(j));
      Object.assign(j, JSON.parse(JSON.stringify(patch)));   // 先に画面へ反映
      refreshAll();
      const body = Object.assign({}, patch, { updated_by: me() });
      const { data, error } = await c.from('ops_jobs').update(body).eq('id', id).select('*');
      if (error || !data || !data.length) {
        const k = JOBS.list.indexOf(j); if (k >= 0) JOBS.list[k] = before;
        toast('⚠️ 保存できませんでした' + (error ? '：' + error.message : ''), 'warn', 5000);
        refreshAll(); return false;
      }
      const k = JOBS.list.findIndex(x => x.id === id); if (k >= 0) JOBS.list[k] = normJob(data[0]);
      refreshAll(); return true;
    };
    const p = _queue.then(run, run);
    _queue = p.catch(() => {});
    return p;
  }
  function jobData(j) { return JSON.parse(JSON.stringify(j.data)); }
  async function commitJobSteps() {
    const cur = _cur, j = jobById(cur.jobId); if (!j) return;
    const d = jobData(j), snap = JSON.parse(JSON.stringify(cur.st));
    if (cur.shipId) { const sh = d.ships.find(x => x.id === cur.shipId); if (!sh) return; sh.st = snap; }
    else d.st = snap;
    render();
    const ok = await saveJob(j.id, { data: d });
    if (!ok && _cur === cur) { const j2 = jobById(cur.jobId); const sh = j2 && cur.shipId ? j2.data.ships.find(x => x.id === cur.shipId) : null; cur.st = JSON.parse(JSON.stringify(sh ? sh.st : j2.data.st)); render(); }
    return ok;
  }
  function openJobSteps(jobId, shipId) {
    const j = jobById(jobId); if (!j) return;
    const sh = shipId ? j.data.ships.find(x => x.id === shipId) : null;
    if (shipId && !sh) return;
    ensureModal();
    _cur = { kind: 'job', jobId, shipId: shipId || '', st: JSON.parse(JSON.stringify(sh ? sh.st : j.data.st)) };
    render();
    $('opmModal').hidden = false; document.body.classList.add('opm-open');
    const f = $('opmModal').querySelector('.opm-chk:not([disabled])') || $('opmModal').querySelector('.opm-x'); if (f) f.focus();
  }
  // レギュラーの進み具合：まだ済んでいない便のうち、いちばん古い便を「いまの便」にする
  function regularInfo(j) {
    const ships = j.data.ships || [];
    const order = ships.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const open = order.filter(sh => !summary(sh.st).all);
    const unbilled = ships.filter(sh => summary(sh.st).all && !sh.billed).length;
    return { ships, open, cur: open[0] || null, unbilled };
  }
  function jobSummary(j) {
    if (j.kind === 'regular') {
      const ri = regularInfo(j);
      const base = ri.cur ? summary(ri.cur.st) : { total: 0, done: 0, next: null, overdue: 0, dueToday: 0, nearest: '', all: false };
      const overdue = ri.open.reduce((n, sh) => n + summary(sh.st).overdue, 0);
      const dueToday = ri.open.reduce((n, sh) => n + summary(sh.st).dueToday, 0);
      const nearest = ri.open.map(sh => summary(sh.st).nearest).filter(Boolean).sort()[0] || '';
      return Object.assign({}, base, { overdue, dueToday, nearest, all: j.status === 'done', ships: ri.ships.length, open: ri.open.length, unbilled: ri.unbilled, curShip: ri.cur });
    }
    const sm = summary(j.data.st);
    return Object.assign({}, sm, { all: j.status === 'done' || sm.all });
  }
  function chargeTotals(charges) {
    const t = {};
    (charges || []).forEach(c => { const v = (parseFloat(c.qty) || 0) * (parseFloat(c.price) || 0); if (!v) return; const k = c.ccy || 'JPY'; t[k] = (t[k] || 0) + v; });
    return t;
  }
  const fmtAmt = (v, ccy) => (ccy === 'JPY' ? '¥' + Math.round(v).toLocaleString('ja-JP') : ccy + ' ' + (Math.round(v * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
  const totalsText = t => Object.keys(t).map(k => fmtAmt(t[k], k)).join(' ＋ ');

  // ---------- 一覧に並べる「進行」（見積から＋スポット＋レギュラー） ----------
  function collect() {
    const linked = new Set(JOBS.list.map(j => j.preset_id).filter(Boolean));   // 進行に紐づけた見積は、進行の側で 1 件として出す
    const qs = rowsAll().filter(r => isTarget(r) && !linked.has(r.id)).map(r => {
      const st = stateOf(r), f = (r.data && r.data.fields) || {};
      return { src: 'quote', key: 'q:' + r.id, id: r.id, title: caseTitle(r), customer: r.customer || '', mode: f['cond-mode'] || '', updated: r.updated_at || '', st, sm: summary(st), started: !!savedOf(r), r };
    });
    const js = JOBS.list.filter(j => j.status !== 'archived').map(j => {
      const sm = jobSummary(j);
      const st = j.kind === 'regular' ? (sm.curShip ? sm.curShip.st : { s: [] }) : j.data.st;
      return { src: j.kind, key: 'j:' + j.id, id: j.id, title: j.title || '', customer: j.customer || '', mode: j.data.mode || '', updated: j.updated_at || '', st, sm, started: true, job: j };
    });
    return js.concat(qs);
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
    band.innerHTML = '<span class="ops-band-l" title="受注した案件・スポット・レギュラーの、手配から請求までの作業の進み具合">📦 進行</span>' +
      '<button type="button" class="ops-band-b" data-ops-list="active">進行中 <b>' + g.active.length + '</b></button>' +
      (g.over.length ? '<button type="button" class="ops-band-b is-over" data-ops-list="over">⚠ 期限切れ <b>' + g.over.length + '</b></button>' : '') +
      (g.today.length ? '<button type="button" class="ops-band-b is-today" data-ops-list="today">今日まで <b>' + g.today.length + '</b></button>' : '') +
      '<button type="button" class="ops-band-b" data-ops-list="done">完了 <b>' + g.done.length + '</b></button>' +
      '<button type="button" class="ops-band-go" data-ops-list="active">進行管理を開く ›</button>';
  }

  // ---------- ④「📦 進行管理」タブ（#tab-ops・独立した画面） ----------
  const TAB = { f: 'active', src: '', q: '', sort: 'due', loading: false, asked: false };
  const FILTERS = [['active', '進行中'], ['over', '⚠ 期限切れ'], ['today', '今日まで'], ['week', '7日以内'], ['nodue', '期限なし'], ['done', '完了'], ['all', 'すべて']];
  const SRCS = [['', 'すべての種類'], ['quote', KIND_LBL.quote], ['spot', KIND_LBL.spot], ['regular', KIND_LBL.regular]];
  const SORTS = [['due', '期限の近い順'], ['progress', '進み具合の少ない順'], ['updated', '更新が新しい順'], ['name', '案件名順']];
  const tabActive = () => { const t = $('tab-ops'); return !!(t && t.classList.contains('active')); };
  const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  function sortRows(list) {
    const k = TAB.sort;
    return list.slice().sort((a, b) => {
      if (k === 'progress') return (a.sm.done / (a.sm.total || 1)) - (b.sm.done / (b.sm.total || 1));
      if (k === 'updated') return String(b.updated || '').localeCompare(String(a.updated || ''));
      if (k === 'name') return String(a.title).localeCompare(String(b.title), 'ja');
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
      else if (a === 'src') { TAB.src = b.dataset.src; renderTab(); }
      else if (a === 'list') opsOpen(id);
      else if (a === 'quote') openQuote(id);
      else if (a === 'next') quickDone(id, b);
      else if (a === 'job') openJob(id);
      else if (a === 'jnext') quickDoneJob(id, b);
      else if (a === 'ship') addShip(id);
      else if (a === 'new') openCreate();
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
      root.innerHTML = '<div class="opt-head"><h2>📦 進行管理</h2></div><div class="opt-empty">ログインすると、受注した案件・スポット・レギュラーの作業の進み具合を見られます。<br><small>右上の「ログイン」からどうぞ。</small></div>';
      return;
    }
    if (!JOBS.loaded && !JOBS.loading) loadJobs();
    if (!rowsAll().length && !TAB.asked && typeof window.cloudListPresets === 'function') {   // まだ案件一覧を読んでいない（見積タブを開いていない）
      TAB.asked = true; TAB.loading = true;
      Promise.resolve(window.cloudListPresets(true)).catch(() => {}).then(() => { TAB.loading = false; renderTab(); });
    }
    const all0 = collect();
    const all = TAB.src ? all0.filter(x => x.src === TAB.src) : all0;
    const g = groupsOf(all), today = g._today;
    const q = norm(TAB.q);
    let list = g[TAB.f] || g.active;
    if (q) list = list.filter(x => norm(x.title + ' ' + x.customer + ' ' + (x.st.s || []).map(s => s.l).join(' ')).includes(q));
    list = sortRows(list);
    const tile = (k, lbl, n, cls) => '<button type="button" class="opt-tile' + (cls ? ' ' + cls : '') + (TAB.f === k ? ' is-on' : '') + '" data-opt="f" data-f="' + k + '" aria-pressed="' + (TAB.f === k) + '"><span>' + lbl + '</span><b>' + n + '</b></button>';
    const canNew = !JOBS.missing;
    let h = '<div class="opt-head"><div><h2>📦 進行管理</h2><p class="opt-lead">手配から請求までの作業を一覧で見ます。見積から受注した案件のほか、見積を作らない<b>スポット</b>（1 回きり）・<b>レギュラー</b>（同じ料金で繰り返す取引）の進行も、料金の控えといっしょに管理できます。</p></div>' +
      '<div class="opt-head-acts">' + (canNew ? '<button type="button" class="opt-btn opt-btn-new" data-opt="new">＋ 進行を作る</button>' : '') +
      '<button type="button" class="opt-btn" data-opt="reload" title="最新の状態に読み直す">↻ 更新</button><button type="button" class="opt-btn" data-opt="dash">💼 見積ダッシュボードへ</button></div></div>';
    if (JOBS.missing) h += '<p class="opt-warn">ℹ️ 見積とつながらない進行（スポット・レギュラー）を使うには、管理者が Supabase で <code>docs/sql/ops-jobs.sql</code> を実行してください。いまは見積から受注した案件の進行だけが表示されます。</p>';
    else if (JOBS.err) h += '<p class="opt-warn">⚠️ スポット・レギュラーの進行を読み込めませんでした：' + esc(JOBS.err) + '</p>';
    h += '<div class="opt-tiles" role="group" aria-label="絞り込み">' +
      tile('active', '進行中', g.active.length) + tile('over', '⚠ 期限切れ', g.over.length, g.over.length ? 'is-over' : '') +
      tile('today', '今日まで', g.today.length, g.today.length ? 'is-today' : '') + tile('week', '7日以内', g.week.length) +
      tile('done', '完了', g.done.length, 'is-done') + '</div>';
    h += '<div class="opt-bar"><div class="opt-chips" role="group" aria-label="種類">' + SRCS.map(sv => {
        const n = sv[0] ? all0.filter(x => x.src === sv[0]).length : all0.length;
        return '<button type="button" class="opt-chip opt-chip-src' + (TAB.src === sv[0] ? ' is-on' : '') + '" data-opt="src" data-src="' + sv[0] + '" aria-pressed="' + (TAB.src === sv[0]) + '">' + sv[1] + ' <b>' + n + '</b></button>';
      }).join('') + '</div>' +
      '<div class="opt-chips">' + FILTERS.filter(f => !['active', 'over', 'today', 'week', 'done'].includes(f[0])).map(f =>
        '<button type="button" class="opt-chip' + (TAB.f === f[0] ? ' is-on' : '') + '" data-opt="f" data-f="' + f[0] + '" aria-pressed="' + (TAB.f === f[0]) + '">' + f[1] + ' <b>' + g[f[0]].length + '</b></button>').join('') + '</div>' +
      '<input type="search" id="optQ" class="opt-q" placeholder="🔍 案件名・お客様・作業名で探す" value="' + esc(TAB.q) + '" aria-label="検索">' +
      '<label class="opt-sort"><span>並び順</span><select id="optSort">' + SORTS.map(s => '<option value="' + s[0] + '"' + (TAB.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>').join('') + '</select></label></div>';
    if ((TAB.loading || JOBS.loading) && !all0.length) h += '<div class="opt-empty">読み込み中…</div>';
    else if (!all0.length) h += '<div class="opt-empty">まだ進行はありません。<br><small>見積ダッシュボードで案件のステータスを「受注」にするか、［＋ 進行を作る］でスポット・レギュラーの進行を作ってください。</small><br>' +
      (canNew ? '<button type="button" class="opt-btn opt-btn-pri" data-opt="new">＋ 進行を作る</button> ' : '') + '<button type="button" class="opt-btn opt-btn-pri" data-opt="dash">💼 見積ダッシュボードへ</button></div>';
    else if (!list.length) h += '<div class="opt-empty">当てはまる進行はありません。</div>';
    else h += '<ul class="opt-list">' + list.map(x => rowHtml(x, today)).join('') + '</ul>';
    const hadFocus = document.activeElement && document.activeElement.id === 'optQ';
    const pos = hadFocus ? document.activeElement.selectionStart : 0;
    root.innerHTML = h;
    if (hadFocus || keepSearch) { const qi = $('optQ'); if (qi && hadFocus) { qi.focus(); try { qi.setSelectionRange(pos, pos); } catch (e) {} } }
  }
  function segsHtml(st, today) {
    return (st.s || []).map(s => '<i class="' + (s.d ? 'is-done' : (s.due && s.due < today ? 'is-over' : '')) + '" title="' + esc(s.l + (s.d ? '（済み）' : (s.due ? '（期限 ' + md(s.due) + '）' : ''))) + '"></i>').join('');
  }
  function nextHtml(sm, today) {
    const nx = sm.next;
    return (sm.all ? '<span class="ops-next is-all">✅ すべて完了</span>' : (nx ? '次：<b>' + esc(nx.l) + '</b>' + (nx.due ? '<span class="ops-due' + dueCls(nx.due, today) + '">期限 ' + md(nx.due) + '</span>' : '') : '')) +
      (sm.overdue ? ' <span class="ops-warn">⚠ 期限切れ ' + sm.overdue + '</span>' : '');
  }
  function rowHtml(x, today) {
    const sm = x.sm, id = esc(encodeURIComponent(x.id));
    const badge = '<span class="opt-kind opt-kind-' + x.src + '">' + KIND_LBL[x.src] + '</span>';
    if (x.src === 'quote') {
      const lockedBy = typeof window.cloudIsLockedByOther === 'function' ? window.cloudIsLockedByOther(x.id) : null;
      const meta = [x.customer, x.mode, x.started ? '' : '未着手'].filter(Boolean);
      return '<li class="opt-row' + (sm.all ? ' is-all' : '') + (sm.overdue ? ' has-over' : '') + '" data-src="quote">' +
        '<div class="opt-main"><span class="opt-t">' + badge + '<b title="' + esc(x.title) + '">' + esc(x.title || '（案件名なし）') + '</b></span><small>' + esc(meta.join(' · ')) + (lockedBy ? ' · 🔒 ' + esc(nameOf(lockedBy)) + ' さんが編集中' : '') + '</small></div>' +
        '<div class="opt-prog"><span class="ops-segs" aria-hidden="true">' + segsHtml(x.st, today) + '</span><b>' + sm.done + '/' + sm.total + '</b></div>' +
        '<div class="opt-next">' + nextHtml(sm, today) + '</div>' +
        '<div class="opt-acts">' +
          (!sm.all && sm.next && !lockedBy ? '<button type="button" class="opt-btn opt-btn-ok" data-opt="next" data-id="' + id + '" title="「' + esc(sm.next.l) + '」を完了にする">✓ 次を完了</button>' : '') +
          '<button type="button" class="opt-btn" data-opt="list" data-id="' + id + '">☑ チェックリスト</button>' +
          '<button type="button" class="opt-btn" data-opt="quote" data-id="' + id + '" title="この案件の見積を開く">💼 見積</button>' +
        '</div></li>';
    }
    const j = x.job, tot = totalsText(chargeTotals(j.data.charges));
    const linkQ = j.preset_id ? rowById(j.preset_id) : null;
    const meta = [x.customer, x.mode, j.data.route, tot ? '請求 ' + tot + (j.kind === 'regular' ? '／便' : '') : ''].filter(Boolean);
    let prog;
    if (j.kind === 'regular') {
      prog = '<div class="opt-prog opt-prog-reg"><b>便 ' + sm.ships + '</b><small>進行中 ' + sm.open + (sm.unbilled ? '・未請求 ' + sm.unbilled : '') + '</small></div>';
    } else prog = '<div class="opt-prog"><span class="ops-segs" aria-hidden="true">' + segsHtml(x.st, today) + '</span><b>' + sm.done + '/' + sm.total + '</b></div>';
    const next = j.kind === 'regular' && !sm.all && !sm.curShip ? '<span class="ops-next">便がありません（［＋ 便］で追加）</span>'
      : (j.kind === 'regular' && sm.curShip ? '<span class="opt-ship-lbl">' + esc(sm.curShip.label || '') + '</span> ' : '') + nextHtml(sm, today);
    return '<li class="opt-row' + (sm.all ? ' is-all' : '') + (sm.overdue ? ' has-over' : '') + '" data-src="' + x.src + '">' +
      '<div class="opt-main"><span class="opt-t">' + badge + '<b title="' + esc(x.title) + '">' + esc(x.title || '（名前なし）') + '</b>' + (j.preset_id ? '<span class="opt-link" title="見積と紐づいています">💼 ' + esc(linkQ ? (linkQ.data && linkQ.data.fields && linkQ.data.fields['qf-ref']) || linkQ.ref || '見積' : '見積') + '</span>' : '') + '</span><small>' + esc(meta.join(' · ')) + '</small></div>' +
      prog +
      '<div class="opt-next">' + next + '</div>' +
      '<div class="opt-acts">' +
        (j.kind === 'regular' && j.status !== 'done' ? '<button type="button" class="opt-btn" data-opt="ship" data-id="' + id + '" title="この取引の便を 1 つ足す">＋ 便</button>' : '') +
        (!sm.all && sm.next ? '<button type="button" class="opt-btn opt-btn-ok" data-opt="jnext" data-id="' + id + '" title="「' + esc(sm.next.l) + '」を完了にする">✓ 次を完了</button>' : '') +
        '<button type="button" class="opt-btn" data-opt="job" data-id="' + id + '">📂 開く</button>' +
      '</div></li>';
  }
  async function quickDone(idAttr, btn) {
    const id = decodeURIComponent(idAttr), r = rowById(id); if (!r) return;
    const st = JSON.parse(JSON.stringify(stateOf(r))), x = st.s.find(s => !s.d); if (!x) return;
    x.d = true; x.at = new Date().toISOString(); x.by = me();
    if (btn) btn.disabled = true;
    const all = st.s.every(s => s.d);
    const ok = await save(id, st, '✅ 業務：「' + x.l + '」を完了' + (all ? '（すべての作業が完了）' : ''));
    if (ok) toast('✅ 「' + x.l + '」を完了にしました', 'success', 2500);
    renderTab();
  }
  async function quickDoneJob(idAttr, btn) {
    const j = jobById(decodeURIComponent(idAttr)); if (!j) return;
    const d = jobData(j);
    let st;
    if (j.kind === 'regular') { const ri = regularInfo({ data: d }); if (!ri.cur) return; st = d.ships.find(s => s.id === ri.cur.id).st; }
    else st = d.st;
    const x = st.s.find(s => !s.d); if (!x) return;
    x.d = true; x.at = new Date().toISOString(); x.by = me();
    if (btn) btn.disabled = true;
    if (await saveJob(j.id, { data: d })) toast('✅ 「' + x.l + '」を完了にしました', 'success', 2500);
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
    TAB.loading = true; renderTab();
    try { if (typeof window.cloudListPresets === 'function') await window.cloudListPresets(true); } catch (e) {}
    try { await loadJobs(true); } catch (e) {}
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
  window.initOpsTab = function () { if (!JOBS.loaded) loadJobs(); renderTab(); };

  // ---------- 進行を作る（スポット／レギュラー） ----------
  function openCreate() {
    if (JOBS.missing) { toast('ℹ️ 先に Supabase で docs/sql/ops-jobs.sql を実行してください', 'warn', 5000); return; }
    let ov = $('ojNew');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'ojNew'; ov.className = 'opm-overlay'; ov.hidden = true;
      ov.innerHTML = '<div class="opm-box opm-box-sm" role="dialog" aria-modal="true" aria-labelledby="ojNewT">' +
        '<div class="opm-head"><div class="opm-head-t"><b id="ojNewT">＋ 進行を作る</b><small>見積を作らない取引の進行です。料金の控えは、作ったあとに入れられます</small></div><button type="button" class="opm-x" data-ojn="close" aria-label="閉じる">✕</button></div>' +
        '<div class="opm-body">' +
          '<fieldset class="oj-kind"><legend>種類</legend>' +
            '<label class="oj-kind-o"><input type="radio" name="ojNewKind" value="spot" checked><span><b>⚡ スポット</b><small>1 回きりの取引。料金の控えとチェックリスト</small></span></label>' +
            '<label class="oj-kind-o"><input type="radio" name="ojNewKind" value="regular"><span><b>🔁 レギュラー</b><small>同じ料金で繰り返す取引。出荷のたびに「便」を足す</small></span></label>' +
          '</fieldset>' +
          '<label class="oj-f"><span>名前 <em>必須</em></span><input type="text" id="ojNewTitle" maxlength="80" placeholder="例：A社 東京→上海 毎月便"></label>' +
          '<label class="oj-f"><span>お客様</span><input type="text" id="ojNewCust" maxlength="80" list="ojCustList" placeholder="例：株式会社サンプル商事"></label>' +
          '<div class="oj-f2"><label class="oj-f"><span>輸出入</span><select id="ojNewDir">' + DIRS.map(d => '<option value="' + d[0] + '">' + d[1] + '</option>').join('') + '</select></label>' +
          '<label class="oj-f"><span>輸送モード</span><select id="ojNewMode">' + MODES.map(m => '<option value="' + esc(m) + '">' + (m || '（未設定）') + '</option>').join('') + '</select></label></div>' +
          '<p class="oj-hint">輸出入と輸送モードから、作業のひな形（ブッキング → SI → 通関…）を選びます。</p>' +
          '<div class="opm-foot"><button type="button" class="opm-btn" data-ojn="close">キャンセル</button><button type="button" class="opm-btn opm-btn-pri" data-ojn="ok">作る</button></div>' +
        '</div></div><datalist id="ojCustList"></datalist>';
      document.body.appendChild(ov);
      ov.addEventListener('click', e => {
        if (e.target === ov) return closeCreate();
        const b = e.target.closest('[data-ojn]'); if (!b) return;
        if (b.dataset.ojn === 'close') closeCreate(); else if (b.dataset.ojn === 'ok') doCreate();
      });
      ov.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.target.tagName === 'INPUT' && e.target.type === 'text') { e.preventDefault(); doCreate(); } else if (e.key === 'Escape') { e.stopPropagation(); closeCreate(); } });
    }
    const names = new Set(); rowsAll().forEach(r => r.customer && names.add(r.customer)); JOBS.list.forEach(j => j.customer && names.add(j.customer));
    $('ojCustList').innerHTML = [...names].sort((a, b) => a.localeCompare(b, 'ja')).map(n => '<option value="' + esc(n) + '">').join('');
    $('ojNewTitle').value = ''; $('ojNewCust').value = ''; $('ojNewDir').value = ''; $('ojNewMode').value = '';
    $('ojNewTitle').classList.remove('is-err');
    ov.hidden = false; document.body.classList.add('opm-open');
    $('ojNewTitle').focus();
  }
  function closeCreate() { if ($('ojNew')) $('ojNew').hidden = true; if ((!$('ojModal') || $('ojModal').hidden) && (!$('opmModal') || $('opmModal').hidden)) document.body.classList.remove('opm-open'); }
  async function doCreate() {
    const title = $('ojNewTitle').value.trim();
    if (!title) { $('ojNewTitle').classList.add('is-err'); $('ojNewTitle').focus(); toast('⚠️ 名前を入れてください', 'warn'); return; }
    const kind = (document.querySelector('input[name="ojNewKind"]:checked') || {}).value || 'spot';
    const data = { dir: $('ojNewDir').value, mode: $('ojNewMode').value, route: '', note: '', charges: [], ships: [] };
    if (kind === 'spot') data.st = fromTemplate({ fields: { 'cond-direction': data.dir, 'cond-mode': data.mode } });
    const c = client(); if (!c) return;
    const btn = document.querySelector('#ojNew [data-ojn="ok"]'); if (btn) btn.disabled = true;
    const { data: rows, error } = await c.from('ops_jobs').insert({ kind, title, customer: $('ojNewCust').value.trim(), status: 'active', data, created_by: me(), updated_by: me() }).select('*');
    if (btn) btn.disabled = false;
    if (error || !rows || !rows.length) { if (isMissingTable(error)) { JOBS.missing = true; renderTab(); } toast('⚠️ 作れませんでした' + (error ? '：' + error.message : ''), 'warn', 5000); return; }
    const j = normJob(rows[0]); JOBS.list.unshift(j);
    closeCreate();
    toast('✅ 「' + title + '」を作りました', 'success', 2500);
    refreshAll();
    openJob(encodeURIComponent(j.id));
  }

  // ---------- 進行の画面（#ojModal：基本・料金の控え・チェックリスト／便・見積との紐付け） ----------
  let _job = null;   // 開いている進行の id
  function ensureJobModal() {
    if ($('ojModal')) return;
    const ov = document.createElement('div'); ov.id = 'ojModal'; ov.className = 'opm-overlay'; ov.hidden = true;
    ov.innerHTML = '<div class="opm-box opm-box-job" role="dialog" aria-modal="true" aria-labelledby="ojTitle">' +
      '<div class="opm-head"><div class="opm-head-t"><b id="ojTitle">進行</b><small id="ojSub"></small></div><button type="button" class="opm-x" data-oj="close" aria-label="閉じる">✕</button></div>' +
      '<div class="opm-body" id="ojBody"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', e => {
      if (e.target === ov) return closeJob();
      const b = e.target.closest('[data-oj]'); if (!b) return;
      const a = b.dataset.oj, i = +b.dataset.i;
      if (a === 'close') closeJob();
      else if (a === 'steps') openJobSteps(_job, b.dataset.ship || '');
      else if (a === 'cadd') chargeAdd();
      else if (a === 'cdel') chargeDel(i);
      else if (a === 'shipadd') addShip(encodeURIComponent(_job));
      else if (a === 'shipdel') shipDel(b.dataset.ship);
      else if (a === 'mkquote') makeQuote(_job);
      else if (a === 'openq') { const j = jobById(_job); if (j && j.preset_id) { closeJob(); openQuote(encodeURIComponent(j.preset_id)); } }
      else if (a === 'unlink') unlinkQuote();
      else if (a === 'linkq') linkQuote(b.dataset.pid);
      else if (a === 'status') setStatus(b.dataset.v);
      else if (a === 'delete') delJob();
    });
    ov.addEventListener('change', e => {
      const t = e.target, j = jobById(_job); if (!j) return;
      if (t.dataset.ojF) {
        const k = t.dataset.ojF, v = t.value.trim();
        if (k === 'title') { if (!v) { t.value = j.title; toast('⚠️ 名前は空にできません', 'warn'); return; } saveJob(j.id, { title: v }); }
        else if (k === 'customer') saveJob(j.id, { customer: v });
        else { const d = jobData(j); d[k] = t.tagName === 'TEXTAREA' ? t.value : v; saveJob(j.id, { data: d }); }
      } else if (t.dataset.ojC !== undefined) {
        const d = jobData(j), c = d.charges[+t.dataset.ojC]; if (!c) return;
        c[t.dataset.k] = (t.dataset.k === 'qty' || t.dataset.k === 'price') ? (t.value === '' ? '' : parseFloat(t.value) || 0) : t.value.trim();
        saveJob(j.id, { data: d });
      } else if (t.dataset.ojS !== undefined) {
        const d = jobData(j), sh = d.ships.find(x => x.id === t.dataset.ojS); if (!sh) return;
        const k = t.dataset.k; sh[k] = k === 'billed' ? t.checked : t.value.trim();
        saveJob(j.id, { data: d });
      }
    });
    ov.addEventListener('input', e => { if (e.target.id === 'ojLinkQ') renderLinkList(e.target.value); });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || e.__opsHandled || !$('ojModal') || $('ojModal').hidden) return;
      if ((($('opmModal') && !$('opmModal').hidden)) || document.querySelector('.confirm-overlay')) return;
      e.stopPropagation(); closeJob();
    }, true);
  }
  function openJob(idAttr) {
    const id = decodeURIComponent(idAttr); if (!jobById(id)) { toast('⚠️ 進行が見つかりません', 'warn'); return; }
    ensureJobModal(); _job = id; renderJob();
    $('ojModal').hidden = false; document.body.classList.add('opm-open');
    const x = $('ojModal').querySelector('.opm-x'); if (x) x.focus();
  }
  function closeJob() { if ($('ojModal')) $('ojModal').hidden = true; _job = null; if (!$('opmModal') || $('opmModal').hidden) document.body.classList.remove('opm-open'); }
  function renderJob() {
    const j = jobById(_job); if (!j || !$('ojBody')) return;
    const body = $('ojBody'), active = document.activeElement;
    let keep = null;   // 描き直しても、いま入力している欄に焦点を戻す
    if (active && body.contains(active) && active.matches('input,select,textarea')) {
      if (active.dataset.ojF) keep = '[data-oj-f="' + active.dataset.ojF + '"]';
      else if (active.dataset.ojC !== undefined) keep = '[data-oj-c="' + active.dataset.ojC + '"][data-k="' + active.dataset.k + '"]';
      else if (active.dataset.ojS !== undefined) keep = '[data-oj-s="' + active.dataset.ojS + '"][data-k="' + active.dataset.k + '"]';
      else if (active.id) keep = '#' + active.id;
    }
    $('ojTitle').textContent = KIND_LBL[j.kind] + '　' + (j.title || '');
    $('ojSub').textContent = (j.status === 'done' ? '✅ 完了　' : '') + '作成 ' + nameOf(j.created_by) + (j.updated_at ? '・更新 ' + whenText(j.updated_at) : '');
    const today = todayStr(), d = j.data;
    let h = '<section class="oj-sec"><h3>基本</h3><div class="oj-grid">' +
      '<label class="oj-f oj-f-wide"><span>名前</span><input type="text" data-oj-f="title" maxlength="80" value="' + esc(j.title) + '"></label>' +
      '<label class="oj-f"><span>お客様</span><input type="text" data-oj-f="customer" maxlength="80" list="ojCustList" value="' + esc(j.customer || '') + '"></label>' +
      '<label class="oj-f"><span>区間</span><input type="text" data-oj-f="route" maxlength="80" placeholder="例：TOKYO → SHANGHAI" value="' + esc(d.route || '') + '"></label>' +
      '<label class="oj-f"><span>輸出入</span><select data-oj-f="dir">' + DIRS.map(x => '<option value="' + x[0] + '"' + (d.dir === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select></label>' +
      '<label class="oj-f"><span>輸送モード</span><select data-oj-f="mode">' + MODES.map(m => '<option value="' + esc(m) + '"' + (d.mode === m ? ' selected' : '') + '>' + (m || '（未設定）') + '</option>').join('') + '</select></label>' +
      '<label class="oj-f oj-f-wide"><span>メモ</span><textarea data-oj-f="note" rows="2" maxlength="1000" placeholder="社内メモ（お客様には出ません）">' + esc(d.note || '') + '</textarea></label>' +
      '</div></section>';
    // 料金の控え
    const tot = chargeTotals(d.charges);
    h += '<section class="oj-sec"><h3>💴 請求料金の控え' + (j.kind === 'regular' ? '<small>（1 便あたり・どの便も同じ料金）</small>' : '') + '</h3>' +
      (d.charges.length ? '<div class="oj-ctable"><div class="oj-crow oj-chead"><span>項目</span><span>数量</span><span>単位</span><span>通貨</span><span>単価</span><span>金額</span><span></span></div>' +
        d.charges.map((c, i) => {
          const amt = (parseFloat(c.qty) || 0) * (parseFloat(c.price) || 0);
          return '<div class="oj-crow">' +
            '<input type="text" data-oj-c="' + i + '" data-k="name" maxlength="60" placeholder="例：OCEAN FREIGHT" value="' + esc(c.name || '') + '" aria-label="項目">' +
            '<input type="number" data-oj-c="' + i + '" data-k="qty" step="any" min="0" value="' + esc(c.qty === undefined ? '' : c.qty) + '" aria-label="数量">' +
            '<input type="text" data-oj-c="' + i + '" data-k="unit" maxlength="20" list="unit-list" placeholder="例：20\'GP" value="' + esc(c.unit || '') + '" aria-label="単位">' +
            '<select data-oj-c="' + i + '" data-k="ccy" aria-label="通貨">' + CCYS.map(k => '<option' + ((c.ccy || 'JPY') === k ? ' selected' : '') + '>' + k + '</option>').join('') + '</select>' +
            '<input type="number" data-oj-c="' + i + '" data-k="price" step="any" min="0" value="' + esc(c.price === undefined ? '' : c.price) + '" aria-label="単価">' +
            '<span class="oj-amt">' + (amt ? fmtAmt(amt, c.ccy || 'JPY') : '—') + '</span>' +
            '<button type="button" class="oj-icon" data-oj="cdel" data-i="' + i + '" title="この行を消す">✕</button></div>';
        }).join('') + '</div>' : '<p class="oj-empty">まだ料金がありません。</p>') +
      '<div class="oj-crow-foot"><button type="button" class="opm-btn" data-oj="cadd">＋ 料金の行を追加</button>' + (Object.keys(tot).length ? '<b class="oj-total">合計 ' + totalsText(tot) + '</b>' : '') + '</div></section>';
    // 進み具合
    if (j.kind === 'regular') {
      const ships = d.ships.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      h += '<section class="oj-sec"><h3>🚢 便<small>（出荷のたびに足す・新しい順）</small></h3>' +
        (ships.length ? '<ul class="oj-ships">' + ships.map(sh => {
          const sm = summary(sh.st);
          return '<li class="oj-ship' + (sm.all ? ' is-all' : '') + (sm.overdue ? ' has-over' : '') + '">' +
            '<input type="text" class="oj-ship-l" data-oj-s="' + esc(sh.id) + '" data-k="label" maxlength="40" value="' + esc(sh.label || '') + '" aria-label="便の名前">' +
            '<input type="date" data-oj-s="' + esc(sh.id) + '" data-k="date" value="' + esc(sh.date || '') + '" aria-label="出荷日">' +
            '<span class="opt-prog"><span class="ops-segs" aria-hidden="true">' + segsHtml(sh.st, today) + '</span><b>' + sm.done + '/' + sm.total + '</b></span>' +
            '<span class="oj-ship-next">' + nextHtml(sm, today) + '</span>' +
            '<label class="oj-billed"><input type="checkbox" data-oj-s="' + esc(sh.id) + '" data-k="billed"' + (sh.billed ? ' checked' : '') + '> 請求済み</label>' +
            '<button type="button" class="opm-btn" data-oj="steps" data-ship="' + esc(sh.id) + '">☑ チェックリスト</button>' +
            '<button type="button" class="oj-icon" data-oj="shipdel" data-ship="' + esc(sh.id) + '" title="この便を消す">✕</button></li>';
        }).join('') + '</ul>' : '<p class="oj-empty">まだ便がありません。出荷が決まったら［＋ 便を追加］で足してください（作業のひな形が付きます）。</p>') +
        (j.status === 'done' ? '' : '<div class="oj-crow-foot"><button type="button" class="opm-btn" data-oj="shipadd">＋ 便を追加</button></div>') + '</section>';
    } else {
      const sm = summary(d.st), pct = sm.total ? Math.round(sm.done / sm.total * 100) : 0;
      h += '<section class="oj-sec"><h3>☑ 作業の進み具合</h3><div class="opm-prog"><div class="opm-bar"><span style="width:' + pct + '%"></span></div><b>' + sm.done + ' / ' + sm.total + ' 完了</b>' +
        '<span class="oj-ship-next">' + nextHtml(sm, today) + '</span><button type="button" class="opm-btn" data-oj="steps">☑ チェックリストを開く</button></div></section>';
    }
    // 見積との紐付け
    const q = j.preset_id ? rowById(j.preset_id) : null;
    h += '<section class="oj-sec"><h3>💼 見積との紐付け</h3>';
    if (j.preset_id) {
      h += '<p class="oj-linked">💼 ' + esc(q ? caseTitle(q) : '紐づけた見積（一覧に見当たりません）') + (q && q.customer ? '　' + esc(q.customer) : '') + '</p>' +
        '<div class="oj-crow-foot">' + (q ? '<button type="button" class="opm-btn" data-oj="openq">💼 見積を開く</button>' : '') + '<button type="button" class="opm-link" data-oj="unlink">紐付けを外す</button></div>';
    } else {
      h += '<p class="oj-hint">見積書が必要になったら、この進行から見積を作れます（お客様・名前・料金の控えを見積へ写し、保存すると自動で紐づきます）。すでにある見積に紐づけることもできます。</p>' +
        '<div class="oj-crow-foot"><button type="button" class="opm-btn opm-btn-pri" data-oj="mkquote">💼 この進行から見積を作る</button></div>' +
        '<details class="oj-link-pick"><summary>すでにある見積に紐づける</summary><input type="search" id="ojLinkQ" placeholder="🔍 見積もり番号・案件名・お客様で探す" aria-label="見積を探す"><ul id="ojLinkList" class="oj-link-list"></ul></details>';
    }
    h += '</section>';
    h += '<div class="opm-foot"><button type="button" class="opm-link oj-del" data-oj="delete">削除…</button>' +
      (j.status === 'done' ? '<button type="button" class="opm-btn" data-oj="status" data-v="active">↩ 進行中に戻す</button>' : '<button type="button" class="opm-btn" data-oj="status" data-v="done">✅ 完了にする</button>') +
      '<button type="button" class="opm-btn opm-btn-pri" data-oj="close">閉じる</button></div>';
    body.innerHTML = h;
    if (!j.preset_id) renderLinkList('');
    if (keep) { try { const el = body.querySelector(keep); if (el) el.focus(); } catch (e) {} }
  }
  function renderLinkList(qv) {
    const ul = $('ojLinkList'); if (!ul) return;
    const linked = new Set(JOBS.list.map(j => j.preset_id).filter(Boolean));
    const qn = norm(qv);
    const rows = rowsAll().filter(r => !linked.has(r.id) && (!qn || norm(caseTitle(r) + ' ' + (r.customer || '')).includes(qn)))
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 8);
    ul.innerHTML = rows.length ? rows.map(r => '<li><button type="button" class="oj-link-o" data-oj="linkq" data-pid="' + esc(r.id) + '"><b>' + esc(caseTitle(r) || '（案件名なし）') + '</b><small>' + esc([r.customer, statusOf(r)].filter(Boolean).join(' · ')) + '</small></button></li>').join('')
      : '<li class="oj-empty">当てはまる見積はありません。</li>';
  }
  function chargeAdd() { const j = jobById(_job); if (!j) return; const d = jobData(j); d.charges.push({ id: newId(), name: '', qty: 1, unit: '', ccy: 'JPY', price: '' }); saveJob(j.id, { data: d }).then(() => { const ins = $('ojBody') && $('ojBody').querySelectorAll('[data-k="name"][data-oj-c]'); if (ins && ins.length) ins[ins.length - 1].focus(); }); }
  function chargeDel(i) { const j = jobById(_job); if (!j) return; const d = jobData(j); d.charges.splice(i, 1); saveJob(j.id, { data: d }); }
  async function addShip(idAttr) {
    const j = jobById(decodeURIComponent(idAttr)); if (!j || j.kind !== 'regular') return;
    const d = jobData(j), t = new Date();
    const sh = { id: newId(), label: (t.getMonth() + 1) + '/' + t.getDate() + ' 便', date: todayStr(), billed: false, note: '', st: fromTemplate(jobTplData(j)) };
    d.ships.push(sh);
    if (await saveJob(j.id, { data: d })) toast('🚢 「' + sh.label + '」を足しました（名前・日付は変えられます）', 'success', 3000);
  }
  async function shipDel(shipId) {
    const j = jobById(_job); if (!j) return;
    const sh = j.data.ships.find(x => x.id === shipId); if (!sh) return;
    const ok = typeof window.uiConfirm === 'function' ? await window.uiConfirm({ title: '便を消しますか？', lines: ['「' + (sh.label || '') + '」とそのチェックリストを消します。元に戻せません。'], okLabel: '消す', danger: true }) : true;
    if (!ok) return;
    const d = jobData(j); d.ships = d.ships.filter(x => x.id !== shipId); saveJob(j.id, { data: d });
  }
  function setStatus(v) { const j = jobById(_job); if (j) saveJob(j.id, { status: v }).then(ok => { if (ok) toast(v === 'done' ? '✅ 完了にしました' : '↩ 進行中に戻しました', 'success', 2500); }); }
  async function delJob() {
    const j = jobById(_job); if (!j) return;
    const ok = typeof window.uiConfirm === 'function' ? await window.uiConfirm({ title: '進行を削除しますか？', lines: ['「' + j.title + '」を、料金の控え・チェックリスト・便ごと削除します。元に戻せません。', j.preset_id ? '紐づけた見積は消えません。' : ''].filter(Boolean), okLabel: '削除する', danger: true }) : true;
    if (!ok) return;
    const c = client(); if (!c) return;
    const { data, error } = await c.from('ops_jobs').delete().eq('id', j.id).select('id');
    if (error || !data || !data.length) { toast('⚠️ 削除できませんでした' + (error ? '：' + error.message : ''), 'warn', 5000); return; }
    JOBS.list = JOBS.list.filter(x => x.id !== j.id);
    closeJob(); refreshAll(); toast('🗑 削除しました', 'success', 2500);
  }
  function linkQuote(pid) {
    const j = jobById(_job); if (!j || !pid) return;
    if (JOBS.list.some(x => x.preset_id === pid && x.id !== j.id)) { toast('⚠️ その見積は別の進行に紐づいています', 'warn'); return; }
    saveJob(j.id, { preset_id: pid }).then(ok => { if (ok) toast('🔗 見積と紐づけました', 'success', 2500); });
  }
  async function unlinkQuote() {
    const j = jobById(_job); if (!j) return;
    const ok = typeof window.uiConfirm === 'function' ? await window.uiConfirm({ title: '見積との紐付けを外しますか？', lines: ['進行と見積は、どちらも消えません。'], okLabel: '外す' }) : true;
    if (ok) saveJob(j.id, { preset_id: null });
  }
  // 進行から見積を作る：お客様・名前・料金の控えを新しい見積へ写し、保存されたら自動で紐づける
  let _pendingLink = null;   // { jobId }
  async function makeQuote(jobId) {
    const j = jobById(jobId); if (!j) return;
    const btn = document.querySelector('.cat-btn[aria-controls="tab-quote-make"]');
    if (typeof window.switchCategory === 'function') window.switchCategory('quote', btn);
    if (typeof window.cloudConfirmLeaveUnsaved === 'function' && !(await window.cloudConfirmLeaveUnsaved('新しい見積を作る'))) return;
    closeJob(); if (_cur) close();
    if (typeof window.qpNewQuote !== 'function') return;
    window.qpNewQuote();
    const setV = (id, v) => { const el = $(id); if (el && v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
    setV('qf-customer', j.customer); setV('qf-case-name', j.title);
    const rows = (j.data.charges || []).filter(c => c.name || c.price).map(c => {
      const cells = []; cells[4] = c.name || ''; cells[5] = c.qty === '' || c.qty === undefined ? '1' : String(c.qty); cells[6] = c.unit || '';
      cells[8] = c.ccy || 'JPY'; cells[9] = c.ccy || 'JPY'; cells[10] = c.price === '' || c.price === undefined ? '' : String(c.price); cells[13] = '0';
      return { cells };
    });
    if (rows.length && typeof window.appendQuoteRows === 'function') {
      // 新しい見積の最初の空の行は、写した行の前から消す
      const body = $('tableBody');
      if (body) [...body.querySelectorAll('tr')].forEach(tr => { if (tr.dataset.virtual) return; const nm = tr.querySelector('[data-field="nm"]'), pp = tr.querySelector('[data-field="pp"]'); if (nm && !nm.value && (!pp || !parseFloat(pp.value))) tr.remove(); });
      window.appendQuoteRows(rows);
      if (typeof window.renderSubconGroups === 'function') window.renderSubconGroups();
      if (typeof window.updateTotals === 'function') window.updateTotals();
    }
    _pendingLink = { jobId: j.id };
    toast('💼 「' + j.title + '」から見積を作りました。料金は仕入単価に入れてあります（乗せ幅 0）。保存すると、この進行と自動で紐づきます', 'success', 7000);
  }
  // 保存のあとで紐づける（新しい案件として保存されたときだけ）
  function hookSave() {
    const orig = window.cloudSaveCurrent; if (typeof orig !== 'function' || orig.__opsWrapped) return;
    const w = async function () {
      const before = typeof window.cloudLoadedId === 'function' ? window.cloudLoadedId() : null;
      const r = await orig.apply(this, arguments);
      const after = typeof window.cloudLoadedId === 'function' ? window.cloudLoadedId() : null;
      if (_pendingLink && !before && after) {
        const pl = _pendingLink; _pendingLink = null;
        if (jobById(pl.jobId) && await saveJob(pl.jobId, { preset_id: after })) toast('🔗 見積を進行「' + (jobById(pl.jobId).title || '') + '」に紐づけました', 'success', 3500);
      }
      return r;
    };
    w.__opsWrapped = true; window.cloudSaveCurrent = w;
    const ol = window.cloudLoadPreset;   // 別の案件を開いたら、紐付けの予約は取り消す
    if (typeof ol === 'function' && !ol.__opsWrapped) { const wl = function () { _pendingLink = null; return ol.apply(this, arguments); }; wl.__opsWrapped = true; window.cloudLoadPreset = wl; }
  }

  // ---------- 🛰 サイバーポートの自動確認（COLINS）の実績から、出港・入港・返却のチェックを自動で入れる ----------
  // 朝夕の自動確認（cp_watch_targets.snapshot＝注目項目の写し）を読み、実績が入っていれば当てはまる作業を「済み」にする。
  //  - 当てはまる作業：作業名で判断（出港／搭載・出発、入港・到着（「到着案内」は除く）、空コンテナの返却）
  //  - 往復の案件：【往路】【復路】の作業は、追跡の向き（輸出／輸入）と合う側だけ
  //  - 一度自動で入れた作業は st.ax に控え、人が外したら二度と自動では入れない
  //  - 書き込みは人の操作と同じ入口（他のメンバーが編集中の案件は、次の機会に）。5 分に 1 回まで
  const AUTO = { at: 0, busy: false, missing: false, map: null };
  const AUTO_EV = [
    { k: 'dep', re: /出港|出発/, name: '出港実績' },
    { k: 'arr', re: /入港|到着(?!案内)/, name: '入港実績' },
    { k: 'ret', re: /空コンテナの返却|空コン返却/, name: '空コンテナの返却実績' },
  ];
  function parseVal(v) {
    const m = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(v || ''));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    return isNaN(d) ? null : d;
  }
  const valText = d => (d.getMonth() + 1) + '/' + d.getDate() + (d.getHours() || d.getMinutes() ? ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : '');
  // 追跡の写しから「済んだこと」を取り出す（{dep, arr, ret} → Date）
  function autoEvents(t) {
    const items = Array.isArray(t && t.snapshot) ? t.snapshot : [];
    const ev = {};
    const firstVal = re => { for (const it of items) if (re.test(String(it && it.k || '')) && it.val) { const d = parseVal(it.val); if (d) return d; } return null; };
    ev.dep = firstVal(/^v:.*:pol:atd$/);
    // 入港：積み替えがあれば最後の積み替え本船の入港、無ければ本船の荷揚港の入港
    const tr = items.filter(it => /^v:.*:tr(\d+)pod:ata$/.test(String(it && it.k || '')));
    if (tr.length) {
      const last = tr.slice().sort((a, b) => +/tr(\d+)pod/.exec(b.k)[1] - +/tr(\d+)pod/.exec(a.k)[1])[0];
      ev.arr = last.val ? parseVal(last.val) : null;
    } else ev.arr = firstVal(/^v:.*:pod:ata$/);
    const rets = items.filter(it => /^c:.*:retAct$/.test(String(it && it.k || '')));
    if (rets.length && rets.every(it => it.val)) ev.ret = rets.map(it => parseVal(it.val)).filter(Boolean).sort((a, b) => b - a)[0] || null;
    return ev;
  }
  // 作業の並び st に、追跡の結果 t を当てはめる。変えた作業の一覧を返す（st は書き換える）
  function autoApply(st, t, dirField) {
    if (!st || !Array.isArray(st.s) || !t) return [];
    const ev = autoEvents(t);
    if (!ev.dep && !ev.arr && !ev.ret) return [];
    const legDir = { export_import: { '往路': 'export', '復路': 'import' }, import_export: { '往路': 'import', '復路': 'export' } }[dirField] || null;
    st.ax = Array.isArray(st.ax) ? st.ax : [];
    const done = [];
    st.s.forEach(x => {
      if (x.d || st.ax.includes(x.id)) return;
      const m = /^【(往路|復路)】/.exec(x.l || '');
      if (m && legDir && legDir[m[1]] !== t.direction) return;
      const l = String(x.l || '').replace(/^【(往路|復路)】/, '');
      const e = AUTO_EV.find(a => ev[a.k] && a.re.test(l));
      if (!e) return;
      const d = ev[e.k];
      x.d = true; x.at = d.toISOString(); x.by = AUTO_BY; x.src = 'COLINS の' + e.name + ' ' + valText(d);
      st.ax.push(x.id); done.push(x);
    });
    return done;
  }
  function autoTargetOfJob(j, shipId) {
    if (!j || shipId || j.kind !== 'spot' || !j.preset_id || !AUTO.map) return null;
    return AUTO.map.get(j.preset_id) || null;
  }
  async function autoLoad() {
    const c = client(); if (!c) return null;
    let res = await c.from('cp_watch_targets').select('preset_id,direction,snapshot,source,trace');
    if (res.error && (res.error.code === '42703' || /source/.test(res.error.message || ''))) res = await c.from('cp_watch_targets').select('preset_id,direction,snapshot,trace');
    if (res.error) {
      if (res.error.code === '42P01' || res.error.code === 'PGRST205' || /cp_watch_targets/.test(res.error.message || '')) AUTO.missing = true;
      return null;
    }
    const map = new Map();
    (res.data || []).forEach(t => { if ((t.source || 'case') === 'case' && t.preset_id) map.set(t.preset_id, t); });
    return map;
  }
  async function autoSync(force) {
    if (AUTO.busy || AUTO.missing) return;
    if (!force && Date.now() - AUTO.at < 5 * 60 * 1000) return;
    if (!(typeof window.cloudIsLoggedIn === 'function' && window.cloudIsLoggedIn())) return;
    if (!rowsAll().length && !JOBS.list.length) return;
    AUTO.busy = true; AUTO.at = Date.now();
    let n = 0;
    try {
      const map = await autoLoad();
      if (!map) return;
      AUTO.map = map;
      for (const r of rowsAll()) {
        const t = map.get(r.id); if (!t || !isTarget(r)) continue;
        if (typeof window.cloudIsLockedByOther === 'function' && window.cloudIsLockedByOther(r.id)) continue;
        if (_cur && _cur.id === r.id) continue;   // チェックリストを開いている間は触らない（閉じたあとの機会に）
        const st = JSON.parse(JSON.stringify(stateOf(r)));
        const f = (r.data && r.data.fields) || {};
        const done = autoApply(st, t, f['cond-direction']);
        if (!done.length) continue;
        const ok = await save(r.id, st, done.map(x => '🛰 業務：「' + x.l + '」を自動で完了（' + x.src + '）').join('\n'));
        if (ok) n += done.length;
      }
      for (const j of JOBS.list) {
        const t = autoTargetOfJob(j); if (!t || j.status !== 'active') continue;
        if (_cur && _cur.kind === 'job' && _cur.jobId === j.id) continue;
        const d = jobData(j), done = autoApply(d.st, t, '');
        if (done.length && await saveJob(j.id, { data: d })) n += done.length;
      }
    } catch (e) { /* 自動確認の読み取りに失敗しても、画面は止めない */ }
    finally { AUTO.busy = false; }
    if (n) { toast('🛰 サイバーポートの実績から、作業 ' + n + ' 件に自動でチェックを入れました', 'success', 4000); renderBand(); renderTab(); }
  }

  // 一覧が描き直されるたび（cloud.js → dtRefresh）に、帯とタブを更新する
  function refreshAll() { renderBand(); renderTab(); autoSync(); if ($('ojModal') && !$('ojModal').hidden) renderJob(); }
  function hook() {
    const orig = window.dtRefresh;
    window.dtRefresh = function () { const r = orig ? orig.apply(this, arguments) : undefined; setTimeout(refreshAll, 0); if (!JOBS.loaded) setTimeout(() => loadJobs(), 0); return r; };
  }
  hook();
  document.addEventListener('DOMContentLoaded', () => {
    hookSave();
    const lw = $('qpdListWrap');
    if (lw && 'MutationObserver' in window) {
      let t = 0; new MutationObserver(() => { clearTimeout(t); t = setTimeout(refreshAll, 50); }).observe(lw, { childList: true });
    }
  });
  setTimeout(hookSave, 0);

  window.opsCardHtml = opsCardHtml;
  window.opsOpen = opsOpen;
  window.opsGoTab = opsGoTab;
  window.opsOpenList = opsGoTab;   // 互換（以前の一覧モーダルの入口）
  window.opsRenderBand = renderBand;
  window.opsRenderTab = renderTab;
  window.opsOpenJob = openJob;
  window.opsCreateJob = openCreate;
  window.opsReloadJobs = () => loadJobs(true);
  window.opsTemplateKeys = tplKeysOf;   // 試験・ほかの機能から
  window.opsAutoSync = () => autoSync(true);
  window.opsAutoApply = autoApply;   // 試験用
  window.opsSummaryOf = r => (isTarget(r) ? summary(stateOf(r)) : null);
})();
