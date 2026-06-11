// ========== シナリオ比較 ==========
// ベース見積から倍率を変えた複数パターンの合計を比較する機能。
// 各シナリオ：ラベル（例: "10CBM"）＋倍率（例: 10）を定義する。
// 行に表示される 🔒 ボタンで「固定費」（倍率対象外）を指定可能。

  const _SC_KEY = 'quoteScenarios_v1';
  const _SC_MAX = 4;

  let _scEnabled   = false;
  let _scCollapsed = true;   // 初期状態：折りたたみ
  let _scScenarios = [];  // [{ id, label, scale }]

  // ---------- 永続化 ----------

  function _scLoad() {
    try {
      const saved = JSON.parse(localStorage.getItem(_SC_KEY) || 'null');
      if (saved && Array.isArray(saved.scenarios)) {
        _scEnabled   = !!saved.enabled;
        _scScenarios = saved.scenarios;
      }
    } catch (e) { /* ignore */ }
    if (!_scScenarios.length) {
      _scScenarios = [
        { id: 1, label: '小ロット', scale: 1 },
        { id: 2, label: '中ロット', scale: 5 },
        { id: 3, label: '大ロット', scale: 10 },
      ];
    }
  }

  function _scSave() {
    try {
      localStorage.setItem(_SC_KEY, JSON.stringify({ enabled: _scEnabled, scenarios: _scScenarios }));
    } catch (e) { /* ignore */ }
  }

  // ---------- パネル描画 ----------

  function _scRenderPanel() {
    const panel = document.getElementById('scPanel');
    if (!panel) return;

    const listHtml = _scScenarios.map((s, i) =>
      `<div class="sc-row" data-idx="${i}">
         <input type="text" class="sc-label-in" value="${escHtml(s.label)}" placeholder="ラベル" maxlength="20"
                onchange="scUpdateScenario(${i},'label',this.value)" />
         <span class="sc-times">×</span>
         <input type="number" class="sc-scale-in" value="${s.scale}" min="0.01" step="1"
                onchange="scUpdateScenario(${i},'scale',parseFloat(this.value)||1)" />
         ${_scScenarios.length > 2
           ? `<button class="sc-del" type="button" onclick="scRemoveScenario(${i})" title="削除">✕</button>`
           : ''}
       </div>`
    ).join('');

    panel.classList.toggle('sc-panel--collapsed', _scCollapsed);
    panel.innerHTML =
      `<div class="sc-head" onclick="scToggleCollapse()" style="cursor:pointer;">
         <span class="sc-head-title">📊 シナリオ比較</span>
         <span class="sc-collapse-arrow">${_scCollapsed ? '▶' : '▼'}</span>
       </div>
       <div class="sc-body${_scEnabled ? '' : ' sc-body--off'}">
         <label class="sc-toggle" onclick="event.stopPropagation()">
           <input type="checkbox" id="scEnabledChk" ${_scEnabled ? 'checked' : ''}
                  onchange="scSetEnabled(this.checked)" />
           <span>有効</span>
         </label>
         <p class="sc-hint">倍率を変えた複数パターンの合計を比較します。<br>各行の 🔒 で固定費（倍率対象外）を指定できます。</p>
         <div class="sc-list">${listHtml}</div>
         ${_scScenarios.length < _SC_MAX
           ? `<button class="sc-add" type="button" onclick="scAddScenario()">＋ シナリオ追加</button>`
           : ''}
         <button class="sc-open-btn" type="button" onclick="openScenarioPreview()"
                 ${!_scEnabled ? 'disabled' : ''}>📊 比較プレビュー</button>
       </div>`;

    _scSyncRowToggles();
  }

  // ---------- 公開 API ----------

  function scToggleCollapse() {
    _scCollapsed = !_scCollapsed;
    _scRenderPanel();
  }

  function scSetEnabled(v) {
    _scEnabled = v;
    _scSave();
    _scRenderPanel();
  }

  function scUpdateScenario(idx, field, value) {
    if (_scScenarios[idx]) { _scScenarios[idx][field] = value; _scSave(); }
  }

  function scAddScenario() {
    if (_scScenarios.length >= _SC_MAX) return;
    const maxId = _scScenarios.reduce((m, s) => Math.max(m, s.id || 0), 0);
    _scScenarios.push({ id: maxId + 1, label: '', scale: 1 });
    _scSave();
    _scRenderPanel();
  }

  function scRemoveScenario(idx) {
    if (_scScenarios.length <= 2) return;
    _scScenarios.splice(idx, 1);
    _scSave();
    _scRenderPanel();
  }

  // ---------- 行の固定費トグル ----------

  function _scSyncRowToggles() {
    document.querySelectorAll('#tableBody tr[id^="row-"]').forEach(tr => _scApplyRowToggle(tr));
  }

  function _scApplyRowToggle(tr) {
    const existing = tr.querySelector('.sc-fixed-btn');
    if (!_scEnabled) { existing?.remove(); return; }
    if (existing) return;
    const handleCell = tr.querySelector('.handle-cell');
    if (!handleCell) return;
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'sc-fixed-btn';
    const isFixed = tr.dataset.scFixed === '1';
    btn.textContent = isFixed ? '🔒' : '🔓';
    btn.title = isFixed ? '固定費（倍率対象外）- クリックで解除' : '固定費として扱う（倍率を掛けない）';
    btn.classList.toggle('is-fixed', isFixed);
    btn.onclick = () => {
      const now = tr.dataset.scFixed === '1';
      tr.dataset.scFixed = now ? '0' : '1';
      btn.textContent = now ? '🔓' : '🔒';
      btn.title = now ? '固定費として扱う（倍率を掛けない）' : '固定費（倍率対象外）- クリックで解除';
      btn.classList.toggle('is-fixed', !now);
    };
    handleCell.appendChild(btn);
  }

  // ---------- 比較プレビュー ----------

  function openScenarioPreview() {
    if (!_scEnabled) return;
    const overlay = document.getElementById('scPreviewOverlay');
    if (!overlay) return;
    document.getElementById('scPreviewContent').innerHTML = _buildScenarioHtml();
    overlay.hidden = false;
  }

  function closeScenarioPreview(e) {
    if (e && e.target.id !== 'scPreviewOverlay') return;
    document.getElementById('scPreviewOverlay').hidden = true;
  }

  function printScenarioPreview() { window.print(); }

  function _buildScenarioHtml() {
    const scenarios = _scScenarios.filter(s => s.scale > 0);
    if (!scenarios.length) return '<p class="sc-empty">シナリオが設定されていません</p>';

    // 見積もり行データを収集
    const rows = [];
    document.querySelectorAll('#tableBody tr[id^="row-"]').forEach(tr => {
      const id   = tr.id.replace('row-', '');
      const name = (document.getElementById(`nm-${id}`)?.value || '').trim();
      if (!name) return;
      const bq      = parseFloat(document.getElementById(`bq-${id}`)?.value) || 1;
      const bc      = document.getElementById(`bc-${id}`)?.value || 'JPY';
      const bp      = parseFloat(document.getElementById(`bp-${id}`)?.value) || 0;
      const isFixed = tr.dataset.scFixed === '1';
      rows.push({ name, bq, bc, bp, isFixed });
    });

    if (!rows.length) return '<p class="sc-empty">見積もり行がありません</p>';

    const hdr  = typeof getQuoteHeader === 'function' ? getQuoteHeader() : {};
    const cond = typeof getConditions  === 'function' ? getConditions()  : {};

    const metaParts = [
      hdr.customer   ? `顧客：${escHtml(hdr.customer)}`        : '',
      cond.incoterms ? `インコタームズ：${escHtml(cond.incoterms)}` : '',
      cond.mode      ? `輸送モード：${escHtml(cond.mode)}`      : '',
    ].filter(Boolean);

    // 通貨別合計（シナリオごと）
    const totals = scenarios.map(() => ({}));

    const bodyRows = rows.map(r => {
      const fixedMark = r.isFixed ? ' <span class="sc-pv-fixed" title="固定費">🔒</span>' : '';
      const cells = scenarios.map((s, si) => {
        const scale  = r.isFixed ? 1 : s.scale;
        const amount = r.bq * scale * r.bp;
        totals[si][r.bc] = (totals[si][r.bc] || 0) + amount;
        const jpyHint = r.bc !== 'JPY' && typeof toJPY === 'function'
          ? `<small class="sc-pv-jpy">≈¥${fmtMoney(Math.ceil(toJPY(amount, r.bc)))}</small>` : '';
        return `<td class="sc-pv-amt">${escHtml(r.bc)} ${fmtMoney(amount)}${jpyHint}</td>`;
      }).join('');
      return `<tr>
        <td class="sc-pv-name">${escHtml(r.name)}${fixedMark}</td>
        ${cells}
      </tr>`;
    }).join('');

    const thScenarios = scenarios.map(s =>
      `<th class="sc-pv-th">${escHtml(s.label || ('×' + s.scale))}<br><small class="sc-pv-scale">×${s.scale}</small></th>`
    ).join('');

    const totalCells = scenarios.map((_, si) => {
      const ccyKeys = Object.keys(totals[si]).sort((a, b) =>
        a === 'JPY' ? -1 : b === 'JPY' ? 1 : a.localeCompare(b));
      const lines = ccyKeys.map(ccy => {
        const jpyHint = ccy !== 'JPY' && typeof toJPY === 'function'
          ? `<span class="sc-pv-jpy">≈¥${fmtMoney(Math.ceil(toJPY(totals[si][ccy], ccy)))}</span>` : '';
        return `${escHtml(ccy)} ${fmtMoney(totals[si][ccy])}${jpyHint}`;
      }).join('<br>');
      return `<td class="sc-pv-total">${lines}</td>`;
    }).join('');

    return `
      ${metaParts.length ? `<div class="sc-pv-meta">${metaParts.join(' &nbsp;｜&nbsp; ')}</div>` : ''}
      <div class="sc-pv-scroll">
      <table class="sc-pv-table">
        <thead><tr>
          <th class="sc-pv-th-name">項目名</th>
          ${thScenarios}
        </tr></thead>
        <tbody>${bodyRows}</tbody>
        <tfoot><tr>
          <td class="sc-pv-total-label">合　計</td>
          ${totalCells}
        </tr></tfoot>
      </table>
      </div>`;
  }

  // ---------- 初期化 ----------

  function initScenarios() {
    _scLoad();
    _scRenderPanel();

    // 行追加時にトグルボタンを自動付与
    const tbody = document.getElementById('tableBody');
    if (tbody && typeof MutationObserver !== 'undefined') {
      new MutationObserver(mutations => {
        if (!_scEnabled) return;
        mutations.forEach(m => {
          m.addedNodes.forEach(n => {
            if (n.nodeType === 1 && n.matches?.('tr[id^="row-"]')) _scApplyRowToggle(n);
          });
        });
      }).observe(tbody, { childList: true });
    }
  }

  // ---------- window 公開 ----------
  window.initScenarios        = initScenarios;
  window.scSetEnabled         = scSetEnabled;
  window.scToggleCollapse     = scToggleCollapse;
  window.scUpdateScenario     = scUpdateScenario;
  window.scAddScenario        = scAddScenario;
  window.scRemoveScenario     = scRemoveScenario;
  window.openScenarioPreview  = openScenarioPreview;
  window.closeScenarioPreview = closeScenarioPreview;
  window.printScenarioPreview = printScenarioPreview;
