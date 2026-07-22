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
  const CI = { cat:1, sv:2, tx:3, nm:4, pq:5, un:6, bq:7, pc:8, bc:9, pp:10, bp:11, cd:12, mk:13, nt:14, vf:16, vt:17, pt:19 };
  const ROLE = {
    'domestic':'国内作業', 'export-local':'輸出ローカル', 'ocean':'海上', 'air':'航空',
    'surcharge':'サーチャージ', 'import-local':'輸入ローカル', 'overseas':'海外作業',
    'customs-export':'通関(輸出)', 'customs-import':'通関(輸入)', 'insurance':'保険',
    'domestic-transport':'国内配送', 'warehouse':'倉庫保管', 'packing-cost':'梱包', 'other':'その他',
  };
  const CAT_CLASS = {
    'domestic':'cat-domestic', 'export-local':'cat-export-local', 'ocean':'cat-ocean', 'air':'cat-air',
    'surcharge':'cat-surcharge', 'import-local':'cat-import-local', 'overseas':'cat-overseas',
    'customs-export':'cat-customs-export', 'customs-import':'cat-customs-import', 'insurance':'cat-insurance',
    'domestic-transport':'cat-domestic-transport', 'warehouse':'cat-warehouse', 'packing-cost':'cat-packing-cost', 'other':'cat-other',
  };

  let _subcons   = [];   // モーダル用（全件集計）
  let _siSubcons = [];   // 右カラムパネル用（現案件条件 or 全件、_siShowAll に応じて切替）
  let _siCatSel  = new Set();   // 右カラム：カテゴリチップの選択状態（空 = 全カテゴリ）
  let _siShowAll = false;       // 右カラム：ON=全過去案件、OFF=現案件のサブコン/条件に合致するもののみ
  let _siRawPresets = null;     // 直近取得した全プリセット（トグル切替時に再取得しないためのキャッシュ）

  // ---------- 検索ヘルパー（スペース区切り AND・複数フィールド横断） ----------
  function _terms(q) {
    return String(q || '').trim().toLowerCase().split(/[\s　]+/).filter(Boolean);
  }
  function _itemMatches(it, terms) {
    if (!terms.length) return true;
    const hay = [it.name, it.un, it.cat, ROLE[it.cat] || '', it.pt].join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  }
  function _scMatches(sc, terms) {
    if (!terms.length) return true;
    const nm = sc.name.toLowerCase();
    return terms.every(t => nm.includes(t)) || sc.items.some(it => _itemMatches(it, terms));
  }

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
        // 通貨・単位もキーに含める（同一品名でも異なる航路/単位を分離）
        const pcKey = (r.cells[CI.pc] || 'JPY').trim() || 'JPY';
        const unKey = (r.cells[CI.un] || '').trim();
        const normMap = typeof window.uaGetNormalizeMap === 'function' ? window.uaGetNormalizeMap() : {};
        const normalizedUn = normMap[unKey] || unKey;
        const key = cat + '||' + nm + '||' + pcKey + '||' + normalizedUn;
        const pp = _num(r.cells[CI.pp]);
        const route = [p.pol || '', p.pod || ''].filter(Boolean).join('→');
        if (!sc.items[key]) {
          sc.items[key] = {
            cat, name: nm, role: ROLE[cat] || '',
            un: (r.cells[CI.un]||''), pc: (r.cells[CI.pc]||'JPY'), bc: (r.cells[CI.bc]||'JPY'),
            ppSum: 0, ppCount: 0, lastPp: null, lastBp: (r.cells[CI.bp]||''),
            lastPt: (r.cells[CI.pt]||'').trim(),
            lastVf: (r.cells[CI.vf]||'').trim(), lastVt: (r.cells[CI.vt]||'').trim(),
            lastUsed: 0,
            latest: r.cells,
            history: [],
          };
        }
        const it = sc.items[key];
        if (pp != null) { it.ppSum += pp; it.ppCount++; }
        if (ts >= it.lastUsed) { it.lastUsed = ts; it.lastPp = pp; it.lastBp = (r.cells[CI.bp]||''); it.lastPt = (r.cells[CI.pt]||'').trim(); it.lastVf = (r.cells[CI.vf]||'').trim(); it.lastVt = (r.cells[CI.vt]||'').trim(); it.latest = r.cells; }
        it.history.push({ ts, pp, bp: _num(r.cells[CI.bp]), route });
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
          pp: it.lastPp, bp: it.lastBp || '', pt: it.lastPt || '',
          vf: it.lastVf || '', vt: it.lastVt || '',
          avgPp: it.ppCount ? (it.ppSum / it.ppCount) : null,
          lastUsed: it.lastUsed, cells: it.latest,
          history: it.history.sort((a, b) => a.ts - b.ts),
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
  // 適用期間バッジ（サーチャージ等の vf/vt）。期限切れは赤系で明示
  function _periodBadge(it) {
    const vf = (it.vf || '').trim(), vt = (it.vt || '').trim();
    if (!vf && !vt) return '';
    const f = s => s ? s.replace(/-/g, '/').replace(/^20/, '') : '';
    const range = f(vf) + '〜' + f(vt);
    const today = new Date().toISOString().slice(0, 10);
    const expired = !!vt && vt < today;
    return '<span class="rp-sc-period' + (expired ? ' is-expired' : '') +
      '" title="適用期間' + (expired ? '（期限切れ・単価は参考値）' : '') + '">📅 ' + _esc(range) +
      (expired ? '<b class="rp-sc-period-exp">期限切れ</b>' : '') + '</span>';
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
    const terms = _terms(filter);
    if (terms.length) list = list.filter(sc => _scMatches(sc, terms));
    if (!list.length) {
      wrap.innerHTML = '<div class="preset-empty">' + (terms.length ? '該当するサブコンがありません' :
        'サブコン情報のある案件がまだありません<br><small style="color:#bbb;">明細の「サブコン」欄に会社名を入れて案件を保存すると、ここに自動で集約されます</small>') + '</div>';
      return;
    }
    wrap.innerHTML = list.map((sc, si) => {
      const rows = sc.items.map((it, ii) => {
        const priceMain = it.pp != null ? _money(it.pp, it.pc) : '—';
        const unit = it.un ? '<small class="rp-sc-unit"> /' + _esc(it.un) + '</small>' : '';
        const avg = (it.avgPp != null && it.ppCount !== 1)
          ? '<span class="rp-sc-avg">平均 ' + _money(it.avgPp, it.pc) + '</span>' : '';
        const ptBadge = it.pt ? '<span class="rp-sc-pt">' + _esc(it.pt) + '</span>' : '';
        return '<label class="rp-sc-item">' +
            '<input type="checkbox" class="rp-sc-chk" data-si="' + si + '" data-ii="' + ii + '" checked>' +
            '<span class="rp-cat ' + (CAT_CLASS[it.cat]||'cat-other') + '">' + _esc(ROLE[it.cat]||it.cat||'—') + '</span>' +
            '<span class="rp-sc-nm-wrap"><span class="rp-sc-itemname">' + _esc(it.name) + '</span>' + ptBadge + _periodBadge(it) + '</span>' +
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
      pt:   g(CI.pt) || '',
      vf:   g(CI.vf) || '',
      vt:   g(CI.vt) || '',
    };
  }

  // it（_aggregate済みアイテム）から行データを生成。cells より it の確定プロパティを優先し
  // cells のみで補完する。単位などが cells に入っていない場合のフォールバック。
  function _rowFromItem(it, svName) {
    const row = _cellsToRow(it.cells || []);
    if (!row.un  && it.un)  row.un  = it.un;
    if (!row.cat && it.cat) row.cat = it.cat;
    if (!row.name && it.name) row.name = it.name;
    if (svName) row.sv = svName;
    return row;
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

  // 現在のフィルタ適用後リストの si 番目（描画時と同じ条件・同じ順序）
  function _filteredAt(si) {
    const terms = _terms(document.getElementById('subconSearchInput')?.value || '');
    let list = _subcons;
    if (terms.length) list = list.filter(sc => _scMatches(sc, terms));
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

  // 検索語＋カテゴリチップ適用後のリスト。items は該当行のみに絞り、_ii に元 index を保持
  // （サブコン名自体がヒットした場合はそのサブコンの全行を表示。カテゴリチップは常に適用）
  function _siFilteredList() {
    const terms = _terms(document.getElementById('siSubconSearch')?.value || '');
    const out = [];
    _siSubcons.forEach(sc => {
      const nameHit = terms.length > 0 && terms.every(t => sc.name.toLowerCase().includes(t));
      let items = sc.items.map((it, ii) => Object.assign({ _ii: ii }, it));
      if (_siCatSel.size) items = items.filter(it => _siCatSel.has(it.cat || ''));
      if (terms.length && !nameHit) items = items.filter(it => _itemMatches(it, terms));
      if (!items.length) return;
      out.push(Object.assign({}, sc, { items, _total: sc.items.length }));
    });
    return out;
  }

  // カテゴリ絞り込みチップ（全サブコンの費用行に存在するカテゴリ＋件数）
  function renderSiCatChips() {
    const box = document.getElementById('siCatChips');
    if (!box) return;
    const counts = {};
    _siSubcons.forEach(sc => sc.items.forEach(it => {
      const k = it.cat || '';
      counts[k] = (counts[k] || 0) + 1;
    }));
    const keys = Object.keys(ROLE).filter(k => counts[k]);
    if (counts['']) keys.push('');
    if (!keys.length) { box.innerHTML = ''; return; }
    box.innerHTML = keys.map(k => {
      const on = _siCatSel.has(k);
      const label = k ? (ROLE[k] || k) : '区分なし';
      return '<button type="button" class="si-cat-chip rp-cat ' + (CAT_CLASS[k] || 'cat-other') + (on ? ' is-on' : '') + '" ' +
        'onclick="siToggleCatChip(\'' + _esc(k) + '\')" title="このカテゴリで絞り込み（複数選択可）">' +
        _esc(label) + '<small>' + counts[k] + '</small></button>';
    }).join('') + (_siCatSel.size
      ? '<button type="button" class="si-cat-chip si-cat-clear" onclick="siClearCatChips()" title="カテゴリ絞り込みを解除">✕ 解除</button>'
      : '');
  }
  function siToggleCatChip(k) {
    if (_siCatSel.has(k)) _siCatSel.delete(k); else _siCatSel.add(k);
    renderSubconSidePanel();
  }
  function siClearCatChips() {
    _siCatSel.clear();
    renderSubconSidePanel();
  }

  function renderSubconSidePanel() {
    const wrap = document.getElementById('siListWrap');
    if (!wrap) return;
    renderSiCatChips();
    const terms = _terms(document.getElementById('siSubconSearch')?.value || '');
    const filtering = terms.length > 0 || _siCatSel.size > 0;
    const list = _siFilteredList();
    if (!list.length) {
      wrap.innerHTML = '<div class="preset-empty">' + (filtering ? '該当する費用行がありません' :
        'サブコン情報のある案件がまだありません<br><small style="color:#bbb;">明細の「サブコン」欄に会社名を入れて案件を保存すると自動で集約されます</small>') + '</div>';
      if (typeof window.qrcRefresh === 'function') window.qrcRefresh();
      return;
    }
    const hitItems = list.reduce((s, sc) => s + sc.items.length, 0);
    const summary = filtering
      ? '<div class="si-hit-note">🔍 ' + list.length + '社・' + hitItems + '項目がヒット</div>' : '';
    wrap.innerHTML = summary + list.map((sc, si) => {
      const rows = sc.items.map(it => {
        const ppStr = it.pp != null ? _money(it.pp, it.pc) : '—';
        const bpNum = it.bp ? parseFloat(it.bp) : null;
        const bpStr = bpNum != null && isFinite(bpNum) ? _money(bpNum, it.bc || it.pc) : null;
        const priceCell = bpStr
          ? ppStr + '<span class="si-arrow">→</span>' + bpStr
          : ppStr;
        const unit = it.un ? '<small class="rp-sc-unit"> /' + _esc(it.un) + '</small>' : '';
        const ptBadgeSi = it.pt ? '<span class="rp-sc-pt">' + _esc(it.pt) + '</span>' : '';
        return '<label class="rp-sc-item" draggable="true" data-si="' + si + '" data-ii="' + it._ii + '">' +
            '<input type="checkbox" class="rp-sc-chk si-chk" data-si="' + si + '" data-ii="' + it._ii + '" checked>' +
            '<span class="rp-cat ' + (CAT_CLASS[it.cat]||'cat-other') + '">' + _esc(ROLE[it.cat]||it.cat||'—') + '</span>' +
            '<span class="rp-sc-nm-wrap"><span class="rp-sc-itemname">' + _esc(it.name) + '</span>' + ptBadgeSi + _periodBadge(it) + '</span>' +
            '<span class="rp-sc-price">' + priceCell + unit + '</span>' +
          '</label>';
      }).join('');
      const cntNote = (filtering && sc.items.length < sc._total)
        ? '<span class="si-cnt-hit">該当 ' + sc.items.length + '/' + sc._total + '項目</span>'
        : '<span>' + sc.items.length + '項目</span>';
      return '<div class="rp-sc-card" data-si="' + si + '">' +
        '<div class="rp-sc-head">' +
          '<span class="rp-sc-av">' + _icon(sc) + '</span>' +
          '<div class="rp-sc-main">' +
            '<div class="rp-sc-name">' + _esc(sc.name) + '</div>' +
            '<div class="rp-sc-meta"><span>使用 ' + sc.uses + '案件</span>' + cntNote + '</div>' +
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

  // サブコングループの末尾行の次の行（非仮想）を返す。グループが存在しなければ null（末尾挿入）
  function _svGroupAnchor(svName) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return null;
    let lastInGroup = null;
    Array.from(tbody.querySelectorAll('tr:not([data-virtual])')).forEach(tr => {
      if (tr.dataset.type) return;
      const id = (tr.id || '').replace('row-', '');
      if (!id) return;
      const sv = (document.getElementById('sv-' + id)?.value || '').trim();
      if (sv === svName) lastInGroup = tr;
    });
    if (!lastInGroup) return null;
    let next = lastInGroup.nextSibling;
    while (next && next.dataset && next.dataset.virtual) next = next.nextSibling;
    return next || null;
  }

  function subconInsertFromPanel(si) {
    const sc = _siFilteredList()[si];
    if (!sc) return;
    const wrap = document.getElementById('siListWrap');
    if (!wrap) return;
    const rows = [];
    wrap.querySelectorAll('.rp-sc-chk[data-si="' + si + '"]:checked').forEach(chk => {
      const ii = parseInt(chk.dataset.ii, 10);
      const it = sc.items.find(x => x._ii === ii);
      if (it) rows.push(_rowFromItem(it, sc.name));
    });
    if (!rows.length) return;
    // 同一サブコングループの末尾に挿入
    if (typeof window._insertPatternRowsAt === 'function') {
      const anchor = _svGroupAnchor(sc.name);
      window._insertPatternRowsAt(rows, anchor);
      if (window.quoteShowToast) quoteShowToast('📂 「' + _esc(sc.name) + '」から ' + rows.length + ' 行をサブコングループに挿入しました', 'success');
    } else {
      let posLabel = '末尾';
      if (typeof window._insertPatternRows === 'function') posLabel = window._insertPatternRows(rows) || posLabel;
      if (window.quoteShowToast) quoteShowToast('📂 「' + _esc(sc.name) + '」から ' + rows.length + ' 行を' + posLabel + 'に挿入しました', 'success');
    }
  }

  // 現在の見積に登録済みのサブコン名セットを返す（小文字・重複除去）
  function _currentSvSet() {
    const rows = typeof window.collectAllRows === 'function' ? window.collectAllRows() : [];
    return new Set(
      rows.filter(r => r._type === 'data' && (r.sv || '').trim())
          .map(r => r.sv.trim().toLowerCase())
    );
  }

  // 現在の見積条件（登録サブコン優先 → フォールバック: 方向・POL/POD）でプリセットをフィルタして集計
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

  // ========== 現案件ペイン ==========

  // タブ切替
  function siSetTab(tab) {
    document.querySelectorAll('#siPanel .si-tab').forEach(b => b.classList.toggle('is-active', b.dataset.sitab === tab));
    document.querySelectorAll('#siPanel .si-pane').forEach(p => { p.style.display = p.id === 'siPane-' + tab ? '' : 'none'; });
    if (tab === 'current') renderCurrentQuoteSubconPanel();
  }

  // 現在の見積テーブルをサブコン×パターン別に集計
  function _collectCurrentQuoteBySubcon() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return [];
    const groups = [];
    const svMap = new Map();
    let currentSv = null, currentPt = null;

    Array.from(tbody.querySelectorAll('tr')).forEach(function(tr) {
      if (tr.dataset.virtual) { currentSv = tr.dataset.svKey || ''; currentPt = null; return; }
      if (tr.dataset.subGroup) { currentPt = tr.dataset.ptKey || null; return; }
      if (tr.dataset.type || tr.dataset.ptSum || tr.dataset.subSum) return;
      if (tr.dataset.outRange === '1') return;
      const id = (tr.id || '').replace('row-', '');
      if (!id) return;
      const val = function(f) { return (document.getElementById(f + '-' + id) || {}).value || ''; };
      const nm = val('nm'); if (!nm) return;
      const sv = currentSv !== null ? currentSv : (val('sv') || '');
      const svLabel = sv || '（未設定）';
      const cat = val('cat'), bq = parseFloat(val('bq')) || 0, un = val('un');
      const pp = parseFloat(val('pp')) || 0, pc = val('pc') || 'JPY';
      const bp = parseFloat(val('bp')) || 0, bc = val('bc') || 'JPY';
      const excluded = tr.dataset.excluded === '1';

      let svGroup = svMap.get(svLabel);
      if (!svGroup) {
        svGroup = { sv: svLabel, ptMap: new Map(), ptOrder: [], sellTotal: 0, costTotal: 0, hasMixed: false };
        svMap.set(svLabel, svGroup); groups.push(svGroup);
      }
      const ptKey = currentPt !== null ? currentPt : '';
      let ptGroup = svGroup.ptMap.get(ptKey);
      if (!ptGroup) {
        ptGroup = { pt: ptKey, rows: [], sellTotal: 0, costTotal: 0, hasMixed: false };
        svGroup.ptMap.set(ptKey, ptGroup); svGroup.ptOrder.push(ptKey);
      }
      const sellJPY = bc !== 'JPY' ? (typeof toJPY === 'function' ? toJPY(bq * bp, bc) : 0) : bq * bp;
      const costJPY = pc !== 'JPY' ? (typeof toJPY === 'function' ? toJPY(bq * pp, pc) : 0) : bq * pp;
      const mixed = bc !== 'JPY' || pc !== 'JPY';
      ptGroup.rows.push({ cat, nm, bq, un, pp, pc, bp, bc, excluded });
      if (!excluded) {
        ptGroup.sellTotal += sellJPY; ptGroup.costTotal += costJPY;
        svGroup.sellTotal += sellJPY; svGroup.costTotal += costJPY;
        if (mixed) { ptGroup.hasMixed = true; svGroup.hasMixed = true; }
      }
    });
    return groups;
  }

  function _fmtMoney(n, ccy) {
    if (!n && n !== 0) return '—';
    const c = (ccy || 'JPY').trim();
    return c === 'JPY' ? '¥' + Math.round(n).toLocaleString('ja-JP')
                       : c + ' ' + n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  }

  // 1グループをクリップボード用テキストに変換
  function _groupToText(svLabel, ptGroups) {
    const lines = ['【' + svLabel + '】'];
    ptGroups.forEach(function(pg) {
      if (pg.pt) lines.push('  ▸ ' + pg.pt);
      pg.rows.forEach(function(r) {
        const qty = r.bq ? r.bq.toLocaleString('ja-JP') + (r.un ? ' ' + r.un : '') : '—';
        const price = _fmtMoney(r.pp, r.pc);
        const ex = r.excluded ? '【除外】' : '';
        lines.push('  ' + ex + r.nm + '  ' + qty + '  仕入:' + price);
      });
    });
    const allSell = ptGroups.reduce(function(s, p) { return s + p.sellTotal; }, 0);
    const allCost = ptGroups.reduce(function(s, p) { return s + p.costTotal; }, 0);
    const mixed   = ptGroups.some(function(p) { return p.hasMixed; });
    lines.push('────');
    lines.push('仕入合計: ' + _fmtMoney(allCost, 'JPY') + (mixed ? '（概算）' : '') +
               '  /  売合計: ' + _fmtMoney(allSell, 'JPY') + (mixed ? '（概算）' : ''));
    return lines.join('\n');
  }

  // 現案件ペインを描画
  function renderCurrentQuoteSubconPanel() {
    const wrap = document.getElementById('siCurrentWrap');
    if (!wrap) return;
    const groups = _collectCurrentQuoteBySubcon();
    if (!groups.length) {
      wrap.innerHTML = '<div class="preset-empty">費用テーブルにサブコン情報のある行がありません<br><small style="color:#bbb;">各行の「サブコン」欄に会社名を入力してください</small></div>';
      return;
    }
    wrap.innerHTML = groups.map(function(g, gi) {
      const ptGroups = g.ptOrder.map(function(k) { return g.ptMap.get(k); });
      const hasPt = ptGroups.some(function(p) { return !!p.pt; });
      const ptsHtml = ptGroups.map(function(pg) {
        const ptHdr = pg.pt ? '<div class="sic-pt-hdr">▸ ' + _esc(pg.pt) + '</div>' : '';
        const rowsHtml = pg.rows.map(function(r) {
          const qty = r.bq ? r.bq.toLocaleString('ja-JP') + (r.un ? ' ' + _esc(r.un) : '') : '—';
          return '<div class="sic-row' + (r.excluded ? ' is-excluded' : '') + '">' +
            '<span class="rp-cat ' + (CAT_CLASS[r.cat] || 'cat-other') + '">' + _esc(ROLE[r.cat] || r.cat || '—') + '</span>' +
            '<span class="sic-nm">' + _esc(r.nm) + '</span>' +
            '<span class="sic-meta">' + qty + '</span>' +
            '<span class="sic-price">' + _fmtMoney(r.pp, r.pc) + '</span>' +
            '</div>';
        }).join('');
        const ptFooter = hasPt && pg.pt
          ? '<div class="sic-pt-foot">' +
              '<span>仕入 ' + _fmtMoney(pg.costTotal, 'JPY') + (pg.hasMixed ? '※' : '') + '</span>' +
              '<span>売 ' + _fmtMoney(pg.sellTotal, 'JPY') + (pg.hasMixed ? '※' : '') + '</span>' +
            '</div>'
          : '';
        return ptHdr + rowsHtml + ptFooter;
      }).join('');
      const mixed = g.hasMixed;
      return '<div class="sic-card" data-gi="' + gi + '">' +
        '<div class="sic-head">' +
          '<span class="sic-sv">' + _esc(g.sv) + '</span>' +
          '<span class="sic-total">' +
            '仕入 ' + _fmtMoney(g.costTotal, 'JPY') + (mixed ? '※' : '') +
            '  売 ' + _fmtMoney(g.sellTotal, 'JPY') + (mixed ? '※' : '') +
          '</span>' +
        '</div>' +
        '<div class="sic-body">' + ptsHtml + '</div>' +
        '<div class="sic-foot">' +
          '<button class="sic-copy-btn" onclick="siCopyGroup(' + gi + ')" title="この会社分をテキストでコピー">📋 コピー</button>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  // コピーボタン
  window._sicGroups = [];
  function siCopyGroup(gi) {
    const groups = _collectCurrentQuoteBySubcon();
    const g = groups[gi];
    if (!g) return;
    const ptGroups = g.ptOrder.map(function(k) { return g.ptMap.get(k); });
    const text = _groupToText(g.sv, ptGroups);
    if (typeof SharedUI !== 'undefined' && SharedUI.copyToClipboard) {
      SharedUI.copyToClipboard(text);
    } else {
      navigator.clipboard.writeText(text).catch(function() {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      });
    }
    if (typeof quoteShowToast === 'function') quoteShowToast('📋 ' + g.sv + ' の明細をコピーしました', 'success');
  }

  async function loadSubconPanel() {
    // 現案件ペインはすぐ描画（クラウド不要）
    renderCurrentQuoteSubconPanel();
    // 過去案件ペインの読み込み
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
    _siRawPresets = data || [];
    _applySiScope();
  }

  // _siShowAll に応じて表示対象を切替（再取得はしない・キャッシュから再集計のみ）
  function _applySiScope() {
    if (!_siRawPresets) return;
    _siSubcons = _siShowAll ? _aggregate(_siRawPresets) : _buildSiSubcons(_siRawPresets);
    renderSubconSidePanel();
  }

  // 現案件連動 ⇔ 全過去案件 の切替（右カラム「サブコン別」過去案件ペイン）
  function siToggleShowAll(checked) {
    _siShowAll = !!checked;
    const lbl = document.getElementById('siScopeLabel');
    if (lbl) lbl.textContent = _siShowAll ? '🌐 全過去案件のサブコン' : '🔎 現案件に関連するサブコンのみ';
    _applySiScope();
  }

  function subconSidePanelFilter() {
    renderSubconSidePanel();
  }

  // チェック変更で選択数を更新
  document.addEventListener('change', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('rp-sc-chk')) {
      const si = parseInt(e.target.dataset.si, 10);
      if (e.target.classList.contains('si-chk')) _updateSiSelNote(si);
      else _updateSelNote(si);
    }
  });

  // ===== ドラッグ＆ドロップ（サイドパネル → 見積テーブル） =====
  document.addEventListener('dragstart', function(e) {
    const label = e.target.closest('#siListWrap .rp-sc-item[draggable]');
    if (!label) return;
    const si = parseInt(label.dataset.si, 10);
    const ii = parseInt(label.dataset.ii, 10);
    const sc = _siFilteredList()[si];
    if (!sc) return;
    const it = sc.items.find(x => x._ii === ii);
    if (!it) return;
    e.dataTransfer.setData('application/x-si-item', JSON.stringify(_rowFromItem(it, sc.name)));
    e.dataTransfer.effectAllowed = 'copy';
    label.classList.add('si-item-dragging');
  });

  document.addEventListener('dragend', function(e) {
    if (!e.target.closest('#siListWrap .rp-sc-item[draggable]')) return;
    document.querySelectorAll('.rp-sc-item.si-item-dragging').forEach(el => el.classList.remove('si-item-dragging'));
    document.querySelectorAll('#tableBody tr.si-drop-top, #tableBody tr.si-drop-bottom').forEach(r => {
      r.classList.remove('si-drop-top', 'si-drop-bottom');
    });
  });

  document.addEventListener('dragover', function(e) {
    if (!e.dataTransfer.types.includes('application/x-si-item')) return;
    const tbody = document.getElementById('tableBody');
    if (!tbody || !tbody.contains(e.target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const tr = e.target.closest('#tableBody tr:not([data-virtual])');
    document.querySelectorAll('#tableBody tr.si-drop-top, #tableBody tr.si-drop-bottom').forEach(r => {
      r.classList.remove('si-drop-top', 'si-drop-bottom');
    });
    if (!tr) return;
    const rect = tr.getBoundingClientRect();
    tr.classList.add(e.clientY < rect.top + rect.height / 2 ? 'si-drop-top' : 'si-drop-bottom');
  });

  document.addEventListener('dragleave', function(e) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    if (tbody.contains(e.target) && !tbody.contains(e.relatedTarget)) {
      document.querySelectorAll('#tableBody tr.si-drop-top, #tableBody tr.si-drop-bottom').forEach(r => {
        r.classList.remove('si-drop-top', 'si-drop-bottom');
      });
    }
  });

  document.addEventListener('drop', function(e) {
    const tbody = document.getElementById('tableBody');
    if (!tbody || !tbody.contains(e.target)) return;
    const raw = e.dataTransfer.getData('application/x-si-item');
    if (!raw) return;
    e.preventDefault();
    document.querySelectorAll('#tableBody tr.si-drop-top, #tableBody tr.si-drop-bottom').forEach(r => {
      r.classList.remove('si-drop-top', 'si-drop-bottom');
    });
    let row;
    try { row = JSON.parse(raw); } catch(err) { return; }
    const tr = e.target.closest('#tableBody tr:not([data-virtual])');
    let anchorTr = null;
    if (tr) {
      const rect = tr.getBoundingClientRect();
      anchorTr = e.clientY < rect.top + rect.height / 2 ? tr : (tr.nextSibling || null);
    }
    if (typeof window._insertPatternRowsAt === 'function') window._insertPatternRowsAt([row], anchorTr);
    if (window.quoteShowToast) quoteShowToast('📂 「' + _esc(row.name || '費用行') + '」を挿入しました', 'success');
  });

  Object.assign(window, {
    loadSubconModules, renderSubconList, subconInsert, subconFilter, switchRowInsertTab,
    renderSubconSidePanel, subconInsertFromPanel, loadSubconPanel, subconSidePanelFilter,
    siToggleCatChip, siClearCatChips, siToggleShowAll,
    siSetTab, renderCurrentQuoteSubconPanel, siCopyGroup,
    getSubconData: () => _subcons,
    loadSubconData: async () => { if (!_subcons.length) await loadSubconModules(); return _subcons; },
    buildSubconData: (presets) => _aggregate(presets),
  });
})();
