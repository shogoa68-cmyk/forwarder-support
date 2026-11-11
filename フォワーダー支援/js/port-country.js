// 幹線輸送の POL・経由地・POD：「🌐 国」を選ぶと、入力候補が、その国に設定済みの港のマスターだけに絞られる。
//   国を選んだうえで、マスターに無い港名を入力すると、その国の港として登録（承認制のメンバーは申請）できる
//   （確認の吹き出しは alias-rules.js _checkPortMaster。申請に国を持たせる列は docs/sql/master-request-country.sql）。
//   国は国コードで判定（data/countries.js findCountry）。国の入力欄は見積の項目として一緒に保存・復元される。
//   国を選ばない／認識できない国のときは、従来どおり全港が候補（#portSuggestions）。
//   逆引き：港名を入力して確定したとき、その港の国が空（または自動入力のまま）なら、①マスターの港の国 ②主要港の名前の対応表
//   （data/countries.js guessPortCountry）の順で国を自動入力する。自分で選んだ国は上書きしない。自動入力した国は
//   未登録港の「登録を申請」案内の対象にしない（ptcCountryOf が null を返す）。
(function () {
  'use strict';

  const ALL_LIST = 'portSuggestions';
  const FIELDS = [
    { port: 'z2Pol', country: 'z2PolCountry', list: 'z2PolList', name: 'POL' },
    { port: 'z2Via', country: 'z2ViaCountry', list: 'z2ViaList', name: '経由地' },
    { port: 'z2Pod', country: 'z2PodCountry', list: 'z2PodList', name: 'POD' },
  ];
  const $ = id => document.getElementById(id);
  const findCountry = t => (typeof window.findCountry === 'function' ? window.findCountry(t) : null);

  // 国の入力欄の候補（国名・国コード・英語名で絞り込める）
  function _fillCountryList() {
    const dl = $('ptcCountryList');
    if (!dl || dl.children.length || !Array.isArray(window.COUNTRY_LIST)) return;
    window.COUNTRY_LIST.forEach(c => {
      const o = document.createElement('option');
      o.value = c.ja; o.label = c.code + ' / ' + c.en;
      dl.appendChild(o);
    });
  }

  // いま選ばれている国（認識できたときだけ）。alias-rules.js の「未登録の港の登録」からも使う
  function countryOf(portInput) {
    const f = portInput && FIELDS.find(x => x.port === portInput.id);
    const ci = f && $(f.country);
    if (ci && _isAuto(ci)) return null;   // 港名からの自動入力は「選んだ国」とみなさない（登録案内を出さない）
    return ci ? findCountry(ci.value) : null;
  }
  window.ptcCountryOf = countryOf;

  // その国に設定済みの港（マスター詳細の country が一致するもの）
  function _portsOf(code) {
    const all = typeof window.mdGetAll === 'function' ? window.mdGetAll('port') : [];
    return all.filter(m => String((m.details || {}).country || '').toUpperCase() === code)
      .sort((a, b) => String(a.value).localeCompare(String(b.value), 'ja'));
  }

  // 自動入力した国か（入れた値とまだ同じなら自動。案件の読み込み等で値が変わっていれば手入力扱い）
  const _isAuto = ci => !!ci.dataset.auto && ci.dataset.auto === ci.value.trim();

  // 港名から国を逆引き：①マスターの港（別名・表記ゆれも同一視）の国 ②主要港の名前の対応表。分からなければ null
  function _countryForPort(name) {
    const v = String(name || '').trim();
    if (!v) return null;
    const all = typeof window.mdGetAll === 'function' ? window.mdGetAll('port') : [];
    const same = typeof window.nameSame === 'function' ? window.nameSame : (a, b) => a === b;
    const m = all.find(x => x.value === v) || all.find(x => { try { return same('port', x.value, v); } catch (e) { return false; } });
    const code = m && (m.details || {}).country;
    const c = code ? findCountry(String(code)) : null;
    if (c) return c;
    const g = typeof window.guessPortCountry === 'function' ? window.guessPortCountry(v) : null;
    return g ? findCountry(g) : null;
  }

  // 港の確定時：国が空、または前回の自動入力のままなら、港名から国を入れ直す（自分で入力・選択した国は触らない）
  function _autoCountry(f) {
    const ci = $(f.country), pi = $(f.port);
    if (!ci || !pi) return;
    const manual = ci.value.trim() && !_isAuto(ci);
    if (manual) return;
    const c = _countryForPort(pi.value);
    if (c) { ci.value = c.ja; ci.dataset.auto = c.ja; }
    else if (_isAuto(ci)) { ci.value = ''; delete ci.dataset.auto; }   // 港を変えて分からなくなったら自動分を消す
    else return;
    ci.dispatchEvent(new Event('input', { bubbles: true }));   // 保存対象の変更として通知（候補の絞り込みも更新）
  }

  function _apply(f) {
    const ci = $(f.country), pi = $(f.port);
    if (!ci || !pi) return null;
    const text = ci.value.trim();
    const c = text ? findCountry(text) : null;
    ci.classList.toggle('is-set', !!c);
    ci.classList.toggle('is-bad', !!text && !c);
    ci.title = c ? c.ja + '（' + c.code + '）の港だけを候補に出しています。空にすると全港が候補に戻ります'
      : (text ? '「' + text + '」は国として認識できません（国名・国コードを入力、または候補から選んでください）。いまは全港が候補です'
        : '国を選ぶと、その国に設定済みの港だけが候補に出ます（空のときは全港）');
    if (!c) { if (pi.getAttribute('list') !== ALL_LIST) pi.setAttribute('list', ALL_LIST); return null; }
    let dl = $(f.list);
    if (!dl) { dl = document.createElement('datalist'); dl.id = f.list; document.body.appendChild(dl); }
    const ports = _portsOf(c.code);
    dl.innerHTML = '';
    ports.forEach(m => {
      const d = m.details || {};
      const o = document.createElement('option');
      o.value = m.value;
      const lab = [d.furigana, d.enName].filter(Boolean).join(' / ');
      if (lab) o.label = lab;
      if (d.furigana) o.dataset.furi = d.furigana;
      if (d.enName) o.dataset.en = d.enName;
      o.dataset.master = '1';
      dl.appendChild(o);
    });
    if (pi.getAttribute('list') !== f.list) pi.setAttribute('list', f.list);
    return { c, n: ports.length };
  }

  function _note() {
    const el = $('z2PortCountryNote');
    if (!el) return;
    const parts = [];
    FIELDS.forEach(f => {
      const r = _apply(f);
      if (r) parts.push(f.name + '：' + r.c.ja + 'の登録済み港 ' + (r.n ? r.n + ' 件から選べます' : 'はまだありません（港名を入力すると、この国の港として登録を申請できます）'));
    });
    el.hidden = !parts.length;
    el.textContent = parts.length ? '🌐 ' + parts.join(' ／ ') : '';
  }

  // マスターの読込・変更のあと（alias-rules.js arRefreshDatalist から）や、保存した案件を開いたあとに、候補を作り直す
  window.ptcRefreshLists = _note;

  function _normalizeCountryText(ci) {
    const c = findCountry(ci.value);
    if (c && ci.value.trim() !== c.ja) ci.value = c.ja;   // 「vn」「Vietnam」→「ベトナム」（欄が狭いので短い表記に）
  }

  function init() {
    _fillCountryList();
    FIELDS.forEach(f => {
      const ci = $(f.country), pi = $(f.port);
      if (!ci || !pi) return;
      ci.addEventListener('input', () => _note());
      ci.addEventListener('change', () => { _normalizeCountryText(ci); _note(); });
      pi.addEventListener('change', () => _autoCountry(f));
      pi.addEventListener('focus', _note);   // 案件の読み込み・新規作成で国の欄が変わっていても、触る前に候補を合わせる
    });
    _note();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
