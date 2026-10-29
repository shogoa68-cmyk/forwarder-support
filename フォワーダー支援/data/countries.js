// 国のマスター（候補）と、主要な港 → 国 の対応表。港のマスターの「国」の入力候補と、国の自動付与（候補の提案）に使う。
// 国は国コード（ISO 3166-1 alpha-2）で保存し、表示は日本語名。ここに無い国は、コードまたは名前をそのまま入力できる。
(function () {
  'use strict';
  const RAW = "JP 日本 Japan|KR 韓国 South Korea|CN 中国 China|HK 香港 Hong Kong|TW 台湾 Taiwan|MO マカオ Macao|MN モンゴル Mongolia|VN ベトナム Vietnam|TH タイ Thailand|SG シンガポール Singapore|MY マレーシア Malaysia|ID インドネシア Indonesia|PH フィリピン Philippines|KH カンボジア Cambodia|LA ラオス Laos|MM ミャンマー Myanmar|BN ブルネイ Brunei|TL 東ティモール Timor-Leste|IN インド India|PK パキスタン Pakistan|BD バングラデシュ Bangladesh|LK スリランカ Sri Lanka|NP ネパール Nepal|MV モルディブ Maldives|BT ブータン Bhutan|AF アフガニスタン Afghanistan|KZ カザフスタン Kazakhstan|UZ ウズベキスタン Uzbekistan|KG キルギス Kyrgyzstan|TJ タジキスタン Tajikistan|TM トルクメニスタン Turkmenistan|AE アラブ首長国連邦 United Arab Emirates|SA サウジアラビア Saudi Arabia|QA カタール Qatar|KW クウェート Kuwait|BH バーレーン Bahrain|OM オマーン Oman|YE イエメン Yemen|IQ イラク Iraq|IR イラン Iran|IL イスラエル Israel|JO ヨルダン Jordan|LB レバノン Lebanon|SY シリア Syria|TR トルコ Turkey|CY キプロス Cyprus|GE ジョージア Georgia|AM アルメニア Armenia|AZ アゼルバイジャン Azerbaijan|GB 英国 United Kingdom|IE アイルランド Ireland|FR フランス France|DE ドイツ Germany|NL オランダ Netherlands|BE ベルギー Belgium|LU ルクセンブルク Luxembourg|CH スイス Switzerland|AT オーストリア Austria|IT イタリア Italy|ES スペイン Spain|PT ポルトガル Portugal|GR ギリシャ Greece|MT マルタ Malta|DK デンマーク Denmark|SE スウェーデン Sweden|NO ノルウェー Norway|FI フィンランド Finland|IS アイスランド Iceland|PL ポーランド Poland|CZ チェコ Czechia|SK スロバキア Slovakia|HU ハンガリー Hungary|RO ルーマニア Romania|BG ブルガリア Bulgaria|HR クロアチア Croatia|SI スロベニア Slovenia|RS セルビア Serbia|BA ボスニア・ヘルツェゴビナ Bosnia and Herzegovina|ME モンテネグロ Montenegro|AL アルバニア Albania|MK 北マケドニア North Macedonia|EE エストニア Estonia|LV ラトビア Latvia|LT リトアニア Lithuania|UA ウクライナ Ukraine|BY ベラルーシ Belarus|MD モルドバ Moldova|RU ロシア Russia|EG エジプト Egypt|MA モロッコ Morocco|DZ アルジェリア Algeria|TN チュニジア Tunisia|LY リビア Libya|SD スーダン Sudan|ET エチオピア Ethiopia|DJ ジブチ Djibouti|ER エリトリア Eritrea|SO ソマリア Somalia|KE ケニア Kenya|TZ タンザニア Tanzania|UG ウガンダ Uganda|RW ルワンダ Rwanda|MZ モザンビーク Mozambique|MG マダガスカル Madagascar|MU モーリシャス Mauritius|ZA 南アフリカ South Africa|NA ナミビア Namibia|BW ボツワナ Botswana|ZM ザンビア Zambia|ZW ジンバブエ Zimbabwe|AO アンゴラ Angola|CD コンゴ民主共和国 DR Congo|CG コンゴ共和国 Republic of the Congo|GA ガボン Gabon|CM カメルーン Cameroon|NG ナイジェリア Nigeria|GH ガーナ Ghana|CI コートジボワール Cote d'Ivoire|SN セネガル Senegal|TG トーゴ Togo|BJ ベナン Benin|GN ギニア Guinea|SL シエラレオネ Sierra Leone|LR リベリア Liberia|MR モーリタニア Mauritania|US 米国 United States|CA カナダ Canada|MX メキシコ Mexico|PA パナマ Panama|CR コスタリカ Costa Rica|GT グアテマラ Guatemala|HN ホンジュラス Honduras|SV エルサルバドル El Salvador|NI ニカラグア Nicaragua|BZ ベリーズ Belize|CU キューバ Cuba|JM ジャマイカ Jamaica|DO ドミニカ共和国 Dominican Republic|HT ハイチ Haiti|BS バハマ Bahamas|TT トリニダード・トバゴ Trinidad and Tobago|BB バルバドス Barbados|PR プエルトリコ Puerto Rico|CO コロンビア Colombia|VE ベネズエラ Venezuela|EC エクアドル Ecuador|PE ペルー Peru|BR ブラジル Brazil|AR アルゼンチン Argentina|CL チリ Chile|UY ウルグアイ Uruguay|PY パラグアイ Paraguay|BO ボリビア Bolivia|GY ガイアナ Guyana|SR スリナム Suriname|AU オーストラリア Australia|NZ ニュージーランド New Zealand|PG パプアニューギニア Papua New Guinea|FJ フィジー Fiji|NC ニューカレドニア New Caledonia|PF 仏領ポリネシア French Polynesia|GU グアム Guam|WS サモア Samoa|TO トンガ Tonga|VU バヌアツ Vanuatu|SB ソロモン諸島 Solomon Islands";
  const COUNTRIES = RAW.split('|').map(s => { const p = s.split(' '); const code = p.shift(); const ja = p.shift(); return { code, ja, en: p.join(' ') }; });
  const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s　.,()（）・\-_'"’]/g, '');
  const byCode = new Map(COUNTRIES.map(c => [c.code, c]));
  const byName = new Map();
  COUNTRIES.forEach(c => { [c.code, c.ja, c.en].forEach(n => byName.set(norm(n), c)); });
  // よく使う別の呼び方
  [['USA', 'US'], ['UNITEDSTATESOFAMERICA', 'US'], ['アメリカ', 'US'], ['米国', 'US'], ['UK', 'GB'], ['GREATBRITAIN', 'GB'], ['イギリス', 'GB'], ['英国', 'GB'], ['KOREA', 'KR'], ['REPUBLICOFKOREA', 'KR'], ['UAE', 'AE'], ['アラブ首長国連邦', 'AE'], ['UAE', 'AE'], ['PRC', 'CN'], ['PEOPLESREPUBLICOFCHINA', 'CN'], ['VIETNAM', 'VN'], ['VIETNAM', 'VN'], ['VIETNAM', 'VN'], ['CZECHREPUBLIC', 'CZ'], ['TURKIYE', 'TR'], ['トルコ', 'TR'], ['ホンコン', 'HK'], ['台湾', 'TW']].forEach(([n, c]) => byName.set(norm(n), byCode.get(c)));
  // 入力（コード・日本語名・英語名・「ベトナム（VN）」の形）から国を探す
  window.findCountry = function (text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const m = t.match(/[（(]([A-Za-z]{2})[）)]\s*$/);
    return (m && byCode.get(m[1].toUpperCase())) || byName.get(norm(t)) || null;
  };
  window.countryLabel = function (code) { const c = byCode.get(String(code || '').toUpperCase()); return c ? c.ja + '（' + c.code + '）' : String(code || ''); };
  window.countryJa = function (code) { const c = byCode.get(String(code || '').toUpperCase()); return c ? c.ja : String(code || ''); };
  window.COUNTRY_LIST = COUNTRIES;
  // 国連の地理区分（UN M.49）：大陸（地域）→ 小地域 → 国。国が多いときに、地域から絞り込めるようにする
  const CONTINENTS = [['AS', 'アジア'], ['EU', 'ヨーロッパ'], ['AF', 'アフリカ'], ['AM', 'アメリカ'], ['OC', 'オセアニア']];
  const SUBREGIONS = [
    ['EAS', '東アジア', 'AS', 'JP KR CN HK TW MO MN'], ['SEA', '東南アジア', 'AS', 'VN TH SG MY ID PH KH LA MM BN TL'],
    ['SAS', '南アジア', 'AS', 'IN PK BD LK NP MV BT AF IR'], ['CAS', '中央アジア', 'AS', 'KZ UZ KG TJ TM'],
    ['WAS', '西アジア（中東）', 'AS', 'AE SA QA KW BH OM YE IQ IL JO LB SY TR CY GE AM AZ'],
    ['NEU', '北ヨーロッパ', 'EU', 'GB IE DK SE NO FI IS EE LV LT'], ['WEU', '西ヨーロッパ', 'EU', 'FR DE NL BE LU CH AT'],
    ['SEU', '南ヨーロッパ', 'EU', 'IT ES PT GR MT HR SI RS BA ME AL MK'], ['EEU', '東ヨーロッパ', 'EU', 'PL CZ SK HU RO BG UA BY MD RU'],
    ['NAF', '北アフリカ', 'AF', 'EG MA DZ TN LY SD'], ['EAF', '東アフリカ', 'AF', 'ET DJ ER SO KE TZ UG RW MZ MG MU ZM ZW'],
    ['MAF', '中部アフリカ', 'AF', 'AO CD CG GA CM'], ['SAF', '南部アフリカ', 'AF', 'ZA NA BW'],
    ['WAF', '西アフリカ', 'AF', 'NG GH CI SN TG BJ GN SL LR MR'],
    ['NAM', '北米', 'AM', 'US CA'], ['CAM', '中米', 'AM', 'MX PA CR GT HN SV NI BZ'], ['CAR', 'カリブ海', 'AM', 'CU JM DO HT BS TT BB PR'],
    ['SAM', '南米', 'AM', 'CO VE EC PE BR AR CL UY PY BO GY SR'],
    ['ANZ', 'オーストラリア・ニュージーランド', 'OC', 'AU NZ'], ['MEL', 'メラネシア', 'OC', 'PG FJ NC VU SB'], ['MIC', 'ミクロネシア', 'OC', 'GU'], ['POL', 'ポリネシア', 'OC', 'PF WS TO'],
  ];
  const regionOf = new Map();
  SUBREGIONS.forEach(([sub, , cont, codes]) => codes.split(' ').forEach(c => regionOf.set(c, { sub, continent: cont })));
  window.COUNTRY_CONTINENTS = CONTINENTS.map(([key, ja]) => ({ key, ja }));
  window.COUNTRY_SUBREGIONS = SUBREGIONS.map(([key, ja, continent]) => ({ key, ja, continent }));
  // 国コード → { sub, continent }（M.49）。区分が分からない国は null
  window.countryRegion = code => regionOf.get(String(code || '').toUpperCase()) || null;
  // 得意エリア：国内＝日本の 8 地方（と日本全国）／海外＝UN M.49 の小地域と国。サブコン・キャリアの詳細で複数選ぶ
  const JP_AREAS = [['JP-HKD', '北海道'], ['JP-TOH', '東北'], ['JP-KAN', '関東'], ['JP-CHU', '中部'], ['JP-KIN', '近畿'], ['JP-CGK', '中国'], ['JP-SHK', '四国'], ['JP-KYU', '九州・沖縄']];
  window.AREA_JP = JP_AREAS.map(([key, ja]) => ({ key, ja }));
  window.areaKind = key => (key === 'JP' || String(key).indexOf('JP-') === 0) ? 'DOM' : 'OVS';
  window.areaLabel = function (key) {
    if (key === 'JP') return '日本全国';
    const jp = JP_AREAS.find(x => x[0] === key); if (jp) return jp[1];
    const sub = SUBREGIONS.find(x => x[0] === key); if (sub) return sub[1];
    return window.countryJa(key);
  };
  // 得意エリアのグループ（見出し）：国内はそのまま、海外は国なら属する小地域
  window.areaGroupKey = function (key) {
    if (window.areaKind(key) === 'DOM') return key;
    if (SUBREGIONS.some(x => x[0] === key)) return key;
    const r = window.countryRegion(key); return r ? r.sub : 'ZZ';
  };
  // vendorKeys（登録された得意エリア）が、filterKey（見たいエリア）をカバーするか。
  //   国・小地域・日本の地方どうしの包含を考える（例：「東南アジア」を得意とする会社は、ベトナムでもヒット／「日本全国」は各地方にヒット）
  window.areaCovers = function (vendorKeys, filterKey) {
    const set = new Set(vendorKeys || []);
    if (set.has(filterKey)) return true;
    if (String(filterKey).indexOf('JP-') === 0) return set.has('JP');
    if (SUBREGIONS.some(x => x[0] === filterKey)) return [...set].some(k => { const r = window.countryRegion(k); return r && r.sub === filterKey; });
    const r = window.countryRegion(filterKey); return !!(r && set.has(r.sub));
  };


  const PORTS = {"JP": "YOKOHAMA|TOKYO|KOBE|OSAKA|NAGOYA|HAKATA|FUKUOKA|MOJI|KITAKYUSHU|SHIMIZU|KAWASAKI|CHIBA|SENDAI|NIIGATA|HIROSHIMA|HAKODATE|YOKKAICHI|TOYAMA|KANAZAWA|OITA|KUSHIRO|TOMAKOMAI|MIZUSHIMA|横浜|東京|神戸|大阪|名古屋|博多|門司|清水", "KR": "BUSAN|PUSAN|INCHEON|GWANGYANG|ULSAN|PYEONGTAEK|POHANG|釜山|仁川", "CN": "SHANGHAI|NINGBO|QINGDAO|TIANJIN|XINGANG|DALIAN|XIAMEN|FUZHOU|GUANGZHOU|NANSHA|SHENZHEN|YANTIAN|SHEKOU|CHIWAN|ZHANGJIAGANG|NANJING|TAICANG|LIANYUNGANG|YINGKOU|LONGKOU|RIZHAO|ZHONGSHAN|ZHUHAI|SHANTOU|HUANGPU|WUHAN|CHONGQING|SUZHOU|NANTONG|YANTAI|QINHUANGDAO|上海|寧波|青島|天津|大連|厦門|深セン|広州", "HK": "HONG KONG|HONGKONG|香港", "TW": "KAOHSIUNG|KEELUNG|TAICHUNG|TAIPEI|高雄|基隆|台中", "VN": "HAIPHONG|HAI PHONG|HO CHI MINH|HOCHIMINH|HCMC|SAIGON|CAT LAI|DA NANG|DANANG|CAI MEP|QUY NHON|HANOI|HIEP PHUOC|ハイフォン|ホーチミン", "TH": "BANGKOK|LAEM CHABANG|LAMCHABANG|SIRACHA|バンコク|レムチャバン", "SG": "SINGAPORE|シンガポール", "MY": "PORT KLANG|KLANG|PASIR GUDANG|PENANG|TANJUNG PELEPAS|KUANTAN|KUCHING|BINTULU|KOTA KINABALU", "ID": "JAKARTA|TANJUNG PRIOK|SURABAYA|SEMARANG|BELAWAN|MAKASSAR|PANJANG|JAKARTA", "PH": "MANILA|CEBU|DAVAO|SUBIC|BATANGAS|CAGAYAN DE ORO", "KH": "SIHANOUKVILLE|PHNOM PENH", "MM": "YANGON|RANGOON", "IN": "NHAVA SHEVA|MUMBAI|JNPT|CHENNAI|KOLKATA|MUNDRA|COCHIN|KOCHI|TUTICORIN|VISAKHAPATNAM|PIPAVAV|KATTUPALLI|HAZIRA|KANDLA|NEW DELHI|BANGALORE", "LK": "COLOMBO", "PK": "KARACHI|QASIM|PORT QASIM", "BD": "CHITTAGONG|CHATTOGRAM|DHAKA", "AE": "JEBEL ALI|DUBAI|ABU DHABI|KHALIFA|SHARJAH", "SA": "DAMMAM|JEDDAH|RIYADH|KING ABDULLAH PORT", "QA": "DOHA|HAMAD", "KW": "KUWAIT|SHUWAIKH|SHUAIBA", "BH": "BAHRAIN|KHALIFA BIN SALMAN", "OM": "SOHAR|SALALAH|MUSCAT|DUQM", "IQ": "UMM QASR|BASRA", "IR": "BANDAR ABBAS|BANDAR ABBAS", "JO": "AQABA", "IL": "HAIFA|ASHDOD", "TR": "MERSIN|ISTANBUL|AMBARLI|IZMIR|ALIAGA|GEBZE|MARPORT|GEMLIK|KOCAELI|MERSIN", "EG": "PORT SAID|ALEXANDRIA|DAMIETTA|SOKHNA|AIN SOKHNA|EAST PORT SAID", "MA": "TANGER MED|TANGIER|CASABLANCA", "DJ": "DJIBOUTI", "KE": "MOMBASA|NAIROBI", "TZ": "DAR ES SALAAM", "ZA": "DURBAN|CAPE TOWN|PORT ELIZABETH|NGQURA|JOHANNESBURG", "NG": "LAGOS|APAPA|LEKKI|TIN CAN", "GH": "TEMA", "CI": "ABIDJAN", "SN": "DAKAR", "TG": "LOME", "BJ": "COTONOU", "AO": "LUANDA", "MZ": "MAPUTO|BEIRA", "NL": "ROTTERDAM|AMSTERDAM", "BE": "ANTWERP|ZEEBRUGGE|GHENT", "DE": "HAMBURG|BREMERHAVEN|BREMEN|DUESSELDORF|DUSSELDORF|FRANKFURT|WILHELMSHAVEN", "GB": "FELIXSTOWE|SOUTHAMPTON|LONDON GATEWAY|LONDON|LIVERPOOL|TILBURY|THAMESPORT|IMMINGHAM", "FR": "LE HAVRE|MARSEILLE|FOS|DUNKIRK|PARIS|FOS SUR MER", "ES": "BARCELONA|VALENCIA|ALGECIRAS|BILBAO|MADRID", "PT": "LISBON|SINES|LEIXOES|PORTO", "IT": "GENOA|GENOVA|LA SPEZIA|NAPLES|GIOIA TAURO|VENICE|TRIESTE|LIVORNO|SALERNO|MILAN", "GR": "PIRAEUS|THESSALONIKI", "PL": "GDANSK|GDYNIA|SZCZECIN", "LT": "KLAIPEDA", "LV": "RIGA", "EE": "TALLINN", "FI": "HELSINKI|KOTKA|HAMINA", "SE": "GOTHENBURG|GOTEBORG|STOCKHOLM", "DK": "AARHUS|COPENHAGEN", "IE": "DUBLIN|CORK", "RO": "CONSTANTA", "UA": "ODESSA|ODESA|CHORNOMORSK", "RU": "ST PETERSBURG|SAINT PETERSBURG|VLADIVOSTOK|NOVOROSSIYSK|VOSTOCHNY|MOSCOW|NAKHODKA", "US": "LOS ANGELES|LONG BEACH|OAKLAND|SEATTLE|TACOMA|NEW YORK|NEWARK|SAVANNAH|CHARLESTON|NORFOLK|BALTIMORE|HOUSTON|MIAMI|JACKSONVILLE|NEW ORLEANS|CHICAGO|DALLAS|ATLANTA|SAN FRANCISCO|PORTLAND|PHILADELPHIA|BOSTON|HONOLULU|MEMPHIS|DETROIT|LA|LB", "CA": "VANCOUVER|PRINCE RUPERT|MONTREAL|HALIFAX|TORONTO", "MX": "MANZANILLO|LAZARO CARDENAS|VERACRUZ|ENSENADA|ALTAMIRA|MEXICO CITY", "PA": "PANAMA|BALBOA|COLON|CRISTOBAL|MANZANILLO INTERNATIONAL", "JM": "KINGSTON", "BR": "SANTOS|ITAJAI|PARANAGUA|RIO DE JANEIRO|NAVEGANTES|SALVADOR|SAO PAULO|ITAPOA|RIO GRANDE", "AR": "BUENOS AIRES", "UY": "MONTEVIDEO", "CL": "VALPARAISO|SAN ANTONIO|SANTIAGO", "PE": "CALLAO|LIMA", "EC": "GUAYAQUIL", "CO": "CARTAGENA|BUENAVENTURA|BOGOTA", "AU": "SYDNEY|MELBOURNE|BRISBANE|FREMANTLE|ADELAIDE|PERTH", "NZ": "AUCKLAND|TAURANGA|LYTTELTON|WELLINGTON"};
  const portIdx = new Map();
  Object.keys(PORTS).forEach(code => PORTS[code].split('|').forEach(n => portIdx.set(norm(n), code)));
  // 港の名前から国コードを推測する（「HAIPHONG」「YOKOHAMA, JAPAN」「横浜」など）。分からなければ null
  window.guessPortCountry = function (name) {
    const t = String(name || '').trim();
    if (!t) return null;
    const parts = t.split(/[,，、\/／]/).map(x => x.trim()).filter(Boolean);
    if (parts.length > 1) { const c = window.findCountry(parts[parts.length - 1]); if (c) return c.code; }
    const direct = portIdx.get(norm(parts[0]));
    if (direct) return direct;
    const stripped = norm(parts[0]).replace(/(port|ポート|港|ko|terminal|ターミナル)$/g, '');
    return portIdx.get(stripped) || null;
  };
})();
