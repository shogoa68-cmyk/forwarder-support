// サブコン・お客様の「ニュース」（チーム共有）
//   新着ニュース・事務所移転・担当変更などを日付つきで 1 件ずつ記録し、時系列（新しい順）で見られる。
//   マスター管理の詳細（サブコン＝「📰 ニュース」欄／お客様＝タブ「ニュース」）と、一覧の印「📰 N件」から使う。
//   保存先：master_news（docs/sql/master-news.sql を Supabase で実行する前提。未実行でも他の機能には影響しない）
(function () {
  'use strict';

  const TABLE = 'master_news';
  const KINDS = {
    news:    { label: '新着ニュース', icon: '📰' },
    move:    { label: '事務所移転',   icon: '🏢' },
    contact: { label: '担当変更',     icon: '👤' },
    org:     { label: '社名・組織の変更', icon: '🔄' },
    terms:   { label: '取引条件の変更', icon: '📑' },
    other:   { label: 'その他',       icon: '📌' },
  };
  const RECENT_DAYS = 30;   // この日数以内のニュースは一覧で「新着」の印

  function _c()  { return typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null; }
  function _me() { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return u ? (u.email || '') : ''; }
  function _cloud() { return !!_c() && !!_me(); }
  const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function _toast(msg, type, ms) { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(msg, type || 'success', ms || 3200); }
  const _who = email => (typeof window._nameFor === 'function' ? window._nameFor(email) : String(email || '').split('@')[0]);
  const _today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const _ymd = s => String(s || '').replace(/-/g, '/');
  const _safeUrl = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';

  let _items = [], _loaded = false, _missing = false, _loading = null;

  window.mnLoad = async function (force) {
    if (!_cloud()) return false;
    if (_loaded && !force) return true;
    if (_loading) return _loading;
    _loading = (async () => {
      const { data, error } = await _c().from(TABLE).select('*').order('news_date', { ascending: false }).order('created_at', { ascending: false });
      _loading = null;
      if (error) {
        if (/relation|does not exist|schema cache|not find|permission denied/i.test(error.message || '')) _missing = true;
        _items = []; return false;
      }
      _missing = false; _items = data || []; _loaded = true; return true;
    })();
    return _loading;
  };
  window.mnIsLoaded = () => _loaded;

  // 名前は別名・表記ゆれを代表名にそろえて照合する
  const _canon = (field, name) => {
    const v = String(name || '').trim();
    return v && typeof window.nameCanon === 'function' ? (window.nameCanon(field, v) || v) : v;
  };
  const _sorted = a => a.slice().sort((x, y) => String(y.news_date).localeCompare(String(x.news_date)) || String(y.created_at).localeCompare(String(x.created_at)));
  window.mnFor = (field, name) => { const co = _canon(field, name); return _sorted(_items.filter(n => n.field === field && _canon(field, n.name) === co)); };
  // 一覧用：件数・最新の 1 件・新着（RECENT_DAYS 以内）かどうか
  window.mnStats = function (field, name) {
    const list = window.mnFor(field, name);
    if (!list.length) return { n: 0 };
    const latest = list[0], t = new Date(latest.news_date + 'T00:00:00').getTime();
    return { n: list.length, latest, recent: !isNaN(t) && (Date.now() - t) <= RECENT_DAYS * 86400000 };
  };

  async function _write(fn, okMsg) {
    if (!_cloud()) { _toast('🔒 ニュースの登録にはログインが必要です', 'warn'); return false; }
    if (_missing) { _toast('⚠️ ニュースの保存先（master_news）が未作成です。docs/sql/master-news.sql を実行してください', 'warn', 7000); return false; }
    const { error } = await fn(_c().from(TABLE));
    if (error) {
      if (/relation|does not exist|schema cache|not find/i.test(error.message || '')) _missing = true;
      _toast('⚠️ ニュースを保存できませんでした：' + (error.message || error), 'warn', 7000);
      return false;
    }
    await window.mnLoad(true);
    if (okMsg) _toast(okMsg);
    return true;
  }
  window.mnSave = function (r) {
    const title = String(r.title || '').trim();
    if (!r.name || !title) { _toast('ニュースの見出しを入力してください', 'warn'); return Promise.resolve(false); }
    const url = String(r.url || '').trim();
    if (url && !_safeUrl(url)) { _toast('リンクは http:// または https:// で始まる URL を入れてください', 'warn'); return Promise.resolve(false); }
    const row = { kind: KINDS[r.kind] ? r.kind : 'news', news_date: /^\d{4}-\d{2}-\d{2}$/.test(r.news_date || '') ? r.news_date : _today(), title,
      body: String(r.body || '').trim() || null, url: url || null, updated_by: _me(), updated_at: new Date().toISOString() };
    if (r.id) return _write(t => t.update(row).eq('id', r.id), '✅ ニュースを更新しました');
    return _write(t => t.insert(Object.assign(row, { field: r.field, name: _canon(r.field, r.name), created_by: _me() })), '✅ ニュースを登録しました');
  };
  window.mnDelete = id => _write(t => t.delete().eq('id', id), 'ニュースを削除しました');

  // ---- 表示 ----
  function _itemHtml(n) {
    const k = KINDS[n.kind] || KINDS.other;
    const url = _safeUrl(n.url);
    const meta = ['登録：' + _esc(_who(n.created_by))].concat(n.updated_by && n.updated_by !== n.created_by ? ['更新：' + _esc(_who(n.updated_by))] : []).join(' ／ ');
    return `<div class="mn-item mn-k-${_esc(n.kind)}"><div class="mn-date">${_esc(_ymd(n.news_date))}</div>` +
      `<div class="mn-main"><div class="mn-head"><span class="mn-badge mn-badge-${_esc(n.kind)}">${k.icon} ${_esc(k.label)}</span><span class="mn-title">${_esc(n.title)}</span></div>` +
      (n.body ? `<div class="mn-body">${_esc(n.body)}</div>` : '') +
      (url ? `<div class="mn-link"><a href="${_esc(url)}" target="_blank" rel="noopener noreferrer">🔗 ${_esc(url.length > 60 ? url.slice(0, 60) + '…' : url)}</a></div>` : '') +
      `<div class="mn-meta">${meta}</div></div>` +
      `<div class="mn-btns"><button type="button" data-mn="edit" data-id="${_esc(n.id)}">編集</button><button type="button" data-mn="del" data-id="${_esc(n.id)}">削除</button></div></div>`;
  }
  function _formHtml(ctx) {
    const edit = ctx.editId ? _items.find(n => n.id === ctx.editId) : null;
    const kOpts = Object.keys(KINDS).map(k => `<option value="${k}"${(edit ? edit.kind : 'news') === k ? ' selected' : ''}>${KINDS[k].icon} ${KINDS[k].label}</option>`).join('');
    return `<div class="mn-form"><div class="mn-form-row"><label>日付<input type="date" class="mn-f-date" value="${_esc(edit ? edit.news_date : _today())}"></label>` +
      `<label>種類<select class="mn-f-kind">${kOpts}</select></label></div>` +
      `<input type="text" class="mn-f-title" placeholder="見出し（例：本社を新宿へ移転／営業担当が田中さんに変更）" value="${_esc(edit ? edit.title : '')}">` +
      `<textarea class="mn-f-body" rows="2" placeholder="詳しい内容（任意：新しい住所・前任者・連絡先など）">${_esc(edit ? edit.body || '' : '')}</textarea>` +
      `<input type="text" class="mn-f-url" placeholder="参考リンク（任意：https://…）" value="${_esc(edit ? edit.url || '' : '')}">` +
      `<div class="mn-form-actions"><button type="button" class="mn-save" data-mn="save">${edit ? '💾 更新' : '＋ ニュースを追加'}</button>` +
      (edit ? '<button type="button" data-mn="cancel">やめる</button>' : '') + `</div></div>`;
  }
  function _paint(el) {
    const ctx = el._mn;
    let h = '';
    if (!_cloud()) h = '<div class="mn-empty">ログインすると、ニュースを見たり登録したりできます。</div>';
    else if (_missing) h = '<div class="mn-empty">ニュースの保存先が未作成です。<code>docs/sql/master-news.sql</code> を Supabase で実行してください。</div>';
    else {
      const list = window.mnFor(ctx.field, ctx.name);
      h += list.length ? '<div class="mn-timeline">' + list.map(_itemHtml).join('') + '</div>'
        : '<div class="mn-empty">まだニュースはありません。新着情報・事務所の移転・担当の変更などを、日付とともに残しておけます。</div>';
      h += _formHtml(ctx);
    }
    el.innerHTML = h;
  }
  function _handle(el, ev) {
    const b = ev.target.closest('[data-mn]');
    if (!b || !el.contains(b)) return;
    const act = b.dataset.mn, id = b.dataset.id, ctx = el._mn;
    const done = ok => { if (ok) ctx.editId = null; _paint(el); if (ctx.onChange) ctx.onChange(); };
    if (act === 'save') {
      window.mnSave({ id: ctx.editId, field: ctx.field, name: ctx.name, kind: el.querySelector('.mn-f-kind').value, news_date: el.querySelector('.mn-f-date').value,
        title: el.querySelector('.mn-f-title').value, body: el.querySelector('.mn-f-body').value, url: el.querySelector('.mn-f-url').value }).then(done);
    } else if (act === 'edit') { ctx.editId = id; _paint(el); const f = el.querySelector('.mn-f-title'); if (f) f.focus(); }
    else if (act === 'cancel') { ctx.editId = null; _paint(el); }
    else if (act === 'del') {
      const n = _items.find(x => x.id === id);
      const go = () => window.mnDelete(id).then(done);
      if (typeof window.uiConfirm === 'function') window.uiConfirm({ title: 'このニュースを削除しますか？', lines: ['「' + (n ? n.title.slice(0, 40) : '') + '」を削除します。元に戻せません。'], okLabel: '削除する', danger: true }).then(ok => { if (ok) go(); });
      else if (confirm('このニュースを削除しますか？')) go();
    }
  }
  // マスター管理の詳細に、そのサブコン／お客様のニュース（時系列）と追加フォームを出す
  window.mnMountPanel = async function (el, field, name, onChange) {
    if (!el) return;
    el._mn = { field, name: String(name || '').trim(), editId: null, onChange: onChange || (() => { if (typeof window.statsRefreshMasterList === 'function') window.statsRefreshMasterList(); }) };
    if (!el._mnBound) { el.addEventListener('click', ev => _handle(el, ev)); el._mnBound = true; }
    el.innerHTML = '<div class="mn-empty">読み込み中…</div>';
    await window.mnLoad();
    if (document.body.contains(el)) _paint(el);
  };
  window.MN_KINDS = KINDS;
})();
