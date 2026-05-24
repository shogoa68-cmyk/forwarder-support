// ================================================================
//  CARRIERS マスターデータ
//  URLが判明したら null → アロー関数 に書き換えてください
//  例) vessel: n => `https://example.com/vessel?name=${n}`
// ================================================================
const CARRIERS = {
  'Maersk': {
    icon: '🔵', cls: 'Maersk', domain: 'maersk.com',
    trackingVerified: true,
    top:       'https://www.maersk.com',
    tracking:  n => `https://www.maersk.com/tracking/${n}`,
    vessel:    () => 'https://www.maersk.com/schedules/vesselSchedules',
    schedule:  null,  // 🚧 航路検索 (pol, pod) => URL 未登録
    surchargeImportNote: 'ログイン→Maersk Spotで調べるのが確実',
    surchargeImport: () => 'https://accounts.maersk.com/ocean-maeu/auth/login?nonce=hMg6LVGv6HFbyUx4SxG6&scope=openid%20profile%20email&client_id=portaluser&redirect_uri=https%3A%2F%2Fwww.maersk.com%2Fportaluser%2Foidc%2Fcallback&response_type=code&code_challenge=Qg3hKBD_xC2FjAB_SaUXlu1PqP0Yo-qu4rlBjFMZdF4',
    surchargeExport: null, surchargeOther: null,  // 🚧 サーチャージページ () => URL 未登録
    freetime:  null,  // 🚧 フリータイム検索 n => URL 未登録
    bl:  { url: null, steps: [] },  // 🚧 BL発行依頼: url=手順書URL, steps=['手順1','手順2',...]
    do_: { url: null, steps: [] },  // 🚧 DO発行依頼
    blrules: null,                  // 🚧 BL記載事項URL 未登録
    cycut:   'https://vessel-schedule-service.com/maersk/vessel-schedule?tab=3&information_detail_id=56',
    cycutNote: null,
    routePage:  'https://www.maersk.com/ja-jp/local-information/asia-pacific/japan/routes',
  },
  'MSC': {
    icon: '🟠', cls: 'MSC', domain: 'msc.com',
    trackingClipboard: true,
    top:       'https://www.msc.com/ja',
    tracking:  n => `https://www.msc.com/en/track-a-shipment?agencyPath=mwi&searchInfo=${n}`,
    vessel:    () => 'https://www.msc.com/ja/search-a-schedule',
    schedule:  null,
    surchargeImportNote: 'リンク先の下部、「myMSCユーザーガイド/よくあるお問い合わせ」に情報あり',
    surchargeImport: () => 'https://www.msc.com/ja/local-information/asia-pacific/japan#ローカル情報', surchargeExport: null, surchargeOther: null,
    freetime:  null,
    bl:  { url: null, steps: [] },
    do_: { url: null, steps: [] },
    blrules: null,
    cycut:   'https://www.msc.com/ja/local-information/asia-pacific/japan',
    cycutNote: '⚠️ 更新日が古い場合あり',
    routePage:  'https://www.msc.com/ja/solutions/our-trade-services/east-west-network',
  },
  'CMA CGM': {
    icon: '🟣', cls: 'CMACGM', domain: 'cma-cgm.com',
    trackingClipboard: true,
    top:       'https://www.cma-cgm.com/local/japan-agencies',
    tracking:  n => `https://www.cma-cgm.com/ebusiness/tracking/search?reference=${n}`,
    vessel:    () => 'https://www.cma-cgm.com/ebusiness/schedules/voyage',
    schedule:  () => 'https://www.cma-cgm.com/ebusiness/schedules',
    surchargeImport: () => 'https://www.cma-cgm.com/ebusiness/customer-hub/', surchargeExport: () => 'https://www.cma-cgm.com/ebusiness/customer-hub/', surchargeOther: null,
    freetime:  null,
    bl:  { url: null, steps: [] },
    do_: { url: null, steps: [] },
    blrules: null,
    cycut:   'https://www.toyoshingo.com/cmacgm/',
    cycutNote: '東洋信号経由・各本船情報内にCY OPEN/CUTリンクあり',
    routePage:  'https://www.cma-cgm.com/products-services/flyers',
  },
  'Evergreen': {
    icon: '🟢', cls: 'Evergreen', domain: 'evergreen-line.com',
    trackingClipboard: true,
    top:       'https://www.shipmentlink.com/jp/',
    tracking:  () => 'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do',
    vessel:    () => 'https://ss.shipmentlink.com/tvs2/jsp/TVS2_VesselSchedule.jsp',
    schedule:  () => 'https://ss.shipmentlink.com/tvs2/jsp/TVS2_InteractiveSchedule.jsp',
    surchargeImportNote: 'ログイン必須',
    surchargeImport: () => 'https://www.shipmentlink.com/jp/tuf1/jsp/TUF1_GetLocalCharges.jsp?tradeMode=IMP', surchargeExport: () => 'https://www.shipmentlink.com/jp/texp/jsp/TEXP_LocalCharges.jsp', surchargeOther: null,
    freetime:  null,
    bl:  { url: null, steps: [] },
    do_: { url: null, steps: [] },
    blrules: null,
    cycut:   'https://www.shipmentlink.com/jp/texp/pdf/JP_EXP_CY_OPEN.pdf',
    cycutNote: '📄 PDF直リンク',
    routePage:  'https://www.evergreen-line.com/serviceroutes/jsp/RUT_ServiceRoutes.jsp',
  },
  'ONE': {
    icon: '🔴', cls: 'ONE', domain: 'one-line.com',
    trackingVerified: true,
    top:       'https://jp.one-line.com/ja',
    tracking:  n => `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=${n}`,
    vessel:    () => 'https://ecomm.one-line.com/one-ecom/schedule/vessel-schedule',
    schedule:  null,
    surchargeImport: () => 'https://jp.one-line.com/ja/standard-page/surcharge-list-import', surchargeExport: () => 'https://jp.one-line.com/ja/standard-page/surcharge-list-export', surchargeOther: null,
    freetime:  'https://jp.one-line.com/ja/standard-page/importdetdem',
    bl:  { url: null, steps: [] },
    do_: { url: null, steps: [] },
    blrules: null,
    cycut:   'https://jp.one-line.com/ja/standard-page/schedule-cyopencut',
    cycutNote: null,
    routePage:  'https://www.one-line.com/ja/service-maps',
  },
  'Hapag-Lloyd': {
    icon: '🟡', cls: 'HapagLloyd', domain: 'hapag-lloyd.com',
    trackingVerified: true,
    top:       'https://www.hapag-lloyd.com',
    tracking:  n => `https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html?container=${n}`,
    vessel:    () => 'https://www.hapag-lloyd.com/en/online-business/track/vessel-tracker-solution.html',
    schedule:  null,
    surchargeImport: () => 'https://www.hapag-lloyd.com/en/services-information/offices-localinfo/east-asia/japan/local-info/import.html', surchargeExport: () => 'https://www.hapag-lloyd.com/en/services-information/offices-localinfo/east-asia/japan/local-info/export.html', surchargeOther: null,
    freetime:  null,
    bl:  { url: 'https://www.hapag-lloyd.com/en/services-information/offices-localinfo/east-asia/japan/local-info/export.html', steps: [] },
    do_: { url: 'https://www.hapag-lloyd.com/en/services-information/offices-localinfo/east-asia/japan/local-info/import.html', steps: [] },
    blrules: null,
    cycut:   'https://www.hapag-lloyd.com/en/services-information/offices-localinfo/east-asia/japan/local-info/export.html',
    cycutNote: null,
    routePage:  'https://www.hapag-lloyd.com/en/services-information/routes-trades/gemini-cogh/route-finder.html',
  },
  'Yang Ming': {
    icon: '🩷', cls: 'YangMing', domain: 'yangming.com',
    trackingClipboard: true,
    top:       'https://www.yangming.com',
    tracking:  () => 'https://www.yangming.com/en/esolution/cargo_tracking',
    vessel:    () => 'https://www.yangming.com/en/esolution/schedule/vessel_schedule',
    schedule:  null,
    surchargeImport: () => 'https://e-solution.yangming.com/LocalSite/Local_News_Info_Rwd_Country.aspx?funcDTL_Key=558&func=&localver=JP', surchargeExport: null, surchargeOther: null,
    freetime:  null,
    bl:  { url: null, steps: [] },
    do_: { url: null, steps: [] },
    blrules: null,
    cycut:   'https://e-solution.yangming.com/LocalSite/Local_News_Info_Rwd_Country.aspx?funcDTL_Key=633&func=&localver=JP',
    cycutNote: null,
    routePage:  'https://www.yangming.com/en/service/service_overview/route_map?service=NCT',
  },
  'PIL': {
    icon: '⚪', cls: 'PIL', domain: 'pilship.com',
    trackingClipboard: true,
    top:       'https://www.pilship.com',
    tracking:  () => 'https://www.pilship.com/#asmTrack',
    vessel:    null,  // 該当ページなし
    schedule:  null,
    surchargeImport: null, surchargeExport: null, surchargeOther: null,
    freetime:  null,
    bl:  { url: null, steps: [] },
    do_: { url: null, steps: [] },
    blrules: null,
    cycut:   'https://pilines.jp/guide/cy-terminal',
    cycutNote: null,
    routePage:  'https://pilines.jp/schedule',
  },
  'Wan Hai': {
    icon: '🟤', cls: 'WanHai', domain: 'wanhai.com',
    trackingClipboard: true,
    top:       'https://www.wanhai.com',
    tracking:  n => `https://www.wanhai.com/views/EbsMenu.xhtml`,
    vessel:    () => 'https://www.wanhai.com/views/skd/SkdByVsl.xhtml?file_num=64794',
    schedule:  null,
    surchargeImport: null, surchargeExport: null, surchargeOther: null,
    freetime:  null,
    bl:  { url: null, steps: [] },
    do_: { url: null, steps: [] },
    blrules: null,
    cycut:   'https://jp.wanhai.com/views/content/ContentList.xhtml?file_num=76759',
    cycutNote: null,
    routePage:  'https://jp.wanhai.com/views/skd/SkdBySvc.xhtml?file_num=64836&parent_id=64834&top_file_num=64735',
  },
  'OOCL': {
    icon: '🔵', cls: 'OOCL', domain: 'oocl.com',
    trackingClipboard: true,
    top:       'https://www.oocl.com/japan/jpn/Pages/default.aspx',
    tracking:  n => `https://www.oocl.com/eng/ourservices/eservices/cargotracking/Pages/cargotracking.aspx?containerNo=${n}`,
    vessel:    () => 'https://www.oocl.com/eng/ourservices/eservices/trackandtrace/Pages/default.aspx',
    schedule:  () => 'https://www.oocl.com/jpn/ourservices/eservices/sailingschedule/Pages/nwjpn.aspx',
    surchargeImport: () => 'https://www.oocl.com/japan/jpn/localinformation/localsurcharges/Pages/default.aspx', surchargeExport: () => 'https://www.oocl.com/japan/jpn/localinformation/localsurcharges/Pages/default.aspx', surchargeOther: null,
    freetime:  'https://www.oocl.com/japan/jpn/localinformation/ddfreetime/Pages/default.aspx?site=japan&lang=jpn',
    bl:  { url: null, steps: [] },
    do_: { url: null, steps: [] },
    blrules: null,
    cycut:   'https://www.oocl.com/japan/jpn/localinformation/terminalsandfacilities/Pages/default.aspx?site=japan&lang=jpn',
    cycutNote: null,
    routePage:  'https://www.oocl.com/japan/jpn/localinformation/serviceprofile/Pages/default_serviceprofile2.aspx',
  },
  'COSCO': {
    icon: '🔴', cls: 'COSCO', domain: 'coscoshipping.com',
    trackingClipboard: true,
    top:       'https://world.lines.coscoshipping.com/japan/jp/home',
    tracking:  () => 'https://elines.coscoshipping.com/ebusiness/cargoTracking',
    vessel:    () => 'https://elines.coscoshipping.com/ebusiness/vesselParticulars/vesselParticularsByServices',
    schedule:  () => 'https://elines.coscoshipping.com/ebusiness/sailingSchedule/searchByCity',
    surchargeImport: () => 'https://world.lines.coscoshipping.com/japan/jp/services/surcharge/1/1', surchargeExport: () => 'https://world.lines.coscoshipping.com/japan/jp/services/surcharge/1/1', surchargeOther: null,
    freetime:  null,
    bl:  { url: null, steps: [] },
    do_: { url: null, steps: [] },
    blrules: null,
    cycut:   'https://world.lines.coscoshipping.com/japan/jp/services/CYOPENCUT/1/1',
    cycutNote: null,
    routePage:  'https://world.lines.coscoshipping.com/japan/jp/services/localschedule/1/1',
  },
  'ZIM': {
    icon: '🟠', cls: 'ZIM', domain: 'zim.com',
    trackingClipboard: true,
    top:       'https://www.zim.com',
    tracking:  n => `https://www.zim.com/tools/track-a-shipment?consnumber=${n}`,
    vessel:    () => 'https://www.zim.com/schedules/schedule-by-vessel',
    schedule:  null,
    surchargeImport: null, surchargeExport: null, surchargeOther: null,
    freetime:  null,
    bl:  { url: null, steps: [] },
    do_: { url: null, steps: [] },
    blrules: null,
    cycut:   'https://www.zim.com/global-network/asia-oceania/japan/japan-schedules',
    cycutNote: '⚠️ 直接ページ不明・情報求む',
    routePage:  'https://www.zim.com/schedules/schedule-by-line?mobile=true',
  },
  'IAL': {
    icon: '🔹', cls: 'IAL', domain: 'interasia.cc',
    trackingClipboard: true,
    top:       'https://www.interasia.cc',
    tracking:  () => 'https://www.interasia.cc/Service/Form?servicetype=0',
    vessel:    () => 'https://www.interasia.cc/Service/Form?servicetype=1',
    schedule:  () => 'https://www.interasia.cc/Service/Calendar',
    surchargeImport: () => 'https://www.interasia.cc/Resource/Price', surchargeExport: () => 'https://www.interasia.cc/Resource/Price', surchargeOther: null,
    freetime:  'https://www.mitsui-ofc.jp/freetime-ial',
    bl: { url: null, steps: [] }, do_: { url: null, steps: [] }, blrules: null,
    cycut:   'https://www.interasia.cc/Resource/Port',
    cycutNote: null,
    routePage:  'https://www.interasia.cc/Resource/Router',
  },
  'SITC': {
    icon: '🟣', cls: 'SITC', domain: 'sitcline.com',
    trackingClipboard: true,
    top:       'https://sitc.co.jp/',
    tracking:  () => 'https://ebusiness.sitcline.com/#/topMenu/cargoTrack',
    vessel:    () => 'https://ebusiness.sitcline.com/#/topMenu/vesselMovementSearch',
    schedule:  () => 'https://ebusiness.sitcline.com/#/topMenu/voyagePlanSearch',
    surchargeImport: () => 'https://sitc.co.jp/import/charge_imp', surchargeExport: () => 'https://sitc.co.jp/export/charge_exp', surchargeOther: null,
    freetime:  'https://api.sitcline.com/sitcline/equipment/equipmentFeeSearch',
    bl: { url: null, steps: [] }, do_: { url: null, steps: [] }, blrules: null,
    cycut:   'https://sitc.co.jp/terminal',
    cycutNote: null,
    routePage:  'https://sitc.co.jp/route',
  },
  'HMM': {
    icon: '🔴', cls: 'HMM', domain: 'hmm21.com',
    trackingClipboard: true,
    top:       'https://www.hmm21.com',
    tracking:  () => 'https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do',
    vessel: () => 'https://www.hmm21.com/e-service/general/schedule/ScheduleMain.do', schedule: null, surchargeImport: null, surchargeExport: null, surchargeOther: null, freetime: null,
    bl: { url: null, steps: [] }, do_: { url: null, steps: [] }, blrules: null,
    cycut:   'https://www.hmm21.com/data_files/local/schedule/201023172631.pdf',
    cycutNote: '⚠️ PDF・正確な場所不明・更新要注意',
    routePage:  'https://www.hmm21.com/e-service/general/schedule/serviceNetwork/serviceNetworkCustomizedMain.do?siteTp=C',
  },
  'TSL': {
    icon: '🟢', cls: 'TSL', domain: 'tslines.com',
    trackingClipboard: true,
    top:       'https://www.tslines.com',
    tracking:  () => 'https://www.tslines.com/en/tracking',
    vessel: () => 'https://www.tslines.com/jp/arrivaldate?nowmenu=Search%20By%20Vessel%20Voyage', schedule: null, surchargeImport: null, surchargeExport: null, surchargeOther: null, freetime: null,
    bl: { url: null, steps: [] }, do_: { url: null, steps: [] }, blrules: null,
    cycut:   'https://tsljp.sharepoint.com/:b:/r/sites/Operation/Shared%20Documents/File%20for%20UPDATE/CYOPEN.pdf?csf=1&web=1&e=lDHshN',
    cycutNote: null,
    routePage:  'https://www.tslines.com/jp/sailingservice?reglon=Japan_Korea&sailing=JTK',
  },
  'KMTC': {
    icon: '🟡', cls: 'KMTC', domain: 'ekmtc.com',
    trackingClipboard: true,
    top:       'http://www.kmtcjapan.com/home/index.asp',
    tracking:  () => 'https://www.ekmtc.com/index.html#/cargo-tracking',
    vessel:    () => 'https://www.ekmtc.com/index.html#/schedule/vessel',
    schedule:  () => 'http://www.kmtcjapan.com/home/ship_shipping.asp',
    surchargeImport: () => 'https://www.ekmtc.com/index.html#/common/info/local-charge', surchargeExport: () => 'https://www.ekmtc.com/index.html#/common/info/local-charge', surchargeOther: null,
    freetime:  'http://www.kmtcjapan.com/home/demmurage.asp',
    bl: { url: null, steps: [] }, do_: { url: null, steps: [] }, blrules: null,
    cycut:   null,
    cycutNote: '🔍 調査中',
    routePage:  'http://www.kmtcjapan.com/home/kouro_annai02.asp',
  },
  'SJJ': {
    icon: '🟤', cls: 'SJJ', domain: 'jinjiangshipping.com',
    trackingClipboard: true,
    top:       'https://www.jinjiangshipping.com/',
    tracking:  () => 'https://www.jinjiangshipping.com/tracef.html',
    vessel:    null,
    schedule:  () => 'https://www.jinjiangshipping.com/schedule.html',
    surchargeImport: () => 'https://www.jinjiangshipping.com/charge.html', surchargeExport: () => 'https://www.jinjiangshipping.com/charge_exp.html', surchargeOther: null,
    freetime:  'https://www.mitsui-ofc.jp/freetime-sjj',
    bl: { url: null, steps: [] }, do_: { url: null, steps: [] }, blrules: null,
    cycut:   'https://www.jinjiangshipping.com/JC_CY-OPEN_CUT.pdf',
    cycutNote: '📄 PDF直リンク',
    routePage:  null,
  },
  'NAMSUNG': {
    icon: '🔷', cls: 'NAMSUNG', domain: 'nsl-japan.co.jp',
    trackingClipboard: true,
    top:       'https://nsl-japan.co.jp/',
    tracking:  () => 'https://ebiz.namsung.co.kr/',
    vessel:    () => 'https://ebiz.namsung.co.kr/',
    schedule:  null,
    surchargeImport: () => 'https://ebiz.namsung.co.kr/', surchargeExport: () => 'https://ebiz.namsung.co.kr/', surchargeOther: null,
    freetime:  'https://ebiz.namsung.co.kr/',
    bl: { url: null, steps: [] }, do_: { url: null, steps: [] }, blrules: null,
    cycut:   'https://nsl-japan.co.jp/open_cut/',
    cycutNote: null,
    routePage:  null,
  },
};

