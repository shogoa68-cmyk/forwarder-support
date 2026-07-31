// 諸チャージタブ: 明細プリセット（行パターン）管理
// 見積タブの「行を挿入」→「📦 保存パターン」と同じ Supabase row_patterns テーブルを共有する。
// 見積タブの行パターン編集モーダル（rpEditOverlay）は #tab-quote-make スコープの DOM/CSS のため
// 諸チャージタブから直接開けない。そのため専用の一覧・編集モーダルをここで実装する。
(function () {
  'use strict';

  const TABLE = 'row_patterns';

  let _patterns = [];
  let _edit = null;   // { id, name, note, rows }

  function _db()   { return typeof window.cloudGetClient    === 'function' ? window.cloudGetClient()    : null; }
  function _me()   { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return u ? (u.email || '') : ''; }
  function _name(email) { return typeof window.quoteDisplayName === 'function' ? window.quoteDisplayName(email) : (email || '—'); }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function _ea(s)  { return _esc(s); }
  function _fmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit' }); } catch (e) { return ''; } }

  function _cats() { return window.LC_CATS       || [{ value: '', label: '— カテゴリ —' }]; }
  function _curs() { return window.LC_CURRENCIES || ['JPY']; }
  function _units(){ return window.LC_UNITS      || ['']; }

  // === 一覧モーダル ===

  async function lcRpOpenList() {
    document.getElementById('lcRpListModal')?.classList.add('open');
    await _load();
  }
  window.lcRpOpenList = lcRpOpenList;

  function lcRpCloseList() { document.getElementById('lcRpListModal')?.classList.remove('open'); }
  window.lcRpCloseList = lcRpCloseList;

  async function _load() {
    const wrap = document.getElementById('lcRpListWrap');
    const db = _db();
    if (!db || !_me()) {
      _patterns = [];
      if (wrap) wrap.innerHTML = '<div class="lcrp-empty">☁️ ログインするとチームの明細プリセットを利用できます</div>';
      return;
    }
    if (wrap) wrap.innerHTML = '<div class="lcrp-empty">読み込み中…</div>';
    if (typeof window.quoteLoadProfiles === 'function') { try { await window.quoteLoadProfiles(); } catch (e) {} }
    const { data, error } = await db.from(TABLE).select('*').order('updated_at', { ascending: false });
    if (error) {
      if (wrap) wrap.innerHTML = '<div class="lcrp-empty">⚠️ 読み込みエラー：' + _esc(error.message) + '</div>';
      return;
    }
    _patterns = data || [];
    _renderList();
  }

  function _renderList() {
    const wrap = document.getElementById('lcRpListWrap');
    if (!wrap) return;
    if (!_patterns.length) {
      wrap.innerHTML = '<div class="lcrp-empty">保存済みの明細プリセットはありません<br><small>「＋ 新規プリセット作成」から登録してください</small></div>';
      return;
    }
    wrap.innerHTML = _patterns.map(p => {
      const cnt = Array.isArray(p.rows) ? p.rows.length : 0;
      const actor = _name(p.updated_by || p.created_by);
      return '<div class="lcrp-card">' +
        '<div class="lcrp-card-head">' +
          '<span class="lcrp-card-name">' + _esc(p.name) + '</span>' +
          '<span class="lcrp-card-cnt">' + cnt + '行</span>' +
        '</div>' +
        (p.note ? '<div class="lcrp-card-note">' + _esc(p.note) + '</div>' : '') +
        '<div class="lcrp-card-meta">更新: ' + _esc(actor) + ' ・ ' + _fmtDate(p.updated_at) + '</div>' +
        '<div class="lcrp-card-ops">' +
          '<button onclick="lcRpOpenEdit(\'' + _ea(p.id) + '\')">✎ 開く</button>' +
          '<button class="lcrp-card-del" onclick="lcRpDelete(\'' + _ea(p.id) + '\')">🗑️ 削除</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // === 編集モーダル ===

  function lcRpNew() {
    _edit = { id: null, name: '', note: '', rows: [] };
    _openEditor('＋ 明細プリセットの新規作成');
  }
  window.lcRpNew = lcRpNew;

  function lcRpOpenEdit(id) {
    const p = _patterns.find(x => x.id === id);
    if (!p) return;
    _edit = {
      id: p.id,
      name: p.name || '',
      note: p.note || '',
      rows: Array.isArray(p.rows) ? p.rows.map(r => Object.assign({}, r)) : [],
    };
    _openEditor('✎ 「' + p.name + '」を編集');
  }
  window.lcRpOpenEdit = lcRpOpenEdit;

  function _openEditor(title) {
    const t = document.getElementById('lcRpEditTitle');
    if (t) t.textContent = title;
    const nm = document.getElementById('lcRpEditName'); if (nm) nm.value = _edit.name;
    const nt = document.getElementById('lcRpEditNote'); if (nt) nt.value = _edit.note;
    _renderRows();
    document.getElementById('lcRpEditModal')?.classList.add('open');
  }

  function lcRpCloseEdit() {
    document.getElementById('lcRpEditModal')?.classList.remove('open');
    _edit = null;
  }
  window.lcRpCloseEdit = lcRpCloseEdit;

  function lcRpAddRow(type) {
    if (!_edit) return;
    let row;
    if (type === 'remark')        row = { _type: 'remark', text: '', internal: false };
    else if (type === 'subtotal') row = { _type: 'subtotal', label: '' };
    else row = { _type: 'data', cat: '', name: '', taxed: false, pq: '', un: '',
                 pc: 'JPY', pp: '', bq: '', bc: 'JPY', bp: '', mk: '', note: '', sv: '' };
    _edit.rows.push(row);
    _renderRows();
    const box = document.getElementById('lcRpEditRows');
    box?.querySelector('.lcrp-er-row:last-child .lcrp-er-name')?.focus();
  }
  window.lcRpAddRow = lcRpAddRow;

  function lcRpDeleteRow(i) { if (_edit) { _edit.rows.splice(i, 1); _renderRows(); } }
  window.lcRpDeleteRow = lcRpDeleteRow;

  function lcRpMoveRow(i, dir) {
    if (!_edit) return;
    const j = i + dir;
    if (j < 0 || j >= _edit.rows.length) return;
    const t = _edit.rows[i]; _edit.rows[i] = _edit.rows[j]; _edit.rows[j] = t;
    _renderRows();
  }
  window.lcRpMoveRow = lcRpMoveRow;

  // セル値の更新（再描画しない＝入力フォーカスを保持）
  function lcRpSetCell(i, key, val) { if (_edit && _edit.rows[i]) _edit.rows[i][key] = val; }
  window.lcRpSetCell = lcRpSetCell;

  function _catOpts(sel) {
    return _cats().map(c => '<option value="' + _ea(c.value) + '"' + (c.value === sel ? ' selected' : '') + '>' + _esc(c.label) + '</option>').join('');
  }
  function _unitOpts(sel) {
    return _units().map(u => '<option value="' + _ea(u) + '"' + (u === sel ? ' selected' : '') + '>' + (_esc(u) || '（単位なし）') + '</option>').join('');
  }
  function _curOpts(sel) {
    return _curs().map(c => '<option value="' + _ea(c) + '"' + (c === sel ? ' selected' : '') + '>' + c + '</option>').join('');
  }

  function _rowEditor(rd, i, last) {
    const acts =
      '<span class="lcrp-er-acts">' +
        '<button type="button" onclick="lcRpMoveRow(' + i + ',-1)" title="上へ"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button type="button" onclick="lcRpMoveRow(' + i + ',1)" title="下へ"' + (i === last ? ' disabled' : '') + '>▼</button>' +
        '<button type="button" class="lcrp-er-del" onclick="lcRpDeleteRow(' + i + ')" title="この明細を削除">✕</button>' +
      '</span>';
    if (rd._type === 'remark') {
      return '<div class="lcrp-er-row lcrp-er--remark">' +
        '<span class="lcrp-er-ic">📝</span>' +
        '<input type="text" class="lcrp-er-name" placeholder="リマーク文" value="' + _ea(rd.text || '') + '" oninput="lcRpSetCell(' + i + ',\'text\',this.value)">' +
        '<label class="lcrp-er-chk" title="社内用（客先出力に含めない）"><input type="checkbox"' + (rd.internal ? ' checked' : '') + ' onchange="lcRpSetCell(' + i + ',\'internal\',this.checked)">社内</label>' +
        acts +
      '</div>';
    }
    if (rd._type === 'subtotal') {
      return '<div class="lcrp-er-row lcrp-er--subtotal">' +
        '<span class="lcrp-er-ic">Σ</span>' +
        '<input type="text" class="lcrp-er-name" placeholder="小計ラベル" value="' + _ea(rd.label || '') + '" oninput="lcRpSetCell(' + i + ',\'label\',this.value)">' +
        acts +
      '</div>';
    }
    return '<div class="lcrp-er-row lcrp-er--data">' +
      '<div class="lcrp-er-l1">' +
        '<select class="lcrp-er-cat" onchange="lcRpSetCell(' + i + ',\'cat\',this.value)">' + _catOpts(rd.cat || '') + '</select>' +
        '<input type="text" class="lcrp-er-name" placeholder="品目名" value="' + _ea(rd.name || '') + '" oninput="lcRpSetCell(' + i + ',\'name\',this.value)">' +
        '<select class="lcrp-er-unit" title="単位" onchange="lcRpSetCell(' + i + ',\'un\',this.value)">' + _unitOpts(rd.un || '') + '</select>' +
        '<label class="lcrp-er-chk" title="課税対象"><input type="checkbox"' + (rd.taxed ? ' checked' : '') + ' onchange="lcRpSetCell(' + i + ',\'taxed\',this.checked)">税</label>' +
        acts +
      '</div>' +
      '<div class="lcrp-er-l2">' +
        '<input type="text" class="lcrp-er-sv" placeholder="取引先（サブコン）" value="' + _ea(rd.sv || '') + '" oninput="lcRpSetCell(' + i + ',\'sv\',this.value)">' +
        '<span class="lcrp-er-grp lcrp-er-grp--cost">仕</span>' +
        '<input type="text" inputmode="decimal" class="lcrp-er-num" placeholder="単価" value="' + _ea(rd.pp || '') + '" oninput="lcRpSetCell(' + i + ',\'pp\',this.value)">' +
        '<select class="lcrp-er-cur" onchange="lcRpSetCell(' + i + ',\'pc\',this.value)">' + _curOpts(rd.pc || 'JPY') + '</select>' +
        '<span class="lcrp-er-grp lcrp-er-grp--sell">売</span>' +
        '<input type="text" inputmode="decimal" class="lcrp-er-num" placeholder="単価" value="' + _ea(rd.bp || '') + '" oninput="lcRpSetCell(' + i + ',\'bp\',this.value)">' +
        '<select class="lcrp-er-cur" onchange="lcRpSetCell(' + i + ',\'bc\',this.value)">' + _curOpts(rd.bc || 'JPY') + '</select>' +
        '<input type="text" class="lcrp-er-note" placeholder="備考" value="' + _ea(rd.note || '') + '" oninput="lcRpSetCell(' + i + ',\'note\',this.value)">' +
      '</div>' +
    '</div>';
  }

  function _renderRows() {
    const box = document.getElementById('lcRpEditRows');
    const cnt = document.getElementById('lcRpEditRowCount');
    if (!box || !_edit) return;
    if (cnt) cnt.textContent = _edit.rows.length + '行';
    if (!_edit.rows.length) {
      box.innerHTML = '<div class="lcrp-empty">明細がありません。下のボタンで追加してください（保存には最低1行必要）</div>';
      return;
    }
    const last = _edit.rows.length - 1;
    box.innerHTML = _edit.rows.map((rd, i) => _rowEditor(rd, i, last)).join('');
  }

  async function lcRpSave() {
    if (!_edit) return;
    const name = (document.getElementById('lcRpEditName')?.value || '').trim();
    const note = (document.getElementById('lcRpEditNote')?.value || '').trim();
    if (!name) { alert('パターン名を入力してください'); document.getElementById('lcRpEditName')?.focus(); return; }
    if (!_edit.rows.length) { alert('明細が0行です。最低1行は登録してください'); return; }
    if (_patterns.find(p => p.name === name && p.id !== _edit.id)) {
      alert('同名の明細プリセットが既にあります。別名にしてください');
      return;
    }
    const db = _db();
    const email = _me();
    if (!db || !email) { alert('チーム共有にはログインが必要です'); return; }

    const base = { name, note, rows: _edit.rows, updated_by: email };
    let error;
    if (_edit.id) {
      ({ error } = await db.from(TABLE).update(Object.assign({ updated_at: new Date().toISOString() }, base)).eq('id', _edit.id));
    } else {
      ({ error } = await db.from(TABLE).insert(Object.assign({ created_by: email }, base)));
    }
    if (error) { alert('保存に失敗しました: ' + error.message); return; }
    lcRpCloseEdit();
    await _load();
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('💾 明細プリセット「' + name + '」を保存しました', 'success');
  }
  window.lcRpSave = lcRpSave;

  async function lcRpDelete(id) {
    const p = _patterns.find(x => x.id === id);
    if (!confirm('「' + (p?.name || id) + '」を削除しますか？（チーム全員から削除されます）')) return;
    const db = _db();
    if (!db) return;
    const { error } = await db.from(TABLE).delete().eq('id', id);
    if (error) { alert('削除に失敗しました: ' + error.message); return; }
    await _load();
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('🗑️ 削除しました', 'success');
  }
  window.lcRpDelete = lcRpDelete;

})();
