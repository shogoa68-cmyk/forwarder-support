'use strict';
/**
 * recording-steps.js — 見張り番（フォワーダー支援/js/bug-recorder.js）が作った報告の本文から、
 * 「再現手順（自動記録）」を構造に戻す（純粋関数・ブラウザ不要）。
 *
 *   parseReport(body) → { steps:[…], sections:{…}, errors:[…] }
 *
 * steps の 1 件：{ n, t, tab, times, kind, … }
 *   kind='click'   : { label, id, row }        「ラベル #id」を押す（明細N行目）
 *   kind='input'   : { label, id, row, value, vkind }  vkind = text|number|chars|date|empty|onoff
 *   kind='select'  : { label, id, row, value }
 *   kind='key'     : { key }
 *   kind='toast'   : { type, msg }
 *   kind='error'   : { msg }
 *   kind='mark'    : { }                        🚩 ここで不具合に気づいた
 *   kind='reload'  : { }                        （ページを再読み込みした）
 *   kind='unknown' : { text }
 */

// bug-recorder.js の FIELD_LABEL の逆引き（ラベル → 明細の data-field）
const FIELD_BY_LABEL = {
  '品名': 'nm', 'カテゴリ': 'cat', 'サブコン': 'sv', 'パターン': 'pt', '数量': 'pq', '単位': 'un',
  '仕入の通貨': 'pc', '仕入単価': 'pp', '乗せ幅': 'mk', '売の通貨': 'bc', '備考': 'nt',
  '有効期間（開始）': 'vf', '有効期間（終了）': 'vt', '課税': 'tx',
};

function parseValue(v) {
  v = String(v);
  if (v === 'ON' || v === 'OFF') return { vkind: 'onoff', value: v === 'ON' };
  if (v === '（空にした）') return { vkind: 'empty', value: '' };
  if (v === '（日付・時刻）') return { vkind: 'date', value: '' };
  let m = v.match(/^（文字 (\d+) 字）$/);
  if (m) return { vkind: 'chars', value: Number(m[1]) };
  m = v.match(/^数値 (.+)$/);
  if (m) return { vkind: 'number', value: m[1] };
  return { vkind: 'text', value: v };
}

function parseStepText(text) {
  let m;
  if ((m = text.match(/^「(.+?)(?: #([A-Za-z_][\w-]*))?」を押す(?:（明細(\d+)行目）)?$/))) {
    return { kind: 'click', label: m[1], id: m[2] || '', row: m[3] ? Number(m[3]) : 0 };
  }
  if ((m = text.match(/^「(.+?)(?: #([A-Za-z_][\w-]*))?」に入力 → ([\s\S]*?)(?:（明細(\d+)行目）)?$/))) {
    return Object.assign({ kind: 'input', label: m[1], id: m[2] || '', row: m[4] ? Number(m[4]) : 0 }, parseValue(m[3]));
  }
  if ((m = text.match(/^「(.+?)(?: #([A-Za-z_][\w-]*))?」を選ぶ → ([\s\S]*?)(?:（明細(\d+)行目）)?$/))) {
    return { kind: 'select', label: m[1], id: m[2] || '', row: m[4] ? Number(m[4]) : 0, value: m[3] };
  }
  if ((m = text.match(/^キー操作：(.+)$/))) return { kind: 'key', key: m[1] };
  if ((m = text.match(/^🔔 通知(?:（(\w+)）)?：([\s\S]*)$/))) return { kind: 'toast', type: m[1] || 'info', msg: m[2] };
  if ((m = text.match(/^⚠ エラーが出た：([\s\S]*)$/))) return { kind: 'error', msg: m[1] };
  if (/^🚩/.test(text)) return { kind: 'mark' };
  if (/^（ページを再読み込みした）$/.test(text)) return { kind: 'reload' };
  return { kind: 'unknown', text };
}

// 「【見出し】本文」の節に分ける（見出しは先頭にあるもの）
function splitSections(body) {
  const sections = {};
  const re = /^【([^】]+)】/gm;
  const heads = [];
  let m;
  while ((m = re.exec(body))) heads.push({ name: m[1], start: m.index, after: m.index + m[0].length });
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].start : body.length;
    sections[h.name] = body.slice(h.after, end).trim();
  });
  return sections;
}

function parseReport(body) {
  body = String(body == null ? '' : body);
  const sections = splitSections(body);
  const raw = sections['再現手順（自動記録）'] || '';
  const steps = [];
  raw.split('\n').forEach(line => {
    const m = line.match(/^(\d+)\. \[(\d+):(\d\d)(?:・([^\]]*))?\] ([\s\S]*?)(?: ×(\d+))?$/);
    if (!m) return;
    const step = Object.assign(
      { n: Number(m[1]), t: Number(m[2]) * 60 + Number(m[3]), tab: m[4] || '', times: m[6] ? Number(m[6]) : 1 },
      parseStepText(m[5].trim()));
    steps.push(step);
  });
  const errText = sections['記録中に出たエラー'] || '';
  // 「- 」で始まる行だけがエラー（最後の節の末尾にある「（記録 …）」の注意書きは含めない）
  const errors = errText.split('\n').filter(l => /^-\s+/.test(l)).map(l => l.replace(/^-\s+/, '').trim()).filter(Boolean);
  return { steps, sections, errors, hasRecording: raw.length > 0 };
}

module.exports = { parseReport, parseStepText, FIELD_BY_LABEL };
