// ========== 📅 カレンダー（祝日・協力会社休業日・サーチャージ適用日） ==========

let _calHolidays    = [];
let _calSurcharges  = [];
let _calMonthCursor = new Date();          // 表示中の年月（日は無視）
let _calTypeFilter  = '';                  // '' | 'jp' | 'overseas' | 'partner' | 'surcharge'
let _calCountryFilter = '';
let _calCompanyFilter = '';

const _CAL_TYPE_META = {
  jp:        { label: '🇯🇵 日本の祝日',   dotClass: 'cal-dot--jp' },
  overseas:  { label: '🌍 海外の祝日',     dotClass: 'cal-dot--overseas' },
  partner:   { label: '🤝 協力会社休業日', dotClass: 'cal-dot--partner' },
  surcharge: { label: '💴 サーチャージ',   dotClass: 'cal-dot--surcharge' },
};

function initCalendarTab() {
  _calRenderTypeChips();
  _calLoad();
}

function _fmtDateCal(d) {
  return d ? String(d).slice(0, 10) : '';
}

// ローカルタイムゾーンで YYYY-MM-DD を返す（toISOString は UTC 変換で日付がずれるため使わない）
function _calYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' の開始〜終了（終了 null は単日）を1日ずつ cb(dateStr) に渡す。最大366日で打ち切り
function _calEachDay(from, to, cb) {
  if (!from) return;
  let cur = new Date(from + 'T00:00:00');
  const end = new Date((to || from) + 'T00:00:00');
  let guard = 0;
  while (cur <= end && guard < 366) {
    cb(_calYmd(cur));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
}

async function _calLoad() {
  const db  = window.SupabaseClient;
  const grid = document.getElementById('calGridWrap');
  if (!db) {
    if (grid) grid.innerHTML = '<div class="cal-empty">⚠️ DB接続未初期化</div>';
    return;
  }
  if (grid) grid.innerHTML = '<div class="cal-empty">読み込み中…</div>';

  const { data: sd } = await db.auth.getSession();
  const user = sd?.session?.user || null;
  const histBtn   = document.getElementById('calHistBtn');
  const addHolBtn = document.getElementById('calAddHolBtn');
  const addSurBtn = document.getElementById('calAddSurBtn');
  if (histBtn)   histBtn.hidden   = !user;
  if (addHolBtn) addHolBtn.hidden = !user;
  if (addSurBtn) addSurBtn.hidden = !user;

  if (!user) {
    if (grid) grid.innerHTML =
      '<div class="cal-empty">チームメンバーとして<a href="#" onclick="cloudLogin();return false;">ログイン</a>するとカレンダーを閲覧できます</div>';
    return;
  }

  const [{ data: hol, error: e1 }, { data: sur, error: e2 }] = await Promise.all([
    db.from('calendar_holidays').select('*').order('event_date'),
    db.from('calendar_surcharges').select('*').order('valid_from', { ascending: false }),
  ]);

  if (e1 || e2) {
    if (grid) grid.innerHTML =
      '<div class="cal-empty">⚠️ 取得エラー：' + escHtml((e1 || e2).message) + '</div>';
    return;
  }
  _calHolidays   = hol || [];
  _calSurcharges = sur || [];

  _calRenderTypeChips();
  _calApply();
}

function _calApply() {
  _calRenderCountryChips();
  _calRenderCompanyChips();
  _calRenderGrid();
  _calRenderSurchargeList();
}

// ---------- チップ描画 ----------
function _calRenderTypeChips() {
  const el = document.getElementById('calTypeChips');
  if (!el) return;
  const types = [
    { key: '',          label: 'すべて' },
    { key: 'jp',        label: _CAL_TYPE_META.jp.label },
    { key: 'overseas',  label: _CAL_TYPE_META.overseas.label },
    { key: 'partner',   label: _CAL_TYPE_META.partner.label },
    { key: 'surcharge', label: _CAL_TYPE_META.surcharge.label },
  ];
  el.innerHTML = types.map(t =>
    `<button class="cal-chip${_calTypeFilter === t.key ? ' is-active' : ''}"
             onclick='calSetType(${JSON.stringify(t.key)})'>${t.label}</button>`
  ).join('');
}

function _calRenderCountryChips() {
  const el  = document.getElementById('calCountryChips');
  const row = document.getElementById('calCountryRow');
  if (!el) return;
  if (_calTypeFilter !== 'overseas') { if (row) row.hidden = true; return; }
  const countries = [...new Set(
    _calHolidays.filter(h => h.source_type === 'overseas' && h.country_code).map(h => h.country_code)
  )].sort();
  if (!countries.length) { if (row) row.hidden = true; return; }
  if (row) row.hidden = false;
  el.innerHTML =
    `<button class="cal-chip${!_calCountryFilter ? ' is-active' : ''}" onclick='calSetCountry("")'>すべて</button>` +
    countries.map(c =>
      `<button class="cal-chip${_calCountryFilter === c ? ' is-active' : ''}"
               onclick='calSetCountry(${JSON.stringify(c)})'>${escHtml(c)}</button>`
    ).join('');
}

function _calRenderCompanyChips() {
  const el  = document.getElementById('calCompanyChips');
  const row = document.getElementById('calCompanyRow');
  if (!el) return;
  if (_calTypeFilter !== 'partner') { if (row) row.hidden = true; return; }
  const companies = [...new Set(
    _calHolidays.filter(h => h.source_type === 'partner' && h.company_name).map(h => h.company_name)
  )].sort();
  if (!companies.length) { if (row) row.hidden = true; return; }
  if (row) row.hidden = false;
  el.innerHTML =
    `<button class="cal-chip${!_calCompanyFilter ? ' is-active' : ''}" onclick='calSetCompany("")'>すべて</button>` +
    companies.map(c =>
      `<button class="cal-chip${_calCompanyFilter === c ? ' is-active' : ''}"
               onclick='calSetCompany(${JSON.stringify(c)})'>${escHtml(c)}</button>`
    ).join('');
}

function calSetType(type) {
  _calTypeFilter    = type;
  _calCountryFilter = '';
  _calCompanyFilter = '';
  _calRenderTypeChips();
  _calApply();
}
function calSetCountry(c) { _calCountryFilter = c; _calApply(); }
function calSetCompany(c) { _calCompanyFilter = c; _calApply(); }

// ---------- フィルタ適用済みイベント一覧を日付ごとに束ねる ----------
// 戻り値: { 'YYYY-MM-DD': [{ kind, dotClass, title, tip, editable, ref }] }
function _calBuildDayMap() {
  const map = {};
  const push = (dateStr, ev) => { (map[dateStr] = map[dateStr] || []).push(ev); };

  const holOk = (h) => {
    if (_calTypeFilter && _calTypeFilter !== h.source_type) return false;
    if (_calTypeFilter === 'overseas' && _calCountryFilter && h.country_code !== _calCountryFilter) return false;
    if (_calTypeFilter === 'partner'  && _calCompanyFilter  && h.company_name !== _calCompanyFilter) return false;
    return true;
  };
  _calHolidays.filter(holOk).forEach(h => {
    const meta = _CAL_TYPE_META[h.source_type] || {};
    const sub = h.source_type === 'overseas' ? (h.country_code || '') : (h.source_type === 'partner' ? (h.company_name || '') : '');
    _calEachDay(_fmtDateCal(h.event_date), _fmtDateCal(h.end_date) || null, ds => {
      push(ds, {
        kind: 'holiday', dotClass: meta.dotClass, title: h.name,
        tip: [sub, h.name, h.note].filter(Boolean).join(' / '),
        editable: h.source_type === 'partner', ref: h,
      });
    });
  });

  if (!_calTypeFilter || _calTypeFilter === 'surcharge') {
    _calSurcharges.forEach(s => {
      _calEachDay(_fmtDateCal(s.valid_from), _fmtDateCal(s.valid_to) || null, ds => {
        push(ds, {
          kind: 'surcharge', dotClass: _CAL_TYPE_META.surcharge.dotClass, title: s.surcharge_name,
          tip: [s.carrier, s.trade_lane, s.amount_note].filter(Boolean).join(' / '),
          editable: true, ref: s,
        });
      });
    });
  }
  return map;
}

// ---------- 月表示グリッド ----------
function calPrevMonth() { _calMonthCursor.setMonth(_calMonthCursor.getMonth() - 1); _calApply(); }
function calNextMonth() { _calMonthCursor.setMonth(_calMonthCursor.getMonth() + 1); _calApply(); }
function calGoToday()   { _calMonthCursor = new Date(); _calApply(); }

function _calRenderGrid() {
  const wrap = document.getElementById('calGridWrap');
  const label = document.getElementById('calMonthLabel');
  if (!wrap) return;

  const y = _calMonthCursor.getFullYear();
  const m = _calMonthCursor.getMonth();
  if (label) label.textContent = `${y}年${m + 1}月`;

  const dayMap  = _calBuildDayMap();
  const first   = new Date(y, m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = _calYmd(new Date());

  const cells = [];
  // 前月分の空パディング
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const dowNames = ['日', '月', '火', '水', '木', '金', '土'];
  const head = dowNames.map(n => `<div class="cal-dow">${n}</div>`).join('');

  const body = cells.map(d => {
    if (d == null) return '<div class="cal-day cal-day--other-month"></div>';
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const evs = dayMap[ds] || [];
    const isToday = ds === todayStr;
    const dots = evs.slice(0, 4).map(ev => {
      const clickAttr = ev.editable
        ? ` onclick="event.stopPropagation();${ev.kind === 'holiday' ? 'calEditHoliday' : 'calEditSurcharge'}('${escHtml(ev.ref.id)}')"`
        : '';
      return `<span class="cal-dot ${ev.dotClass} cal-tip" data-tip="${escHtml(ev.tip)}"${clickAttr}>${escHtml(ev.title)}</span>`;
    }).join('');
    const more = evs.length > 4 ? `<span class="cal-more">+${evs.length - 4}</span>` : '';
    return `<div class="cal-day${isToday ? ' cal-day--today' : ''}">
      <div class="cal-day-num">${d}</div>
      <div class="cal-day-events">${dots}${more}</div>
    </div>`;
  }).join('');

  wrap.innerHTML = `<div class="cal-dow-row">${head}</div><div class="cal-grid">${body}</div>`;
}

// ---------- サーチャージ一覧（グリッド下） ----------
function _calSurchargeBadge(s) {
  const today = _calYmd(new Date());
  if (s.valid_from && s.valid_from > today) return '<span class="lc-exp-badge lc-exp-badge--future">適用前</span>';
  if (s.valid_to && s.valid_to < today)      return '<span class="lc-exp-badge lc-exp-badge--red">期限切れ</span>';
  return '<span class="lc-exp-badge lc-exp-badge--amber">適用中</span>';
}

function _calRenderSurchargeList() {
  const wrap = document.getElementById('calSurchargeListWrap');
  if (!wrap) return;
  if (_calTypeFilter && _calTypeFilter !== 'surcharge') { wrap.innerHTML = ''; return; }
  if (!_calSurcharges.length) { wrap.innerHTML = '<div class="cal-empty">登録されているサーチャージ適用日はありません</div>'; return; }

  wrap.innerHTML = '<h3 class="cal-sub-title">💴 サーチャージ適用日 一覧</h3>' +
    _calSurcharges.map(s => `
      <div class="cal-surcharge-item">
        <div class="cal-surcharge-main">
          <span class="cal-surcharge-name">${escHtml(s.surcharge_name)}</span>
          ${_calSurchargeBadge(s)}
          ${s.carrier ? `<span class="cal-surcharge-meta">${escHtml(s.carrier)}</span>` : ''}
          ${s.trade_lane ? `<span class="cal-surcharge-meta">${escHtml(s.trade_lane)}</span>` : ''}
        </div>
        <div class="cal-surcharge-dates">${escHtml(s.valid_from)} 〜 ${escHtml(s.valid_to || '（無期限）')}</div>
        ${s.amount_note ? `<div class="cal-surcharge-note">${escHtml(s.amount_note)}</div>` : ''}
        <div class="cal-surcharge-actions">
          <span class="cal-inline-edit" onclick="calEditSurcharge('${escHtml(s.id)}')" title="編集">✎</span>
          <span class="cal-inline-del" onclick="calDeleteSurcharge('${escHtml(s.id)}')" title="削除">🗑</span>
        </div>
      </div>
    `).join('');
}

// ---------- 追加/編集モーダル ----------
function calToggleFormKind() {
  const kind = document.getElementById('calFormKind')?.value;
  const holEl = document.getElementById('calHolidayFields');
  const surEl = document.getElementById('calSurchargeFields');
  if (holEl) holEl.hidden = kind !== 'holiday';
  if (surEl) surEl.hidden = kind !== 'surcharge';
}

function calFormKindIsHoliday() {
  return document.getElementById('calFormKind')?.value !== 'surcharge';
}

function _calOpenModal(kind, preset) {
  const modal = document.getElementById('calAddModal');
  if (!modal) return;
  const p = preset || {};
  const isEdit = !!p.id;

  document.getElementById('calFormId').value = p.id || '';
  document.getElementById('calFormKind').value = kind;
  calToggleFormKind();

  if (kind === 'holiday') {
    document.getElementById('calFormCompany').value = p.company_name || '';
    document.getElementById('calFormHolDate').value = _fmtDateCal(p.event_date);
    document.getElementById('calFormHolDateTo').value = _fmtDateCal(p.end_date);
    document.getElementById('calFormHolName').value = p.name || '';
    document.getElementById('calFormHolNote').value = p.note || '';
  } else {
    document.getElementById('calFormSurName').value    = p.surcharge_name || '';
    document.getElementById('calFormSurCarrier').value = p.carrier || '';
    document.getElementById('calFormSurLane').value    = p.trade_lane || '';
    document.getElementById('calFormSurFrom').value    = _fmtDateCal(p.valid_from);
    document.getElementById('calFormSurTo').value      = _fmtDateCal(p.valid_to);
    document.getElementById('calFormSurAmount').value  = p.amount_note || '';
    document.getElementById('calFormSurNote').value     = p.note || '';
  }

  const titleEl = document.getElementById('calModalTitle');
  if (titleEl) {
    titleEl.textContent = kind === 'holiday'
      ? (isEdit ? '🤝 協力会社休業日を編集' : '🤝 協力会社休業日を追加')
      : (isEdit ? '💴 サーチャージ適用日を編集' : '💴 サーチャージ適用日を追加');
  }
  // 編集時のみ削除ボタンを表示
  const delBtn = document.getElementById('calDeleteBtn');
  if (delBtn) delBtn.hidden = !isEdit;
  modal.classList.add('open');
}

// モーダル内の削除ボタン：編集中の行を削除してモーダルを閉じる
function calDeleteFromModal() {
  const id = document.getElementById('calFormId')?.value;
  if (!id) return;
  document.getElementById('calAddModal')?.classList.remove('open');
  if (calFormKindIsHoliday()) calDeleteHoliday(id); else calDeleteSurcharge(id);
}

function openAddCalHolidayModal(preset)   { _calOpenModal('holiday', preset); }
function openAddCalSurchargeModal(preset) { _calOpenModal('surcharge', preset); }

function calEditHoliday(id) {
  const r = _calHolidays.find(h => h.id === id);
  if (!r || r.source_type !== 'partner') return;   // JP/海外はICS管理のため編集不可
  openAddCalHolidayModal(r);
}
function calEditSurcharge(id) {
  const r = _calSurcharges.find(s => s.id === id);
  if (!r) return;
  openAddCalSurchargeModal(r);
}

function closeCalModal(e) {
  if (e && e.target.id !== 'calAddModal') return;
  document.getElementById('calAddModal')?.classList.remove('open');
}

async function saveCalHoliday() {
  const db = window.SupabaseClient;
  if (!db) return;
  const id      = document.getElementById('calFormId')?.value || null;
  const company = document.getElementById('calFormCompany')?.value.trim();
  const date    = document.getElementById('calFormHolDate')?.value;
  const dateTo  = document.getElementById('calFormHolDateTo')?.value || null;
  const name    = document.getElementById('calFormHolName')?.value.trim();
  const note    = document.getElementById('calFormHolNote')?.value.trim() || null;

  if (!company || !date || !name) { quoteShowToast('⚠️ 協力会社名・日付・名称を入力してください', 'warn'); return; }
  if (dateTo && dateTo < date) { quoteShowToast('⚠️ 終了日は開始日以降の日付を指定してください', 'warn'); return; }

  const btn = document.getElementById('calSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }

  const { data: sd } = await db.auth.getSession();
  let error;
  if (id) {
    const res = await db.from('calendar_holidays').update({
      source_type: 'partner', company_name: company, event_date: date, end_date: dateTo, name, note,
    }).eq('id', id).select();
    error = res.error;
    if (!error && (!res.data || res.data.length === 0)) {
      if (btn) { btn.disabled = false; btn.textContent = '保存'; }
      quoteShowToast('⚠️ 更新されませんでした（権限不足の可能性）。管理者に calendar_holidays の UPDATE ポリシーをご確認ください', 'warn', 8000);
      return;
    }
  } else {
    ({ error } = await db.from('calendar_holidays').insert({
      source_type: 'partner', company_name: company, event_date: date, end_date: dateTo, name, note,
      created_by: sd?.session?.user?.email || null,
    }));
  }

  if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  if (error) { quoteShowToast('⚠️ 保存エラー：' + error.message, 'warn', 6000); return; }
  quoteShowToast(id ? '✅ 更新しました' : '✅ 休業日を追加しました', 'success', 3000);
  document.getElementById('calAddModal')?.classList.remove('open');
  _calLoad();
}

async function saveCalSurcharge() {
  const db = window.SupabaseClient;
  if (!db) return;
  const id       = document.getElementById('calFormId')?.value || null;
  const name     = document.getElementById('calFormSurName')?.value.trim();
  const carrier  = document.getElementById('calFormSurCarrier')?.value.trim() || null;
  const lane     = document.getElementById('calFormSurLane')?.value.trim() || null;
  const from     = document.getElementById('calFormSurFrom')?.value;
  const to       = document.getElementById('calFormSurTo')?.value || null;
  const amount   = document.getElementById('calFormSurAmount')?.value.trim() || null;
  const note     = document.getElementById('calFormSurNote')?.value.trim() || null;

  if (!name || !from) { quoteShowToast('⚠️ サーチャージ名・適用開始日を入力してください', 'warn'); return; }
  if (to && to < from) { quoteShowToast('⚠️ 適用終了日は開始日以降の日付を指定してください', 'warn'); return; }

  const btn = document.getElementById('calSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }

  const { data: sd } = await db.auth.getSession();
  let error;
  if (id) {
    const res = await db.from('calendar_surcharges').update({
      surcharge_name: name, carrier, trade_lane: lane, valid_from: from, valid_to: to, amount_note: amount, note,
    }).eq('id', id).select();
    error = res.error;
    if (!error && (!res.data || res.data.length === 0)) {
      if (btn) { btn.disabled = false; btn.textContent = '保存'; }
      quoteShowToast('⚠️ 更新されませんでした（権限不足の可能性）。管理者に calendar_surcharges の UPDATE ポリシーをご確認ください', 'warn', 8000);
      return;
    }
  } else {
    ({ error } = await db.from('calendar_surcharges').insert({
      surcharge_name: name, carrier, trade_lane: lane, valid_from: from, valid_to: to, amount_note: amount, note,
      created_by: sd?.session?.user?.email || null,
    }));
  }

  if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  if (error) { quoteShowToast('⚠️ 保存エラー：' + error.message, 'warn', 6000); return; }
  quoteShowToast(id ? '✅ 更新しました' : '✅ サーチャージ適用日を追加しました', 'success', 3000);
  document.getElementById('calAddModal')?.classList.remove('open');
  _calLoad();
}

async function calDeleteHoliday(id) {
  const r = _calHolidays.find(h => h.id === id);
  if (!r) return;
  const warn = r.source_type === 'partner'
    ? 'この休業日を削除しますか？'
    : 'この行はICS取込で管理されています。次回取込で復活する場合があります。削除しますか？';
  if (!confirm(warn)) return;
  const db = window.SupabaseClient;
  if (!db) return;
  const { error } = await db.from('calendar_holidays').delete().eq('id', id);
  if (error) { quoteShowToast('⚠️ 削除エラー：' + error.message, 'warn'); return; }
  quoteShowToast('✅ 削除しました', 'success', 2000);
  _calHolidays = _calHolidays.filter(h => h.id !== id);
  _calApply();
}

async function calDeleteSurcharge(id) {
  if (!confirm('このサーチャージ適用日を削除しますか？')) return;
  const db = window.SupabaseClient;
  if (!db) return;
  const { error } = await db.from('calendar_surcharges').delete().eq('id', id);
  if (error) { quoteShowToast('⚠️ 削除エラー：' + error.message, 'warn'); return; }
  quoteShowToast('✅ 削除しました', 'success', 2000);
  _calSurcharges = _calSurcharges.filter(s => s.id !== id);
  _calApply();
}

// ---------- ホバーツールチップ（bookmarks.js の _bmShowNoteTip と同じ方式） ----------
function _calTipEl() {
  let t = document.getElementById('calNoteTip');
  if (!t) {
    t = document.createElement('div');
    t.id = 'calNoteTip';
    t.className = 'cal-note-tip';
    document.body.appendChild(t);
  }
  return t;
}
function _calShowTip(target) {
  const note = target.dataset.tip;
  if (!note) return;
  const t = _calTipEl();
  t.textContent = note;
  t.style.display = 'block';
  const r  = target.getBoundingClientRect();
  const tw = t.offsetWidth, th = t.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  let top = r.top - th - 8;
  if (top < 8) top = r.bottom + 8;
  t.style.left = left + 'px';
  t.style.top  = top  + 'px';
}
function _calHideTip() {
  const t = document.getElementById('calNoteTip');
  if (t) t.style.display = 'none';
}
if (!window._calTipDelegated) {
  window._calTipDelegated = true;
  document.addEventListener('mouseover', e => {
    const m = e.target.closest('#tab-calendar .cal-tip');
    if (m) _calShowTip(m);
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('#tab-calendar .cal-tip')) _calHideTip();
  });
  document.addEventListener('scroll', _calHideTip, true);
}

// ---------- 変更履歴ビュー ----------
const _CAL_HIST_FIELDS_HOL = [
  { k: 'company_name', n: '協力会社名' },
  { k: 'event_date',   n: '開始日' },
  { k: 'end_date',     n: '終了日' },
  { k: 'name',         n: '名称' },
  { k: 'note',         n: 'メモ' },
];
const _CAL_HIST_FIELDS_SUR = [
  { k: 'surcharge_name', n: 'サーチャージ名' },
  { k: 'carrier',        n: '船社/キャリア' },
  { k: 'trade_lane',     n: '航路' },
  { k: 'valid_from',     n: '適用開始' },
  { k: 'valid_to',       n: '適用終了' },
  { k: 'amount_note',    n: '金額・詳細' },
  { k: 'note',           n: 'メモ' },
];

function _calFmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return escHtml(String(ts));
  return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function _calHistDiff(oldData, newData, fields) {
  const o = oldData || {}, n = newData || {};
  const parts = [];
  fields.forEach(({ k, n: name }) => {
    const ov = o[k] == null ? '' : String(o[k]);
    const nv = n[k] == null ? '' : String(n[k]);
    if (ov === nv) return;
    parts.push(
      `<div class="cal-hist-field"><span class="cal-hist-fname">${name}</span>` +
      `<span class="cal-hist-old">${ov ? escHtml(ov) : '（空）'}</span>` +
      `<span class="cal-hist-arrow">→</span>` +
      `<span class="cal-hist-new">${nv ? escHtml(nv) : '（空）'}</span></div>`
    );
  });
  return parts.join('');
}

function _calRenderHistRows(rows, fields, titleKey) {
  const ACT = { INSERT: { cls: 'ins', label: '追加' }, UPDATE: { cls: 'upd', label: '更新' }, DELETE: { cls: 'del', label: '削除' } };
  return rows.map(h => {
    const a = ACT[h.action] || { cls: '', label: h.action || '' };
    const snap = h.new_data || h.old_data || {};
    const title = snap[titleKey] || '(無題)';
    let body = '';
    if (h.action === 'UPDATE') {
      body = _calHistDiff(h.old_data, h.new_data, fields) || '<div class="cal-hist-field cal-hist-nodiff">（表示対象の変更なし）</div>';
    }
    return `<div class="cal-hist-item">
      <div class="cal-hist-row1">
        <span class="cal-hist-act cal-hist-act-${a.cls}">${a.label}</span>
        <span class="cal-hist-title">${escHtml(title)}</span>
      </div>
      <div class="cal-hist-row2">
        <span class="cal-hist-who">${escHtml(h.changed_by || '不明')}</span>
        <span class="cal-hist-when">${_calFmtTime(h.changed_at)}</span>
      </div>
      ${body ? `<div class="cal-hist-body">${body}</div>` : ''}
    </div>`;
  }).join('');
}

async function openCalHistory() {
  const modal = document.getElementById('calHistModal');
  const list  = document.getElementById('calHistList');
  if (!modal || !list) return;
  modal.classList.add('open');
  list.innerHTML = '<div class="cal-empty">読み込み中…</div>';

  const db = window.SupabaseClient;
  if (!db) { list.innerHTML = '<div class="cal-empty">⚠️ DB接続が未初期化です</div>'; return; }
  const [{ data: hHist, error: e1 }, { data: sHist, error: e2 }] = await Promise.all([
    db.from('calendar_holidays_history').select('*').order('changed_at', { ascending: false }).limit(100),
    db.from('calendar_surcharges_history').select('*').order('changed_at', { ascending: false }).limit(100),
  ]);
  if (e1 || e2) {
    list.innerHTML = '<div class="cal-empty">⚠️ 取得エラー：' + escHtml((e1 || e2).message) +
      '<br><small>（履歴テーブル未作成の場合は docs/sql/calendar-migration.sql を実行してください）</small></div>';
    return;
  }
  if ((!hHist || !hHist.length) && (!sHist || !sHist.length)) {
    list.innerHTML = '<div class="cal-empty">変更履歴はまだありません</div>';
    return;
  }
  const holRows = _calRenderHistRows(hHist || [], _CAL_HIST_FIELDS_HOL, 'name');
  const surRows = _calRenderHistRows(sHist || [], _CAL_HIST_FIELDS_SUR, 'surcharge_name');
  list.innerHTML =
    (holRows ? `<h4 class="cal-hist-group-title">🤝 祝日・休業日</h4>${holRows}` : '') +
    (surRows ? `<h4 class="cal-hist-group-title">💴 サーチャージ</h4>${surRows}` : '');
}

function closeCalHistory(e) {
  if (e && e.target.id !== 'calHistModal') return;
  document.getElementById('calHistModal')?.classList.remove('open');
}

// ---------- window 公開 ----------
window.initCalendarTab        = initCalendarTab;
window.calPrevMonth           = calPrevMonth;
window.calNextMonth           = calNextMonth;
window.calGoToday             = calGoToday;
window.calSetType             = calSetType;
window.calSetCountry          = calSetCountry;
window.calSetCompany          = calSetCompany;
window.calToggleFormKind      = calToggleFormKind;
window.calFormKindIsHoliday   = calFormKindIsHoliday;
window.openAddCalHolidayModal   = openAddCalHolidayModal;
window.openAddCalSurchargeModal = openAddCalSurchargeModal;
window.calEditHoliday          = calEditHoliday;
window.calEditSurcharge        = calEditSurcharge;
window.closeCalModal          = closeCalModal;
window.calDeleteFromModal     = calDeleteFromModal;
window.saveCalHoliday         = saveCalHoliday;
window.saveCalSurcharge       = saveCalSurcharge;
window.calDeleteHoliday       = calDeleteHoliday;
window.calDeleteSurcharge     = calDeleteSurcharge;
window.openCalHistory         = openCalHistory;
window.closeCalHistory        = closeCalHistory;
