// In-memory fakes for the market-data Edge Function tests:
//   * FakeDate      – a controllable clock (the function uses Date.now() and new Date()).
//   * FakePostgrest – the subset of PostgREST that supabase-js sends for market_candles /
//                     market_fetches (select + eq/lt/lte/gt/gte/in/is filters, order, limit,
//                     maybeSingle, insert/upsert with on_conflict + resolution=merge|ignore,
//                     update with filters, return=representation, rpc prune_market_candles),
//                     with the real primary keys, NOT NULLs and the candle CHECK constraint.
//                     plus market_quota and rpc take_market_quota (the atomic daily budget).
//   * FakeCoinbase  – GET /products/{id}/candles (≤ 300 rows, newest first, [t, l, h, o, c, v]).
//   * FakeKraken    – GET /0/public/OHLC (≤ 720 most recent rows, oldest first, strings).
//   * FakeAlphaVantage – GET /query for every function alphavantage.ts uses (daily/weekly/
//                     intraday for equities, FX and crypto), with sessions, holidays, splits
//                     (any weekday), US closes that follow daylight saving (publishLagMin),
//                     compact/full output, premium-only endpoints, the key's own daily limit
//                     and the 1-call-per-second burst limit on the fake or the real clock
//                     (HTTP 200 + "Note"/"Information").
// Every fake records its calls so tests can count upstream traffic exactly.

// deno-lint-ignore-file no-explicit-any

export const RealDate = Date;
export const clock = { now: 0 };

class FakeDate extends RealDate {
  constructor(...args: any[]) {
    super(...((args.length ? args : [clock.now]) as [any]));
  }
  static override now(): number {
    return clock.now;
  }
}
export function installClock(start: number) {
  clock.now = start;
  (globalThis as any).Date = FakeDate;
}

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

// ---------------------------------------------------------------------------------------
// PostgREST
// ---------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
type ColType = 'text' | 'ts' | 'num';
type TableDef = {
  cols: Record<string, ColType>;
  key: string[];
  notNull: string[];
  defaults: Record<string, () => unknown>;
  check?: (r: Row) => string | null; // constraint name when violated
};

const TABLES: Record<string, TableDef> = {
  market_candles: {
    cols: { symbol: 'text', interval: 'text', t: 'ts', o: 'num', h: 'num', l: 'num', c: 'num', v: 'num' },
    key: ['symbol', 'interval', 't'],
    notNull: ['symbol', 'interval', 't', 'o', 'h', 'l', 'c', 'v'],
    defaults: { v: () => 0 },
    check: (r) => {
      const [o, h, l, c] = [r.o, r.h, r.l, r.c] as number[];
      if (!['1m', '5m', '15m', '1h', '6h', '1d', '1w'].includes(r.interval as string)) return 'market_candles_interval_check';
      if (!(l <= Math.min(o, c) && Math.max(o, c) <= h && l > 0)) return 'market_candles_check';
      return null;
    },
  },
  market_fetches: {
    cols: { symbol: 'text', interval: 'text', fetched_at: 'ts', oldest_complete: 'ts', source: 'text' },
    key: ['symbol', 'interval'],
    notNull: ['symbol', 'interval', 'fetched_at'],
    defaults: { fetched_at: () => Date.now(), oldest_complete: () => null, source: () => null },
  },
  market_quota: {
    cols: { provider: 'text', day: 'text', used: 'num' },
    key: ['provider', 'day'],
    notNull: ['provider', 'day', 'used'],
    defaults: { day: () => utcDay(Date.now()), used: () => 0 },
  },
};

/** The UTC calendar day of `ms`, as Postgres renders a date: YYYY-MM-DD. */
export const utcDay = (ms: number) => new RealDate(ms).toISOString().slice(0, 10);

/** PostgREST renders timestamptz like 2026-09-27T12:00:00+00:00 (fractional seconds only when non-zero). */
export function pgTs(ms: number): string {
  return new RealDate(ms).toISOString().replace('.000Z', 'Z').replace('Z', '+00:00');
}

function parseValue(type: ColType, raw: unknown, col: string): unknown {
  if (raw === null || raw === undefined) return null;
  if (type === 'ts') {
    const ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
    if (!Number.isFinite(ms)) throw pgError(400, '22007', `invalid input syntax for type timestamp with time zone: "${raw}"`);
    return ms;
  }
  if (type === 'num') {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) throw pgError(400, '22P02', `invalid input syntax for type double precision: "${raw}"`);
      return raw;
    }
    const n = Number(raw);
    if (typeof raw !== 'string' || raw.trim() === '' || !Number.isFinite(n)) {
      throw pgError(400, '22P02', `invalid input syntax for type double precision (${col}): "${raw}"`);
    }
    return n;
  }
  return String(raw);
}

class PgError extends Error {
  constructor(public status: number, public body: Row) {
    super(String(body.message));
  }
}
const pgError = (status: number, code: string, message: string) =>
  new PgError(status, { code, message, details: null, hint: null });

