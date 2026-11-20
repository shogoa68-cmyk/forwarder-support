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
    const st = { v: 1, tpl: keys.join('+'), s };
    ensureDl(st);
    return st;
  }

  // ---------- 📅 日程・締め切り（st.dl＝[{id,k,l,d,note,g,ok}]・作業 x.dk＝つないだ締め切りの id） ----------
  // k：種類のキー（free＝自由な名前 l）／d：日付（YYYY-MM-DD）／g：往路 0・復路 1／ok：つないだ作業が無い締め切りを手で「済み」にした印
  const DL_TYPES = {
    cy_open: ['CY オープン', 'export'], cy_cut: ['CY カット', 'export'], cfs_cut: ['CFS カット', 'export'], wh_cut: ['倉庫の搬入締め切り', 'export'],
    si_cut: ['SI カット', 'export'], vgm_cut: ['VGM カット', 'export'], etd: ['ETD（出港予定日）', 'export'],
    eta: ['ETA（入港予定日）', 'import'], ft_end: ['フリータイムの終わり', 'import'], pickup: ['搬出期限', 'import'], ret: ['空コンテナの返却期限', 'import'], deliv: ['配送日', 'import'],
    free: ['（自由な名前）', ''],
  };
  const DL_CUT = new Set(['cy_cut', 'cfs_cut', 'wh_cut', 'si_cut', 'vgm_cut', 'ft_end', 'pickup', 'ret', 'free']);   // 過ぎたら「期限切れ」にする締め切り（ほかは予定日＝過ぎたら灰色）
  const DL_DEF = {
    'exp-fcl': ['cy_open', 'cy_cut', 'si_cut', 'vgm_cut', 'etd'], 'exp-lcl': ['cfs_cut', 'wh_cut', 'si_cut', 'etd'], 'exp-air': ['wh_cut', 'etd'],
    'imp-fcl': ['eta', 'ft_end', 'pickup', 'ret', 'deliv'], 'imp-lcl': ['eta', 'ft_end', 'pickup', 'deliv'], 'imp-air': ['eta', 'pickup', 'deliv'],
    dom: ['deliv'], gen: ['etd', 'eta'],
  };
  // 作業の名前 → つなぐ締め切りの種類（ひな形の作業）
  const DL_STEP = [[/バンニング|CY 搬入/, 'cy_cut'], [/CFS 搬入/, 'cfs_cut'], [/^搬入の手配/, 'wh_cut'], [/SI（船積指示）/, 'si_cut'], [/本船出港|搭載・出発/, 'etd'],
    [/本船の入港/, 'eta'], [/D\/O の取得・搬出|貨物の引き取り/, 'pickup'], [/空コンテナの返却/, 'ret'], [/^配送$/, 'deliv']];
  const legOf = l => /^【復路】/.test(l || '') ? 1 : 0;
  const stripLeg = l => String(l || '').replace(/^【(往路|復路)】/, '');
  function dlLabel(st, x) {
    let l = x.k === 'free' ? (x.l || '（名前なし）') : (DL_TYPES[x.k] || [x.k])[0];
    const keys = String(st.tpl || '').split('+'), tk = keys[x.g || 0] || '';
    if (/-air$/.test(tk)) l = l.replace('出港予定日', '出発予定日').replace('入港予定日', '到着予定日');
    return (keys.length > 1 ? (x.g ? '【復路】' : '【往路】') : '') + l;
  }
  function ensureDl(st) {
    if (Array.isArray(st.dl)) return st;
    const keys = String(st.tpl || 'gen').split('+'), two = keys.length > 1;
    st.dl = [];
    keys.forEach((tk, g) => (DL_DEF[tk] || []).forEach(k => st.dl.push({ id: 'd' + newId().slice(1), k, l: '', d: '', note: '', g: two ? g : 0 })));
    (st.s || []).forEach(x => {
      if (x.dk) return;
      const m = DL_STEP.find(r => r[0].test(stripLeg(x.l))); if (!m) return;
      const dl = st.dl.find(d => d.k === m[1] && (d.g || 0) === (two ? legOf(x.l) : 0));
      if (dl) x.dk = dl.id;
    });
    return st;
  }
  const dlOf = st => (st && Array.isArray(st.dl)) ? st.dl : [];
  function addDays(ymd, n) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd); if (!m) return ''; const t = new Date(+m[1], +m[2] - 1, +m[3] + n); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
  function daysBetween(a, b) { const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }; return Math.round((p(b) - p(a)) / 86400000); }
  // 締め切りの状態：met（間に合った）／over（過ぎた）／soon（48 時間以内＝今日・明日）／later／past（予定日が過ぎた・知らせない）／none（日付なし）
  function dlState(st, x, today) {
    const linked = (st.s || []).filter(s => s.dk === x.id);
    if (x.ok || (linked.length && linked.every(s => s.d))) return 'met';
    if (!x.d) return 'none';
    today = today || todayStr();
    if (x.d < today) return DL_CUT.has(x.k) || linked.length ? 'over' : 'past';
    if (x.d <= addDays(today, 1)) return 'soon';
    return 'later';
  }
  function dlRemain(x, state, today) {
    if (state === 'met') return '✅ 済み';
    if (state === 'none') return '—';
    const n = daysBetween(today || todayStr(), x.d);
    if (n < 0) return state === 'past' ? '過ぎました' : '⚠ ' + (-n) + ' 日過ぎています';
    return n === 0 ? '今日' : n === 1 ? '明日' : 'あと ' + n + ' 日';
  }
  // ---- 🛰 COLINS（朝夕の自動確認の写し）からの締め切りの候補。勝手には書き換えず、［反映］で入れる ----
  const JST_MS = 9 * 3600000;
  function jstYmd(v) {
    const s0 = String(v == null ? '' : v).trim(); if (!s0) return '';
    let m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s0);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s0); if (!m) return '';
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s0)) return m[1] + '-' + m[2] + '-' + m[3];   // 時差の印が無い＝日本の日時として読む
    const t = Date.parse(s0); if (isNaN(t)) return '';
    const d = new Date(t + JST_MS);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  // 締め切りの種類 → 写しの項目（k の形）。min＝コンテナが複数あるときはいちばん早いもの
  const CAND = {
    cy_open: { re: /^v:.*:cyOpen$/, name: 'CYオープン' }, cy_cut: { re: /^v:.*:cyCut$/, name: 'CYカット' }, cfs_cut: { re: /^v:.*:cfsCut$/, name: 'CFSカット' },
    etd: { re: /^v:.*:pol:etd$/, name: '出港予定（ETD）' }, eta: { re: /^v:.*:pod:eta$/, tr: /^v:.*:tr(\d+)pod:eta$/, name: '入港予定（ETA）' },
    pickup: { re: /^c:.*:pickDue$/, min: true, name: '搬出期限' }, ret: { re: /^c:.*:retDue$/, min: true, name: '返却期限' },
  };
  function candOf(t, k) {
    const c = CAND[k], items = Array.isArray(t && t.snapshot) ? t.snapshot : []; if (!c) return null;
    let hits = items.filter(it => it && it.val && c.re.test(String(it.k || '')));
    if (c.tr) {   // 入港：積み替えがあれば最後の積み替え本船の入港予定
      const tr = items.filter(it => it && it.val && c.tr.test(String(it.k || '')));
      if (tr.length) hits = [tr.sort((a, b) => +c.tr.exec(b.k)[1] - +c.tr.exec(a.k)[1])[0]];
    }
    const vals = hits.map(it => ({ ymd: jstYmd(it.val), it })).filter(v => v.ymd);
    if (!vals.length) return null;
    vals.sort((a, b) => a.ymd.localeCompare(b.ymd));
    const v = c.min ? vals[0] : vals[0];
    return { ymd: v.ymd, src: 'COLINS の' + c.name + '（' + (v.it.scope || '') + '）' };
  }
  // st の締め切り x に当てはまる候補（往復は締め切りの往路／復路と、追跡の向きを合わせる）
  function dlCand(x, targets, dir) {
    if (!targets || !targets.length || !CAND[x.k]) return null;
    const ld = legDirs(dir)[x.g || 0] || '';
    for (const t of targets) {
      if (ld && t.direction && t.direction !== ld) continue;
      const c = candOf(t, x.k); if (c) return c;
    }
    return null;
  }
  // 画面に出す候補：日付が違い、無視していないもの
  const dlCandShow = (x, c) => !!c && c.ymd !== x.d && c.ymd !== x.cx;
  function ctxTargets(kind, id, shipId) {
    if (kind === 'quote' || kind === 'case') { const r = rowById(id); return { ts: r ? targetsForCase(r) : [], dir: r && r.data && r.data.fields ? r.data.fields['cond-direction'] : '' }; }
    const j = jobById(id); return { ts: j ? targetsForJob(j, shipId) : [], dir: j ? j.data.dir : '' };
  }
  // 作業の状態（チェックのほか）：''＝未着手／doing＝作業中／wait＝返事待ち（x.wn＝待っている相手）／x.who＝担当
  const WSTATE = [['', '未着手'], ['doing', '作業中'], ['wait', '返事待ち']];
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
    const nd = nearestDl(st, today);
    nextH += nd ? '<span class="ops-dl is-' + nd.state + '">📅 ' + esc(stripLeg(dlLabel(st, nd.x))) + ' ' + md(nd.x.d) + '</span>' : '';
    return '<div class="ops-card' + (sm.all ? ' is-all' : '') + (sm.overdue ? ' has-over' : '') + '">' +
      '<button type="button" class="ops-chip" onclick="event.stopPropagation();opsOpen(\'' + idAttr + '\')" title="受注後の業務の進み具合（押すとチェックリストを開きます）">' +
        '<span class="ops-lbl">📦 業務</span><span class="ops-segs" aria-hidden="true">' + segs + '</span>' +
        '<span class="ops-n">' + sm.done + '/' + sm.total + '</span>' + nextH + warn +
        (started ? '' : '<span class="ops-new">未着手</span>') +
      '</button></div>';
  }

  // いちばん近い、まだ済んでいない締め切り（過ぎたものが先）
  function nearestDl(st, today) {
    const xs = dlOf(st).map(x => ({ x, state: dlState(st, x, today) })).filter(o => o.state === 'over' || o.state === 'soon' || o.state === 'later');
    xs.sort((a, b) => (a.state === 'over' ? 0 : 1) - (b.state === 'over' ? 0 : 1) || a.x.d.localeCompare(b.x.d));
    return xs[0] || null;
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
      else if (act === 'card') toggleCard(b.dataset.id);
      else if (act === 'wstate') setWState(i, b.dataset.v);
      else if (act === 'whome') setWho(i, me());
      else if (act === 'gedit') { _cur.gedit = b.dataset.id; render(); const ta = $('opmBody').querySelector('.opc-g-in'); if (ta) ta.focus(); }
      else if (act === 'gcancel') { _cur.gedit = ''; render(); }
      else if (act === 'gsave') saveGuide(i);
      else if (act === 'nadd') addNote(i);
      else if (act === 'ndel') delNote(b.dataset.id);
      else if (act === 'dladd') dlAdd();
      else if (act === 'dlapply') { dlSetDate(i, b.dataset.v, '🛰 COLINS'); }
      else if (act === 'dlignore') { if (readOnly()) return; const x = dlOf(_cur.st)[i]; if (x) { x.cx = b.dataset.v; commit(); } }
      else if (act === 'dldel') dlDel(i);
    });
    ov.addEventListener('change', e => {
      const t = e.target;
      if (t.matches('.opm-due')) setDue(+t.dataset.i, t.value);
      else if (t.matches('.opc-who')) setWho(+t.dataset.i, t.value);
      else if (t.matches('.opc-wn')) { if (readOnly()) return; const x = _cur.st.s[+t.dataset.i]; if (x) { x.wn = t.value.trim().slice(0, 80); commit(); } }
      else if (t.matches('.opc-dk')) { if (readOnly()) return; const x = _cur.st.s[+t.dataset.i]; if (x) { x.dk = t.value; const dl = dlOf(_cur.st).find(d => d.id === x.dk); if (dl && dl.d && !x.d && !x.due) x.due = dl.d; commit(); } }
      else if (t.matches('.opm-dl-d')) dlSetDate(+t.dataset.i, t.value);
      else if (t.matches('.opm-dl-note')) { if (readOnly()) return; const x = dlOf(_cur.st)[+t.dataset.i]; if (x) { x.note = t.value.trim().slice(0, 80); commit(); } }
      else if (t.matches('.opm-dl-ok')) { if (readOnly()) return; const x = dlOf(_cur.st)[+t.dataset.i]; if (x) { x.ok = t.checked; commit(); } }
      else if (t.id === 'opmDlType') { const f = $('opmDlFree'); if (f) f.hidden = t.value !== 'free'; }
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
    if (!isJob && targetsForCase(rowById(_cur.id)).length || isJob && autoTargetOfJob(jobById(_cur.jobId), _cur.shipId)) h += '<p class="opm-auto">🛰 サイバーポートで追跡中：出港・入港の実績、空コンテナの返却が入ると、当てはまる作業に自動でチェックが入ります（朝夕の自動確認の結果から）。</p>';
    if (lockedBy) h += '<p class="opm-lock">🔒 ' + esc(nameOf(lockedBy)) + ' さんがこの案件を編集中のため、いまは見るだけです。</p>';
    else if (ro) h += '<p class="opm-lock">ログインすると記録できます。</p>';
    h += '<div class="opm-prog"><div class="opm-bar"><span style="width:' + pct + '%"></span></div><b>' + sm.done + ' / ' + sm.total + ' 完了</b>' +
      (sm.overdue ? '<span class="ops-warn">⚠ 期限切れ ' + sm.overdue + '</span>' : '') + (tplName(st) ? '<small>ひな形：' + esc(tplName(st)) + '</small>' : '') + '</div>';
    h += dlSecHtml(st, ro, today);
    h += '<h4 class="opm-sec-h">☑ 作業<small>作業名を押すと、手順・担当・やりとりのカードが開きます</small></h4>';
    h += '<ol class="opm-steps">' + st.s.map((x, i) => {
      const isNext = sm.next === x, open = _cur.open === x.id;
      return '<li class="opm-step' + (x.d ? ' is-done' : '') + (isNext ? ' is-next' : '') + (open ? ' is-open' : '') + (x.w === 'wait' && !x.d ? ' is-wait' : '') + '">' +
        '<button type="button" class="opm-chk" data-opm="toggle" data-i="' + i + '" role="checkbox" aria-checked="' + x.d + '"' + (ro ? ' disabled' : '') + ' title="' + (x.d ? '完了を取り消す' : '完了にする') + '">' + (x.d ? '✓' : '') + '</button>' +
        '<div class="opm-step-main"><button type="button" class="opm-step-l" data-opm="card" data-id="' + esc(x.id) + '" aria-expanded="' + open + '">' + (isNext ? '<em class="opm-next-tag">次</em>' : '') + esc(x.l) + '<span class="opm-caret" aria-hidden="true">' + (open ? '▾' : '▸') + '</span></button>' +
          stepBadges(x, st) +
          (x.d && x.at ? '<small class="opm-done-by">✓ ' + esc(whenText(x.at)) + (x.by ? ' ' + esc(nameOf(x.by)) : '') + (x.src ? '（' + esc(x.src) + '）' : '') + '</small>' : '') + '</div>' +
        (x.d ? '' : '<label class="opm-due-w' + dueCls(x.due, today) + '"><span>期限</span><input type="date" class="opm-due" data-i="' + i + '" value="' + esc(x.due || '') + '"' + (ro ? ' disabled' : '') + '></label>') +
        (ro ? '' : '<span class="opm-tools">' +
          '<button type="button" data-opm="rename" data-i="' + i + '" title="作業名を変える">✎</button>' +
          '<button type="button" data-opm="up" data-i="' + i + '" title="上へ"' + (i ? '' : ' disabled') + '>▲</button>' +
          '<button type="button" data-opm="down" data-i="' + i + '" title="下へ"' + (i < st.s.length - 1 ? '' : ' disabled') + '>▼</button>' +
          '<button type="button" data-opm="del" data-i="' + i + '" title="この作業を消す">✕</button></span>') +
        (open ? cardHtml(x, i, st, ro) : '') +
        '</li>';
    }).join('') + '</ol>';
    if (!st.s.length) h += '<p class="opm-empty">作業がありません。下から足してください。</p>';
    if (!ro) h += '<div class="opm-add"><input type="text" id="opmAddIn" maxlength="60" placeholder="作業を追加（例：保険の手配）"><button type="button" class="opm-btn" data-opm="add">＋ 追加</button></div>';
    if (!isJob) h += idSecHtml('case', _cur.id);
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
      const r = rowById(id); _cur.st = r ? ensureDl(JSON.parse(JSON.stringify(stateOf(r)))) : _cur.st; render();
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
  // ================================================================
  // 🗂 作業カード（手順メモ・担当・状態・やりとり）と 📅 日程・締め切りの欄
  // ================================================================
  const linkify = t => esc(t).replace(/https?:\/\/[^\s<>"']+/g, u => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>').replace(/\n/g, '<br>');
  const isMissingRel = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /(does not exist|Could not find the table)/i.test(e.message || ''));
  const guideKey = l => stripLeg(l).normalize('NFKC').replace(/\s+/g, '').toLowerCase().slice(0, 120);
  const GUIDE = { map: new Map(), loaded: false, loading: false, missing: false };
  async function loadGuides(force) {
    const c = client(); if (!c || GUIDE.loading || (GUIDE.loaded && !force)) return;
    GUIDE.loading = true;
    try {
      const { data, error } = await c.from('ops_guides').select('key,label,body,updated_by,updated_at').limit(2000);
      if (error) { if (isMissingRel(error)) GUIDE.missing = true; }
      else { GUIDE.map = new Map((data || []).map(g => [g.key, g])); GUIDE.missing = false; }
      GUIDE.loaded = true;
    } catch (e) { /* 何もしない */ }
    GUIDE.loading = false;
    if (_cur) render();
  }
  const NOTES = { target: '', list: [], loading: false, missing: false, err: '' };
  const curTarget = () => !_cur ? '' : _cur.kind === 'job' ? 'j:' + _cur.jobId + (_cur.shipId ? ':' + _cur.shipId : '') : 'q:' + _cur.id;
  async function loadNotes() {
    const c = client(), t = curTarget(); if (!c || !t) return;
    NOTES.loading = true; NOTES.target = t; NOTES.err = '';
    try {
      const { data, error } = await c.from('ops_notes').select('id,step_id,body,created_by,created_at').eq('target', t).order('created_at', { ascending: true }).limit(1000);
      if (curTarget() !== t) return;
      if (error) { if (isMissingRel(error)) NOTES.missing = true; else NOTES.err = error.message || error.code || ''; NOTES.list = []; }
      else { NOTES.list = data || []; NOTES.missing = false; }
    } catch (e) { NOTES.err = String(e && e.message || e); }
    NOTES.loading = false;
    if (_cur) render();
  }
  const notesOf = x => NOTES.target === curTarget() ? NOTES.list.filter(n => n.step_id === x.id) : [];
  const members = () => { try { return typeof window.cloudTeamMembers === 'function' ? window.cloudTeamMembers() : []; } catch (e) { return []; } };
  function stepBadges(x, st) {
    const b = [];
    if (x.who) b.push('<span class="opm-b opm-b-who" title="担当">👤 ' + esc(nameOf(x.who)) + '</span>');
    if (!x.d && x.w === 'doing') b.push('<span class="opm-b opm-b-doing">作業中</span>');
    if (!x.d && x.w === 'wait') b.push('<span class="opm-b opm-b-wait" title="返事待ち">⏳ 返事待ち' + (x.wn ? '：' + esc(x.wn) : '') + '</span>');
    const dl = x.dk ? dlOf(st).find(d => d.id === x.dk) : null;
    if (dl) b.push('<span class="opm-b opm-b-dl is-' + dlState(st, dl) + '" title="つないだ締め切り">📅 ' + esc(stripLeg(dlLabel(st, dl))) + (dl.d ? ' ' + md(dl.d) : '') + '</span>');
    const n = notesOf(x).length; if (n) b.push('<span class="opm-b" title="やりとり・記録">💬 ' + n + '</span>');
    if (GUIDE.map.get(guideKey(x.l)) && GUIDE.map.get(guideKey(x.l)).body) b.push('<span class="opm-b" title="手順メモがあります">📖</span>');
    return b.length ? '<span class="opm-badges">' + b.join('') + '</span>' : '';
  }
  function cardHtml(x, i, st, ro) {
    const logged = typeof window.cloudIsLoggedIn === 'function' && window.cloudIsLoggedIn();
    const dis = ro ? ' disabled' : '';
    let h = '<div class="opm-card" data-step="' + esc(x.id) + '">';
    // 状態・担当
    h += '<div class="opc-row"><span class="opc-l">状態</span>' + (x.d
      ? '<span class="opc-done">✅ 済み' + (x.at ? '（' + esc(whenText(x.at)) + (x.by ? ' ' + esc(nameOf(x.by)) : '') + '）' : '') + '</span>'
      : '<span class="opc-seg" role="group" aria-label="状態">' + WSTATE.map(w => '<button type="button" data-opm="wstate" data-i="' + i + '" data-v="' + w[0] + '" aria-pressed="' + ((x.w || '') === w[0]) + '"' + dis + '>' + w[1] + '</button>').join('') + '</span>') + '</div>';
    if (!x.d && x.w === 'wait') h += '<div class="opc-row"><span class="opc-l">待っている相手</span><input type="text" class="opc-wn" data-i="' + i + '" maxlength="80" value="' + esc(x.wn || '') + '" placeholder="例）お客様（INV の確認）"' + dis + '></div>';
    const ms = members(); if (x.who && ms.indexOf(x.who) < 0) ms.push(x.who);
    h += '<div class="opc-row"><span class="opc-l">担当</span><select class="opc-who" data-i="' + i + '"' + dis + '><option value="">（決めていない）</option>' +
      ms.map(e => '<option value="' + esc(e) + '"' + (x.who === e ? ' selected' : '') + '>' + esc(nameOf(e)) + '</option>').join('') + '</select>' +
      (!ro && x.who !== me() ? '<button type="button" class="opm-link" data-opm="whome" data-i="' + i + '">自分にする</button>' : '') + '</div>';
    const dls = dlOf(st).filter(d => (d.g || 0) === (String(st.tpl || '').split('+').length > 1 ? legOf(x.l) : 0));
    h += '<div class="opc-row"><span class="opc-l">締め切り</span><select class="opc-dk" data-i="' + i + '"' + dis + '><option value="">（つながない）</option>' +
      dls.map(d => '<option value="' + esc(d.id) + '"' + (x.dk === d.id ? ' selected' : '') + '>' + esc(dlLabel(st, d)) + (d.d ? '（' + md(d.d) + '）' : '') + '</option>').join('') + '</select>' +
      '<small class="opc-hint">締め切りの日付を入れると、この作業の期限にも入ります</small></div>';
    // 手順メモ
    const g = GUIDE.map.get(guideKey(x.l)), editing = _cur.gedit === x.id;
    h += '<div class="opc-sec"><h5>📖 この作業の手順<small>同じ名前の作業すべてに出ます（チームで共有）</small></h5>';
    if (GUIDE.missing) h += '<p class="opc-miss">手順メモを使うには、管理者が Supabase で <code>docs/sql/ops-cards.sql</code> を実行してください。</p>';
    else if (editing) h += '<textarea class="opc-g-in" rows="6" maxlength="4000" placeholder="例）&#10;1. 船会社の SI 提出画面で入力（https://…）&#10;2. 荷主に B/L ドラフトを送って確認&#10;注意：○○社は HS コードを必ず記載">' + esc(g ? g.body : '') + '</textarea>' +
      '<div class="opc-acts"><button type="button" class="opm-link" data-opm="gcancel">やめる</button><button type="button" class="opm-btn opm-btn-pri" data-opm="gsave" data-i="' + i + '">保存</button></div>';
    else h += (g && g.body ? '<div class="opc-guide">' + linkify(g.body) + '</div><small class="opc-meta">最後に直した人：' + esc(nameOf(g.updated_by)) + (g.updated_at ? '（' + esc(whenText(g.updated_at)) + '）' : '') + '</small>' : '<p class="opc-empty">まだ手順がありません。やり方・使うページ・注意点を書いておくと、ほかの人も同じように進められます。</p>') +
      (logged ? '<div class="opc-acts"><button type="button" class="opm-link" data-opm="gedit" data-id="' + esc(x.id) + '">✎ 手順を' + (g && g.body ? '直す' : '書く') + '</button></div>' : '');
    h += '</div>';
    // やりとり
    h += '<div class="opc-sec"><h5>💬 やりとり・記録<small>この作業のメモ・連絡の記録（チームで共有・追記だけ）</small></h5>';
    if (NOTES.missing) h += '<p class="opc-miss">やりとりを残すには、管理者が Supabase で <code>docs/sql/ops-cards.sql</code> を実行してください。</p>';
    else {
      const ns = notesOf(x);
      if (NOTES.loading && NOTES.target === curTarget()) h += '<p class="opc-empty">読み込み中…</p>';
      else if (NOTES.err) h += '<p class="opc-miss">読み込めませんでした：' + esc(NOTES.err) + '</p>';
      h += ns.length ? '<ul class="opc-notes">' + ns.map(n => '<li><div class="opc-n-h"><b>' + esc(nameOf(n.created_by)) + '</b><small>' + esc(whenText(n.created_at)) + '</small>' +
        (n.created_by && n.created_by === me() ? '<button type="button" class="opc-n-del" data-opm="ndel" data-id="' + esc(n.id) + '" title="この記録を消す">✕</button>' : '') + '</div><div class="opc-n-b">' + linkify(n.body) + '</div></li>').join('') + '</ul>' : '';
      if (logged) h += '<div class="opc-n-add"><textarea class="opc-n-in" data-i="' + i + '" rows="2" maxlength="2000" placeholder="例）お客様に INV の確認を依頼（11/20）"></textarea><button type="button" class="opm-btn" data-opm="nadd" data-i="' + i + '">記録する</button></div>';
    }
    return h + '</div></div>';
  }
  function toggleCard(id) {
    if (!_cur) return;
    _cur.open = _cur.open === id ? '' : id; _cur.gedit = '';
    if (_cur.open) { loadGuides(); if (NOTES.target !== curTarget() && !NOTES.loading) loadNotes(); }
    render();
  }
  function setWState(i, v) {
    if (readOnly()) return; const x = _cur.st.s[i]; if (!x || x.d) return;
    x.w = v || ''; if (x.w !== 'wait') delete x.wn;
    if (!x.w) delete x.w;
    commit(x.w === 'wait' ? '⏳ 業務：「' + x.l + '」を返事待ちに' : '');
  }
  function setWho(i, email) {
    if (readOnly()) return; const x = _cur.st.s[i]; if (!x) return;
    if ((x.who || '') === (email || '')) return;
    if (email) x.who = email; else delete x.who;
    commit(email ? '👤 業務：「' + x.l + '」の担当を ' + nameOf(email) + ' に' : '');
  }
  async function saveGuide(i) {
    const x = _cur && _cur.st.s[i], c = client(); if (!x || !c) return;
    const ta = $('opmBody').querySelector('.opc-g-in'); const body = (ta ? ta.value : '').replace(/\s+$/, '');
    const key = guideKey(x.l); if (!key) return;
    const { data, error } = await c.from('ops_guides').upsert({ key, label: stripLeg(x.l), body }, { onConflict: 'key' }).select('key,label,body,updated_by,updated_at');
    if (error) { if (isMissingRel(error)) GUIDE.missing = true; toast('⚠️ 手順を保存できませんでした：' + (error.message || error.code), 'warn', 5000); render(); return; }
    const row = (data && data[0]) || { key, label: stripLeg(x.l), body, updated_by: me(), updated_at: new Date().toISOString() };
    GUIDE.map.set(key, row); if (_cur) _cur.gedit = '';
    toast('📖 手順を保存しました（同じ名前の作業すべてに出ます）', 'success', 3000); render();
  }
  async function addNote(i) {
    const x = _cur && _cur.st.s[i], c = client(); if (!x || !c) return;
    const ta = $('opmBody').querySelector('.opc-n-in[data-i="' + i + '"]'); const body = (ta ? ta.value : '').trim();
    if (!body) { if (ta) ta.focus(); return; }
    const t = curTarget();
    const { data, error } = await c.from('ops_notes').insert({ target: t, step_id: x.id, body }).select('id,step_id,body,created_by,created_at');
    if (error) { if (isMissingRel(error)) NOTES.missing = true; toast('⚠️ 記録できませんでした：' + (error.message || error.code), 'warn', 5000); render(); return; }
    if (NOTES.target === t) NOTES.list.push((data && data[0]) || { id: 'tmp' + Date.now(), step_id: x.id, body, created_by: me(), created_at: new Date().toISOString() });
    render();
    const n = $('opmBody').querySelector('.opc-n-in[data-i="' + i + '"]'); if (n) n.focus();
  }
  async function delNote(id) {
    const c = client(); if (!c) return;
    const ok = typeof window.uiConfirm === 'function' ? await window.uiConfirm({ title: 'この記録を消しますか？', lines: ['消した記録は元に戻せません。'], okLabel: '消す', danger: true }) : true;
    if (!ok) return;
    const { error } = await c.from('ops_notes').delete().eq('id', id);
    if (error) { toast('⚠️ 消せませんでした：' + (error.message || error.code), 'warn', 4000); return; }
    NOTES.list = NOTES.list.filter(n => n.id !== id); render();
  }
  // ---- 📅 日程・締め切りの欄 ----
  function dlSecHtml(st, ro, today) {
    const dls = dlOf(st), two = String(st.tpl || '').split('+').length > 1, dis = ro ? ' disabled' : '';
    const ctx = _cur.kind === 'job' ? ctxTargets('job', _cur.jobId, _cur.shipId) : ctxTargets('case', _cur.id);
    let h = '<section class="opm-dl"><h4 class="opm-sec-h">📅 日程・締め切り<small>赤＝過ぎた・黄＝48 時間以内。作業とつないだ締め切りは、その作業が済むと「済み」になります</small></h4>';
    h += dls.length ? '<div class="opm-dl-list">' + dls.map((x, i) => {
      const state = dlState(st, x, today), linked = (st.s || []).filter(s => s.dk === x.id);
      return '<div class="opm-dl-row is-' + state + '"><span class="opm-dl-l">' + esc(dlLabel(st, x)) + '</span>' +
        '<input type="date" class="opm-dl-d" data-i="' + i + '" value="' + esc(x.d || '') + '" aria-label="' + esc(dlLabel(st, x)) + 'の日付"' + dis + '>' +
        '<span class="opm-dl-st">' + dlRemain(x, state, today) + '</span>' +
        (linked.length ? '<span class="opm-dl-link" title="つないだ作業">→ ' + linked.map(s => esc(stripLeg(s.l)) + (s.d ? ' ✓' : '')).join('、') + '</span>'
          : '<label class="opm-dl-okw"><input type="checkbox" class="opm-dl-ok" data-i="' + i + '"' + (x.ok ? ' checked' : '') + dis + '> 済み</label>') +
        '<input type="text" class="opm-dl-note" data-i="' + i + '" maxlength="80" value="' + esc(x.note || '') + '" placeholder="メモ" aria-label="メモ"' + dis + '>' +
        (ro ? '' : '<button type="button" class="opm-dl-x" data-opm="dldel" data-i="' + i + '" title="この締め切りを消す">✕</button>') +
        (() => { const c = dlCand(x, ctx.ts, ctx.dir);
          if (dlCandShow(x, c)) return '<div class="opm-dl-cand"><span>🛰 ' + (x.d ? 'COLINS の日付が違います：<b>' + md(c.ymd) + '</b>（いまは ' + md(x.d) + '）' : 'COLINS に日付があります：<b>' + md(c.ymd) + '</b>') + '<small>' + esc(c.src) + '</small></span>' +
            (ro ? '' : '<button type="button" class="opm-btn" data-opm="dlapply" data-i="' + i + '" data-v="' + c.ymd + '">反映する</button><button type="button" class="opm-link" data-opm="dlignore" data-i="' + i + '" data-v="' + c.ymd + '">このままにする</button>') + '</div>';
          if (c && c.ymd === x.d) return '<div class="opm-dl-cand is-same"><small>🛰 COLINS と同じ日付（' + esc(c.src) + '）</small></div>';
          return ''; })() + '</div>';
    }).join('') + '</div>' : '<p class="opm-empty">締め切りがありません。下から足してください。</p>';
    if (!ro) h += '<div class="opm-dl-add"><select id="opmDlType" aria-label="締め切りの種類">' + Object.keys(DL_TYPES).map(k => '<option value="' + k + '">' + esc(DL_TYPES[k][0]) + '</option>').join('') + '</select>' +
      (two ? '<select id="opmDlLeg" aria-label="往路・復路"><option value="0">往路</option><option value="1">復路</option></select>' : '') +
      '<input type="text" id="opmDlFree" maxlength="40" placeholder="名前（例：通関書類の提出）" hidden><button type="button" class="opm-btn" data-opm="dladd">＋ 締め切りを追加</button></div>';
    return h + '</section>';
  }
  function dlSetDate(i, v, via) {
    if (readOnly()) return; const x = dlOf(_cur.st)[i]; if (!x) return;
    const old = x.d || ''; x.d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; delete x.cx;
    // つないだ作業の期限：空か、前の締め切りの日付のままなら、新しい日付にそろえる（手で決めた期限は変えない）
    _cur.st.s.forEach(s => { if (s.dk === x.id && !s.d && (!s.due || s.due === old)) s.due = x.d; });
    commit(x.d ? '📅 業務：' + dlLabel(_cur.st, x) + ' を ' + md(x.d) + ' に' + (via ? '（' + via + ' の日付を反映' + (old ? '・前は ' + md(old) : '') + '）' : '') : '');
  }
  function dlAdd() {
    if (readOnly()) return;
    const k = ($('opmDlType') || {}).value || 'free', g = +(($('opmDlLeg') || {}).value || 0), l = (($('opmDlFree') || {}).value || '').trim();
    if (k === 'free' && !l) { const f = $('opmDlFree'); if (f) { f.hidden = false; f.focus(); } return; }
    ensureDl(_cur.st).dl.push({ id: 'd' + newId().slice(1), k, l: k === 'free' ? l : '', d: '', note: '', g });
    commit();
  }
  async function dlDel(i) {
    if (readOnly()) return; const x = dlOf(_cur.st)[i]; if (!x) return;
    const ok = typeof window.uiConfirm === 'function' ? await window.uiConfirm({ title: '締め切りを消しますか？', lines: ['「' + dlLabel(_cur.st, x) + '」を消します。つないだ作業の期限はそのまま残ります。'], okLabel: '消す', danger: true }) : true;
    if (!ok || !_cur) return;
    _cur.st.dl.splice(i, 1); _cur.st.s.forEach(s => { if (s.dk === x.id) delete s.dk; }); commit();
  }
  function onOpenCard() { NOTES.target = ''; NOTES.list = []; loadGuides(); loadNotes(); }

  function opsOpen(idAttr) {
    const id = decodeURIComponent(idAttr), r = rowById(id);
    if (!r) { toast('⚠️ 案件が見つかりません', 'warn'); return; }
    ensureModal();
    _cur = { id, st: ensureDl(JSON.parse(JSON.stringify(stateOf(r)))) };
    onOpenCard();
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
    _cur = { kind: 'job', jobId, shipId: shipId || '', st: ensureDl(JSON.parse(JSON.stringify(sh ? sh.st : j.data.st))) };
    onOpenCard();
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
      mine: active.filter(x => mineOf(x)),
      done: all.filter(x => x.sm.all),
      all,
      _today: today,
    };
  }
  const mineOf = x => { const m = me(); return !!m && stsOf(x).some(o => (o.st.s || []).some(s => !s.d && s.who === m)); };
  // 一覧の 1 件に含まれるチェックリスト（レギュラーは済んでいない便のすべて）
  function stsOf(x) {
    if (x.src === 'regular') return (x.job.data.ships || []).filter(sh => !summary(sh.st).all).map(sh => ({ st: sh.st, ship: sh }));
    return [{ st: x.st, ship: null }];
  }
  // 全進行の締め切り（済み・日付なし・予定日が過ぎたものは除く）
  function collectDl(all) {
    const today = todayStr(), out = [];
    (all || collect()).filter(x => !x.sm.all).forEach(x => stsOf(x).forEach(o => dlOf(o.st).forEach(d => {
      const state = dlState(o.st, d, today);
      if (state === 'over' || state === 'soon' || state === 'later') out.push({ x, ship: o.ship, st: o.st, d, state });
    })));
    out.sort((a, b) => (a.state === 'over' ? 0 : 1) - (b.state === 'over' ? 0 : 1) || a.d.d.localeCompare(b.d.d));
    return out;
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
      (() => { const dl = collectDl(g.all), n = dl.filter(o => o.state !== 'later').length, ov = dl.some(o => o.state === 'over');
        return n ? '<button type="button" class="ops-band-b ' + (ov ? 'is-over' : 'is-today') + '" data-ops-list="dl" title="CY カット・搬入締め切り・ETA など（過ぎたもの・今日・明日）">📅 締め切り 48時間以内 <b>' + n + '</b></button>' : ''; })() +
      '<button type="button" class="ops-band-b" data-ops-list="done">完了 <b>' + g.done.length + '</b></button>' +
      '<button type="button" class="ops-band-go" data-ops-list="active">進行管理を開く ›</button>';
  }

  // ---------- ④「📦 進行管理」タブ（#tab-ops・独立した画面） ----------
  const TAB = { f: 'active', src: '', q: '', sort: 'due', loading: false, asked: false };
  const FILTERS = [['active', '進行中'], ['over', '⚠ 期限切れ'], ['today', '今日まで'], ['week', '7日以内'], ['dl', '📅 締め切り'], ['mine', '👤 自分の担当'], ['nodue', '期限なし'], ['done', '完了'], ['all', 'すべて']];
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
      else if (a === 'dlopen') { if (b.dataset.src === 'quote') opsOpen(id); else openJobSteps(decodeURIComponent(id), b.dataset.ship || ''); }
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
    if (!AUTO.loaded && !AUTO.busy && !AUTO.missing) autoRefreshTargets();   // 締め切りの COLINS の候補のため
    if (!rowsAll().length && !TAB.asked && typeof window.cloudListPresets === 'function') {   // まだ案件一覧を読んでいない（見積タブを開いていない）
      TAB.asked = true; TAB.loading = true;
      Promise.resolve(window.cloudListPresets(true)).catch(() => {}).then(() => { TAB.loading = false; renderTab(); });
    }
    const all0 = collect();
    const all = TAB.src ? all0.filter(x => x.src === TAB.src) : all0;
    const g = groupsOf(all), today = g._today;
    const q = norm(TAB.q);
    let list = g[TAB.f] || g.active;
    const qId = normId(TAB.q);   // 基幹 ID は「ー」「－」などもハイフンにそろえて探す
    if (q) list = list.filter(x => norm(x.title + ' ' + x.customer + ' ' + idsOf(x).join(' ') + ' ' + (x.st.s || []).map(s => s.l).join(' ')).includes(q) || idsOf(x).some(id => id.includes(qId)));
    list = sortRows(list);
    const dlAll = collectDl(all);
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
      (() => { const n = dlAll.filter(o => o.state !== 'later').length, nc = collectCand(all).length; return tile('dl', '📅 締め切り 48h' + (nc ? ' <em class="opt-cand-n" title="COLINS に新しい日付がある締め切り">🛰 ' + nc + '</em>' : ''), n, dlAll.some(o => o.state === 'over') ? 'is-over' : n ? 'is-today' : ''); })() +
      tile('done', '完了', g.done.length, 'is-done') + '</div>';
    h += '<div class="opt-bar"><div class="opt-chips" role="group" aria-label="種類">' + SRCS.map(sv => {
        const n = sv[0] ? all0.filter(x => x.src === sv[0]).length : all0.length;
        return '<button type="button" class="opt-chip opt-chip-src' + (TAB.src === sv[0] ? ' is-on' : '') + '" data-opt="src" data-src="' + sv[0] + '" aria-pressed="' + (TAB.src === sv[0]) + '">' + sv[1] + ' <b>' + n + '</b></button>';
      }).join('') + '</div>' +
      '<div class="opt-chips">' + FILTERS.filter(f => !['active', 'over', 'today', 'week', 'done', 'dl'].includes(f[0])).map(f =>
        '<button type="button" class="opt-chip' + (TAB.f === f[0] ? ' is-on' : '') + '" data-opt="f" data-f="' + f[0] + '" aria-pressed="' + (TAB.f === f[0]) + '">' + f[1] + ' <b>' + g[f[0]].length + '</b></button>').join('') + '</div>' +
      '<input type="search" id="optQ" class="opt-q" placeholder="🔍 案件名・お客様・基幹 ID・作業名で探す" value="' + esc(TAB.q) + '" aria-label="検索">' +
      '<label class="opt-sort"><span>並び順</span><select id="optSort">' + SORTS.map(s => '<option value="' + s[0] + '"' + (TAB.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>').join('') + '</select></label></div>';
    if ((TAB.loading || JOBS.loading) && !all0.length) h += '<div class="opt-empty">読み込み中…</div>';
    else if (!all0.length) h += '<div class="opt-empty">まだ進行はありません。<br><small>見積ダッシュボードで案件のステータスを「受注」にするか、［＋ 進行を作る］でスポット・レギュラーの進行を作ってください。</small><br>' +
      (canNew ? '<button type="button" class="opt-btn opt-btn-pri" data-opt="new">＋ 進行を作る</button> ' : '') + '<button type="button" class="opt-btn opt-btn-pri" data-opt="dash">💼 見積ダッシュボードへ</button></div>';
    else if (TAB.f === 'dl') h += dlListHtml(dlAll, q, today, collectCand(all));
    else if (!list.length) h += '<div class="opt-empty">当てはまる進行はありません。</div>';
    else h += '<ul class="opt-list">' + list.map(x => rowHtml(x, today)).join('') + '</ul>';
    const hadFocus = document.activeElement && document.activeElement.id === 'optQ';
    const pos = hadFocus ? document.activeElement.selectionStart : 0;
    root.innerHTML = h;
    if (hadFocus || keepSearch) { const qi = $('optQ'); if (qi && hadFocus) { qi.focus(); try { qi.setSelectionRange(pos, pos); } catch (e) {} } }
  }
  // 「📅 締め切り」の表示：過ぎた／今日・明日／7 日以内／それ以降 に分けて、日付の順に
  // COLINS の日付が、入っている日付と違う（または空の）締め切り
  function collectCand(all) {
    const out = [];
    (all || collect()).filter(x => !x.sm.all && x.src !== 'regular').forEach(x => {
      const ctx = ctxTargets(x.src === 'quote' ? 'case' : 'job', x.id); if (!ctx.ts.length) return;
      dlOf(x.st).forEach(d => { if (dlState(x.st, d) === 'met') return; const c = dlCand(d, ctx.ts, ctx.dir); if (dlCandShow(d, c)) out.push({ x, st: x.st, d, c }); });
    });
    return out;
  }
  function dlListHtml(dlAll, q, today, cands) {
    let xs = dlAll;
    let ch = '';
    if (cands && cands.length) ch = '<h3 class="opt-dl-h is-cand">🛰 COLINS に新しい日付があります <b>' + cands.length + '</b><small>チェックリストを開いて［反映する］か［このままにする］を選んでください</small></h3><ul class="opt-dl">' + cands.map(o =>
      '<li class="opt-dl-row is-cand"><span class="opt-dl-date">' + md(o.c.ymd) + '<small>' + (o.d.d ? 'いまは ' + md(o.d.d) : 'いまは空') + '</small></span>' +
      '<span class="opt-dl-k">' + esc(dlLabel(o.st, o.d)) + '<small>' + esc(o.c.src) + '</small></span>' +
      '<span class="opt-dl-case"><span class="opt-kind opt-kind-' + o.x.src + '">' + KIND_LBL[o.x.src] + '</span><b>' + esc(o.x.title || '（名前なし）') + '</b>' + (o.x.customer ? '<small>' + esc(o.x.customer) + '</small>' : '') + '</span><span></span>' +
      '<button type="button" class="opt-btn" data-opt="dlopen" data-src="' + o.x.src + '" data-id="' + esc(encodeURIComponent(o.x.id)) + '" data-ship="">☑ 開く</button></li>').join('') + '</ul>';
    if (q) xs = xs.filter(o => norm(o.x.title + ' ' + o.x.customer + ' ' + dlLabel(o.st, o.d) + ' ' + (o.d.note || '') + ' ' + (o.ship ? o.ship.label : '')).includes(q));
    if (!xs.length) return ch + '<div class="opt-empty">これからの締め切りはありません。<br><small>チェックリストの「📅 日程・締め切り」に CY カット・ETA などの日付を入れると、ここに並びます。</small></div>';
    const wk = addDays(today, 7);
    const secs = [['over', '⚠ 過ぎた締め切り', o => o.state === 'over'], ['soon', '今日・明日', o => o.state === 'soon'], ['week', '7 日以内', o => o.state === 'later' && o.d.d <= wk], ['later', 'それ以降', o => o.state === 'later' && o.d.d > wk]];
    return ch + secs.map(sv => {
      const rows = xs.filter(sv[2]); if (!rows.length) return '';
      return '<h3 class="opt-dl-h is-' + sv[0] + '">' + sv[1] + ' <b>' + rows.length + '</b></h3><ul class="opt-dl">' + rows.map(o => {
        const linked = (o.st.s || []).filter(s => s.dk === o.d.id);
        return '<li class="opt-dl-row is-' + o.state + '"><span class="opt-dl-date">' + md(o.d.d) + '<small>' + dlRemain(o.d, o.state, today) + '</small></span>' +
          '<span class="opt-dl-k">' + esc(dlLabel(o.st, o.d)) + (o.d.note ? '<small>' + esc(o.d.note) + '</small>' : '') + '</span>' +
          '<span class="opt-dl-case"><span class="opt-kind opt-kind-' + o.x.src + '">' + KIND_LBL[o.x.src] + '</span><b>' + esc(o.x.title || '（名前なし）') + '</b>' + (o.ship ? '<small>' + esc(o.ship.label || '') + '</small>' : '') + (o.x.customer ? '<small>' + esc(o.x.customer) + '</small>' : '') + '</span>' +
          '<span class="opt-dl-step">' + (linked.length ? linked.map(s => '作業：' + esc(stripLeg(s.l)) + (s.who ? '（👤 ' + esc(nameOf(s.who)) + '）' : '') + (s.w === 'wait' ? ' ⏳' : '')).join('<br>') : '') + '</span>' +
          '<button type="button" class="opt-btn" data-opt="dlopen" data-src="' + o.x.src + '" data-id="' + esc(encodeURIComponent(o.x.id)) + '" data-ship="' + esc(o.ship ? o.ship.id : '') + '">☑ 開く</button></li>';
      }).join('') + '</ul>';
    }).join('');
  }
  function segsHtml(st, today) {
    return (st.s || []).map(s => '<i class="' + (s.d ? 'is-done' : (s.due && s.due < today ? 'is-over' : '')) + '" title="' + esc(s.l + (s.d ? '（済み）' : (s.due ? '（期限 ' + md(s.due) + '）' : ''))) + '"></i>').join('');
  }
  function nextHtml(sm, today) {
    const nx = sm.next;
    return (sm.all ? '<span class="ops-next is-all">✅ すべて完了</span>' : (nx ? '次：<b>' + esc(nx.l) + '</b>' + (nx.due ? '<span class="ops-due' + dueCls(nx.due, today) + '">期限 ' + md(nx.due) + '</span>' : '') +
      (nx.w === 'wait' ? '<span class="ops-wait">⏳ 返事待ち</span>' : nx.w === 'doing' ? '<span class="ops-doing">作業中</span>' : '') + (nx.who ? '<span class="ops-who">👤 ' + esc(nameOf(nx.who)) + '</span>' : '') : '')) +
      (sm.overdue ? ' <span class="ops-warn">⚠ 期限切れ ' + sm.overdue + '</span>' : '');
  }
  function dlBadge(x, today) {
    const best = stsOf(x).map(o => ({ o, n: nearestDl(o.st, today) })).filter(v => v.n).sort((a, b) => (a.n.state === 'over' ? 0 : 1) - (b.n.state === 'over' ? 0 : 1) || a.n.x.d.localeCompare(b.n.x.d))[0];
    return best ? ' <span class="ops-dl is-' + best.n.state + '">📅 ' + esc(stripLeg(dlLabel(best.o.st, best.n.x))) + ' ' + md(best.n.x.d) + '</span>' : '';
  }
  function idsOf(x) {
    if (x.src === 'quote') { const f = (x.r && x.r.data && x.r.data.fields) || {}; return [f['qf-core-ref'], f['qf-core-ref2']].map(normId).filter(Boolean); }
    return x.job ? [x.job.data.coreId, x.job.data.coreId2].map(normId).filter(Boolean) : [];
  }
  function rowHtml(x, today) {
    const sm = x.sm, id = esc(encodeURIComponent(x.id));
    const badge = '<span class="opt-kind opt-kind-' + x.src + '">' + KIND_LBL[x.src] + '</span>';
    if (x.src === 'quote') {
      const lockedBy = typeof window.cloudIsLockedByOther === 'function' ? window.cloudIsLockedByOther(x.id) : null;
      const meta = [idsOf(x).length ? '🆔 ' + idsOf(x).join(' / ') : '', x.customer, x.mode, x.started ? '' : '未着手'].filter(Boolean);
      return '<li class="opt-row' + (sm.all ? ' is-all' : '') + (sm.overdue ? ' has-over' : '') + '" data-src="quote">' +
        '<div class="opt-main"><span class="opt-t">' + badge + '<b title="' + esc(x.title) + '">' + esc(x.title || '（案件名なし）') + '</b></span><small>' + esc(meta.join(' · ')) + (lockedBy ? ' · 🔒 ' + esc(nameOf(lockedBy)) + ' さんが編集中' : '') + '</small></div>' +
        '<div class="opt-prog"><span class="ops-segs" aria-hidden="true">' + segsHtml(x.st, today) + '</span><b>' + sm.done + '/' + sm.total + '</b></div>' +
        '<div class="opt-next">' + nextHtml(sm, today) + dlBadge(x, today) + '</div>' +
        '<div class="opt-acts">' +
          (!sm.all && sm.next && !lockedBy ? '<button type="button" class="opt-btn opt-btn-ok" data-opt="next" data-id="' + id + '" title="「' + esc(sm.next.l) + '」を完了にする">✓ 次を完了</button>' : '') +
          '<button type="button" class="opt-btn" data-opt="list" data-id="' + id + '">☑ チェックリスト</button>' +
          '<button type="button" class="opt-btn" data-opt="quote" data-id="' + id + '" title="この案件の見積を開く">💼 見積</button>' +
        '</div></li>';
    }
    const j = x.job, tot = totalsText(chargeTotals(j.data.charges));
    const linkQ = j.preset_id ? rowById(j.preset_id) : null;
    const meta = [idsOf(x).length ? '🆔 ' + idsOf(x).join(' / ') : '', x.customer, x.mode, j.data.route, tot ? '請求 ' + tot + (j.kind === 'regular' ? '／便' : '') : ''].filter(Boolean);
    let prog;
    if (j.kind === 'regular') {
      prog = '<div class="opt-prog opt-prog-reg"><b>便 ' + sm.ships + '</b><small>進行中 ' + sm.open + (sm.unbilled ? '・未請求 ' + sm.unbilled : '') + '</small></div>';
    } else prog = '<div class="opt-prog"><span class="ops-segs" aria-hidden="true">' + segsHtml(x.st, today) + '</span><b>' + sm.done + '/' + sm.total + '</b></div>';
    const next = j.kind === 'regular' && !sm.all && !sm.curShip ? '<span class="ops-next">便がありません（［＋ 便］で追加）</span>'
      : (j.kind === 'regular' && sm.curShip ? '<span class="opt-ship-lbl">' + esc(sm.curShip.label || '') + '</span> ' : '') + nextHtml(sm, today);
    return '<li class="opt-row' + (sm.all ? ' is-all' : '') + (sm.overdue ? ' has-over' : '') + '" data-src="' + x.src + '">' +
      '<div class="opt-main"><span class="opt-t">' + badge + '<b title="' + esc(x.title) + '">' + esc(x.title || '（名前なし）') + '</b>' + (j.preset_id ? '<span class="opt-link" title="見積と紐づいています">💼 ' + esc(linkQ ? (linkQ.data && linkQ.data.fields && linkQ.data.fields['qf-ref']) || linkQ.ref || '見積' : '見積') + '</span>' : '') + '</span><small>' + esc(meta.join(' · ')) + '</small></div>' +
      prog +
      '<div class="opt-next">' + next + dlBadge(x, today) + '</div>' +
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
    h += idSecHtml('job', j.id);
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

  // ---------- 🆔 基幹 ID（＝サイバーポートの取引番号）で、見積・進行・サイバーポートをつなぐ ----------
  // 基幹システムで採番した番号を、見積の案件（fields の qf-core-ref／往復の復路は qf-core-ref2）と
  // 見積なしの進行（data.coreId／coreId2）に持たせる。番号はサイバーポートの「取引番号」と同じなので、
  //  ①［🛰 サイバーポートで確認］で取引を探し、B/L・コンテナ番号を取ってきて、追いかけの名簿（cp_watch_targets・source='trade'）へ入れる
  //  ②朝夕の自動確認の結果を、取引番号で案件・進行に結び付けて、出港・入港などのチェックを自動で入れる（autoSync）
  // 番号の形（決まった書式）は ID_RE で確かめる（未設定なら空白を除いて大文字にそろえるだけ）。
  // 形：EXP（輸出）／IMP（輸入）＋年 2 桁＋月 2 桁＋連番 3 桁＋「-」＋枝番 2 桁（例 EXP2611303-00）
  let ID_RE = /^(EXP|IMP)\d{2}(0[1-9]|1[0-2])\d{3}-\d{2}$/, ID_EX = 'EXP2611303-00';
  const normId = s => String(s == null ? '' : s).normalize('NFKC').replace(/[\s\u3000]+/g, '').replace(/[\u2010-\u2015\u2212\u30fc\uff70]/g, '-').toUpperCase();
  const idDir = v => /^EXP/.test(v) ? 'export' : /^IMP/.test(v) ? 'import' : '';
  const isRound = d => d === 'export_import' || d === 'import_export';
  const legDirs = d => d === 'export_import' ? ['export', 'import'] : d === 'import_export' ? ['import', 'export'] : [d === 'export' || d === 'import' ? d : ''];
  const DIR_LBL = { export: '輸出', import: '輸入' };
  function idLegs(kind, id) {
    let dir = '', vals = ['', ''];
    if (kind === 'case') { const r = rowById(id), f = (r && r.data && r.data.fields) || {}; dir = f['cond-direction'] || ''; vals = [f['qf-core-ref'] || '', f['qf-core-ref2'] || '']; }
    else { const j = jobById(id); if (!j) return []; dir = j.data.dir || ''; vals = [j.data.coreId || '', j.data.coreId2 || '']; }
    const dirs = legDirs(dir);
    if (isRound(dir)) return [{ n: 1, label: '往路', dir: dirs[0], val: vals[0] }, { n: 2, label: '復路', dir: dirs[1], val: vals[1] }];
    return [{ n: 1, label: '', dir: dirs[0], val: vals[0] }];
  }
  // 同じ ID を使っているほかの案件・進行（見積に紐づいた進行どうしは同じ取引なので除く）
  function idOwner(v, kind, id, n) {
    const self = kind === 'job' ? jobById(id) : null;
    for (const r of rowsAll()) {
      const f = (r.data && r.data.fields) || {};
      for (const [m, x] of [[1, f['qf-core-ref']], [2, f['qf-core-ref2']]]) {
        if (normId(x) !== v) continue;
        if (kind === 'case' && r.id === id && m === n) continue;
        if (self && self.preset_id === r.id) continue;
        return '見積「' + (caseTitle(r) || r.id) + '」';
      }
    }
    for (const j of JOBS.list) {
      for (const [m, x] of [[1, j.data.coreId], [2, j.data.coreId2]]) {
        if (normId(x) !== v) continue;
        if (kind === 'job' && j.id === id && m === n) continue;
        if (kind === 'case' && j.preset_id === id) continue;
        return '進行「' + (j.title || '') + '」';
      }
    }
    return '';
  }
  function idReadOnly(kind, id) {
    if (!(typeof window.cloudIsLoggedIn === 'function' && window.cloudIsLoggedIn())) return true;
    return kind === 'case' && !!(typeof window.cloudIsLockedByOther === 'function' && window.cloudIsLockedByOther(id));
  }
  const WST = t => !t ? null : t.state === 'done' ? ['追跡完了', 'is-done'] : t.state === 'ask' ? ['確認待ち', 'is-ask'] : t.trace === false ? ['一時停止', 'is-off'] : ['🛰 追跡中', 'is-on'];
  let _idp = null;   // 開いている確認の欄 { kind, id, n, loading, err, trade, dir, bl, bk, ctn, title }
  // 手がかり（B/L・ブッキング・コンテナ番号）はアプリ側でも持つ（案件＝fields の qf-cp-keys／進行＝data.cpKeys・往路 1／復路 2）
  function idKeysAll(kind, id) {
    try {
      if (kind === 'case') { const r = rowById(id), raw = r && r.data && r.data.fields && r.data.fields['qf-cp-keys']; return raw ? JSON.parse(raw) || {} : {}; }
      const j = jobById(id); return (j && j.data.cpKeys) ? JSON.parse(JSON.stringify(j.data.cpKeys)) : {};
    } catch (e) { return {}; }
  }
  function idKeys(kind, id, n) { const a = idKeysAll(kind, id)[n] || {}; return { bl: a.bl || '', bk: a.bk || '', ctn: a.ctn || '', vs: a.vs || '', cr: a.cr || '' }; }
  const vsNorm = s => String(s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 60);
  const ctnList = s => String(s || '').split(/[\s,、;]+/).map(normId).filter(Boolean);
  function keysError(k) {
    const ctns = ctnList(k.ctn), bad = ctns.filter(c => !/^[A-Z]{4}\d{7}$/.test(c));
    return bad.length ? 'コンテナ番号の形が違います（英字4文字＋数字7桁）：' + bad.join('、') : ctns.length > 10 ? 'コンテナ番号は10本までです。' : '';
  }
  async function idKeysSave(kind, id, n, k, quiet) {
    const all = idKeysAll(kind, id), old = all[n] || {}, before = JSON.stringify(old);
    const clean = { bl: normId(k.bl), bk: normId(k.bk), ctn: ctnList(k.ctn).join(' ') };
    // 本船名・船会社は、渡されたときだけ書き換える（追いかけ登録など、3 つの番号だけ渡す呼び出しで消さない）
    const vs = 'vs' in k ? vsNorm(k.vs) : (old.vs || ''), cr = 'cr' in k ? String(k.cr || '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 60) : (old.cr || '');
    if (vs) clean.vs = vs; if (cr) clean.cr = cr;
    if (clean.bl || clean.bk || clean.ctn || clean.vs || clean.cr) all[n] = clean; else delete all[n];
    if (JSON.stringify(all[n] || {}) === before) return true;
    let ok;
    if (kind === 'case') ok = await saveFields(id, { 'qf-cp-keys': JSON.stringify(all) });
    else { const j = jobById(id), d = jobData(j); d.cpKeys = all; ok = await saveJob(id, { data: d }); }
    // すでに追いかけている取引なら、名簿の手がかりもアプリの値にそろえる
    const L = idLegs(kind, id).find(x => x.n === n), t = L && L.val && AUTO.trades ? AUTO.trades.get(normId(L.val)) : null, c = client();
    if (ok && t && c) {
      const upd = { bl_no: clean.bl || null, booking_no: clean.bk || null, container_nos: ctnList(clean.ctn), updated_by: me(), updated_at: new Date().toISOString() };
      const { error } = await c.from('cp_watch_targets').update(upd).eq('preset_id', t.preset_id);
      if (!error) Object.assign(t, upd);
      else if (!quiet) toast('⚠️ 追いかけの名簿の手がかりは更新できませんでした：' + (error.message || error.code), 'warn', 5000);
    }
    if (ok && !quiet) toast('手がかりを保存しました', 'success', 2000);
    return ok;
  }
  // ---------- 🔎 船会社のトラッキング・本船の動静への近道（COLINS が不安定なときの手動確認を楽にする） ----------
  // 船会社＝手がかりで選んだもの → 番号の頭 4 文字からの推測（CpCarrierGuide）→ 見積の幹線輸送のキャリア の順。
  // 外部のページを新しいタブで開くだけ（アプリからは何も送らない）。番号を URL で受けない船会社は、開くときに番号をコピーする。
  const CR = () => (typeof CARRIERS !== 'undefined' && CARRIERS) ? CARRIERS : {};
  const crNorm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]/g, '');
  // 船会社の欄の候補：マスター管理のサブコンのうち、種別がキャリア系（FCL／LCL／AIR／RORO／在来船 CARRIER）のもの（alias-rules.js mdCarrierNames）。
  // マスターに無い名前も自由に入力できる（その場合は「マスターに登録／申請」を出す）
  function crListSync() {
    let dl = $('oidCrList');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'oidCrList'; document.body.appendChild(dl); }
    const names = typeof window.mdCarrierNames === 'function' ? window.mdCarrierNames() : [];
    const key = names.join('\n'); if (dl.dataset.key === key) return;
    dl.dataset.key = key; dl.innerHTML = names.map(n => '<option value="' + esc(n) + '"></option>').join('');
  }
  // 正式名でよく使う名前 → data/carriers.js の名前（トラッキングの URL を持つ表）
  const CR_ALIAS = { mediterraneanshipping: 'MSC', oceannetworkexpress: 'ONE', オーシャンネットワークエクスプレス: 'ONE', hyundaimerchantmarine: 'HMM', orientoverseas: 'OOCL',
    pacificinternationallines: 'PIL', koreamarinetransport: 'KMTC', マースク: 'Maersk', エバーグリーン: 'Evergreen', ハパックロイド: 'Hapag-Lloyd', ヤンミン: 'Yang Ming' };
  function crKeyOf(name) {
    const n = crNorm(name); if (!n) return '';
    const ks = Object.keys(CR());
    const hit = ks.find(k => crNorm(k) === n) || ks.find(k => crNorm(k).length >= 3 && n.indexOf(crNorm(k)) === 0);
    if (hit) return hit;
    const a = Object.keys(CR_ALIAS).find(x => n.indexOf(crNorm(x)) === 0);
    return a && CR()[CR_ALIAS[a]] ? CR_ALIAS[a] : '';
  }
  // マスターの別名・代表名も順に試す（例：マスター名「OCEAN NETWORK EXPRESS」・別名「ONE」）
  function crFromName(name) {
    const vs = typeof window.nameVariants === 'function' ? window.nameVariants('sv', name) : [name];
    for (const v of [name].concat(vs)) { const k = crKeyOf(v); if (k) return k; }
    return '';
  }
  const crCanon = v => (typeof window.nameCanon === 'function' ? window.nameCanon('sv', v) : v) || v;
  // マスターの状態：'master'／'pending'（申請中）／'none'（未登録）／'unknown'（判定しない）
  const crState = v => !v ? 'unknown' : typeof window.statsMasterState === 'function' ? window.statsMasterState('sv', crCanon(v)) : 'unknown';
  function crMarkHtml(n, v, ro) {
    const st = crState(v);
    if (st === 'pending') return '<span class="oid-cr-mark is-pending">📨 マスター申請中（管理者の承認待ち）</span>';
    if (st !== 'none') return '';
    const req = typeof window.statsIsApprovalOn === 'function' && window.statsIsApprovalOn();
    return '<span class="oid-cr-mark is-none">⚠ マスターに未登録' + (ro ? '' : '<button type="button" class="opm-link" data-oid="crreg" data-n="' + n + '">' + (req ? '📨 マスター登録を申請' : '☆ マスターに登録') + '</button>') + '</span>';
  }
  // マスターに登録（管理者・承認制でないとき）／申請（承認制のメンバー）。種別は輸送モードからキャリアの種別を付ける
  async function crRegister(kind, id, n) {
    const k = idKeys(kind, id, n), v = String(k.cr || '').trim(); if (!v) return;
    let mode = '';
    if (kind === 'case') { const r = rowById(id); mode = (r && r.data && r.data.fields && r.data.fields['cond-mode']) || ''; } else { const j = jobById(id); mode = (j && j.data.mode) || ''; }
    const type = /航空|AIR/i.test(mode) ? 'AIR CARRIER' : /LCL/i.test(mode) ? 'LCL CARRIER' : /RO\/?RO/i.test(mode) ? 'RORO CARRIER' : /在来/.test(mode) ? '在来船 CARRIER' : 'FCL CARRIER';
    if (typeof window.cloudIsLoggedIn === 'function' && !window.cloudIsLoggedIn()) { toast('ログインすると登録できます', 'info'); return; }
    if (typeof window.statsIsApprovalOn === 'function' && window.statsIsApprovalOn()) {
      if (typeof window.statsMasterRequest !== 'function') return;
      await window.statsMasterRequest('sv', v, '', { details: { svTypes: [type] }, note: '進行管理の「船会社」の欄から（' + type + '）' });
    } else {
      if (typeof window.statsEnsureMaster !== 'function') return;
      await window.statsEnsureMaster('sv', v);
      if (typeof window.mdGet === 'function' && typeof window.mdSave === 'function') {
        const prev = (window.mdGet('sv', v) || {}).details || {};
        const types = Array.isArray(prev.svTypes) ? prev.svTypes.slice() : [];
        if (!types.some(t => typeof window.mdIsCarrierType === 'function' && window.mdIsCarrierType(t))) { types.push(type); await window.mdSave('sv', v, Object.assign({}, prev, { svTypes: types })); }
      }
      if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
      toast('☆ 「' + v + '」をサブコン（' + type + '）としてマスターに登録しました', 'success', 3500);
    }
    idRerender();
  }
  function quoteCarrier(kind, id) {
    if (kind !== 'case') return '';
    const r = rowById(id), f = (r && r.data && r.data.fields) || {};
    let names = [];
    try { (JSON.parse(f['z2-routes-data'] || '[]') || []).forEach(x => { if (x && x.enabled !== false && !x.ng && x.carrier) names.push(x.carrier); }); } catch (e) { /* 何もしない */ }
    if (f.z2Carrier) names.push(f.z2Carrier);
    for (const nm of names) { const c = crFromName(nm); if (c) return c; }
    return '';
  }
  // 戻り値：{ name（表示する名前）, key（data/carriers.js の名前・トラッキングの URL が無い会社は ''）, why }
  function trkCarrier(kind, id, k) {
    if (k.cr) { const key = CR()[k.cr] ? k.cr : crFromName(k.cr); return { name: k.cr, key, why: '入力した船会社' }; }
    const G = window.CpCarrierGuide;
    if (G) for (const no of [k.bl].concat(ctnList(k.ctn), [k.bk])) { const g = no && G.guess(no); if (g) return { name: g, key: g, why: '番号「' + no + '」の頭文字から推測' }; }
    const q = quoteCarrier(kind, id); if (q) return { name: q, key: q, why: '見積の幹線輸送のキャリアから' };
    return null;
  }
  function trkLink(url, label, copy, pri) {
    if (!url) return '';
    return '<a class="oid-trk-a' + (pri ? ' is-pri' : '') + '" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"' + (copy ? ' data-cg-copy="' + esc(copy) + '" title="開くときに「' + esc(copy) + '」をコピーします。ページの入力欄に貼り付けてください"' : '') + '>' + label + (copy ? ' 📋' : '') + ' ↗</a>';
  }
  function trkHtml(kind, id, n, k) {
    const ctns = ctnList(k.ctn), cr = trkCarrier(kind, id, k), c = cr && cr.key ? CR()[cr.key] : null;
    let track = '', vessel = '';
    if (c) {
      const tr = no => { if (typeof c.tracking !== 'function') return ''; try { return String(c.tracking(encodeURIComponent(no))); } catch (e) { return ''; } };
      const cp = no => c.trackingClipboard ? no : '';
      if (k.bl) track += trkLink(tr(k.bl), '📄 B/L ' + esc(k.bl), cp(k.bl), true);
      if (k.bk) track += trkLink(tr(k.bk), '📑 ブッキング ' + esc(k.bk), cp(k.bk), !k.bl);
      ctns.forEach(no => { track += trkLink(tr(no), '📦 ' + esc(no), cp(no), false); });
      if (!track && typeof c.tracking === 'function') track = trkLink(tr(''), '🔎 ' + esc(cr.name) + ' のトラッキング', '', true);
      let vu = ''; if (typeof c.vessel === 'function') { try { vu = String(c.vessel(encodeURIComponent(k.vs || ''))); } catch (e) { vu = ''; } }
      vessel += trkLink(vu, '🚢 ' + esc(cr.name) + ' の本船スケジュール', k.vs, true);
      const vss = (typeof VSS_CARRIERS !== 'undefined' ? VSS_CARRIERS : []).find(x => x.name === cr.key);
      if (vss) vessel += trkLink(vss.url, '🗓 VSS（' + esc(cr.name) + '）', k.vs, false);
    }
    (typeof VESSEL_PORTALS !== 'undefined' ? VESSEL_PORTALS : []).forEach(p => { if (p.url && !(c && /VSS/.test(p.name) && vessel.indexOf('VSS') >= 0)) vessel += trkLink(p.url, '🌐 ' + esc(p.name.replace(/\s*\(.*\)$/, '')), k.vs, false); });
    if (!c && !cr && !k.bl && !k.bk && !ctns.length && !k.vs) return '';
    const noUrl = cr && !(c && typeof c.tracking === 'function');   // 入力した船会社のトラッキングページが data/carriers.js に無い
    if (noUrl && typeof window.bmShowForCarrier === 'function') track += '<button type="button" class="oid-trk-a" data-oid="crbm" data-name="' + esc(crCanon(cr.name)) + '">🔖 ' + esc(cr.name) + ' のリンク集を見る</button>';
    return '<div class="oid-trk" data-oid-n="' + n + '"><div class="oid-trk-h">🔎 船会社のページで確認する' +
      (cr ? '<small>船会社：<b>' + esc(cr.name) + '</b>（' + esc(cr.why) + '）</small>' : '<small>船会社が分からないため、上の「船会社」に入力してください</small>') + '</div>' +
      (noUrl ? '<p class="oid-trk-n">この船会社のトラッキングページは、アプリにまだ登録がありません。リンク集（🔖）に登録したページを開くか、下の本船スケジュールのサイトで確認してください。</p>' : '') +
      (track ? '<div class="oid-trk-r"><span>貨物の追跡</span><div>' + track + '</div></div>' : '') +
      (vessel ? '<div class="oid-trk-r"><span>本船の動静</span><div>' + vessel + '</div></div>' : '') +
      '<p class="oid-trk-n">新しいタブで開くだけで、アプリからは何も送りません。「📋」のリンクは、開くときに番号や本船名をコピーします（ページの入力欄に貼り付けてください）。</p></div>';
  }
  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('.oid-trk a[data-cg-copy]') && window.CpCarrierGuide) window.CpCarrierGuide.onClick(e);
  });

  function idSecHtml(kind, id) {
    const legs = idLegs(kind, id); if (!legs.length) return '';
    crListSync();
    const ro = idReadOnly(kind, id);
    if (!AUTO.loaded && !AUTO.busy && !AUTO.missing) autoRefreshTargets();
    let h = '<section class="oj-sec oid-sec" data-oid-kind="' + kind + '" data-oid-id="' + esc(id) + '"><h3>🆔 基幹 ID・サイバーポート</h3>' +
      '<p class="oj-hint">基幹システムで採番した番号（サイバーポートの取引番号と同じ）を入れると、サイバーポートの取引とつながり、出港・入港などが自動でチェックされます。' + (legs.length > 1 ? '往路と復路は別の番号です。' : '') + '</p>';
    legs.forEach(L => {
      const t = L.val && AUTO.trades ? AUTO.trades.get(normId(L.val)) : null, ws = WST(t);
      h += '<div class="oid-row">' + (L.label ? '<span class="oid-l">' + L.label + (L.dir ? '<small>' + DIR_LBL[L.dir] + '</small>' : '') + '</span>' : '') +
        '<input type="text" class="oid-in" data-oid-n="' + L.n + '" maxlength="40" autocomplete="off" spellcheck="false" inputmode="latin" value="' + esc(L.val) + '" placeholder="' + esc(ID_EX ? '例）' + ID_EX : '基幹システムの番号') + '" aria-label="基幹 ID' + (L.label ? '（' + L.label + '）' : '') + '"' + (ro ? ' disabled' : '') + '>' +
        (ws ? '<span class="oid-st ' + ws[1] + '">' + ws[0] + '</span>' : L.val ? '<span class="oid-st is-none">サイバーポート未登録</span>' : '') +
        (L.val && !ro ? '<button type="button" class="opm-btn" data-oid="check" data-n="' + L.n + '">🛰 サイバーポートで確認</button>' : '') + '</div>';
      if (L.val) {
        const k = idKeys(kind, id, L.n), dis = ro ? ' disabled' : '';
        h += '<div class="oid-keys" data-oid-n="' + L.n + '"><span class="oid-keys-l">手がかり<small>アプリに保存</small></span>' +
          '<label><span>B/L 番号</span><input type="text" class="oid-k" data-oid-n="' + L.n + '" data-k="bl" maxlength="40" value="' + esc(k.bl) + '"' + dis + '></label>' +
          '<label><span>ブッキング番号</span><input type="text" class="oid-k" data-oid-n="' + L.n + '" data-k="bk" maxlength="40" value="' + esc(k.bk) + '"' + dis + '></label>' +
          '<label class="oid-k-wide"><span>コンテナ番号（空白区切り・10 本まで）</span><input type="text" class="oid-k" data-oid-n="' + L.n + '" data-k="ctn" maxlength="200" value="' + esc(k.ctn) + '"' + dis + '></label>' +
          '<label><span>本船名・航海番号</span><input type="text" class="oid-k" data-oid-n="' + L.n + '" data-k="vs" maxlength="60" value="' + esc(k.vs) + '" placeholder="例）ONE HARMONY 012E"' + dis + '></label>' +
          '<label><span>船会社<small>（マスターから選ぶ・無ければ入力）</small></span><input type="text" class="oid-k" data-oid-n="' + L.n + '" data-k="cr" maxlength="60" list="oidCrList" autocomplete="off" value="' + esc(k.cr) + '" placeholder="空＝番号から自動で推測"' + dis + '>' + crMarkHtml(L.n, k.cr, ro) + '</label></div>' +
          trkHtml(kind, id, L.n, k);
      }
      if (_idp && _idp.kind === kind && _idp.id === id && _idp.n === L.n) h += idPanelHtml(L, t);
    });
    if (AUTO.missing) h += '<p class="oj-hint">※ 追いかけの名簿（サーバー側の準備 cp-watch.sql）がまだのため、自動チェックは動きません。</p>';
    return h + '</section>';
  }
  function idPanelHtml(L, t) {
    const p = _idp;
    if (p.loading) return '<div class="oid-pane"><p>サイバーポートで取引「' + esc(L.val) + '」を探しています…</p></div>';
    if (p.err) return '<div class="oid-pane is-err"><p>' + esc(p.err) + '</p><div class="oj-crow-foot"><button type="button" class="opm-link" data-oid="cancel">閉じる</button></div></div>';
    const tr = p.trade || {};
    if (!t && tr.no && AUTO.trades) t = AUTO.trades.get(normId(tr.no)) || null;   // 取引番号ですでに追いかけている
    let h = '<div class="oid-pane"><dl class="oid-dl"><dt>取引番号</dt><dd>' + esc(tr.no) + '</dd>' + (tr.name ? '<dt>取引名</dt><dd>' + esc(tr.name) + '</dd>' : '') +
      (tr.type ? '<dt>種別</dt><dd>' + esc(tr.type) + '</dd>' : '') + (tr.status ? '<dt>状態</dt><dd>' + esc(tr.status) + '</dd>' : '') + '</dl>';
    if (t) {
      const ws = WST(t);
      return h + '<p class="oid-ok">この取引は、すでに追いかけの名簿に入っています（' + ws[0].replace('🛰 ', '') + '）。朝夕の自動確認の結果が、ここのチェックに反映されます。</p>' +
        '<div class="oj-crow-foot"><button type="button" class="opm-link" data-oid="cancel">閉じる</button></div></div>';
    }
    h += '<p class="oj-hint">サイバーポートから取れた手がかり（輸入＝B/L 番号・輸出＝ブッキング番号・コンテナ番号）を入れてあります。空のままでも登録でき、朝夕の自動確認のときに取引から取り直します。</p>' +
      '<div class="oj-grid">' +
      '<label class="oj-f"><span>向き</span><select class="oid-f" data-k="dir"><option value="import"' + (p.dir === 'import' ? ' selected' : '') + '>輸入</option><option value="export"' + (p.dir === 'export' ? ' selected' : '') + '>輸出</option></select></label>' +
      '<label class="oj-f"><span>B/L 番号</span><input type="text" class="oid-f" data-k="bl" value="' + esc(p.bl) + '" maxlength="40"></label>' +
      '<label class="oj-f"><span>ブッキング番号</span><input type="text" class="oid-f" data-k="bk" value="' + esc(p.bk) + '" maxlength="40"></label>' +
      '<label class="oj-f oj-f-wide"><span>コンテナ番号（10 本まで・空白区切り）</span><input type="text" class="oid-f" data-k="ctn" value="' + esc(p.ctn) + '" maxlength="200"></label>' +
      '</div>' + (p.ferr ? '<p class="oid-ferr">' + esc(p.ferr) + '</p>' : '') +
      '<div class="oj-crow-foot"><button type="button" class="opm-link" data-oid="cancel">やめる</button><button type="button" class="opm-btn opm-btn-pri" data-oid="watch">🛰 この取引を追いかける</button></div></div>';
    return h;
  }
  function idRerender() {
    if (_cur && $('opmModal') && !$('opmModal').hidden) render();
    if ($('ojModal') && !$('ojModal').hidden) renderJob();
    renderTab();
  }
  function saveFields(id, patch, comment) {
    const run = async () => (typeof window.cloudWriteCaseFields === 'function' ? window.cloudWriteCaseFields(encodeURIComponent(id), patch, { comment: comment || '' }) : false);
    const p = _queue.then(run, run); _queue = p.catch(() => {}); return p;
  }
  async function idSave(kind, id, n, raw) {
    const v = normId(raw), L = idLegs(kind, id).find(x => x.n === n); if (!L) return;
    if (v === normId(L.val)) { idRerender(); return; }
    if (v && ID_RE && !ID_RE.test(v)) { toast('⚠️ 番号の形が違います（例：' + (ID_EX || '') + '。輸入は先頭が IMP）', 'warn', 5000); idRerender(); return; }
    if (v && L.dir && idDir(v) && idDir(v) !== L.dir) { toast('⚠️ この欄は' + DIR_LBL[L.dir] + 'です。番号の先頭は ' + (L.dir === 'export' ? 'EXP' : 'IMP') + ' になるはずです', 'warn', 5000); idRerender(); return; }
    if (v) { const o = idOwner(v, kind, id, n); if (o) { toast('⚠️ この ID は ' + o + ' で使われています', 'warn', 5000); idRerender(); return; } }
    if (_idp && _idp.kind === kind && _idp.id === id && _idp.n === n) _idp = null;
    let ok;
    if (kind === 'case') {
      ok = await saveFields(id, { [n === 2 ? 'qf-core-ref2' : 'qf-core-ref']: v }, v ? '🆔 基幹 ID' + (L.label ? '（' + L.label + '）' : '') + 'を「' + v + '」にしました' : '');
    } else {
      const j = jobById(id), d = jobData(j); d[n === 2 ? 'coreId2' : 'coreId'] = v; ok = await saveJob(id, { data: d });
    }
    if (ok) toast(v ? '🆔 基幹 ID を保存しました' : '基幹 ID を消しました', 'success', 2500);
    idRerender();
  }
  // 応答の中から、コンテナ番号の形（英字 4＋数字 7）の文字をすべて拾う（応答の形が分からなくても取れるように）
  function scanCtns(o, out, depth) {
    out = out || new Set(); depth = depth || 0;
    if (o == null || depth > 8) return out;
    if (typeof o === 'string') { const v = normId(o); if (/^[A-Z]{4}\d{7}$/.test(v)) out.add(v); }
    else if (Array.isArray(o)) o.forEach(x => scanCtns(x, out, depth + 1));
    else if (typeof o === 'object') Object.keys(o).forEach(k => scanCtns(o[k], out, depth + 1));
    return out;
  }
  const gv = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  async function idCheck(kind, id, n) {
    const L = idLegs(kind, id).find(x => x.n === n); if (!L || !L.val) return;
    const v = normId(L.val);
    _idp = { kind, id, n, loading: true }; idRerender();
    const done = p => { if (_idp && _idp.kind === kind && _idp.id === id && _idp.n === n) { _idp = Object.assign({ kind, id, n }, p); idRerender(); } };
    if (!window.CyberPort) return done({ err: 'サイバーポートの連携が読み込まれていません。' });
    try {
      const r = await window.CyberPort.tradesSearch({ keyword: v });
      const list = Array.isArray(r.data) ? r.data : (r.data && Array.isArray(r.data.items) ? r.data.items : []);
      // 基幹の番号は、サイバーポートでは「取引名」に入る（取引番号はサイバーポートが振る EXP_2026… の番号）。両方で照合する
      const tr = list.find(x => normId(gv(x, 'tradeNo')) === v) || list.find(x => normId(gv(x, 'tradeName')) === v) || null;
      if (!tr) return done({ err: 'サイバーポートに「' + v + '」の取引（取引名・取引番号）が見つかりませんでした。番号を確かめるか、サイバーポートに登録されたあとでもう一度確かめてください。' });
      const ctns = scanCtns(tr);
      try { const c = await window.CyberPort.get('/API/v2/Trades/GetContainers/' + encodeURIComponent(gv(tr, 'tradeNo'))); scanCtns(c && c.data, ctns); } catch (e) { /* コンテナ一覧が取れなくても続ける */ }
      const no = String(gv(tr, 'tradeNo') || v), type = String(gv(tr, 'tradeType') || '');
      const dir = L.dir || idDir(normId(no)) || (/export|輸出/i.test(type) ? 'export' : 'import');
      const mine = idKeys(kind, id, n);   // アプリに保存した手がかりを優先し、空の欄だけサイバーポートの値で埋める
      done({ trade: { no, name: String(gv(tr, 'tradeName') || ''), type, status: String(gv(tr, 'tradeStatus') || '') }, dir, bl: mine.bl || String(gv(tr, 'blNo') || ''), bk: mine.bk || String(gv(tr, 'bookingNo') || ''), ctn: mine.ctn || [...ctns].slice(0, 10).join(' '), title: (kind === 'case' ? caseTitle(rowById(id)) : (jobById(id) || {}).title) || '' });
    } catch (e) {
      done({ err: (e && e.code === 'login' ? 'ログインが必要です。' : e && e.code === 'nofunction' ? 'サイバーポートとの接続（サーバー側）がまだ準備されていません。' : 'サイバーポートに問い合わせできませんでした：' + ((e && e.message) || e)) });
    }
  }
  async function idWatch(sec) {
    const p = _idp; if (!p || !p.trade) return;
    sec.querySelectorAll('.oid-f').forEach(el => { p[el.dataset.k] = el.value; });
    const N = normId, bl = N(p.bl), bk = N(p.bk), ctns = String(p.ctn || '').split(/[\s,、;]+/).map(N).filter(Boolean);
    const bad = ctns.filter(c => !/^[A-Z]{4}\d{7}$/.test(c));
    p.ferr = bad.length ? 'コンテナ番号の形が違います（英字4文字＋数字7桁）：' + bad.join('、') : ctns.length > 10 ? 'コンテナ番号は10本までです。'
      : '';
    if (p.ferr) { idRerender(); return; }
    await idKeysSave(p.kind, p.id, p.n, { bl, bk, ctn: ctns.join(' ') }, true);   // 入れた手がかりはアプリにも保存
    const c = client(), email = me(); if (!c || !email) { p.ferr = 'ログインが必要です。'; idRerender(); return; }
    const { error } = await c.from('cp_watch_targets').insert({ source: 'trade', trade_no: p.trade.no, title: normId(idLegs(p.kind, p.id).find(x => x.n === p.n).val) || p.trade.name || null, direction: p.dir === 'export' ? 'export' : 'import',
      bl_no: bl || null, booking_no: bk || null, container_nos: ctns, trace: true, state: 'active', created_by: email, updated_by: email });
    if (error) {
      const m = error.message || error.code || '';
      if (error.code !== '23505') { p.ferr = (/does not exist|42P01|schema cache|relation|column|violates check/i.test(m) ? 'サーバー側の準備（docs/sql/cp-watch.sql）が足りないため、追いかけられません。' : '追いかけに入れられませんでした。') + '（サーバーの返事：' + m + (error.code ? '・' + error.code : '') + '）'; idRerender(); return; }
      toast('この取引は、すでに追いかけの名簿に入っています', 'info', 3500);
    } else toast('🛰 取引「' + p.trade.no + '」を追いかけます（朝夕に自動で確認します）', 'success', 4000);
    _idp = null; await autoRefreshTargets(); idRerender();
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-oid]'); if (!b) return;
    const sec = b.closest('.oid-sec'); if (!sec) return;
    const kind = sec.dataset.oidKind, id = sec.dataset.oidId, a = b.dataset.oid;
    if (a === 'check') idCheck(kind, id, +b.dataset.n);
    else if (a === 'cancel') { _idp = null; idRerender(); }
    else if (a === 'watch') idWatch(sec);
    else if (a === 'crreg') crRegister(kind, id, +b.dataset.n);
    else if (a === 'crbm') { if (typeof window.bmShowForCarrier === 'function') window.bmShowForCarrier(b.dataset.name, e); }
  });
  document.addEventListener('change', e => {
    const t = e.target; if (!t.classList) return;
    const sec = t.closest && t.closest('.oid-sec'); if (!sec) return;
    if (t.classList.contains('oid-in')) idSave(sec.dataset.oidKind, sec.dataset.oidId, +t.dataset.oidN, t.value);
    else if (t.classList.contains('oid-k')) {
      const n = +t.dataset.oidN, box = sec.querySelector('.oid-keys[data-oid-n="' + n + '"]'), k = {};
      box.querySelectorAll('.oid-k').forEach(el => { k[el.dataset.k] = el.value; });
      const er = keysError(k); if (er) { toast('⚠️ ' + er, 'warn', 4500); return; }
      idKeysSave(sec.dataset.oidKind, sec.dataset.oidId, n, k).then(() => idRerender());
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing && e.target.classList && (e.target.classList.contains('oid-in') || e.target.classList.contains('oid-k'))) { e.preventDefault(); e.target.blur(); }
  });

  // ---------- 🛰 サイバーポートの自動確認（COLINS）の実績から、出港・入港・返却のチェックを自動で入れる ----------
  // 朝夕の自動確認（cp_watch_targets.snapshot＝注目項目の写し）を読み、実績が入っていれば当てはまる作業を「済み」にする。
  //  - 当てはまる作業：作業名で判断（出港／搭載・出発、入港・到着（「到着案内」は除く）、空コンテナの返却）
  //  - 往復の案件：【往路】【復路】の作業は、追跡の向き（輸出／輸入）と合う側だけ
  //  - 一度自動で入れた作業は st.ax に控え、人が外したら二度と自動では入れない
  //  - 書き込みは人の操作と同じ入口（他のメンバーが編集中の案件は、次の機会に）。5 分に 1 回まで
  const AUTO = { at: 0, busy: false, missing: false, loaded: false, map: null, trades: null };
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
  // 案件・進行に当てはまる追跡（案件の id で追うもの＋基幹 ID＝取引番号で追うもの）
  const uniq = a => a.filter((x, i) => x && a.indexOf(x) === i);
  function targetsForCase(r) {
    if (!r || !AUTO.map) return [];
    const f = (r.data && r.data.fields) || {}, tm = AUTO.trades || new Map();
    return uniq([AUTO.map.get(r.id), tm.get(normId(f['qf-core-ref'])), tm.get(normId(f['qf-core-ref2']))]);
  }
  function targetsForJob(j, shipId) {
    if (!j || shipId || j.kind !== 'spot' || !AUTO.map) return [];
    const tm = AUTO.trades || new Map(), q = j.preset_id ? rowById(j.preset_id) : null;
    return uniq([j.preset_id ? AUTO.map.get(j.preset_id) : null, tm.get(normId(j.data.coreId)), tm.get(normId(j.data.coreId2))].concat(q ? targetsForCase(q) : []));
  }
  const autoTargetOfJob = (j, shipId) => targetsForJob(j, shipId).length > 0;
  async function autoLoad() {
    const c = client(); if (!c) return null;
    let res = await c.from('cp_watch_targets').select('preset_id,direction,snapshot,source,trade_no,title,trace,state');
    if (res.error && (res.error.code === '42703' || /source|trade_no/.test(res.error.message || ''))) res = await c.from('cp_watch_targets').select('preset_id,direction,snapshot,trace');
    if (res.error) {
      if (res.error.code === '42P01' || res.error.code === 'PGRST205' || /cp_watch_targets/.test(res.error.message || '')) AUTO.missing = true;
      return null;
    }
    const map = new Map(), trades = new Map();
    (res.data || []).forEach(t => {
      if ((t.source || 'case') === 'case' && t.preset_id) map.set(t.preset_id, t);
      else if (t.source === 'trade' && t.trade_no) {
        trades.set(normId(t.trade_no), t);
        if (t.title && !trades.has(normId(t.title))) trades.set(normId(t.title), t);   // 基幹 ID は取引名（＝名簿の名前）でも引く
      }
    });
    return { map, trades };
  }
  // 追いかけの名簿だけを読み直す（基幹 ID の画面の状態の札・登録のあと）
  async function autoRefreshTargets() {
    if (AUTO.busy || AUTO.missing || !(typeof window.cloudIsLoggedIn === 'function' && window.cloudIsLoggedIn())) return;
    AUTO.busy = true;
    try { const m = await autoLoad(); if (m) { AUTO.map = m.map; AUTO.trades = m.trades; } } catch (e) {}
    finally { AUTO.busy = false; AUTO.loaded = true; }
    idRerender();
  }
  async function autoSync(force) {
    if (AUTO.busy || AUTO.missing) return;
    if (!force && Date.now() - AUTO.at < 5 * 60 * 1000) return;
    if (!(typeof window.cloudIsLoggedIn === 'function' && window.cloudIsLoggedIn())) return;
    if (!rowsAll().length && !JOBS.list.length) return;
    AUTO.busy = true; AUTO.at = Date.now();
    let n = 0;
    try {
      const m = await autoLoad();
      if (!m) return;
      AUTO.map = m.map; AUTO.trades = m.trades; AUTO.loaded = true;
      for (const r of rowsAll()) {
        const ts = targetsForCase(r); if (!ts.length || !isTarget(r)) continue;
        if (typeof window.cloudIsLockedByOther === 'function' && window.cloudIsLockedByOther(r.id)) continue;
        if (_cur && _cur.id === r.id) continue;   // チェックリストを開いている間は触らない（閉じたあとの機会に）
        const st = JSON.parse(JSON.stringify(stateOf(r)));
        const f = (r.data && r.data.fields) || {};
        const done = [].concat(...ts.map(t => autoApply(st, t, f['cond-direction'])));
        if (!done.length) continue;
        const ok = await save(r.id, st, done.map(x => '🛰 業務：「' + x.l + '」を自動で完了（' + x.src + '）').join('\n'));
        if (ok) n += done.length;
      }
      for (const j of JOBS.list) {
        const ts = targetsForJob(j); if (!ts.length || j.status !== 'active') continue;
        if (_cur && _cur.kind === 'job' && _cur.jobId === j.id) continue;
        const d = jobData(j), done = [].concat(...ts.map(t => autoApply(d.st, t, d.dir || '')));
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
  window.opsSetIdFormat = (re, ex) => { ID_RE = re || null; ID_EX = ex || ''; };   // 基幹 ID の形（試験・形が変わったとき）
  window.opsSummaryOf = r => (isTarget(r) ? summary(stateOf(r)) : null);
})();
