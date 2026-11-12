// 英訳辞書（日本語の品名・リマークを、辞書で英語にする／2026-11）
//   御見積書の「🌐 英語で出力」で、品名（マスターの英語品名が無いもの）とリマーク（全体・表内・サブコン別・パターン別）を
//   辞書で英語にする。外部の翻訳サービスは使わない（AI なし・社外へ送信しない・結果は毎回同じ）。
//   ①文全体が辞書にある → その英文 ②語句の組み合わせですべて訳せる → つないだ英文 ③1 つでも訳せない語が残る → その文は日本語のまま
//   （半端な混ざり文を客先に出さないため）。訳せなかった文は「未訳」として集め、英訳辞書の画面で英語を登録すると次回から訳せる。
//   辞書＝内蔵（下の BUILTIN）＋チーム共有（テーブル translation_dict＝docs/sql/translation-dict.sql。未作成・未ログインのときはこの端末の localStorage）
(function () {
  'use strict';

  const TABLE = 'translation_dict';
  const LS_KEY = 'jeDict_v1';
  const JP = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;   // ひらがな・カタカナ・漢字・半角カナ

  // 内蔵（ja, en）。フォワーディングの請求項目で使う語句と、よく使う短い文
  const BUILTIN = [
    ['海上運賃', 'Ocean Freight'], ['航空運賃', 'Air Freight'], ['運賃', 'Freight'], ['内航運賃', 'Coastal Freight'], ['トラック運賃', 'Trucking Charge'],
    ['燃油サーチャージ', 'Fuel Surcharge'], ['燃料サーチャージ', 'Fuel Surcharge'], ['バンカーサーチャージ', 'Bunker Surcharge'], ['サーチャージ', 'Surcharge'],
    ['ターミナルハンドリングチャージ', 'Terminal Handling Charge'], ['ターミナルハンドリング', 'Terminal Handling'], ['荷役料', 'Handling Charge'], ['荷役', 'Handling'],
    ['書類作成料', 'Documentation Fee'], ['書類費用', 'Documentation Fee'], ['書類代', 'Documentation Fee'], ['書類', 'Documentation'],
    ['B/L発行料', 'B/L Fee'], ['B/L訂正料', 'B/L Amendment Fee'], ['D/O料', 'D/O Fee'], ['D/O発行料', 'D/O Fee'], ['AWB発行料', 'AWB Fee'],
    ['輸入通関料', 'Import Customs Clearance Fee'], ['輸出通関料', 'Export Customs Clearance Fee'], ['通関手数料', 'Customs Clearance Fee'], ['通関料', 'Customs Clearance Fee'],
    ['輸入通関', 'Import Customs Clearance'], ['輸出通関', 'Export Customs Clearance'], ['通関', 'Customs Clearance'], ['関税', 'Customs Duty'], ['消費税', 'Consumption Tax'],
    ['CFSチャージ', 'CFS Charge'], ['CFS料', 'CFS Charge'], ['CY使用料', 'CY Charge'], ['CYチャージ', 'CY Charge'], ['コンテナ使用料', 'Container Usage Charge'],
    ['バンニング料', 'Vanning Charge'], ['デバンニング料', 'Devanning Charge'], ['バンニング', 'Vanning'], ['デバンニング', 'Devanning'],
    ['ドレージ', 'Drayage'], ['国内配送料', 'Domestic Delivery Charge'], ['国内配送', 'Domestic Delivery'], ['国内運賃', 'Domestic Freight'], ['配送料', 'Delivery Charge'], ['配達料', 'Delivery Charge'],
    ['引取料', 'Pickup Charge'], ['集荷料', 'Pickup Charge'], ['陸送費', 'Inland Transportation'], ['陸送', 'Inland Transportation'], ['横持ち', 'Cartage'], ['横持', 'Cartage'],
    ['倉庫料', 'Warehouse Charge'], ['保管料', 'Storage Charge'], ['保管', 'Storage'], ['倉庫', 'Warehouse'], ['搬入料', 'Delivery-in Charge'], ['搬出料', 'Pick-out Charge'],
    ['保険料', 'Insurance Premium'], ['海上保険', 'Marine Insurance'], ['貨物保険', 'Cargo Insurance'], ['保険', 'Insurance'],
    ['検査料', 'Inspection Fee'], ['検査', 'Inspection'], ['検疫', 'Quarantine'], ['植物検疫', 'Plant Quarantine'], ['動物検疫', 'Animal Quarantine'], ['燻蒸', 'Fumigation'], ['薫蒸', 'Fumigation'],
    ['デマレージ', 'Demurrage'], ['ディテンション', 'Detention'], ['デテンション', 'Detention'], ['待機料', 'Waiting Charge'], ['保管超過料', 'Storage Overstay Charge'],
    ['危険品割増', 'DG Surcharge'], ['危険品取扱料', 'DG Handling Fee'], ['危険品', 'Dangerous Goods'], ['重量物割増', 'Heavy Lift Surcharge'], ['重量物', 'Heavy Cargo'], ['特殊車両', 'Special Vehicle'], ['冷凍', 'Frozen'], ['冷蔵', 'Chilled'],
    ['事務手数料', 'Administration Fee'], ['手数料', 'Handling Fee'], ['諸経費', 'Miscellaneous Expenses'], ['立替金', 'Disbursement'], ['立替', 'Disbursement'], ['作業料', 'Service Charge'], ['作業費', 'Service Charge'],
    ['積込料', 'Loading Charge'], ['積込', 'Loading'], ['取卸料', 'Unloading Charge'], ['荷卸', 'Unloading'], ['梱包料', 'Packing Charge'], ['梱包', 'Packing'], ['木枠梱包', 'Wooden Crating'],
    ['シール代', 'Seal Charge'], ['ラベル貼り', 'Labeling'], ['仕分け', 'Sorting'], ['輸入', 'Import'], ['輸出', 'Export'], ['海上', 'Ocean'], ['航空', 'Air'],
    ['港湾保安料', 'Port Security Charge'], ['港湾使用料', 'Port Facility Charge'], ['ターミナル使用料', 'Terminal Usage Charge'], ['構内作業料', 'Terminal Work Charge'],
    ['混載', 'Consolidation'], ['混載料', 'Consolidation Charge'], ['小口混載', 'LCL Consolidation'], ['スペース確保料', 'Space Guarantee Fee'],
    ['小計', 'Subtotal'], ['合計', 'Total'], ['税別', 'Excl. tax'], ['税込', 'Incl. tax'], ['税抜', 'Excl. tax'], ['実費', 'at cost'], ['別途', 'separately'], ['込み', 'included'], ['無料', 'Free'],
    ['お見積り', 'Quotation'], ['お見積もり', 'Quotation'], ['御見積', 'Quotation'], ['見積', 'Quotation'], ['料金', 'Charge'], ['費用', 'Charge'], ['料', 'Charge'],
    ['東京', 'Tokyo'], ['横浜', 'Yokohama'], ['名古屋', 'Nagoya'], ['大阪', 'Osaka'], ['神戸', 'Kobe'], ['博多', 'Hakata'], ['成田', 'Narita'], ['関西空港', 'Kansai Airport'], ['羽田', 'Haneda'],
    // 文
    ['別途ご相談ください。', 'Please consult us separately.'], ['別途ご相談ください', 'Please consult us separately'], ['実費精算となります。', 'To be charged at actual cost.'], ['実費請求となります。', 'To be charged at actual cost.'],
    ['別途実費となります。', 'To be charged separately at actual cost.'], ['別途費用が発生します。', 'Additional charges will apply.'], ['別途費用が発生する場合があります。', 'Additional charges may apply.'],
    ['為替レートは変動する場合があります。', 'Exchange rates are subject to change.'], ['燃油サーチャージは変動する場合があります。', 'Fuel surcharges are subject to change.'],
    ['運賃は変更となる場合があります。', 'Freight rates are subject to change.'], ['料金は予告なく変更となる場合があります。', 'Rates are subject to change without notice.'],
    ['ご不明な点がございましたらお問い合わせください。', 'Please contact us if you have any questions.'], ['ご確認をお願いいたします。', 'Please kindly confirm.'],
    ['必要時のみ発生します。', 'Applicable only when required.'], ['必要時のみ', 'when required'], ['発生時のみ', 'when incurred'], ['お見積りは参考価格です。', 'This quotation is for reference only.'],
  ];

  let _user = {};           // 正規化した ja → { ja, en, id? }
  let _loaded = false, _missing = false, _loading = null, _version = 0;
  let _index = null;        // 語句の検索用（先頭文字 → 長い順の語句）

  function _c()  { return typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null; }
  function _me() { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return u ? (u.email || '') : ''; }
  function _cloud() { return !!_c() && !!_me(); }
  const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function _toast(msg, type, ms) { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(msg, type || 'success', ms || 3200); }

  // 空白・全角半角をそろえる（辞書の引きやすさ用）。NFKC で全角英数・括弧・コロン・チルダも半角になる
  const norm = s => String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, ' ').trim();
  const _key = s => norm(s).replace(/[。.]+$/, '');
  window.jeNorm = norm;

  function _lsRead() { try { const a = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function _lsWrite(arr) { try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch (e) {} }
  function _setUser(rows) {
    _user = {};
    rows.forEach(r => { const k = _key(r.ja); if (k && r.en) _user[k] = { ja: r.ja, en: String(r.en).trim(), id: r.id }; });
    _index = null; _version++;
  }
  _setUser(_lsRead());

  function _builtinMap() {
    if (!_builtinMap.m) { _builtinMap.m = {}; BUILTIN.forEach(([ja, en]) => { _builtinMap.m[_key(ja)] = en; }); }
    return _builtinMap.m;
  }
  function _lookup(k) { const u = _user[k]; return u ? u.en : _builtinMap()[k]; }
  function _buildIndex() {
    const idx = {}, all = {};
    Object.keys(_builtinMap()).forEach(k => { all[k] = _builtinMap()[k]; });
    Object.keys(_user).forEach(k => { all[k] = _user[k].en; });
    Object.keys(all).forEach(k => { if (k && JP.test(k)) (idx[k[0]] = idx[k[0]] || []).push(k); });   // 日本語を含む語句だけ（英数だけの語句は置き換え不要）
    Object.keys(idx).forEach(c => idx[c].sort((a, b) => b.length - a.length));
    _index = { idx, all };
  }

  // 1 つの文（句点で区切った 1 文／短い品名）を英語にする。訳せないときは null
  function _segment(seg) {
    const k = _key(seg);
    if (!k) return '';
    if (!JP.test(k)) return null;   // 日本語を含まない＝そのまま（呼び出し側で原文を使う）
    const hit = _lookup(k); if (hit) return hit;
    if (!_index) _buildIndex();
    let out = '', i = 0;
    const s = norm(seg).replace(/[。.]+$/, '');
    while (i < s.length) {
      const ch = s[i], cands = _index.idx[ch];
      let found = null;
      if (cands) for (const t of cands) { if (s.startsWith(t, i)) { found = t; break; } }
      if (found) { out += _pad(out, _index.all[found]); i += found.length; continue; }
      if (ch === '、' || ch === '，') out += ', ';
      else if (ch === '・' || ch === '･') out += '/';
      else if (ch === '「' || ch === '」') out += '"';
      else if (ch === '〜' || ch === '～') out += '~';
      else if (JP.test(ch)) return undefined;   // 辞書にない日本語が残った
      else out += ch;
      i++;
    }
    return out.replace(/\s+/g, ' ').replace(/\s+([,.)])/g, '$1').replace(/\(\s+/g, '(').replace(/\s*\/\s*/g, '/').trim();
  }
  // 英語の語句どうしの間に空白を入れる（"Ocean"+"Freight" など）。記号の直後・直前には入れない
  function _pad(prev, add) { return (prev && !/[\s(/"~-]$/.test(prev) && !/^[\s,.)/"~-]/.test(add) ? ' ' : '') + add; }

  // 本体：text を英語にして { text, missing:[訳せなかった文] } を返す。kind は表示用（'name'|'remark'）
  function translateEx(text) {
    const src = String(text == null ? '' : text);
    if (!JP.test(src)) return { text: src, missing: [] };
    const missing = [];
    const lines = src.split('\n').map(line => {
      if (!JP.test(line)) return line;
      const m = line.match(/^(\s*(?:[・･※＊*●○■□◆◇▶▷-]|[①-⑳]|\(?\d+[.)．）])?\s*)([\s\S]*)$/);
      let prefix = m[1].replace('・', '- ').replace('･', '- '), rest = m[2];
      const parts = rest.match(/[^。]+。?/g) || [rest];
      const done = parts.map(p => {
        const lead = p.match(/^\s*/)[0];
        const r = _segment(p);
        if (r === null) return p;
        if (r === undefined) { missing.push(norm(p).replace(/[。.]+$/, '')); return p; }
        const endsDot = /。\s*$/.test(p);
        return lead + (endsDot && !/[.!?]$/.test(r) ? r + '.' : r);
      });
      return prefix + done.join(' ').replace(/\s+$/, '');
    });
    return { text: lines.join('\n'), missing };
  }
  const _seen = new Set();
  window.jeMissing = () => Array.from(_seen);
  window.jeResetMissing = () => { _seen.clear(); };
  // 出力用：訳した文字列だけを返す（訳せなかった文は日本語のまま・未訳の一覧に控える）
  window.jeTranslate = function (text) {
    const r = translateEx(text);
    r.missing.forEach(x => _seen.add(x));
    return r.text;
  };
  window.jeTranslateEx = translateEx;

  // ---- 辞書の読み込み・登録・削除（チーム共有。使えないときはこの端末） ----
  window.jeLoad = async function (force) {
    if (!_cloud()) return false;
    if (_loaded && !force) return true;
    if (_loading) return _loading;
    _loading = (async () => {
      const { data, error } = await _c().from(TABLE).select('*').order('ja');
      _loading = null;
      if (error) { if (/relation|does not exist|schema cache|not find|permission denied/i.test(error.message || '')) _missing = true; return false; }
      _missing = false; _loaded = true;
      // クラウドが使えるときは、この端末の登録分も合わせて使う（共有へ移すまでの橋渡し）
      const local = _lsRead().filter(r => !(data || []).some(d => _key(d.ja) === _key(r.ja)));
      _setUser((data || []).concat(local.map(r => ({ ja: r.ja, en: r.en }))));
      return true;
    })();
    return _loading;
  };
  window.jeIsShared = () => _cloud() && _loaded && !_missing;
  window.jeIsMissing = () => _missing;
  window.jeVersion = () => _version;

  window.jeAdd = async function (ja, en) {
    const j = norm(ja).replace(/[。.]+$/, ''), e = String(en || '').trim();
    if (!j || !e) { _toast('日本語と英語の両方を入れてください', 'warn'); return false; }
    if (_cloud() && !_missing) {
      const { error } = await _c().from(TABLE).upsert({ ja: j, en: e, created_by: _me(), updated_by: _me(), updated_at: new Date().toISOString() }, { onConflict: 'ja' });
      if (!error) { await window.jeLoad(true); return true; }
      if (/relation|does not exist|schema cache|not find/i.test(error.message || '')) _missing = true;
      else { _toast('⚠️ 英訳を保存できませんでした：' + (error.message || error), 'warn', 6000); return false; }
    }
    const arr = _lsRead().filter(r => _key(r.ja) !== _key(j)); arr.push({ ja: j, en: e }); _lsWrite(arr);
    const cur = Object.values(_user).filter(r => _key(r.ja) !== _key(j)); cur.push({ ja: j, en: e }); _setUser(cur);
    return true;
  };
  window.jeRemove = async function (ja) {
    const k = _key(ja), u = _user[k];
    if (u && u.id && _cloud() && !_missing) {
      const { error } = await _c().from(TABLE).delete().eq('id', u.id);
      if (error) { _toast('⚠️ 削除できませんでした：' + (error.message || error), 'warn', 6000); return false; }
      await window.jeLoad(true);
    }
    _lsWrite(_lsRead().filter(r => _key(r.ja) !== k));
    _setUser(Object.values(_user).filter(r => _key(r.ja) !== k));
    return true;
  };
  window.jeUserEntries = () => Object.values(_user).sort((a, b) => a.ja.localeCompare(b.ja, 'ja'));
  window.jeBuiltinCount = () => BUILTIN.length;

  // ---- いまの見積で訳せていない文（品名・全体リマーク・表内リマーク・サブコン別／パターン別リマーク）----
  window.jeScanCurrent = function () {
    const miss = new Map();   // 文 → { where:Set }
    const add = (txt, where) => { translateEx(txt).missing.forEach(m => { if (!miss.has(m)) miss.set(m, new Set()); miss.get(m).add(where); }); };
    const nm = s => String(s || '').replace(/^\*\s?/, '');
    const hasMaster = n => { try { const rec = (window.mdGetCanon || window.mdGet)('nm', n); return !!(rec && rec.details && String(rec.details.enName || '').trim()); } catch (e) { return false; } };
    try {
      const rows = typeof window.collectAllRows === 'function' ? window.collectAllRows() : [];
      rows.forEach(r => {
        if (r._type === 'remark') { if (!r.internal) add(r.text, '表内リマーク'); return; }
        if (r.name && !hasMaster(nm(r.name))) add(nm(r.name), '品名');
      });
    } catch (e) {}
    const pre = t => (typeof window.translateRemarkToEn === 'function' ? window.translateRemarkToEn(t) : t);
    try { add(pre(typeof window.getRemarkText === 'function' ? window.getRemarkText() : ''), '全体リマーク'); } catch (e) {}
    try { add(pre(typeof window.getFixedRemarkText === 'function' ? window.getFixedRemarkText() : ''), '全体リマーク'); } catch (e) {}
    try {
      const sr = typeof window.getSubconRemarks === 'function' ? window.getSubconRemarks() : {};
      Object.keys(sr).forEach(k => { const v = sr[k]; if (v && v.show && v.text) add(v.text, k.includes('||') ? 'パターン別リマーク' : 'サブコン別リマーク'); });
    } catch (e) {}
    return Array.from(miss.entries()).map(([ja, w]) => ({ ja, where: Array.from(w) }));
  };

  // ---- 英訳辞書の画面 ----
  function _modalEl() { return document.getElementById('jeModal'); }
  function _closeModal() { const m = _modalEl(); if (m) { m.remove(); document.body.classList.remove('md-modal-open'); } if (typeof window.jeOnChange === 'function') window.jeOnChange(); }
  async function _paint() {
    const m = _modalEl(); if (!m) return;
    const body = m.querySelector('#jeBody');
    await window.jeLoad();
    const miss = window.jeScanCurrent();
    const q = (m.querySelector('#jeSearch') || {}).value || '';
    const list = window.jeUserEntries().filter(e => !q || (e.ja + ' ' + e.en).toLowerCase().includes(q.toLowerCase()));
    const where = window.jeIsShared() ? '🌐 チームで共有' : (_cloud() && _missing ? 'この端末だけ（保存先 translation_dict が未作成です。docs/sql/translation-dict.sql を実行するとチームで共有できます）' : 'この端末だけ（ログインするとチームで共有できます）');
    body.innerHTML =
      `<div class="je-sec"><div class="je-h">いまの見積で訳せていない文${miss.length ? '（' + miss.length + '件）' : ''}</div>` +
      (miss.length ? miss.map(x => `<div class="je-row"><div class="je-ja">${_esc(x.ja)}<small>${_esc(x.where.join('・'))}</small></div>` +
        `<input type="text" class="je-en" data-ja="${_esc(x.ja)}" placeholder="英語（例：Ocean Freight）"><button type="button" data-je="add">登録</button></div>`).join('')
        : '<div class="je-empty">訳せていない文はありません（いまの見積のすべてが英語になります）。</div>') + `</div>` +
      `<div class="je-sec"><div class="je-h">辞書に追加</div><div class="je-row"><input type="text" class="je-new-ja" placeholder="日本語の語句・文"><input type="text" class="je-new-en" placeholder="英語"><button type="button" data-je="addnew">追加</button></div></div>` +
      `<div class="je-sec"><div class="je-h">登録した辞書（${window.jeUserEntries().length}件）<small>${_esc(where)}　／　内蔵の辞書 ${window.jeBuiltinCount()}語</small></div>` +
      `<input type="search" id="jeSearch" class="je-search" placeholder="検索" value="${_esc(q)}">` +
      (list.length ? list.map(e => `<div class="je-row je-saved"><div class="je-ja">${_esc(e.ja)}</div><div class="je-en-v">${_esc(e.en)}</div><button type="button" data-je="del" data-ja="${_esc(e.ja)}">削除</button></div>`).join('')
        : '<div class="je-empty">まだ登録はありません。</div>') + `</div>`;
  }
  window.jeOpenDialog = function () {
    if (_modalEl()) return;
    const m = document.createElement('div'); m.id = 'jeModal'; m.className = 'md-modal-overlay'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.style.zIndex = '100000';
    m.innerHTML = '<div class="md-modal je-modal"><div class="md-modal-head"><h3>📖 英訳辞書（英語出力用）</h3><button type="button" class="md-modal-close" title="閉じる（Esc）" aria-label="閉じる">✕</button></div>' +
      '<div class="md-modal-body"><p class="je-note">御見積書を英語で出力するとき、品名・リマークを辞書で英語にします（AI・外部送信なし）。辞書にない文は日本語のまま出るので、ここで英語を登録してください。品名は、品名マスターの「英語品名」があればそちらが優先されます。</p><div id="jeBody"></div></div></div>';
    document.body.appendChild(m); document.body.classList.add('md-modal-open');
    m.addEventListener('click', async ev => {
      if (ev.target === m || ev.target.closest('.md-modal-close')) { _closeModal(); return; }
      const b = ev.target.closest('[data-je]'); if (!b) return;
      const act = b.dataset.je;
      if (act === 'add') { const row = b.closest('.je-row'), inp = row.querySelector('.je-en'); if (await window.jeAdd(inp.dataset.ja, inp.value)) _paint(); }
      else if (act === 'addnew') { const row = b.closest('.je-row'); if (await window.jeAdd(row.querySelector('.je-new-ja').value, row.querySelector('.je-new-en').value)) _paint(); }
      else if (act === 'del') { if (await window.jeRemove(b.dataset.ja)) _paint(); }
    });
    m.addEventListener('input', ev => { if (ev.target.id === 'jeSearch') { const pos = ev.target.selectionStart; _paint().then(() => { const s = m.querySelector('#jeSearch'); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (e) {} } }); } });
    m.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.classList.contains('je-en')) { ev.preventDefault(); ev.target.closest('.je-row').querySelector('[data-je="add"]').click(); } });
    _paint();
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _modalEl() && !document.querySelector('.confirm-dialog')) { e.stopPropagation(); _closeModal(); } }, true);
})();
