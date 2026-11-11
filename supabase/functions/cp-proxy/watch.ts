// ============================================================
// 動静の自動確認（cp-watch）の「判断」部分。
//   ・外には出ない純粋な関数（COLINS の応答 → 注目項目の写し → 前回との差 → 終わりの判定）
//   ・1 回分の確認を進める実行器 runWatchBatch（通信と保存は外から渡す＝試験では偽物に差し替える）
// Deno（Edge Function）と Node（scripts/cp-tests/cp-watch-test.mjs）の両方で動かして試験する。
// ※ 型の注釈だけを使い、enum など Node で動かせない書き方はしない。
// ※ 読み取りだけ。サイバーポートへ書き込む処理は一切ない。
// 設計：docs/サイバーポート動静自動確認_ロードマップ.md
// ============================================================
import { normalizeNo, truncate } from './logic.ts';

export type Dir = 'import' | 'export';
export type Level = 'over' | 'warn' | 'ok' | 'none';
export type Sev = 'alert' | 'warn' | 'info';

// 「写し」の 1 項目（スナップショット）。val は元の文字のまま（日時は ISO か 日付だけ）
export interface Item {
  k: string;            // 同じ項目を前回と照らすための印（例：c:ABCD1234567:pickupDueAt）
  scope: string;        // 何についての項目か（例：コンテナ ABCD1234567／本船 EVER GIVEN 123W）
  label: string;        // 項目名（例：搬出期限）
  val: string | null;   // 値（無ければ null）
  cat: 'date' | 'flag' | 'text';
  dl?: boolean;         // 期限の項目（過ぎる・近いを警告する）
  plan?: boolean;       // 予定の項目（ずれたら知らせる）
}

export interface Change {
  k: string; scope: string; label: string;
  from: string | null; to: string | null;
  kind: 'new' | 'changed' | 'cleared';
  sev: Sev; note?: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const JST = 9 * HOUR;

// ---------- 小さな道具 ----------
export function g(o: unknown, path: string): unknown {
  let v: unknown = o;
  for (const k of String(path).split('.')) {
    v = v == null || typeof v !== 'object' ? undefined : (v as Record<string, unknown>)[k];
  }
  return v;
}
function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v).trim();
  return s === '' ? null : s;
}

