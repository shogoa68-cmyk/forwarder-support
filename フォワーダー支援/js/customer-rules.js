// お客様・担当者ごとの「取引ルール」（チーム共有）
//   案件が続くと生まれる、お客様ごと・担当者ごとの固有のルール（請求の締め日・書類の決まり・注意点など）を
//   1 件ずつ登録し、見積を作る場面（お客様・担当者を選んだとき）に自動で表示する。社内専用（お客様向けの出力には一切出さない）。
//   重さ：メモ（知っておく）／要確認（出力前に確認）／厳守（破るとクレームになるもの）
//   保存先：customer_rules（docs/sql/customer-rules.sql を Supabase で実行する前提。未実行でも他の機能には影響しない）
(function () {
  'use strict';

  const TABLE = 'customer_rules';
  const STALE_DAYS = 180;   // 最終確認からこの日数がたったら「再確認」を促す
  const LV = {
    strict: { label: '厳守',   icon: '⛔', order: 0 },
    check:  { label: '要確認', icon: '⚠️', order: 1 },
    memo:   { label: 'メモ',   icon: '📝', order: 2 },
  };

  function _c()  { return typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null; }
  function _me() { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return u ? (u.email || '') : ''; }
  function _cloud() { return !!_c() && !!_me(); }
  const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function _toast(msg, type, ms) { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(msg, type || 'success', ms || 3200); }
  const _who = email => (typeof window._nameFor === 'function' ? window._nameFor(email) : String(email || '').split('@')[0]);
  const _day = iso => { const d = new Date(iso); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate(); };

  let _rules = [];
  let _loaded = false;
  let _missing = false;     // 保存先（customer_rules）が未作成
  let _loading = null;

  window.crLoad = async function (force) {
    if (!_cloud()) return false;
    if (_loaded && !force) return true;
    if (_loading) return _loading;
    _loading = (async () => {
      const { data, error } = await _c().from(TABLE).select('*').order('created_at', { ascending: false });
      _loading = null;
      if (error) {
        if (/relation|does not exist|schema cache|not find|permission denied/i.test(error.message || '')) _missing = true;
        _rules = []; return false;
      }
      _missing = false; _rules = data || []; _loaded = true; return true;
    })();
    return _loading;
  };

  // ---- 照合：お客様名は別名・表記ゆれを代表名に、担当者名は敬称・空白の違いを無視して比べる ----
  const _canon = name => {
    const v = String(name || '').trim();
    return v && typeof window.nameCanon === 'function' ? (window.nameCanon('customer', v) || v) : v;
  };
  const _normPerson = s => String(s || '').replace(/[\s　]+/g, '').replace(/(様|さま|さん|殿)$/, '');
  const _stale = r => {
    const t = new Date(r.confirmed_at || r.created_at).getTime();
    return !isNaN(t) && (Date.now() - t) > STALE_DAYS * 86400000;
  };
  const _sortRules = a => a.slice().sort((x, y) => (LV[x.level] || LV.memo).order - (LV[y.level] || LV.memo).order || String(y.created_at).localeCompare(String(x.created_at)));

  // お客様（と担当者）に当てはまる有効なルール。担当者を選んでいないときは、お客様全体のルールだけ（担当者別の件数は otherContact）
  window.crFor = function (customer, person) {
    const co = _canon(customer);
    if (!co) return { list: [], otherContact: 0 };
    const mine = _rules.filter(r => r.status !== 'retired' && _canon(r.customer) === co);
    const p = _normPerson(person);
    const list = mine.filter(r => !r.contact || (p && _normPerson(r.contact) === p));
    return { list: _sortRules(list), otherContact: mine.length - list.length };
  };

  window.crIsLoaded = () => _loaded;
  // マスター管理の一覧用：お客様ごとの有効なルール件数・厳守件数・再確認が必要な件数
  window.crStats = function (customer) {
    const co = _canon(customer);
    const mine = _rules.filter(r => r.status !== 'retired' && _canon(r.customer) === co);
    return { n: mine.length, strict: mine.filter(r => r.level === 'strict').length, stale: mine.filter(_stale).length };
  };
  // 再確認が必要なルールを持つお客様の一覧（件数の多い順）
  window.crStaleSummary = function () {
    const m = new Map();
    _rules.filter(r => r.status !== 'retired' && _stale(r)).forEach(r => { const k = _canon(r.customer); m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([customer, stale]) => ({ customer, stale })).sort((a, b) => b.stale - a.stale || a.customer.localeCompare(b.customer));
  };

  // ---- 保存・更新 ----
  async function _write(fn, okMsg) {
    if (!_cloud()) { _toast('🔒 ルールの登録にはログインが必要です', 'warn'); return false; }
    if (_missing) { _toast('⚠️ ルールの保存先（customer_rules）が未作成です。docs/sql/customer-rules.sql を実行してください', 'warn', 7000); return false; }
    const { error } = await fn(_c().from(TABLE));
    if (error) {
      if (/relation|does not exist|schema cache|not find/i.test(error.message || '')) _missing = true;
      _toast('⚠️ ルールを保存できませんでした：' + (error.message || error), 'warn', 7000);
      return false;
    }
    await window.crLoad(true);
    if (okMsg) _toast(okMsg);
    return true;
  }
  window.crSave = function (r) {
    const body = String(r.body || '').trim();
    if (!r.customer || !body) { _toast('お客様とルールの内容を入力してください', 'warn'); return Promise.resolve(false); }
    const now = new Date().toISOString();
    const row = { customer: _canon(r.customer), contact: String(r.contact || '').trim() || null, level: LV[r.level] ? r.level : 'memo', body, reason: String(r.reason || '').trim() || null, updated_by: _me(), updated_at: now };
    if (r.id) return _write(t => t.update(row).eq('id', r.id), '✅ ルールを更新しました');
    return _write(t => t.insert(Object.assign(row, { created_by: _me(), confirmed_by: _me(), confirmed_at: now, status: 'active' })), '✅ ルールを登録しました');
  };
  window.crConfirm = id => _write(t => t.update({ confirmed_by: _me(), confirmed_at: new Date().toISOString() }).eq('id', id), '✅ 「いまも有効」として確認しました');
  window.crSetStatus = (id, status) => _write(t => t.update({ status, updated_by: _me(), updated_at: new Date().toISOString() }).eq('id', id), status === 'retired' ? 'ルールを廃止しました（履歴には残ります）' : 'ルールを復活しました');

  // ---- 表示 ----
  function _itemHtml(r, opts) {
    const lv = LV[r.level] || LV.memo;
    const stale = _stale(r);
    const target = r.contact ? '👤 ' + _esc(window.formatPersonWithHonorific ? window.formatPersonWithHonorific(r.contact) : r.contact + ' 様') : '🏢 お客様全体';
    const meta = [target, r.reason ? '背景：' + _esc(r.reason) : '', '登録：' + _esc(_who(r.created_by)) + ' ' + _day(r.created_at),
      '最終確認：' + _day(r.confirmed_at || r.created_at)].filter(Boolean).join(' ／ ');
    const retired = r.status === 'retired';
    const btns = (!opts.edit && opts.quick && stale && !retired)
      ? `<button type="button" data-cr="confirm" data-id="${_esc(r.id)}" title="いまも有効であることを確認した日を更新します">いまも有効</button>` +
        `<button type="button" data-cr="retire" data-id="${_esc(r.id)}">廃止</button>`
      : opts.edit
      ? (retired
          ? `<button type="button" data-cr="restore" data-id="${_esc(r.id)}">復活</button>`
          : `<button type="button" data-cr="confirm" data-id="${_esc(r.id)}" title="いまも有効であることを確認した日を更新します">確認済み</button>` +
            `<button type="button" data-cr="edit" data-id="${_esc(r.id)}">編集</button>` +
            `<button type="button" data-cr="retire" data-id="${_esc(r.id)}">廃止</button>`)
      : '';
    return `<div class="cr-item cr-lv-${_esc(r.level)}${retired ? ' is-retired' : ''}">` +
      `<span class="cr-badge cr-badge-${_esc(r.level)}">${lv.icon} ${lv.label}</span>` +
      `<div class="cr-main"><div class="cr-body">${_esc(r.body)}</div><div class="cr-meta">${meta}` +
      (stale && !retired ? ' <span class="cr-stale" title="最終確認から半年以上たっています">⏳ 再確認</span>' : '') + `</div></div>` +
      (btns ? `<div class="cr-btns">${btns}</div>` : '') + `</div>`;
  }

  // 追加・編集フォーム（担当者の候補はお客様マスターの担当者＋入力中のご担当者）
  function _formHtml(el, ctx) {
    const edit = ctx.editId ? _rules.find(r => r.id === ctx.editId) : null;
    const rec = typeof window.mdGetCanon === 'function' ? window.mdGetCanon('customer', ctx.customer) : null;
    const names = (rec && typeof window.mdContactsOf === 'function' ? window.mdContactsOf(rec.details) : []).map(c => (c.name || '').trim()).filter(Boolean);
    if (ctx.person && !names.some(n => _normPerson(n) === _normPerson(ctx.person))) names.push(ctx.person.trim());
    if (edit && edit.contact && !names.some(n => _normPerson(n) === _normPerson(edit.contact))) names.push(edit.contact);
    const cur = edit ? (edit.contact || '') : '';
    const opts = ['<option value="">🏢 お客様全体</option>'].concat(names.map(n =>
      `<option value="${_esc(n)}"${_normPerson(n) === _normPerson(cur) && cur ? ' selected' : ''}>👤 ${_esc(n)} 様のみ</option>`)).join('');
    const lvOpts = Object.keys(LV).sort((a, b) => LV[b].order - LV[a].order).map(k =>
      `<option value="${k}"${(edit ? edit.level : 'memo') === k ? ' selected' : ''}>${LV[k].icon} ${LV[k].label}</option>`).join('');
    return `<div class="cr-form">` +
      `<div class="cr-form-row"><label>対象<select class="cr-f-contact">${opts}</select></label>` +
      `<label>重さ<select class="cr-f-level">${lvOpts}</select></label></div>` +
      `<textarea class="cr-f-body" rows="2" placeholder="ルールの内容（例：請求書は月末締め・翌月10日必着で原本を郵送／見積は必ずUSD建て併記）">${_esc(edit ? edit.body : '')}</textarea>` +
      `<input type="text" class="cr-f-reason" placeholder="背景（任意：なぜそうなったか・元の案件など）" value="${_esc(edit ? edit.reason || '' : (ctx.reasonDefault || ''))}">` +
      `<div class="cr-form-actions"><button type="button" class="cr-save" data-cr="save">${edit ? '💾 更新' : '＋ ルールを追加'}</button>` +
      (edit ? '<button type="button" data-cr="cancel">やめる</button>' : '') + `</div>` +
      `<div class="cr-hint">🔒 社内専用です。御見積書・メール・プレビューなど、お客様向けの出力には出ません。</div></div>`;
  }

  // el にルール一覧を描く。opts.mode：'master'（マスター管理＝編集・廃止・復活つき）／'quote'（見積タブのバナー）
  function _paint(el) {
    const ctx = el._cr;
    const mine = _rules.filter(r => _canon(r.customer) === _canon(ctx.customer));
    const active = _sortRules(mine.filter(r => r.status !== 'retired'));
    const retired = mine.filter(r => r.status === 'retired');
    let h = '';
    if (!_cloud()) h = '<div class="cr-empty">ログインすると、このお客様の取引ルールを見たり登録したりできます。</div>';
    else if (_missing) h = '<div class="cr-empty">取引ルールの保存先が未作成です。<code>docs/sql/customer-rules.sql</code> を Supabase で実行してください。</div>';
    else {
      h += active.length ? active.map(r => _itemHtml(r, { edit: true })).join('') : '<div class="cr-empty">まだルールはありません。「こういうお客様」という決まりごとを 1 件ずつ登録しておくと、見積を作るときに自動で表示されます。</div>';
      if (retired.length) h += `<details class="cr-retired"><summary>廃止したルール（${retired.length}件）</summary>${retired.map(r => _itemHtml(r, { edit: true })).join('')}</details>`;
      h += _formHtml(el, ctx);
    }
    el.innerHTML = h;
  }

  function _handle(el, ev) {
    const b = ev.target.closest('[data-cr]');
    if (!b || !el.contains(b)) return;
    const act = b.dataset.cr, id = b.dataset.id, ctx = el._cr;
    const done = ok => { if (ok) { ctx.editId = null; } _paint(el); if (ctx.onChange) ctx.onChange(); };
    if (act === 'save') {
      window.crSave({ id: ctx.editId, customer: ctx.customer, contact: el.querySelector('.cr-f-contact').value, level: el.querySelector('.cr-f-level').value,
        body: el.querySelector('.cr-f-body').value, reason: el.querySelector('.cr-f-reason').value }).then(done);
    } else if (act === 'edit') { ctx.editId = id; _paint(el); const f = el.querySelector('.cr-f-body'); if (f) f.focus(); }
    else if (act === 'cancel') { ctx.editId = null; _paint(el); }
    else if (act === 'confirm') window.crConfirm(id).then(done);
    else if (act === 'restore') window.crSetStatus(id, 'active').then(done);
    else if (act === 'retire') {
      const r = _rules.find(x => x.id === id);
      const go = () => window.crSetStatus(id, 'retired').then(done);
      if (typeof window.uiConfirm === 'function') window.uiConfirm({
        title: 'このルールを廃止しますか？', lines: ['「' + (r ? r.body.slice(0, 40) : '') + '」を、見積画面に出さないようにします。', '履歴には残り、「廃止したルール」から復活できます。'], okLabel: '廃止する', danger: true,
      }).then(ok => { if (ok) go(); });
      else if (confirm('このルールを廃止しますか？')) go();
    }
  }

  // マスター管理（お客様の詳細）に、そのお客様のルール一覧と追加フォームを出す
  window.crMountPanel = async function (el, customer, onChange) {
    if (!el) return;
    el._cr = { customer: String(customer || '').trim(), editId: null, onChange };
    if (!el._crBound) { el.addEventListener('click', ev => _handle(el, ev)); el._crBound = true; }
    el.innerHTML = '<div class="cr-empty">読み込み中…</div>';
    await window.crLoad();
    if (document.body.contains(el)) _paint(el);
  };

  // ---- 見積タブのバナー（お客様・ご担当者を選ぶと、当てはまるルールを出す）----
  let _bannerOpen = null;   // null＝自動（厳守があれば開く）
  let _bannerAdd = false;
  function _bannerEl() { return document.getElementById('crBanner'); }
  window.crRefreshBanner = async function () {
    const el = _bannerEl();
    if (!el) return;
    const customer = (document.getElementById('qf-customer') || {}).value || '';
    const person = (document.getElementById('qf-person') || {}).value || '';
    if (!customer.trim() || !_cloud()) { el.hidden = true; el.innerHTML = ''; return; }
    await window.crLoad();
    if (_missing) { el.hidden = true; return; }
    const { list, otherContact } = window.crFor(customer, person);
    const n = k => list.filter(r => r.level === k).length;
    el.hidden = false;
    const ref = ((document.getElementById('qf-ref') || {}).value || '').trim();
    el._cr = { customer: customer.trim(), person: person.trim(), editId: null, onChange: () => window.crRefreshBanner(), reasonDefault: ref ? '案件 ' + ref + ' で判明' : '' };
    const staleN = list.filter(_stale).length;
    const open = _bannerOpen === null ? n('strict') > 0 : _bannerOpen;
    const chips = ['strict', 'check', 'memo'].filter(k => n(k)).map(k => `<span class="cr-badge cr-badge-${k}">${LV[k].icon} ${LV[k].label} ${n(k)}</span>`).join('');
    let h = `<div class="cr-bar"><button type="button" class="cr-toggle" data-cr="toggle" aria-expanded="${open}">${open ? '▼' : '▶'} 📌 このお客様の取引ルール` +
      (list.length ? `（${list.length}件）` : '（なし）') + `</button>${chips}` +
      (otherContact ? `<span class="cr-other" title="ご担当者を入力すると、その担当者のルールも出ます">👤 担当者別 ${otherContact}件</span>` : '') +
      (staleN ? `<span class="cr-stale" title="最終確認から半年以上たったルールがあります。開いて「いまも有効」か「廃止」を選んでください">⏳ 再確認 ${staleN}件</span>` : '') +
      `<button type="button" class="cr-add-btn" data-cr="addtoggle" title="この案件で気づいた決まりごとを、このお客様（や担当者）のルールとして残します">📌 この案件で気づいたことをルールにする</button></div>`;
    if (open && list.length) h += `<div class="cr-list">${list.map(r => _itemHtml(r, { edit: false, quick: true })).join('')}</div>`;
    if (_bannerAdd) h += _formHtml(el, el._cr);
    el.innerHTML = h;
    if (!el._crBound) {
      el.addEventListener('click', ev => {
        const b = ev.target.closest('[data-cr]');
        if (!b) return;
        if (b.dataset.cr === 'toggle') { const cur = el.querySelector('.cr-toggle').getAttribute('aria-expanded') === 'true'; _bannerOpen = !cur; window.crRefreshBanner(); return; }
        if (b.dataset.cr === 'addtoggle') { _bannerAdd = !_bannerAdd; window.crRefreshBanner(); return; }
        if (b.dataset.cr === 'cancel') { _bannerAdd = false; window.crRefreshBanner(); return; }
        if (b.dataset.cr === 'confirm') { window.crConfirm(b.dataset.id).then(() => window.crRefreshBanner()); return; }
        if (b.dataset.cr === 'retire') {
          const id = b.dataset.id, r = _rules.find(x => x.id === id);
          const go = () => window.crSetStatus(id, 'retired').then(() => window.crRefreshBanner());
          if (typeof window.uiConfirm === 'function') window.uiConfirm({ title: 'このルールを廃止しますか？', lines: ['「' + (r ? r.body.slice(0, 40) : '') + '」を、見積画面に出さないようにします。', '履歴には残り、マスター管理の「廃止したルール」から復活できます。'], okLabel: '廃止する', danger: true }).then(ok => { if (ok) go(); });
          else if (confirm('このルールを廃止しますか？')) go();
          return;
        }
        if (b.dataset.cr === 'save') {
          const ctx = el._cr;
          window.crSave({ customer: ctx.customer, contact: el.querySelector('.cr-f-contact').value, level: el.querySelector('.cr-f-level').value,
            body: el.querySelector('.cr-f-body').value, reason: el.querySelector('.cr-f-reason').value }).then(ok => { if (ok) { _bannerAdd = false; _bannerOpen = true; } window.crRefreshBanner(); });
        }
      });
      el._crBound = true;
    }
  };
  // ご担当者を入れ替えたときもバナーを更新（お客様名の変更は qfRefreshCustomerDetailBtn から）
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'qf-person') { clearTimeout(window.__crT); window.__crT = setTimeout(() => window.crRefreshBanner(), 200); }
  });
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'qf-person') window.crRefreshBanner();
  });
})();
