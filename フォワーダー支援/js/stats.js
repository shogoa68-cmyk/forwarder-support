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
          nm:  (c[CI.nm]  || '').replace(/^\*+/, '').trim(),
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
      .replace(/[（(][^）)]*[）)]/g, '')
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

  function _voteBtn(field, value) {
    const v  = _voteInfo(field, value);
    const on = v.isMine;
    return `<button class="stats-vote-btn${on ? ' stats-voted' : ''}" ` +
           `onclick="statsToggleVote('${_ea(field)}','${_ea(value)}')" ` +
           `title="${on ? 'マスターを解除' : 'マスターに登録'}">` +
           (on ? '⭐ 登録済' : '☆ 登録') +
           '</button>';
  }

  // ゆらぎグループ表示（nm/sv/carrier/un 共通）
  function _renderGrouped(groups, field, colLabel, paneId) {
    const e = document.getElementById(paneId);
    if (!e || !_data) return;
    if (!groups.length) { e.innerHTML = '<p class="stats-empty">データなし</p>'; return; }
    // carrier も alias rule では 'sv' フィールドを使う
    const aliasField = (field === 'sv') ? 'sv' : field;
    let h = `<table class="stats-table stats-nm-table"><thead><tr>` +
            `<th>${colLabel}</th><th class="stats-num-col">合計</th><th>バリアント / 投票</th>` +
            `</tr></thead><tbody>`;
    groups.forEach((g, gIdx) => {
      const hasV = g.variants.length > 1;
      const gId  = paneId + '-' + gIdx;
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
      h += `</td><td class="stats-num-col">${g.total}</td><td class="stats-chips-cell">`;
      g.variants.forEach(v => {
        h += `<span class="stats-chip">` +
             `<span class="stats-chip-text">${_esc(v.value)}</span>` +
             `<span class="stats-chip-cnt">×${v.count}</span>` +
             _voteBtn(field, v.value) +
             (hasV ? `<button class="stats-excl-chip-btn" onclick="statsExcludeVariant('${_ea(aliasField)}','${_ea(v.value)}')" title="ゆらぎ判定から除外（別物として扱う）">≠</button>` : '') +
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
    displayList.sort((a, b) => {
      if (a.type === 'canonical' && b.type !== 'canonical') return -1;
      if (a.type !== 'canonical' && b.type === 'canonical') return 1;
      return b.total - a.total;
    });

    let h = '<div class="ua-pane-hint">⭐ 代表に設定 → グループの基準単位として登録　　→ 統合 → 代表に紐付け（件数が合算されます）</div>' +
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
  const _stCls = st => ({ '下書き中':'draft','提出済み':'sent','提示済み':'sent','受注':'won','失注':'lost','辞退':'declined','保留':'hold' }[st] || 'draft');

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
  const _STATUS_ORDER = ['下書き中', '提出済み', '提示済み', '受注', '失注', '辞退', '保留'];

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

    const _renderedCustGroups = {};
    let gIdx = 0;
    let h = '<table class="stats-table"><thead><tr>' +
            '<th>お客様名</th><th class="stats-num-col">件数</th><th>担当者</th><th>ステータス</th><th></th>' +
            '</tr></thead><tbody>';
    groups.forEach(g => {
      const persons = [...g.persons].join('、') || '—';
      const stMap = {};
      g.statuses.forEach(s => { stMap[s] = (stMap[s] || 0) + 1; });
      const stHtml = Object.entries(stMap).length
        ? Object.entries(stMap).sort((a, b) => b[1] - a[1])
            .map(([s, n]) => `<span class="stats-st-chip stats-st--${_stCls(s)}">${_esc(s)} ${n}</span>`).join('')
        : '—';

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
      h += `<tr>` +
           `<td class="stats-val">${nameCell}</td>` +
           `<td class="stats-num-col">${g.count}</td>` +
           `<td>${_esc(persons)}</td>` +
           `<td>${stHtml}</td>` +
           `<td>${g.customer ? _voteBtn('customer', g.customer) : ''}</td>` +
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
        const [field, value] = key.split(':::');
        entries.push({ field, value, votes: total, isMine, promoted: true });
      });
    } else {
      entries = _getMasters().map(m => ({ ...m, isMine: true, promoted: true }));
    }

    if (!entries.length) {
      e.innerHTML = '<p class="stats-empty">マスター登録はまだありません。<br>各集計の ☆ 登録 ボタンで追加できます。</p>';
      return;
    }
    const labels = { sv: 'サブコン', nm: '品名', un: '単位', customer: 'お客様', port: '港' };
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
            '<p class="stats-master-info-title">✅ マスター登録した表記の活用方法</p>' +
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
    e.innerHTML = h + '</tbody></table>';
  }

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
    else if (id === 'charges')  _renderCharges();
    else if (id === 'master')   _renderMaster();
    else if (id === 'alias')    _renderAlias();
  }

  // === サブタブ切替 ===

  function statsSetPane(paneId) {
    document.querySelectorAll('#tab-stats .stats-tab-btn').forEach(b => b.classList.remove('is-active'));
    document.querySelectorAll('#tab-stats .stats-pane').forEach(p => p.classList.remove('is-active'));
    document.getElementById('statsTabBtn-' + paneId)?.classList.add('is-active');
    document.getElementById('statsPane-'   + paneId)?.classList.add('is-active');
    if (!_data) { _data = _build(document.getElementById('statsSource')?.value || 'both'); _updateSummary(); }
    if      (paneId === 'dashboard') _renderDashboard();
    else if (paneId === 'sv')       _renderSv();
    else if (paneId === 'carrier')  _renderCarrier();
    else if (paneId === 'port')     _renderPort();
    else if (paneId === 'customer') _renderCustomer();
    else if (paneId === 'nm')       _renderNm();
    else if (paneId === 'un')       _renderUn();
    else if (paneId === 'charges')  _renderCharges();
    else if (paneId === 'master')   _renderMaster();
    else if (paneId === 'alias')    _renderAlias();
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
          const [field, value] = key.split(':::');
          res.push({ field, value });
        }
      });
      return res;
    }
    return _getMasters().filter(m => (m.votes || 0) >= 1).map(m => ({ field: m.field, value: m.value }));
  };

  window.statsRefresh = async function () {
    _data  = null;
    _cvMap = null;
    const source = document.getElementById('statsSource')?.value || 'both';
    if (source !== 'local' && _cloud() && typeof window.cloudListPresets === 'function') {
      await window.cloudListPresets(true);
    }
    _data  = _build(source);
    _updateSummary();
    _renderCloud();
    if (_cloud()) await _loadCloudVotes();
    _renderCloud();
    _renderActivePane();
    if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
  };

  window.statsToggleVote = async function (field, value) {
    try {
      const v = _voteInfo(field, value);
      if (v.isMine) await _demote(field, value);
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
  };

  // 後方互換
  window.statsPromote = async function (f, v) { await _promote(f, v); _renderActivePane(); };
  window.statsDemote  = async function (f, v) { await _demote(f, v);  _renderMaster(); };

  window.statsMasterAddAbbrev = async function (field, value) {
    const labels = { sv: 'サブコン', nm: '品名', un: '単位', customer: 'お客様', port: '港' };
    const abbrev = window.prompt(`「${value}」の略称を入力してください（${labels[field] || field}）：`);
    if (!abbrev || !abbrev.trim()) return;
    if (typeof window.arAddAbbrevPair === 'function') {
      await window.arAddAbbrevPair(field, abbrev.trim(), value);
    }
  };

  window.statsToggleHelp = function () {
    const p = document.getElementById('statsHelpPanel');
    if (!p) return;
    p.hidden = !p.hidden;
  };

})();