export type DbCall = { method: string; table: string; params: URLSearchParams; prefer: string[]; body: unknown };

export class FakePostgrest {
  tables: Record<string, Map<string, Row>> = {};
  calls: DbCall[] = [];
  /** When set, every request fails with this HTTP status (simulated outage). */
  down: number | null = null;
  /** Optional per-call hook: return a Response to short-circuit (fault injection). */
  intercept: ((call: DbCall) => Response | undefined) | null = null;
  rpcCalls: string[] = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.tables = { market_candles: new Map(), market_fetches: new Map(), market_quota: new Map() };
    this.calls = [];
    this.down = null;
    this.intercept = null;
    this.rpcCalls = [];
  }

  private keyOf(table: string, r: Row) {
    return TABLES[table].key.map((k) => String(r[k])).join('|');
  }

  /** Direct seeding (bypasses HTTP) — values in API form (t as ms or ISO). */
  seed(table: string, rows: Row[]) {
    const def = TABLES[table];
    for (const raw of rows) {
      const r: Row = {};
      for (const [col, type] of Object.entries(def.cols)) {
        r[col] = col in raw ? parseValue(type, raw[col], col) : def.defaults[col]?.() ?? null;
      }
      const bad = def.check?.(r);
      if (bad) throw new Error(`seed violates ${bad}: ${JSON.stringify(raw)}`);
      this.tables[table].set(this.keyOf(table, r), r);
    }
  }

  rows(table: string): Row[] {
    return [...this.tables[table].values()].map((r) => ({ ...r }));
  }

  candles(symbol: string, interval: string) {
    return this.rows('market_candles')
      .filter((r) => r.symbol === symbol && r.interval === interval)
      .sort((a, b) => (a.t as number) - (b.t as number)) as { t: number; o: number; h: number; l: number; c: number; v: number }[];
  }

  fetchState(symbol: string, interval: string) {
    return this.tables.market_fetches.get(`${symbol}|${interval}`) as
      | { fetched_at: number; oldest_complete: number | null; source: string | null }
      | undefined;
  }

  /** Budget units `provider` used on the UTC day of `at` (default: today on the fake clock). */
  quotaUsed(provider: string, at = Date.now()): number {
    return (this.tables.market_quota.get(`${provider}|${utcDay(at)}`)?.used as number | undefined) ?? 0;
  }

  async handle(url: URL, init: RequestInit): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const prefer = (headers.get('Prefer') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const path = url.pathname.replace(/^\/rest\/v1\//, '');
    const body = typeof init.body === 'string' && init.body !== '' ? JSON.parse(init.body) : init.body ?? undefined;
    const call: DbCall = { method, table: path, params: url.searchParams, prefer, body };
    this.calls.push(call);
    await Promise.resolve(); // yield like a real network round trip
    if (this.down) return json({ code: 'XX000', message: 'database unavailable' }, this.down);
    const hooked = this.intercept?.(call);
    if (hooked) return hooked;
    try {
      if (path.startsWith('rpc/')) return this.rpc(path.slice(4), body);
      if (!(path in TABLES)) throw pgError(404, '42P01', `relation "public.${path}" does not exist`);
      if (method === 'GET') return this.select(path, url.searchParams, headers);
      if (method === 'POST') return this.insert(path, url.searchParams, prefer, body);
      if (method === 'PATCH') return this.update(path, url.searchParams, prefer, body);
      throw pgError(405, 'PGRST000', `method ${method} not supported by fake`);
    } catch (err) {
      if (err instanceof PgError) return json(err.body, err.status);
      throw err;
    }
  }

  private rpc(fn: string, body: unknown): Response {
    this.rpcCalls.push(fn);
    if (fn === 'take_market_quota') return this.takeQuota(body as Row);
    if (fn !== 'prune_market_candles') throw pgError(404, 'PGRST202', `function ${fn} not found`);
    const now = Date.now();
    const keep: Record<string, number> = { '1m': 3 * DAY, '5m': 30 * DAY, '15m': 120 * DAY };
    for (const [k, r] of this.tables.market_candles) {
      const ttl = keep[r.interval as string];
      if (ttl && (r.t as number) < now - ttl) this.tables.market_candles.delete(k);
    }
    return new Response(null, { status: 204 });
  }

  /**
   * public.take_market_quota(p_provider, p_daily_limit): insert (provider, today, 1) on conflict
   * do update set used = used + 1 where used < limit returning used → true when a row came back.
   * Atomic like the real statement (this fake handles one request at a time).
   */
  private takeQuota(args: Row): Response {
    const provider = args?.p_provider;
    const limit = args?.p_daily_limit;
    if (typeof provider !== 'string' || typeof limit !== 'number' || !Number.isInteger(limit)) {
      throw pgError(404, 'PGRST202', 'Could not find the function public.take_market_quota with the given arguments');
    }
    const day = utcDay(Date.now());
    const k = `${provider}|${day}`;
    const row = this.tables.market_quota.get(k);
    if (!row) {
      this.tables.market_quota.set(k, { provider, day, used: 1 });
      return json(true, 200);
    }
    if ((row.used as number) < limit) {
      this.tables.market_quota.set(k, { ...row, used: (row.used as number) + 1 });
      return json(true, 200);
    }
    return json(false, 200);
  }

  private filters(table: string, params: URLSearchParams): ((r: Row) => boolean)[] {
    const def = TABLES[table];
    const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
    const out: ((r: Row) => boolean)[] = [];
    for (const [col, expr] of params) {
      if (reserved.has(col)) continue;
      if (!(col in def.cols)) throw pgError(400, '42703', `column ${table}.${col} does not exist`);
      const type = def.cols[col];
      const m = /^(eq|neq|lt|lte|gt|gte|in|is)\.(.*)$/s.exec(expr);
      if (!m) throw pgError(400, 'PGRST100', `failed to parse filter (${expr})`);
      const [, op, raw] = m;
      if (op === 'is') {
        const want = raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : undefined;
        if (want === undefined) throw pgError(400, 'PGRST100', `bad is value ${raw}`);
        out.push((r) => r[col] === want);
        continue;
      }
      if (op === 'in') {
        const list = raw.replace(/^\(|\)$/g, '').split(',').map((s) => parseValue(type, s.replace(/^"|"$/g, ''), col));
        out.push((r) => list.includes(r[col]));
        continue;
      }
      const v = parseValue(type, raw, col);
      out.push((r) => {
        const x = r[col];
        if (x === null || x === undefined) return false; // SQL: comparisons with NULL are not true
        switch (op) {
          case 'eq': return x === v;
          case 'neq': return x !== v;
          case 'lt': return (x as number) < (v as number) || (type === 'text' && String(x) < String(v));
          case 'lte': return (x as number) <= (v as number) || (type === 'text' && String(x) <= String(v));
          case 'gt': return (x as number) > (v as number) || (type === 'text' && String(x) > String(v));
          case 'gte': return (x as number) >= (v as number) || (type === 'text' && String(x) >= String(v));
        }
        return false;
      });
    }
    return out;
  }

  private project(table: string, rows: Row[], select: string | null): Row[] {
    const def = TABLES[table];
    const cols = !select || select === '*' ? Object.keys(def.cols) : select.split(',');
    for (const c of cols) if (!(c in def.cols)) throw pgError(400, '42703', `column ${table}.${c} does not exist`);
    return rows.map((r) => {
      const o: Row = {};
      for (const c of cols) o[c] = def.cols[c] === 'ts' && r[c] !== null ? pgTs(r[c] as number) : r[c];
      return o;
    });
  }

  private select(table: string, params: URLSearchParams, headers: Headers): Response {
    const fs = this.filters(table, params);
    let rows = [...this.tables[table].values()].filter((r) => fs.every((f) => f(r)));
    const order = params.get('order');
    if (order) {
      const specs = order.split(',').map((s) => s.split('.'));
      rows.sort((a, b) => {
        for (const [col, dir] of specs) {
          const x = a[col] as number, y = b[col] as number;
          if (x !== y) return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
        }
        return 0;
      });
    }
    const limit = Math.min(Number(params.get('limit') ?? 1000), 1000); // Supabase default max_rows = 1000
    rows = rows.slice(0, limit);
    const out = this.project(table, rows, params.get('select'));
    if ((headers.get('Accept') ?? '').startsWith('application/vnd.pgrst.object+json')) {
      if (out.length !== 1) {
        return json({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, 406);
      }
      return json(out[0], 200);
    }
    return json(out, 200);
  }

  private checkRow(table: string, r: Row) {
    const def = TABLES[table];
    for (const c of def.notNull) {
      if (r[c] === null || r[c] === undefined) {
        throw pgError(400, '23502', `null value in column "${c}" of relation "${table}" violates not-null constraint`);
      }
    }
    const bad = def.check?.(r);
    if (bad) throw pgError(400, '23514', `new row for relation "${table}" violates check constraint "${bad}"`);
  }

  private insert(table: string, params: URLSearchParams, prefer: string[], body: unknown): Response {
    const def = TABLES[table];
    const items = (Array.isArray(body) ? body : [body]) as Row[];
    if (items.some((x) => !x || typeof x !== 'object')) throw pgError(400, 'PGRST102', 'Invalid body');
    const columnsParam = params.get('columns');
    const columns = columnsParam
      ? columnsParam.split(',').map((c) => c.replace(/^"|"$/g, ''))
      : [...new Set(items.flatMap((x) => Object.keys(x)))];
    for (const c of columns) {
      if (!(c in def.cols)) throw pgError(400, 'PGRST204', `Could not find the '${c}' column of '${table}' in the schema cache`);
    }
    const merge = prefer.includes('resolution=merge-duplicates');
    const ignore = prefer.includes('resolution=ignore-duplicates');
    const missingDefault = prefer.includes('missing=default');
    const onConflict = params.get('on_conflict');
    if ((merge || ignore) && onConflict && onConflict.split(',').join('|') !== def.key.join('|')) {
      throw pgError(400, '42P10', 'there is no unique or exclusion constraint matching the ON CONFLICT specification');
    }
    // Work on a copy: a statement either applies completely or not at all.
    const next = new Map(this.tables[table]);
    const touched = new Set<string>();
    const returned: Row[] = [];
    for (const item of items) {
      const incoming: Row = {};
      for (const c of columns) {
        incoming[c] = c in item ? parseValue(def.cols[c], item[c], c) : missingDefault ? def.defaults[c]?.() ?? null : null;
      }
      const probe: Row = { ...incoming };
      const k = this.keyOf(table, probe);
      const existing = next.get(k);
      if (existing) {
        if (ignore) continue;
        if (!merge) throw pgError(409, '23505', `duplicate key value violates unique constraint "${table}_pkey"`);
        if (touched.has(k)) {
          throw pgError(500, '21000', 'ON CONFLICT DO UPDATE command cannot affect row a second time');
        }
        const updated = { ...existing, ...incoming };
        this.checkRow(table, updated);
        next.set(k, updated);
        touched.add(k);
        returned.push(updated);
      } else {
        const row: Row = {};
        for (const c of Object.keys(def.cols)) row[c] = c in incoming ? incoming[c] : def.defaults[c]?.() ?? null;
        this.checkRow(table, row);
        next.set(k, row);
        touched.add(k);
        returned.push(row);
      }
    }
    this.tables[table] = next;
    if (prefer.includes('return=representation')) {
      return json(this.project(table, returned, params.get('select')), 201);
    }
    return new Response(null, { status: 201 });
  }

  private update(table: string, params: URLSearchParams, prefer: string[], body: unknown): Response {
    const def = TABLES[table];
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw pgError(400, 'PGRST102', 'Invalid body');
    const patch: Row = {};
    for (const [c, v] of Object.entries(body as Row)) {
      if (!(c in def.cols)) throw pgError(400, 'PGRST204', `Could not find the '${c}' column of '${table}'`);
      patch[c] = parseValue(def.cols[c], v, c);
    }
    const fs = this.filters(table, params);
    const next = new Map(this.tables[table]);
    const returned: Row[] = [];
    for (const [k, r] of next) {
      if (!fs.every((f) => f(r))) continue;
      const updated = { ...r, ...patch };
      this.checkRow(table, updated);
      next.set(k, updated);
      returned.push(updated);
    }
    this.tables[table] = next;
    if (prefer.includes('return=representation')) return json(this.project(table, returned, params.get('select')), 200);
    return new Response(null, { status: 204 });
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// ---------------------------------------------------------------------------------------
// Market model shared by both exchanges: a deterministic price path per product, a listing
// date before which nothing exists, and optional no-trade windows (thin markets).
// ---------------------------------------------------------------------------------------

export type Market = {
  listing: number; // first candle open time (ms)
  noTrades?: [number, number][]; // [from, to) windows with no trades at all
  base?: number;
};

function priceAt(seed: number, base: number, t: number): number {
  const x = t / HOUR;
  return +(base * (1 + 0.05 * Math.sin(x / 7 + seed) + 0.02 * Math.sin(x * 1.3 + seed * 3))).toFixed(4);
}

/** The "true" candle for a slot, or null if nothing traded (before listing / no-trade window). */
export function trueCandle(m: Market, seed: number, t: number, step: number) {
  if (t < m.listing) return null;
  if (m.noTrades?.some(([a, b]) => t >= a && t < b)) return null;
  const base = m.base ?? 100;
  const o = priceAt(seed, base, t);
  const c = priceAt(seed, base, t + step);
  const h = +(Math.max(o, c) * 1.002).toFixed(4);
  const l = +(Math.min(o, c) * 0.998).toFixed(4);
  const v = +(1 + ((t / step) % 13)).toFixed(3);
  return { t, o, h, l, c, v };
}

type Fault = number | 'hang' | 'empty' | { delay: number } | ((url: URL) => Response | undefined);

/** `at`: fake clock; `real`: performance.now() when the call arrived. */
export type UpstreamCall = { url: URL; at: number; real: number };

abstract class FakeExchange {
  calls: UpstreamCall[] = [];
  /** Faults consumed one per call (FIFO); `always` applies when the queue is empty. */
  faults: Fault[] = [];
  always: Fault | null = null;
  delayMs = 0;
  markets: Record<string, Market> = {};

  reset() {
    this.calls = [];
    this.faults = [];
    this.always = null;
    this.delayMs = 0;
  }

  protected async prelude(url: URL, signal?: AbortSignal | null): Promise<Response | null> {
    this.calls.push({ url, at: Date.now(), real: performance.now() });
    const fault = this.faults.length ? this.faults.shift()! : this.always;
    const delay = typeof fault === 'object' && fault && 'delay' in fault ? fault.delay : this.delayMs;
    if (fault === 'hang') await waitAbortable(1e9, signal);
    else if (delay) await waitAbortable(delay, signal);
    if (typeof fault === 'number') return json({ message: `HTTP ${fault} from fake` }, fault);
    if (fault === 'empty') return json(this.emptyBody(), 200);
    if (typeof fault === 'function') return fault(url) ?? null;
    return null;
  }
  protected abstract emptyBody(): unknown;
}

function waitAbortable(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('The signal has been aborted', 'AbortError'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('The signal has been aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const SEEDS: Record<string, number> = {};
export const seedOf = (id: string) => (SEEDS[id] ??= [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 17);

export class FakeCoinbase extends FakeExchange {
  /** Mutate the raw rows before they are returned (inject garbage). */
  mangle: ((rows: unknown[][], url: URL) => unknown[][]) | null = null;

  override reset() {
    super.reset();
    this.mangle = null;
  }

  protected emptyBody() {
    return [];
  }

  async handle(url: URL, signal?: AbortSignal | null): Promise<Response> {
    const early = await this.prelude(url, signal);
    if (early) return early;
    const m = /^\/products\/([^/]+)\/candles$/.exec(url.pathname);
    if (!m) return json({ message: 'NotFound' }, 404);
    const product = decodeURIComponent(m[1]);
    const market = this.markets[product];
    if (!market) return json({ message: 'NotFound' }, 404);
    const gran = Number(url.searchParams.get('granularity'));
    if (![60, 300, 900, 3600, 21600, 86400].includes(gran)) {
      return json({ message: 'Unsupported granularity' }, 400);
    }
    const step = gran * 1000;
    const start = Date.parse(url.searchParams.get('start') ?? '');
    const end = Date.parse(url.searchParams.get('end') ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      return json({ message: 'start and end must be valid ISO 8601 times, start <= end' }, 400);
    }
    if ((end - start) / step > 300) {
      return json({ message: 'granularity too small for the requested time range. Count of aggregations requested exceeds 300' }, 400);
    }
    const rows: unknown[][] = [];
    const now = Date.now();
    // Buckets whose open time lies in [start, end], newest first, at most 300, never in the future.
    for (let t = Math.floor(Math.min(end, now) / step) * step; t >= start && rows.length < 300; t -= step) {
      const k = trueCandle(market, seedOf(product), t, step);
      if (k) rows.push([t / 1000, k.l, k.h, k.o, k.c, k.v]);
    }
    return json(this.mangle ? this.mangle(rows, url) : rows, 200);
  }
}

const KRAKEN_KEYS: Record<string, string> = { XBTUSD: 'XXBTZUSD', ETHUSD: 'XETHZUSD', XDGUSD: 'XDGUSD', LTCUSD: 'XLTCZUSD', XRPUSD: 'XXRPZUSD' };

export class FakeKraken extends FakeExchange {
  /** Kraken pair name → Coinbase-style product whose market it mirrors. */
  pairs: Record<string, string> = {};

  protected emptyBody() {
    return { error: [], result: { last: 0 } };
  }

  async handle(url: URL, signal?: AbortSignal | null): Promise<Response> {
    const early = await this.prelude(url, signal);
    if (early) return early;
    if (url.pathname !== '/0/public/OHLC') return json({ error: ['EGeneral:Unknown method'] }, 404);
    const pair = url.searchParams.get('pair') ?? '';
    const product = this.pairs[pair];
    const market = product ? this.markets[product] : undefined;
    if (!market) return json({ error: ['EQuery:Unknown asset pair'] }, 200);
    const minutes = Number(url.searchParams.get('interval') ?? '1');
    if (![1, 5, 15, 30, 60, 240, 1440, 10080, 21600].includes(minutes)) {
      return json({ error: ['EGeneral:Invalid arguments'] }, 200);
    }
    const step = minutes * MIN;
    const since = Number(url.searchParams.get('since') ?? '0') * 1000;
    const now = Date.now();
    const newest = Math.floor(now / step) * step;
    // Kraken keeps the 720 most recent intervals and repeats the last close when nothing traded.
    const out: unknown[][] = [];
    let lastClose: number | null = null;
    for (let t = newest - 719 * step; t <= newest; t += step) {
      if (t < market.listing) continue;
      const k = trueCandle(market, seedOf(product), t, step);
      const row = k
        ? [t / 1000, k.o.toFixed(4), k.h.toFixed(4), k.l.toFixed(4), k.c.toFixed(4), k.c.toFixed(4), k.v.toFixed(8), 7]
        : lastClose === null
        ? null
        : [t / 1000, ...Array(5).fill(lastClose.toFixed(4)), '0.00000000', 0];
      if (k) lastClose = k.c;
      if (row && t > since) out.push(row);
    }
    const last = out.length > 1 ? (out[out.length - 2][0] as number) : 0;
    return json({ error: [], result: { [KRAKEN_KEYS[pair] ?? pair]: out, last } }, 200);
  }
}

// ---------------------------------------------------------------------------------------
// Alpha Vantage: GET https://www.alphavantage.co/query?function=…&apikey=…
// ---------------------------------------------------------------------------------------

export type AvMarket = {
  kind: 'equity' | 'fx' | 'crypto';
  listing: number; // first trading day, 00:00 UTC
  base?: number;
  /** Equities: extra days without a session (00:00 UTC). */
  holidays?: number[];
  /** Raw prices before `at` are `ratio` × the split-adjusted ones (e.g. a 4:1 split). */
  splits?: { at: number; ratio: number }[];
};
type AvRow = { t: number; date: string; o: number; h: number; l: number; c: number; v: number; adj: number };

const DOW = (ms: number) => new RealDate(ms).getUTCDay();
const mondayOf = (ms: number) => ms - ((DOW(ms) + 6) % 7) * DAY;
const fmt = (x: number) => x.toFixed(4);
const AV_INTERVALS: Record<string, number> = { '1min': MIN, '5min': 5 * MIN, '15min': 15 * MIN, '30min': 30 * MIN, '60min': HOUR };

export const AV_MESSAGES = {
  daily:
    'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day. Please subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to instantly remove all daily rate limits.',
  burst:
    'Thank you for using Alpha Vantage! Please consider spreading out your free API requests more sparingly (1 request per second). You may subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to lift the free key rate limit.',
  premium:
    'Thank you for using Alpha Vantage! This is a premium endpoint. You may subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to instantly unlock all premium endpoints',
  badKey:
    'the parameter apikey is invalid or missing. Please claim your free API key on (https://www.alphavantage.co/support/#api-key). It should take less than 20 seconds.',
};

export class FakeAlphaVantage extends FakeExchange {
  apiKey = 'test-av-key';
  /** Premium plan: intraday and outputsize=full. */
  premium = false;
  /** TIME_SERIES_WEEKLY_ADJUSTED answers the premium "Information" (the adapter falls back to WEEKLY). */
  premiumWeeklyAdjusted = false;
  /** The key's own daily limit on Alpha Vantage's side (counts every call with a valid key). */
  keyDailyLimit = 25;
  /** Reject a call less than a second (fake clock) after the previous one, like the free key. */
  burstLimit = false;
  /** Reject a call less than this many real milliseconds after the previous one (null: off). */
  burstRealMs: number | null = null;
  /** US equities publish the day's candle this many minutes after the 16:00 New York close (DST-aware). */
  publishLagMin = 20;
  /** Market key: SPY / EURUSD / BTC. */
  avMarkets: Record<string, AvMarket> = {};
  private usedByDay = new Map<string, number>();
  private lastCallAt = -Infinity;
  private lastRealAt = -Infinity;

  override reset() {
    super.reset();
    this.premium = false;
    this.premiumWeeklyAdjusted = false;
    this.keyDailyLimit = 25;
    this.burstLimit = false;
    this.burstRealMs = null;
    this.publishLagMin = 20;
    this.usedByDay = new Map();
    this.lastCallAt = -Infinity;
    this.lastRealAt = -Infinity;
  }

  protected emptyBody() {
    return {};
  }

  /** Calls per `function` parameter. */
  count(fn?: string): number {
    return fn ? this.calls.filter((c) => c.url.searchParams.get('function') === fn).length : this.calls.length;
  }

  private tradingDay(m: AvMarket, d: number): boolean {
    if (d < m.listing) return false;
    if (m.kind === 'crypto') return true;
    const dow = DOW(d);
    if (dow === 0 || dow === 6) return false;
    return !(m.kind === 'equity' && m.holidays?.includes(d));
  }

  /** When the daily candle of `d` is published (UTC): after the session close. */
  private publishedAt(m: AvMarket, d: number): number {
    if (m.kind === 'equity') return d + 16 * HOUR - nyOffsetMs(d + 16 * HOUR) + this.publishLagMin * MIN;
    if (m.kind === 'fx') return d + 22 * HOUR;
    return d + DAY; // crypto: the UTC day is complete
  }

  private splitFactor(m: AvMarket, t: number): number {
    return (m.splits ?? []).reduce((f, s) => (t < s.at ? f * s.ratio : f), 1);
  }

  /** Every published daily row up to `now`, oldest first: raw OHLCV plus the split-adjusted close. */
  dailyRows(key: string, now = Date.now()): AvRow[] {
    const m = this.avMarkets[key];
    if (!m) return [];
    const out: AvRow[] = [];
    for (let d = m.listing; d <= now; d += DAY) {
      if (d + 2 * DAY > now && this.publishedAt(m, d) > now) break; // older days are all published
      if (!this.tradingDay(m, d)) continue;
      const k = trueCandle({ listing: m.listing, base: m.base }, seedOf(key), d, DAY)!;
      const f = this.splitFactor(m, d);
      out.push({ t: d, date: utcDay(d), o: k.o * f, h: k.h * f, l: k.l * f, c: k.c * f, v: +(k.v * 1000).toFixed(0), adj: k.c });
    }
    return out;
  }

  /** Weekly rows (dated by the week's last published day; the candle key is its Monday). */
  weeklyRows(key: string, now = Date.now()): AvRow[] {
    const byWeek = new Map<number, AvRow[]>();
    for (const r of this.dailyRows(key, now)) {
      const w = mondayOf(r.t);
      byWeek.set(w, [...(byWeek.get(w) ?? []), r]);
    }
    return [...byWeek.entries()].map(([w, rs]) => ({
      t: w,
      date: rs[rs.length - 1].date,
      o: rs[0].o,
      h: Math.max(...rs.map((r) => r.h)),
      l: Math.min(...rs.map((r) => r.l)),
      c: rs[rs.length - 1].c,
      v: rs.reduce((a, r) => a + r.v, 0),
      adj: rs[rs.length - 1].adj,
    }));
  }

  /** The candles the function should store for a weekly series: split-adjusted OHLC. */
  adjustedWeekly(key: string, now = Date.now()) {
    return this.weeklyRows(key, now).map((r) => {
      const k = r.adj / r.c;
      return { t: r.t, o: r.o * k, h: r.h * k, l: r.l * k, c: r.adj, v: r.v };
    });
  }

  /** Truly split-adjusted weekly candles (from the adjusted daily prices), for weeks with a split inside. */
  idealWeekly(key: string, now = Date.now()) {
    const byWeek = new Map<number, AvRow[]>();
    for (const r of this.dailyRows(key, now)) {
      const f = r.c / r.adj; // this day's split factor
      const a = { ...r, o: r.o / f, h: r.h / f, l: r.l / f, c: r.adj };
      byWeek.set(mondayOf(r.t), [...(byWeek.get(mondayOf(r.t)) ?? []), a]);
    }
    return [...byWeek.entries()].map(([t, rs]) => ({
      t,
      o: rs[0].o,
      h: Math.max(...rs.map((r) => r.h)),
      l: Math.min(...rs.map((r) => r.l)),
      c: rs[rs.length - 1].c,
    }));
  }

  async handle(url: URL, signal?: AbortSignal | null): Promise<Response> {
    const early = await this.prelude(url, signal);
    if (early) return early;
    if (url.pathname !== '/query') return json({ message: 'Not found' }, 404);
    const q = url.searchParams;
    const info = (text: string) => json({ Information: text }, 200);
    if (q.get('apikey') !== this.apiKey) return json({ 'Error Message': AV_MESSAGES.badKey }, 200);
    const day = utcDay(Date.now());
    const used = (this.usedByDay.get(day) ?? 0) + 1;
    this.usedByDay.set(day, used);
    if (used > this.keyDailyLimit) return info(AV_MESSAGES.daily);
    const t = Date.now();
    const tooSoon = t - this.lastCallAt < 1000;
    this.lastCallAt = t;
    if (this.burstLimit && tooSoon) return info(AV_MESSAGES.burst);
    const real = performance.now();
    const tooSoonReal = this.burstRealMs !== null && real - this.lastRealAt < this.burstRealMs;
    this.lastRealAt = real;
    if (tooSoonReal) return info(AV_MESSAGES.burst);

    const fn = q.get('function') ?? '';
    const invalid = () => json({ 'Error Message': `Invalid API call. Please retry or visit the documentation (https://www.alphavantage.co/documentation/) for ${fn}.` }, 200);
    const kind = fn.startsWith('FX_') ? 'fx' : fn.startsWith('DIGITAL_CURRENCY') || fn.startsWith('CRYPTO') ? 'crypto' : 'equity';
    const key = kind === 'fx' ? `${q.get('from_symbol')}${q.get('to_symbol')}` : q.get('symbol') ?? '';
    const m = this.avMarkets[key];
    if (!m || m.kind !== kind || (kind === 'crypto' && q.get('market') !== 'USD')) return invalid();
    const full = q.get('outputsize') === 'full';
    const tz = kind === 'equity' ? 'US/Eastern' : 'UTC';
    const meta = { '1. Information': fn, '2. Symbol': key, '3. Last Refreshed': '', '4. Time Zone': tz };
    const series = (rows: AvRow[], row: (r: AvRow) => Record<string, string>) => {
      const out: Record<string, Record<string, string>> = {};
      for (const r of [...rows].reverse()) out[r.date] = row(r); // newest first, like Alpha Vantage
      meta['3. Last Refreshed'] = rows.length ? rows[rows.length - 1].date : '';
      return out;
    };
    const ohlc = (r: AvRow) => ({ '1. open': fmt(r.o), '2. high': fmt(r.h), '3. low': fmt(r.l), '4. close': fmt(r.c) });
    const ohlcv = (r: AvRow) => ({ ...ohlc(r), '5. volume': String(r.v) });

    switch (fn) {
      case 'TIME_SERIES_DAILY':
      case 'FX_DAILY': {
        if (full && !this.premium) return info(AV_MESSAGES.premium);
        const rows = this.dailyRows(key);
        const pick = full ? rows : rows.slice(-100);
        return fn === 'FX_DAILY'
          ? json({ 'Meta Data': meta, 'Time Series FX (Daily)': series(pick, ohlc) }, 200)
          : json({ 'Meta Data': meta, 'Time Series (Daily)': series(pick, ohlcv) }, 200);
      }
      case 'DIGITAL_CURRENCY_DAILY':
        return json({ 'Meta Data': meta, 'Time Series (Digital Currency Daily)': series(this.dailyRows(key), ohlcv) }, 200);
      case 'TIME_SERIES_WEEKLY_ADJUSTED':
        if (this.premiumWeeklyAdjusted && !this.premium) return info(AV_MESSAGES.premium);
        return json({
          'Meta Data': meta,
          'Weekly Adjusted Time Series': series(this.weeklyRows(key), (r) => ({
            ...ohlc(r),
            '5. adjusted close': fmt(r.adj),
            '6. volume': String(r.v),
            '7. dividend amount': '0.0000',
          })),
        }, 200);
      case 'TIME_SERIES_WEEKLY':
        return json({ 'Meta Data': meta, 'Weekly Time Series': series(this.weeklyRows(key), ohlcv) }, 200);
      case 'FX_WEEKLY':
        return json({ 'Meta Data': meta, 'Time Series FX (Weekly)': series(this.weeklyRows(key), ohlc) }, 200);
      case 'DIGITAL_CURRENCY_WEEKLY':
        return json({ 'Meta Data': meta, 'Time Series (Digital Currency Weekly)': series(this.weeklyRows(key), ohlcv) }, 200);
      case 'TIME_SERIES_INTRADAY':
      case 'FX_INTRADAY':
      case 'CRYPTO_INTRADAY': {
        if (!this.premium) return info(AV_MESSAGES.premium);
        const label = q.get('interval') ?? '';
        const step = AV_INTERVALS[label];
        if (!step) return invalid();
        const now = Date.now();
        const rows: Record<string, Record<string, string>> = {};
        for (let t = Math.floor(now / step) * step - step; t >= now - 30 * DAY; t -= step) {
          if (!this.tradingDay(m, Math.floor(t / DAY) * DAY)) continue;
          if (kind === 'equity' && (t % DAY < 13 * HOUR + 30 * MIN || t % DAY >= 20 * HOUR)) continue;
          const k = trueCandle({ listing: m.listing, base: m.base }, seedOf(key), t, step)!;
          rows[localStamp(t, tz)] = { ...ohlc({ ...k, t, date: '', adj: k.c }), '5. volume': String(k.v) };
        }
        const name = kind === 'fx' ? `Time Series FX (${label})` : kind === 'crypto' ? `Time Series Crypto (${label})` : `Time Series (${label})`;
        return json({ 'Meta Data': meta, [name]: rows }, 200);
      }
    }
    return invalid();
  }
}

/** UTC offset of New York at `ms` (-4 h in summer, -5 h in winter). */
function nyOffsetMs(ms: number): number {
  const [d, t] = localStamp(ms, 'America/New_York').split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm, ss] = t.split(':').map(Number);
  return RealDate.UTC(y, m - 1, day, hh, mm, ss) - ms;
}

/** 'YYYY-MM-DD HH:MM:SS' of `ms` in `timeZone` (Alpha Vantage intraday stamps). */
const stampFormats = new Map<string, Intl.DateTimeFormat>();
function localStamp(ms: number, timeZone: string): string {
  const zone = timeZone === 'US/Eastern' ? 'America/New_York' : timeZone;
  let fmt = stampFormats.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    stampFormats.set(zone, fmt);
  }
  const parts = fmt.formatToParts(new RealDate(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

// ---------------------------------------------------------------------------------------
// fetch router: every network call made by the function lands in one of the fakes.
// ---------------------------------------------------------------------------------------

export function installFetch(
  db: FakePostgrest,
  coinbase: FakeCoinbase,
  kraken: FakeKraken,
  supabaseUrl: string,
  alphavantage: FakeAlphaVantage = new FakeAlphaVantage(),
) {
  const supa = new URL(supabaseUrl).host;
  globalThis.fetch = ((input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host === supa) return db.handle(url, init);
    if (url.host === 'api.exchange.coinbase.com') return coinbase.handle(url, init.signal);
    if (url.host === 'api.kraken.com') return kraken.handle(url, init.signal);
    if (url.host === 'www.alphavantage.co') return alphavantage.handle(url, init.signal);
    return Promise.reject(new TypeError(`network access to ${url.host} is not allowed in tests`));
  }) as typeof fetch;
}
