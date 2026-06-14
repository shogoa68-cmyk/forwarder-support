// ========== 👷 サブコン別 行挿入（案件蓄積から自動生成） ==========
//
// quote_presets の各案件 data.rows から、サブコン（cells[2]=sv）ごとに費用行を集計し、
// 「行を挿入」モーダルの『サブコン別』タブに表示する。保存不要・直近案件が自動で最新。
//   - 単価は直近案件の値、平均単価も併記
//   - 挿入は ui.js の _insertPatternRows() を共通利用（挿入位置セレクトを尊重）
//
(function () {
  'use strict';

  // ROW_CELL_FIELDS と同じ並び（cells[0]=選択, cells[1..]=以下）
  // ['cat','sv','tx','nm','pq','un','bq','pc','bc','pp','bp','cd','mk','nt']
  const CI = { cat:1, sv:2, tx:3, nm:4, pq:5, un:6, bq:7, pc:8, bc:9, pp:10, bp:11, cd:12, mk:13, nt:14 };
  const ROLE = {
    'domestic':'国内作業', 'export-local':'輸出ローカル', 'ocean':'海上', 'air':'航空',
    'surcharge':'サーチャージ', 'import-local':'輸入ローカル', 'overseas':'海外作業',
    'customs-export':'通関(輸出)', 'customs-import':'通関(輸入)', 'insurance':'保険', 'other':'その他',
  };
  const CAT_CLASS = {
    'domestic':'cat-domestic', 'export-local':'cat-export-local', 'ocean':'cat-ocean', 'air':'cat-air',
    'surcharge':'cat-surcharge', 'import-local':'cat-import-local', 'overseas':'cat-overseas',
    'customs-export':'cat-customs-export', 'customs-import':'cat-customs-import', 'insurance':'cat-insurance', 'other':'cat-other',
  };

  let _subcons   = [];   // モーダル用（全件集計）
  let _siSubcons = [];   // 右カラムパネル用（現案件条件でフィルタ済み）

  function _db()   { return (window.quoteCloudClient && window.quoteCloudClient()) || window.SupabaseClient || null; }
  function _user() { const u = window.quoteCloudUser && window.quoteCloudUser(); return u ? (u.email||null) : null; }
  function _esc(s) { return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function _num(v) { const n = parseFloat(String(v==null?'':v).replace(/[, ]/g,'')); return isFinite(n) ? n : null; }
  // 金額表示：行の実通貨を反映（JPY は ¥・整数、非JPY は通貨コード併記＋小数2桁まで）
  function _money(n, ccy) {
    if (n == null) return '—';
    const cur = (ccy || 'JPY').trim() || 'JPY';
    return cur === 'JPY'
      ? '¥' + Math.round(n).toLocaleString('ja-JP')
      : cur + ' ' + n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  }

  // 案件メタ（参照元サマリー用）。pol/pod は列優先・無ければ data.fields から補完
  function _presetMetaOf(p) {
    const f = (p.data && p.data.fields) || {};
    let pol = (p.pol || '').trim() || (f['z2Pol'] || '').trim();
    let pod = (p.pod || '').trim() || (f['z2Pod'] || '').trim();
    if (!pol && !pod) {
      try {
        const rts = JSON.parse(f['z2-routes-data'] || '[]');
        if (Array.isArray(rts) && rts.length) {
          pol = rts.map(r => r.pol).filter(Boolean).join(', ');
          pod = rts.map(r => r.pod).filter(Boolean).join(', ');
        }
      } catch (e) {}
    }
    return {
      id:       p.id,
      name:     (p.name || '（無題）'),
      customer: (p.customer || '').trim() || (f['qf-customer'] || '').trim(),
      person:   (p.person   || '').trim() || (f['qf-person']   || '').trim(),
      status:   (p.status   || '').trim() || (f['qf-status']   || '').trim(),
      mode:     (p.transport_mode || '').trim() || (f['cond-mode'] || '').trim(),
      route:    [pol, pod].filter(Boolean).join(' → '),
      ts:       p.updated_at ? new Date(p.updated_at).getTime() : 0,
    };
  }

  // ---------- 集計 ----------
  function _aggregate(presets) {
    const scMap = {};   // name -> { name, lastUsed, sources:{id->meta+count}, items:{key->{...}} }
    presets.forEach(p => {
      const rows = (p.data && p.data.rows) || [];
      const ts = p.updated_at ? new Date(p.updated_at).getTime() : 0;
      const meta = _presetMetaOf(p);
      rows.forEach(r => {
        if (!r || r._type !== 'data' || !Array.isArray(r.cells)) return;
        const sv = (r.cells[CI.sv] || '').trim();
        if (!sv) return;
        const cat = (r.cells[CI.cat] || '').trim();
        const nm  = (r.cells[CI.nm] || '').trim();
        if (!nm) return;
        if (!scMap[sv]) scMap[sv] = { name: sv, lastUsed: 0, sources: {}, items: {} };
        const sc = scMap[sv];
        sc.lastUsed = Math.max(sc.lastUsed, ts);
        // 参照元案件（このサブコンの費用行を持つ案件）＋寄与項目数を記録
        if (!sc.sources[p.id]) sc.sources[p.id] = Object.assign({ count: 0 }, meta);
        sc.sources[p.id].count++;
        // 通貨もキーに含める（同一項目でも JPY/USD 等が混ざると平均が壊れるため分離）
        const pcKey = (r.cells[CI.pc] || 'JPY').trim() || 'JPY';
        const key = cat + '||' + nm + '||' + pcKey;
        const pp = _num(r.cells[CI.pp]);
        if (!sc.items[key]) {
          sc.items[key] = {
            cat, name: nm, role: ROLE[cat] || '',
            un: (r.cells[CI.un]||''), pc: (r.cells[CI.pc]||'JPY'), bc: (r.cells[CI.bc]||'JPY'),
            ppSum: 0, ppCount: 0, lastPp: null, lastBp: (r.cells[CI.bp]||''),
            lastUsed: 0,
            // 挿入用に直近行の素データを保持
            latest: r.cells,
          };
        }
        const it = sc.items[key];
        if (pp != null) { it.ppSum += pp; it.ppCount++; }
        if (ts >= it.lastUsed) { it.lastUsed = ts; it.lastPp = pp; it.lastBp = (r.cells[CI.bp]||''); it.latest = r.cells; }
      });
    });
    // 配列化
    return Object.values(scMap).map(sc => ({
      name: sc.name,
      lastUsed: sc.lastUsed,
      uses: Object.keys(sc.sources).length,
      sources: Object.values(sc.sources).sort((a, b) => b.ts - a.ts),
      items: Object.values(sc.items)
        .map(it => ({
          cat: it.cat, name: it.name, role: it.role, un: it.un, pc: it.pc, bc: it.bc,
          pp: it.lastPp, bp: it.lastBp || '',
          avgPp: it.ppCount ? (it.ppSum / it.ppCount) : null,
          lastUsed: it.lastUsed, cells: it.latest,
        }))
        .sort((a, b) => b.lastUsed - a.lastUsed),
    })).sort((a, b) => b.lastUsed - a.lastUsed);
  }

  // ---------- 取得 ----------
  async function loadSubconModules() {
    const wrap = document.getElementById('subconListWrap');
    const db = _db();
    if (!db || !_user()) {
      _subcons = [];
      if (wrap) wrap.innerHTML = '<div class="preset-empty">☁️ ログインするとチームの案件からサブコン別の費用行を利用できます</div>';
      return;
    }
    if (wrap) wrap.innerHTML = '<div class="preset-empty">読み込み中…</div>';
    const { data, error } = await db.from('quote_presets')
      .select('id,name,customer,person,status,transport_mode,pol,pod,data,updated_at');
    if (error) { if (wrap) wrap.innerHTML = '<div class="preset-empty">⚠️ 読み込みエラー：' + _esc(error.message) + '</div>'; return; }
    _subcons = _aggregate(data || []);
    renderSubconList();
  }

  // ---------- 描画 ----------
  function _fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit' });
  }
  function _icon(sc) {
    // 代表カテゴリのアイコン
    const cats = sc.items.map(i => i.cat);
    if (cats.includes('customs-export') || cats.includes('customs-import')) return '🛃';
    if (cats.includes('overseas')) return '🌏';
    if (cats.includes('ocean')) return '🚢';
    if (cats.includes('air')) return '✈️';
    return '🚚';
  }

  function renderSubconList(filter) {
    const wrap = document.getElementById('subconListWrap');
    if (!wrap) return;
    let list = _subcons;
    const q = (filter || '').trim().toLowerCase();
    if (q) {
      list = list.filter(sc => sc.name.toLowerCase().includes(q) || sc.items.some(it => it.name.toLowerCase().includes(q)));
    }
    if (!list.length) {
      wrap.innerHTML = '<div class="preset-empty">' + (q ? '該当するサブコンがありません' :
        'サブコン情報のある案件がまだありません<br><small style="color:#bbb;">明細の「サブコン」欄に会社名を入れて案件を保存すると、ここに自動で集約されます</small>') + '</div>';
      return;
    }
    wrap.innerHTML = list.map((sc, si) => {
      const rows = sc.items.map((it, ii) => {
        const priceMain = it.pp != null ? _money(it.pp, it.pc) : '—';
        const unit = it.un ? '<small class="rp-sc-unit"> /' + _esc(it.un) + '</small>' : '';
        const avg = (it.avgPp != null && it.ppCount !== 1)
          ? '<span class="rp-sc-avg">平均 ' + _money(it.avgPp, it.pc) + '</span>' : '';
        return '<label class="rp-sc-item">' +
            '<input type="checkbox" class="rp-sc-chk" data-si="' + si + '" data-ii="' + ii + '" checked>' +
            '<span class="rp-cat ' + (CAT_CLASS[it.cat]||'cat-other') + '">' + _esc(ROLE[it.cat]||it.cat||'—') + '</span>' +
            '<span class="rp-sc-itemname">' + _esc(it.name) + '</span>' +
            '<span class="rp-sc-price">' + priceMain + unit + avg + '</span>' +
          '</label>';
      }).join('');
      // 参照元案件サマリー（クリックで該当案件をプレビュー＝上に重なって開く）
      const srcList = (sc.sources || []).map(s => {
        const bits = [
          s.status ? '<span class="rp-src-status">' + _esc(s.status) + '</span>' : '',
          s.customer ? '👤 ' + _esc(s.customer) : '',
          s.mode ? _esc(s.mode) : '',
          s.route ? '📍 ' + _esc(s.route) : '',
          '🕒 ' + _fmtDate(s.ts),
          s.count + '項目',
        ].filter(Boolean).join('・');
        return '<button type="button" class="rp-src-item" title="この案件をプレビュー" ' +
            'onclick="cloudPreviewPreset(\'' + _esc(s.id) + '\')">' +
            '<span class="rp-src-name">' + _esc(s.name) + '</span>' +
            '<span class="rp-src-meta">' + bits + '</span>' +
          '</button>';
      }).join('');
      const srcSection = srcList
        ? '<details class="rp-sc-src"><summary>📋 参照元 ' + (sc.sources.length) +
            '案件（クリックで案件を開く）</summary><div class="rp-src-list">' + srcList + '</div></details>'
        : '';
      return '<div class="rp-sc-card" data-si="' + si + '">' +
        '<div class="rp-sc-head">' +
          '<span class="rp-sc-av">' + _icon(sc) + '</span>' +
          '<div class="rp-sc-main"><div class="rp-sc-name">' + _esc(sc.name) + '</div>' +
            '<div class="rp-sc-meta"><span>🕒 最終 ' + _fmtDate(sc.lastUsed) + '</span><span>使用 ' + sc.uses + '案件</span><span>' + sc.items.length + '項目</span></div>' +
          '</div>' +
          '<span class="rp-sc-auto">自動生成</span>' +
        '</div>' +
        '<div class="rp-sc-body">' + rows + '</div>' +
        srcSection +
        '<div class="rp-sc-foot">' +
          '<button class="btn-preset-load" onclick="subconInsert(' + si + ')">＋ 選択行を挿入</button>' +
          '<span class="rp-sc-selnote" id="subconSelNote-' + si + '"></span>' +
        '</div>' +
      '</div>';
    }).join('');
    list.forEach((_, si) => _updateSelNote(si));
  }

  function _updateSelNote(si) {
    const note = document.getElementById('subconSelNote-' + si);
    if (!note) return;
    const total = document.querySelectorAll('.rp-sc-chk[data-si="' + si + '"]').length;
    const sel   = document.querySelectorAll('.rp-sc-chk[data-si="' + si + '"]:checked').length;
    note.textContent = sel + '/' + total + '行を選択中・直近案件の単価を反映';
  }

  // cells 配列 → _insertPatternRows が使う名前付き行データへ変換
  function _cellsToRow(cells) {
    const g = i => cells[i];
    return {
      _type: 'data',
      cat:  g(CI.cat) || '',
      sv:   g(CI.sv)  || '',
      taxed: g(CI.tx) === true || g(CI.tx) === 'on',
      name: g(CI.nm) || '',
      pq:   g(CI.pq) || '',
      un:   g(CI.un) || '',
      bq:   g(CI.bq) || '',
      pc:   g(CI.pc) || 'JPY',
      bc:   g(CI.bc) || 'JPY',
      pp:   g(CI.pp) || '',
      bp:   g(CI.bp) || '',
      mk:   g(CI.mk) || '',
      note: g(CI.nt) || '',
    };
  }

  function subconInsert(si) {
    const sc = _filteredAt(si);
    if (!sc) return;
    const checks = document.querySelectorAll('.rp-sc-chk[data-si="' + si + '"]:checked');
    if (!checks.length) { if (window.quoteShowToast) quoteShowToast('⚠️ 挿入する行にチェックを入れてください', 'warn'); return; }
    const rows = [];
    checks.forEach(chk => {
      const ii = parseInt(chk.dataset.ii, 10);
      const it = sc.items[ii];
      if (it && it.cells) rows.push(_cellsToRow(it.cells));
    });
    if (!rows.length) return;
    let posLabel = '末尾';
    if (typeof window._insertPatternRows === 'function') posLabel = window._insertPatternRows(rows) || posLabel;
    if (typeof window.closeRowPatternMgr === 'function') window.closeRowPatternMgr();
    if (window.quoteShowToast) quoteShowToast('📂 「' + sc.name + '」から ' + rows.length + ' 行を' + posLabel + 'に挿入しました', 'success');
  }

  // 現在のフィルタ適用後リストの si 番目（描画時と同じ順序）
  function _filteredAt(si) {
    const q = (document.getElementById('subconSearchInput')?.value || '').trim().toLowerCase();
    let list = _subcons;
    if (q) list = list.filter(sc => sc.name.toLowerCase().includes(q) || sc.items.some(it => it.name.toLowerCase().includes(q)));
    return list[si];
  }

  function subconFilter() {
    renderSubconList(document.getElementById('subconSearchInput')?.value || '');
  }

  // タブ切り替え（行を挿入モーダル）
  function switchRowInsertTab(tab) {
    const isPat = tab !== 'subcon';
    document.getElementById('rpTabPattern')?.classList.toggle('is-active', isPat);
    document.getElementById('rpTabSubcon')?.classList.toggle('is-active', !isPat);
    const pPat = document.getElementById('rpPanePattern');
    const pSub = document.getElementById('rpPaneSubcon');
    if (pPat) pPat.hidden = !isPat;
    if (pSub) pSub.hidden = isPat;
    if (!isPat) loadSubconModules();
  }

  // モーダル側チェック変更
  document.addEventListener('change', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('rp-sc-chk') && !e.target.classList.contains('si-chk')) {
      _updateSelNote(parseInt(e.target.dataset.si, 10));
    }
  });

  // ========== 右カラム（コンパクト）レンダー ==========

  function renderSubconSidePanel(filter) {
    const wrap = document.getElementById('siListWrap');
    if (!wrap) return;
    let list = _siSubcons;
    const q = (filter || '').trim().toLowerCase();
    if (q) list = list.filter(sc => sc.name.toLowerCase().includes(q) || sc.items.some(it => it.name.toLowerCase().includes(q)));
    if (!list.length) {
      wrap.innerHTML = '<div class="preset-empty">' + (q ? '該当するサブコンがありません' :
        'サブコン情報のある案件がまだありません<br><small style="color:#bbb;">明細の「サブコン」欄に会社名を入れて案件を保存すると自動で集約されます</small>') + '</div>';
      if (typeof window.qrcRefresh === 'function') window.qrcRefresh();
      return;
    }
    wrap.innerHTML = list.map((sc, si) => {
      const rows = sc.items.map((it, ii) => {
        const ppStr = it.pp != null ? _money(it.pp, it.pc) : '—';
        const bpNum = it.bp ? parseFloat(it.bp) : null;
        const bpStr = bpNum != null && isFinite(bpNum) ? _money(bpNum, it.bc || it.pc) : null;
        const priceCell = bpStr
          ? ppStr + '<span class="si-arrow">→</span>' + bpStr
          : ppStr;
        const unit = it.un ? '<small class="rp-sc-unit"> /' + _esc(it.un) + '</small>' : '';
        return '<label class="rp-sc-item">' +
            '<input type="checkbox" class="rp-sc-chk si-chk" data-si="' + si + '" data-ii="' + ii + '" checked>' +
            '<span class="rp-cat ' + (CAT_CLASS[it.cat]||'cat-other') + '">' + _esc(ROLE[it.cat]||it.cat||'—') + '</span>' +
            '<span class="rp-sc-itemname">' + _esc(it.name) + '</span>' +
            '<span class="rp-sc-price">' + priceCell + unit + '</span>' +
          '</label>';
      }).join('');
      return '<div class="rp-sc-card" data-si="' + si + '">' +
        '<div class="rp-sc-head">' +
          '<span class="rp-sc-av">' + _icon(sc) + '</span>' +
          '<div class="rp-sc-main">' +
            '<div class="rp-sc-name">' + _esc(sc.name) + '</div>' +
            '<div class="rp-sc-meta"><span>使用 ' + sc.uses + '案件</span><span>' + sc.items.length + '項目</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="rp-sc-body">' + rows + '</div>' +
        '<div class="rp-sc-foot">' +
          '<button class="btn-preset-load" onclick="subconInsertFromPanel(' + si + ')">＋ 挿入</button>' +
          '<span class="rp-sc-selnote" id="siSelNote-' + si + '"></span>' +
        '</div>' +
      '</div>';
    }).join('');
    list.forEach((_, si) => _updateSiSelNote(si));
    if (typeof window.qrcRefresh === 'function') window.qrcRefresh();
  }

  function _updateSiSelNote(si) {
    const note = document.getElementById('siSelNote-' + si);
    if (!note) return;
    const wrap = document.getElementById('siListWrap');
    if (!wrap) return;
    const total = wrap.querySelectorAll('.rp-sc-chk[data-si="' + si + '"]').length;
    const sel   = wrap.querySelectorAll('.rp-sc-chk[data-si="' + si + '"]:checked').length;
    note.textContent = sel + '/' + total + '行選択中';
  }

  function subconInsertFromPanel(si) {
    const q = (document.getElementById('siSubconSearch')?.value || '').trim().toLowerCase();
    let list = _siSubcons;
    if (q) list = list.filter(sc => sc.name.toLowerCase().includes(q) || sc.items.some(it => it.name.toLowerCase().includes(q)));
    const sc = list[si];
    if (!sc) return;
    const wrap = document.getElementById('siListWrap');
    if (!wrap) return;
    const rows = [];
    wrap.querySelectorAll('.rp-sc-chk[data-si="' + si + '"]:checked').forEach(chk => {
      const ii = parseInt(chk.dataset.ii, 10);
      const it = sc.items[ii];
      if (it && it.cells) rows.push(_cellsToRow(it.cells));
    });
    if (!rows.length) return;
    let posLabel = '末尾';
    if (typeof window._insertPatternRows === 'function') posLabel = window._insertPatternRows(rows) || posLabel;
    if (window.quoteShowToast) quoteShowToast('📂 「' + _esc(sc.name) + '」から ' + rows.length + ' 行を' + posLabel + 'に挿入しました', 'success');
  }

  // 現在の見積に登録済みのサブコン名セットを返す（小文字・重複除去）
  function _currentSvSet() {
    const rows = typeof window.collectAllRows === 'function' ? window.collectAllRows() : [];
    return new Set(
      rows.filter(r => r._type === 'data' && (r.sv || '').trim())
          .map(r => r.sv.trim().toLowerCase())
    );
  }

  // 現在の見積条件（登録サブコン → フォールバック: 方向・POL/POD）でプリセットをフィルタして集計
  function _buildSiSubcons(allPresets) {
    const svSet = _currentSvSet();

    // ① 登録サブコンがある → そのサブコン名に合致する集計のみ返す
    if (svSet.size > 0) {
      const all = _aggregate(allPresets);
      return all.filter(sc => svSet.has(sc.name.toLowerCase()));
    }

    // ② 登録サブコンが0件 → 方向・POL/POD フィルタにフォールバック
    const cond = typeof window.getConditions === 'function' ? window.getConditions() : {};
    const dir    = (cond.direction || '').trim();
    const routes = Array.isArray(cond.routes) ? cond.routes : [];
    const polSet = routes.map(r => (r.pol || '').trim().toLowerCase()).filter(Boolean);
    const podSet = routes.map(r => (r.pod || '').trim().toLowerCase()).filter(Boolean);

    let filtered = allPresets;
    if (dir) {
      filtered = filtered.filter(p => {
        const pDir = ((p.data && p.data.fields && p.data.fields['cond-direction']) || '').trim();
        return !pDir || pDir === dir;
      });
    }
    if (polSet.length || podSet.length) {
      filtered = filtered.filter(p => {
        const pPol = (p.pol || '').trim().toLowerCase();
        const pPod = (p.pod || '').trim().toLowerCase();
        if (!pPol && !pPod) return true;
        const polMatch = polSet.some(q => pPol && (pPol.includes(q) || q.includes(pPol)));
        const podMatch = podSet.some(q => pPod && (pPod.includes(q) || q.includes(pPod)));
        return polMatch || podMatch;
      });
    }
    return _aggregate(filtered);
  }

  async function loadSubconPanel() {
    const wrap = document.getElementById('siListWrap');
    if (!wrap) return;
    const db = _db();
    if (!db || !_user()) {
      wrap.innerHTML = '<div class="preset-empty">☁️ ログインするとチームの案件からサブコン別の費用行を利用できます</div>';
      return;
    }
    wrap.innerHTML = '<div class="preset-empty">読み込み中…</div>';
    const { data, error } = await db.from('quote_presets')
      .select('id,name,customer,person,status,transport_mode,pol,pod,data,updated_at');
    if (error) {
      wrap.innerHTML = '<div class="preset-empty">⚠️ 読み込みエラー：' + _esc(error.message) + '</div>';
      return;
    }
    _siSubcons = _buildSiSubcons(data || []);
    renderSubconSidePanel(document.getElementById('siSubconSearch')?.value || '');
  }

  function subconSidePanelFilter() {
    renderSubconSidePanel(document.getElementById('siSubconSearch')?.value || '');
  }

  // チェック変更で選択数を更新
  document.addEventListener('change', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('rp-sc-chk')) {
      const si = parseInt(e.target.dataset.si, 10);
      if (e.target.classList.contains('si-chk')) _updateSiSelNote(si);
      else _updateSelNote(si);
    }
  });

  Object.assign(window, {
    loadSubconModules, renderSubconList, subconInsert, subconFilter, switchRowInsertTab,
    renderSubconSidePanel, subconInsertFromPanel, loadSubconPanel, subconSidePanelFilter,
  });
})();