// ================================================================
//  外部ポータル（本船動静）
//  url に実際のURLを入れると「開く」ボタンが表示されます
// ================================================================
const VESSEL_PORTALS = [
  {
    name: '東洋信号通信社',
    desc: '国内本船入出港情報・動静',
    note: '各船会社ページが残るが、移行済み船会社はVSSへ誘導される',
    url: 'https://www.toyoshingo.com/',
  },
  {
    name: 'VSS (Vessel Schedule Service)',
    desc: '国内本船スケジュール（東洋信号の新プラットフォーム）',
    note: '移行済み: SITC / Maersk / MSC / ONE / OOCL / Wan Hai / IAL',
    url: 'https://vessel-schedule-service.com/',
  },
  // 必要に応じてオブジェクトを追加してください
];

// ================================================================
//  VSS (Vessel Schedule Service) へ移行済みの船会社別ダイレクトリンク
//  name は CARRIERS のキーに揃える（アイコン・ドメイン参照のため）
// ================================================================
const VSS_CARRIERS = [
  { name: 'SITC',    url: 'https://vessel-schedule-service.com/sitc/vessel-schedule?tab=2' },
  { name: 'Maersk',  url: 'https://vessel-schedule-service.com/maersk/vessel-schedule?tab=2' },
  { name: 'MSC',     url: 'https://vessel-schedule-service.com/msc/vessel-schedule?tab=2' },
  { name: 'ONE',     url: 'https://vessel-schedule-service.com/one/vessel-schedule?tab=2' },
  { name: 'OOCL',    url: 'https://vessel-schedule-service.com/oocl/vessel-schedule?tab=2' },
  { name: 'Wan Hai', url: 'https://vessel-schedule-service.com/wanhai/vessel-schedule?tab=2' },
  { name: 'IAL',     url: 'https://vessel-schedule-service.com/interasia/vessel-schedule?tab=2' },
];

