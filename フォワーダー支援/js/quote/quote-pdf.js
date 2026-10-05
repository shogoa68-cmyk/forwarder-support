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
    // 英語出力（「🌐 英語で出力」ON）用。空欄の項目は日本語の値にフォールバックする
    // （挨拶文のみ標準の英文を初期値として持つ）
    companyEn: '', address1En: '', address2En: '',
    greetingEn: 'Thank you for your continued support.\nPlease find our quotation below.\nWe look forward to your favorable consideration.',
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

  // 合計・税サマリ非表示オプション（パターン比較用途）。御見積書出力のみに作用。
  const HIDE_TOTAL_KEY = 'quoteDocHideTotal_v1';
  function loadHideTotal() {
    try { return localStorage.getItem(HIDE_TOTAL_KEY) === '1'; } catch (e) { return false; }
  }
  // PDF 出力後にステータスを「提示済み」へ進めるか（既定 ON）
  const AUTO_STATUS_KEY = 'quoteDocAutoStatus_v1';
  function loadAutoStatus() {
    try { return localStorage.getItem(AUTO_STATUS_KEY) !== '0'; } catch (e) { return true; }
  }
  function saveAutoStatus(on) {
    try { localStorage.setItem(AUTO_STATUS_KEY, on ? '1' : '0'); } catch (e) {}
  }
  function saveHideTotal(on) {
    try { localStorage.setItem(HIDE_TOTAL_KEY, on ? '1' : '0'); } catch (e) {}
  }

  // 英語出力オプション（海外客先向け）。御見積書PDFの固定ラベル（見出し・項目名・
  // 合計欄等）のみを英訳する。品名・備考・サブコン名等のユーザー入力本文（自由記述）は
  // 対象外で日本語のまま出力される（別途翻訳が必要な場合は手動で英語入力すること）。
  const LANG_EN_KEY = 'quoteDocLangEn_v1';
  function loadLangEn() {
    try { return localStorage.getItem(LANG_EN_KEY) === '1'; } catch (e) { return false; }
  }
  function saveLangEn(on) {
    try { localStorage.setItem(LANG_EN_KEY, on ? '1' : '0'); } catch (e) {}
  }

  // 固定ラベル対訳表。t(key) は現在の出力言語（_curLangEn）に応じて日本語/英語を返す。
  const LABELS = {
    docTitle:       ['御 見 積 書', 'QUOTATION'],
    quoteNo:        ['見積書NO', 'Quote No.'],
    date:           ['DATE', 'Date'],
    page:           ['PAGE', 'Page'],
    itemCol:        ['見積項目／摘要', 'Description'],
    qtyCol:         ['数量', 'Qty'],
    unitCol:        ['単位', 'Unit'],
    priceCol:       ['単価', 'Unit Price'],
    amountCol:      ['金額(JPY)', 'Amount (JPY)'],
    totalAmount:    ['御見積額', 'Total Quotation'],
    validUntil:     ['本見積書有効期限', 'Valid Until'],
    notesTitle:     ['見積項目（＊印は課税対象取引です）', 'Items marked with * are subject to consumption tax.'],
    currency:       ['通貨', 'Currency'],
    rate:           ['レート', 'Rate'],
    exemptSub:      ['小計（免税分）', 'Subtotal (Tax-exempt)'],
    taxableSub:     ['課税対象小計', 'Taxable Subtotal'],
    tax:            ['消費税', 'Consumption Tax'],
    grandTotal:     ['合計見積額', 'Grand Total'],
    subtotal:       ['小計', 'Subtotal'],
    incoterms:      ['建値（INCOTERMS）', 'Incoterms'],
    route:          ['航路', 'Route'],
    pol:            ['積み地（POL）', 'Port of Loading (POL)'],
    pod:            ['揚げ地（POD）', 'Port of Discharge (POD)'],
    originPickup:   ['集荷地', 'Pickup Location'],
    origin:         ['発地', 'Origin'],
    dest:           ['仕向地', 'Destination'],
    container:      ['コンテナ', 'Container'],
    cargo:          ['貨物名', 'Cargo'],
    hsCode:         ['HSコード', 'HS Code'],
    hsPrefNote:     ['特恵備考', 'Preferential Tariff Note'],
    hazmat:         ['特殊貨物区分', 'Special Cargo Type'],
    cargoInfo:      ['物量情報', 'Cargo Details'],
    packing:        ['荷姿明細', 'Packing Details'],
    weight:         ['総重量', 'Total Weight'],
    volume:         ['総容積', 'Total Volume'],
    regno:          ['登録番号', 'Registration No.'],
    noRecipient:    ['（宛先未入力）', '(Recipient not entered)'],
    scopeTitle:     ['🛠️ 作業範囲', '🛠️ Scope of Work'],
    remarksTitle:   ['📝 条件・免責事項（全体リマーク）', '📝 Terms & Remarks'],
    revisionTitle:  ['🔄 前回提示分からの変更点', '🔄 Changes from Previous Version'],
    estimateTag:    ['約', 'Approx.'],
    unpriced:       ['実費', 'At Cost'],
    conditional:    ['（発生時/必要時のみ）', '(If applicable)'],
    reference:      ['（参考情報）', '(For reference)'],
    noPattern:      ['（パターン未設定）', '(No pattern)'],
    noSubcon:       ['（サブコン未設定）', '(No subcontractor)'],
    noCategory:     ['— カテゴリ —', '— Uncategorized —'],
  };
  // 方向（輸出/輸入）・輸送モード・特殊貨物区分は選択式の固定セットなので、
  // 値（cond.direction は内部コード、mode/hazmat は選択肢テキストそのもの）で引ける対訳表を別途用意する
  const DIRECTION_EN = { export: 'Export', import: 'Import' };
  const MODE_EN = {
    '海上（FCL）': 'Ocean (FCL)', '海上（LCL）': 'Ocean (LCL)', '海上（RORO）': 'Ocean (RORO)',
    '海上（在来船）': 'Ocean (Conventional)', '航空（AIR）': 'Air', '海上＋陸上': 'Ocean + Inland',
    '航空＋陸上': 'Air + Inland', '陸上のみ': 'Inland Only', '国内手配のみ': 'Domestic Arrangement Only',
  };
  const HAZMAT_EN = {
    'なし（一般貨物）': 'None (General Cargo)',
    '危険品あり（クラス要確認）': 'Hazardous (Class TBC)',
    '温度管理品（冷蔵）': 'Temperature-Controlled (Chilled)',
    '温度管理品（冷凍）': 'Temperature-Controlled (Frozen)',
    '重量物・大型貨物': 'Heavy / Oversized Cargo',
    'その他（特記事項参照）': 'Other (See Remarks)',
  };
  // カテゴリーは value コード（'ocean'/'air' 等）で引く（絵文字＋日本語の表示ラベルを直接は訳さない）
  const CAT_EN = {
    domestic: 'Domestic Handling', 'export-local': 'Export Local Charges', ocean: 'Ocean Freight',
    air: 'Air Freight', surcharge: 'Surcharge', 'import-local': 'Import Local Charges',
    overseas: 'Overseas Handling', 'customs-export': 'Customs Clearance (Export)',
    'customs-import': 'Customs Clearance (Import)', insurance: 'Insurance', 'domestic-transport': 'Domestic Transport',
    warehouse: 'Warehousing', 'packing-cost': 'Packing', other: 'Other',
  };
  let _curLangEn = false;   // buildQuoteDocHTML() 実行中だけ有効な出力言語フラグ
  function t(key) {
    const pair = LABELS[key];
    if (!pair) return key;
    return _curLangEn ? pair[1] : pair[0];
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
    // 末尾に通貨コードが付く外貨建て小計（例 "1,234 USD"）は ¥ を付けない（通貨二重表記防止）
    if (/\s[A-Za-z]{2,4}$/.test(s)) return esc(s);
    const m = s.match(/^([^\d\-]*)(.*)$/);     // 先頭の記号（≈ 等）を分離
    const prefix = m ? m[1] : '';
    const rest   = m ? m[2] : s;
    return esc(prefix) + '¥' + esc(rest);
  }

  // 課税行の品名から先頭の課税マーク * を1つ除去（表示直前）。
  // * は row.js が課税ON時に品名へ付与する内部マーカー。御見積書では別途
  // qd-tax スパンで * を描画するため、二重 * を避けてここで取り除く。
  function _taxName(name, taxed) {
    const s = String(name == null ? '' : name);
    const jaName = taxed ? s.replace(/^\*\s?/, '') : s;
    // 英語出力時：品名マスター（MD_SCHEMA.nm の「英語品名」details.enName）に登録があれば
    // それを使う。未登録の品名はそのまま日本語品名を出力する（品名ごとに個別マスター
    // 登録した分だけ段階的に英語化が進む設計。備考等の他の自由記述は対象外）
    if (_curLangEn) {
      const rec = (typeof window.mdGet === 'function') ? window.mdGet('nm', jaName) : null;
      const en = rec && rec.details && rec.details.enName && String(rec.details.enName).trim();
      if (en) return en;
    }
    return jaName;
  }

  function _toJPY(amount, ccy) {
    if (typeof toJPY === 'function') return toJPY(amount, ccy);
    return (!ccy || ccy === 'JPY') ? amount : amount;
  }
  function _catLabel(v) {
    if (_curLangEn && !v) return t('noCategory');
    if (_curLangEn) return CAT_EN[v] || (typeof getCatLabel === 'function' ? (getCatLabel(v) || '') : (v || ''));
    return (typeof getCatLabel === 'function') ? (getCatLabel(v) || '') : (v || '');
  }
  function _fmtJpDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[1]}/${m[2]}/${m[3]}` : iso;
  }
  function _todayIso() {
    return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Tokyo' }); // "YYYY-MM-DD" JST
  }

  const _HONORIFIC_RE = /(様|さま|サマ|さん|御中|殿|先生|Mr\.|Ms\.|Mrs\.|Dear)\s*$/i;

  function _defaultPdfTitle() {
    const hdr = typeof getQuoteHeader === 'function' ? getQuoteHeader() : {};
    const safe = s => String(s || '').replace(/[\/\\:*?"<>|\t\n\r]/g, '_').replace(/_+/g, '_').trim().slice(0, 40);
    const personH = hdr.person && window.formatPersonWithHonorific
      ? window.formatPersonWithHonorific(hdr.person) : (hdr.person || '');
    // 複数の物量パターンを使っている案件では、現在出力対象のパターン名もファイル名に
    // 反映する（パターンA/Bをそれぞれ出力したときに上書きし合わないように）
    const patternName = (typeof window.getActivePatternName === 'function') ? window.getActivePatternName() : null;
    const parts = [hdr.ref, hdr.customer, personH, patternName].map(safe).filter(Boolean);
    if (parts.length) return parts.join('_');
    const today = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Tokyo' }).replace(/-/g, '');
    return '御見積書_' + today;
  }
  // 宛先の敬称を自動付与：
  //  - 担当者名あり → 「会社名　氏名 様」（個人宛は「様」）
  //  - 会社名のみ   → 「会社名 御中」（法人宛は「御中」）
  //  既に敬称が付いていれば追加しない
  function _formatRecipient(company, person) {
    const co = (company || '').trim();
    const pn = (person || '').trim();
    // 英語出力では日本語の敬称（様／御中）は付けない（名前・社名部分は自由記述のため訳さずそのまま出す）
    if (_curLangEn) return [co, pn].filter(Boolean).join('\n');
    if (pn) {
      const honor = _HONORIFIC_RE.test(pn) ? '' : ' 様';
      // 会社名と担当者名は改行して分ける（同じ行に詰めると幅次第で
      // 担当者名の途中（例：「鈴木」→「鈴」「木」）で折り返されてしまうため）
      return [co, pn + honor].filter(Boolean).join('\n');
    }
    if (co) return _HONORIFIC_RE.test(co) ? co : co + ' 御中';
    return '';
  }

  // 危険品「危険品あり」区分の複数件対応：登録済みエントリ（複数可）を行ごとの文字列配列で返す。
  // 1件も「＋ 追加」せずフォームに直接入力しただけの場合（旧来の単一入力の使い方）は、
  // フォームの現在値を1件として返す（後方互換）。
  function _hazEntryLines() {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const fmt = (typeof window.getHazEntryLabel === 'function') ? window.getHazEntryLabel : (() => '');
    const entries = (typeof window.getHazEntries === 'function') ? window.getHazEntries() : [];
    if (entries.length) return entries.map(fmt).filter(Boolean);
    const single = fmt({ un: v('hz-un'), cls: v('hz-class'), pg: v('hz-pg'), pi: v('hz-pi'),
                          fireLaw: v('hz-fire-law'), psn: v('hz-psn'), flash: v('hz-flash') });
    return single ? [single] : [];
  }

  // 危険品・特殊貨物の詳細を区分に応じて収集（「危険品あり」以外の区分用。
  // 「危険品あり」は複数件対応のため _hazEntryLines() を別途使う）
  function _hazmatDetail(hazmat) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const parts = [];
    if (hazmat === '温度管理品（冷蔵）') {
      if (v('hz-temp-chill'))   parts.push((_curLangEn ? 'Set temp. ' : '設定温度 ') + v('hz-temp-chill'));
      if (v('hz-reefer-chill')) parts.push(v('hz-reefer-chill'));
    } else if (hazmat === '温度管理品（冷凍）') {
      if (v('hz-temp-frozen'))   parts.push((_curLangEn ? 'Set temp. ' : '設定温度 ') + v('hz-temp-frozen'));
      if (v('hz-reefer-frozen')) parts.push(v('hz-reefer-frozen'));
    } else if (hazmat === '重量物・大型貨物') {
      if (v('hz-heavy-weight')) parts.push((_curLangEn ? 'Unit weight ' : '単体重量 ') + v('hz-heavy-weight'));
      if (v('hz-heavy-dim'))    parts.push((_curLangEn ? 'Dimensions ' : '寸法 ') + v('hz-heavy-dim'));
      if (v('hz-heavy-equip'))  parts.push((_curLangEn ? 'Equipment ' : '機材 ') + v('hz-heavy-equip'));
    } else if (hazmat === 'その他（特記事項参照）') {
      if (v('hz-other-note')) parts.push(v('hz-other-note'));
    }
    return parts.join(' / ');
  }

  // 荷姿明細を読みやすい文字列に（寸法・重量・段積みを含む。conditions.js の共通実装）
  function _packingDetail() {
    return (typeof window.getPackingDetailText === 'function') ? window.getPackingDetailText() : '';
  }

  // 件名ブロックを引き合い条件から組み立てる（貨物・物量情報をすべて反映）
  function buildSubject(cond) {
    if (!cond) return { title: '', meta: [] };
    const dir = _curLangEn
      ? (DIRECTION_EN[cond.direction] || '')
      : (cond.direction === 'export' ? '輸出' : cond.direction === 'import' ? '輸入' : '');
    const modeDisp = _curLangEn ? (MODE_EN[cond.mode] || cond.mode || '') : (cond.mode || '');
    const titleParts = [dir + (modeDisp ? ' ' + modeDisp : '')].filter(Boolean);
    const _hasRoutes = cond.routes && cond.routes.length >= 1;
    const _multiRoute = cond.routes && cond.routes.length > 1;
    // 件名の航路：ルート情報から via を含めて組み立て
    let route = '';
    if (_hasRoutes) {
      const r0 = cond.routes[0];
      const r0leg = [r0.pol, r0.via, r0.pod].filter(Boolean).join(' → ');
      route = _multiRoute
        ? (r0leg + (_curLangEn ? ` +${cond.routes.length - 1} more` : ` 他${cond.routes.length - 1}航路`))
        : r0leg;
    } else {
      route = [cond.pol, cond.pod].filter(Boolean).join(' → ');
    }
    if (route) titleParts.push(route);
    const title = titleParts.join('　');

    const meta = [];
    const push = (k, v) => { if (v) meta.push([k, v]); };

    push(t('incoterms'), cond.incoterms);
    // 航路：1件以上の登録があれば航路ごとに via・キャリア・サービス名を含めて全件併記
    if (_hasRoutes) {
      cond.routes.forEach((r, i) => {
        const rt = [r.pol, r.via, r.pod].filter(Boolean).join(' → ');
        const carrier = (typeof window.formatRouteCarrierLine === 'function')
          ? window.formatRouteCarrierLine(r)
          : [r.carrier, r.service ? `(${r.service})` : ''].filter(Boolean).join(' ');
        const tt = r.tt ? `T/T: ${r.tt}` : '';
        const label = cond.routes.length === 1 ? t('route') : `${t('route')} ${i + 1}`;
        if (rt || carrier || tt) push(label, [carrier, rt, tt].filter(Boolean).join('　'));
      });
    } else {
      push(t('pol'), cond.pol);
      push(t('pod'), cond.pod);
    }
    // 出発地側ラベル：輸出は「集荷地」（原産地＝customs の原産地と混同しないため）。輸入・未設定は中立的に「発地」
    push(cond.direction === 'export' ? t('originPickup') : t('origin'), cond.origin);
    push(t('dest'), cond.dest);
    push(t('container'), cond.container);
    push(t('cargo'), cond.cargo);
    // HSコード（基本／特恵があれば併記）
    let hs = cond.hsCode || '';
    if (cond.hsBasic)  hs += (hs ? ' / ' : '') + (_curLangEn ? 'Standard ' : '基本') + cond.hsBasic;
    if (cond.hsPref)   hs += (hs ? ' / ' : '') + (_curLangEn ? 'Preferential ' : '特恵') + cond.hsPref;
    push(t('hsCode'), hs);
    if (cond.hsPrefNote) push(t('hsPrefNote'), cond.hsPrefNote);
    // 危険品・特殊貨物：「危険品あり」は複数件登録できるため、航路と同様に1件ずつ行を分けて出力する
    if (cond.hazmat === '危険品あり（クラス要確認）') {
      const lines = _hazEntryLines();
      if (lines.length) {
        lines.forEach((line, i) => {
          const label = lines.length === 1 ? t('hazmat') : `${t('hazmat')} ${i + 1}`;
          push(label, line);
        });
      } else {
        push(t('hazmat'), _curLangEn ? (HAZMAT_EN[cond.hazmat] || cond.hazmat) : cond.hazmat);
      }
    } else if (cond.hazmat && cond.hazmat !== 'なし（一般貨物）') {
      const detail = _hazmatDetail(cond.hazmat);
      const hazDisp = _curLangEn ? (HAZMAT_EN[cond.hazmat] || cond.hazmat) : cond.hazmat;
      push(t('hazmat'), hazDisp + (detail ? `（${detail}）` : ''));
    }
    // 物量情報：複数パターン案件はパターンごとのツリー形式で1行にまとめ、
    // 【パターンA】が項目ごとに繰り返し表示されるのを避ける。単一パターンの
    // 案件では従来通り3項目に分けて表示する（見た目を変えない）。
    if (cond.cargoPatternTree) {
      push(t('cargoInfo'), cond.cargoPatternTree);
    } else {
      push(t('packing'), _packingDetail() || cond.packing);
      push(t('weight'), cond.weight);
      push(t('volume'), cond.volume);
    }
    // 課金基準の目安：LCL は R/T、AIR は CW（容積重量課金）を表示。
    // 貨物情報（サイズ・重量）が入力されている場合のみ。
    const _billing = (typeof window.getCargoBillingLine === 'function') ? window.getCargoBillingLine(cond.mode) : null;
    if (_billing) push(_billing.label, _billing.value);
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
  // conditions.js の荷姿明細・課金重量などの文言関数にも出力言語を伝える（window._outputLangEn）。
  // 同期処理の間だけ有効にし、終わったら必ず戻す（プレビュー・メール等の日本語出力に影響させない）
  function buildQuoteDocHTML() {
    _curLangEn = loadLangEn();
    window._outputLangEn = _curLangEn;
    try { return _buildQuoteDocHTMLInner(); }
    finally { window._outputLangEn = false; }
  }
  function _buildQuoteDocHTMLInner() {
    _curLangEn = loadLangEn();   // この描画中だけ有効な出力言語（固定ラベルのみ英訳。品名等の自由記述は対象外）
    const hdr  = (typeof getQuoteHeader === 'function') ? getQuoteHeader() : {};
    const rows = (typeof collectAllRows === 'function') ? collectAllRows().filter(r => !r._hideQuote) : [];  // 見積書非表示の行は出力しない
    const cond = (typeof getConditions === 'function') ? getConditions() : null;
    const taxRate = (typeof getEffectiveTaxRate === 'function') ? getEffectiveTaxRate() : 0.10;
    const issuer0 = loadIssuer();
    const issuer = _curLangEn
      ? Object.assign({}, issuer0, {
          company:  (issuer0.companyEn  || '').trim() || issuer0.company,
          address1: (issuer0.address1En || '').trim() || issuer0.address1,
          address2: (issuer0.address2En || '').trim() || issuer0.address2,
          greeting: (issuer0.greetingEn || '').trim() || issuer0.greeting,
        })
      : issuer0;
    const hideTotal = loadHideTotal();   // 合計・税サマリを隠す（パターン比較用途）
    // 前回提示分からの変更点（🔄 更新でスナップショットが取られている場合のみ）。
    // 明細テーブルの行ハイライトと末尾の変更点ブロックの両方でこの1回の計算結果を使う。
    const _revDiff  = (typeof window.computeRevisionDiff === 'function') ? window.computeRevisionDiff() : null;
    const _revMarks = _revDiff ? _revDiff.rowMarks : {};

    const data = rows.filter(r => r._type === 'data');

    // 集計
    let taxableSub = 0, exemptSub = 0, taxSum = 0;
    const lineHTML = [];
    // サブコン別グループが有効（2+ サブコン）なら、グループ境界に売値小計を挿入（顧客向けのため金額のみ）
    // 揺らぎ吸収：境界判定・エイリアス参照は正規化キーで、表示は元の綴りで行う
    const _scNorm    = d => (subconNormKey(d.sv) || '（サブコン未設定）');
    const _scLabelOf = d => ((d.sv || '').trim() || t('noSubcon'));
    const _ptNorm    = d => (d.pt || '').trim();
    // サブコンごとのパターン種類数を事前集計（パターン別表示の有無を判定）
    const scPatternSets = {};
    data.forEach(d => {
      const sk = _scNorm(d);
      if (!scPatternSets[sk]) scPatternSets[sk] = new Set();
      scPatternSets[sk].add(_ptNorm(d));
    });
    const _scActive = (new Set(data.map(_scNorm)).size >= 2);
    let _scKey = null, _scLabel = null, _scHeadLabel = null, _scJpy = 0, _scHas = false;
    let _catKey = null;   // サブコン内の現在カテゴリ（サブコンが変わると null にリセット）
    let _ptActive = false, _ptSubOn = false, _ptKey = null, _ptJpy = 0, _ptHas = false;
    const _ptPush = () => {
      // パターン小計はサブコン内に2パターン以上あるときだけ出す
      // （1パターンのみだと直後のサブコン小計と同額の小計行が2行並び冗長）
      if (_ptActive && _ptSubOn && _ptHas) {
        // パターン名は見出し行に表示済みのため、小計行では繰り返さず「小計」のみ
        lineHTML.push(`<tr class="qd-pattern-sub"><td colspan="4">↳ ${t('subtotal')}</td><td class="qd-num">¥${fmtInt(_ptJpy)}</td></tr>`);
      }
      _ptJpy = 0; _ptHas = false;
    };
    const _scPush = () => {
      _ptPush(); // サブコン小計前にパターン小計をフラッシュ
      if (_scActive && _scHas) {
        // サブコン小計はページが分かれると見出し行が前ページに残り会社名が分からなくなるため、
        // 「小計」だけでなくサブコン名も併記する（例：「SEABRIDGE 小計」）
        lineHTML.push(`<tr class="qd-subcon-sub"><td colspan="4">↳ ${esc(_scHeadLabel || '')} ${t('subtotal')}</td><td class="qd-num">¥${fmtInt(_scJpy)}</td></tr>`);
      }
    };
    rows.forEach(r => {
      if (r._type === 'remark') {
        if (r.internal) return; // 社内メモは PDF に出力しない
        lineHTML.push(`<tr class="qd-remark"><td colspan="5">※ ${esc(r.text)}</td></tr>`);
        return;
      }
      if (r._type === 'subtotal') {
        lineHTML.push(`<tr class="qd-sub"><td colspan="4">${esc(r.label || t('subtotal'))}</td><td class="qd-num">${_yenSub(r.subtotalText)}</td></tr>`);
        return;
      }
      // data
      const sub = (r.bq || 0) * (r.bp || 0);                  // 請求通貨建ての金額
      const jpy = Math.ceil(_toJPY(sub, r.bc || 'JPY'));      // JPY換算
      // 外貨建ては輸出免税が原則（Excel/プレビューと同一ポリシー）。課税は JPY 建て行のみ。
      // 消費税は行ごとに切り上げて積み上げ、各出力経路（御見積書/プレビュー/Excel）で一致させる。
      const isActual = r._actual;   // 実費（金額未確定・合計除外・単価/金額は「実費」表示）
      const isCond   = r._cond;     // 都度請求（発生時のみ・金額は表示・合計に加算しない）
      const isRef    = r._ref;      // 参考情報（金額は表示・合計に加算しない）
      if (!isActual && !isCond && !isRef) {
        if (r.taxed && (r.bc || 'JPY') === 'JPY') {
          taxableSub += jpy;
          taxSum += Math.ceil(jpy * taxRate);
        } else {
          exemptSub += jpy;
        }
      }
      const isNonJpy = r.bc && r.bc !== 'JPY';
      // 概算（金額は目安）：合計には通常どおり加算するが、単価・金額の前に「約」を付ける
      const isEstimate = r._estimate && !isActual;
      const estTag = isEstimate ? `<span class="qd-est-tag" title="概算（目安の金額）">${t('estimateTag')}</span> ` : '';
      // JPY 単価は端数があるときだけ小数表示（単価×数量＝金額の検算が崩れないように）
      const unitDisp = isActual
        ? t('unpriced')
        : estTag + (isNonJpy
          ? `${fmtNum(r.bp, 2)} ${esc(r.bc)}`
          : `${Number.isInteger(r.bp) ? fmtInt(r.bp) : fmtNum(r.bp, 2)} JPY`);
      // 御見積書は客先向け公式文書のため、社内メモ(r.note)は出力しない（E-1 備考漏洩対策）
      // 数量は金額の根拠（sub = bq×bp）と一致させる。未入力時に「1」を捏造しない（B/台帳 C）
      const qtyDisp = (r.bq && r.bq > 0) ? fmtNum(r.bq, 4) : '—';
      // サブコン境界：キーが変わったら直前グループの売値小計を挿入
      if (_scActive) {
        const k = _scNorm(r);
        if (_scHas && k !== _scKey) {
          _scPush(); _scJpy = 0; _scHas = false; _catKey = null;
          _ptActive = false; _ptKey = null;
        }
        if (!_scHas) {
          _scKey = k; _scLabel = _scLabelOf(r);  // グループ先頭の綴りを表示名に採用
          // 各サブコンブロックの先頭に見出しを置き、どのサブコンの明細かを明示する
          const _alH = (typeof getSubconAliases === 'function' ? getSubconAliases()[_scKey] : '') || '';
          _scHeadLabel = _alH || _scLabel;
          lineHTML.push(`<tr class="qd-subcon-head"><td colspan="5">${esc(_scHeadLabel)}</td></tr>`);
          // サブコン別リマーク（「見積書に表示」がONのときのみ御見積書PDFにも表示）
          const _rmH = (typeof getSubconRemarks === 'function' ? getSubconRemarks()[_scKey] : null);
          if (_rmH && _rmH.show && _rmH.text && _rmH.text.trim()) {
            lineHTML.push(`<tr class="qd-subcon-remark"><td colspan="5">📝 ${esc(_rmH.text)}</td></tr>`);
          }
          _catKey = null;   // 新しいサブコンに入ったのでカテゴリ見出しを再出させる
          const ps = scPatternSets[k] || new Set();
          _ptActive = ps.size >= 2 || (ps.size === 1 && !ps.has(''));
          _ptSubOn  = ps.size >= 2;
          _ptKey = null; _ptJpy = 0; _ptHas = false;
        }
        _scJpy += ((isActual || isCond || isRef) ? 0 : jpy); _scHas = true;   // 実費・都度請求・参考情報は小計に含めない
      } else {
        // サブコンが1社のみの場合もパターン表示を判定（初回のみ）
        if (_ptKey === null) {
          const k = _scNorm(r);
          const ps = scPatternSets[k] || new Set();
          _ptActive = ps.size >= 2 || (ps.size === 1 && !ps.has(''));
          _ptSubOn  = ps.size >= 2;
        }
      }
      // パターン境界：キーが変わったら直前パターンの売値小計を挿入
      if (_ptActive) {
        const p = _ptNorm(r);
        if (_ptHas && p !== _ptKey) { _ptPush(); _catKey = null; }
        if (!_ptHas || p !== _ptKey) {
          _ptKey = p;
          lineHTML.push(`<tr class="qd-pattern-head"><td colspan="5">📋 ${esc(_ptKey || t('noPattern'))}</td></tr>`);
          // パターン別リマーク（「見積書に表示」がONのときのみ御見積書PDFにも表示）
          if (_ptKey) {
            const _rmP = (typeof getSubconRemarks === 'function' ? getSubconRemarks()[_scKey + '||' + _ptKey] : null);
            if (_rmP && _rmP.show && _rmP.text && _rmP.text.trim()) {
              lineHTML.push(`<tr class="qd-pattern-remark"><td colspan="5">📝 ${esc(_rmP.text)}</td></tr>`);
            }
          }
          _catKey = null;
        }
        if (!isActual && !isCond && !isRef) _ptJpy += jpy;
        _ptHas = true;
      }
      // カテゴリー境界：サブコン配下でカテゴリが変わったら見出し行を挿入（ツリー第2階層）
      if (r.cat !== _catKey) {
        const _catTxt = _catLabel(r.cat)
          .replace(/^[\s\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]+/u, '').trim();
        if (_catTxt) lineHTML.push(`<tr class="qd-cat-head"><td colspan="5">${esc(_catTxt)}</td></tr>`);
        _catKey = r.cat;
      }
      const validBadge = (() => {
        if (!r.vf && !r.vt) return '';
        const fmt = d => d ? d.replace(/-/g, '/') : '';
        const range = (r.vf && r.vt) ? fmt(r.vf) + '〜' + fmt(r.vt)
                    : r.vf            ? fmt(r.vf)          // 開始日のみ：末尾「〜」なし
                    :                   '〜' + fmt(r.vt);
        return ` <span class="qd-validity">${esc(range)}</span>`;
      })();
      const condNote = isCond ? ` <span class="qd-cond-note" style="color:#8a5a00;font-size:11px;font-weight:600;">${t('conditional')}</span>` : '';
      const refNote  = isRef  ? ` <span class="qd-ref-note" style="color:#3a5a80;font-size:11px;font-weight:600;">${t('reference')}</span>` : '';
      // 前回提示分から追加／変更された行をハイライト（uid で突き合わせ）
      const revMark = r.uid ? _revMarks[r.uid] : null;
      const revCls  = revMark === 'added' ? ' qd-row-added' : revMark === 'changed' ? ' qd-row-changed' : '';
      const revIcon = revMark === 'added' ? '<span class="qd-rev-mark qd-rev-mark-add" title="前回提示分から追加">＋</span> '
                    : revMark === 'changed' ? '<span class="qd-rev-mark qd-rev-mark-chg" title="前回提示分から変更">✎</span> ' : '';
      const rowCls = (isCond || isRef || revCls) ? ` class="${[isCond ? 'qd-cond-row' : '', isRef ? 'qd-ref-row' : '', revCls.trim()].filter(Boolean).join(' ')}"` : '';
      lineHTML.push(
        `<tr${rowCls}>
          <td class="qd-item qd-l3">${revIcon}${r.taxed ? '<span class="qd-tax">*</span> ' : ''}${esc(_taxName(r.name, r.taxed))}${validBadge}${condNote}${refNote}</td>
          <td class="qd-num">${qtyDisp}</td>
          <td class="qd-ctr">${esc(r.un || '')}</td>
          <td class="qd-num">${unitDisp}</td>
          <td class="qd-num">${isActual ? t('unpriced') : isCond ? '' : isRef ? '<span style="color:#8a95a5;">(¥' + fmtInt(jpy) + ')</span>' : estTag + '¥' + fmtInt(jpy)}</td>
        </tr>`
      );
    });
    _scPush();   // 末尾グループの売値小計

    const tax   = taxSum;   // 行ごと切り上げの合計（Math.floor 一括計算からの修正）
    const total = taxableSub + exemptSub + tax;

    const subj = buildSubject(cond);
    const rates = collectRates(rows);
    const rateRows = ['JPY', ...Object.keys(rates)]
      .map(c => `<tr><td class="qd-ctr">${esc(c)}</td><td class="qd-num">${c === 'JPY' ? '1.00' : (rates[c] != null ? fmtNum(rates[c], rates[c] < 0.1 ? 4 : 2) : '—')}</td></tr>`)
      .join('');
    const fxMeta = (typeof getFxAuditMeta === 'function') ? getFxAuditMeta() : null;
    const fxMetaNote = fxMeta
      ? `<div style="font-size:9px;color:#666;margin-top:4px;line-height:1.5;">${esc(fxMeta.fxLine)}<br>${esc(fxMeta.created)}</div>`
      : '';

    const dateStr  = _fmtJpDate(hdr.date || _todayIso());
    const validStr = _fmtJpDate(hdr.validUntil);
    const custName = _formatRecipient(hdr.customer, hdr.person) || t('noRecipient');

    // 住所1/2、TEL/FAX はそれぞれ1行にまとめる（行数を詰めて発行元情報をコンパクトに）
    const issuerAddrLine = [esc(issuer.address1), esc(issuer.address2)].filter(Boolean).join('　');
    const issuerContactLine = [
      issuer.tel ? 'TEL: ' + esc(issuer.tel) : '',
      issuer.fax ? 'FAX: ' + esc(issuer.fax) : '',
    ].filter(Boolean).join('　');
    const issuerAddr = [
      issuer.zip ? (_curLangEn ? 'Zip ' : '〒') + esc(issuer.zip) : '',
      issuerAddrLine,
      issuerContactLine,
      issuer.regno ? t('regno') + ': ' + esc(issuer.regno) : '',
    ].filter(Boolean).join('<br>');

    const metaRows = subj.meta.map(([k, v]) =>
      `<div class="qd-srow"><span class="qd-sk">${esc(k)}</span><span class="qd-sv">${nl2br(v)}</span></div>`
    ).join('');

    return `
    <div class="qd-page">
      <div class="qd-top"><span></span><span style="text-align:right;line-height:1.6;">${t('quoteNo')}：${esc(hdr.ref) || '—'}<br>${t('date')}：${esc(dateStr)}　　${t('page')}：1 / 1</span></div>
      <div class="qd-title">${t('docTitle')}</div>

      <div class="qd-head">
        <div class="qd-to">
          <div class="qd-cust">${nl2br(custName)}</div>
          <div class="qd-greet">${nl2br(issuer.greeting)}</div>
        </div>
        <div class="qd-from">
          <div class="qd-co">${esc(issuer.company) || '<span class="qd-placeholder">（発行元会社名を設定してください）</span>'}</div>
          <div class="qd-addr">${issuerAddr || '<span class="qd-placeholder">（住所・連絡先を設定）</span>'}</div>
        </div>
      </div>

      <div class="qd-subj">
        ${subj.title ? `<div class="qd-subj-ttl">${esc(subj.title)}</div>` : ''}
        ${metaRows ? `<div class="qd-meta">${metaRows}</div>` : ''}
        ${(!hideTotal || validStr) ? `<div class="qd-amt-row">
          <span>${hideTotal ? '' : t('totalAmount')}${validStr ? `　<span class="qd-valid">${t('validUntil')}：${esc(validStr)}</span>` : ''}</span>
          ${hideTotal ? '' : `<span class="qd-amt">¥ ${fmtInt(total)} <span class="qd-jpy">(JPY)</span></span>`}
        </div>` : ''}
      </div>

      <table class="qd-items">
        <thead><tr>
          <th class="qd-item">${t('itemCol')}</th><th>${t('qtyCol')}</th><th>${t('unitCol')}</th><th>${t('priceCol')}</th><th>${t('amountCol')}</th>
        </tr></thead>
        <tbody>${lineHTML.join('')}</tbody>
      </table>

      <div class="qd-foot">
        <div class="qd-notes">
          <b>${t('notesTitle')}</b>
        </div>
        <div class="qd-rate">
          <table>
            <tr><td class="qd-ctr qd-rh">${t('currency')}</td><td class="qd-ctr qd-rh">${t('rate')}</td></tr>
            ${rateRows}
          </table>
          ${fxMetaNote}
        </div>
        ${hideTotal ? '' : `<div class="qd-sum">
          <table>
            <tr><td class="qd-sk2">${t('exemptSub')}</td><td class="qd-num">¥${fmtInt(exemptSub)}</td></tr>
            <tr><td class="qd-sk2">${t('taxableSub')}</td><td class="qd-num">¥${fmtInt(taxableSub)}</td></tr>
            <tr><td class="qd-sk2">${t('tax')}（${Math.round(taxRate * 100)}%）</td><td class="qd-num">¥${fmtInt(tax)}</td></tr>
            <tr class="qd-total"><td>${t('grandTotal')}</td><td class="qd-num">¥${fmtInt(total)}</td></tr>
          </table>
        </div>`}
      </div>
      ${(() => {
        const sc = (document.getElementById('qf-scope')?.value || '').trim();
        return sc ? `<div class="qd-remark-block qd-scope-block"><div class="qd-remark-ttl">${t('scopeTitle')}</div><div class="qd-remark-body">${esc(sc).replace(/\n/g, '<br>')}</div></div>` : '';
      })()}
      ${(() => {
        const rt = (typeof getRemarkText === 'function') ? getRemarkText() : (cond && cond.free) || '';
        const imgHtml = (typeof remarkImagesOutputHTML === 'function') ? remarkImagesOutputHTML('qd-remark-images') : '';
        if (!rt && !imgHtml) return '';
        const bodyHtml = rt ? `<div class="qd-remark-body">${esc(rt).replace(/\n/g, '<br>')}</div>` : '';
        return `<div class="qd-remark-block"><div class="qd-remark-ttl">${t('remarksTitle')}</div>${bodyHtml}${imgHtml}</div>`;
      })()}
      ${(() => {
        const diff = _revDiff;
        if (!diff) return '';
        const lines = [];
        diff.added.forEach(r => lines.push(`<li class="qd-rev-add">＋ 追加：${esc(r.nm || '（品名未設定）')}</li>`));
        diff.removed.forEach(r => lines.push(`<li class="qd-rev-del">－ 削除：${esc(r.nm || '（品名未設定）')}</li>`));
        diff.changed.forEach(c => {
          const parts = c.fields.map(f => `${esc(f.label)}：${esc(String(f.from || '—'))} → ${esc(String(f.to || '—'))}`).join('／');
          lines.push(`<li class="qd-rev-chg">✎ 変更：${esc(c.name || '（品名未設定）')}（${parts}）</li>`);
        });
        const totalLine = (diff.showTotal !== false && diff.totalFrom !== diff.totalTo)
          ? `<div class="qd-rev-total">合計金額：¥${esc(diff.totalFrom)} → ¥${esc(diff.totalTo)}</div>` : '';
        return `<div class="qd-remark-block qd-revision-block">
          <div class="qd-remark-ttl">${t('revisionTitle')}</div>
          <ul class="qd-rev-list">${lines.join('')}</ul>
          ${totalLine}
        </div>`;
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
        <div class="qd-issuer-ttl" style="margin-top:10px;">🌐 英語版（「英語で出力」ON時に使用。空欄は日本語の値を使います）</div>
        <div class="qd-fld-grid">
          ${f('companyEn', 'Company name', 'e.g. JCT Co., Ltd.')}
          ${f('address1En', 'Address 1', 'e.g. 2-11-5 Shibaura, Minato-ku, Tokyo')}
          ${f('address2En', 'Address 2 (building)', 'e.g. Igarashi Bldg. 3F')}
        </div>
        <label class="qd-fld qd-fld-wide"><span>Greeting</span><textarea data-issuer="greetingEn" rows="3">${esc(issuer.greetingEn)}</textarea></label>
      </div>`;
  }

  // ====== オーバーレイ表示 ======
  // opts.quickPrint: true なら、描画後にそのまま印刷ダイアログまで進む（1クリック出力）
  function openQuoteDoc(opts) {
    const quickPrint = !!(opts && opts.quickPrint === true);
    const data = (typeof collectAllRows === 'function') ? collectAllRows().filter(r => r._type === 'data' && !r._hideQuote) : [];
    if (!data.length) { alert('見積もり行がありません。'); return; }

    let overlay = document.getElementById('quoteDocOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'quoteDocOverlay';
      overlay.innerHTML = `
        <div class="qd-shell">
          <div class="qd-stage">
            <div class="qd-preview" id="qdPreview"></div>
          </div>
          <aside class="qd-panel">
            <div class="qd-panel-head">
              <div class="qd-panel-h">📄 PDF出力設定</div>
              <div class="qd-panel-s">御見積書フォーマット</div>
            </div>
            <div class="qd-panel-body">
              <div class="qd-fg">
                <label for="qdPdfTitle">ファイル名</label>
                <div class="qd-inp"><input type="text" id="qdPdfTitle" placeholder="ファイル名（拡張子不要）" title="PDF保存時のファイル名（ブラウザの印刷ダイアログに反映）"><span class="qd-ext">.pdf</span></div>
              </div>
              <label class="qd-toggle" title="ONにすると、見出し・項目名・合計欄等の固定ラベルを英語で出力します（海外客先向け）。品名・備考・サブコン名等のご自身で入力した文章は翻訳されず日本語のまま出力されます。">
                <span class="qd-toggle-l">🌐 英語で出力<small>固定ラベルのみ</small></span>
                <input type="checkbox" id="qdLangEn"><span class="qd-toggle-sw"></span>
              </label>
              <label class="qd-toggle" title="ONにすると上部の御見積額・下部の合計／税サマリを非表示にします。小計行でパターンA/B比較を行う用途向け。">
                <span class="qd-toggle-l">合計・税サマリを非表示<small>パターン比較用</small></span>
                <input type="checkbox" id="qdHideTotal"><span class="qd-toggle-sw"></span>
              </label>
              <label class="qd-toggle" title="PDF を出力したあと、案件ステータスが「下書き中」なら自動で「提示済み」に進めます。受注・失注などのステータスは変更しません。">
                <span class="qd-toggle-l">出力後に「提示済み」へ<small>下書き中のときだけ</small></span>
                <input type="checkbox" id="qdAutoStatus"><span class="qd-toggle-sw"></span>
              </label>
              <div class="qd-issuer-card">
                <div class="qd-ic-head"><span>📇 発行元</span><button type="button" class="qd-ic-edit" id="qdEditIssuer">編集</button></div>
                <div class="qd-ic-body" id="qdIssuerSummary"></div>
              </div>
              <div class="qd-issuer-wrap" id="qdIssuerWrap" style="display:none;"></div>
              <div class="qd-fg"><label>用紙</label><div class="qd-inp qd-static">A4 縦</div></div>
            </div>
            <div class="qd-panel-foot">
              <button type="button" class="qd-btn-print" id="qdPrint">🖨️ PDF出力（印刷）</button>
              <button type="button" class="qd-btn-ghost" id="qdClose">閉じる</button>
            </div>
          </aside>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) closeQuoteDoc(); });
      overlay.querySelector('#qdClose').addEventListener('click', closeQuoteDoc);
      overlay.querySelector('#qdPrint').addEventListener('click', printQuoteDoc);
      overlay.querySelector('#qdEditIssuer').addEventListener('click', toggleIssuerForm);
      const hideChk = overlay.querySelector('#qdHideTotal');
      if (hideChk) {
        hideChk.addEventListener('change', () => { saveHideTotal(hideChk.checked); refreshQuoteDoc(); });
      }
      const autoChk = overlay.querySelector('#qdAutoStatus');
      if (autoChk) autoChk.addEventListener('change', () => saveAutoStatus(autoChk.checked));
      const langChk = overlay.querySelector('#qdLangEn');
      if (langChk) langChk.addEventListener('change', () => { saveLangEn(langChk.checked); refreshQuoteDoc(); });
    }
    // チェック状態・ファイル名を保存値に同期（オーバーレイ再利用時も整合）
    const hideChk = overlay.querySelector('#qdHideTotal');
    if (hideChk) hideChk.checked = loadHideTotal();
    const autoChk2 = overlay.querySelector('#qdAutoStatus');
    if (autoChk2) autoChk2.checked = loadAutoStatus();
    const langChk2 = overlay.querySelector('#qdLangEn');
    if (langChk2) langChk2.checked = loadLangEn();
    const titleIn = overlay.querySelector('#qdPdfTitle');
    if (titleIn) titleIn.value = _defaultPdfTitle();
    refreshQuoteDoc();
    overlay.classList.add('open');
    document.body.classList.add('qd-printing-ready');
    // 1クリック出力：レイアウト確定を 2 フレーム待ってから印刷ダイアログを開く。
    // （待たずに print すると、まだ描画中の内容が印刷対象になることがある）
    if (quickPrint) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        printQuoteDoc();
        // 1クリック導線では、印刷ダイアログを閉じたらそのまま編集画面へ戻る
        //（「閉じる」を押させないため）。printQuoteDoc の後片付け（300ms）より後に閉じる。
        setTimeout(closeQuoteDoc, 400);
      }));
    }
  }

  // 編集画面から 1 クリックで御見積書 PDF を出力する。
  // プレビュー → 御見積書 → PDF出力（3クリック）を 1 クリックに縮める導線。
  // 設定（ファイル名・発行元・合計非表示）は前回値をそのまま使う。
  function quickQuotePdf() {
    // プレビュー経由と同じ出力前チェックを通す（要調査行・重要列の出し忘れ防止）
    if (typeof window.preOutputValidationGate === 'function') {
      if (!window.preOutputValidationGate('PDF 出力（印刷）', () => openQuoteDoc({ quickPrint: true }))) return;
    }
    if (typeof window.sensitiveColumnsGate === 'function') {
      if (!window.sensitiveColumnsGate('PDF 出力')) return;
    }
    openQuoteDoc({ quickPrint: true });
  }

  function refreshQuoteDoc() {
    const prev = document.getElementById('qdPreview');
    if (prev) prev.innerHTML = buildQuoteDocHTML();
    _renderIssuerSummary();
  }

  // 右パネルの発行元サマリ（会社名＋住所など）を描画
  function _renderIssuerSummary() {
    const el = document.getElementById('qdIssuerSummary');
    if (!el) return;
    const i = loadIssuer();
    const co = (i.company || '').trim();
    const lines = [
      i.zip ? '〒' + esc(i.zip) : '',
      esc(i.address1), esc(i.address2),
      i.tel ? 'TEL ' + esc(i.tel) : '',
      i.regno ? '登録番号 ' + esc(i.regno) : '',
    ].filter(Boolean).join('<br>');
    el.innerHTML = co
      ? `<div class="qd-ic-co">${esc(co)}</div>${lines ? `<div class="qd-ic-ad">${lines}</div>` : ''}`
      : `<div class="qd-ic-empty">未設定（「編集」から会社名・住所を入力）</div>`;
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
    // 御見積書はプレビュー(#previewOverlay)上から開かれるため、印刷時に
    // quote.css の `body:has(#previewOverlay.open) > *:not(.app){display:none!important}`
    // が body 直下の #quoteDocOverlay まで隠してしまい、何も印字されない競合が起きる。
    // 印刷中だけプレビューの .open を外してこの印刷ルールを無効化し、後で復元する。
    const pv = document.getElementById('previewOverlay');
    const wasPreviewOpen = !!(pv && pv.classList.contains('open'));
    if (wasPreviewOpen) pv.classList.remove('open');

    // ファイル名入力値を document.title に一時設定（ブラウザの PDF 保存名に使われる）
    const titleIn = document.getElementById('qdPdfTitle');
    const customTitle = titleIn ? titleIn.value.trim() : '';
    const prevTitle = document.title;
    if (customTitle) document.title = customTitle;

    document.body.classList.add('qd-print-mode');
    window.print(); // 同期的：ダイアログを閉じるまでここでブロック
    document.title = prevTitle;
    setTimeout(() => {
      document.body.classList.remove('qd-print-mode');
      if (wasPreviewOpen) pv.classList.add('open');
      _maybeAdvanceStatusAfterPdf();
    }, 300);
  }

  // PDF 出力後のステータス進行。
  // ・「下書き中」のときだけ「提示済み」へ進める（受注・失注・保留などは触らない）
  // ・印刷ダイアログでキャンセルしたかは Web からは判別できないため、
  //   変更したことをトーストで必ず知らせ、その場で元に戻せるようにする
  function _maybeAdvanceStatusAfterPdf() {
    if (!loadAutoStatus()) return;
    const el = document.getElementById('qf-status');
    if (!el) return;
    const prev = (el.value || '下書き中').trim();
    if (prev !== '下書き中') return;
    if (typeof window.setQuoteStatus !== 'function') return;
    window.setQuoteStatus('提示済み');
    if (typeof window.quoteShowToast === 'function') {
      window.quoteShowToast('📄 PDF を出力し、ステータスを「提示済み」にしました', 'success', 7000, {
        label: '元に戻す',
        fn: () => {
          window.setQuoteStatus(prev);
          window.quoteShowToast('↩️ ステータスを「' + prev + '」に戻しました', 'info', 2600);
        },
      });
    }
  }

  // export
  window.openQuoteDoc = openQuoteDoc;
  window.quickQuotePdf = quickQuotePdf;
  window.closeQuoteDoc = closeQuoteDoc;
  window.printQuoteDoc = printQuoteDoc;
  window.buildQuoteDocHTML = buildQuoteDocHTML;
})();
