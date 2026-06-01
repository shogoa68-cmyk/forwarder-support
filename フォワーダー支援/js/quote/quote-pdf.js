// ========== 御見積書フォーマット PDF 出力（案A：原本忠実型） ==========
// 見積タブの実データから、正式な御見積書レイアウトを生成して印刷（PDF保存）する。
// 依存: getQuoteHeader, collectAllRows, getConditions, getEffectiveTaxRate,
//       getCatLabel, toJPY（preview.js / ui.js で定義済み・window 経由で参照）

(function () {
  'use strict';

  const ISSUER_KEY = 'quoteIssuer_v1';
  const ISSUER_DEFAULT = {
    company: 'JCT株式会社',
    zip: '',
    address1: '東京都港区芝浦2-11-5',
    address2: '五十嵐ビルディング 3階',
    tel: '03-5765-7668',
    fax: '03-5765-7667',
    regno: '',     // インボイス登録番号（任意）
    greeting: '毎度格別のお引き立てを賜り、厚く御礼申し上げます。\n下記の通り、御見積り申し上げます。\n何卒ご用命の程、宜しくお願い申し上げます。',
  };

  function loadIssuer() {
    try {
      const v = JSON.parse(localStorage.getItem(ISSUER_KEY) || '{}');
      return Object.assign({}, ISSUER_DEFAULT, v);
    } catch (e) { return Object.assign({}, ISSUER_DEFAULT); }
  }
  function saveIssuer(obj) {
    try { localStorage.setItem(ISSUER_KEY, JSON.stringify(obj)); } catch (e) {}
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const nl2br = s => esc(s).replace(/\n/g, '<br>');
  const fmtInt = n => Math.round(n).toLocaleString('ja-JP');
  const fmtNum = (n, d) => Number(n).toLocaleString('ja-JP', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });

  // 小計テキストに ¥ を付与（「≈ 1,234」→「≈ ¥1,234」、「1,234」→「¥1,234」）
  function _yenSub(txt) {
    const s = String(txt == null ? '' : txt).trim();
    if (!s) return '';
    if (!/\d/.test(s)) return esc(s);          // 数値を含まない場合はそのまま
    const m = s.match(/^([^\d\-]*)(.*)$/);     // 先頭の記号（≈ 等）を分離
    const prefix = m ? m[1] : '';
    const rest   = m ? m[2] : s;
    return esc(prefix) + '¥' + esc(rest);
  }

  function _toJPY(amount, ccy) {
    if (typeof toJPY === 'function') return toJPY(amount, ccy);
    return (!ccy || ccy === 'JPY') ? amount : amount;
  }
  function _catLabel(v) {
    return (typeof getCatLabel === 'function') ? (getCatLabel(v) || '') : (v || '');
  }
  function _fmtJpDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[1]}/${m[2]}/${m[3]}` : iso;
  }
  function _todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  const _HONORIFIC_RE = /(様|さま|サマ|さん|御中|殿|先生|Mr\.|Ms\.|Mrs\.|Dear)\s*$/i;
  // 宛先の敬称を自動付与：
  //  - 担当者名あり → 「会社名　氏名 様」（個人宛は「様」）
  //  - 会社名のみ   → 「会社名 御中」（法人宛は「御中」）
  //  既に敬称が付いていれば追加しない
  function _formatRecipient(company, person) {
    const co = (company || '').trim();
    const pn = (person || '').trim();
    if (pn) {
      const honor = _HONORIFIC_RE.test(pn) ? '' : ' 様';
      return [co, pn + honor].filter(Boolean).join('　');
    }
    if (co) return _HONORIFIC_RE.test(co) ? co : co + ' 御中';
    return '';
  }

  // 危険品・特殊貨物の詳細を区分に応じて収集
  function _hazmatDetail(hazmat) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const parts = [];
    if (hazmat === '危険品あり（クラス要確認）') {
      if (v('hz-un'))        parts.push('UN' + v('hz-un').replace(/^UN/i, ''));
      if (v('hz-class'))     parts.push(v('hz-class'));
      if (v('hz-pg'))        parts.push(v('hz-pg'));
      if (v('hz-fire-law'))  parts.push('消防法 ' + v('hz-fire-law'));
      if (v('hz-psn'))       parts.push('PSN: ' + v('hz-psn'));
      if (v('hz-flash'))     parts.push('引火点 ' + v('hz-flash'));
    } else if (hazmat === '温度管理品（冷蔵）') {
      if (v('hz-temp-chill'))   parts.push('設定温度 ' + v('hz-temp-chill'));
      if (v('hz-reefer-chill')) parts.push(v('hz-reefer-chill'));
    } else if (hazmat === '温度管理品（冷凍）') {
      if (v('hz-temp-frozen'))   parts.push('設定温度 ' + v('hz-temp-frozen'));
      if (v('hz-reefer-frozen')) parts.push(v('hz-reefer-frozen'));
    } else if (hazmat === '重量物・大型貨物') {
      if (v('hz-heavy-weight')) parts.push('単体重量 ' + v('hz-heavy-weight'));
      if (v('hz-heavy-dim'))    parts.push('寸法 ' + v('hz-heavy-dim'));
      if (v('hz-heavy-equip'))  parts.push('機材 ' + v('hz-heavy-equip'));
    } else if (hazmat === 'その他（特記事項参照）') {
      if (v('hz-other-note')) parts.push(v('hz-other-note'));
    }
    return parts.join(' / ');
  }

  // 荷姿明細を読みやすい文字列に（cond-packing-data の JSON から）
  function _packingDetail() {
    try {
      const arr = JSON.parse(document.getElementById('cond-packing-data')?.value || '[]');
      const named = arr.filter(e => e && e.pkg);
      if (!named.length) return '';
      return named.map(e => {
        const dim = [e.l, e.w, e.h].every(x => x) ? `（${e.l}×${e.w}×${e.h}cm）` : '';
        return `${e.pkg} × ${e.qty || 1}${dim}`;
      }).join('、');
    } catch (e) { return ''; }
  }

  // 件名ブロックを引き合い条件から組み立てる（貨物・物量情報をすべて反映）
  function buildSubject(cond) {
    if (!cond) return { title: '', meta: [] };
    const dir = cond.direction === 'export' ? '輸出' : cond.direction === 'import' ? '輸入' : '';
    const titleParts = [dir + (cond.mode ? ' ' + cond.mode : '')].filter(Boolean);
    const route = [cond.pol, cond.pod].filter(Boolean).join(' to ');
    if (route) titleParts.push(route);
    const title = titleParts.join('　');

    const meta = [];
    const push = (k, v) => { if (v) meta.push([k, v]); };

    push('建値（INCOTERMS）', cond.incoterms);
    push('積み地（POL）', cond.pol);
    push('揚げ地（POD）', cond.pod);
    push('原産地', cond.origin);
    push('仕向地', cond.dest);
    push('コンテナ', cond.container);
    push('貨物名', cond.cargo);
    // HSコード（基本／特恵があれば併記）
    let hs = cond.hsCode || '';
    if (cond.hsBasic)  hs += (hs ? ' / ' : '') + '基本' + cond.hsBasic;
    if (cond.hsPref)   hs += (hs ? ' / ' : '') + '特恵' + cond.hsPref;
    push('HSコード', hs);
    if (cond.hsPrefNote) push('特恵備考', cond.hsPrefNote);
    // 危険品・特殊貨物
    if (cond.hazmat && cond.hazmat !== 'なし（一般貨物）') {
      const detail = _hazmatDetail(cond.hazmat);
      push('特殊貨物区分', cond.hazmat + (detail ? `（${detail}）` : ''));
    }
    // 物量情報
    push('荷姿明細', _packingDetail() || cond.packing);
    push('総重量', cond.weight);
    push('総容積', cond.volume);
    return { title, meta };
  }

  // 通貨別の適用レート一覧（行で使われている非JPY通貨）
  // レートは実際に JPY 換算で使われている値（_toJPY(1, ccy)）から取得する。
  // window._fxRates は未投入のことがあり「—」になってしまうため使わない。
  function collectRates(rows) {
    const out = {};
    rows.forEach(d => {
      if (d._type !== 'data') return;
      [d.pc, d.bc].forEach(c => {
        if (c && c !== 'JPY' && !(c in out)) {
          const rate = _toJPY(1, c);
          out[c] = (rate && rate !== 1) ? rate : null;
        }
      });
    });
    return out;
  }

  // ====== メイン：御見積書HTMLを生成 ======
  function buildQuoteDocHTML() {
    const hdr  = (typeof getQuoteHeader === 'function') ? getQuoteHeader() : {};
    const rows = (typeof collectAllRows === 'function') ? collectAllRows() : [];
    const cond = (typeof getConditions === 'function') ? getConditions() : null;
    const taxRate = (typeof getEffectiveTaxRate === 'function') ? getEffectiveTaxRate() : 0.10;
    const issuer = loadIssuer();

    const data = rows.filter(r => r._type === 'data');

    // 集計
    let taxableSub = 0, exemptSub = 0;
    const lineHTML = [];
    rows.forEach(r => {
      if (r._type === 'remark') {
        lineHTML.push(`<tr class="qd-remark"><td colspan="5">※ ${esc(r.text)}</td></tr>`);
        return;
      }
      if (r._type === 'subtotal') {
        lineHTML.push(`<tr class="qd-sub"><td colspan="4">${esc(r.label || '小計')}</td><td class="qd-num">${_yenSub(r.subtotalText)}</td></tr>`);
        return;
      }
      // data
      const sub = (r.bq || 0) * (r.bp || 0);                  // 請求通貨建ての金額
      const jpy = Math.ceil(_toJPY(sub, r.bc || 'JPY'));      // JPY換算
      if (r.taxed) taxableSub += jpy; else exemptSub += jpy;
      const isNonJpy = r.bc && r.bc !== 'JPY';
      const unitDisp = isNonJpy
        ? `${fmtNum(r.bp, 2)} ${esc(r.bc)}`
        : `${fmtInt(r.bp)} JPY`;
      // 御見積書は客先向け公式文書のため、社内メモ(r.note)は出力しない（E-1 備考漏洩対策）
      // 数量は金額の根拠（sub = bq×bp）と一致させる。未入力時に「1」を捏造しない（B/台帳 C）
      const qtyDisp = (r.bq && r.bq > 0) ? fmtNum(r.bq, 4) : '—';
      lineHTML.push(
        `<tr>
          <td class="qd-item">${r.taxed ? '<span class="qd-tax">*</span> ' : ''}${esc(r.name)}</td>
          <td class="qd-num">${qtyDisp}</td>
          <td class="qd-ctr">${esc(r.un || '')}</td>
          <td class="qd-num">${unitDisp}</td>
          <td class="qd-num">¥${fmtInt(jpy)}</td>
        </tr>`
      );
    });

    const tax   = Math.floor(taxableSub * taxRate);
    const total = taxableSub + exemptSub + tax;

    const subj = buildSubject(cond);
    const rates = collectRates(rows);
    const rateRows = ['JPY', ...Object.keys(rates)]
      .map(c => `<tr><td class="qd-ctr">${esc(c)}</td><td class="qd-num">${c === 'JPY' ? '1.00' : (rates[c] != null ? fmtNum(rates[c], 2) : '—')}</td></tr>`)
      .join('');
    const fxMeta = (typeof getFxAuditMeta === 'function') ? getFxAuditMeta() : null;
    const fxMetaNote = fxMeta
      ? `<div style="font-size:9px;color:#666;margin-top:4px;line-height:1.5;">${esc(fxMeta.fxLine)}<br>${esc(fxMeta.created)}</div>`
      : '';

    const dateStr  = _fmtJpDate(hdr.date || _todayIso());
    const validStr = _fmtJpDate(hdr.validUntil);
    const custName = _formatRecipient(hdr.customer, hdr.person) || '（宛先未入力）';

    const issuerAddr = [
      issuer.zip ? '〒' + esc(issuer.zip) : '',
      esc(issuer.address1), esc(issuer.address2),
      issuer.tel ? 'TEL: ' + esc(issuer.tel) : '',
      issuer.fax ? 'FAX: ' + esc(issuer.fax) : '',
      issuer.regno ? '登録番号: ' + esc(issuer.regno) : '',
    ].filter(Boolean).join('<br>');

    const metaRows = subj.meta.map(([k, v]) =>
      `<div class="qd-srow"><span class="qd-sk">${esc(k)}</span><span class="qd-sv">${esc(v)}</span></div>`
    ).join('');

    return `
    <div class="qd-page">
      <div class="qd-top"><span></span><span>DATE：${esc(dateStr)}　　PAGE：1 / 1</span></div>
      <div class="qd-title">御 見 積 書</div>

      <div class="qd-head">
        <div class="qd-to">
          <div class="qd-cust">${esc(custName)}</div>
          <div class="qd-greet">${nl2br(issuer.greeting)}</div>
        </div>
        <div class="qd-from">
          <div class="qd-co">${esc(issuer.company) || '<span class="qd-placeholder">（発行元会社名を設定してください）</span>'}</div>
          <div class="qd-no">見積書NO: ${esc(hdr.ref) || '—'}</div>
          <div class="qd-addr">${issuerAddr || '<span class="qd-placeholder">（住所・連絡先を設定）</span>'}</div>
        </div>
      </div>

      <div class="qd-subj">
        ${subj.title ? `<div class="qd-subj-ttl">${esc(subj.title)}</div>` : ''}
        ${metaRows ? `<div class="qd-meta">${metaRows}</div>` : ''}
        <div class="qd-amt-row">
          <span>御見積額${validStr ? `　<span class="qd-valid">本見積書有効期限：${esc(validStr)}</span>` : ''}</span>
          <span class="qd-amt">¥ ${fmtInt(total)} <span class="qd-jpy">(JPY)</span></span>
        </div>
      </div>

      <table class="qd-items">
        <thead><tr>
          <th class="qd-item">見積項目／摘要</th><th>数量</th><th>単位</th><th>単価</th><th>金額(JPY)</th>
        </tr></thead>
        <tbody>${lineHTML.join('')}</tbody>
      </table>

      <div class="qd-foot">
        <div class="qd-notes">
          <b>見積項目（＊印は課税対象取引です）</b>
        </div>
        <div class="qd-rate">
          <table>
            <tr><td class="qd-ctr qd-rh">通貨</td><td class="qd-ctr qd-rh">レート</td></tr>
            ${rateRows}
          </table>
          ${fxMetaNote}
        </div>
        <div class="qd-sum">
          <table>
            <tr><td class="qd-sk2">小計（免税分）</td><td class="qd-num">¥${fmtInt(exemptSub)}</td></tr>
            <tr><td class="qd-sk2">課税対象小計</td><td class="qd-num">¥${fmtInt(taxableSub)}</td></tr>
            <tr><td class="qd-sk2">消費税（${Math.round(taxRate * 100)}%）</td><td class="qd-num">¥${fmtInt(tax)}</td></tr>
            <tr class="qd-total"><td>合計見積額</td><td class="qd-num">¥${fmtInt(total)}</td></tr>
          </table>
        </div>
      </div>
      ${(() => {
        const rt = (typeof getRemarkText === 'function') ? getRemarkText() : (cond && cond.free) || '';
        return rt ? `<div class="qd-remark-block"><div class="qd-remark-ttl">📝 条件・免責事項（全体リマーク）</div><div class="qd-remark-body">${esc(rt).replace(/\n/g, '<br>')}</div></div>` : '';
      })()}
    </div>`;
  }

  // ====== 発行元 設定フォーム ======
  function issuerFormHTML(issuer) {
    const f = (k, label, ph) =>
      `<label class="qd-fld"><span>${label}</span><input type="text" data-issuer="${k}" value="${esc(issuer[k])}" placeholder="${ph || ''}"></label>`;
    return `
      <div class="qd-issuer-form">
        <div class="qd-issuer-ttl">📇 発行元情報（この内容が御見積書の右上に表示されます）</div>
        <div class="qd-fld-grid">
          ${f('company', '会社名', '例）〇〇物流株式会社')}
          ${f('regno', 'インボイス登録番号', '例）T1234567890123')}
          ${f('zip', '郵便番号', '例）105-0023')}
          ${f('tel', 'TEL', '例）03-0000-0000')}
          ${f('address1', '住所1', '例）東京都港区芝浦2-11-5')}
          ${f('fax', 'FAX', '例）03-0000-0001')}
          ${f('address2', '住所2（building等）', '例）〇〇ビルディング 3階')}
        </div>
        <label class="qd-fld qd-fld-wide"><span>挨拶文</span><textarea data-issuer="greeting" rows="2">${esc(issuer.greeting)}</textarea></label>
      </div>`;
  }

  // ====== オーバーレイ表示 ======
  function openQuoteDoc() {
    const data = (typeof collectAllRows === 'function') ? collectAllRows().filter(r => r._type === 'data') : [];
    if (!data.length) { alert('見積もり行がありません。'); return; }

    let overlay = document.getElementById('quoteDocOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'quoteDocOverlay';
      overlay.innerHTML = `
        <div class="qd-shell">
          <div class="qd-toolbar">
            <span class="qd-tb-title">📄 御見積書フォーマット（PDF出力）</span>
            <button class="qd-tb-btn" id="qdEditIssuer">📇 発行元設定</button>
            <button class="qd-tb-btn qd-tb-print" id="qdPrint">🖨️ PDF出力（印刷）</button>
            <button class="qd-tb-btn" id="qdClose">閉じる</button>
          </div>
          <div class="qd-issuer-wrap" id="qdIssuerWrap" style="display:none;"></div>
          <div class="qd-preview" id="qdPreview"></div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) closeQuoteDoc(); });
      overlay.querySelector('#qdClose').addEventListener('click', closeQuoteDoc);
      overlay.querySelector('#qdPrint').addEventListener('click', printQuoteDoc);
      overlay.querySelector('#qdEditIssuer').addEventListener('click', toggleIssuerForm);
    }
    refreshQuoteDoc();
    overlay.classList.add('open');
    document.body.classList.add('qd-printing-ready');
  }

  function refreshQuoteDoc() {
    const prev = document.getElementById('qdPreview');
    if (prev) prev.innerHTML = buildQuoteDocHTML();
  }

  function toggleIssuerForm() {
    const wrap = document.getElementById('qdIssuerWrap');
    if (!wrap) return;
    if (wrap.style.display === 'none') {
      wrap.innerHTML = issuerFormHTML(loadIssuer());
      wrap.style.display = 'block';
      wrap.querySelectorAll('[data-issuer]').forEach(inp => {
        inp.addEventListener('input', () => {
          // インボイス登録番号は T + 13桁の形式チェック（空は許容）
          if (inp.dataset.issuer === 'regno' && inp.value) {
            const valid = /^T\d{13}$/.test(inp.value);
            inp.style.borderColor = valid ? '' : '#c0392b';
            inp.title = valid ? '' : '形式が正しくありません（例：T1234567890123）';
          } else if (inp.dataset.issuer === 'regno') {
            inp.style.borderColor = '';
            inp.title = '';
          }
          const cur = loadIssuer();
          cur[inp.dataset.issuer] = inp.value;
          saveIssuer(cur);
          refreshQuoteDoc();
        });
      });
    } else {
      wrap.style.display = 'none';
    }
  }

  function closeQuoteDoc() {
    const o = document.getElementById('quoteDocOverlay');
    if (o) o.classList.remove('open');
    document.body.classList.remove('qd-printing-ready');
  }

  function printQuoteDoc() {
    document.body.classList.add('qd-print-mode');
    window.print();
    setTimeout(() => document.body.classList.remove('qd-print-mode'), 300);
  }

  // export
  window.openQuoteDoc = openQuoteDoc;
  window.closeQuoteDoc = closeQuoteDoc;
  window.printQuoteDoc = printQuoteDoc;
  window.buildQuoteDocHTML = buildQuoteDocHTML;
})();
