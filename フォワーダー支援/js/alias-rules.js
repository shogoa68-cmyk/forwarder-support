// エイリアスルール管理（ゆらぎ是正）
// ④ ルール登録 → ①② 一括置換（ローカル＋クラウド） → ③ 入力補完提供
(function () {
  'use strict';

  const LOCAL_KEY     = 'aliasRules_v1';
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
    if (_cloud()) {
      const c = _c(), me = _me();
      await c.from(TABLE).upsert(
        { field, from_value, to_value, created_by: me },
        { onConflict: 'field,from_value' }
      );
    } else {
      const arr = _loadLocal();
      const idx = arr.findIndex(r => r.field === field && r.from_value === from_value);
      const rec = { id: Date.now() + '_' + Math.random().toString(36).slice(2), field, from_value, to_value, created_at: new Date().toISOString() };
      if (idx >= 0) arr[idx] = { ...arr[idx], ...rec }; else arr.unshift(rec);
      _saveLocal(arr);
    }
    await _afterChange();
  };

  // === ルール削除 ===

  window.arDeleteRule = async function (id) {
    if (_cloud()) {
      await _c().from(TABLE).delete().eq('id', id);
    } else {
      _saveLocal(_loadLocal().filter(r => String(r.id) !== String(id)));
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

  // === 入力補完用 ===

  window.arGetCanonicals = function (field) {
    return _loadLocal().filter(r => r.field === field).map(r => r.to_value);
  };

  function _refreshDatalist() {
    const dl = document.getElementById('svSuggestions');
    if (!dl) return;
    const fromRules  = _loadLocal().filter(r => r.field === 'sv').map(r => r.to_value);
    let masters = [];
    try { masters = JSON.parse(localStorage.getItem('masterCandidates_v1') || '[]'); } catch { masters = []; }
    const fromMaster = masters.filter(m => m.field === 'sv').map(m => m.value);
    const all = [...new Set([...fromRules, ...fromMaster])];
    dl.innerHTML = all.map(v => `<option value="${_ea(v)}"></option>`).join('');
  }
  window.arRefreshDatalist = _refreshDatalist;

  // === レンダリング ===

  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _ea(s)  { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  window.arRenderPane = async function () {
    const pane = document.getElementById('statsPane-alias');
    if (!pane) return;

    const rules = await window.arGetRules();
    const fields = ['sv', 'nm', 'un'];
    const fieldLabel = { sv: 'サブコン', nm: '品名', un: '単位' };
    const grouped = {};
    fields.forEach(f => { grouped[f] = rules.filter(r => r.field === f); });

    let h = '<div class="ar-pane">';

    // 追加フォーム
    h += `<div class="ar-add-section">
  <h4 class="ar-section-title">＋ ルール追加</h4>
  <div class="ar-add-form">
    <select id="arField" class="ar-select">
      <option value="sv">サブコン</option>
      <option value="nm">品名</option>
      <option value="un">単位</option>
    </select>
    <input id="arFrom" class="ar-input" type="text" placeholder="元の表記（ゆらぎ）">
    <span class="ar-arrow-label">→</span>
    <input id="arTo"   class="ar-input" type="text" placeholder="正規形（統一後）">
    <button class="ar-add-btn" onclick="arSubmitForm()">登録</button>
  </div>
</div>`;

    // ルール一覧
    const hasAny = rules.length > 0;
    if (hasAny) {
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
})();
