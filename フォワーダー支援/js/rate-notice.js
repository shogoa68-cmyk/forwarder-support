// 料金改定案内モジュール（改定予定の検出 → 案内作成 → 案内履歴の管理）
(function () {
  'use strict';

  const CHARGE_TABLE = 'local_charges';
  const NOTICE_TABLE = 'charge_notices';
  const LOC_CHARGE_KEY = 'localCharges_v1';
  const LOC_NOTICE_KEY = 'chargeNotices_v1';

  let _dir        = 'export';
  let _charges    = [];     // 対象方向のチャージ
  let _pairs      = [];     // 検出した改定ペア
  let _selected   = new Set();
  let _notices    = [];     // 案内履歴
  let _editingId  = null;   // 編集中の案内 id（null=新規）

  // === Supabase / localStorage ===
  function _c()     { return typeof window.cloudGetClient   === 'function' ? window.cloudGetClient()   : null; }
  function _me()    { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return u ? (u.email || '') : ''; }
  function _cloud() { return !!_c() && !!_me(); }

  // === ヘルパー ===
  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _ea(s)  { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function _fmtDate(d) { return d ? String(d).slice(0,10) : ''; }
  function _amt(a, cur) {
    if (a == null || a === '') return '—';
    const n = Number(a);
    if (isNaN(n)) return '—';
    return (cur === 'JPY' ? '¥' : (cur + ' ')) + n.toLocaleString('ja-JP');
  }
  function _norm(s) {
    return String(s || '')
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/[\s　・ー―\-\/\\.]+/g, '')
      .toLowerCase()
      .replace(/[ａ-ｚＡ-Ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  }
  function _route(c) {
    const pol = c.pol || c.port || '';
    const pod = c.pod || '';
    if (pol && pod) return pol + ' → ' + pod;
    return pol || pod || '';
  }
  function _jpDate(d) {
    if (!d) return '○年○月○日';
    try { return new Date(d).toLocaleDateString('ja-JP', { year:'numeric', month:'long', day:'numeric' }); }
    catch (e) { return String(d); }
  }

  // === データ読み込み ===
  async function _loadCharges() {
    const c = _c();
    if (c) {
      const { data, error } = await c.from(CHARGE_TABLE).select('*').eq('direction', _dir).order('name');
      if (!error) { _charges = data || []; return; }
    }
    try {
      const all = JSON.parse(localStorage.getItem(LOC_CHARGE_KEY) || '[]');
      _charges = all.filter(x => x.direction === _dir);
    } catch (e) { _charges = []; }
  }

  async function _loadNotices() {
    const c = _c();
    if (c) {
      const { data, error } = await c.from(NOTICE_TABLE).select('*').eq('direction', _dir).order('updated_at', { ascending: false });
      if (!error) { _notices = data || []; return; }
    }
    try {
      const all = JSON.parse(localStorage.getItem(LOC_NOTICE_KEY) || '[]');
      _notices = all.filter(x => x.direction === _dir)
        .sort((a,b) => String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
    } catch (e) { _notices = []; }
  }

  function _saveLocalNotices(mut) {
    let all = [];
    try { all = JSON.parse(localStorage.getItem(LOC_NOTICE_KEY) || '[]'); } catch (e) {}
    all = mut(all);
    localStorage.setItem(LOC_NOTICE_KEY, JSON.stringify(all));
  }

  // === 改定ペア検出 ===
  // 同名(正規化)＋取引先＋航路で束ね、valid_from 昇順に隣接する
  // 金額の異なるレコードを「改定」とみなす
  function _detectPairs() {
    const groups = new Map();
    _charges.forEach(c => {
      if (!c.name) return;
      const key = [_norm(c.name), c.carrier || '', c.pol || c.port || '', c.pod || ''].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    });
    const pairs = [];
    groups.forEach(arr => {
      if (arr.length < 2) return;
      arr.sort((a, b) => String(a.valid_from || '').localeCompare(String(b.valid_from || '')));
      for (let i = 1; i < arr.length; i++) {
        const prev = arr[i - 1], curr = arr[i];
        const pa = prev.amount, na = curr.amount;
        // 金額が同じ（＝改定なし）ならスキップ
        if (pa != null && na != null && Number(pa) === Number(na)) continue;
        const sameCur = (prev.currency || 'JPY') === (curr.currency || 'JPY');
        const diff = (sameCur && pa != null && na != null) ? (Number(na) - Number(pa)) : null;
        pairs.push({
          id: (curr.id || '') + '::' + (prev.id || ''),
          prev, curr, diff,
          currency: curr.currency || 'JPY',
          effective: curr.valid_from || '',
        });
      }
    });
    pairs.sort((a, b) => String(b.effective || '').localeCompare(String(a.effective || '')));
    return pairs;
  }

  // === タブ切替（輸出/輸入） ===
  async function rnSetDir(dir) {
    _dir = dir;
    _selected = new Set();
    _editingId = null;
    document.getElementById('rnDirBtn-export')?.classList.toggle('is-active', dir === 'export');
    document.getElementById('rnDirBtn-import')?.classList.toggle('is-active', dir === 'import');
    _updateCloudStatus();
    await _loadCharges();
    _pairs = _detectPairs();
    _renderPlan();
    await _loadNotices();
    _renderHistory();
    _clearCompose();
  }

  function _updateCloudStatus() {
    const e = document.getElementById('rnCloudStatus');
    if (!e) return;
    if (_cloud()) { e.textContent = '☁️ ' + _me(); e.className = 'lc-cloud-on'; }
    else          { e.textContent = '💾 ローカル';   e.className = 'lc-cloud-off'; }
  }

  // === 改定予定一覧の描画 ===
  function _renderPlan() {
    const wrap = document.getElementById('rnPlanList');
    if (!wrap) return;
    if (!_pairs.length) {
      wrap.innerHTML = '<div class="rn-empty">改定ペアが見つかりません。<br>' +
        '同じ「名称・取引先・航路」で適用期間の異なる料金を2件以上登録すると、差額を自動検出します。</div>';
      _updatePlanCount();
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    wrap.innerHTML = _pairs.map(p => {
      const c = p.curr;
      const future = p.effective && p.effective > today;
      const badge = future
        ? '<span class="rn-badge rn-badge--future">改定予定</span>'
        : '<span class="rn-badge rn-badge--applied">適用中</span>';
      let deltaHtml = '';
      if (p.diff != null && p.prev.amount != null && Number(p.prev.amount) !== 0) {
        const up = p.diff > 0;
        const pct = (p.diff / Number(p.prev.amount) * 100);
        deltaHtml = `<span class="rn-delta ${up ? 'rn-delta--up' : 'rn-delta--down'}">` +
          `${up ? '▲' : '▼'}${_amt(Math.abs(p.diff), p.currency)}（${up ? '+' : '−'}${Math.abs(pct).toFixed(1)}%）</span>`;
      } else if (p.diff == null) {
        deltaHtml = '<span class="rn-delta rn-delta--na">差額算出不可</span>';
      }
      const chk = _selected.has(p.id) ? 'checked' : '';
      const sel = _selected.has(p.id) ? ' rn-plan-row--sel' : '';
      return `<label class="rn-plan-row${sel}">` +
        `<input type="checkbox" class="rn-plan-chk" value="${_ea(p.id)}" ${chk} onchange="rnTogglePair('${_ea(p.id)}')">` +
        `<div class="rn-plan-main">` +
          `<div class="rn-plan-nm">${_esc(c.name)}${badge}</div>` +
          `<div class="rn-plan-route">${_esc([c.carrier, _route(c)].filter(Boolean).join('  '))}</div>` +
        `</div>` +
        `<div class="rn-plan-amt">` +
          `<span class="rn-old">${_amt(p.prev.amount, p.prev.currency)}</span>` +
          `<span class="rn-arr">→</span>` +
          `<span class="rn-new">${_amt(c.amount, c.currency)}${c.unit ? ' /' + _esc(c.unit) : ''}</span>` +
          `${deltaHtml}` +
          `<div class="rn-plan-eff">適用: ${_esc(p.effective ? _fmtDate(p.effective) : '未設定')}</div>` +
        `</div>` +
      `</label>`;
    }).join('');
    _updatePlanCount();
  }

  function rnTogglePair(id) {
    _selected.has(id) ? _selected.delete(id) : _selected.add(id);
    document.querySelector(`.rn-plan-chk[value="${CSS.escape(id)}"]`)
      ?.closest('.rn-plan-row')?.classList.toggle('rn-plan-row--sel', _selected.has(id));
    _updatePlanCount();
  }

  function _updatePlanCount() {
    const el = document.getElementById('rnPlanCount');
    if (el) el.textContent = _selected.size ? `${_selected.size}件選択中` : '未選択';
    const btn = document.getElementById('rnComposeBtn');
    if (btn) btn.disabled = !_selected.size;
  }

  // === 案内文の生成 ===
  function rnComposeFromSelection() {
    const chosen = _pairs.filter(p => _selected.has(p.id));
    if (!chosen.length) return;
    const dirLabel = _dir === 'import' ? '輸入' : '輸出';
    const effs = chosen.map(p => p.effective).filter(Boolean).sort();
    const eff = effs[0] || '';

    _setVal('rnSubject', `【${dirLabel}】料金改定のご案内（${_jpDate(eff)}適用）`);
    _setVal('rnEffective', eff ? _fmtDate(eff) : '');

    const lines = chosen.map(p => {
      const c = p.curr;
      const rt = _route(c);
      const oldA = _amt(p.prev.amount, p.prev.currency);
      const newA = _amt(c.amount, c.currency) + (c.unit ? '／' + c.unit : '');
      let delta = '';
      if (p.diff != null) {
        const up = p.diff > 0;
        delta = `（${up ? '+' : '−'}${_amt(Math.abs(p.diff), p.currency)}）`;
      }
      const effStr = p.effective ? `  適用: ${_fmtDate(p.effective)}` : '';
      return `　• ${c.name}${rt ? '（' + rt + '）' : ''}：${oldA} → ${newA}${delta}${effStr}`;
    }).join('\n');

    _setVal('rnBody',
      `拝啓　時下益々のご清栄のこととお慶び申し上げます。\n` +
      `平素より格別のご高配を賜り、厚く御礼申し上げます。\n\n` +
      `さて、下記の通り料金改定のご案内を申し上げます。\n\n` +
      `■ 改定内容\n${lines}\n\n` +
      `■ 適用日　${_jpDate(eff)}\n\n` +
      `※ 詳細につきましては、別途担当者よりご案内いたします。\n` +
      `今後とも何卒よろしくお願い申し上げます。\n\n` +
      `　　　　　　　　　　　　　　　　　　　　　　　　敬具`);

    _editingId = null;
    _setComposeMode('new');
    document.getElementById('rnComposePanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function _selectedItemsSnapshot() {
    return _pairs.filter(p => _selected.has(p.id)).map(p => ({
      name: p.curr.name, carrier: p.curr.carrier || '',
      pol: p.curr.pol || p.curr.port || '', pod: p.curr.pod || '',
      unit: p.curr.unit || '', currency: p.currency,
      old_amount: p.prev.amount ?? null, new_amount: p.curr.amount ?? null,
      diff: p.diff, effective_date: p.effective || null,
    }));
  }

  // === 案内の保存 ===
  async function rnSaveNotice(status) {
    const subject = _getVal('rnSubject').trim();
    const body    = _getVal('rnBody');
    if (!subject && !body.trim()) { alert('件名または本文を入力してください'); return; }

    // 編集中でなく、選択があればスナップショットを更新。編集中は既存 items を保持
    const editing = _editingId ? _notices.find(n => n.id === _editingId) : null;
    const items = (!editing || _selected.size)
      ? (_selected.size ? _selectedItemsSnapshot() : (editing?.items || []))
      : (editing.items || []);

    const row = {
      id:        _editingId || undefined,
      direction: _dir,
      subject, body,
      items,
      customer:  _getVal('rnCustomer').trim(),
      effective_date: _getVal('rnEffective') || null,
      status:    status || 'draft',
      sent_at:   status === 'sent' ? new Date().toISOString() : (editing?.sent_at || null),
    };
    if (!row.id) delete row.id;

    const btns = document.querySelectorAll('#rnComposePanel button');
    btns.forEach(b => b.disabled = true);
    try {
      const c = _c();
      if (c && _me()) {
        const me = _me();
        const payload = { ...row, updated_by: me };
        if (!row.id) { delete payload.id; payload.created_by = me; }
        const { error } = row.id
          ? await c.from(NOTICE_TABLE).update(payload).eq('id', row.id)
          : await c.from(NOTICE_TABLE).insert(payload);
        if (error) throw error;
      } else {
        const now = new Date().toISOString();
        if (row.id) {
          _saveLocalNotices(all => all.map(n => n.id === row.id ? { ...n, ...row, updated_at: now } : n));
        } else {
          const rec = { ...row, id: crypto.randomUUID?.() || Date.now().toString(36), created_at: now, updated_at: now };
          _saveLocalNotices(all => { all.unshift(rec); return all; });
        }
      }
      _toast(status === 'sent' ? '✅ 送信済みとして保存しました' : '💾 下書き保存しました');
      _editingId = null;
      _clearCompose();
      _selected = new Set();
      _renderPlan();
      await _loadNotices();
      _renderHistory();
    } catch (e) {
      alert('保存に失敗しました: ' + (e?.message || e) +
        '\n（テーブル未作成の可能性。docs/supabase-charge-notices.sql を実行してください）');
    } finally {
      btns.forEach(b => b.disabled = false);
    }
  }

  // === 案内履歴の描画 ===
  function _renderHistory() {
    const wrap = document.getElementById('rnHistoryList');
    if (!wrap) return;
    if (!_notices.length) {
      wrap.innerHTML = '<div class="rn-empty">保存された案内はありません。</div>';
      return;
    }
    wrap.innerHTML = _notices.map(n => {
      const sent = n.status === 'sent';
      const badge = sent
        ? '<span class="rn-badge rn-badge--sent">送信済み</span>'
        : '<span class="rn-badge rn-badge--draft">下書き</span>';
      const actor = (n.updated_by || n.created_by || '').split('@')[0];
      const itemNames = Array.isArray(n.items) ? n.items.map(it => it?.name).filter(Boolean) : [];
      const cnt = itemNames.length;
      const meta = [
        n.customer ? '宛先: ' + _esc(n.customer) : '',
        n.effective_date ? '適用: ' + _esc(_fmtDate(n.effective_date)) : '',
        cnt ? `対象${cnt}件` : '',
        actor ? _esc(actor) : '',
        n.updated_at ? _esc(_fmtDate(n.updated_at)) : '',
      ].filter(Boolean).join(' ／ ');
      const itemsLimit = 3;
      const itemsSummary = cnt
        ? itemNames.slice(0, itemsLimit).join('、') + (cnt > itemsLimit ? ` ほか${cnt - itemsLimit}件` : '')
        : '';
      const itemsHtml = itemsSummary
        ? `<div class="rn-hist-items" title="${_ea(itemNames.join('、'))}">📦 ${_esc(itemsSummary)}</div>`
        : '';
      return `<div class="rn-hist-card">` +
        `<div class="rn-hist-head">${badge}<span class="rn-hist-subj">${_esc(n.subject || '(件名なし)')}</span></div>` +
        itemsHtml +
        `<div class="rn-hist-meta">${meta}</div>` +
        `<div class="rn-hist-ops">` +
          `<button class="rn-op" onclick="rnReopen('${_ea(n.id)}')">📝 開く</button>` +
          `<button class="rn-op" onclick="rnCopyNotice('${_ea(n.id)}')">📋 本文コピー</button>` +
          (sent ? '' : `<button class="rn-op rn-op--go" onclick="rnMarkSent('${_ea(n.id)}')">✅ 送信済みにする</button>`) +
          `<button class="rn-op rn-op--del" onclick="rnDeleteNotice('${_ea(n.id)}')">🗑️ 削除</button>` +
        `</div>` +
      `</div>`;
    }).join('');
  }

  function rnReopen(id) {
    const n = _notices.find(x => x.id === id);
    if (!n) return;
    _editingId = id;
    _setVal('rnSubject', n.subject || '');
    _setVal('rnBody', n.body || '');
    _setVal('rnCustomer', n.customer || '');
    _setVal('rnEffective', n.effective_date ? _fmtDate(n.effective_date) : '');
    _setComposeMode('edit');
    document.getElementById('rnComposePanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function rnCopyNotice(id) {
    const n = _notices.find(x => x.id === id);
    if (!n) return;
    await _copy(n.body || '');
    _toast('📋 本文をコピーしました');
  }

  async function rnMarkSent(id) {
    const c = _c();
    try {
      if (c && _me()) {
        const { error } = await c.from(NOTICE_TABLE)
          .update({ status: 'sent', sent_at: new Date().toISOString(), updated_by: _me() }).eq('id', id);
        if (error) throw error;
      } else {
        const now = new Date().toISOString();
        _saveLocalNotices(all => all.map(n => n.id === id ? { ...n, status: 'sent', sent_at: now, updated_at: now } : n));
      }
      await _loadNotices();
      _renderHistory();
      _toast('✅ 送信済みにしました');
    } catch (e) { alert('更新に失敗しました: ' + (e?.message || e)); }
  }

  async function rnDeleteNotice(id) {
    const n = _notices.find(x => x.id === id);
    if (!confirm(`「${n?.subject || id}」を削除しますか？`)) return;
    const c = _c();
    try {
      if (c && _me()) {
        const { error } = await c.from(NOTICE_TABLE).delete().eq('id', id);
        if (error) throw error;
      } else {
        _saveLocalNotices(all => all.filter(x => x.id !== id));
      }
      if (_editingId === id) { _editingId = null; _clearCompose(); }
      await _loadNotices();
      _renderHistory();
      _toast('🗑️ 削除しました');
    } catch (e) { alert('削除に失敗しました: ' + (e?.message || e)); }
  }

  // === 案内作成パネル 操作 ===
  async function rnCopyBody()    { await _copy(_getVal('rnBody'));    _toast('📋 本文をコピーしました'); }
  async function rnCopySubject() { await _copy(_getVal('rnSubject')); _toast('📋 件名をコピーしました'); }

  function _clearCompose() {
    _editingId = null;
    ['rnSubject','rnBody','rnCustomer','rnEffective'].forEach(id => _setVal(id, ''));
    _setComposeMode('new');
  }
  function rnClearCompose() { _clearCompose(); }

  function _setComposeMode(mode) {
    const t = document.getElementById('rnComposeTitle');
    if (t) t.textContent = mode === 'edit' ? '✍️ 案内を編集' : '✍️ 案内の作成';
  }

  // === utils ===
  function _getVal(id) { return document.getElementById(id)?.value || ''; }
  function _setVal(id, v) { const e = document.getElementById(id); if (e) e.value = v || ''; }
  async function _copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const el = document.createElement('textarea'); el.value = text; document.body.appendChild(el); el.select(); try { document.execCommand('copy'); } catch (e2) {} el.remove(); }
  }
  function _toast(msg) { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(msg, 'success'); }

  // === init ===
  window.initRateNoticeTab = async function () {
    _updateCloudStatus();
    rnSetDir(_dir);
  };

  // === 公開 API ===
  window.rnSetDir             = rnSetDir;
  window.rnTogglePair         = rnTogglePair;
  window.rnComposeFromSelection = rnComposeFromSelection;
  window.rnSaveNotice         = rnSaveNotice;
  window.rnReopen             = rnReopen;
  window.rnCopyNotice         = rnCopyNotice;
  window.rnMarkSent           = rnMarkSent;
  window.rnDeleteNotice       = rnDeleteNotice;
  window.rnCopyBody           = rnCopyBody;
  window.rnCopySubject        = rnCopySubject;
  window.rnClearCompose       = rnClearCompose;

})();
