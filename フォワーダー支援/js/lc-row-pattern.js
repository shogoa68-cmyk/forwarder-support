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

  function _filteredPatterns() {
    const dir = document.querySelector('input[name="lcRpListDir"]:checked')?.value || '';
    const q = (document.getElementById('lcRpListSearch')?.value || '').trim().toLowerCase();
    return _patterns.filter(p => {
      if (dir && (p.direction || '') !== dir) return false;
      if (q) {
        const hay = [p.name, ...(Array.isArray(p.tags) ? p.tags : [])].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function lcRpFilterList() { _renderList(); }
  window.lcRpFilterList = lcRpFilterList;

  function _dirBadge(direction) {
    if (direction === 'export') return '<span class="lcrp-dir-badge lcrp-dir-badge--export">📤 輸出</span>';
    if (direction === 'import') return '<span class="lcrp-dir-badge lcrp-dir-badge--import">📥 輸入</span>';
    return '';
  }

  function _renderList() {
    const wrap = document.getElementById('lcRpListWrap');
    if (!wrap) return;
    if (!_patterns.length) {
      wrap.innerHTML = '<div class="lcrp-empty">保存済みの明細プリセットはありません<br><small>「＋ 新規プリセット作成」から登録してください</small></div>';
      return;
    }
    const list = _filteredPatterns();
    if (!list.length) {
      wrap.innerHTML = '<div class="lcrp-empty">条件に一致する明細プリセットがありません</div>';
      return;
    }
    wrap.innerHTML = list.map(p => {
      const cnt = Array.isArray(p.rows) ? p.rows.length : 0;
      const actor = _name(p.updated_by || p.created_by);
      const tagsHtml = Array.isArray(p.tags) && p.tags.length
        ? '<div class="lcrp-card-tags">' + p.tags.map(t => '<span class="lcrp-card-tag">' + _esc(t) + '</span>').join('') + '</div>'
        : '';
      return '<div class="lcrp-card">' +
        '<div class="lcrp-card-head">' +
          _dirBadge(p.direction) +
          '<span class="lcrp-card-name">' + _esc(p.name) + '</span>' +
          '<span class="lcrp-card-cnt">' + cnt + '行</span>' +
        '</div>' +
        (p.note ? '<div class="lcrp-card-note">' + _esc(p.note) + '</div>' : '') +
        tagsHtml +
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
    _edit = { id: null, name: '', note: '', direction: '', tags: [], rows: [] };
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
      direction: p.direction || '',
      tags: Array.isArray(p.tags) ? p.tags.slice() : [],
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
    document.querySelectorAll('input[name="lcRpEditDir"]').forEach(r => { r.checked = (r.value === (_edit.direction || '')); });
    _rpInitTagsUI();
    _rpRenderTags();
    _renderRows();
    document.getElementById('lcRpEditModal')?.classList.add('open');
    _ensureMasterData();
  }

  // === タグチップ入力（諸チャージ POL/POD チップと同じ操作感：Enterで追加・×/Backspaceで削除） ===

  function _rpRenderTags() {
    const wrap = document.getElementById('lcRpEditTags');
    if (!wrap || !_edit) return;
    const input = wrap.querySelector('.lcrp-tag-entry');
    [...wrap.querySelectorAll('.lcrp-tag-chip')].forEach(el => el.remove());
    _edit.tags.forEach((v, i) => {
      const chip = document.createElement('span');
      chip.className = 'lcrp-tag-chip';
      chip.innerHTML = _esc(v) + '<button type="button" class="lcrp-tag-x" title="削除">×</button>';
      chip.querySelector('.lcrp-tag-x').addEventListener('click', () => {
        _edit.tags.splice(i, 1); _rpRenderTags();
      });
      if (input) wrap.insertBefore(chip, input); else wrap.appendChild(chip);
    });
  }

  function _rpAddTag(val) {
    if (!_edit) return;
    const v = (val || '').trim();
    if (v && !_edit.tags.includes(v)) { _edit.tags.push(v); _rpRenderTags(); }
  }

  function _rpFlushTagEntry() {
    const wrap = document.getElementById('lcRpEditTags');
    const input = wrap?.querySelector('.lcrp-tag-entry');
    if (input && input.value.trim()) { _rpAddTag(input.value); input.value = ''; }
  }

  function _rpInitTagsUI() {
    const wrap = document.getElementById('lcRpEditTags');
    const input = wrap?.querySelector('.lcrp-tag-entry');
    if (input && !input.dataset.lcrpReady) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',' || e.key === '、') {
          e.preventDefault();
          if (input.value.trim()) { _rpAddTag(input.value); input.value = ''; }
        } else if (e.key === 'Backspace' && !input.value) {
          if (_edit.tags.length) { _edit.tags.pop(); _rpRenderTags(); }
        }
      });
      input.addEventListener('blur', _rpFlushTagEntry);
      wrap.addEventListener('click', e => { if (e.target === wrap) input.focus(); });
      input.dataset.lcrpReady = '1';
    }
  }

  // 見積タブを一度も開いていない場合でもマスター（品名/単位/取引先サジェスト・自動入力）
  // が使えるよう、諸チャージ側で明細プリセットを開くタイミングで明示的にロードする。
  async function _ensureMasterData() {
    if (typeof window.mdLoadCloud === 'function') { try { await window.mdLoadCloud(); } catch (e) {} }
    if (typeof window.arRefreshDatalist === 'function') { try { window.arRefreshDatalist(); } catch (e) {} }
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
    else {
      // 直近の費用行に入力済みの取引先（サブコン）名を新規行にも引き継ぐ
      const lastData = [..._edit.rows].reverse().find(r => r._type === 'data');
      row = { _type: 'data', cat: '', name: '', taxed: false, pq: '', un: '',
              pc: 'JPY', pp: '', bq: '', bc: 'JPY', bp: '', mk: '', note: '', sv: lastData?.sv || '' };
    }
    _edit.rows.push(row);
    _renderRows();
    const box = document.getElementById('lcRpEditRows');
    box?.querySelector('.lcrp-row:last-child .lcrp-w-name')?.focus();
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

  // 課税チェックは「ユーザーが手で触ったか」を記録し、以後は品名変更によるマスター追従で
  // 上書きしない（見積タブの dataset.txUserSet と同じ考え方）。
  function lcRpToggleTax(i, checked) {
    if (!_edit || !_edit.rows[i]) return;
    _edit.rows[i].taxed = checked;
    _edit.rows[i]._taxUserSet = true;
  }
  window.lcRpToggleTax = lcRpToggleTax;

  // 代表単価の参考表示フォーマット（見積タブ row.js の _fmtRef と同じ）
  function _fmtRef(v, ccy) {
    const n = parseFloat(v);
    if (!isFinite(n)) return String(v);
    return (ccy === 'JPY' ? '¥' : ccy + ' ') + n.toLocaleString('ja-JP');
  }

  // 品名マスターの詳細情報（既定単位・備考・カテゴリ・課税区分）を選択時に自動入力。
  // 既に値が入っている項目は上書きしない（見積タブの initNmAutofill と同じ「空欄のみ補完」方針）。
  // 代表単価は案件ごとに変動するため自動入力はせず、参考としてトースト表示するだけに留める。
  function lcRpNameAutofill(i, value) {
    if (!_edit || !_edit.rows[i]) return;
    if (typeof window.mdGet !== 'function') return;
    const nm = (value || '').replace(/^\*+/, '').trim();
    if (!nm) return;
    const rec = window.mdGet('nm', nm);
    if (!rec) return;
    const details = rec.details || {};
    const row = _edit.rows[i];
    let filled = false;
    if (details.defaultUnit && !row.un) { row.un = details.defaultUnit; filled = true; }
    if (details.defaultNote && !row.note) { row.note = details.defaultNote; filled = true; }
    if (details.defaultCat && !row.cat) { row.cat = details.defaultCat; filled = true; }
    if ((details.defaultTax === 'taxed' || details.defaultTax === 'nontaxed') && !row._taxUserSet) {
      row.taxed = details.defaultTax === 'taxed';
      filled = true;
    }
    if (filled) {
      _renderRows();
      if (typeof window.quoteShowToast === 'function') {
        window.quoteShowToast('📇 マスターから単位・備考・カテゴリ・課税区分を自動入力しました', 'info', 2200);
      }
    }
    const ccy = details.refCcy || 'JPY';
    const refParts = [];
    if (details.refCost) refParts.push('仕入 ' + _fmtRef(details.refCost, ccy));
    if (details.refSell) refParts.push('売 ' + _fmtRef(details.refSell, ccy));
    if (refParts.length && typeof window.quoteShowToast === 'function') {
      window.quoteShowToast('📇 代表単価（参考）: ' + refParts.join(' / '), 'info', 3200);
    }
  }
  window.lcRpNameAutofill = lcRpNameAutofill;

  // 行の内容（品名・単位・備考・カテゴリ・代表単価・取引先）をマスターへ登録。
  // 見積タブの registerRowToMaster と同じ保存先・同じ項目構成。
  async function lcRpRegisterRowMaster(i) {
    if (!_edit || !_edit.rows[i]) return;
    if (typeof window.mdSave !== 'function') {
      alert('マスター機能が利用できません');
      return;
    }
    const row = _edit.rows[i];
    const nm = (row.name || '').replace(/^\*+/, '').trim();
    if (!nm) { alert('品名を入力してから登録してください'); return; }
    const un = row.un || '', nt = row.note || '', cat = row.cat || '', sv = row.sv || '';
    const pp = row.pp, bp = row.bp, bc = row.bc || 'JPY';
    const prev = (typeof window.mdGet === 'function' && window.mdGet('nm', nm))?.details || {};
    const details = Object.assign({}, prev);
    if (un)  details.defaultUnit = un;
    if (nt)  details.defaultNote = nt;
    if (cat) details.defaultCat  = cat;
    if (parseFloat(pp) > 0) details.refCost = pp;
    if (parseFloat(bp) > 0) details.refSell = bp;
    if (details.refCost || details.refSell) details.refCcy = bc;
    if (typeof window.statsEnsureMaster === 'function') await window.statsEnsureMaster('nm', nm);
    await window.mdSave('nm', nm, details);
    let svMsg = '';
    if (sv) {
      if (typeof window.statsEnsureMaster === 'function') await window.statsEnsureMaster('sv', sv);
      const svPrev = (typeof window.mdGet === 'function' && window.mdGet('sv', sv))?.details || {};
      await window.mdSave('sv', sv, svPrev);
      svMsg = '・取引先「' + sv + '」';
    }
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
    if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
    const bits = [un && '単位', nt && '備考', cat && 'カテゴリ', (details.refCost || details.refSell) && '代表単価'].filter(Boolean).join('/');
    if (typeof window.quoteShowToast === 'function') {
      window.quoteShowToast('📇 「' + nm + '」をマスター登録しました（' + (bits || '品名') + '）' + svMsg, 'success', 3200);
    }
  }
  window.lcRpRegisterRowMaster = lcRpRegisterRowMaster;

  function _catOpts(sel) {
    return _cats().map(c => '<option value="' + _ea(c.value) + '"' + (c.value === sel ? ' selected' : '') + '>' + _esc(c.label) + '</option>').join('');
  }
  function _curOpts(sel) {
    return _curs().map(c => '<option value="' + _ea(c) + '"' + (c === sel ? ' selected' : '') + '>' + c + '</option>').join('');
  }

  // 見積タブ本物の明細テーブル（#quoteTable）と同じ列構成・配色（カテゴリ/取引先の縦積み・
  // 品目名/備考の縦積み・数量/単位・通貨/単価の仕入(仕)/売上(売)スタック）に合わせたレイアウト。
  function _opsCell(i, last) {
    return '<td class="lcrp-td-ops"><div class="lcrp-ops">' +
      '<button type="button" onclick="lcRpMoveRow(' + i + ',-1)" title="上へ"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
      '<button type="button" onclick="lcRpMoveRow(' + i + ',1)" title="下へ"' + (i === last ? ' disabled' : '') + '>▼</button>' +
      '<button type="button" class="lcrp-td-del" onclick="lcRpDeleteRow(' + i + ')" title="この明細を削除">✕</button>' +
    '</div></td>';
  }

  function _rowEditor(rd, i, last) {
    if (rd._type === 'remark') {
      return '<tr class="lcrp-row lcrp-row--remark">' +
        _opsCell(i, last) +
        '<td colspan="7" class="lcrp-remark-cell">' +
          '<span class="lcrp-remark-marker">💬 リマーク</span>' +
          '<input type="text" class="lcrp-w-name" placeholder="テーブル内コメント・注記を入力" value="' + _ea(rd.text || '') + '" oninput="lcRpSetCell(' + i + ',\'text\',this.value)">' +
          '<label class="lcrp-inline-chk" title="社内用（客先出力に含めない）"><input type="checkbox"' + (rd.internal ? ' checked' : '') + ' onchange="lcRpSetCell(' + i + ',\'internal\',this.checked)">社内</label>' +
        '</td>' +
      '</tr>';
    }
    if (rd._type === 'subtotal') {
      return '<tr class="lcrp-row lcrp-row--subtotal">' +
        _opsCell(i, last) +
        '<td colspan="7" class="lcrp-subtotal-cell">' +
          '<span class="lcrp-subtotal-marker">━━ 小計</span>' +
          '<input type="text" class="lcrp-w-name" placeholder="グループ名（任意）" value="' + _ea(rd.label || '') + '" oninput="lcRpSetCell(' + i + ',\'label\',this.value)">' +
        '</td>' +
      '</tr>';
    }
    return '<tr class="lcrp-row lcrp-row--data">' +
      _opsCell(i, last) +
      '<td class="lcrp-td-catsv">' +
        '<select class="lcrp-w-cat" onchange="lcRpSetCell(' + i + ',\'cat\',this.value)">' + _catOpts(rd.cat || '') + '</select>' +
        '<input type="text" class="lcrp-w-subcon" list="svSuggestions" placeholder="取引先" value="' + _ea(rd.sv || '') + '" oninput="lcRpSetCell(' + i + ',\'sv\',this.value)">' +
      '</td>' +
      '<td class="lcrp-td-name">' +
        '<input type="text" class="lcrp-w-name" list="nmSuggestions" placeholder="品目名" value="' + _ea(rd.name || '') + '" oninput="lcRpSetCell(' + i + ',\'name\',this.value)" onchange="lcRpNameAutofill(' + i + ',this.value)">' +
        '<input type="text" class="lcrp-w-note" placeholder="備考" value="' + _ea(rd.note || '') + '" oninput="lcRpSetCell(' + i + ',\'note\',this.value)">' +
      '</td>' +
      '<td class="lcrp-td-qty">' +
        '<input type="text" inputmode="decimal" class="lcrp-w-qty" placeholder="数量" value="' + _ea(rd.pq || '') + '" oninput="lcRpSetCell(' + i + ',\'pq\',this.value)">' +
        '<input type="text" class="lcrp-w-unit" list="unit-list" placeholder="単位" value="' + _ea(rd.un || '') + '" oninput="lcRpSetCell(' + i + ',\'un\',this.value)">' +
      '</td>' +
      '<td class="lcrp-td-ccy">' +
        '<span class="lcrp-stk lcrp-stk-cost"><span class="lcrp-tag lcrp-tag-cost">仕</span><select class="lcrp-w-cur" onchange="lcRpSetCell(' + i + ',\'pc\',this.value)">' + _curOpts(rd.pc || 'JPY') + '</select></span>' +
        '<span class="lcrp-stk lcrp-stk-sell"><span class="lcrp-tag lcrp-tag-sell">売</span><select class="lcrp-w-cur" onchange="lcRpSetCell(' + i + ',\'bc\',this.value)">' + _curOpts(rd.bc || 'JPY') + '</select></span>' +
      '</td>' +
      '<td class="lcrp-td-price">' +
        '<span class="lcrp-stk lcrp-stk-cost"><span class="lcrp-tag lcrp-tag-cost">仕</span><input type="text" inputmode="decimal" class="lcrp-w-price" placeholder="単価" value="' + _ea(rd.pp || '') + '" oninput="lcRpSetCell(' + i + ',\'pp\',this.value)"></span>' +
        '<span class="lcrp-stk lcrp-stk-sell"><span class="lcrp-tag lcrp-tag-sell">売</span><input type="text" inputmode="decimal" class="lcrp-w-price" placeholder="単価" value="' + _ea(rd.bp || '') + '" oninput="lcRpSetCell(' + i + ',\'bp\',this.value)"></span>' +
      '</td>' +
      '<td class="lcrp-td-tax"><input type="checkbox" title="課税対象"' + (rd.taxed ? ' checked' : '') + ' onchange="lcRpToggleTax(' + i + ',this.checked)"></td>' +
      '<td class="lcrp-td-mstr"><button type="button" class="lcrp-mstr-btn" onclick="lcRpRegisterRowMaster(' + i + ')" title="品名・単位・カテゴリ・取引先・代表単価をマスターへ登録し、次回の品名入力時に自動入力・サジェストされるようにします">📇</button></td>' +
    '</tr>';
  }

  function _renderRows() {
    const box = document.getElementById('lcRpEditRows');
    const cnt = document.getElementById('lcRpEditRowCount');
    if (!box || !_edit) return;
    if (cnt) cnt.textContent = _edit.rows.length + '行';
    if (!_edit.rows.length) {
      box.innerHTML = '<tr><td colspan="8" class="lcrp-empty-row">明細がありません。下のボタンで追加してください（保存には最低1行必要）</td></tr>';
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

    _rpFlushTagEntry();
    const direction = document.querySelector('input[name="lcRpEditDir"]:checked')?.value || null;
    const tags = (_edit.tags || []).slice();

    // _taxUserSet は編集中だけ使う内部状態（マスター追従の可否判定）。保存データには残さない。
    const rows = _edit.rows.map(r => {
      if (r._type !== 'data') return r;
      const { _taxUserSet, ...rest } = r;
      return rest;
    });
    const base = { name, note, direction, tags, rows, updated_by: email };
    let error;
    if (_edit.id) {
      ({ error } = await db.from(TABLE).update(Object.assign({ updated_at: new Date().toISOString() }, base)).eq('id', _edit.id));
    } else {
      ({ error } = await db.from(TABLE).insert(Object.assign({ created_by: email }, base)));
    }
    // direction/tags 列が未マイグレーションでも保存は通す（既存 links 列と同じフォールバック方式）
    let fellBack = false;
    if (error && /direction|tags/.test(error.message || '')) {
      const fallback = { name, note, rows, updated_by: email };
      if (_edit.id) {
        ({ error } = await db.from(TABLE).update(Object.assign({ updated_at: new Date().toISOString() }, fallback)).eq('id', _edit.id));
      } else {
        ({ error } = await db.from(TABLE).insert(Object.assign({ created_by: email }, fallback)));
      }
      fellBack = !error;
    }
    if (error) { alert('保存に失敗しました: ' + error.message); return; }
    lcRpCloseEdit();
    await _load();
    if (typeof window.quoteShowToast === 'function') {
      window.quoteShowToast(
        fellBack
          ? '💾 保存しました（大分類/タグは追加SQL適用後に保存できます）'
          : '💾 明細プリセット「' + name + '」を保存しました',
        fellBack ? 'warn' : 'success',
        fellBack ? 5500 : undefined
      );
    }
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
