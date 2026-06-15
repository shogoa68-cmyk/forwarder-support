// エイリアスルール管理（ゆらぎ是正）
// ④ ルール登録 → ①② 一括置換（ローカル＋クラウド） → ③ 入力補完提供
(function () {
  'use strict';

  const LOCAL_KEY     = 'aliasRules_v1';
  const EXCL_KEY      = 'statsExclusions_v1';
  const ABBREV_KEY    = 'abbrevPairs_v1';
  const TABLE         = 'alias_rules';
  const PRESETS_TABLE = 'quote_presets';

  // cells 配列インデックス（v3 format）
  const CI = { sv: 2, nm: 4, un: 6 };

  // === ストレージ ===

  function _loadLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function _saveLocal(arr) { localStorage.setItem(LOCAL_KEY, JSON.stringify(arr)); }

  function _loadExclusions() {
    try { return JSON.parse(localStorage.getItem(EXCL_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function _saveExclusions(arr) { localStorage.setItem(EXCL_KEY, JSON.stringify(arr)); }

  function _loadAbbrevPairs() {
    try { return JSON.parse(localStorage.getItem(ABBREV_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function _saveAbbrevPairs(arr) { localStorage.setItem(ABBREV_KEY, JSON.stringify(arr)); }

  // === Supabase ヘルパー ===

  function _c()    { return typeof window.cloudGetClient   === 'function' ? window.cloudGetClient()   : null; }
  function _me()   { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return u ? (u.email || '') : ''; }
  function _cloud(){ return !!_c() && !!_me(); }

  // === ルール取得 ===

  async function _fetchCloud() {
    const c = _c(); if (!c) return [];
    const { data } = await c.from(TABLE).select('*').order('created_at', { ascending: false });
    return data || [];
  }

  window.arGetRules = async function (field) {
    const local = _loadLocal().filter(r => !field || r.field === field);
    if (!_cloud()) return local;
    const cloud = (await _fetchCloud()).filter(r => !field || r.field === field);
    const seen = new Set(cloud.map(r => r.field + ':::' + r.from_value));
    return [...cloud, ...local.filter(r => !seen.has(r.field + ':::' + r.from_value))];
  };

  // === ルール保存 ===

  window.arSaveRule = async function (field, from_value, to_value) {
    if (!field || !from_value || !to_value) return;
    // 常にローカルにも保存（クラウド失敗時のフォールバック兼オフライン対応）
    const arr = _loadLocal();
    const idx = arr.findIndex(r => r.field === field && r.from_value === from_value);
    const rec = { id: Date.now() + '_' + Math.random().toString(36).slice(2), field, from_value, to_value, created_at: new Date().toISOString() };
    if (idx >= 0) arr[idx] = { ...arr[idx], ...rec }; else arr.unshift(rec);
    _saveLocal(arr);
    // クラウドにも同期（失敗しても続行）
    if (_cloud()) {
      const c = _c(), me = _me();
      await c.from(TABLE).upsert(
        { field, from_value, to_value, created_by: me },
        { onConflict: 'field,from_value' }
      );
    }
    await _afterChange();
  };

  // === ルール削除 ===

  window.arDeleteRule = async function (id) {
    // ローカルから削除
    _saveLocal(_loadLocal().filter(r => String(r.id) !== String(id)));
    // クラウドからも削除（エラーは無視）
    if (_cloud()) {
      await _c().from(TABLE).delete().eq('id', id);
    }
    await _afterChange();
  };

  // === 一括置換 ===

  function _applyToData(data, rules) {
    if (!data || !Array.isArray(data.rows)) return data;
    const out = JSON.parse(JSON.stringify(data));
    out.rows.forEach(row => {
      if (row._type !== 'data' || !Array.isArray(row.cells)) return;
      rules.forEach(r => {
        const ci = CI[r.field];
        if (ci == null) return;
        if ((row.cells[ci] || '').trim() === r.from_value.trim()) row.cells[ci] = r.to_value;
      });
    });
    return out;
  }

  window.arApplyLocal = async function (rules) {
    if (!rules || !rules.length) return 0;
    let presets;
    try { presets = JSON.parse(localStorage.getItem('quotePresets_v1') || '[]'); } catch { presets = []; }
    let count = 0;
    presets.forEach(p => {
      const before = JSON.stringify(p.data);
      p.data = _applyToData(p.data, rules);
      if (JSON.stringify(p.data) !== before) count++;
    });
    localStorage.setItem('quotePresets_v1', JSON.stringify(presets));
    return count;
  };

  window.arApplyCloud = async function (rules) {
    const c = _c();
    if (!c || !rules || !rules.length) return 0;
    const { data: presets } = await c.from(PRESETS_TABLE).select('id,data');
    if (!presets) return 0;
    let count = 0;
    for (const p of presets) {
      const before = JSON.stringify(p.data);
      const after  = _applyToData(p.data, rules);
      if (JSON.stringify(after) !== before) {
        await c.from(PRESETS_TABLE).update({ data: after }).eq('id', p.id);
        count++;
      }
    }
    return count;
  };

  // === 除外リスト管理 ===

  window.arGetExclusions = function (field) {
    const all = _loadExclusions();
    return field ? all.filter(e => e.field === field) : all;
  };

  window.arAddExclusion = async function (field, value) {
    if (!field || !value) return;
    const arr = _loadExclusions();
    if (!arr.find(e => e.field === field && e.value === value)) {
      arr.unshift({ field, value, created_at: new Date().toISOString() });
      _saveExclusions(arr);
    }
    await _afterChange();
    if (typeof window.statsRefresh === 'function') await window.statsRefresh();
  };

  window.arRemoveExclusion = async function (field, value) {
    _saveExclusions(_loadExclusions().filter(e => !(e.field === field && e.value === value)));
    await _afterChange();
    if (typeof window.statsRefresh === 'function') await window.statsRefresh();
  };

  // === 略称辞書管理 ===

  window.arGetAbbrevPairs = function (field) {
    const all = _loadAbbrevPairs();
    return field ? all.filter(p => p.field === field) : all;
  };

  window.arAddAbbrevPair = async function (field, abbrev, full) {
    if (!field || !abbrev || !full || abbrev === full) return;
    const arr = _loadAbbrevPairs();
    if (arr.find(p => p.field === field && p.abbrev === abbrev && p.full === full)) return;
    arr.unshift({ id: Date.now() + '_' + Math.random().toString(36).slice(2), field, abbrev, full, created_at: new Date().toISOString() });
    _saveAbbrevPairs(arr);
    await _afterChange();
    if (typeof window.statsRefresh === 'function') await window.statsRefresh();
  };

  window.arDeleteAbbrevPair = async function (id) {
    _saveAbbrevPairs(_loadAbbrevPairs().filter(p => String(p.id) !== String(id)));
    await _afterChange();
    if (typeof window.statsRefresh === 'function') await window.statsRefresh();
  };

  window.arSubmitAbbrevForm = async function () {
    const field  = document.getElementById('arAbbrevField')?.value;
    const abbrev = (document.getElementById('arAbbrevShort')?.value || '').trim();
    const full   = (document.getElementById('arAbbrevFull')?.value  || '').trim();
    if (!abbrev || !full)   { alert('略称と正式名称の両方を入力してください。'); return; }
    if (abbrev === full)    { alert('略称と正式名称が同じです。'); return; }
    await window.arAddAbbrevPair(field, abbrev, full);
    const s = document.getElementById('arAbbrevShort'); if (s) s.value = '';
    const f = document.getElementById('arAbbrevFull');  if (f) f.value = '';
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('✅ 略称を登録しました', 'success');
  };

  // === 入力補完用 ===

  window.arGetCanonicals = function (field) {
    return _loadLocal().filter(r => r.field === field).map(r => r.to_value);
  };

  function _refreshDatalist() {
    const rules   = _loadLocal();
    // マスター一覧（statsGetMasters があればクラウド投票も含む、なければ localStorage フォールバック）
    let masters = [];
    if (typeof window.statsGetMasters === 'function') {
      masters = window.statsGetMasters();
    } else {
      try { masters = JSON.parse(localStorage.getItem('masterCandidates_v1') || '[]'); } catch { masters = []; }
    }

    const _fill = (dlId, field) => {
      const dl = document.getElementById(dlId);
      if (!dl) return;
      const fromRules  = rules.filter(r => r.field === field).map(r => r.to_value);
      const fromMaster = masters.filter(m => m.field === field).map(m => m.value);
      const abbrevPairs = typeof window.arGetAbbrevPairs === 'function' ? window.arGetAbbrevPairs(field) : [];
      const fromAbbrev = abbrevPairs.flatMap(p => [p.abbrev, p.full]);
      const all = [...new Set([...fromRules, ...fromMaster, ...fromAbbrev])];
      // datalist 内の動的 option（data-master）だけを入れ替える
      dl.querySelectorAll('option[data-master]').forEach(o => o.remove());
      all.forEach(v => {
        const o = document.createElement('option');
        o.value = v;
        o.dataset.master = '1';
        dl.appendChild(o);
      });
    };

    _fill('svSuggestions', 'sv');
    _fill('nmSuggestions', 'nm');
    _fill('unit-list',     'un');
    _fill('custSuggestions', 'customer');

    // ユニット同義語グループをunitdatalistに追加
    const unDl = document.getElementById('unit-list');
    if (unDl) {
      const uaGroups = typeof window.uaGetGroups === 'function' ? window.uaGetGroups() : [];
      const fromUA = uaGroups.flatMap(g => [g.canonical, ...(g.aliases || [])]);
      fromUA.forEach(v => {
        if (!unDl.querySelector(`option[value="${v.replace(/"/g,'&quot;')}"]`)) {
          const o = document.createElement('option'); o.value = v; o.dataset.master = '1';
          unDl.appendChild(o);
        }
      });
    }
  }
  window.arRefreshDatalist = _refreshDatalist;

  // === クイック登録ステート ===

  let _quickFill = null; // { field, canonical, nonCanonical: string[] }

  window.arSetQuickFill = function (field, canonical, nonCanonical) {
    _quickFill = { field, canonical, nonCanonical: (nonCanonical || []).slice() };
  };

  window.arQuickRegister = async function (idx) {
    if (!_quickFill || idx >= _quickFill.nonCanonical.length) return;
    const from = _quickFill.nonCanonical[idx];
    const { field, canonical } = _quickFill;
    await window.arSaveRule(field, from, canonical);
    _quickFill.nonCanonical.splice(idx, 1);
    await window.arRenderPane();
  };

  window.arExcludeVariant = async function (idx) {
    if (!_quickFill || idx >= _quickFill.nonCanonical.length) return;
    const from = _quickFill.nonCanonical[idx];
    const { field } = _quickFill;
    const arr = _loadExclusions();
    if (!arr.find(e => e.field === field && e.value === from)) {
      arr.unshift({ field, value: from, created_at: new Date().toISOString() });
      _saveExclusions(arr);
    }
    _quickFill.nonCanonical.splice(idx, 1);
    await _afterChange();
    if (typeof window.statsRefresh === 'function') await window.statsRefresh();
    await window.arRenderPane();
  };

  window.arClearQuickFill = async function () {
    _quickFill = null;
    await window.arRenderPane();
  };

  // === レンダリング ===

  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  // onclick の JS 文字列リテラル用
  function _ea(s)  { return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  // HTML value="" 属性用（&#39; が正しい）
  function _eav(s) { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  window.arRenderPane = async function () {
    const pane = document.getElementById('statsPane-alias');
    if (!pane) return;

    const rules = await window.arGetRules();
    const fields = ['sv', 'nm', 'un'];
    const fieldLabel = { sv: 'サブコン', nm: '品名', un: '単位' };
    const grouped = {};
    fields.forEach(f => { grouped[f] = rules.filter(r => r.field === f); });

    let h = '<div class="ar-pane">';

    // === クイック登録セクション（バッジクリック時） ===
    if (_quickFill && _quickFill.nonCanonical.length > 0) {
      const fl = fieldLabel[_quickFill.field] || _quickFill.field;
      h += `<div class="ar-quick-section">
  <div class="ar-quick-header">
    <span class="ar-quick-title">⚡ ゆらぎ是正ショートカット — <strong>${_esc(_quickFill.canonical)}</strong>（${fl}）</span>
    <button class="ar-quick-clear" onclick="arClearQuickFill()" title="クリア">✕</button>
  </div>
  <p class="ar-quick-desc">以下の表記を <strong>"${_esc(_quickFill.canonical)}"</strong> に統一するルールをワンクリックで登録できます:</p>
  <div class="ar-quick-items">`;
      _quickFill.nonCanonical.forEach((from, idx) => {
        h += `<div class="ar-quick-item">
    <span class="ar-from">${_esc(from)}</span>
    <span class="ar-arrow-label">→</span>
    <span class="ar-to">${_esc(_quickFill.canonical)}</span>
    <button class="ar-quick-reg-btn" onclick="arQuickRegister(${idx})">＋ 登録</button>
    <button class="ar-quick-excl-btn" onclick="arExcludeVariant(${idx})" title="別物として扱い、ゆらぎ判定から外す">除外</button>
  </div>`;
      });
      h += `  </div>
</div>`;
    } else if (_quickFill && _quickFill.nonCanonical.length === 0) {
      // 全バリアント登録済み
      h += `<div class="ar-quick-section ar-quick-done">
  <span class="ar-quick-title">✅ <strong>${_esc(_quickFill.canonical)}</strong> グループの全ゆらぎを登録しました</span>
  <button class="ar-quick-clear" onclick="arClearQuickFill()">✕</button>
</div>`;
    }

    // 追加フォーム
    const preField = _quickFill ? _quickFill.field : 'sv';
    const preTo    = _quickFill ? _quickFill.canonical : '';
    h += `<div class="ar-add-section">
  <h4 class="ar-section-title">＋ ルール追加</h4>
  <div class="ar-add-form">
    <select id="arField" class="ar-select">
      <option value="sv"${preField==='sv'?' selected':''}>サブコン</option>
      <option value="nm"${preField==='nm'?' selected':''}>品名</option>
      <option value="un"${preField==='un'?' selected':''}>単位</option>
    </select>
    <input id="arFrom" class="ar-input" type="text" placeholder="元の表記（ゆらぎ）">
    <span class="ar-arrow-label">→</span>
    <input id="arTo"   class="ar-input" type="text" placeholder="正規形（統一後）" value="${_eav(preTo)}">
    <button class="ar-add-btn" onclick="arSubmitForm()">登録</button>
  </div>
</div>`;

    // ルール一覧
    const hasAny = rules.length > 0;
    if (hasAny) {
      h += `<h4 class="ar-section-title ar-rules-title">📋 登録済みルール（${rules.length}件）</h4>`;
      fields.forEach(field => {
        if (!grouped[field].length) return;
        h += `<div class="ar-group">
  <div class="ar-group-title">${fieldLabel[field]}</div>
  <table class="ar-table"><thead><tr><th>置換元</th><th></th><th>正規形</th><th></th></tr></thead><tbody>`;
        grouped[field].forEach(r => {
          h += `<tr>
    <td class="ar-from">${_esc(r.from_value)}</td>
    <td class="ar-arrow-cell">→</td>
    <td class="ar-to">${_esc(r.to_value)}</td>
    <td><button class="ar-del-btn" onclick="arDeleteRule('${_ea(String(r.id))}')">削除</button></td>
  </tr>`;
        });
        h += '</tbody></table></div>';
      });
    } else {
      h += '<p class="ar-empty">ルールはまだありません。<br>各集計タブのゆらぎを確認してルールを登録してください。</p>';
    }

    // 一括置換
    const cloudOn = _cloud();
    h += `<div class="ar-bulk-section">
  <h4 class="ar-section-title">一括置換</h4>
  <p class="ar-bulk-desc">登録済みルールでプリセットの表記を一括置換します。<strong>この操作は元に戻せません。</strong></p>
  <div class="ar-bulk-btns">
    <button class="ar-bulk-btn ar-bulk-local" onclick="arApplyWithConfirm('local')"${!hasAny?' disabled':''}>💾 ローカルに適用</button>
    ${cloudOn ? `<button class="ar-bulk-btn ar-bulk-cloud" onclick="arApplyWithConfirm('cloud')"${!hasAny?' disabled':''}>☁️ クラウドに適用</button>` : ''}
    ${cloudOn ? `<button class="ar-bulk-btn ar-bulk-both"  onclick="arApplyWithConfirm('both')"${!hasAny?' disabled':''}>🔄 両方に適用</button>` : ''}
  </div>
</div>`;

    // 略称辞書セクション
    const abbrevPairs = _loadAbbrevPairs();
    const abbrevFieldLabel = { sv: 'サブコン', nm: '品名', un: '単位', customer: 'お客様' };
    h += `<div class="ar-abbrev-section">
  <h4 class="ar-section-title">📖 略称辞書${abbrevPairs.length ? `（${abbrevPairs.length}件）` : ''}</h4>
  <p class="ar-abbrev-desc">略称と正式名称を関連付けます。統計タブで同一グループとして表示されます（例：NTL ＝ NAIGAI TRANS LINE）。</p>
  <div class="ar-add-form">
    <select id="arAbbrevField" class="ar-select">
      <option value="sv">サブコン</option>
      <option value="nm">品名</option>
      <option value="un">単位</option>
      <option value="customer">お客様</option>
    </select>
    <input id="arAbbrevShort" class="ar-input" type="text" placeholder="略称（例: NTL）">
    <span class="ar-arrow-label">=</span>
    <input id="arAbbrevFull" class="ar-input" type="text" placeholder="正式名称（例: NAIGAI TRANS LINE）">
    <button class="ar-add-btn" onclick="arSubmitAbbrevForm()">登録</button>
  </div>`;
    if (abbrevPairs.length) {
      h += `<table class="ar-table ar-abbrev-table"><thead><tr><th>種別</th><th>略称</th><th></th><th>正式名称</th><th></th></tr></thead><tbody>`;
      abbrevPairs.forEach(p => {
        h += `<tr>
  <td>${_esc(abbrevFieldLabel[p.field] || p.field)}</td>
  <td class="ar-from">${_esc(p.abbrev)}</td>
  <td class="ar-arrow-cell">=</td>
  <td class="ar-to">${_esc(p.full)}</td>
  <td><button class="ar-del-btn" onclick="arDeleteAbbrevPair('${_ea(String(p.id))}')">削除</button></td>
</tr>`;
      });
      h += '</tbody></table>';
    }
    h += '</div>';

    // 除外リスト
    const excl = _loadExclusions();
    if (excl.length > 0) {
      const fl = { sv: 'サブコン', nm: '品名', un: '単位' };
      h += `<div class="ar-excl-section">
  <h4 class="ar-section-title">🚫 ゆらぎ判定 除外リスト（${excl.length}件）</h4>
  <p class="ar-excl-desc">以下の表記はゆらぎ判定から外れています（別物として扱います）。</p>
  <table class="ar-table ar-excl-table"><thead><tr><th>種別</th><th>除外値</th><th></th></tr></thead><tbody>`;
      excl.forEach(e => {
        h += `<tr>
    <td>${_esc(fl[e.field] || e.field)}</td>
    <td class="ar-from">${_esc(e.value)}</td>
    <td><button class="ar-del-btn" onclick="arRemoveExclusion('${_ea(e.field)}','${_ea(e.value)}')">解除</button></td>
  </tr>`;
      });
      h += '</tbody></table></div>';
    }

    h += '</div>';
    pane.innerHTML = h;
  };

  window.arSubmitForm = async function () {
    const field = document.getElementById('arField')?.value;
    const from  = (document.getElementById('arFrom')?.value || '').trim();
    const to    = (document.getElementById('arTo')?.value   || '').trim();
    if (!from || !to) { alert('置換元と正規形の両方を入力してください。'); return; }
    if (from === to)  { alert('置換元と正規形が同じです。'); return; }
    await window.arSaveRule(field, from, to);
    const fEl = document.getElementById('arFrom'); if (fEl) fEl.value = '';
    const tEl = document.getElementById('arTo');   if (tEl) tEl.value = '';
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('✅ ルールを登録しました', 'success');
  };

  window.arApplyWithConfirm = async function (target) {
    const rules = await window.arGetRules();
    if (!rules.length) { alert('ルールが登録されていません。'); return; }
    const labels = { local: 'ローカルのプリセット', cloud: 'クラウドのプリセット', both: 'ローカル＋クラウドのプリセット' };
    if (!confirm(`${rules.length} 件のルールで ${labels[target]} の表記を一括置換します。\nこの操作は元に戻せません。続けますか？`)) return;
    let msg = '';
    if (target === 'local' || target === 'both') {
      const n = await window.arApplyLocal(rules);
      msg += `ローカル: ${n} 件更新。`;
    }
    if ((target === 'cloud' || target === 'both') && _cloud()) {
      const n = await window.arApplyCloud(rules);
      msg += ` クラウド: ${n} 件更新。`;
    }
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('✅ ' + msg.trim(), 'success');
    if (typeof window.statsRefresh === 'function') await window.statsRefresh();
  };

  async function _afterChange() {
    _refreshDatalist();
    if (typeof window.arRenderPane === 'function') await window.arRenderPane();
  }

  document.addEventListener('DOMContentLoaded', _refreshDatalist);

  // === ユニット同義語グループ ===

  const UA_KEY = 'unitAlias_v1';
  function _loadUA()  { try { return JSON.parse(localStorage.getItem(UA_KEY) || '[]'); } catch(e) { return []; } }
  function _saveUA(a) { localStorage.setItem(UA_KEY, JSON.stringify(a)); }
  function _notifyUA() {
    _refreshDatalist();
    if (typeof window.statsRefreshUnPane === 'function') window.statsRefreshUnPane();
  }

  window.uaGetGroups = function() { return _loadUA(); };

  window.uaGetNormalizeMap = function() {
    const map = {};
    _loadUA().forEach(g => { (g.aliases || []).forEach(a => { map[a] = g.canonical; }); });
    return map;
  };

  window.uaSetCanonical = function(unit) {
    if (!unit) return;
    const groups = _loadUA();
    groups.forEach(g => { g.aliases = (g.aliases || []).filter(a => a !== unit); });
    if (!groups.find(g => g.canonical === unit))
      groups.push({ id: Date.now() + '_' + Math.random().toString(36).slice(2), canonical: unit, aliases: [] });
    _saveUA(groups);
    _notifyUA();
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('⭐ 「' + unit + '」を代表単位に設定しました', 'success');
  };

  window.uaAddAlias = function(alias, canonical) {
    if (!alias || !canonical || alias === canonical) return;
    const groups = _loadUA();
    groups.forEach(g => { g.aliases = (g.aliases || []).filter(a => a !== alias); });
    let g = groups.find(g => g.canonical === canonical);
    if (!g) { g = { id: Date.now() + '_' + Math.random().toString(36).slice(2), canonical, aliases: [] }; groups.push(g); }
    if (!g.aliases.includes(alias)) g.aliases.push(alias);
    _saveUA(groups);
    _notifyUA();
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('✅ 「' + alias + '」→「' + canonical + '」に統合しました', 'success');
  };

  window.uaRemoveAlias = function(alias, canonical) {
    const groups = _loadUA();
    const g = groups.find(g => g.canonical === canonical);
    if (g) g.aliases = (g.aliases || []).filter(a => a !== alias);
    _saveUA(groups);
    _notifyUA();
  };

  window.uaRemoveGroup = function(canonical) {
    _saveUA(_loadUA().filter(g => g.canonical !== canonical));
    _notifyUA();
  };

  window.uaShowMergePicker = function(unit, btn) {
    document.querySelectorAll('.ua-inline-picker').forEach(el => el.remove());
    const groups = _loadUA();
    if (!groups.length) {
      if (typeof window.quoteShowToast === 'function') window.quoteShowToast('⭐ 先に代表単位を設定してください', 'warn');
      return;
    }
    const row = btn.closest('tr');
    if (!row) return;
    const selId = 'uaPS_' + Math.random().toString(36).slice(2);
    const _ej = s => String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const tr = document.createElement('tr');
    tr.className = 'ua-inline-picker';
    tr.innerHTML =
      `<td colspan="4" class="ua-picker-cell">` +
      `<span class="ua-picker-label">「${unit.replace(/&/g,'&amp;').replace(/</g,'&lt;')}」を統合する代表：</span>` +
      `<select class="ua-picker-sel" id="${selId}">` +
      groups.map(g => `<option value="${_eav(g.canonical)}">${_esc(g.canonical)}</option>`).join('') +
      `</select>` +
      `<button class="ua-picker-ok" onclick="uaConfirmMerge('${_ej(unit)}','${selId}')">統合する</button>` +
      `<button class="ua-picker-cancel" onclick="document.querySelectorAll('.ua-inline-picker').forEach(function(e){e.remove()})">✕</button>` +
      `</td>`;
    row.after(tr);
  };

  window.uaConfirmMerge = function(unit, selId) {
    const sel = document.getElementById(selId);
    if (!sel) return;
    window.uaAddAlias(unit, sel.value);
    document.querySelectorAll('.ua-inline-picker').forEach(el => el.remove());
  };

})();
