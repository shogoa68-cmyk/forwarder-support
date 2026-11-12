// お客様の「顧客カルテ」（案件ごとの事例：イレギュラー／解決策／改善案・チーム共有）
//   「どの案件でこんなイレギュラーがあった → こう解決した → こうすれば改善できる」を 1 件ずつ記録して共有する。
//   取引ルール（customer-rules.js＝守ること）の上位：事例のうち繰り返し出る教訓は「📌 ルールにする」で取引ルールへ昇格できる。
//   見積タブでは、お客様を選ぶと取引ルールの帯に「🗂 過去の事例 N件」が並ぶ。社内専用（御見積書・メールには出さない）。
//   保存先：customer_cases（docs/sql/customer-cases.sql を Supabase で実行する前提。未実行でも他の機能には影響しない）
(function () {
  'use strict';

  const TABLE = 'customer_cases';
  const KINDS = {
    delay: { label: '遅延・スケジュール', icon: '⏱️' },
    doc:   { label: '書類・手続き',       icon: '📄' },
    cost:  { label: '費用・請求',         icon: '💴' },
    cargo: { label: '貨物・事故',         icon: '📦' },
    comm:  { label: '連絡・手配',         icon: '📞' },
    other: { label: 'その他',             icon: '📌' },
  };

  function _c()  { return typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null; }
  function _me() { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return u ? (u.email || '') : ''; }
  function _cloud() { return !!_c() && !!_me(); }
  const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function _toast(msg, type, ms) { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(msg, type || 'success', ms || 3200); }
  const _who = email => (typeof window._nameFor === 'function' ? window._nameFor(email) : String(email || '').split('@')[0]);
  const _today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const _ymd = s => String(s || '').replace(/-/g, '/');
  const _normPerson = s => String(s || '').replace(/[\s　]+/g, '').replace(/(様|さま|さん|殿)$/, '');
  const _canon = name => { const v = String(name || '').trim(); return v && typeof window.nameCanon === 'function' ? (window.nameCanon('customer', v) || v) : v; };

  let _items = [], _loaded = false, _missing = false, _loading = null;

  window.ccLoad = async function (force) {
    if (!_cloud()) return false;
    if (_loaded && !force) return true;
    if (_loading) return _loading;
    _loading = (async () => {
      const { data, error } = await _c().from(TABLE).select('*').order('occurred_on', { ascending: false }).order('created_at', { ascending: false });
      _loading = null;
      if (error) {
        if (/relation|does not exist|schema cache|not find|permission denied/i.test(error.message || '')) _missing = true;
        _items = []; return false;
      }
      _missing = false; _items = data || []; _loaded = true; return true;
    })();
    return _loading;
  };
  window.ccIsLoaded = () => _loaded;
  window.ccIsMissing = () => _missing;

  const _sorted = a => a.slice().sort((x, y) => String(y.occurred_on).localeCompare(String(x.occurred_on)) || String(y.created_at).localeCompare(String(x.created_at)));
  window.ccFor = customer => { const co = _canon(customer); return _sorted(_items.filter(c => _canon(c.customer) === co)); };
  window.ccStats = function (customer) {
    const list = window.ccFor(customer);
    return { n: list.length, open: list.filter(c => c.status === 'open').length, latest: list[0] || null };
  };

  async function _write(fn, okMsg) {
    if (!_cloud()) { _toast('🔒 事例の登録にはログインが必要です', 'warn'); return false; }
    if (_missing) { _toast('⚠️ 顧客カルテの保存先（customer_cases）が未作成です。docs/sql/customer-cases.sql を実行してください', 'warn', 7000); return false; }
    const { error } = await fn(_c().from(TABLE));
    if (error) {
      if (/relation|does not exist|schema cache|not find/i.test(error.message || '')) _missing = true;
      _toast('⚠️ 事例を保存できませんでした：' + (error.message || error), 'warn', 7000);
      return false;
    }
    await window.ccLoad(true);
    if (okMsg) _toast(okMsg);
    return true;
  }
  window.ccSave = function (r) {
    const title = String(r.title || '').trim();
    if (!r.customer || !title) { _toast('事例の見出しを入力してください', 'warn'); return Promise.resolve(false); }
    const t = v => String(v || '').trim() || null;
    const row = { ref: t(r.ref), occurred_on: /^\d{4}-\d{2}-\d{2}$/.test(r.occurred_on || '') ? r.occurred_on : _today(), kind: KINDS[r.kind] ? r.kind : 'other', title,
      situation: t(r.situation), action: t(r.action), improvement: t(r.improvement), subcon: t(r.subcon), contact: t(r.contact),
      status: r.status === 'resolved' ? 'resolved' : 'open', updated_by: _me(), updated_at: new Date().toISOString() };
    if (r.id) return _write(t2 => t2.update(row).eq('id', r.id), '✅ 事例を更新しました');
    return _write(t2 => t2.insert(Object.assign(row, { customer: _canon(r.customer), created_by: _me() })), '✅ 事例を登録しました');
  };
  window.ccSetStatus = (id, status) => _write(t => t.update({ status, updated_by: _me(), updated_at: new Date().toISOString() }).eq('id', id), status === 'resolved' ? '✅ 解決済みにしました' : '未解決に戻しました');
  window.ccDelete = id => _write(t => t.delete().eq('id', id), '事例を削除しました');
  // 事例の「次回どうすれば良いか」を取引ルール（要確認）として登録する
  window.ccPromote = async function (id) {
    const c = _items.find(x => x.id === id);
    if (!c) return false;
    const body = String(c.improvement || '').trim();
    if (!body) { _toast('「次回どうすれば良いか」を入れると、取引ルールにできます', 'warn'); return false; }
    if (typeof window.crSave !== 'function') { _toast('取引ルールの機能が読み込まれていません', 'warn'); return false; }
    const ok = await window.crSave({ customer: c.customer, contact: c.contact || '', level: 'check', body, reason: '事例「' + c.title + '」' + (c.ref ? '（案件 ' + c.ref + '）' : '') + 'から' });
    if (!ok) return false;
    return _write(t => t.update({ promoted_at: new Date().toISOString(), updated_by: _me(), updated_at: new Date().toISOString() }).eq('id', id), '📌 取引ルール（要確認）に登録しました');
  };

  // ---- 表示 ----
  function _itemHtml(c) {
    const k = KINDS[c.kind] || KINDS.other, open = c.status === 'open';
    const sec = (lab, txt) => txt ? `<div class="cc-sec"><span class="cc-lab">${lab}</span><span class="cc-txt">${_esc(txt)}</span></div>` : '';
    const meta = [c.ref ? '案件 ' + _esc(c.ref) : '', c.subcon ? 'サブコン：' + _esc(c.subcon) : '',
      c.contact ? '先方：' + _esc(window.formatPersonWithHonorific ? window.formatPersonWithHonorific(c.contact) : c.contact + ' 様') : '', '登録：' + _esc(_who(c.created_by))].filter(Boolean).join(' ／ ');
    return `<div class="cc-item cc-st-${open ? 'open' : 'done'}"><div class="cc-date">${_esc(_ymd(c.occurred_on))}</div><div class="cc-main">` +
      `<div class="cc-head"><span class="cc-badge cc-badge-${_esc(c.kind)}">${k.icon} ${_esc(k.label)}</span><span class="cc-title">${_esc(c.title)}</span>` +
      `<span class="cc-state ${open ? 'is-open' : 'is-done'}">${open ? '未解決' : '解決済み'}</span>` +
      (c.promoted_at ? '<span class="cc-promoted" title="取引ルールに登録済みです">📌 ルール化済み</span>' : '') + `</div>` +
      sec('何が起きた', c.situation) + sec('どう解決した', c.action) + sec('次回どうすれば良いか', c.improvement) +
      `<div class="cc-meta">${meta}</div></div><div class="cc-btns">` +
      `<button type="button" data-cc="edit" data-id="${_esc(c.id)}">編集</button>` +
      `<button type="button" data-cc="${open ? 'resolve' : 'reopen'}" data-id="${_esc(c.id)}">${open ? '解決済みにする' : '未解決に戻す'}</button>` +
      (c.improvement && !c.promoted_at ? `<button type="button" data-cc="promote" data-id="${_esc(c.id)}" title="「次回どうすれば良いか」を取引ルール（要確認）として登録します">📌 ルールにする</button>` : '') +
      `<button type="button" data-cc="del" data-id="${_esc(c.id)}">削除</button></div></div>`;
  }
  function _formHtml(ctx) {
    const edit = ctx.editId ? _items.find(x => x.id === ctx.editId) : null;
    const rec = typeof window.mdGetCanon === 'function' ? window.mdGetCanon('customer', ctx.customer) : null;
    const names = (rec && typeof window.mdContactsOf === 'function' ? window.mdContactsOf(rec.details) : []).map(c => (c.name || '').trim()).filter(Boolean);
    if (ctx.person && !names.some(n => _normPerson(n) === _normPerson(ctx.person))) names.push(ctx.person.trim());
    if (edit && edit.contact && !names.some(n => _normPerson(n) === _normPerson(edit.contact))) names.push(edit.contact);
    const cur = edit ? (edit.contact || '') : '';
    const cOpts = '<option value="">（指定なし）</option>' + names.map(n => `<option value="${_esc(n)}"${cur && _normPerson(n) === _normPerson(cur) ? ' selected' : ''}>${_esc(n)} 様</option>`).join('');
    const kOpts = Object.keys(KINDS).map(k => `<option value="${k}"${(edit ? edit.kind : 'other') === k ? ' selected' : ''}>${KINDS[k].icon} ${KINDS[k].label}</option>`).join('');
    const v = (f, d) => _esc(edit ? (edit[f] || '') : (d || ''));
    return `<div class="cc-form"><div class="cc-form-row"><label>発生日<input type="date" class="cc-f-date" value="${_esc(edit ? edit.occurred_on : _today())}"></label>` +
      `<label>分類<select class="cc-f-kind">${kOpts}</select></label>` +
      `<label>案件（管理番号）<input type="text" class="cc-f-ref" placeholder="例：05-2606100-02" value="${v('ref', ctx.refDefault)}"></label></div>` +
      `<input type="text" class="cc-f-title" placeholder="見出し（例：書類の原本が間に合わず船積が1便遅れた）" value="${v('title')}">` +
      `<textarea class="cc-f-situation" rows="2" placeholder="何が起きたか（状況・原因）">${v('situation')}</textarea>` +
      `<textarea class="cc-f-action" rows="2" placeholder="どう解決したか（対応・結果）">${v('action')}</textarea>` +
      `<textarea class="cc-f-improvement" rows="2" placeholder="次回どうすれば良いか（改善案・予防策）">${v('improvement')}</textarea>` +
      `<div class="cc-form-row"><label>関係したサブコン（任意）<input type="text" class="cc-f-subcon" list="svSuggestions" value="${v('subcon')}"></label>` +
      `<label>先方の担当者（任意）<select class="cc-f-contact">${cOpts}</select></label>` +
      `<label class="cc-f-chk"><input type="checkbox" class="cc-f-resolved"${edit && edit.status === 'resolved' ? ' checked' : ''}> 解決済み</label></div>` +
      `<div class="cc-form-actions"><button type="button" class="cc-save" data-cc="save">${edit ? '💾 更新' : '＋ 事例を追加'}</button>` + (edit ? '<button type="button" data-cc="cancel">やめる</button>' : '') + `</div>` +
      `<div class="cc-hint">🔒 社内専用です。御見積書・メール・プレビューには出ません。繰り返し出る教訓は「📌 ルールにする」で取引ルールに昇格できます。</div></div>`;
  }
  function _paint(el) {
    const ctx = el._cc;
    let h = '';
    if (!_cloud()) h = '<div class="cc-empty">ログインすると、顧客カルテを見たり登録したりできます。</div>';
    else if (_missing) h = '<div class="cc-empty">顧客カルテの保存先が未作成です。<code>docs/sql/customer-cases.sql</code> を Supabase で実行してください。</div>';
    else {
      const list = window.ccFor(ctx.customer), openN = list.filter(c => c.status === 'open').length;
      h += list.length ? (openN ? `<div class="cc-summary">未解決 ${openN}件／全 ${list.length}件</div>` : '') + '<div class="cc-list">' + list.map(_itemHtml).join('') + '</div>'
        : '<div class="cc-empty">まだ事例はありません。「どの案件で・何が起き・どう解決し・次はどうするか」を残しておくと、次の担当者が同じ失敗を避けられます。</div>';
      h += _formHtml(ctx);
    }
    el.innerHTML = h;
  }
  function _handle(el, ev) {
    const b = ev.target.closest('[data-cc]');
    if (!b || !el.contains(b)) return;
    const act = b.dataset.cc, id = b.dataset.id, ctx = el._cc;
    const q = s => (el.querySelector(s) || {}).value || '';
    const done = ok => { if (ok) ctx.editId = null; _paint(el); if (ctx.onChange) ctx.onChange(); };
    if (act === 'save') {
      window.ccSave({ id: ctx.editId, customer: ctx.customer, occurred_on: q('.cc-f-date'), kind: q('.cc-f-kind'), ref: q('.cc-f-ref'), title: q('.cc-f-title'), situation: q('.cc-f-situation'),
        action: q('.cc-f-action'), improvement: q('.cc-f-improvement'), subcon: q('.cc-f-subcon'), contact: q('.cc-f-contact'), status: el.querySelector('.cc-f-resolved').checked ? 'resolved' : 'open' }).then(done);
    } else if (act === 'edit') { ctx.editId = id; _paint(el); const f = el.querySelector('.cc-f-title'); if (f) f.focus(); }
    else if (act === 'cancel') { ctx.editId = null; _paint(el); }
    else if (act === 'resolve') window.ccSetStatus(id, 'resolved').then(done);
    else if (act === 'reopen') window.ccSetStatus(id, 'open').then(done);
    else if (act === 'promote') window.ccPromote(id).then(ok => { done(ok); if (ok && typeof window.crRefreshBanner === 'function') window.crRefreshBanner(); });
    else if (act === 'del') {
      const c = _items.find(x => x.id === id), go = () => window.ccDelete(id).then(done);
      if (typeof window.uiConfirm === 'function') window.uiConfirm({ title: 'この事例を削除しますか？', lines: ['「' + (c ? c.title.slice(0, 40) : '') + '」を削除します。元に戻せません。'], okLabel: '削除する', danger: true }).then(ok => { if (ok) go(); });
      else if (confirm('この事例を削除しますか？')) go();
    }
  }
  // マスター管理（お客様の詳細・タブ「顧客カルテ」）
  window.ccMountPanel = async function (el, customer, onChange) {
    if (!el) return;
    el._cc = { customer: String(customer || '').trim(), editId: null, onChange: onChange || (() => { if (typeof window.statsRefreshMasterList === 'function') window.statsRefreshMasterList(); }) };
    if (!el._ccBound) { el.addEventListener('click', ev => _handle(el, ev)); el._ccBound = true; }
    el.innerHTML = '<div class="cc-empty">読み込み中…</div>';
    await window.ccLoad();
    if (document.body.contains(el)) _paint(el);
  };

  // ---- 見積タブ：取引ルールの帯に「🗂 過去の事例 N件」を並べる（押すと一覧・追加のモーダル）----
  function _modalEl() { return document.getElementById('ccModal'); }
  function _closeModal() { const m = _modalEl(); if (m) { m.remove(); document.body.classList.remove('md-modal-open'); } }
  function _paintModal() {
    const m = _modalEl(); if (!m) return;
    const body = m.querySelector('#ccModalBody'); if (!body) return;
    const customer = ((document.getElementById('qf-customer') || {}).value || '').trim(), person = ((document.getElementById('qf-person') || {}).value || '').trim();
    const ref = ((document.getElementById('qf-ref') || {}).value || '').trim();
    const keep = body._cc && body._cc.editId;
    body._cc = { customer, person, editId: keep || null, refDefault: ref, onChange: () => window.crRefreshBanner && window.crRefreshBanner() };
    if (!body._ccBound) { body.addEventListener('click', ev => _handle(body, ev)); body._ccBound = true; }
    const t = m.querySelector('.md-modal-head h3'); if (t) t.textContent = '🗂 顧客カルテ　' + customer;
    _paint(body);
  }
  function _openModal() {
    if (_modalEl()) return;
    const m = document.createElement('div'); m.id = 'ccModal'; m.className = 'md-modal-overlay'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="md-modal cr-modal"><div class="md-modal-head"><h3></h3><button type="button" class="md-modal-close" title="閉じる（Esc）" aria-label="閉じる">✕</button></div>' +
      '<div class="md-modal-body"><p class="cr-modal-note">このお客様の過去の事例（イレギュラー・解決策・改善案）です。この案件で起きたことも、ここから記録できます（社内専用）。</p><div id="ccModalBody"></div></div></div>';
    document.body.appendChild(m); document.body.classList.add('md-modal-open');
    m.addEventListener('click', ev => { if (ev.target === m || ev.target.closest('.md-modal-close')) _closeModal(); });
    _paintModal();
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _modalEl() && !document.querySelector('.confirm-dialog')) _closeModal(); });
  // 取引ルールの帯の更新に便乗して、事例のチップを足す
  function _wrapBanner() {
    const orig = window.crRefreshBanner;
    if (typeof orig !== 'function' || orig.__cc) return false;
    const w = async function () {
      const r = await orig.apply(this, arguments);
      const el = document.getElementById('crBanner');
      if (!el || el.hidden) { _closeModal(); return r; }
      const customer = ((document.getElementById('qf-customer') || {}).value || '').trim();
      if (!customer || !_cloud()) return r;
      await window.ccLoad();
      if (_missing) return r;
      el.querySelectorAll('.cc-chip').forEach(x => x.remove());
      const s = window.ccStats(customer);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cc-chip' + (s.open ? ' has-open' : s.n ? ' has-cases' : '');
      b.dataset.cc = 'open'; b.setAttribute('aria-haspopup', 'dialog');
      b.title = '過去の事例（イレギュラー・解決策・改善案）を見る・記録する（社内専用）';
      b.textContent = '🗂 過去の事例' + (s.n ? '（' + s.n + '件' + (s.open ? '・未解決' + s.open : '') + '）' : '（なし）');
      el.appendChild(b);
      if (!el._ccBound) { el.addEventListener('click', ev => { if (ev.target.closest('[data-cc="open"]')) _openModal(); }); el._ccBound = true; }
      if (_modalEl()) _paintModal();
      return r;
    };
    w.__cc = true; window.crRefreshBanner = w; return true;
  }
  if (!_wrapBanner()) window.addEventListener('load', _wrapBanner);
  window.CC_KINDS = KINDS;
})();
