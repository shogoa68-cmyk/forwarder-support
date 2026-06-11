// 統計タブ: 見積プリセット行データを集計・マスター管理（ローカル＋クラウド投票）
(function () {
  'use strict';

  // cells 配列のインデックス（v3 format: [0]=selected [1]=cat [2]=sv [3]=tx [4]=nm [5]=pq [6]=un ...）
  const CI = { cat: 1, sv: 2, nm: 4, un: 6 };
  const CARRIER_CATS = new Set(['ocean', 'surcharge']);
  const LOCAL_KEY    = 'masterCandidates_v1';
  const VOTES_TABLE  = 'master_votes';

  let _data    = null;
  let _cvMap   = null;  // Map<`field:::value`, { total, isMine }> — クラウド投票キャッシュ

  // === Supabase ヘルパー ===

  function _c()    { return typeof window.cloudGetClient   === 'function' ? window.cloudGetClient()   : null; }
  function _me()   { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return u ? (u.email || '') : ''; }
  function _cloud(){ return !!_c() && !!_me(); }

  async function _loadCloudVotes() {
    const c = _c();
    if (!c) { _cvMap = null; return; }
    const { data, error } = await c.from(VOTES_TABLE).select('field,value,voter_email');
    if (error) { _cvMap = null; return; }
    _cvMap = new Map();
    const me = _me();
    (data || []).forEach(r => {
      const key = r.field + ':::' + r.value;
      if (!_cvMap.has(key)) _cvMap.set(key, { total: 0, isMine: false });
      const v = _cvMap.get(key);
      v.total++;
      if (r.voter_email === me) v.isMine = true;
    });
  }

  function _voteInfo(field, value) {
    if (_cloud() && _cvMap !== null) return _cvMap.get(field + ':::' + value) || { total: 0, isMine: false };
    const m = _getMasters().find(c => c.field === field && c.value === value);
    return { total: m ? m.votes : 0, isMine: !!m };
  }

  // === データ取得 ===

  function _getLocalPresets() {
    try { return JSON.parse(localStorage.getItem('quotePresets_v1') || '[]'); }
    catch (e) { return []; }
  }

  function _extractRows(preset) {
    const d = preset.data || {};
    if (!Array.isArray(d.rows)) return [];
    return d.rows
      .filter(r => r && r._type === 'data')
      .map(r => {
        const c = Array.isArray(r.cells) ? r.cells : [];
        return {
          cat: (c[CI.cat] || '').trim(),
          sv:  (c[CI.sv]  || '').trim(),
          nm:  (c[CI.nm]  || '').trim(),
          un:  (c[CI.un]  || '').trim(),
        };
      })
      .filter(r => r.sv || r.nm);
  }

  function _build(source) {
    const presets = [];
    if (source !== 'cloud') {
      _getLocalPresets().forEach(p => {
        const rows = _extractRows(p);
        if (rows.length) presets.push({ name: p.name || '（名称なし）', rows, src: 'local' });
      });
    }
    if (source !== 'local') {
      const cloud = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
      cloud.forEach(p => {
        const rows = _extractRows(p);
        if (rows.length) presets.push({ name: p.name || '（名称なし）', rows, src: 'cloud' });
      });
    }
    const allRows     = presets.flatMap(p => p.rows);
    const svRows      = allRows.filter(r => r.sv && !CARRIER_CATS.has(r.cat));
    const carrierRows = allRows.filter(r => r.sv &&  CARRIER_CATS.has(r.cat));
    return {
      presets, totalPresets: presets.length, totalRows: allRows.length,
      svGroups:      _groupSimilar(svRows.map(r => r.sv)),
      carrierGroups: _groupSimilar(carrierRows.map(r => r.sv)),
      nmGroups:      _groupSimilar(allRows.map(r => r.nm).filter(Boolean)),
      unGroups:      _groupSimilar(allRows.map(r => r.un).filter(Boolean)),
    };
  }

  function _freq(arr) {
    const m = new Map();
    arr.forEach(v => m.set(v, (m.get(v) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }

  function _normalize(s) {
    return s
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/【[^】]*】/g, '')
      .replace(/[\s　・ー―\-\/\\]+/g, '')
      .toLowerCase()
      .replace(/[ァ-ン]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  function _groupSimilar(names) {
    const freq   = _freq(names);
    const groups = new Map();
    freq.forEach(({ value, count }) => {
      const key = _normalize(value);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { variants: [], total: 0 });
      const g = groups.get(key);
      g.variants.push({ value, count });
      g.total += count;
    });
    return [...groups.values()].sort((a, b) => {
      const vd = (b.variants.length > 1 ? 1 : 0) - (a.variants.length > 1 ? 1 : 0);
      return vd || b.total - a.total;
    });
  }

  // === ローカルマスター候補（クラウド未使用時のフォールバック） ===

  function _getMasters() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function _saveMasters(arr) { localStorage.setItem(LOCAL_KEY, JSON.stringify(arr)); }

  // === 投票 ===

  async function _promote(field, value) {
    if (_cloud()) {
      const c = _c(), me = _me();
      await c.from(VOTES_TABLE).upsert({ field, value, voter_email: me }, { onConflict: 'field,value,voter_email' });
      await _loadCloudVotes();
    } else {
      const arr = _getMasters();
      const idx = arr.findIndex(c => c.field === field && c.value === value);
      if (idx >= 0) arr[idx].votes = (arr[idx].votes || 0) + 1;
      else arr.push({ field, value, votes: 1, ts: Date.now() });
      _saveMasters(arr);
    }
  }

  async function _demote(field, value) {
    if (_cloud()) {
      const c = _c(), me = _me();
      await c.from(VOTES_TABLE).delete().match({ field, value, voter_email: me });
      await _loadCloudVotes();
    } else {
      const arr = _getMasters();
      const idx = arr.findIndex(c => c.field === field && c.value === value);
      if (idx < 0) return;
      arr[idx].votes = Math.max(0, arr[idx].votes - 1);
      if (arr[idx].votes === 0) arr.splice(idx, 1);
      _saveMasters(arr);
    }
  }

  // === レンダリングヘルパー ===

  function _esc(s)  { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _ea(s)   { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function _voteBtn(field, value) {
    const v  = _voteInfo(field, value);
    const on = v.isMine;
    return `<button class="stats-vote-btn${on ? ' stats-voted' : ''}" ` +
           `onclick="statsToggleVote('${_ea(field)}','${_ea(value)}')" ` +
           `title="${on ? '投票を取り消す' : 'マスターに昇格する'}">` +
           (v.total > 0 ? `${on ? '⭐' : '☆'} ${v.total}` : '☆ 昇格') +
           '</button>';
  }

  // ゆらぎグループ表示（nm/sv/carrier/un 共通）
  function _renderGrouped(groups, field, colLabel, paneId) {
    const e = document.getElementById(paneId);
    if (!e || !_data) return;
    if (!groups.length) { e.innerHTML = '<p class="stats-empty">データなし</p>'; return; }
    let h = `<table class="stats-table stats-nm-table"><thead><tr>` +
            `<th>${colLabel}</th><th class="stats-num-col">合計</th><th>バリアント / 投票</th>` +
            `</tr></thead><tbody>`;
    groups.forEach(g => {
      const hasV = g.variants.length > 1;
      h += `<tr${hasV ? ' class="stats-has-variant"' : ''}>`;
      h += `<td class="stats-val">${_esc(g.variants[0].value)}`;
      if (hasV) h += ` <span class="stats-variant-badge">ゆらぎ ${g.variants.length}種</span>`;
      h += `</td><td class="stats-num-col">${g.total}</td><td class="stats-chips-cell">`;
      g.variants.forEach(v => {
        h += `<span class="stats-chip">` +
             `<span class="stats-chip-text">${_esc(v.value)}</span>` +
             `<span class="stats-chip-cnt">×${v.count}</span>` +
             _voteBtn(field, v.value) +
             `</span>`;
      });
      h += '</td></tr>';
    });
    e.innerHTML = h + '</tbody></table>';
  }

  // === ペイン描画 ===

  function _renderSv()      { _renderGrouped(_data?.svGroups      || [], 'sv', 'サブコン名', 'statsPane-sv'); }
  function _renderCarrier() { _renderGrouped(_data?.carrierGroups || [], 'sv', 'キャリア名', 'statsPane-carrier'); }
  function _renderNm()      { _renderGrouped(_data?.nmGroups      || [], 'nm', '品名',       'statsPane-nm'); }
  function _renderUn()      { _renderGrouped(_data?.unGroups      || [], 'un', '単位',       'statsPane-un'); }

  function _renderMaster() {
    const e = document.getElementById('statsPane-master');
    if (!e) return;

    const cloudOn = _cloud() && _cvMap !== null;
    let entries = [];
    if (cloudOn) {
      _cvMap.forEach(({ total, isMine }, key) => {
        if (total < 1) return;
        const [field, value] = key.split(':::');
        entries.push({ field, value, votes: total, isMine, promoted: total >= 2 });
      });
    } else {
      entries = _getMasters().map(m => ({ ...m, isMine: true }));
    }

    if (!entries.length) {
      e.innerHTML = '<p class="stats-empty">マスター候補はまだありません。<br>各集計の ☆ 昇格 ボタンで登録できます。<br>' +
                   `<small>票数 2 以上で「✅ マスター」に昇格します。${cloudOn ? '（チーム全員の票数）' : '（ローカル保存）'}</small></p>`;
      return;
    }
    const labels = { sv: 'サブコン', nm: '品名', un: '単位' };
    const sorted = entries.sort((a, b) => b.votes - a.votes);
    let h = '<table class="stats-table"><thead><tr>' +
            '<th>種別</th><th>値</th><th class="stats-num-col">票</th><th>状態</th><th></th>' +
            '</tr></thead><tbody>';
    sorted.forEach(m => {
      h += `<tr>` +
           `<td>${labels[m.field] || m.field}</td>` +
           `<td class="stats-val">${_esc(m.value)}</td>` +
           `<td class="stats-num-col">${m.votes}</td>` +
           `<td>${m.promoted ? '<span class="stats-master-badge">✅ マスター</span>' : '<span class="stats-cand-badge">候補</span>'}</td>` +
           `<td>${m.isMine ? `<button class="stats-demote-btn" onclick="statsToggleVote('${_ea(m.field)}','${_ea(m.value)}')">取消</button>` : ''}</td>` +
           `</tr>`;
    });
    e.innerHTML = h + '</tbody></table>';
  }

  function _renderAlias() {
    if (typeof window.arRenderPane === 'function') window.arRenderPane();
    else document.getElementById('statsPane-alias')?.innerHTML = '<p class="stats-empty">alias-rules.js が読み込まれていません。</p>';
  }

  function _renderCloud() {
    const e = document.getElementById('statsCloudStatus');
    if (!e) return;
    if (_cloud()) {
      e.textContent = `☁️ クラウド投票: ${_me()} でログイン中`;
      e.className = 'stats-cloud-on';
    } else {
      e.textContent = '💾 ローカル投票（ログインするとチーム共有）';
      e.className = 'stats-cloud-off';
    }
  }

  function _updateSummary() {
    if (!_data) return;
    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    set('statsTotal',    _data.totalPresets);
    set('statsRows',     _data.totalRows);
    set('statsSvCount',  _data.svGroups.length + _data.carrierGroups.length);
    set('statsNmGroups', _data.nmGroups.length);
  }

  function _renderActivePane() {
    const active = document.querySelector('#tab-stats .stats-pane.is-active');
    if (!active) return;
    const id = active.id.replace('statsPane-', '');
    if      (id === 'sv')      _renderSv();
    else if (id === 'carrier') _renderCarrier();
    else if (id === 'nm')      _renderNm();
    else if (id === 'un')      _renderUn();
    else if (id === 'master')  _renderMaster();
    else if (id === 'alias')   _renderAlias();
  }

  // === サブタブ切替 ===

  function statsSetPane(paneId) {
    document.querySelectorAll('#tab-stats .stats-tab-btn').forEach(b => b.classList.remove('is-active'));
    document.querySelectorAll('#tab-stats .stats-pane').forEach(p => p.classList.remove('is-active'));
    document.getElementById('statsTabBtn-' + paneId)?.classList.add('is-active');
    document.getElementById('statsPane-'   + paneId)?.classList.add('is-active');
    if (!_data) { _data = _build(document.getElementById('statsSource')?.value || 'both'); _updateSummary(); }
    if      (paneId === 'sv')      _renderSv();
    else if (paneId === 'carrier') _renderCarrier();
    else if (paneId === 'nm')      _renderNm();
    else if (paneId === 'un')      _renderUn();
    else if (paneId === 'master')  _renderMaster();
    else if (paneId === 'alias')   _renderAlias();
  }

  // === パブリック API ===

  window.initStatsTab = async function () {
    _data  = null;
    _cvMap = null;
    _data  = _build(document.getElementById('statsSource')?.value || 'both');
    _updateSummary();
    _renderCloud();
    statsSetPane('sv');
    if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
    if (_cloud()) {
      await _loadCloudVotes();
      _renderCloud();
      _renderActivePane();
    }
  };

  window.statsSetPane = statsSetPane;

  window.statsRefresh = async function () {
    _data  = null;
    _cvMap = null;
    _data  = _build(document.getElementById('statsSource')?.value || 'both');
    _updateSummary();
    _renderCloud();
    if (_cloud()) await _loadCloudVotes();
    _renderCloud();
    _renderActivePane();
    if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
  };

  window.statsToggleVote = async function (field, value) {
    const v = _voteInfo(field, value);
    if (v.isMine) await _demote(field, value);
    else          await _promote(field, value);
    _renderActivePane();
    _renderMaster();
    if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
  };

  // 後方互換
  window.statsPromote = async function (f, v) { await _promote(f, v); _renderActivePane(); };
  window.statsDemote  = async function (f, v) { await _demote(f, v);  _renderMaster(); };

})();