// ================================================================
//  e-Booking URLs
// ================================================================
const BOOKING_URLS = {
  'Maersk':       { url: 'https://www.maersk.com/book', note: '🔐 要ログイン' },
  'MSC':          { url: 'https://www.msc.com/en/book', note: '🔐 要ログイン' },
  'CMA CGM':      { url: 'https://www.cma-cgm.com/ebusiness/booking', note: '🔐 要ログイン' },
  'Evergreen':    { url: 'https://ebooking.evergreen-line.com/', note: '🔐 要ログイン' },
  'ONE':          { url: 'https://ecomm.one-line.com/booking', note: '🔐 要ログイン' },
  'Hapag-Lloyd':  { url: 'https://www.hapag-lloyd.com/en/online-business/booking.html', note: '🔐 要ログイン' },
  'Yang Ming':    { url: 'https://www.yangming.com/e_service/booking_management/', note: '🔐 要ログイン' },
  'Wan Hai':      { url: 'https://ebooking.wanhai.com/', note: '🔐 要ログイン' },
  'OOCL':         { url: 'https://www.oocl.com/OOCL/', note: '🔐 要ログイン' },
  'COSCO':        { url: 'https://elines.coscoshipping.com/ebusiness/booking', note: '🔐 要ログイン' },
  'ZIM':          { url: 'https://www.zim.com/book', note: '🔐 要ログイン' },
  'PIL':          { url: 'https://www.pilship.com/en/e-services/booking/booking-form', note: '🔐 要ログイン' },
  'IAL':          { url: null, note: '⚠️ URL未確認' },
  'SITC':         { url: 'https://ebooking.sitcline.com/', note: '🔐 要ログイン' },
  'HMM':          { url: 'https://www.hmm21.com/cms/business/ebiz/booking/', note: '🔐 要ログイン' },
  'TSL':          { url: null, note: '⚠️ URL未確認' },
  'KMTC':         { url: 'https://www.kmtc.co.kr/e-service/booking', note: '⚠️ URL要確認' },
};

