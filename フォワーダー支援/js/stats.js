// 統計タブ: 見積プリセット行データを集計・マスター管理（ローカル＋クラウド投票）
(function () {
  'use strict';

  // cells 配列のインデックス（v3 format: [0]=selected [1]=cat [2]=sv [3]=tx [4]=nm [5]=pq [6]=un ...）
  const CI = { cat: 1, sv: 2, nm: 4, un: 6, pc: 8, bc: 9, pp: 10, bp: 11 };
  const CARRIER_CATS = new Set(['ocean', 'surcharge', 'air']);
  const LOCAL_KEY    = 'masterCandidates_v1';
  const VOTES_TABLE  = 'master_votes';

  let _data    = null;
  let _cvMap   = null;  // Map<`field\x00value`, { total, isMine }> — クラウド投票キャッシュ
  const _renderedGroups = {};  // { groupId → { aliasField, variants[] } } — バッジクリック用

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
      const key = r.field + '\x00' + r.value;
      if (!_cvMap.has(key)) _cvMap.set(key, { total: 0, isMine: false });
      const v = _cvMap.get(key);
      v.total++;
      if (r.voter_email === me) v.isMine = true;
    });
  }

  function _voteInfo(field, value) {
    if (_cloud() && _cvMap !== null) return _cvMap.get(field + '\x00' + value) || { total: 0, isMine: false };
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
          nm:  (c[CI.nm]  || '').replace(/^\*+/, '').trim(),
          un:  (c[CI.un]  || '').trim(),
        };
      })
      .filter(r => r.sv || r.nm);
  }

  function _build(source) {
    const period = document.getElementById('statsPeriod')?.value || 'all';
    const now = Date.now();
    const CUTOFF = { all: 0, month: now - 30*86400000, q3: now - 91*86400000, year: now - 365*86400000 };
    const cutoff = CUTOFF[period] || 0;

    const presets = [];
    if (source !== 'cloud') {
      _getLocalPresets().forEach(p => {
        if (cutoff && p.updatedAt && new Date(p.updatedAt).getTime() < cutoff) return;
        const rows = _extractRows(p);
        if (rows.length) presets.push({ name: p.name || '（名称なし）', rows, src: 'local' });
      });
    }
    if (source !== 'local') {
      const cloud = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
      cloud.forEach(p => {
        if (cutoff && p.updated_at && new Date(p.updated_at).getTime() < cutoff) return;
        const rows = _extractRows(p);
        if (rows.length) presets.push({ name: p.name || '（名称なし）', rows, src: 'cloud' });
      });
    }
    const allRows     = presets.flatMap(p => p.rows);
    const svRows      = allRows.filter(r => r.sv && !CARRIER_CATS.has(r.cat));
    const carrierRows = allRows.filter(r => r.sv &&  CARRIER_CATS.has(r.cat));
    const excl = typeof window.arGetExclusions === 'function' ? window.arGetExclusions() : [];
    const svExcl = new Set(excl.filter(e => e.field === 'sv').map(e => e.value));
    const nmExcl = new Set(excl.filter(e => e.field === 'nm').map(e => e.value));
    const unExcl = new Set(excl.filter(e => e.field === 'un').map(e => e.value));
    const portExcl = new Set(excl.filter(e => e.field === 'port').map(e => e.value));
    return {
      presets, totalPresets: presets.length, totalRows: allRows.length,
      svGroups:      _groupSimilar(svRows.map(r => r.sv), svExcl, 'sv'),
      carrierGroups: _groupSimilar(carrierRows.map(r => r.sv), svExcl, 'sv'),
      nmGroups:      _groupSimilar(allRows.map(r => r.nm).filter(Boolean), nmExcl, 'nm'),
      unGroups:      _groupSimilar(allRows.map(r => r.un).filter(Boolean), unExcl, 'un'),
      portGroups:    _groupSimilar(_gatherPorts(source), portExcl, 'port'),
    };
  }

  // 港名（POL/POD/Via）を全プリセットの条件フィールドから収集。
  // 複数航路（z2-routes-data）がある場合はそちらを優先（cloud.js の列昇格ロジックと同じ）。
  function _portValsFromFields(f) {
    let rts = [];
    try { rts = JSON.parse(f['z2-routes-data'] || '[]'); } catch (e) {}
    const out = [];
    if (Array.isArray(rts) && rts.length) {
      rts.forEach(r => ['pol', 'pod', 'via'].forEach(k => { const v = (r[k] || '').trim(); if (v) out.push(v); }));
    } else {
      ['z2Pol', 'z2Pod', 'z2Via'].forEach(k => { const v = (f[k] || '').trim(); if (v) out.push(v); });
    }
    return out;
  }
  function _gatherPorts(source) {
    const ports = [];
    const add = p => { ports.push(..._portValsFromFields((p.data || {}).fields || {})); };
    if (source !== 'cloud') _getLocalPresets().forEach(add);
    if (source !== 'local') (typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []).forEach(add);
    return ports;
  }

  function _freq(arr) {
    const m = new Map();
    arr.forEach(v => m.set(v, (m.get(v) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }

  function _normalize(s) {
    return s
      .replace(/^\*+/, '')                   // 課税マーク（品名先頭の *）を除去
      .replace(/【[^】]*】/g, '')
      .replace(/[\s　・ー―\-\/\\]+/g, '')
      .toLowerCase()
      .replace(/[ァ-ン]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  function _groupSimilar(names, excl, field) {
    const freq   = _freq(names);
    const groups = new Map();
    const abbrevPairs = (field && typeof window.arGetAbbrevPairs === 'function')
      ? window.arGetAbbrevPairs(field) : [];
    freq.forEach(({ value, count }) => {
      let key, isAbbrevGroup = false, canonical = null;
      if (excl && excl.has(value)) {
        key = '\x01' + value;
      } else {
        const pair = abbrevPairs.find(p => p.abbrev === value || p.full === value);
        if (pair) {
          key = '\x02' + pair.full;
          isAbbrevGroup = true;
          canonical = pair.full;
        } else {
          key = _normalize(value);
        }
      }
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { variants: [], total: 0, isAbbrevGroup, canonical });
      const g = groups.get(key);
      g.variants.push({ value, count });
      g.total += count;
    });
    // 略称グループは正式名称を先頭に
    groups.forEach(g => {
      if (g.isAbbrevGroup && g.canonical) {
        g.variants.sort((a, b) => (a.value === g.canonical ? -1 : b.value === g.canonical ? 1 : b.count - a.count));
      }
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
  // onclick 属性内のシングルクォート文字列リテラル用エスケープ。
  // HTML エンティティ（&#39;）はブラウザが JS 実行前に ' に戻してしまい構文エラーになるため、
  // JS の \' エスケープを使う（HTML は \ をデコードしない）。
  function _ea(s)   { return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  // HTML value="" 属性用
  function _eav(s)  { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  // 同義グループ操作ボタン（⭐代表 / ⤵統合 / →代表ピル）。field は sv/nm/customer/port。
  function _synBtns(field, value, canons, aliasOf, cntMap) {
    const isCanon = canons.has(value);
    const canon   = aliasOf[value];
    let h = `<button class="stats-syn-star${isCanon ? ' on' : ''}" ` +
            `onclick="statsToggleSynCanonical('${_ea(field)}','${_ea(value)}')" ` +
            `title="${isCanon ? '代表を解除' : '同義グループの代表に設定'}">${isCanon ? '⭐代表' : '☆代表'}</button>`;
    if (isCanon) {
      const g = (typeof window.synGetGroups === 'function' ? window.synGetGroups(field) : []).find(x => x.canonical === value);
      const aliases = (g && g.aliases) || [];
      if (aliases.length) {
        const total = (cntMap[value] || 0) + aliases.reduce((s, a) => s + (cntMap[a] || 0), 0);
        h += `<span class="stats-syn-total" title="統合した表記の合計件数（${aliases.length}件統合）">計${total}</span>`;
      }
    } else if (canon) {
      h += `<span class="stats-syn-into" title="「${_eav(canon)}」に統合済み">→${_esc(canon)}</span>` +
           `<button class="stats-syn-unmerge" onclick="statsSynUnmerge('${_ea(field)}','${_ea(value)}')" title="統合を解除">✕</button>`;
    } else if (canons.size) {
      h += `<button class="stats-syn-merge" onclick="statsSynMergePicker('${_ea(field)}','${_ea(value)}',this)" title="既存の代表に統合">⤵統合</button>`;
    }
    return h;
  }

  function _voteBtn(field, value) {
    const v  = _voteInfo(field, value);
    const on = v.isMine;
    return `<button class="stats-vote-btn${on ? ' stats-voted' : ''}" ` +
           `onclick="statsToggleVote('${_ea(field)}','${_ea(value)}')" ` +
           `title="${on ? 'マスターを解除' : 'マスターに登録'}">` +
           (on ? '⭐ 登録済' : '☆ 登録') +
           '</button>';
  }

  // ゆらぎグループ表示（nm/sv/carrier/port 共通）。
  // 手動の同義グループ（⭐代表→統合）は単位タブと同様に1行へ統合表示し、
  // それ以外は従来どおり自動ゆらぎ検出グループとして表示（併存）。
  // === 並べ替え（件数順／名前順）===
  // 名前順にすると似た表記が隣接し、代表登録（⭐代表→統合）作業がしやすくなる。
  let _statsSort = 'count';   // 'count' | 'name'
  window.statsSetSort = function (mode) {
    _statsSort = (mode === 'name') ? 'name' : 'count';
    _renderActivePane();
  };
  function _cmpName(a, b) { return String(a || '').localeCompare(String(b || ''), 'ja'); }
  function _sortToolbar() {
    const by = _statsSort;
    return '<div class="stats-sort-toolbar"><span class="stats-sort-label">並び替え</span>' +
           `<button class="stats-sort-btn${by === 'count' ? ' is-active' : ''}" onclick="statsSetSort('count')">件数順</button>` +
           `<button class="stats-sort-btn${by === 'name' ? ' is-active' : ''}" onclick="statsSetSort('name')">名前順（あ→ん）</button></div>`;
  }

  function _renderGrouped(groups, field, colLabel, paneId) {
    const e = document.getElementById(paneId);
    if (!e || !_data) return;
    // carrier も alias rule / 同義グループでは 'sv' フィールドを使う
    const aliasField = (field === 'sv') ? 'sv' : field;
    const synGroups  = typeof window.synGetGroups === 'function' ? window.synGetGroups(aliasField) : [];
    const synCanons  = new Set(synGroups.map(g => g.canonical));
    const synAliasOf = {};
    synGroups.forEach(g => (g.aliases || []).forEach(a => { synAliasOf[a] = g.canonical; }));
    // 件数マップ（全バリアント横断）
    const cntMap = {};
    groups.forEach(g => g.variants.forEach(v => { cntMap[v.value] = (cntMap[v.value] || 0) + v.count; }));
    // 同義グループが消費する値（代表＋統合先すべて）
    const consumed = new Set();
    synGroups.forEach(g => { consumed.add(g.canonical); (g.aliases || []).forEach(a => consumed.add(a)); });
    // 同義グループ統合行（合計降順）
    const synRows = synGroups.map(g => {
      const own = cntMap[g.canonical] || 0;
      const aliasCnt = (g.aliases || []).reduce((s, a) => s + (cntMap[a] || 0), 0);
      return { g, own, aliasCnt, total: own + aliasCnt };
    });
    synRows.sort((a, b) => _statsSort === 'name' ? _cmpName(a.g.canonical, b.g.canonical) : b.total - a.total);
    // 残りの自動ゆらぎグループ（同義グループに取り込まれた値を除外）
    const restGroups = [];
    groups.forEach((g, gIdx) => {
      const variants = g.variants.filter(v => !consumed.has(v.value));
      if (!variants.length) return;
      restGroups.push({ variants, total: variants.reduce((s, v) => s + v.count, 0), isAbbrevGroup: g.isAbbrevGroup, origIdx: gIdx });
    });
    if (_statsSort === 'name') restGroups.sort((a, b) => _cmpName(a.variants[0].value, b.variants[0].value));

    if (!synRows.length && !restGroups.length) { e.innerHTML = '<p class="stats-empty">データなし</p>'; return; }

    // 件数バーのスケール（表示行の最大 total）
    const maxTotal = Math.max(1, ...synRows.map(r => r.total), ...restGroups.map(g => g.total));

    let h = _sortToolbar() +
            '<p class="stats-syn-hint">☆代表 で同義グループの基準を決め、他の表記を ⤵統合 でまとめると、⭐行に集約され件数が合算されます（非破壊）。表記ゆれの一括置換は「ゆらぎ N種」バッジから。</p>' +
            `<table class="stats-table stats-nm-table"><thead><tr>` +
            `<th>${colLabel}</th><th class="stats-num-col">合計</th><th>同義グループ / バリアント</th>` +
            `</tr></thead><tbody>`;

    // --- 同義グループ（統合表示）---
    synRows.forEach(sr => {
      const g = sr.g;
      const members = (g.aliases || []).length + 1;
      let chips = `<span class="stats-chip stats-chip--canon">` +
                  `<span class="stats-chip-text">⭐ ${_esc(g.canonical)}</span>` +
                  `<span class="stats-chip-cnt">×${sr.own}</span>` +
                  _voteBtn(field, g.canonical) +
                  `</span>`;
      (g.aliases || []).forEach(a => {
        chips += `<span class="stats-chip">` +
                 `<span class="stats-chip-text">${_esc(a)}</span>` +
                 `<span class="stats-chip-cnt">×${cntMap[a] || 0}</span>` +
                 `<button class="stats-syn-unmerge" onclick="statsSynUnmerge('${_ea(aliasField)}','${_ea(a)}')" title="統合を解除">✕</button>` +
                 `</span>`;
      });
      h += `<tr class="stats-syn-row">` +
           `<td class="stats-val"><span class="ua-star">⭐</span>${_esc(g.canonical)} <span class="stats-syn-grp-badge" title="同義グループ（${members}種を集約）">同義 ${members}種</span></td>` +
           `<td class="stats-num-col"><div class="stats-bar-wrap"><div class="stats-bar" style="width:${Math.round(sr.total / maxTotal * 100)}%"></div><span class="stats-bar-label">${sr.total}</span></div>${sr.aliasCnt ? `<span class="ua-cnt-detail"> (${sr.own}+${sr.aliasCnt})</span>` : ''}</td>` +
           `<td class="stats-chips-cell">${chips}` +
             `<button class="stats-syn-dissolve" onclick="statsToggleSynCanonical('${_ea(aliasField)}','${_ea(g.canonical)}')" title="同義グループを解除">グループ解除</button>` +
           `</td></tr>`;
    });

    // --- 残りの自動ゆらぎグループ ---
    restGroups.forEach(g => {
      const hasV = g.variants.length > 1;
      const gId  = paneId + '-' + g.origIdx;
      _renderedGroups[gId] = { aliasField, variants: g.variants };
      h += `<tr${hasV ? ' class="stats-has-variant"' : ''}>`;
      h += `<td class="stats-val">${_esc(g.variants[0].value)}`;
      if (hasV) {
        if (g.isAbbrevGroup) {
          h += ` <span class="stats-variant-badge stats-variant-badge--abbrev" title="略称辞書で関連付けられた表記">略称 ${g.variants.length}種</span>`;
        } else {
          h += ` <button class="stats-variant-badge stats-variant-badge--link" onclick="statsJumpToAlias('${gId}')" title="エイリアス是正タブで一括登録">ゆらぎ ${g.variants.length}種</button>`;
        }
      }
      h += `</td>`;
      h += `<td class="stats-num-col">` +
           `<div class="stats-bar-wrap"><div class="stats-bar" style="width:${Math.round(g.total/maxTotal*100)}%"></div>` +
           `<span class="stats-bar-label">${g.total}</span></div>` +
           `</td>`;
      h += `<td class="stats-chips-cell">`;
      g.variants.forEach(v => {
        h += `<span class="stats-chip">` +
             `<span class="stats-chip-text">${_esc(v.value)}</span>` +
             `<span class="stats-chip-cnt">×${v.count}</span>` +
             _voteBtn(field, v.value) +
             (hasV ? `<button class="stats-excl-chip-btn" onclick="statsExcludeVariant('${_ea(aliasField)}','${_ea(v.value)}')" title="ゆらぎ判定から除外（別物として扱う）">≠</button>` : '') +
             _synBtns(aliasField, v.value, synCanons, synAliasOf, cntMap) +
             `</span>`;
      });
      h += '</td></tr>';
    });
    e.innerHTML = h + '</tbody></table>';
  }

  window.statsExcludeVariant = async function (field, value) {
    if (typeof window.arAddExclusion === 'function') await window.arAddExclusion(field, value);
    // arAddExclusion calls statsRefresh internally
  };

  // === 同義グループ操作（⭐代表 / ⤵統合 / 解除）===
  window.statsToggleSynCanonical = async function (field, value) {
    const groups = typeof window.synGetGroups === 'function' ? window.synGetGroups(field) : [];
    const g = groups.find(x => x.canonical === value);
    if (g) {
      if ((g.aliases || []).length && !confirm(`「${value}」を代表から解除します。統合済み ${g.aliases.length} 件もグループ解除されます。よろしいですか？`)) return;
      await window.synRemoveGroup(field, value);
    } else if (typeof window.synSetCanonical === 'function') {
      await window.synSetCanonical(field, value);
    }
  };
  window.statsSynUnmerge = async function (field, value) {
    const map = typeof window.synGetNormalizeMap === 'function' ? window.synGetNormalizeMap(field) : {};
    const canon = map[value];
    if (canon && typeof window.synRemoveAlias === 'function') await window.synRemoveAlias(field, value, canon);
  };
  window.statsSynMergePicker = function (field, value, btn) {
    document.querySelectorAll('.stats-syn-picker').forEach(el => el.remove());
    const groups = (typeof window.synGetGroups === 'function' ? window.synGetGroups(field) : [])
      .filter(g => g.canonical !== value);
    if (!groups.length) {
      if (typeof window.quoteShowToast === 'function') window.quoteShowToast('⭐ 先に統合先の代表を設定してください', 'warn');
      return;
    }
    const wrap = document.createElement('span');
    wrap.className = 'stats-syn-picker';
    wrap.innerHTML =
      `<select class="stats-syn-sel">` +
      groups.map(g => `<option value="${_eav(g.canonical)}">${_esc(g.canonical)}</option>`).join('') +
      `</select>` +
      `<button class="stats-syn-pick-ok" onclick="statsSynConfirmMerge('${_ea(field)}','${_ea(value)}',this)">統合</button>` +
      `<button class="stats-syn-pick-cancel" onclick="this.closest('.stats-syn-picker').remove()">✕</button>`;
    btn.after(wrap);
  };
  window.statsSynConfirmMerge = async function (field, value, btn) {
    const sel = btn.closest('.stats-syn-picker')?.querySelector('select');
    if (!sel) return;
    if (typeof window.synAddAlias === 'function') await window.synAddAlias(field, value, sel.value);
  };

  // 軽量再描画（クラウドプリセット/投票の再取得を伴わない。同義グループ更新時に使用）
  window.statsRerenderActive = function () {
    try { _renderActivePane(); _renderMaster(); } catch (e) { console.error('[statsRerenderActive]', e); }
  };

  window.statsJumpToAlias = function (groupId) {
    const group = _renderedGroups[groupId];
    if (!group) return;
    if (typeof window.arSetQuickFill === 'function') {
      window.arSetQuickFill(
        group.aliasField,
        group.variants[0].value,
        group.variants.slice(1).map(function (v) { return v.value; })
      );
    }
    statsSetPane('alias');
  };

  // === ペイン描画 ===

  function _renderSv() { _renderGrouped(_data?.svGroups || [], 'sv', 'サブコン名', 'statsPane-sv'); }
  function _renderCarrier() { _renderGrouped(_data?.carrierGroups || [], 'sv', 'キャリア名', 'statsPane-carrier'); }
  function _renderPort() { _renderGrouped(_data?.portGroups || [], 'port', '港名', 'statsPane-port'); }
  function _renderNm()      { _renderGrouped(_data?.nmGroups      || [], 'nm', '品名',       'statsPane-nm'); }

  // ===== 🔗 サブコン×港ペア =====
  // サブコンは明細行（cells[2]）、港は引き合い条件（z2Pol/z2Pod/z2Via・複数航路）にあるため、
  // 「案件単位で使われたサブコン × その案件の港」の共起を集計する。
  // 同義グループの代表に正規化してから数える（件数＝両方を含む案件数）。
  let _svPortBy = 'sv';   // 'sv' | 'port'
  function _buildSvPortPairs(source) {
    const svMap   = typeof window.synGetNormalizeMap === 'function' ? window.synGetNormalizeMap('sv')   : {};
    const portMap = typeof window.synGetNormalizeMap === 'function' ? window.synGetNormalizeMap('port') : {};
    const norm = (v, m) => (m && m[v]) || v;
    const pairs = new Map();   // `${sv} ${port}` → { sv, port, count }
    const add = p => {
      const d = p.data || {};
      const rows = Array.isArray(d.rows) ? d.rows : [];
      const subs = new Set();
      rows.forEach(r => {
        if (!r || r._type !== 'data') return;
        const sv = ((Array.isArray(r.cells) ? r.cells : [])[2] || '').trim();
        if (sv) subs.add(norm(sv, svMap));
      });
      const ports = new Set(_portValsFromFields(d.fields || {}).map(pt => norm(pt, portMap)));
      if (!subs.size || !ports.size) return;
      subs.forEach(sv => ports.forEach(pt => {
        const k = sv + ' ' + pt;
        if (!pairs.has(k)) pairs.set(k, { sv, port: pt, count: 0 });
        pairs.get(k).count++;
      }));
    };
    if (source !== 'cloud') _getLocalPresets().forEach(add);
    if (source !== 'local') (typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []).forEach(add);
    return [...pairs.values()].sort((a, b) => b.count - a.count);
  }

  function _renderSvPort() {
    const e = document.getElementById('statsPane-svport');
    if (!e) return;
    const source = document.getElementById('statsSource')?.value || 'both';
    const pairs  = _buildSvPortPairs(source);
    if (!pairs.length) {
      e.innerHTML = '<p class="stats-empty">サブコンと港の組み合わせがありません。<br>' +
        '<small>明細の「サブコン」欄と、引き合い条件の POL / POD / Via を入力して案件を保存してください。</small></p>';
      return;
    }
    const by = _svPortBy;
    const keyField   = by === 'sv' ? 'sv'   : 'port';
    const otherField = by === 'sv' ? 'port' : 'sv';
    const keyLabel   = by === 'sv' ? 'サブコン' : '港';
    const otherLabel = by === 'sv' ? '港' : 'サブコン';
    const groups = new Map();
    pairs.forEach(p => {
      const k = p[keyField], o = p[otherField];
      if (!groups.has(k)) groups.set(k, { key: k, total: 0, items: [] });
      const g = groups.get(k); g.total += p.count; g.items.push({ other: o, count: p.count });
    });
    const list = [...groups.values()];
    list.sort((a, b) => _statsSort === 'name' ? _cmpName(a.key, b.key) : b.total - a.total);
    list.forEach(g => g.items.sort((a, b) => b.count - a.count));
    const maxTotal = Math.max(1, ...list.map(g => g.total));

    let h = '<div class="svp-toolbar"><span class="svp-by-label">グループ基準</span>' +
            `<button class="svp-by-btn${by === 'sv' ? ' is-active' : ''}" onclick="statsSvPortBy('sv')">🏢 サブコン別</button>` +
            `<button class="svp-by-btn${by === 'port' ? ' is-active' : ''}" onclick="statsSvPortBy('port')">🛳 港別</button></div>` +
            _sortToolbar() +
            '<p class="stats-syn-hint">案件単位で「使われたサブコン × その案件の港」を共起集計します。同義グループの代表に正規化し、件数＝両方を含む案件数です。</p>' +
            `<table class="stats-table"><thead><tr><th>${keyLabel}</th><th class="stats-num-col">件数</th><th>${otherLabel}（×件数）</th></tr></thead><tbody>`;
    list.forEach(g => {
      const chips = g.items.map(it =>
        `<span class="stats-chip"><span class="stats-chip-text">${_esc(it.other)}</span><span class="stats-chip-cnt">×${it.count}</span></span>`
      ).join('');
      h += `<tr><td class="stats-val">${_esc(g.key)}</td>` +
           `<td class="stats-num-col"><div class="stats-bar-wrap"><div class="stats-bar" style="width:${Math.round(g.total / maxTotal * 100)}%"></div><span class="stats-bar-label">${g.total}</span></div></td>` +
           `<td class="stats-chips-cell">${chips}</td></tr>`;
    });
    e.innerHTML = h + '</tbody></table>';
  }
  window.statsSvPortBy = function (by) { _svPortBy = (by === 'port') ? 'port' : 'sv'; _renderSvPort(); };
  function _renderUn() {
    const e = document.getElementById('statsPane-un');
    if (!e || !_data) return;
    const rawGroups = _data.unGroups || [];
    if (!rawGroups.length) { e.innerHTML = '<p class="stats-empty">データなし</p>'; return; }

    const uaGroups    = typeof window.uaGetGroups === 'function' ? window.uaGetGroups() : [];
    const canonicalSet = new Set(uaGroups.map(g => g.canonical));
    const aliasToCanon = {};
    const canonToAliases = {};
    uaGroups.forEach(g => {
      canonToAliases[g.canonical] = g.aliases || [];
      (g.aliases || []).forEach(a => { aliasToCanon[a] = g.canonical; });
    });

    // 各単位の件数マップ
    const countMap = {};
    rawGroups.forEach(g => { countMap[g.variants[0].value] = g.total; });

    // 表示リスト構築
    const displayList = [];
    uaGroups.forEach(g => {
      const ownCount   = countMap[g.canonical] || 0;
      const aliasCount = (g.aliases || []).reduce((s, a) => s + (countMap[a] || 0), 0);
      displayList.push({ type: 'canonical', canonical: g.canonical, ownCount, aliasCount, total: ownCount + aliasCount, aliases: g.aliases || [] });
    });
    rawGroups.forEach(g => {
      const v = g.variants[0].value;
      if (!canonicalSet.has(v) && !aliasToCanon[v]) displayList.push({ type: 'ungrouped', value: v, total: g.total });
    });
    const _unName = it => it.type === 'canonical' ? it.canonical : it.value;
    displayList.sort((a, b) => {
      if (_statsSort === 'name') return _cmpName(_unName(a), _unName(b));
      if (a.type === 'canonical' && b.type !== 'canonical') return -1;
      if (a.type !== 'canonical' && b.type === 'canonical') return 1;
      return b.total - a.total;
    });

    let h = _sortToolbar() +
      '<div class="ua-pane-hint">⭐ 代表に設定 → グループの基準単位として登録　　→ 統合 → 代表に紐付け（件数が合算されます）</div>' +
      '<table class="stats-table stats-un-table"><thead><tr>' +
      '<th>単位</th><th class="stats-num-col">件数</th><th>同義グループ</th><th>操作</th>' +
      '</tr></thead><tbody>';

    displayList.forEach(item => {
      if (item.type === 'canonical') {
        const chips = item.aliases.map(a =>
          `<span class="ua-alias-chip">${_esc(a)}<span class="ua-chip-cnt"> ×${countMap[a] || 0}</span>` +
          `<button class="ua-chip-del" onclick="uaRemoveAlias('${_ea(a)}','${_ea(item.canonical)}')" title="統合解除">✕</button></span>`
        ).join('');
        h += `<tr class="ua-canonical-row">` +
             `<td class="stats-val"><span class="ua-star">⭐</span>${_esc(item.canonical)}</td>` +
             `<td class="stats-num-col">${item.total}` +
             (item.aliasCount ? `<span class="ua-cnt-detail"> (${item.ownCount}+${item.aliasCount})</span>` : '') +
             `</td><td>${chips || '<span class="ua-no-alias">—</span>'}</td>` +
             `<td><button class="ua-remove-canon" onclick="uaRemoveGroup('${_ea(item.canonical)}')" title="グループを解除">解除</button></td>` +
             `</tr>`;
      } else {
        h += `<tr class="ua-ungrouped-row">` +
             `<td class="stats-val">${_esc(item.value)}</td>` +
             `<td class="stats-num-col">${item.total}</td>` +
             `<td></td>` +
             `<td class="ua-ops">` +
             `<button class="ua-set-canon" onclick="uaSetCanonical('${_ea(item.value)}')" title="この単位を代表として登録">⭐ 代表に</button>` +
             `<button class="ua-merge-btn" onclick="uaShowMergePicker('${_ea(item.value)}',this)" title="既存代表に統合">→ 統合</button>` +
             `</td></tr>`;
      }
    });

    e.innerHTML = h + '</tbody></table>';
  }
  window.statsRefreshUnPane = _renderUn;

  // ===== チャージ詳細タブ =====

  async function _renderCharges() {
    const e = document.getElementById('statsPane-charges');
    if (!e) return;
    e.innerHTML = '<p class="stats-empty">💰 チャージ詳細を読み込み中…</p>';

    // _c() は stats.js 内の cloudGetClient フォールバック済みクライアントを使う
    // （subcon-insert の _user() に依存せず、ログイン状態を問わず取得可能）
    let subcons = [];
    const db = _c();
    if (db && typeof window.buildSubconData === 'function') {
      const { data } = await db.from('quote_presets')
        .select('id,name,customer,person,status,transport_mode,pol,pod,data,updated_at');
      subcons = window.buildSubconData(data || []);
    } else if (typeof window.getSubconData === 'function') {
      subcons = window.getSubconData();
    }
    // getSubconData が空 (モーダル未開封) の場合、ローカルプリセットから直接集計
    if (!subcons.length && typeof window.buildSubconData === 'function') {
      const localPresets = _getLocalPresets();
      if (localPresets.length) subcons = window.buildSubconData(localPresets);
    }

    if (!subcons.length) {
      e.innerHTML = '<p class="stats-empty">案件が保存されると自動で集計されます。<br><small>明細の「サブコン」欄に会社名を入れて案件を保存してください。</small></p>';
      return;
    }

    const _m = (n, cur) => {
      if (n == null) return '—';
      const c = (cur || 'JPY').trim() || 'JPY';
      return c === 'JPY' ? '¥' + Math.round(n).toLocaleString('ja-JP') : c + ' ' + n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
    };
    const ROLE = { 'domestic':'国内作業','export-local':'輸出ローカル','ocean':'海上','air':'航空','surcharge':'サーチャージ','import-local':'輸入ローカル','overseas':'海外作業','customs-export':'通関(輸出)','customs-import':'通関(輸入)','insurance':'保険','other':'その他' };
    const CAT_CLASS = { 'domestic':'cat-domestic','export-local':'cat-export-local','ocean':'cat-ocean','air':'cat-air','surcharge':'cat-surcharge','import-local':'cat-import-local','overseas':'cat-overseas','customs-export':'cat-customs-export','customs-import':'cat-customs-import','insurance':'cat-insurance','other':'cat-other' };

    let h = '';
    subcons.forEach(sc => {
      // サーチャージを先頭に、以降は直近使用順
      const sortedItems = [...sc.items].sort((a, b) => {
        if (a.cat === 'surcharge' && b.cat !== 'surcharge') return -1;
        if (a.cat !== 'surcharge' && b.cat === 'surcharge') return 1;
        return b.lastUsed - a.lastUsed;
      });
      const rows = sortedItems.map(it => {
        const ppStr = it.pp != null ? _m(it.pp, it.pc) : '—';
        const bpNum = it.bp ? parseFloat(it.bp) : null;
        const bpStr = bpNum != null && isFinite(bpNum) ? _m(bpNum, it.bc || it.pc) : null;
        const avgStr = it.avgPp != null ? _m(it.avgPp, it.pc) : null;
        const priceCell = bpStr ? ppStr + ' → ' + bpStr : ppStr;
        const unit = it.un ? ' /' + _esc(it.un) : '';

        // 推移ミニタイムライン（前回と価格が変わったポイントのみ残す）
        let histHtml = '';
        if (it.history && it.history.length > 1) {
          const deduped = it.history.filter((h, i, arr) =>
            i === 0 || h.pp !== arr[i - 1].pp || h.bp !== arr[i - 1].bp || h.route !== arr[i - 1].route
          ).slice(-8);
          if (deduped.length > 1) {
            const pts = deduped.map(h => {
              const d = h.ts ? new Date(h.ts).toLocaleDateString('ja-JP', { year: '2-digit', month: '2-digit' }) : '?';
              const p = h.pp != null ? _m(h.pp, it.pc) : '—';
              const routeHtml = h.route ? `<span class="stats-hist-route">${_esc(h.route)}</span>` : '';
              return `<span class="stats-hist-pt"><span class="stats-hist-date">${_esc(d)}</span><b>${_esc(p)}</b>${routeHtml}</span>`;
            }).join('<span class="stats-hist-arr">›</span>');
            histHtml = `<details class="stats-hist-details"><summary>📈 推移 (${deduped.length})</summary><div class="stats-hist-trail">${pts}</div></details>`;
          }
        }
        const avgHtml = avgStr ? `<div class="stats-hist-avg">平均 ${_esc(avgStr)}</div>` : '';

        return `<tr>` +
               `<td><span class="rp-cat ${CAT_CLASS[it.cat]||'cat-other'}">${_esc(ROLE[it.cat]||it.cat||'—')}</span></td>` +
               `<td class="stats-val">${_esc(it.name)}</td>` +
               `<td class="stats-sv-price">${_esc(priceCell)}${_esc(unit)}${avgHtml}${histHtml}</td>` +
               `</tr>`;
      }).join('');
      const hasSurcharge = sc.items.some(it => it.cat === 'surcharge');
      h += `<details class="stats-sv-detail${hasSurcharge ? ' stats-sv-detail--surge' : ''}" ${hasSurcharge ? 'open' : ''}>` +
           `<summary><b>${_esc(sc.name)}</b>` +
           (hasSurcharge ? '<span class="stats-sv-surge-badge">⚡ サーチャージあり</span>' : '') +
           `<span class="stats-sv-detail-meta">使用 ${sc.uses}案件 · ${sc.items.length}項目</span></summary>` +
           `<table class="stats-table stats-sv-charge-table"><thead><tr>` +
           `<th>カテゴリ</th><th>品名</th><th>単価（仕入 → 売上）</th>` +
           `</tr></thead><tbody>${rows}</tbody></table>` +
           `</details>`;
    });
    e.innerHTML = '<div class="stats-sv-charges-wrap">' + h + '</div>';
  }

  // ===== お客様タブ =====
  const _stCls = st => ({ '下書き中':'draft','提出済み':'sent','提示済み':'sent','ヨコヨコ提示':'sent','受注':'won','失注':'lost','辞退':'declined','保留':'hold' }[st] || 'draft');

  // ===== 📈 ダッシュボード（案件分析） =====

  // 案件（プリセット）1件を分析用に正規化。ローカル／クラウド両対応。
  function _num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[, ]/g, '')); return isFinite(n) ? n : null; }
  function _jpy(n)  { return '¥' + Math.round(n).toLocaleString('ja-JP'); }
  function _toJ(amount, cur) {
    const c = (cur || 'JPY').trim() || 'JPY';
    if (c === 'JPY') return amount;
    if (typeof toJPY !== 'function') return null;
    const v = toJPY(amount, c);
    return isFinite(v) ? v : null;
  }

  // 行配列（data.rows）から案件全体の仕入合計・売上合計（JPY換算）を算出。換算不能行は除外。
  function _caseFinancials(rows) {
    if (!Array.isArray(rows)) return null;
    let cost = 0, bill = 0, ok = false;
    rows.forEach(r => {
      if (!r || r._type !== 'data') return;
      const c  = Array.isArray(r.cells) ? r.cells : [];
      const pp = _num(c[10]), bp = _num(c[11]);
      const pq = _num(c[5]) > 0 ? _num(c[5]) : 1;
      const bq = _num(c[7]) > 0 ? _num(c[7]) : 1;
      const pc = c[8] || 'JPY', bc = c[9] || 'JPY';
      if (pp != null) { const cc = _toJ(pp * pq, pc); if (cc != null) { cost += cc; ok = true; } }
      if (bp != null) { const bb = _toJ(bp * bq, bc); if (bb != null) { bill += bb; ok = true; } }
    });
    return ok ? { cost, bill } : null;
  }

  // ローカル fields からの航路フォールバック（z2-routes-data）
  function _routeFromFields(f, key /* 'pol'|'pod'|'carrier' */) {
    const single = (f['z2Pol'] && key === 'pol') ? f['z2Pol']
                 : (f['z2Pod'] && key === 'pod') ? f['z2Pod']
                 : (f['z2Carrier'] && key === 'carrier') ? f['z2Carrier'] : '';
    if (single) return single.trim();
    try {
      const rts = JSON.parse(f['z2-routes-data'] || '[]');
      if (Array.isArray(rts) && rts.length) {
        return rts.map(r => r[key]).filter(Boolean).join(', ');
      }
    } catch (e) {}
    return '';
  }

  // 分析用の案件リストを構築（source: 'both'|'local'|'cloud'）
  function _caseList(source) {
    const cases = [];
    if (source !== 'cloud') {
      _getLocalPresets().forEach(p => {
        const f = (p.data || {}).fields || {};
        cases.push({
          name: p.name || '（名称なし）', src: 'local',
          status:   (f['qf-status']   || '').trim(),
          customer: (f['qf-customer'] || '').trim(),
          mode:     (f['cond-mode']   || '').trim(),
          pol:      _routeFromFields(f, 'pol'),
          pod:      _routeFromFields(f, 'pod'),
          carrier:  _routeFromFields(f, 'carrier'),
          ts:       p.ts || null,
          fin:      _caseFinancials((p.data || {}).rows),
        });
      });
    }
    if (source !== 'local') {
      const cloud = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
      cloud.forEach(p => {
        cases.push({
          name: p.name || '（名称なし）', src: 'cloud',
          status:   (p.status         || '').trim(),
          customer: (p.customer       || '').trim(),
          mode:     (p.transport_mode || '').trim(),
          pol:      (p.pol            || '').trim(),
          pod:      (p.pod            || '').trim(),
          carrier:  (p.carrier        || '').trim(),
          ts:       p.updated_at || null,
          fin:      _caseFinancials((p.data || {}).rows),
        });
      });
    }
    return cases;
  }

  const _MODE_LABEL = { 'sea-fcl':'海上 FCL', 'sea-lcl':'海上 LCL', 'fcl':'FCL', 'lcl':'LCL', 'air':'航空', 'sea':'海上', 'rail':'鉄道', 'truck':'トラック' };
  const _STATUS_ORDER = ['下書き中', '提出済み', '提示済み', 'ヨコヨコ提示', '受注', '失注', '辞退', '保留'];

  // 横棒ランキング HTML（[{label,count}] と最大値から生成）
  function _barRows(items, max, opt) {
    opt = opt || {};
    if (!items.length) return '<p class="stats-empty">データなし</p>';
    return '<div class="sd-bars">' + items.map(it => {
      const pct = max > 0 ? Math.max(2, Math.round(it.count / max * 100)) : 0;
      const cls = it.cls ? ' ' + it.cls : '';
      return `<div class="sd-bar-row">` +
             `<span class="sd-bar-label" title="${_esc(it.label)}">${_esc(it.label)}</span>` +
             `<span class="sd-bar-track"><span class="sd-bar-fill${cls}" style="width:${pct}%"></span></span>` +
             `<span class="sd-bar-val">${_esc(it.valText != null ? it.valText : String(it.count))}</span>` +
             `</div>`;
    }).join('') + '</div>';
  }

  function _kpi(value, label, cls) {
    return `<div class="sd-kpi${cls ? ' ' + cls : ''}"><div class="sd-kpi-val">${_esc(value)}</div><div class="sd-kpi-label">${_esc(label)}</div></div>`;
  }

  function _renderDashboard() {
    const e = document.getElementById('statsPane-dashboard');
    if (!e) return;
    const source = document.getElementById('statsSource')?.value || 'both';
    const cases  = _caseList(source);
    if (!cases.length) {
      e.innerHTML = '<p class="stats-empty">案件がありません。<br><small>見積を保存すると、ここに受注率・粗利・航路傾向が集計されます。</small></p>';
      return;
    }

    // --- A. 受注ステータス ---
    const stCount = {};
    cases.forEach(c => { const s = c.status || '（未設定）'; stCount[s] = (stCount[s] || 0) + 1; });
    const won  = stCount['受注'] || 0;
    const lost = stCount['失注'] || 0;
    const decided  = won + lost;
    const winRate  = decided > 0 ? Math.round(won / decided * 100) : null;
    const stItems = Object.keys(stCount)
      .sort((a, b) => {
        const ia = _STATUS_ORDER.indexOf(a), ib = _STATUS_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .map(s => ({ label: s, count: stCount[s], cls: 'sd-bar--st-' + _stCls(s) }));
    const stMax = Math.max(...stItems.map(i => i.count));
    const sectionA =
      '<section class="sd-section"><h3 class="sd-h">📊 受注ステータス</h3>' +
      '<div class="sd-kpis">' +
        _kpi(cases.length, '総案件') +
        _kpi(won,  '受注', 'sd-kpi--won') +
        _kpi(lost, '失注', 'sd-kpi--lost') +
        _kpi(winRate == null ? '—' : winRate + '%', '受注率（決着ベース）', 'sd-kpi--rate') +
      '</div>' + _barRows(stItems, stMax) + '</section>';

    // --- B. 金額・粗利 ---
    const finCases = cases.filter(c => c.fin);
    let totBill = 0, totCost = 0;
    finCases.forEach(c => { totBill += c.fin.bill; totCost += c.fin.cost; });
    const totMargin = (window.SharedCalc && totBill > 0) ? SharedCalc.grossMarginPct(totBill, totCost) : null;
    // お客様別集計
    const custMap = new Map();
    finCases.forEach(c => {
      const k = c.customer || '（未入力）';
      if (!custMap.has(k)) custMap.set(k, { customer: k, count: 0, bill: 0, cost: 0 });
      const g = custMap.get(k); g.count++; g.bill += c.fin.bill; g.cost += c.fin.cost;
    });
    const custRows = [...custMap.values()].sort((a, b) => b.bill - a.bill).slice(0, 15);
    let custTable;
    if (!finCases.length) {
      custTable = '<p class="stats-empty">単価が入力された案件がありません。<br><small>明細に仕入・売単価を入れて保存すると粗利が集計されます。</small></p>';
    } else {
      custTable = '<table class="stats-table sd-money-table"><thead><tr>' +
        '<th>お客様</th><th class="stats-num-col">件数</th><th class="stats-num-col">売上合計</th><th class="stats-num-col">粗利率</th>' +
        '</tr></thead><tbody>' +
        custRows.map(g => {
          const m = (window.SharedCalc && g.bill > 0) ? SharedCalc.grossMarginPct(g.bill, g.cost) : null;
          const mCls = m == null ? '' : (m >= 0 ? 'sd-margin-pos' : 'sd-margin-neg');
          return `<tr><td class="stats-val">${_esc(g.customer)}</td>` +
                 `<td class="stats-num-col">${g.count}</td>` +
                 `<td class="stats-num-col">${_jpy(g.bill)}</td>` +
                 `<td class="stats-num-col ${mCls}">${m == null ? '—' : m.toFixed(1) + '%'}</td></tr>`;
        }).join('') + '</tbody></table>';
    }
    const mTotCls = totMargin == null ? '' : (totMargin >= 0 ? 'sd-kpi--won' : 'sd-kpi--lost');
    const sectionB =
      '<section class="sd-section"><h3 class="sd-h">💴 金額・粗利 <small class="sd-note">JPY換算・単価入力ありの案件のみ</small></h3>' +
      '<div class="sd-kpis">' +
        _kpi(_jpy(totBill), '総売上') +
        _kpi(_jpy(totCost), '総仕入') +
        _kpi(totMargin == null ? '—' : totMargin.toFixed(1) + '%', '平均粗利率', mTotCls) +
      '</div>' + custTable + '</section>';

    // --- C. 月次推移 ---
    const monMap = new Map();
    cases.forEach(c => {
      if (!c.ts) return;
      const m = String(c.ts).slice(0, 7);   // YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(m)) return;
      if (!monMap.has(m)) monMap.set(m, { month: m, total: 0, won: 0 });
      const g = monMap.get(m); g.total++; if (c.status === '受注') g.won++;
    });
    const months = [...monMap.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
    const monMax = months.length ? Math.max(...months.map(m => m.total)) : 0;
    let monHtml;
    if (!months.length) {
      monHtml = '<p class="stats-empty">日付情報のある案件がありません。</p>';
    } else {
      monHtml = '<div class="sd-bars sd-bars--month">' + months.map(m => {
        const pct = monMax > 0 ? Math.max(2, Math.round(m.total / monMax * 100)) : 0;
        const wpct = m.total > 0 ? Math.round(m.won / m.total * 100) : 0;
        const label = m.month.slice(2).replace('-', '/');   // YY/MM
        return `<div class="sd-bar-row">` +
               `<span class="sd-bar-label">${_esc(label)}</span>` +
               `<span class="sd-bar-track"><span class="sd-bar-fill sd-bar--month" style="width:${pct}%">` +
               `<span class="sd-bar-won" style="width:${wpct}%"></span></span></span>` +
               `<span class="sd-bar-val">${m.total}件${m.won ? ' / 受注' + m.won : ''}</span>` +
               `</div>`;
      }).join('') + '</div>';
    }
    const sectionC =
      '<section class="sd-section"><h3 class="sd-h">📅 月次推移 <small class="sd-note">直近12ヶ月・濃色＝受注</small></h3>' + monHtml + '</section>';

    // --- D. 貨物・航路傾向 ---
    const freq = (arr) => {
      const m = new Map();
      arr.filter(Boolean).forEach(v => m.set(v, (m.get(v) || 0) + 1));
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    };
    const modeItems = freq(cases.map(c => c.mode))
      .map(i => ({ label: _MODE_LABEL[i.value] || i.value, count: i.count }));
    const routeItems = freq(cases.map(c => (c.pol || c.pod) ? `${c.pol || '?'} → ${c.pod || '?'}` : ''))
      .slice(0, 8).map(i => ({ label: i.value, count: i.count }));
    const carrierItems = freq(cases.map(c => c.carrier)).slice(0, 8)
      .map(i => ({ label: i.value, count: i.count }));
    const sectionD =
      '<section class="sd-section"><h3 class="sd-h">🚢 貨物・航路傾向</h3>' +
      '<div class="sd-trend-grid">' +
        `<div class="sd-trend-col"><h4 class="sd-h4">輸送モード</h4>${_barRows(modeItems, Math.max(...modeItems.map(i => i.count), 0))}</div>` +
        `<div class="sd-trend-col"><h4 class="sd-h4">航路 (POL→POD) 上位8</h4>${_barRows(routeItems, Math.max(...routeItems.map(i => i.count), 0))}</div>` +
        `<div class="sd-trend-col"><h4 class="sd-h4">キャリア 上位8</h4>${_barRows(carrierItems, Math.max(...carrierItems.map(i => i.count), 0))}</div>` +
      '</div></section>';

    e.innerHTML = '<div class="sd-wrap">' + sectionA + sectionB + sectionC + sectionD + '</div>';
  }
  window.statsRefreshDashboard = _renderDashboard;

  function _renderCustomer() {
    const e = document.getElementById('statsPane-customer');
    if (!e) return;
    const source = document.getElementById('statsSource')?.value || 'both';
    const metas = [];
    if (source !== 'cloud') {
      _getLocalPresets().forEach(p => {
        const f = (p.data || {}).fields || {};
        metas.push({
          customer: (f['qf-customer'] || '').trim(),
          person:   (f['qf-person']   || '').trim(),
          status:   (f['qf-status']   || '').trim(),
        });
      });
    }
    if (source !== 'local') {
      const cloud = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
      cloud.forEach(p => {
        metas.push({
          customer: (p.customer || '').trim(),
          person:   (p.person   || '').trim(),
          status:   (p.status   || '').trim(),
        });
      });
    }
    if (!metas.length) { e.innerHTML = '<p class="stats-empty">データなし</p>'; return; }

    const map = new Map();
    metas.forEach(m => {
      const key = m.customer || '';
      if (!map.has(key)) map.set(key, { customer: key, count: 0, persons: new Set(), statuses: [] });
      const g = map.get(key);
      g.count++;
      if (m.person) g.persons.add(m.person);
      if (m.status) g.statuses.push(m.status);
    });
    const groups = [...map.values()].sort((a, b) => b.count - a.count);

    // ゆらぎグループ化（表記ゆれを検出）
    const custExcl = new Set(
      (typeof window.arGetExclusions === 'function' ? window.arGetExclusions() : [])
        .filter(e => e.field === 'customer').map(e => e.value)
    );
    const custNames = groups.map(g => g.customer).filter(Boolean);
    const custGroups = _groupSimilar(custNames, custExcl, 'customer');
    // 正規化キー → グループ先頭名のマップ（ゆらぎバッジ用）
    const normToCanon = new Map();
    custGroups.forEach(cg => {
      if (cg.variants.length > 1) normToCanon.set(_normalize(cg.variants[0].value), cg);
    });

    // 同義グループ状態（手動・⭐代表／統合）
    const synGroups  = typeof window.synGetGroups === 'function' ? window.synGetGroups('customer') : [];
    const synCanons  = new Set(synGroups.map(g => g.canonical));
    const synAliasOf = {};
    synGroups.forEach(g => (g.aliases || []).forEach(a => { synAliasOf[a] = g.canonical; }));
    const synCntMap = {};
    groups.forEach(g => { if (g.customer) synCntMap[g.customer] = g.count; });

    // 同義グループに取り込まれた顧客名・顧客名→集計のルックアップ
    const custByName = new Map();
    groups.forEach(g => { if (g.customer) custByName.set(g.customer, g); });
    const consumed = new Set();
    synGroups.forEach(g => { consumed.add(g.canonical); (g.aliases || []).forEach(a => consumed.add(a)); });
    const _stHtml = (statuses) => {
      const stMap = {};
      statuses.forEach(s => { stMap[s] = (stMap[s] || 0) + 1; });
      return Object.entries(stMap).length
        ? Object.entries(stMap).sort((a, b) => b[1] - a[1])
            .map(([s, n]) => `<span class="stats-st-chip stats-st--${_stCls(s)}">${_esc(s)} ${n}</span>`).join('')
        : '—';
    };

    const _renderedCustGroups = {};
    let gIdx = 0;
    let h = _sortToolbar() +
            '<p class="stats-syn-hint">☆代表 で同義グループの基準を決め、他の表記を ⤵統合 でまとめると、⭐行に集約され件数・担当者・ステータスが合算されます（非破壊）。</p>' +
            '<table class="stats-table"><thead><tr>' +
            '<th>お客様名</th><th class="stats-num-col">件数</th><th>担当者</th><th>ステータス</th><th>操作</th>' +
            '</tr></thead><tbody>';

    // --- 同義グループ（統合表示・合計件数降順）---
    const synRows = synGroups.map(g => {
      const members = [g.canonical, ...(g.aliases || [])];
      let count = 0; const persons = new Set(); const statuses = []; const memberCounts = {};
      members.forEach(m => {
        const mg = custByName.get(m);
        memberCounts[m] = mg ? mg.count : 0;
        if (mg) { count += mg.count; mg.persons.forEach(p => persons.add(p)); statuses.push(...mg.statuses); }
      });
      return { g, members, count, persons, statuses, memberCounts };
    });
    synRows.sort((a, b) => _statsSort === 'name' ? _cmpName(a.g.canonical, b.g.canonical) : b.count - a.count);

    synRows.forEach(sr => {
      const memberChips = sr.members.map((m, i) =>
        `<span class="stats-chip${i === 0 ? ' stats-chip--canon' : ''}">` +
        `<span class="stats-chip-text">${i === 0 ? '⭐ ' : ''}${_esc(m)}</span>` +
        `<span class="stats-chip-cnt">×${sr.memberCounts[m] || 0}</span>` +
        (i === 0 ? _voteBtn('customer', m)
                 : `<button class="stats-syn-unmerge" onclick="statsSynUnmerge('customer','${_ea(m)}')" title="統合を解除">✕</button>`) +
        `</span>`
      ).join('');
      h += `<tr class="stats-syn-row">` +
           `<td class="stats-val"><span class="ua-star">⭐</span>${_esc(sr.g.canonical)} <span class="stats-syn-grp-badge" title="同義グループ（${sr.members.length}種を集約）">同義 ${sr.members.length}種</span></td>` +
           `<td class="stats-num-col">${sr.count}</td>` +
           `<td>${[...sr.persons].join('、') || '—'}</td>` +
           `<td>${_stHtml(sr.statuses)}</td>` +
           `<td class="stats-chips-cell">${memberChips}` +
             `<button class="stats-syn-dissolve" onclick="statsToggleSynCanonical('customer','${_ea(sr.g.canonical)}')" title="同義グループを解除">グループ解除</button></td>` +
           `</tr>`;
    });

    // --- 残りのお客様（自動ゆらぎ検出は従来表示）---
    const restCust = _statsSort === 'name'
      ? [...groups].sort((a, b) => _cmpName(a.customer, b.customer))
      : groups;
    restCust.forEach(g => {
      if (g.customer && consumed.has(g.customer)) return;   // 同義グループに集約済み
      const persons = [...g.persons].join('、') || '—';
      const stHtml = _stHtml(g.statuses);

      // ゆらぎバッジ（同じ正規化キーに複数表記がある場合）
      const cg = g.customer ? normToCanon.get(_normalize(g.customer)) : null;
      let variantBadge = '';
      if (cg && cg.variants.length > 1 && cg.variants[0].value === g.customer) {
        const gId = 'statsPane-customer-' + gIdx;
        _renderedCustGroups[gId] = { aliasField: 'customer', variants: cg.variants };
        _renderedGroups[gId] = { aliasField: 'customer', variants: cg.variants };
        variantBadge = cg.isAbbrevGroup
          ? ` <span class="stats-variant-badge stats-variant-badge--abbrev" title="略称辞書で関連付けられた表記">略称 ${cg.variants.length}種</span>`
          : ` <button class="stats-variant-badge stats-variant-badge--link" onclick="statsJumpToAlias('${gId}')" title="エイリアス是正タブで一括登録">ゆらぎ ${cg.variants.length}種</button>`;
        gIdx++;
      }

      const nameCell = g.customer
        ? `${_esc(g.customer)}${variantBadge}`
        : '<span class="stats-empty-cell">（未入力）</span>';
      const opCell = g.customer
        ? _voteBtn('customer', g.customer) + _synBtns('customer', g.customer, synCanons, synAliasOf, synCntMap)
        : '';
      h += `<tr>` +
           `<td class="stats-val">${nameCell}</td>` +
           `<td class="stats-num-col">${g.count}</td>` +
           `<td>${_esc(persons)}</td>` +
           `<td>${stHtml}</td>` +
           `<td class="stats-chips-cell">${opCell}</td>` +
           `</tr>`;
    });
    e.innerHTML = h + '</tbody></table>';
  }

  function _renderMaster() {
    const e = document.getElementById('statsPane-master');
    if (!e) return;

    const cloudOn = _cloud() && _cvMap !== null;
    let entries = [];
    if (cloudOn) {
      _cvMap.forEach(({ total, isMine }, key) => {
        if (total < 1) return;
        const sep = key.indexOf('\x00');
        const field = key.substring(0, sep);
        const value = key.substring(sep + 1);
        entries.push({ field, value, votes: total, isMine, promoted: true });
      });
    } else {
      entries = _getMasters().map(m => ({ ...m, isMine: true, promoted: true }));
    }
    const labels = { sv: 'サブコン', nm: '品名', un: '単位', customer: 'お客様', port: '港' };

    // --- 代表を新規登録するフォーム（実データに無い名称も登録可）---
    const fieldOpts = [['sv', 'サブコン'], ['nm', '品名'], ['customer', 'お客様'], ['port', '港'], ['un', '単位']]
      .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    const formH = '<div class="master-new-form">' +
      '<span class="master-new-label">➕ 代表を新規登録</span>' +
      `<select id="masterNewField" class="ar-select">${fieldOpts}</select>` +
      '<input id="masterNewValue" class="ar-input" type="text" placeholder="代表名称（例: ABC Corporation Ltd.）" onkeydown="if(event.key===\'Enter\')statsMasterAddCanonical()" />' +
      '<button class="master-new-btn" onclick="statsMasterAddCanonical()">登録</button>' +
      '<span class="master-new-hint">実際の入力値に無い名称でも登録できます。登録後、集計タブの ⤵統合 で表記を束ねられます。</span>' +
      '</div>';

    // --- 同義グループ一覧（sv/nm/customer/port は syn*、un は ua* から集約）---
    const synGroups = (typeof window.synGetGroups === 'function' ? window.synGetGroups() : []).slice();
    const unitGroups = (typeof window.uaGetGroups === 'function' ? window.uaGetGroups() : [])
      .map(g => ({ field: 'un', canonical: g.canonical, aliases: g.aliases || [] }));
    const allSyn = [...synGroups, ...unitGroups]
      .sort((a, b) => (labels[a.field] || a.field).localeCompare(labels[b.field] || b.field) || (a.canonical || '').localeCompare(b.canonical || ''));
    // 統合（A案）: 代表(canonical)は自動的にマスター扱い。個別マスター表からは除外し、
    // 下の「同義グループ（代表＝マスター）」欄に集約表示する（二重表示を避ける）。
    const synCanonSet = new Set(allSyn.map(g => g.field + '\x00' + g.canonical));
    entries = entries.filter(m => !synCanonSet.has(m.field + '\x00' + m.value));
    let synH = '';
    if (allSyn.length) {
      synH = '<div class="stats-syn-section"><p class="stats-master-info-title">⭐ 同義グループ（代表＝マスター）</p>' +
        `<p class="stats-master-info-note">⭐代表は自動的にマスター登録され、統合した別名はマスターから外れます。集計タブの ☆代表 / ⤵統合 で作成。件数は合算され入力補完にも反映されます。${cloudOn ? '（チーム共有）' : '（このブラウザに保存）'}</p>` +
        '<table class="stats-table"><thead><tr><th>種別</th><th>代表（マスター）</th><th>統合された表記</th><th>操作</th></tr></thead><tbody>';
      allSyn.forEach(g => {
        const isUnit  = g.field === 'un';
        const aliases = g.aliases || [];
        const delAlias = (a) => isUnit
          ? `statsUnitRemoveAlias('${_ea(a)}','${_ea(g.canonical)}')`
          : `synRemoveAlias('${_ea(g.field)}','${_ea(a)}','${_ea(g.canonical)}')`;
        const delGroup = isUnit
          ? `statsUnitRemoveGroup('${_ea(g.canonical)}')`
          : `synRemoveGroup('${_ea(g.field)}','${_ea(g.canonical)}')`;
        const chips = aliases.length
          ? aliases.map(a => `<span class="stats-syn-member">${_esc(a)}<button class="ua-chip-del" title="統合解除" onclick="${delAlias(a)}">✕</button></span>`).join('')
          : '<span class="stats-empty-cell">—</span>';
        synH += `<tr><td>${labels[g.field] || g.field}</td>` +
                `<td class="stats-val"><span class="ua-star">⭐</span>${_esc(g.canonical)}</td>` +
                `<td>${chips}</td>` +
                `<td><button class="stats-master-rename" title="代表名を変更（旧名称は別名として残ります）" onclick="statsMasterRename('${_ea(g.field)}','${_ea(g.canonical)}')">✏️ 名称変更</button>` +
                `<button class="ua-remove-canon" title="グループを解除" onclick="${delGroup}">解除</button></td></tr>`;
      });
      synH += '</tbody></table></div>';
    }

    if (!entries.length) {
      const note = allSyn.length
        ? '<p class="stats-empty">個別マスターはありません（同義グループの代表が下に「マスター」として表示されています）。</p>'
        : '<p class="stats-empty">マスター登録はまだありません。<br>各集計の ☆登録（個別）または ⭐代表（同義グループ）で追加できます。</p>';
      e.innerHTML = formH + note + synH;
      return;
    }
    const usageDesc = {
      sv:       '見積行のサブコン欄で入力補完候補に表示されます。',
      nm:       '見積行の品名欄で入力補完候補に表示されます。',
      un:       '見積行の単位欄で入力補完候補に表示されます。',
      customer: 'お客様名欄で入力補完候補に表示されます。',
      port:     'POL / POD / Via 港欄で入力補完候補に表示されます。',
    };
    const sorted = entries.sort((a, b) => (labels[a.field] || a.field).localeCompare(labels[b.field] || b.field) || (a.value || '').localeCompare(b.value || ''));
    const abbrevPairs = (typeof window.arGetAbbrevPairs === 'function') ? window.arGetAbbrevPairs() : [];
    let h = '<div class="stats-master-info">' +
            '<p class="stats-master-info-title">✅ 個別マスター（同義グループに属さない表記）の活用方法</p>' +
            '<ul class="stats-master-usage-list">' +
            Object.entries(usageDesc).map(([f, desc]) =>
              `<li><b>${labels[f] || f}</b>：${desc}</li>`).join('') +
            '<li><b>エイリアス是正</b>：表記ゆれを一括置換する際の「正規形」の候補として参照できます。</li>' +
            '</ul>' +
            `<p class="stats-master-info-note">☆ 登録 ボタンで即時マスターに追加。再クリックで解除できます。${cloudOn ? '（チーム全員で共有）' : '（このブラウザにローカル保存）'}</p>` +
            '</div>' +
            '<table class="stats-table"><thead><tr>' +
            '<th>種別</th><th>名称</th><th>略称</th><th></th>' +
            '</tr></thead><tbody>';
    sorted.forEach(m => {
      const pair = abbrevPairs.find(p => p.field === m.field && (p.full === m.value || p.abbrev === m.value));
      let abbrevCell;
      if (pair) {
        const abbrevDisplay = pair.full === m.value ? pair.abbrev : pair.full;
        abbrevCell = `<span class="stats-master-abbrev-chip">${_esc(abbrevDisplay)}</span>` +
                     `<button class="stats-master-abbrev-del" title="略称を削除" onclick="arDeleteAbbrevPair('${_ea(String(pair.id))}')">✕</button>`;
      } else {
        abbrevCell = `<button class="stats-master-abbrev-add" onclick="statsMasterAddAbbrev('${_ea(m.field)}','${_ea(m.value)}')">＋ 略称</button>`;
      }
      h += `<tr>` +
           `<td>${labels[m.field] || m.field}</td>` +
           `<td class="stats-val">${_esc(m.value)}</td>` +
           `<td class="stats-master-abbrev-cell">${abbrevCell}</td>` +
           `<td>${m.isMine ? `<button class="stats-demote-btn" onclick="statsToggleVote('${_ea(m.field)}','${_ea(m.value)}')">解除</button>` : '<span class="stats-empty-cell">他メンバー</span>'}</td>` +
           `</tr>`;
    });
    e.innerHTML = formH + h + '</tbody></table>' + synH;
  }

  // マスタータブから単位同義グループを操作した際、マスター画面も再描画する薄いラッパ
  window.statsUnitRemoveGroup = function (canonical) {
    if (typeof window.uaRemoveGroup === 'function') window.uaRemoveGroup(canonical);
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
  };
  window.statsUnitRemoveAlias = function (alias, canonical) {
    if (typeof window.uaRemoveAlias === 'function') window.uaRemoveAlias(alias, canonical);
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
  };

  // マスター管理: 代表を新規登録（実データに無い名称も可）
  window.statsMasterAddCanonical = async function () {
    const fSel = document.getElementById('masterNewField');
    const inp  = document.getElementById('masterNewValue');
    if (!fSel || !inp) return;
    const field = fSel.value;
    const value = (inp.value || '').trim();
    if (!value) { if (typeof window.quoteShowToast === 'function') window.quoteShowToast('代表名称を入力してください', 'warn'); return; }
    if (field === 'un') {
      if (typeof window.uaSetCanonical === 'function') window.uaSetCanonical(value);
    } else if (typeof window.synSetCanonical === 'function') {
      await window.synSetCanonical(field, value);
    }
    inp.value = '';
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
  };
  // マスター管理: 代表名を編集（リネーム）。旧名称は別名として残る
  window.statsMasterRename = async function (field, canonical) {
    const nv = window.prompt('新しい代表名を入力してください。\n（旧名称「' + canonical + '」は別名としてグループに残ります）', canonical);
    if (nv == null) return;
    const v = nv.trim();
    if (!v || v === canonical) return;
    if (field === 'un') {
      if (typeof window.uaRenameCanonical === 'function') window.uaRenameCanonical(canonical, v);
    } else if (typeof window.synRenameCanonical === 'function') {
      await window.synRenameCanonical(field, canonical, v);
    }
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
  };

  function _renderAlias() {
    if (typeof window.arRenderPane === 'function') window.arRenderPane();
    else { const el = document.getElementById('statsPane-alias'); if (el) el.innerHTML = '<p class="stats-empty">alias-rules.js が読み込まれていません。</p>'; }
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
    // ゆらぎ件数 = バリアントが2種以上のグループ数の合計
    const blur = [..._data.svGroups, ..._data.carrierGroups, ..._data.nmGroups, ..._data.unGroups]
      .filter(g => g.variants.length > 1).length;
    set('statsBlurCount', blur);
    // マスター候補数
    const masterCount = _cloud() && _cvMap ? _cvMap.size : _getMasters().length;
    set('statsMasterCount', masterCount);
  }

  // ===== KPI ペイン =====

  function _extractRowsWithPrice(preset) {
    const d = preset.data || {};
    if (!Array.isArray(d.rows)) return [];
    return d.rows
      .filter(r => r && r._type === 'data')
      .map(r => {
        const c = Array.isArray(r.cells) ? r.cells : [];
        return {
          cat: (c[CI.cat] || '').trim(),
          sv:  (c[CI.sv]  || '').trim(),
          nm:  (c[CI.nm]  || '').replace(/^\*+/, '').trim(),
          un:  (c[CI.un]  || '').trim(),
          pp:  parseFloat(c[CI.pp]) || null,
          bp:  parseFloat(c[CI.bp]) || null,
          pc:  (c[CI.pc]  || 'JPY').trim(),
        };
      })
      .filter(r => r.sv || r.nm);
  }

  function _renderKpi() {
    const e = document.getElementById('statsPane-kpi');
    if (!e) return;

    const metas = [];
    const source = document.getElementById('statsSource')?.value || 'both';
    if (source !== 'cloud') {
      _getLocalPresets().forEach(p => {
        const f = (p.data || {}).fields || {};
        metas.push({
          person:  (f['qf-person']   || '').trim(),
          status:  (f['qf-status']   || '').trim(),
          rows:    _extractRowsWithPrice(p),
        });
      });
    }
    if (source !== 'local') {
      const cloud = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
      cloud.forEach(p => {
        metas.push({
          person:  (p.person   || '').trim(),
          status:  (p.status   || '').trim(),
          rows:    _extractRowsWithPrice(p),
        });
      });
    }

    if (!metas.length) { e.innerHTML = '<p class="stats-empty">案件データがありません。</p>'; return; }

    // 全体KPI
    const won    = metas.filter(m => m.status === '受注').length;
    const lost   = metas.filter(m => m.status === '失注').length;
    const sent   = metas.filter(m => ['提示済み','提出済み','受注','失注'].includes(m.status)).length;
    const winRate = sent ? Math.round(won / sent * 100) : null;

    // 担当者別KPI
    const personMap = {};
    metas.forEach(m => {
      const k = m.person || '（未入力）';
      if (!personMap[k]) personMap[k] = { total: 0, won: 0, lost: 0, sent: 0 };
      personMap[k].total++;
      if (['提示済み','提出済み','受注','失注'].includes(m.status)) personMap[k].sent++;
      if (m.status === '受注') personMap[k].won++;
      if (m.status === '失注') personMap[k].lost++;
    });
    const persons = Object.entries(personMap).sort((a, b) => b[1].total - a[1].total);

    const kpiCards = [
      { label: '総案件数',     value: metas.length },
      { label: '受注数',       value: won },
      { label: '失注数',       value: lost },
      { label: '受注率',       value: winRate !== null ? winRate + '%' : '—' },
    ];

    let h = '<div class="stats-kpi-cards">' +
      kpiCards.map(k => `<div class="stats-kpi-card"><div class="stats-kpi-value">${_esc(String(k.value))}</div><div class="stats-kpi-label">${_esc(k.label)}</div></div>`).join('') +
      '</div>';

    h += '<h3 class="stats-kpi-section-title">担当者別成績</h3>';
    h += '<table class="stats-table"><thead><tr><th>担当者</th><th class="stats-num-col">総件数</th><th class="stats-num-col">提示済</th><th class="stats-num-col">受注</th><th class="stats-num-col">失注</th><th class="stats-num-col">受注率</th></tr></thead><tbody>';
    persons.forEach(([person, d]) => {
      const wr = d.sent ? Math.round(d.won / d.sent * 100) + '%' : '—';
      const barW = d.sent ? Math.round(d.won / d.sent * 100) : 0;
      h += `<tr>` +
        `<td class="stats-val">${_esc(person)}</td>` +
        `<td class="stats-num-col">${d.total}</td>` +
        `<td class="stats-num-col">${d.sent}</td>` +
        `<td class="stats-num-col">${d.won}</td>` +
        `<td class="stats-num-col">${d.lost}</td>` +
        `<td class="stats-num-col"><div class="stats-bar-wrap"><div class="stats-bar" style="width:${barW}%"></div><span class="stats-bar-label">${_esc(wr)}</span></div></td>` +
        `</tr>`;
    });
    h += '</tbody></table>';
    e.innerHTML = h;
  }

  function _renderActivePane() {
    const active = document.querySelector('#tab-stats .stats-pane.is-active');
    if (!active) return;
    const id = active.id.replace('statsPane-', '');
    if      (id === 'dashboard') _renderDashboard();
    else if (id === 'sv')       _renderSv();
    else if (id === 'carrier')  _renderCarrier();
    else if (id === 'port')     _renderPort();
    else if (id === 'customer') _renderCustomer();
    else if (id === 'nm')       _renderNm();
    else if (id === 'un')       _renderUn();
    else if (id === 'svport')   _renderSvPort();
    else if (id === 'charges')  _renderCharges();
    else if (id === 'master')   _renderMaster();
    else if (id === 'alias')    _renderAlias();
    else if (id === 'kpi')      _renderKpi();
  }

  // === サブタブ切替 ===

  function statsSetPane(paneId) {
    document.querySelectorAll('#tab-stats .stats-tab-btn').forEach(b => {
      b.classList.remove('is-active');
      b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('#tab-stats .stats-pane').forEach(p => p.classList.remove('is-active'));
    const activeBtn = document.getElementById('statsTabBtn-' + paneId);
    if (activeBtn) { activeBtn.classList.add('is-active'); activeBtn.setAttribute('aria-selected', 'true'); }
    document.getElementById('statsPane-'   + paneId)?.classList.add('is-active');
    if (!_data) { _data = _build(document.getElementById('statsSource')?.value || 'both'); _updateSummary(); }
    if      (paneId === 'dashboard') _renderDashboard();
    else if (paneId === 'sv')       _renderSv();
    else if (paneId === 'carrier')  _renderCarrier();
    else if (paneId === 'port')     _renderPort();
    else if (paneId === 'customer') _renderCustomer();
    else if (paneId === 'nm')       _renderNm();
    else if (paneId === 'un')       _renderUn();
    else if (paneId === 'svport')   _renderSvPort();
    else if (paneId === 'charges')  _renderCharges();
    else if (paneId === 'master')   _renderMaster();
    else if (paneId === 'alias')    _renderAlias();
    else if (paneId === 'kpi')      _renderKpi();
  }

  // === パブリック API ===

  window.initStatsTab = async function () {
    _data  = null;
    _cvMap = null;
    const source = document.getElementById('statsSource')?.value || 'both';
    if (source !== 'local' && _cloud() && typeof window.cloudListPresets === 'function') {
      await window.cloudListPresets(true);
    }
    _data  = _build(source);
    _updateSummary();
    _renderCloud();
    statsSetPane('dashboard');
    if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
    if (_cloud()) {
      await _loadCloudVotes();
      if (typeof window.synLoadCloud === 'function') await window.synLoadCloud();
      _renderCloud();
      _renderActivePane();
    }
  };

  window.statsSetPane = statsSetPane;

  // 昇格済みマスターを全フィールド分まとめて返す（alias-rules.js の datalist 補完用）
  window.statsGetMasters = function () {
    const cloudOn = _cloud() && _cvMap !== null;
    if (cloudOn) {
      const res = [];
      _cvMap.forEach(({ total }, key) => {
        if (total >= 1) {
          const sep = key.indexOf('\x00');
          const field = key.substring(0, sep);
          const value = key.substring(sep + 1);
          res.push({ field, value });
        }
      });
      return res;
    }
    return _getMasters().filter(m => (m.votes || 0) >= 1).map(m => ({ field: m.field, value: m.value }));
  };

  window.statsRefresh = async function () {
    const btn = document.querySelector('.stats-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⌛ 更新中…'; }
    try {
      _data  = null;
      _cvMap = null;
      const source = document.getElementById('statsSource')?.value || 'both';
      if (source !== 'local' && _cloud() && typeof window.cloudListPresets === 'function') {
        await window.cloudListPresets(true);
      }
      _data  = _build(source);
      _updateSummary();
      _renderCloud();
      if (_cloud()) { await _loadCloudVotes(); if (typeof window.synLoadCloud === 'function') await window.synLoadCloud(); }
      _renderCloud();
      _renderActivePane();
      if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 集計'; }
    }
  };

  window.statsToggleVote = async function (field, value) {
    const wasVoted = _voteInfo(field, value).isMine;
    try {
      if (wasVoted) await _demote(field, value);
      else          await _promote(field, value);
    } catch (err) {
      console.error('[statsToggleVote] promote/demote failed:', err);
      if (typeof window.quoteShowToast === 'function') window.quoteShowToast('マスター登録に失敗しました: ' + err.message);
      return;
    }
    try {
      _renderActivePane();
      _renderMaster();
      if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
    } catch (err) {
      console.error('[statsToggleVote] render failed:', err);
    }
    const isCloud = _cloud();
    const actionMsg = wasVoted ? '⭐ マスター登録を解除しました' : `⭐ マスターに登録しました（${isCloud ? 'クラウド' : 'ローカル'}）`;
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast(actionMsg);
  };

  // 後方互換
  window.statsPromote = async function (f, v) { await _promote(f, v); _renderActivePane(); };
  window.statsDemote  = async function (f, v) { await _demote(f, v);  _renderMaster(); };

  // 統合（A案）: 同義グループの代表設定/統合から呼ぶ冪等ヘルパー。
  // 代表は自動マスター化、別名はマスター解除（自分の票のみ操作）。
  window.statsEnsureMaster = async function (field, value) {
    try { if (!_voteInfo(field, value).isMine) await _promote(field, value); }
    catch (err) { console.error('[statsEnsureMaster]', err); }
  };
  window.statsEnsureNotMaster = async function (field, value) {
    try { if (_voteInfo(field, value).isMine) await _demote(field, value); }
    catch (err) { console.error('[statsEnsureNotMaster]', err); }
  };

  window.statsMasterAddAbbrev = function (field, value) {
    const labels = { sv: 'サブコン', nm: '品名', un: '単位', customer: 'お客様', port: '港' };
    const safeId = 'abbrev-inline-' + Math.random().toString(36).slice(2, 7);
    // 既存の「＋ 略称」ボタンを入力フォームに置換
    const btn = document.querySelector(`.stats-master-abbrev-add[onclick*="${_ea(value)}"]`);
    if (!btn) return;
    const cell = btn.parentElement;
    cell.innerHTML = `<span class="stats-abbrev-inline-form">` +
      `<input id="${safeId}" class="stats-abbrev-input" type="text" placeholder="略称を入力（${labels[field] || field}）" maxlength="30" autofocus>` +
      `<button class="stats-abbrev-ok" onclick="statsMasterAddAbbrevCommit('${_ea(field)}','${_ea(value)}','${safeId}')">追加</button>` +
      `<button class="stats-abbrev-cancel" onclick="_renderMaster()">取消</button>` +
      `</span>`;
    document.getElementById(safeId)?.focus();
    document.getElementById(safeId)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') window.statsMasterAddAbbrevCommit(field, value, safeId);
      if (e.key === 'Escape') _renderMaster();
    });
  };

  window.statsMasterAddAbbrevCommit = async function (field, value, inputId) {
    const input = document.getElementById(inputId);
    const abbrev = input ? input.value.trim() : '';
    if (!abbrev) { _renderMaster(); return; }
    if (typeof window.arAddAbbrevPair === 'function') {
      await window.arAddAbbrevPair(field, abbrev, value);
    }
    _renderMaster();
  };

  window.statsToggleHelp = function () {
    const p = document.getElementById('statsHelpPanel');
    if (!p) return;
    p.hidden = !p.hidden;
  };

  // === CSV エクスポート ===

  window.statsExportCsv = function (paneId) {
    if (!_data) return;
    let csv = '';
    const esc = v => '"' + String(v||'').replace(/"/g, '""') + '"';
    if (paneId === 'sv' || paneId === 'carrier') {
      const groups = paneId === 'sv' ? _data.svGroups : _data.carrierGroups;
      csv = 'サブコン/キャリア名,件数,バリアント数\n' +
        groups.map(g => [esc(g.variants[0].value), g.total, g.variants.length].join(',')).join('\n');
    } else if (paneId === 'nm') {
      csv = '品名,件数,バリアント数\n' +
        _data.nmGroups.map(g => [esc(g.variants[0].value), g.total, g.variants.length].join(',')).join('\n');
    } else if (paneId === 'un') {
      csv = '単位,件数\n' +
        _data.unGroups.map(g => [esc(g.variants[0].value), g.total].join(',')).join('\n');
    }
    if (!csv) return;
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'stats-' + paneId + '-' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

})();
