#!/usr/bin/env node
// ブックマーク初期データ生成スクリプト
// Usage:
//   cd docs
//   node generate-bookmark-seed.js > seed-bookmarks.sql
//   # → Supabase SQL Editor に貼り付けて実行

const fs   = require('fs');
const path = require('path');

// carriers.js を読み込んで評価
const code = fs.readFileSync(
  path.join(__dirname, '../フォワーダー支援/data/carriers.js'),
  'utf8'
);
// Function コンストラクタで独立スコープ評価（eval の代替）
const { CARRIERS, CARRIERS_LCL, BOOKING_URLS } = new Function(
  code + '\nreturn { CARRIERS, CARRIERS_LCL, BOOKING_URLS };'
)();

// URL 解決（null / string / () => URL / n => URL を統一処理）
function resolveUrl(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'function') {
    try {
      if (val.length === 0) return val();             // () => URL
      const u = val('');                              // n => URL（番号なし）
      if (u && typeof u === 'string' && !u.includes('undefined')) return u;
      return null;
    } catch { return null; }
  }
  return null;
}

function esc(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const rows = [];

function add(label, urlVal, carrier_type, carrier, fn, note) {
  const url = resolveUrl(urlVal);
  if (!url && !note) return;          // URL もメモもなければスキップ
  rows.push({ label, url, carrier_type, carrier, function: fn, note: note || null });
}

// ── FCL 船会社 ──────────────────────────────────────────────────
for (const [name, c] of Object.entries(CARRIERS)) {
  if (c.tracking)
    add(`${name} コンテナ追跡`,    c.tracking,       'FCL', name, 'コンテナ追跡',    null);
  if (c.vessel)
    add(`${name} スケジュール`,    c.vessel,          'FCL', name, 'スケジュール',    null);
  if (c.cycut || c.cycutNote)
    add(`${name} CY OPEN/CUT`,    c.cycut,           'FCL', name, 'CY OPEN/CUT',    c.cycutNote || null);
  if (c.routePage)
    add(`${name} サービス航路`,    c.routePage,       'FCL', name, '航路',            null);
  if (c.surchargeImport || c.surchargeImportNote)
    add(`${name} 輸入サーチャージ`, c.surchargeImport, 'FCL', name, '輸入サーチャージ', c.surchargeImportNote || null);
  if (c.surchargeExport)
    add(`${name} 輸出サーチャージ`, c.surchargeExport, 'FCL', name, '輸出サーチャージ', null);
}

// ── e-Booking ────────────────────────────────────────────────────
for (const [name, b] of Object.entries(BOOKING_URLS)) {
  add(`${name} e-Booking`, b.url, 'FCL', name, 'ブッキング', b.note || null);
}

// ── LCL / NVOCC ──────────────────────────────────────────────────
for (const [name, c] of Object.entries(CARRIERS_LCL)) {
  if (c.schedule)
    add(`${name} スケジュール`,  c.schedule, 'LCL', name, 'スケジュール',  null);
  if (c.rate)
    add(`${name} 料金照会`,      c.rate,     'LCL', name, 'レート',        null);
  if (c.tracking)
    add(`${name} コンテナ追跡`,  c.tracking, 'LCL', name, 'コンテナ追跡',  null);
  if (c.booking)
    add(`${name} e-Booking`,     c.booking,  'LCL', name, 'ブッキング',    null);
}

// ── SQL 生成 ─────────────────────────────────────────────────────
console.log('-- ============================================================');
console.log('-- bookmarks テーブル シードデータ');
console.log('-- carriers.js から generate-bookmark-seed.js で自動生成');
console.log('-- ============================================================');
console.log('');
if (!rows.length) { console.error('No rows generated'); process.exit(1); }

console.log('insert into public.bookmarks');
console.log('  (label, url, carrier_type, carrier, "function", note, created_by)');
console.log('values');
rows.forEach((r, i) => {
  const comma = i < rows.length - 1 ? ',' : ';';
  console.log(
    `  (${esc(r.label)}, ${esc(r.url)}, ${esc(r.carrier_type)}, ${esc(r.carrier)}, ${esc(r.function)}, ${esc(r.note)}, 'system@seed')${comma}`
  );
});
console.log('');
console.log(`-- 合計: ${rows.length} 件`);
