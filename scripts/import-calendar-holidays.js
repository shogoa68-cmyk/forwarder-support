#!/usr/bin/env node
/*
 * import-calendar-holidays.js — 祝日ICSファイルを calendar_holidays へ取込
 *
 * 使い方：
 *   node scripts/import-calendar-holidays.js --file scripts/ics-input/jp.ics --source-type jp --country JP
 *   node scripts/import-calendar-holidays.js --url https://.../basic.ics    --source-type overseas --country CN
 *
 * 前提：
 *   ・docs/sql/calendar-migration.sql を Supabase に適用済みであること
 *   ・環境変数 SUPABASE_URL / SUPABASE_SERVICE_KEY を設定しておくこと
 *     （service_role キーはコミットしないこと。ブラウザ用の publishable key とは別物）
 *
 * 依存追加なし。Node 標準の https のみで REST API へ upsert する
 * （このリポジトリはビルドステップなしの静的サイトのため npm 依存を増やさない方針）。
 */
'use strict';
const fs = require('fs');
const https = require('https');

// ---- 引数解析 ---------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1];
      i++;
    }
  }
  return out;
}

// ---- ICSパース（DTSTART/SUMMARY/UID/RRULE:FREQ=YEARLY のみ対応） -------
function parseIcs(text) {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const lines = unfolded.split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const rawKey = line.slice(0, idx);
    const key = rawKey.split(';')[0];
    const val = line.slice(idx + 1).trim();
    if (key === 'DTSTART') cur.dtstart = val.slice(0, 8);
    else if (key === 'SUMMARY') cur.summary = val.replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\\\/g, '\\');
    else if (key === 'UID') cur.uid = val;
    else if (key === 'RRULE') cur.rrule = val;
  }
  return events;
}

function toIsoDate(yyyymmdd) {
  return yyyymmdd.slice(0, 4) + '-' + yyyymmdd.slice(4, 6) + '-' + yyyymmdd.slice(6, 8);
}

// yearly RRULE の展開（実際のフィードはほとんど単発VEVENTなので保険的な処理）
function expandDates(ev, yearFrom, yearTo) {
  if (!ev.dtstart) return [];
  if (!ev.rrule || !/FREQ=YEARLY/.test(ev.rrule)) return [toIsoDate(ev.dtstart)];
  const month = ev.dtstart.slice(4, 6), day = ev.dtstart.slice(6, 8);
  const out = [];
  for (let y = yearFrom; y <= yearTo; y++) out.push(`${y}-${month}-${day}`);
  return out;
}

function buildRows(events, sourceType, countryCode, yearFrom, yearTo) {
  const rows = [];
  events.forEach(ev => {
    expandDates(ev, yearFrom, yearTo).forEach(date => {
      rows.push({
        source_type: sourceType,
        country_code: countryCode || null,
        company_name: null,
        event_date: date,
        name: ev.summary || '(無題)',
        ics_uid: ev.uid || null,
      });
    });
  });
  return rows;
}

// ---- 入力取得 -----------------------------------------------------------
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve, reject);
        return;
      }
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// ---- Supabase REST upsert（サービスロールキーを直接 HTTPS で叩く） ----
function upsertChunk(baseUrl, serviceKey, table, onConflict, rows) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/rest/v1/${table}`);
    url.searchParams.set('on_conflict', onConflict);
    const body = JSON.stringify(rows);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let resBody = '';
      res.on('data', c => { resBody += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`upsert failed (${res.statusCode}): ${resBody}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceType = args['source-type'];
  if (!sourceType || !['jp', 'overseas'].includes(sourceType)) {
    console.error('使い方: node scripts/import-calendar-holidays.js --file <path> | --url <https-url> --source-type jp|overseas [--country JP]');
    process.exit(1);
  }
  if (!args.file && !args.url) {
    console.error('--file か --url のどちらかを指定してください');
    process.exit(1);
  }

  const text = args.file ? fs.readFileSync(args.file, 'utf8') : await fetchUrl(args.url);
  const events = parseIcs(text);
  if (!events.length) {
    console.error('VEVENT が見つかりませんでした（ICS形式を確認してください）');
    process.exit(1);
  }

  const now = new Date();
  const yearFrom = now.getFullYear() - 1;
  const yearTo = now.getFullYear() + 2;
  const rows = buildRows(events, sourceType, args.country, yearFrom, yearTo);
  console.log(`パース結果: ${events.length} VEVENT → ${rows.length} 行（${yearFrom}〜${yearTo}年）`);

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('環境変数 SUPABASE_URL / SUPABASE_SERVICE_KEY を設定してください');
    process.exit(1);
  }

  const onConflict = 'source_type,country_code,company_name,event_date,name';
  let done = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await upsertChunk(supabaseUrl, serviceKey, 'calendar_holidays', onConflict, chunk);
    done += chunk.length;
    console.log(`  投入済み: ${done}/${rows.length}`);
  }
  console.log('✅ 取込完了');
}

main().catch(err => { console.error(err); process.exit(1); });
