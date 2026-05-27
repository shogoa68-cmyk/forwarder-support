// ========== 定数・グローバル変数 ==========
// ※ このファイルを最初に読み込むこと
//
// Phase 2c-Step5: window.QuoteApp 名前空間を導入。
// 既存のグローバル変数（rowCount, _fxRates, CURRENCIES, CATEGORIES 等）に
// QuoteApp.{state,data,fx}.X 経由のアクセサを追加（このファイル末尾で定義）。
// 既存の bare-global 参照（rowCount, _fxRates ...）はそのまま動作するため、
// callsite の段階的移行が可能。最終的には bare-global を削除して閉じる予定。

window.QuoteApp = window.QuoteApp || { state: {}, data: {}, fx: {} };

  // ========== 定数 ==========
  const CURRENCIES = ['JPY','USD','EUR','CNY','KRW','SGD','HKD','GBP','AUD','TWD','THB','VND','MYR','IDR'];
  const UNITS = ['', 'B/L', 'CNTR', 'CBM', 'R/T', 'CW', 'kg', 'TON', 'pcs', '件', '式', 'set', 'shipment', 'CTN', 'PLT', '時間', '日', 'HOUR', 'DAY'];

  const CATEGORIES = [
    { value: '',           label: '— カテゴリ —',         cls: '' },
    { value: 'domestic',   label: '🏠 国内作業',           cls: 'cat-domestic'   },
    { value: 'export-local', label: '📤 輸出ローカルチャージ', cls: 'cat-export-local' },
    { value: 'ocean',      label: '🚢 海上運賃',           cls: 'cat-ocean'      },
    { value: 'air',        label: '✈️ 航空運賃',          cls: 'cat-air'        },
    { value: 'surcharge',  label: '⚡ サーチャージ',        cls: 'cat-surcharge'  },
    { value: 'import-local', label: '📥 輸入ローカルチャージ', cls: 'cat-import-local' },
    { value: 'overseas',   label: '🌏 海外作業',           cls: 'cat-overseas'   },
    { value: 'customs',    label: '🛃 通関費',             cls: 'cat-customs'    },
    { value: 'insurance',  label: '🛡️ 保険料',            cls: 'cat-insurance'  },
    { value: 'other',      label: '📋 その他',             cls: 'cat-other'      },
  ];
  const CAT_VALUES = CATEGORIES.map(c => c.value);

  // ---- 各スコープに対応する見積プリセット行 ----
  // cat: CATEGORIES の value と一致させること
  const SCOPE_PRESETS = {
    domestic: [
      { cat: 'domestic',  name: '国内集荷・陸送費',  note: '集荷先〜倉庫/港' },
      { cat: 'domestic',  name: '荷役・仕分け費',    note: '積み下ろし・仕分け作業' },
      { cat: 'domestic',  name: '国内配送費',        note: '倉庫/港〜納入地' },
      { cat: 'other',     name: 'その他国内費用',    note: '' },
    ],
    export: [
      { cat: 'domestic',     name: '国内集荷・陸送費',   note: '集荷先〜輸出港' },
      { cat: 'customs',      name: '輸出通関費',         note: '通関手数料・書類作成' },
      { cat: 'export-local', name: '港湾諸費用（輸出）', note: 'THC・ドキュメント費等' },
      { cat: 'export-local', name: 'VGM申告費',          note: 'SOLAS VGM（2016年7月義務化）※FCLのみ。LCLはNVOCC負担のためCFS費用に包含が一般的' },
      { cat: 'ocean',        name: '海上運賃',            note: 'ポート〜ポート' },
      { cat: 'surcharge',    name: 'サーチャージ類',      note: 'BAF/CAF/PSS 等' },
      { cat: 'overseas',     name: '仕向地費用',          note: 'D/O・目的港荷役等' },
      { cat: 'export-local', name: 'AMS申告費',           note: '米国向け必須（CBP AMS）。出港前に申告義務' },
      { cat: 'export-local', name: 'ISF申告費',           note: '米国向け必須（ISF 10+2）。Importer Security Filing' },
    ],
    import: [
      { cat: 'ocean',     name: '海上運賃',          note: '積み地港〜仕向港' },
      { cat: 'surcharge', name: 'サーチャージ類',    note: 'BAF/CAF/PSS 等' },
      { cat: 'overseas',  name: '仕向港費用',        note: 'THC・D/O 等' },
      { cat: 'customs',   name: '輸入通関費',        note: '通関手数料・書類作成' },
      { cat: 'domestic',  name: '国内配送費',        note: '港〜納入地' },
      { cat: 'insurance', name: '海上保険料',        note: '保険条件に応じて' },
    ],
    dtd: [
      { cat: 'domestic',     name: '国内集荷・陸送費',   note: '集荷先〜輸出港' },
      { cat: 'customs',      name: '輸出通関費',         note: '通関手数料・書類作成' },
      { cat: 'export-local', name: '港湾諸費用（輸出）', note: 'THC・ドキュメント費等' },
      { cat: 'export-local', name: 'VGM申告費',          note: 'SOLAS VGM（2016年7月義務化）※FCLのみ。LCLはNVOCC負担のためCFS費用に包含が一般的' },
      { cat: 'ocean',        name: '海上運賃',            note: 'ポート〜ポート' },
      { cat: 'surcharge',    name: 'サーチャージ類',      note: 'BAF/CAF/PSS 等' },
      { cat: 'overseas',     name: '仕向地費用',          note: 'D/O・目的港荷役等' },
      { cat: 'customs',      name: '輸入通関費',          note: '通関手数料・書類作成' },
      { cat: 'domestic',     name: '国内配送費（着地）',  note: '港〜最終納入地' },
    ],
  };

  // ===== 倉庫オプショントグル =====
  // ===== コンテナ表示更新（輸送モードに応じて） =====
  function updateRouteModeIcon() {
    const mode = document.getElementById('cond-mode')?.value || '';
    const needsContainer = !mode || mode.includes('FCL') || mode.includes('海上＋陸上');
    const noContainer = !!mode && !needsContainer;
    document.querySelectorAll('[data-scope-key="container"]').forEach(el => {
      el.classList.toggle('mode-hidden', noContainer);
      if (noContainer) el.setAttribute('data-mode-hidden','1');
      else              el.removeAttribute('data-mode-hidden');
    });
    const modeHint = document.getElementById('mode-container-hint');
    if (modeHint) modeHint.style.display = noContainer ? '' : 'none';
  }

  let insuranceOn = false;
  function toggleInsurance() {
    insuranceOn = !insuranceOn;
    const btn = document.getElementById('insToggleBtn');
    if (!btn) return;
    btn.classList.toggle('ins-on', insuranceOn);
    btn.textContent = insuranceOn ? '🛡️ 保険付保あり（ON）' : '🛡️ 保険付保（OFF）';
    btn.title = insuranceOn ? 'クリックで保険付保を解除します' : 'クリックで保険付保を有効にします';
  }


  function curOpts(sel) {
    return CURRENCIES.map(c =>
      `<option value="${c}"${c === sel ? ' selected' : ''}>${c}</option>`
    ).join('');
  }

  function getUserCategories() {
    return SharedStorage.getJSON(SharedStorage.KEYS.USER_CATEGORIES, []);
  }
  function saveUserCategories(cats) {
    SharedStorage.setJSON(SharedStorage.KEYS.USER_CATEGORIES, cats);
  }
  function getAllCategories() {
    return [...CATEGORIES, ...getUserCategories()];
  }

  function catOpts(sel) {
    const userCats = getUserCategories();
    let html = CATEGORIES.map(c =>
      `<option value="${c.value}"${c.value === sel ? ' selected' : ''}>${c.label}</option>`
    ).join('');
    if (userCats.length) {
      html += `<option value="" disabled>──────────</option>`;
      html += userCats.map(c =>
        `<option value="${c.value}"${c.value === sel ? ' selected' : ''}>${c.label}</option>`
      ).join('');
    }
    return html;
  }

  function unitOpts(sel) {
    return UNITS.map(u =>
      `<option value="${u}"${u === sel ? ' selected' : ''}>${u || '— 単位 —'}</option>`
    ).join('');
  }

  function fmt(n) {
    if (isNaN(n) || n === null) return '—';
    return n.toLocaleString('ja-JP', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

// ========== グローバル変数 ==========
let rowCount      = 0;
let dragSrcRow    = null;
let dragSrcRows   = null;  // 多選択ドラッグ時に実際に移動する行群（単一なら [dragSrcRow]）
let tabAddEnabled = true;
let calcRowCount  = 0;
let _lastCalcResult = null;
let _presetPendingScope = null;
let autoSaveTimer   = null;
let autoSaveEnabled = false;

// ========== 為替レート管理 ==========
// JPY以外の通貨のJPY換算レート（1単位 = XX JPY）
// キーはCURRENCIES の値と一致させる
// 最終手動確認日：2026-05-27（API取得失敗時のフォールバック値。定期的に更新のこと）
const DEFAULT_FX_RATES = {
  USD: 150, EUR: 165, CNY: 21, KRW: 0.11, SGD: 112,
  HKD: 19, GBP: 192, AUD: 99, TWD: 4.7, THB: 4.2,
  VND: 0.006, MYR: 32, IDR: 0.0096
};

// 為替レートパネルで表示・編集する通貨を絞り込む
// （行ごとの通貨セレクタや fetchAutoFxRates の対象には影響しない）
const FX_DISPLAY_CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'SGD', 'KRW'];

// ユーザーが上書きしたレート（localStorageから復元）
let _fxRates = { ...DEFAULT_FX_RATES };
// 自動取得モード（true=起動時にAPIから取得、false=手動）
let _fxAutoMode = false;

function loadFxRates() {
  const saved = SharedStorage.getJSON(SharedStorage.KEYS.FX_RATES, {});
  _fxRates = { ...DEFAULT_FX_RATES, ...saved };
  _fxAutoMode = SharedStorage.get(SharedStorage.KEYS.FX_AUTO_MODE, '0') === '1';
}

function saveFxRates() {
  SharedStorage.setJSON(SharedStorage.KEYS.FX_RATES, _fxRates);
}

function setFxAutoMode(on) {
  _fxAutoMode = !!on;
  SharedStorage.set(SharedStorage.KEYS.FX_AUTO_MODE, on ? '1' : '0');
}

/**
 * open.er-api.com から JPYベースのレートを取得して _fxRates を更新する。
 * 取得できなかった通貨は DEFAULT_FX_RATES のままにする。
 * fetch は SharedFX に委譲（実務支援と共通）。
 */
async function fetchAutoFxRates() {
  try {
    const rates = await SharedFX.fetchRates('JPY'); // 1 JPY = X 外貨
    const nonJpy = CURRENCIES.filter(c => c !== 'JPY');
    nonJpy.forEach(cur => {
      if (rates[cur] && rates[cur] > 0) {
        _fxRates[cur] = parseFloat((1 / rates[cur]).toFixed(6)); // 1 外貨 = X JPY
      }
    });
    saveFxRates();
    localStorage.setItem(SharedStorage.KEYS.FX_LAST_FETCHED, new Date().toISOString());
    return true;
  } catch(e) {
    console.warn('為替レート取得失敗:', e);
    return false;
  }
}

/** 金額を JPY に換算（cur が JPY なら そのまま） */
function toJPY(amount, cur) {
  if (!cur || cur === 'JPY') return amount;
  const rate = _fxRates[cur] || 1;
  return amount * rate;
}

loadFxRates();

// ================================================================
// QuoteApp 名前空間ファサード（Phase 2c-Step5）
// ================================================================
// 既存の bare-global を QuoteApp.{state,data,fx}.X からも参照可能にする。
// getter/setter で双方向バインディングしているので、
//   - 既存コードの `rowCount = 5` も `QuoteApp.state.rowCount = 5` も同じ変数を変える
//   - 既存コードの `console.log(rowCount)` も `console.log(QuoteApp.state.rowCount)` も同じ値
// 将来 callsite を `QuoteApp.state.rowCount` 形式に段階的に書き換えた後、
// 最終 phase で bare-global の宣言を消して完全にカプセル化する。
// ================================================================

// データ定数（const、変更不可なので直接参照で OK）
Object.assign(QuoteApp.data, {
  CURRENCIES, UNITS, CATEGORIES, CAT_VALUES, SCOPE_PRESETS,
});

// ===== 貨物情報フィールド デフォルト順序（モード別） =====
// CARGO_FIELD_ORDER: グループ（cargo / volume）ごとにデフォルト順序を定義
// cargo  = 貨物名・品目グループ（#cargoCondGrid）
// volume = 物量情報グループ（#volumeCondGrid）
const CARGO_FIELD_ORDER = {
  fcl: {
    cargo:  ['cargo', 'hs', 'hazmat'],
    // FCL: コンテナ種類・本数を最優先
    volume: ['container-type', 'container-count', 'packing', 'weight', 'volume'],
  },
  lcl: {
    cargo:  ['cargo', 'hs', 'hazmat'],
    // LCL: 重量・容積を最優先。コンテナ関連は末尾（通常非表示）
    volume: ['weight', 'volume', 'packing', 'container-type', 'container-count'],
  },
  air: {
    cargo:  ['cargo', 'hs', 'hazmat'],
    // Air: 重量・容積を最優先。コンテナ関連は末尾（通常非表示）
    volume: ['weight', 'volume', 'packing', 'container-type', 'container-count'],
  },
};

// 状態変数（let、書き込み可能なので getter/setter ペア）
Object.defineProperties(QuoteApp.state, {
  rowCount:            { get: () => rowCount,            set: v => { rowCount = v; },            enumerable: true },
  dragSrcRow:          { get: () => dragSrcRow,          set: v => { dragSrcRow = v; },          enumerable: true },
  dragSrcRows:         { get: () => dragSrcRows,         set: v => { dragSrcRows = v; },         enumerable: true },
  tabAddEnabled:       { get: () => tabAddEnabled,       set: v => { tabAddEnabled = v; },       enumerable: true },
  calcRowCount:        { get: () => calcRowCount,        set: v => { calcRowCount = v; },        enumerable: true },
  lastCalcResult:      { get: () => _lastCalcResult,     set: v => { _lastCalcResult = v; },     enumerable: true },
  presetPendingScope:  { get: () => _presetPendingScope, set: v => { _presetPendingScope = v; }, enumerable: true },
  autoSaveTimer:       { get: () => autoSaveTimer,       set: v => { autoSaveTimer = v; },       enumerable: true },
  autoSaveEnabled:     { get: () => autoSaveEnabled,     set: v => { autoSaveEnabled = v; },     enumerable: true },
  insuranceOn:         { get: () => insuranceOn,         set: v => { insuranceOn = v; },         enumerable: true },
});

// 為替系（getter/setter）
Object.defineProperties(QuoteApp.fx, {
  rates:           { get: () => _fxRates,    set: v => { _fxRates = v; },    enumerable: true },
  autoMode:        { get: () => _fxAutoMode, set: v => { _fxAutoMode = v; }, enumerable: true },
  DEFAULT_RATES:   { value: DEFAULT_FX_RATES, enumerable: true },  // const なので value のみ
});
