// ================================================================
//  インコタームズ データ
// ================================================================
const INCO_STAGES = [
  { key: 'pack',      label: '輸出梱包・荷造り',          group: 'export' },
  { key: 'exInland',  label: '国内陸送（工場→船積港）',    group: 'export' },
  { key: 'exCustoms', label: '輸出通関',                  group: 'export' },
  { key: 'loading',   label: '本船への積み込み',           group: 'export' },
  { key: 'freight',   label: '海上/航空運賃の負担',        group: 'export' },
  { key: 'insurance', label: '貨物保険の付保',            group: 'export' },
  { key: 'imInland',  label: '国内陸送（港→納品先）',     group: 'import' },
  { key: 'imCustoms', label: '輸入通関',                  group: 'import' },
  { key: 'imDuty',    label: '輸入関税・消費税の負担',     group: 'import' },
];

//  seller配列: [梱包, 国内陸↑, 輸出通関, 本船積込, 運賃, 保険, 国内陸↓, 輸入通関, 関税]
//  1=売り手担当, 0=買い手担当
const INCO_DATA = [
  { code:'EXW', name:'Ex Works',                       mode:'all', seller:[1,0,0,0,0,0,0,0,0], note:'売り手の負担が最も少ない条件。工場渡し。ただし輸出通関は買い手（外国企業）が行う建前だが、日本の外為法上の輸出者責任は売り手に留まる場合があり、安全保障輸出管理の観点からも注意が必要。実務上は FCA（指定場所：工場）への切り替えを推奨。' },
  { code:'FCA', name:'Free Carrier',                   mode:'all', seller:[1,1,1,0,0,0,0,0,0], note:'指定場所・指定運送人渡し。複合輸送・コンテナ輸送に適合。Incoterms 2020 より、買い手の要請があれば売り手が船積式（Shipped on Board）B/L を取得できる条項（A6/B6）が追加され、L/C 決済にも対応可能。コンテナ輸送では FOB より適切。' },
  { code:'FAS', name:'Free Alongside Ship',            mode:'sea', seller:[1,1,1,0,0,0,0,0,0], note:'船積港の本船船側渡し。海上・内水路輸送専用。' },
  { code:'FOB', name:'Free On Board',                  mode:'sea', seller:[1,1,1,1,0,0,0,0,0], note:'本船甲板渡し。リスクは本船積込時に移転。コンテナ輸送では CY 搬入後〜本船積み込みまでのリスク帰属が曖昧になるため、実務上は FCA（指定場所：CY）の使用を推奨。' },
  { code:'CFR', name:'Cost and Freight',               mode:'sea', seller:[1,1,1,1,1,0,0,0,0], note:'運賃込み。保険は買い手。海上輸送専用。' },
  { code:'CIF', name:'Cost, Insurance and Freight',    mode:'sea', seller:[1,1,1,1,1,1,0,0,0], note:'運賃・保険料込み。海上輸送専用。日本の貿易で最多。' },
  { code:'CPT', name:'Carriage Paid To',               mode:'all', seller:[1,1,1,1,1,0,0,0,0], note:'運賃込み（CFRの複合輸送版）。保険は買い手。' },
  { code:'CIP', name:'Carriage and Insurance Paid To', mode:'all', seller:[1,1,1,1,1,1,0,0,0], note:'運賃・保険料込み（CIFの複合輸送版）。Incoterms 2020 より売り手の最低付保義務が ICC(A)（全危険担保）に引き上げ。CIF の ICC(C) 最低条件とは異なる点に注意。' },
  { code:'DAP', name:'Delivered at Place',             mode:'all', seller:[1,1,1,1,1,0,1,0,0], note:'仕向地持込渡し。輸入通関・関税は買い手。' },
  { code:'DPU', name:'Delivered at Place Unloaded',    mode:'all', seller:[1,1,1,1,1,0,1,0,0], note:'仕向地荷卸込渡し。DAPとの違いは荷卸し費用が売り手負担になる点（DAPは荷卸し費が買い手）。輸入通関・関税は買い手。' },
  { code:'DDP', name:'Delivered Duty Paid',            mode:'all', seller:[1,1,1,1,1,0,1,1,1], note:'売り手の負担が最も多い条件。関税・通関も売り手負担。ただし仕向国の輸入 VAT（付加価値税）の帰属は Incoterms の文言上で曖昧なため契約書に明記が必要。売り手が仕向国で VAT 登録できない場合は DDP 履行が困難になる。EU・英国・中国向けでは特に注意。' },
];