// ================================================================
//  LCL / NVOCC キャリアマスタ
//  schedule: スケジュール照会 URL（静的 string または () => URL）
//  rate:     料金照会 URL（null = 未登録）
//  tracking: 貨物追跡 URL
//  contact:  問い合わせページ
// ================================================================
const CARRIERS_LCL = {
  '近鉄エクスプレス': {
    icon: '🟦', cls: 'KWE', domain: 'kkf.co.jp',
    top:      'https://www.kkf.co.jp',
    schedule: 'https://www.kkf.co.jp/service/ocean/lcl/',
    rate:     null,
    tracking: 'https://www.kkf.co.jp/tracking/',
    contact:  'https://www.kkf.co.jp/contact/',
  },
  '日本通運': {
    icon: '🟥', cls: 'NX', domain: 'nipponexpress.com',
    top:      'https://www.nipponexpress.com/jp/',
    schedule: 'https://www.nipponexpress.com/jp/service/logistics/ocean/',
    rate:     null,
    tracking: 'https://tracking.nipponexpress.com',
    contact:  'https://www.nipponexpress.com/jp/contact/',
  },
  'MOLロジスティクス': {
    icon: '🟠', cls: 'MOL', domain: 'mol-logistics.com',
    top:      'https://www.mol-logistics.com/jp/',
    schedule: null,
    rate:     null,
    tracking: null,
    contact:  'https://www.mol-logistics.com/jp/contact/',
  },
  '郵船ロジスティクス': {
    icon: '🔵', cls: 'YusenLog', domain: 'yusen-logistics.com',
    top:      'https://www.yusen-logistics.com/jp/',
    schedule: null,
    rate:     null,
    tracking: null,
    contact:  null,
  },
  'Kラインロジスティクス': {
    icon: '🟡', cls: 'KLL', domain: 'klinelog.co.jp',
    top:      'https://www.klinelog.co.jp',
    schedule: null,
    rate:     null,
    tracking: null,
    contact:  'https://www.klinelog.co.jp/contact/',
  },
};

