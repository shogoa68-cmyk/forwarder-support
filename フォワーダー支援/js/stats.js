// 統計タブ: 見積プリセット行データを集計・マスター管理
(function () {
  'use strict';

  // cells 配列のインデックス（v3 format: [0]=selected [1]=cat [2]=sv [3]=tx [4]=nm [5]=pq [6]=un ...)
  const CI = { cat: 1, sv: 2, nm: 4, un: 6 };
  const CARRIER_CATS = new Set(['ocean', 'surcharge']);
  const MASTER_KEY   = 'masterCandidates_v1';

  let _data = null;

  // === データ取得 ===

  function _getLocalPresets() {
    try { return JSON.parse(localStorage.getItem('quotePresets_v1') || '[]'); }
    catch (e) { return []; }
  }

  function _getCloudPresets() {
    return typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
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
      _getCloudPresets().forEach(p => {
        const rows = _extractRows(p);
        if (rows.length) presets.push({ name: p.name || '（名称なし）', rows, src: 'cloud' });
      });
    }

    const allRows     = presets.flatMap(p => p.rows);
    const svRows      = allRows.filter(r => r.sv && !CARRIER_CATS.has(r.cat));
    const carrierRows = allRows.filter(r => r.sv &&  CARRIER_CATS.has(r.cat));

    return {
      presets,
      totalPresets:  presets.length,
      totalRows:     allRows.length,
      svFreq:        _freq(svRows.map(r => r.sv)),
      carrierFreq:   _freq(carrierRows.map(r => r.sv)),
      nmGroups:      _groupSimilar(allRows.map(r => r.nm).filter(Boolean)),
      unFreq:        _freq(allRows.map(r => r.un).filter(Boolean)),
    };
  }

  function _freq(arr) {
    const m = new Map();
    arr.forEach(v => m.set(v, (m.get(v) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }

  // 品名ゆらぎ: 括弧・区切り・大小文字・カタカナを正規化してグループ化
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

  // === マスター候補管理 ===

  function _getMasters() {
    try { return JSON.parse(localStorage.getItem(MASTER_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function _saveMasters(arr) { localStorage.setItem(MASTER_KEY, JSON.stringify(arr)); }

  function _getVotes(field, value) {
    return (_getMasters().find(c => c.field === field && c.value === value) || {}).votes || 0;
  }

  function _promote(field, value) {
    const arr = _getMasters();
    const idx = arr.findIndex(c => c.field === field && c.value === value);
    if (idx >= 0) arr[idx].votes = (arr[idx].votes || 0) + 1;
    else arr.push({ field, value, votes: 1, ts: Date.now() });
    _saveMasters(arr);
  }

  function _demote(field, value) {
    const arr = _getMasters();
    const idx = arr.findIndex(c => c.field === field && c.value === value);
    if (idx < 0) return;
    arr[idx].votes = Math.max(0, arr[idx].votes - 1);
    if (arr[idx].votes === 0) arr.splice(idx, 1);
    _saveMasters(arr);
  }

  // === レンダリングヘルパー ===

  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _ea(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _voteBtn(field, value) {
    const v = _getVotes(field, value);
    return `<button class="stats-vote-btn${v > 0 ? ' stats-voted' : ''}" ` +
           `onclick="statsPromote('${_ea(field)}','${_ea(value)}')" title="マスターに昇格">` +
           (v > 0 ? `⭐ ${v}` : '☆ 昇格') + '</button>';
  }

  function _freqTable(freq, field, colLabel) {
    if (!freq.length) return '<p class="stats-empty">データなし</p>';
    let h = `<table class="stats-table"><thead><tr>` +
            `<th>${colLabel}</th><th class="stats-num-col">回数</th><th></th>` +
            `</tr></thead><tbody>`;
    freq.forEach(({ value, count }) => {
      h += `<tr><td class="stats-val">${_esc(value)}</td>` +
           `<td class="stats-num-col">${count}</td>` +
           `<td>${_voteBtn(field, value)}</td></tr>`;
    });
    return h + '</tbody></table>';
  }

  // === ペイン描画 ===

  function _renderSv()      { const e = document.getElementById('statsPane-sv');      if (e && _data) e.innerHTML = _freqTable(_data.svFreq,      'sv', 'サブコン名'); }
  function _renderCarrier() { const e = document.getElementById('statsPane-carrier'); if (e && _data) e.innerHTML = _freqTable(_data.carrierFreq, 'sv', 'キャリア名'); }
  function _renderUn()      { const e = document.getElementById('statsPane-un');      if (e && _data) e.innerHTML = _freqTable(_data.unFreq,      'un', '単位'); }

  function _renderNm() {
    const e = document.getElementById('statsPane-nm');
    if (!e || !_data) return;
    if (!_data.nmGroups.length) { e.innerHTML = '<p class="stats-empty">データなし</p>'; return; }
    let h = '<table class="stats-table stats-nm-table"><thead><tr>' +
            '<th>品名</th><th class="stats-num-col">合計</th><th>バリアント</th>' +
            '</tr></thead><tbody>';
    _data.nmGroups.forEach(g => {
      const hasV = g.variants.length > 1;
      h += `<tr${hasV ? ' class="stats-has-variant"' : ''}>`;
      h += `<td class="stats-val">${_esc(g.variants[0].value)}`;
      if (hasV) h += ` <span class="stats-variant-badge">ゆらぎ ${g.variants.length}種</span>`;
      h += `</td><td class="stats-num-col">${g.total}</td><td class="stats-chips-cell">`;
      g.variants.forEach(v => {
        h += `<span class="stats-chip">` +
             `<span class="stats-chip-text">${_esc(v.value)}</span>` +
             `<span class="stats-chip-cnt">×${v.count}</span>` +
             _voteBtn('nm', v.value) +
             `</span>`;
      });
      h += '</td></tr>';
    });
    e.innerHTML = h + '</tbody></table>';
  }

  function _renderMaster() {
    const e = document.getElementById('statsPane-master');
    if (!e) return;
    const arr = _getMasters();
    if (!arr.length) {
      e.innerHTML = '<p class="stats-empty">マスター候補はまだありません。<br>各集計の ☆ 昇格 ボタンで登録できます。<br><small>票数 2 以上で「✅ マスター」に昇格します。</small></p>';
      return;
    }
    const labels = { sv: 'サブコン', nm: '品名', un: '単位' };
    let h = '<table class="stats-table"><thead><tr>' +
            '<th>種別</th><th>値</th><th class="stats-num-col">票</th><th>状態</th><th></th>' +
            '</tr></thead><tbody>';
    [...arr].sort((a, b) => b.votes - a.votes).forEach(m => {
      h += `<tr>` +
           `<td>${labels[m.field] || m.field}</td>` +
           `<td class="stats-val">${_esc(m.value)}</td>` +
           `<td class="stats-num-col">${m.votes}</td>` +
           `<td>${m.votes >= 2 ? '<span class="stats-master-badge">✅ マスター</span>' : '<span class="stats-cand-badge">候補</span>'}</td>` +
           `<td><button class="stats-demote-btn" onclick="statsDemote('${_ea(m.field)}','${_ea(m.value)}')">取消</button></td>` +
           `</tr>`;
    });
    e.innerHTML = h + '</tbody></table>';
  }

  // === サマリカード更新 ===

  function _updateSummary() {
    if (!_data) return;
    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    set('statsTotal',    _data.totalPresets);
    set('statsRows',     _data.totalRows);
    set('statsSvCount',  _data.svFreq.length + _data.carrierFreq.length);
    set('statsNmGroups', _data.nmGroups.length);
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
  }

  // === パブリック API ===

  window.initStatsTab = function () {
    _data = null;
    _data = _build(document.getElementById('statsSource')?.value || 'both');
    _updateSummary();
    statsSetPane('sv');
  };

  window.statsSetPane = statsSetPane;

  window.statsRefresh = function () {
    _data = null;
    _data = _build(document.getElementById('statsSource')?.value || 'both');
    _updateSummary();
    const active = document.querySelector('#tab-stats .stats-pane.is-active');
    const id = active ? active.id.replace('statsPane-', '') : 'sv';
    statsSetPane(id);
  };

  window.statsPromote = function (field, value) {
    _promote(field, value);
    const active = document.querySelector('#tab-stats .stats-pane.is-active');
    const id = active ? active.id.replace('statsPane-', '') : 'sv';
    statsSetPane(id);
  };

  window.statsDemote = function (field, value) {
    _demote(field, value);
    _renderMaster();
  };

})();
