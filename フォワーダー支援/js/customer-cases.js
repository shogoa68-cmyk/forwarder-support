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

  // ---- 表示（Design 45 案A：一覧が主・［＋ 事例を記録］で同じ場所に入力欄） ----
  const NOTE = '🔒 社内専用（見積書・メールには出ません）。「何が起き・どう解決し・次はどうするか」を残すと、次の担当者が同じ失敗を避けられます。';
  const KIND_SHORT = { delay: '遅延', doc: '書類', cost: '費用・請求', cargo: '貨物・事故', comm: '連絡・手配', other: 'その他' };
  function _itemHtml(c, ctx) {
    const k = KINDS[c.kind] || KINDS.other, open = c.status === 'open';
    const sec = (lab, txt, cls) => txt ? `<div class="cc-sec${cls ? ' ' + cls : ''}"><span class="cc-lab">${lab}</span><span class="cc-txt">${_esc(txt)}</span></div>` : '';
    const meta = [_esc(_ymd(c.occurred_on)), _esc(k.icon + ' ' + k.label), c.ref ? '案件 ' + _esc(c.ref) : '', '登録：' + _esc(_who(c.created_by))].filter(Boolean).join(' · ');
    const sub = [c.subcon ? 'サブコン：' + _esc(c.subcon) : '', c.contact ? '先方：' + _esc(window.formatPersonWithHonorific ? window.formatPersonWithHonorific(c.contact) : c.contact + ' 様') : ''].filter(Boolean).join(' ／ ');
    const menuOpen = ctx && ctx.menuId === c.id;
    const promo = c.promoted_at
      ? `<button type="button" class="cc-mi" data-cc="rules" data-id="${_esc(c.id)}">📌 取引ルールを見る</button>`
      : c.improvement
        ? `<button type="button" class="cc-mi" data-cc="promote" data-id="${_esc(c.id)}">📌 取引ルールに登録<small>「次回どうするか」を、見積入力の取引ルール（要確認）に出します</small></button>`
        : `<div class="cc-mi is-off" aria-disabled="true">📌 取引ルールに登録<small>「次回どうするか」を書くと登録できます</small></div>`;
    return `<div class="cc-item cc-st-${open ? 'open' : 'done'}${menuOpen ? ' cc-menu-open' : ''}" data-id="${_esc(c.id)}" tabindex="0">` +
      `<div class="cc-sheet-bar"><span>事例の全文</span><button type="button" class="cc-sheet-close" data-cc="sheetclose" aria-label="閉じる">✕ 閉じる</button></div>` +
      `<div class="cc-head"><span class="cc-title">${_esc(c.title)}</span>` +
      `<span class="cc-state ${open ? 'is-open' : 'is-done'}">${open ? '未解決' : '解決済み'}</span>` +
      (c.promoted_at ? '<span class="cc-promoted" title="取引ルールに登録済みです">📌 ルール登録済み</span>' : '') + `</div>` +
      `<div class="cc-meta">${meta}</div>` +
      `<div class="cc-body">` + sec('何が起きた', c.situation) + sec('どう解決した', c.action) + sec('次回どうするか', c.improvement, 'cc-sec-next') +
      (sub ? `<div class="cc-meta cc-meta-sub">${sub}</div>` : '') +
      `<div class="cc-btns"><button type="button" data-cc="${open ? 'resolve' : 'reopen'}" data-id="${_esc(c.id)}">${open ? '✓ 解決済みにする' : '↩ 未解決に戻す'}</button>` +
      `<button type="button" data-cc="edit" data-id="${_esc(c.id)}">✏️ 編集</button>` +
      `<span class="cc-btns-sp"></span><span class="cc-more-wrap"><button type="button" class="cc-more" data-cc="menu" data-id="${_esc(c.id)}" aria-haspopup="menu" aria-expanded="${menuOpen}" title="その他の操作">⋯</button>` +
      `<div class="cc-menu" role="menu">${promo}<div class="cc-sep"></div><button type="button" class="cc-mi is-danger" data-cc="del" data-id="${_esc(c.id)}">🗑 削除…</button></div></span></div>` +
      `</div></div>`;
  }
  function _formHtml(ctx) {
    const edit = ctx.editId ? _items.find(x => x.id === ctx.editId) : null;
    const rec = typeof window.mdGetCanon === 'function' ? window.mdGetCanon('customer', ctx.customer) : null;
    const names = (rec && typeof window.mdContactsOf === 'function' ? window.mdContactsOf(rec.details) : []).map(c => (c.name || '').trim()).filter(Boolean);
    if (ctx.person && !names.some(n => _normPerson(n) === _normPerson(ctx.person))) names.push(ctx.person.trim());
    if (edit && edit.contact && !names.some(n => _normPerson(n) === _normPerson(edit.contact))) names.push(edit.contact);
    const cur = edit ? (edit.contact || '') : '';
    const cOpts = '<option value="">（指定なし）</option>' + names.map(n => `<option value="${_esc(n)}"${cur && _normPerson(n) === _normPerson(cur) ? ' selected' : ''}>${_esc(n)} 様</option>`).join('');
    const kind = edit ? edit.kind : 'other';
    const kOpts = Object.keys(KINDS).map(k => `<option value="${k}"${kind === k ? ' selected' : ''}>${KINDS[k].icon} ${KINDS[k].label}</option>`).join('');
    const chips = Object.keys(KINDS).map(k => `<button type="button" class="cc-kchip${kind === k ? ' is-on' : ''}" data-cc="kind" data-k="${k}" aria-pressed="${kind === k}">${KINDS[k].icon} ${KIND_SHORT[k]}</button>`).join('');
    const v = (f, d) => _esc(edit ? (edit[f] || '') : (d || ''));
    const opt = '<em class="cc-opt">任意</em>', req = '<em class="cc-req">必須</em>';
    return `<div class="cc-form"><div class="cc-form-ttl">${edit ? '✏️ 事例を編集' : '＋ 事例を記録'}</div>` +
      `<div class="cc-form-row"><label class="cc-fl cc-fl-date"><span>発生日</span><input type="date" class="cc-f-date" value="${_esc(edit ? edit.occurred_on : _today())}"></label>` +
      `<label class="cc-fl cc-fl-ref"><span>案件（管理番号）${opt}</span><input type="text" class="cc-f-ref" placeholder="例）05-2606100-02" value="${v('ref', ctx.refDefault)}"></label></div>` +
      `<div class="cc-fl"><span>分類</span><select class="cc-f-kind" hidden>${kOpts}</select><div class="cc-kchips" role="group" aria-label="分類">${chips}</div></div>` +
      `<label class="cc-fl"><span>見出し${req}</span><input type="text" class="cc-f-title" placeholder="例）書類の原本が間に合わず船積が1便遅れた" value="${v('title')}"><small class="cc-err" hidden>見出しを入れてください</small></label>` +
      `<label class="cc-fl"><span>何が起きたか（状況・原因）</span><textarea class="cc-f-situation" rows="3" placeholder="例）見積提示の翌日に一律10%の値引きを求められた">${v('situation')}</textarea></label>` +
      `<label class="cc-fl"><span>どう解決したか（対応・結果）</span><textarea class="cc-f-action" rows="3" placeholder="例）海上運賃のみ5%で合意した">${v('action')}</textarea></label>` +
      `<label class="cc-fl cc-fl-next"><span>次回どうするか（改善案・予防策。取引ルールにできます）</span><textarea class="cc-f-improvement" rows="3" placeholder="例）カットの3営業日前までに書類の原本を依頼する">${v('improvement')}</textarea></label>` +
      `<div class="cc-form-row cc-form-2"><label class="cc-fl"><span>関係したサブコン${opt}</span><input type="text" class="cc-f-subcon" list="svSuggestions" value="${v('subcon')}"></label>` +
      `<label class="cc-fl"><span>先方の担当者${opt}</span><select class="cc-f-contact">${cOpts}</select></label></div>` +
      `<div class="cc-form-actions"><label class="cc-f-chk"><input type="checkbox" class="cc-f-resolved"${edit && edit.status === 'resolved' ? ' checked' : ''}> 解決済みとして記録</label>` +
      `<span class="cc-btns-sp"></span><button type="button" class="cc-cancel" data-cc="cancel">キャンセル</button>` +
      `<button type="button" class="cc-save" data-cc="save">${edit ? '更新する' : '記録する'}</button></div></div>`;
  }
  function _paint(el) {
    const ctx = el._cc;
    el.classList.remove('cc-has-sheet');   // 描き直すとシートのカードは消える＝暗い背景だけ残らないように
    let h = '<div class="cc-note">' + NOTE + '</div>';
    if (!_cloud()) h += '<div class="cc-empty">ログインすると、顧客カルテを見たり登録したりできます。</div>';
    else if (_missing) h += '<div class="cc-empty">顧客カルテの保存先が未作成です。<code>docs/sql/customer-cases.sql</code> を Supabase で実行してください。</div>';
    else if (ctx.view === 'form') h += _formHtml(ctx);
    else {
      const list = window.ccFor(ctx.customer), opens = list.filter(c => c.status === 'open'), dones = list.filter(c => c.status !== 'open');
      if (!list.length) {
        h += '<div class="cc-empty-box"><div class="cc-empty-ic">🗂</div><b>まだ事例はありません</b><p>イレギュラー・値引き交渉・書類の遅れなど、このお客様で起きたことを記録しておきましょう。</p>' +
          '<button type="button" class="cc-new" data-cc="new">＋ 事例を記録</button></div>';
      } else {
        if (!ctx.filterUser || !ctx.filter) ctx.filter = opens.length ? 'open' : 'all';   // 自分で選ぶまでは件数に合わせる
        if (ctx.filter === 'open' && !opens.length) ctx.filter = 'all';
        const seg = (k, lab, n) => `<button type="button" class="cc-seg-b${ctx.filter === k ? ' is-on' : ''}" data-cc="filter" data-f="${k}" aria-pressed="${ctx.filter === k}">${lab} <b>${n}</b></button>`;
        h += '<div class="cc-tools"><div class="cc-seg" role="group" aria-label="表示する事例">' + seg('open', '未解決', opens.length) + seg('done', '解決済み', dones.length) + seg('all', 'すべて', list.length) + '</div>' +
          '<span class="cc-btns-sp"></span><button type="button" class="cc-new" data-cc="new">＋ 事例を記録</button></div>';
        h += `<div class="cc-list" data-filter="${ctx.filter}">` +
          `<div class="cc-grp cc-grp-open">${opens.map(c => _itemHtml(c, ctx)).join('')}</div>` +
          (dones.length ? `<button type="button" class="cc-done-toggle" data-cc="donetoggle" aria-expanded="${!!ctx.doneOpen}">✓ 解決済み ${dones.length} 件 ${ctx.doneOpen ? '▾' : '▸'}</button>` : '') +
          `<div class="cc-grp cc-grp-done${ctx.doneOpen ? ' is-open' : ''}">${dones.map(c => _itemHtml(c, ctx)).join('')}</div></div>`;
      }
    }
    el.innerHTML = h;
    el.classList.toggle('cc-root', true);
    el.dataset.view = ctx.view || 'list';
  }
  function _dirty(el) {
    if (!el._cc || el._cc.view !== 'form') return false;
    return ['.cc-f-title', '.cc-f-situation', '.cc-f-action', '.cc-f-improvement', '.cc-f-subcon'].some(s => { const e = el.querySelector(s); return e && e.value.trim() && e.value !== (e.defaultValue || ''); });
  }
  function _openRules(el) {
    const md = document.getElementById('mdDetailModal');
    const tab = md && md.contains(el) && md.querySelector('.mt-tab[data-mt="rules"]');
    if (tab) { tab.click(); return; }
    _closeModal(true);
    const b = document.getElementById('crBanner');
    if (b) { const d = b.querySelector('details'); if (d) d.open = true; b.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  function _grow(t) { t.style.height = 'auto'; t.style.height = Math.max(72, t.scrollHeight + 2) + 'px'; }
  function _handle(el, ev) {
    const b = ev.target.closest('[data-cc]');
    const ctx = el._cc;
    // スマホ：全文のシートが開いているとき、シートの外（暗い背景）を押したら閉じる
    if (el.classList.contains('cc-has-sheet') && !ev.target.closest('.cc-sheet-open') && !ev.target.closest('.cc-menu')) { _closeSheet(el); return; }
    if (b && b.dataset.cc === 'sheetclose') { _closeSheet(el); return; }
    if (!b || !el.contains(b)) {
      if (ctx.menuId && !ev.target.closest('.cc-menu')) { ctx.menuId = null; _paint(el); return; }   // 外側を押した＝メニューを閉じるだけ
      // スマホ：カードを押すと全文のシート
      const card = ev.target.closest('.cc-item');
      if (card && el.contains(card) && _phone() && !card.classList.contains('cc-sheet-open')) { el.querySelectorAll('.cc-sheet-open').forEach(x => x.classList.remove('cc-sheet-open')); card.classList.add('cc-sheet-open'); el.classList.add('cc-has-sheet'); }
      return;
    }
    const act = b.dataset.cc, id = b.dataset.id;
    const q = s => (el.querySelector(s) || {}).value || '';
    const done = ok => { if (ok) { ctx.editId = null; ctx.view = 'list'; } _paint(el); if (ctx.onChange) ctx.onChange(); };
    if (act !== 'menu') ctx.menuId = null;
    if (act === 'new') { ctx.view = 'form'; ctx.editId = null; _paint(el); const f = el.querySelector('.cc-f-title'); if (f) f.focus(); }
    else if (act === 'filter') { ctx.filter = b.dataset.f; ctx.filterUser = true; if (ctx.filter === 'done') ctx.doneOpen = true; _paint(el); }
    else if (act === 'donetoggle') { ctx.doneOpen = !ctx.doneOpen; _paint(el); }
    else if (act === 'menu') { ctx.menuId = ctx.menuId === id ? null : id; _paint(el); const m = el.querySelector('.cc-menu-open .cc-mi:not(.is-off)'); if (m) m.focus(); }
    else if (act === 'kind') {
      const sel = el.querySelector('.cc-f-kind'); if (sel) { sel.value = b.dataset.k; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      el.querySelectorAll('.cc-kchip').forEach(x => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on); });
    }
    else if (act === 'save') {
      const tEl = el.querySelector('.cc-f-title');
      if (tEl && !tEl.value.trim()) { tEl.classList.add('is-err'); const er = el.querySelector('.cc-err'); if (er) er.hidden = false; tEl.focus(); return; }
      window.ccSave({ id: ctx.editId, customer: ctx.customer, occurred_on: q('.cc-f-date'), kind: q('.cc-f-kind'), ref: q('.cc-f-ref'), title: q('.cc-f-title'), situation: q('.cc-f-situation'),
        action: q('.cc-f-action'), improvement: q('.cc-f-improvement'), subcon: q('.cc-f-subcon'), contact: q('.cc-f-contact'), status: el.querySelector('.cc-f-resolved').checked ? 'resolved' : 'open' }).then(done);
    } else if (act === 'edit') { ctx.editId = id; ctx.view = 'form'; _paint(el); const f = el.querySelector('.cc-f-title'); if (f) f.focus(); }
    else if (act === 'cancel') { ctx.editId = null; ctx.view = 'list'; _paint(el); }
    else if (act === 'resolve') window.ccSetStatus(id, 'resolved').then(done);
    else if (act === 'reopen') window.ccSetStatus(id, 'open').then(done);
    else if (act === 'promote') window.ccPromote(id).then(ok => { done(ok); if (ok && typeof window.crRefreshBanner === 'function') window.crRefreshBanner(); });
    else if (act === 'rules') { _paint(el); _openRules(el); }
    else if (act === 'del') {
      const c = _items.find(x => x.id === id), go = () => window.ccDelete(id).then(done);
      _paint(el);
      if (typeof window.uiConfirm === 'function') window.uiConfirm({ title: 'この事例を削除しますか？', lines: ['「' + (c ? c.title.slice(0, 40) : '') + '」を削除します。元に戻せません。'], okLabel: '削除する', danger: true }).then(ok => { if (ok) go(); });
      else if (confirm('この事例を削除しますか？')) go();
    }
  }
  const _phone = () => window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
  function _closeSheet(el) { el.querySelectorAll('.cc-sheet-open').forEach(x => x.classList.remove('cc-sheet-open')); el.classList.remove('cc-has-sheet'); }
  function _bind(el) {
    if (el._ccBound) return;
    el.addEventListener('click', ev => _handle(el, ev));
    el.addEventListener('input', ev => {
      if (ev.target.matches('textarea')) _grow(ev.target);
      if (ev.target.matches('.cc-f-title') && ev.target.value.trim()) { ev.target.classList.remove('is-err'); const er = el.querySelector('.cc-err'); if (er) er.hidden = true; }
    });
    el.addEventListener('keydown', ev => {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('cc-item') && _phone()) { ev.preventDefault(); ev.target.click(); }
    });
    el._ccBound = true;
  }
  // Esc：開いている［⋯］メニュー・スマホの全文シートを先に閉じる（焦点がどこにあっても。モーダル・ドロワーは閉じない）
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || document.querySelector('.confirm-dialog')) return;
    for (const el of document.querySelectorAll('.cc-root')) {
      if (el._cc && el._cc.menuId) { const id = el._cc.menuId; el._cc.menuId = null; _paint(el); const b = el.querySelector(`.cc-more[data-id="${id}"]`); if (b) b.focus(); ev.stopImmediatePropagation(); ev.preventDefault(); return; }
      if (el.classList.contains('cc-has-sheet')) { _closeSheet(el); ev.stopImmediatePropagation(); ev.preventDefault(); return; }
    }
  }, true);
  // マスター管理（お客様の詳細・タブ「顧客カルテ」）
  window.ccMountPanel = async function (el, customer, onChange) {
    if (!el) return;
    el._cc = { customer: String(customer || '').trim(), editId: null, view: 'list', filter: null, doneOpen: false, onChange: onChange || (() => { if (typeof window.statsRefreshMasterList === 'function') window.statsRefreshMasterList(); }) };
    _bind(el);
    el.innerHTML = '<div class="cc-empty">読み込み中…</div>';
    await window.ccLoad();
    if (document.body.contains(el)) _paint(el);
  };

  // ---- 見積タブ：取引ルールの帯に「🗂 過去の事例 N件」を並べる（押すと一覧・追加のモーダル）----
  function _modalEl() { return document.getElementById('ccModal'); }
  function _closeModal(force) {
    const m = _modalEl(); if (!m) return;
    const body = m.querySelector('#ccModalBody');
    const go = () => { m.remove(); document.body.classList.remove('md-modal-open'); };
    if (!force && body && _dirty(body) && typeof window.uiConfirm === 'function') {
      window.uiConfirm({ title: '入力中の事例を破棄しますか？', lines: ['記録していない入力は消えます。'], okLabel: '破棄して閉じる', danger: true }).then(ok => { if (ok) go(); });
      return;
    }
    go();
  }
  function _paintModal() {
    const m = _modalEl(); if (!m) return;
    const body = m.querySelector('#ccModalBody'); if (!body) return;
    const customer = ((document.getElementById('qf-customer') || {}).value || '').trim(), person = ((document.getElementById('qf-person') || {}).value || '').trim();
    const ref = ((document.getElementById('qf-ref') || {}).value || '').trim();
    const prev = body._cc || {};
    body._cc = { customer, person, editId: prev.editId || null, view: prev.view || 'list', filter: prev.customer === customer ? prev.filter : null, filterUser: prev.customer === customer && !!prev.filterUser, doneOpen: !!prev.doneOpen, refDefault: ref, onChange: () => window.crRefreshBanner && window.crRefreshBanner() };
    _bind(body);
    const t = m.querySelector('.md-modal-head h3'); if (t) t.textContent = '🗂 顧客カルテ　' + customer;
    if (body._cc.view === 'form' && body.querySelector('.cc-form')) return;   // 入力中は描き直さない
    _paint(body);
  }
  function _openModal() {
    if (_modalEl()) return;
    const m = document.createElement('div'); m.id = 'ccModal'; m.className = 'md-modal-overlay'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="md-modal cr-modal cc-modal"><div class="md-modal-head"><h3></h3><button type="button" class="md-modal-close" title="閉じる（Esc）" aria-label="閉じる">✕</button></div>' +
      '<div class="md-modal-body"><div id="ccModalBody"></div></div></div>';
    document.body.appendChild(m); document.body.classList.add('md-modal-open');
    m.addEventListener('click', ev => { if (ev.target === m || ev.target.closest('.md-modal-close')) _closeModal(); });
    _paintModal();
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _modalEl() && !document.querySelector('.confirm-dialog') && !e.defaultPrevented) _closeModal(); });
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
  window.ccAll = () => _sorted(_items);   // 情報共有の新着まとめ（js/share-feed.js）用
})();
