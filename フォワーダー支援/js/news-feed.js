// 情報共有 › 📰 ニュースの投稿（2026-11）
//   お客様・サブコンから聞いた情報を、だれでも投稿し、全社ぶんをタイムライン（新しい順）で見る画面。
//   保存先は既存の master_news（js/master-news.js の mnSave／mnDelete）なので、投稿したニュースは
//   そのままマスター管理の「詳細 › ニュース」にも出る（＝各マスターに紐づいて保管される）。SQL の追加は不要。
(function () {
  'use strict';
  const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const _who = e => (typeof window._nameFor === 'function' ? window._nameFor(e) : String(e || '').split('@')[0]);
  const _logged = () => !!(typeof window.cloudCurrentUser === 'function' && window.cloudCurrentUser());
  const _today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const FIELDS = { customer: { label: 'お客様', icon: '🏢', list: 'custSuggestions' }, sv: { label: 'サブコン', icon: '🤝', list: 'svSuggestions' } };
  const _canon = (f, n) => { const v = String(n || '').trim(); return v && typeof window.nameCanon === 'function' ? (window.nameCanon(f, v) || v) : v; };
  const _norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

  const st = { field: 'all', kind: 'all', q: '', editId: null, formField: 'customer', shown: 50 };
  let root = null;

  function kinds() { return window.MN_KINDS || {}; }

  // マスターに登録されているか（別名も代表名にそろえて）。読み込み前は 'unknown'
  function masterState(field, name) {
    if (typeof window.statsMasterState !== 'function') return 'unknown';
    return window.statsMasterState(field, _canon(field, name));
  }

  function formHtml() {
    const K = kinds();
    const edit = st.editId ? (window.mnAll ? window.mnAll() : []).find(n => n.id === st.editId) : null;
    const f = edit ? edit.field : st.formField;
    const fOpts = Object.keys(FIELDS).map(k => `<button type="button" class="nf-seg${f === k ? ' is-on' : ''}" data-nf="ffield" data-v="${k}"${edit ? ' disabled' : ''}>${FIELDS[k].icon} ${FIELDS[k].label}</button>`).join('');
    const kOpts = Object.keys(K).map(k => `<option value="${k}"${(edit ? edit.kind : 'news') === k ? ' selected' : ''}>${K[k].icon} ${_esc(K[k].label)}</option>`).join('');
    return `<form class="nf-form" onsubmit="return false">
      <div class="nf-form-h">${edit ? '✏️ ニュースを直す' : '＋ ニュースを投稿'}</div>
      <div class="nf-row"><span class="nf-lab">だれの情報？</span><span class="nf-segs">${fOpts}</span>
        <input type="text" class="nf-f-name" list="${FIELDS[f].list}" autocomplete="off" placeholder="${FIELDS[f].label}の名前（マスターから選ぶ）" value="${_esc(edit ? edit.name : (st.draftName || ''))}"${edit ? ' disabled' : ''}></div>
      <div class="nf-name-hint" aria-live="polite"></div>
      <div class="nf-row"><label class="nf-lab2">日付<input type="date" class="nf-f-date" value="${_esc(edit ? edit.news_date : _today())}"></label>
        <label class="nf-lab2">種類<select class="nf-f-kind">${kOpts}</select></label></div>
      <input type="text" class="nf-f-title" placeholder="見出し（例：本社を新宿へ移転／営業担当が田中さんに変更）" value="${_esc(edit ? edit.title : '')}">
      <textarea class="nf-f-body" rows="3" placeholder="くわしい内容（任意：だれから聞いたか・新しい住所・連絡先など）">${_esc(edit ? edit.body || '' : '')}</textarea>
      <input type="text" class="nf-f-url" placeholder="参考リンク（任意：https://…）" value="${_esc(edit ? edit.url || '' : '')}">
      <div class="nf-actions"><button type="button" class="nf-post" data-nf="save">${edit ? '💾 更新する' : '📰 投稿する'}</button>${edit ? '<button type="button" class="nf-sub" data-nf="cancel">やめる</button>' : ''}
        <span class="nf-note">投稿は、その${edit ? FIELDS[edit.field].label : FIELDS[f].label}のマスター詳細「ニュース」にも保存されます（社内だけ・見積書には出ません）</span></div>
    </form>`;
  }

  function itemHtml(n) {
    const K = kinds(), k = K[n.kind] || K.other || { icon: '📌', label: 'その他' }, F = FIELDS[n.field] || FIELDS.customer;
    const url = /^https?:\/\//i.test(String(n.url || '')) ? n.url : '';
    return `<li class="nf-item nf-k-${_esc(n.kind)}">
      <div class="nf-dot" aria-hidden="true">${k.icon}</div>
      <div class="nf-card">
        <div class="nf-head"><span class="nf-date">${_esc(String(n.news_date || '').replace(/-/g, '/'))}</span>
          <span class="mn-badge mn-badge-${_esc(n.kind)}">${k.icon} ${_esc(k.label)}</span>
          <button type="button" class="nf-target" data-nf="open" data-f="${_esc(n.field)}" data-name="${_esc(n.name)}" title="この会社のニュースを見る">${F.icon} ${_esc(n.name)}</button></div>
        <div class="nf-title">${_esc(n.title)}</div>
        ${n.body ? `<div class="nf-body">${_esc(n.body)}</div>` : ''}
        ${url ? `<div class="nf-link"><a href="${_esc(url)}" target="_blank" rel="noopener noreferrer">🔗 ${_esc(url.length > 60 ? url.slice(0, 60) + '…' : url)}</a></div>` : ''}
        <div class="nf-foot"><span>投稿：${_esc(_who(n.created_by))}${n.updated_by && n.updated_by !== n.created_by ? ' ／ 更新：' + _esc(_who(n.updated_by)) : ''}</span>
          <span class="nf-btns"><button type="button" data-nf="edit" data-id="${_esc(n.id)}">編集</button><button type="button" data-nf="del" data-id="${_esc(n.id)}">削除</button></span></div>
      </div></li>`;
  }

  function filtered() {
    const all = window.mnAll ? window.mnAll() : [];
    const q = _norm(st.q).split(/\s+/).filter(Boolean);
    return all.filter(n => (st.field === 'all' || n.field === st.field) && (st.kind === 'all' || n.kind === st.kind) &&
      (!q.length || q.every(w => _norm([n.name, n.title, n.body, n.url].join(' ')).includes(w))));
  }

  function listHtml() {
    const all = window.mnAll ? window.mnAll() : [];
    const list = filtered();
    const K = kinds();
    const cnt = f => all.filter(n => f === 'all' || n.field === f).length;
    const fchips = ['all', 'customer', 'sv'].map(f => `<button type="button" class="nf-chip${st.field === f ? ' is-on' : ''}" data-nf="field" data-v="${f}">${f === 'all' ? 'すべて' : FIELDS[f].icon + ' ' + FIELDS[f].label} <b>${cnt(f)}</b></button>`).join('');
    const kOpts = '<option value="all">種類：すべて</option>' + Object.keys(K).map(k => `<option value="${k}"${st.kind === k ? ' selected' : ''}>${K[k].icon} ${_esc(K[k].label)}</option>`).join('');
    let h = `<div class="nf-tools"><span class="nf-chips">${fchips}</span><select class="nf-kind" data-nf="kind">${kOpts}</select>
      <input type="search" class="nf-q" placeholder="会社名・見出し・内容で探す" value="${_esc(st.q)}"></div>`;
    if (!list.length) {
      h += `<div class="nf-empty">${all.length ? '条件に合うニュースはありません。' : 'まだニュースはありません。お客様・サブコンから聞いた新しい情報（移転・担当変更・料金改定など）を、上のフォームから投稿してください。'}</div>`;
      return h;
    }
    // 月ごとに見出しを入れる
    let cur = '', out = '';
    list.slice(0, st.shown).forEach(n => {
      const m = String(n.news_date || '').slice(0, 7);
      if (m !== cur) { cur = m; out += `<li class="nf-month">${_esc(m.replace('-', '年'))}月</li>`; }
      out += itemHtml(n);
    });
    h += `<div class="nf-count">${list.length} 件</div><ul class="nf-timeline">${out}</ul>`;
    if (list.length > st.shown) h += `<button type="button" class="nf-more" data-nf="more">さらに表示（残り ${list.length - st.shown} 件）</button>`;
    return h;
  }

  function paintList() { const el = root && root.querySelector('.nf-list'); if (el) el.innerHTML = listHtml(); }
  function paint() {
    if (!root) return;
    let body;
    if (!_logged()) body = '<div class="nf-empty">ログインすると、ニュースを投稿したり見たりできます。</div>';
    else if (window.mnIsMissing && window.mnIsMissing()) body = '<div class="nf-empty">ニュースの保存先が未作成です。<code>docs/sql/master-news.sql</code> を Supabase で実行してください。</div>';
    else body = formHtml() + '<div class="nf-list">' + listHtml() + '</div>';
    root.innerHTML = `<div class="nf-hd"><h2 class="nf-h">📰 ニュースの投稿</h2>
      <p class="nf-lead">お客様・サブコンから聞いた新しい情報を投稿して、チームで時系列に見られます。投稿はそれぞれのマスター詳細にも保存されます。</p></div>` + body;
    checkName();
  }

  function checkName() {
    if (!root) return;
    const inp = root.querySelector('.nf-f-name'), hint = root.querySelector('.nf-name-hint');
    if (!inp || !hint || inp.disabled) { if (hint) hint.innerHTML = ''; return; }
    const v = inp.value.trim(), f = st.formField;
    if (!v) { hint.innerHTML = ''; return; }
    const s = masterState(f, v), c = _canon(f, v);
    if (s === 'none') hint.innerHTML = `⚠ 「${_esc(v)}」は${FIELDS[f].label}のマスターに未登録です。先にマスター登録すると、ニュースがその詳細に紐づきます。 <button type="button" class="nf-sub" data-nf="reg">＋ マスター登録</button>`;
    else if (s === 'pending') hint.innerHTML = `📨 「${_esc(v)}」はマスター登録の申請中です（承認されるとニュースが詳細に出ます）。`;
    else if (s === 'master' && c !== v) hint.innerHTML = `✓ 代表名「${_esc(c)}」として保存します。`;
    else hint.innerHTML = '';
  }

  async function save() {
    const g = c => root.querySelector(c);
    const edit = st.editId ? window.mnAll().find(n => n.id === st.editId) : null;
    const field = edit ? edit.field : st.formField, name = edit ? edit.name : g('.nf-f-name').value.trim();
    if (!name) { if (window.quoteShowToast) window.quoteShowToast(`${FIELDS[field].label}の名前を入れてください`, 'warn'); g('.nf-f-name').focus(); return; }
    if (!edit && masterState(field, name) === 'none') {
      if (window.quoteShowToast) window.quoteShowToast(`「${name}」は${FIELDS[field].label}のマスターに未登録です。先にマスター登録してください`, 'warn', 5000);
      return;
    }
    const ok = await window.mnSave({ id: st.editId, field, name, kind: g('.nf-f-kind').value, news_date: g('.nf-f-date').value,
      title: g('.nf-f-title').value, body: g('.nf-f-body').value, url: g('.nf-f-url').value });
    if (ok) { st.editId = null; st.draftName = ''; paint(); }
  }

  function onClick(e) {
    const b = e.target.closest('[data-nf]'); if (!b || !root.contains(b)) return;
    const a = b.dataset.nf;
    if (a === 'field') { st.field = b.dataset.v; st.shown = 50; paintList(); }
    else if (a === 'ffield') { const inp = root.querySelector('.nf-f-name'); st.draftName = ''; st.formField = b.dataset.v; const keep = {}; ['title', 'body', 'url', 'date', 'kind'].forEach(k => { const el = root.querySelector('.nf-f-' + k); if (el) keep[k] = el.value; }); paint(); Object.keys(keep).forEach(k => { const el = root.querySelector('.nf-f-' + k); if (el) el.value = keep[k]; }); void inp; }
    else if (a === 'save') save();
    else if (a === 'cancel') { st.editId = null; paint(); }
    else if (a === 'more') { st.shown += 50; paintList(); }
    else if (a === 'edit') { st.editId = b.dataset.id; paint(); root.querySelector('.nf-form').scrollIntoView({ block: 'nearest' }); const t = root.querySelector('.nf-f-title'); if (t) t.focus(); }
    else if (a === 'del') {
      const n = window.mnAll().find(x => x.id === b.dataset.id);
      const go = () => window.mnDelete(b.dataset.id).then(ok => { if (ok) { if (st.editId === b.dataset.id) st.editId = null; paint(); } });
      if (typeof window.uiConfirm === 'function') window.uiConfirm({ title: 'このニュースを削除しますか？', lines: ['「' + (n ? n.title.slice(0, 40) : '') + '」を削除します。マスター詳細からも消えます。元に戻せません。'], okLabel: '削除する', danger: true }).then(ok => { if (ok) go(); });
      else if (confirm('このニュースを削除しますか？')) go();
    }
    else if (a === 'open') {   // その場で簡易表示 → もっと見るならマスター詳細のニュースタブへ（js/master-peek.js）
      if (typeof window.masterPeek === 'function') window.masterPeek('news', b.dataset.f, b.dataset.name, b);
      else if (typeof window.statsJumpToMaster === 'function') window.statsJumpToMaster(b.dataset.f, b.dataset.name, 'news');
    }
    else if (a === 'reg') { const v = root.querySelector('.nf-f-name').value.trim(); if (typeof window.statsOpenRegister === 'function') window.statsOpenRegister(st.formField, v); }
  }
  function onInput(e) {
    if (e.target.matches('.nf-q')) { st.q = e.target.value; st.shown = 50; const pos = e.target.selectionStart; paintList(); const q = root.querySelector('.nf-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) {} } }
    else if (e.target.matches('.nf-f-name')) { st.draftName = e.target.value; checkName(); }
  }
  function onChange(e) { if (e.target.matches('.nf-kind')) { st.kind = e.target.value; st.shown = 50; paintList(); } }

  window.initNewsTab = async function () {
    root = document.getElementById('nfRoot'); if (!root) return;
    if (!root._nfBound) { root.addEventListener('click', onClick); root.addEventListener('input', onInput); root.addEventListener('change', onChange); root._nfBound = true; }
    if (!_logged()) { paint(); return; }
    if (!root.querySelector('.nf-form')) root.innerHTML = '<div class="nf-empty">読み込み中…</div>';
    // マスター（名前の候補・登録の確認）とニュースを読む
    try { if (typeof window.statsLoadMasterCache === 'function') await window.statsLoadMasterCache(); } catch (_) {}
    try { if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist(); } catch (_) {}
    if (window.mnLoad) await window.mnLoad(true);
    const keep = root.querySelector('.nf-f-title') && root.querySelector('.nf-f-title').value;
    if (!keep) paint(); else paintList();
  };
})();