// ================================================================
//  航空キャリアマスタ
//  schedule: フライトスケジュール URL
//  rate:     料金照会 URL
//  tracking: 貨物追跡 URL
//  awb:      e-AWB / 運送状発行 URL
// ================================================================
const CARRIERS_AIR = {
  'JAL Cargo': {
    icon: '🔴', cls: 'JAL', domain: 'jal.co.jp',
    top:      'https://cargo.jal.co.jp',
    schedule: 'https://cargo.jal.co.jp/cargo/schedules',
    rate:     'https://cargo.jal.co.jp/cargo/rate',
    tracking: 'https://cargo.jal.co.jp/cargo/tracking',
    awb:      null,
  },
  'ANA Cargo': {
    icon: '🔵', cls: 'ANA', domain: 'anacargo.jp',
    top:      'https://www.anacargo.jp',
    schedule: 'https://www.anacargo.jp/ja/schedules/',
    rate:     'https://www.anacargo.jp/ja/tariff/',
    tracking: 'https://www.anacargo.jp/ja/tracking/',
    awb:      null,
  },
  'Cathay Cargo': {
    icon: '🟢', cls: 'Cathay', domain: 'cathaycargo.com',
    top:      'https://www.cathaycargo.com',
    schedule: 'https://www.cathaycargo.com/en/cargo-services/flight-schedule/',
    rate:     null,
    tracking: 'https://www.cathaycargo.com/en/tracking/',
    awb:      null,
  },
  'Korean Air Cargo': {
    icon: '⚫', cls: 'KAL', domain: 'koreanair.com',
    top:      'https://www.koreanair.com/global/en/booking/cargo',
    schedule: null,
    rate:     null,
    tracking: null,
    awb:      null,
  },
  'SIA Cargo': {
    icon: '🟡', cls: 'SIA', domain: 'singaporeaircargo.com',
    top:      'https://www.singaporeaircargo.com',
    schedule: null,
    rate:     null,
    tracking: null,
    awb:      null,
  },
  'NCA': {
    icon: '⚪', cls: 'NCA', domain: 'nca.aero',
    top:      'https://www.nca.aero',
    schedule: null,
    rate:     null,
    tracking: 'https://www.nca.aero/tracking/',
    awb:      null,
  },
  'Emirates SkyCargo': {
    icon: '🟣', cls: 'Emirates', domain: 'skycargo.com',
    top:      'https://www.skycargo.com',
    schedule: null,
    rate:     null,
    tracking: null,
    awb:      null,
  },
};