// 日時の読み取り。届く形は 2 通り：UTC の ISO（2026-11-12T00:00:00Z）と、日付だけ（20261109 / 2026-11-09）。
// 日付だけのものは日本の日付（その日の 0 時）として扱う。読めない値は null。
export function parseMs(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  let m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) - JST;
  m = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.exec(s);
  if (m) {
    const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

// 期限の色分け（画面と同じ考え方）：過ぎた＝over・48時間以内＝warn
export function levelOf(dueMs: number | null, nowMs: number): Level {
  if (dueMs == null) return 'none';
  if (nowMs > dueMs) return 'over';
  if (dueMs - nowMs <= 48 * HOUR) return 'warn';
  return 'ok';
}

// ---------- ① COLINS の応答 → 注目項目の写し ----------
function item(k: string, scope: string, label: string, v: unknown, cat: Item['cat'], extra: Partial<Item> = {}): Item {
  return Object.assign({ k, scope, label, val: str(v), cat }, extra) as Item;
}

// コンテナ 1 件ぶん
export function containerItems(rec: unknown, dir: Dir): Item[] {
  const no = str(g(rec, 'container.containerNo')) || '(番号なし)';
  const scope = 'コンテナ ' + no;
  const I = (f: string, label: string, path: string, cat: Item['cat'], extra: Partial<Item> = {}) =>
    item('c:' + no + ':' + f, scope, label, g(rec, path), cat, extra);
  if (dir === 'export') {
    return [
      I('customs', '通関', 'containerStatus.customClearanceStatus', 'text'),
      I('shipOk', '船積可否', 'shipmentAvailability', 'flag'),
      I('emptyOut', '空コン搬出（実績）', 'emptyContainerPickup.actualAt', 'date'),
      I('delivSched', '実入り搬入（予定）', 'loadedContainerDelivery.scheduledAt', 'date', { plan: true }),
      I('delivAct', '実入り搬入（実績）', 'loadedContainerDelivery.actualAt', 'date'),
      I('gateIn', 'ゲートイン', 'gateInDate', 'date'),
      I('handling', '荷役日', 'loadingUnloadingDate', 'date', { plan: true }),
      I('shipDate', '船積日', 'shipmentDate', 'date'),
    ];
  }
  return [
    I('customs', '通関', 'containerStatus.customClearanceStatus', 'text'),
    I('inspect', '検査状況', 'inspectionStatus', 'flag'),
    I('doAcq', 'DO入手', 'doAcquisition', 'flag'),
    I('outOk', '搬出可否', 'outboundAvailability', 'flag'),
    I('pickAvail', '搬出可能', 'loadedContainerPickup.availableAt', 'date', { plan: true }),
    I('pickDue', '搬出期限', 'loadedContainerPickup.dueAt', 'date', { dl: true }),
    I('pickAct', '搬出（実績）', 'loadedContainerPickup.actualAt', 'date'),
    I('cyIn', 'CY搬入', 'cyCarryInDate', 'date'),
    I('gateOut', 'ゲートアウト', 'gateOutDate', 'date'),
    I('retDue', '返却期限', 'emptyContainerReturn.dueAt', 'date', { dl: true }),
    I('retAct', '返却（実績）', 'emptyContainerReturn.actualAt', 'date'),
  ];
}

// 港のオブジェクト（vessel.portOfLoading など）1 つぶん
function portItems(vk: string, scope: string, tag: string, p: unknown, want: ('eta' | 'ata' | 'etd' | 'atd')[]): Item[] {
  if (!p || typeof p !== 'object') return [];
  const name = str(g(p, 'portName')) || str(g(p, 'portCode')) || '';
  const out: Item[] = [];
  const map: Record<string, [string, string, boolean]> = {
    eta: ['estimatedTimeOfArrival', '入港 予定(ETA)', true], ata: ['actualTimeOfArrival', '入港 実績(ATA)', false],
    etd: ['estimatedTimeOfDeparture', '出港 予定(ETD)', true], atd: ['actualTimeOfDeparture', '出港 実績(ATD)', false],
  };
  for (const w of want) {
    const [path, label, plan] = map[w];
    out.push(item(vk + ':' + tag + ':' + w, scope, (name ? name + ' ' : '') + label, g(p, path), 'date', plan ? { plan: true } : {}));
  }
  return out;
}

// 本船の写し。rec は「コンテナの応答の vessel を含む記録」か「本船の動静の記録」のどちらでもよい。
// 本船の動静の記録（cargoTransfer などを持つもの）のときは、CY オープン／カットなどもあわせて拾う。
export function vesselItems(rec: unknown): Item[] {
  const v = g(rec, 'vessel');
  if (!v || typeof v !== 'object') return [];
  const name = str(g(v, 'vesselName')) || '(本船名なし)';
  const voy = str(g(v, 'voyageNo')) || '';
  const vk = 'v:' + name + '|' + voy;
  const scope = '本船 ' + name + (voy ? ' ' + voy : '');
  const out: Item[] = [];
  out.push(...portItems(vk, scope, 'pol', g(v, 'portOfLoading'), ['etd', 'atd']));
  out.push(...portItems(vk, scope, 'pod', g(v, 'portOfDischarge'), ['eta', 'ata']));
  const tr = g(v, 'transhipVessels');
  if (Array.isArray(tr)) {
    tr.forEach((t, i) => {
      const tn = (str(g(t, 'vesselName')) || '積替本船' + (i + 1)) + ' ' + (str(g(t, 'voyageNo')) || '');
      out.push(...portItems(vk, scope + '／積替 ' + tn.trim(), 'tr' + i + 'pod', g(t, 'portOfDischarge'), ['eta', 'ata']));
    });
  }
  const I = (f: string, label: string, path: string, extra: Partial<Item> = {}) => {
    const val = g(rec, path);
    if (val === undefined) return;       // この記録に無い項目は拾わない（コンテナ側の vessel には無い）
    out.push(item(vk + ':' + f, scope, label, val, 'date', extra));
  };
  I('cyOpen', 'CYオープン', 'cargoTransfer.cyOpenAt');
  I('cyCut', 'CYカット', 'cargoTransfer.cyCutAt', { dl: true, plan: true });
  I('cfsCut', 'CFSカット', 'cargoTransfer.cfsCutAt', { dl: true, plan: true });
  I('hdlSched', '荷役開始（予定）', 'cargoHandling.scheduleAt', { plan: true });
  I('hdlAct', '荷役開始（実績）', 'cargoHandling.actualAt');
  return out;
}

// 同じ k の項目は 1 つにまとめる（コンテナ間で同じ本船が重なるため）。先に入れたものを優先するが、
// 先のものが空で後のものに値があるときは、値のある方を使う。
export function uniqItems(list: Item[]): Item[] {
  const at = new Map<string, number>(); const out: Item[] = [];
  for (const it of list) {
    const i = at.get(it.k);
    if (i == null) { at.set(it.k, out.length); out.push(it); }
    else if (out[i].val == null && it.val != null) out[i] = it;
  }
  return out;
}

// ---------- ② 前回との差 ----------
const isDueLabel = (it: Item) => it.dl === true;
export function diffItems(prev: Item[] | null, next: Item[], nowMs: number): Change[] {
  if (!prev) return [];                  // 初回は「基準」を作るだけ（変化とは数えない）
  const before = new Map(prev.map((x) => [x.k, x]));
  const out: Change[] = [];
  for (const n of next) {
    const p = before.get(n.k);
    const from = p ? p.val : null;
    if (from === n.val) continue;
    const kind: Change['kind'] = from == null ? 'new' : n.val == null ? 'cleared' : 'changed';
    let sev: Sev = 'info'; let note: string | undefined;
    if (n.cat === 'date') {
      const a = parseMs(from), b = parseMs(n.val);
      if (kind === 'changed' && a != null && b != null) {
        const d = b - a;
        const h = Math.round(Math.abs(d) / HOUR);
        if (n.plan || n.dl) {
          // 予定・期限が動いた：1 日以上のずれは警告
          if (Math.abs(d) >= DAY) sev = 'warn';
          note = (d > 0 ? '＋' : '－') + (h >= 48 ? Math.round(h / 24) + '日' : h + '時間');
        }
      }
      if (n.dl && b != null) {
        const lv = levelOf(b, nowMs);
        if (lv === 'over') { sev = 'alert'; note = '期限超過'; }
        else if (lv === 'warn') { sev = 'warn'; note = note ? note + '・48時間以内' : '48時間以内'; }
      }
      if (kind === 'cleared') sev = 'warn';
    } else if (n.cat === 'flag') {
      sev = 'warn';                       // 可否・入手などの状態が変わった
    } else {
      sev = kind === 'cleared' ? 'warn' : 'info';
    }
    out.push({ k: n.k, scope: n.scope, label: n.label, from, to: n.val, kind, sev, note });
  }
  return out;
}

// いちばん近い（または過ぎた）期限。確認の優先順位に使う（無ければ null）
export function urgentAt(items: Item[], nowMs: number): string | null {
  let best: number | null = null;
  for (const it of items) {
    if (!isDueLabel(it)) continue;
    const ms = parseMs(it.val);
    if (ms == null) continue;
    if (levelOf(ms, nowMs) === 'ok' && ms - nowMs > 7 * DAY) continue; // 1 週間より先は急がない
    if (best == null || ms < best) best = ms;
  }
  return best == null ? null : new Date(best).toISOString();
}

// ---------- ③ 追跡の終わりの判定 ----------
export interface EndResult { state: 'active' | 'done' | 'ask'; note: string | null; }

// 最終の荷揚港（積み替えがあれば最後の積替本船の荷揚港）
export function finalArrival(vessel: unknown): { name: string; eta: string | null; ata: string | null } | null {
  if (!vessel || typeof vessel !== 'object') return null;
  let p: unknown = g(vessel, 'portOfDischarge');
  const tr = g(vessel, 'transhipVessels');
  if (Array.isArray(tr) && tr.length) {
    const last = g(tr[tr.length - 1], 'portOfDischarge');
    if (last && typeof last === 'object') p = last;
  }
  if (!p || typeof p !== 'object') return null;
  return {
    name: str(g(p, 'portName')) || str(g(p, 'portCode')) || '',
    eta: str(g(p, 'estimatedTimeOfArrival')), ata: str(g(p, 'actualTimeOfArrival')),
  };
}

// 輸入：すべてのコンテナの返却実績がそろったら終了。
// 輸出：荷揚港（最終）の入港実績が確認できたら終了。実績が無いまま ETA を askAfterDays 日過ぎたら「確認の知らせ」。
export function evaluateEnd(dir: Dir, containers: unknown[], nowMs: number, askAfterDays = 3): EndResult {
  if (!containers.length) return { state: 'active', note: null };
  if (dir === 'import') {
    const all = containers.every((c) => str(g(c, 'emptyContainerReturn.actualAt')) != null);
    return all ? { state: 'done', note: 'コンテナの返却を確認しました' } : { state: 'active', note: null };
  }
  const arr = containers.map((c) => finalArrival(g(c, 'vessel'))).filter((a): a is NonNullable<typeof a> => a != null);
  if (!arr.length) return { state: 'active', note: null };
  if (arr.every((a) => a.ata != null)) {
    return { state: 'done', note: (arr[0].name ? arr[0].name + ' ' : '') + 'への入港（実績）を確認しました' };
  }
  const pending = arr.filter((a) => a.ata == null);
  const late = pending.every((a) => { const e = parseMs(a.eta); return e != null && nowMs > e + askAfterDays * DAY; });
  if (late) return { state: 'ask', note: '入港予定を過ぎて' + askAfterDays + '日たちましたが、入港の実績を確認できません。終了しますか？' };
  return { state: 'active', note: null };
}

// ---------- ④ 1 回分の確認（実行器） ----------
export interface WatchTarget {
  preset_id: string;
  direction: Dir;
  bl_no: string | null;
  booking_no: string | null;
  container_nos: string[] | null;
  snapshot: Item[] | null;
  consecutive_errors: number;
  state?: 'active' | 'done' | 'ask';
  state_note?: string | null;
  ask_snooze_until?: string | null;   // 「もう少し追う」を選んだとき、この時刻まで確認の知らせを止める
}
export interface TargetResult {
  preset_id: string;
  ok: boolean;
  status: 'ok' | 'nodata' | 'error';
  items: Item[] | null;          // 新しい写し（失敗・該当なしのときは null＝前回のまま）
  changes: Change[];
  state: 'active' | 'done' | 'ask';
  state_note: string | null;
  urgent_at: string | null;
  error: string | null;
  checked_at: string;
  calls: number;
}
export interface WatchDeps {
  pick(n: number): Promise<WatchTarget[]>;
  // 許可リストを通ったパスだけを呼ぶ（cp-proxy の callGet）。失敗は例外（code・message を持つ）
  get(path: string, query: Record<string, unknown>): Promise<unknown>;
  save(r: TargetResult): Promise<void>;
  now(): number;
  stopAt?: number;     // この時刻（ms）を過ぎたら、残りの案件は確認せず次の回に回す（実行時間の上限対策）
}
export interface BatchSummary { picked: number; ok: number; nodata: number; failed: number; changed: number; calls: number; skipped: number; saveErrors: number; }

function errText(e: unknown): string {
  const o = e as { code?: string; message?: string; extra?: { upstreamStatus?: number } };
  const parts = [o?.code, o?.extra?.upstreamStatus ? String(o.extra.upstreamStatus) : '', o?.message].filter(Boolean);
  return truncate(parts.join(' / ') || '不明なエラー', 200);
}
const asArray = (d: unknown): unknown[] => (Array.isArray(d) ? d : d && typeof d === 'object' && Array.isArray((d as { items?: unknown[] }).items) ? (d as { items: unknown[] }).items : []);

// 取引の探し方：輸入＝B/L番号（まとめて 1 回）／輸出＝ブッキング番号（まとめて 1 回）。無ければコンテナ番号ごと（最大 10 本）。
export function containerQueries(t: WatchTarget): Record<string, unknown>[] {
  const bl = normalizeNo(t.bl_no), bk = normalizeNo(t.booking_no);
  if (t.direction === 'import' && bl) return [{ blNoList: [bl] }];
  if (t.direction === 'export' && bk) return [{ bookingNoList: [bk] }];
  return (t.container_nos || []).map((c) => normalizeNo(c)).filter((c) => /^[A-Z]{4}\d{7}$/.test(c)).slice(0, 10).map((c) => ({ containerNo: c }));
}

export async function runWatchBatch(deps: WatchDeps, n: number): Promise<BatchSummary> {
  const sum: BatchSummary = { picked: 0, ok: 0, nodata: 0, failed: 0, changed: 0, calls: 0, skipped: 0, saveErrors: 0 };
  const targets = await deps.pick(n);
  sum.picked = targets.length;
  const vesselCache = new Map<string, Promise<unknown | null>>();   // 同じ港・同じ本船は 1 回だけ呼ぶ
  for (const t of targets) {
    const nowMs = deps.now();
    if (deps.stopAt != null && nowMs > deps.stopAt) { sum.skipped++; continue; }   // 時間切れ：次の回に回す（保存もしない）
    const r: TargetResult = {
      preset_id: t.preset_id, ok: false, status: 'error', items: null, changes: [], state: 'active', state_note: null,
      urgent_at: null, error: null, checked_at: new Date(nowMs).toISOString(), calls: 0,
    };
    try {
      const qs = containerQueries(t);
      if (!qs.length) throw Object.assign(new Error('照合キー（B/L番号・ブッキング番号・コンテナ番号）が入っていません'), { code: 'no_keys' });
      const prefix = '/API/v2/ColinsViewers/Get' + (t.direction === 'export' ? 'Export' : 'Import');
      const recs: unknown[] = [];
      for (const q of qs) { r.calls++; sum.calls++; recs.push(...asArray(await deps.get(prefix + 'Containers', q))); }
      if (!recs.length) {
        r.ok = true; r.status = 'nodata'; r.state_note = 'COLINS に該当するコンテナがまだありません';
        sum.nodata++;
      } else {
        let items: Item[] = [];
        for (const rec of recs) items.push(...containerItems(rec, t.direction), ...vesselItems(rec));
        // 本船の動静（CY オープン／カットなど）：コンテナ側の本船の港と本船名・航海番号で探す（同じ本船は 1 回だけ）
        const seen = new Set<string>();
        for (const rec of recs) {
          const v = g(rec, 'vessel');
          const port = str(g(v, t.direction === 'export' ? 'portOfLoading.portCode' : 'portOfDischarge.portCode'));
          const name = str(g(v, 'vesselName')), voy = str(g(v, 'voyageNo'));
          if (!port || !name) continue;
          const key = port + '|' + name + '|' + (voy || '');
          if (seen.has(key)) continue; seen.add(key);
          let p = vesselCache.get(key);
          if (!p) {
            const q: Record<string, unknown> = { vesselName: name }; if (voy) q.voyageNo = voy;
            r.calls++; sum.calls++;
            p = deps.get(prefix + 'Vessels/' + encodeURIComponent(port), q).then((d) => {
              const list = asArray(d);
              return list.find((x) => str(g(x, 'vessel.vesselName')) === name && (!voy || str(g(x, 'vessel.voyageNo')) === voy)) ?? null;
            }).catch(() => null);   // 本船の動静が取れなくても、コンテナの確認は続ける
            vesselCache.set(key, p);
          }
          const vrec = await p;
          if (vrec) items.push(...vesselItems(vrec));
        }
        items = uniqItems(items);
        r.items = items;
        r.changes = diffItems(t.snapshot, items, nowMs);
        r.urgent_at = urgentAt(items, nowMs);
        const end = evaluateEnd(t.direction, recs, nowMs);
        r.state = end.state; r.state_note = end.note;
        // 「もう少し追う」を選んだ案件は、その時刻まで終了の確認を出さない
        const snooze = parseMs(t.ask_snooze_until);
        if (end.state === 'ask' && snooze != null && nowMs < snooze) { r.state = 'active'; r.state_note = null; }
        r.ok = true; r.status = 'ok';
        sum.ok++;
        if (r.changes.length) sum.changed++;
      }
    } catch (e) {
      r.ok = false; r.status = 'error'; r.error = errText(e);
      sum.failed++;
    }
    try { await deps.save(r); } catch (_e) { sum.saveErrors++; }   // 1 件の保存失敗で、残りの案件の確認を止めない
  }
  return sum;
}
