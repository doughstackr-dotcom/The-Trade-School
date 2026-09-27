// In-memory fakes for the market-data Edge Function tests:
//   * FakeDate      – a controllable clock (the function uses Date.now() and new Date()).
//   * FakePostgrest – the subset of PostgREST that supabase-js sends for market_candles /
//                     market_fetches (select + eq/lt/lte/gt/gte/in/is filters, order, limit,
//                     maybeSingle, insert/upsert with on_conflict + resolution=merge|ignore,
//                     update with filters, return=representation, rpc prune_market_candles),
//                     with the real primary keys, NOT NULLs and the candle CHECK constraint.
//   * FakeCoinbase  – GET /products/{id}/candles (≤ 300 rows, newest first, [t, l, h, o, c, v]).
//   * FakeKraken    – GET /0/public/OHLC (≤ 720 most recent rows, oldest first, strings).
// Every fake records its calls so tests can count upstream traffic exactly.

// deno-lint-ignore-file no-explicit-any

export const RealDate = Date;
export const clock = { now: 0 };

class FakeDate extends RealDate {
  constructor(...args: any[]) {
    if (args.length === 0) super(clock.now);
    else super(...(args as [any]));
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
      if (!['1m', '5m', '15m', '1h', '6h', '1d'].includes(r.interval as string)) return 'market_candles_interval_check';
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
};

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
    this.tables = { market_candles: new Map(), market_fetches: new Map() };
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
      if (path.startsWith('rpc/')) return this.rpc(path.slice(4));
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

  private rpc(fn: string): Response {
    this.rpcCalls.push(fn);
    if (fn !== 'prune_market_candles') throw pgError(404, 'PGRST202', `function ${fn} not found`);
    const now = Date.now();
    const keep: Record<string, number> = { '1m': 3 * DAY, '5m': 30 * DAY, '15m': 120 * DAY };
    for (const [k, r] of this.tables.market_candles) {
      const ttl = keep[r.interval as string];
      if (ttl && (r.t as number) < now - ttl) this.tables.market_candles.delete(k);
    }
    return new Response(null, { status: 204 });
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

export type UpstreamCall = { url: URL; at: number };

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
    this.calls.push({ url, at: Date.now() });
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
// fetch router: every network call made by the function lands in one of the fakes.
// ---------------------------------------------------------------------------------------

export function installFetch(db: FakePostgrest, coinbase: FakeCoinbase, kraken: FakeKraken, supabaseUrl: string) {
  const supa = new URL(supabaseUrl).host;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host === supa) return db.handle(url, init);
    if (url.host === 'api.exchange.coinbase.com') return coinbase.handle(url, init.signal);
    if (url.host === 'api.kraken.com') return kraken.handle(url, init.signal);
    throw new TypeError(`network access to ${url.host} is not allowed in tests`);
  }) as typeof fetch;
}