// ================================================================
//  キャリアタイプ別リンク定義
//  key:     キャリアオブジェクトのプロパティ名
//  label:   表示ラベル
//  noteKey: ツールチップ用 note を取る別プロパティ名（null = key+'Note' or key）
// ================================================================
const CARRIER_LINK_DEFS = {
  fcl: [
    { key: 'vessel',          label: '🗓 スケジュール',    noteKey: null },
    { key: 'surchargeImport', label: '📥 輸入サーチャージ', noteKey: 'surchargeImportNote' },
    { key: 'surchargeExport', label: '📤 輸出サーチャージ', noteKey: null },
    { key: 'routePage',       label: '🗺 航路',             noteKey: null },
    { key: 'cycut',           label: '⏱ CY-CUT',           noteKey: 'cycutNote' },
  ],
  lcl: [
    { key: 'schedule', label: '🗓 スケジュール', noteKey: null },
    { key: 'rate',     label: '💴 料金照会',     noteKey: null },
    { key: 'tracking', label: '📦 追跡',         noteKey: null },
    { key: 'contact',  label: '📞 問い合わせ',   noteKey: null },
  ],
  air: [
    { key: 'schedule', label: '🗓 フライト',     noteKey: null },
    { key: 'rate',     label: '💴 料金照会',     noteKey: null },
    { key: 'tracking', label: '📦 追跡',         noteKey: null },
    { key: 'awb',      label: '📋 e-AWB',        noteKey: null },
  ],
};
