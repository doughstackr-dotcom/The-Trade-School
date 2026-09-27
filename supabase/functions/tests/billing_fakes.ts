// Test doubles for the billing Edge Functions (create-checkout, customer-portal,
// stripe-webhook): an in-memory PostgREST + Supabase Auth, a fake Stripe API, a fetch
// router that blocks every other host, and a loader that captures a function's handler by
// stubbing Deno.serve before importing it.
//
// The fakes implement only what the functions use, but faithfully: primary keys, unique
// constraints, CHECK lists parsed from the real migration, foreign keys to auth.users,
// ON CONFLICT semantics, Stripe idempotency keys (409 while in flight, replay afterwards)
// and Stripe's rules for the endpoints involved.
// deno-lint-ignore-file no-explicit-any

import Stripe from 'npm:stripe@17.7.0';

export const SUPABASE_URL = 'http://fake.supabase';
export const SERVICE_KEY = 'test-service-role-key';
export const ANON_KEY = 'test-anon-key';
export const STRIPE_KEY = 'sk_test_fake_key';
export const WEBHOOK_SECRET = 'whsec_test_fake_secret';
export const PRICE_BEGINNER = 'price_beginner_1999';
export const PRICE_ADVANCED = 'price_advanced_2999';
export const SITE_URL = 'https://example.github.io/The-Trade-School/';
export const SITE_ORIGIN = 'https://example.github.io';
export const LOCAL_ORIGIN = 'http://localhost:5173';
export const PREVIEW_ORIGIN = 'https://preview.example.com';

const MIGRATION = new URL('../../migrations/20260927180000_accounts_and_billing.sql', import.meta.url);

/** Set (string) or remove (null) the Edge Function environment. Call before importing a function. */
export function configureEnv(overrides: Record<string, string | null> = {}) {
  const base: Record<string, string | null> = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    STRIPE_SECRET_KEY: STRIPE_KEY,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_BEGINNER: PRICE_BEGINNER,
    STRIPE_PRICE_ADVANCED: PRICE_ADVANCED,
    SITE_URL,
    // Spaces and a path on purpose: both must be normalised to bare origins.
    ALLOWED_ORIGINS: `${LOCAL_ORIGIN}, ${PREVIEW_ORIGIN}/app/`,
  };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v === null) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ console capture
export const logs: { level: string; text: string }[] = [];
export function captureConsole() {
  for (const level of ['error', 'warn', 'log', 'info'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const text = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : Deno.inspect(a))).join(' ');
      logs.push({ level, text });
      if (Deno.env.get('BILLING_TEST_VERBOSE')) original(...args);
    };
  }
}

// ------------------------------------------------------------------ fetch router
type Handler = (req: Request) => Promise<Response> | Response;
const routes: { prefix: string; handler: Handler }[] = [];
export const blockedRequests: string[] = [];

export function installFetch() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    for (const r of routes) if (req.url.startsWith(r.prefix)) return await r.handler(req);
    blockedRequests.push(`${req.method} ${req.url}`);
    throw new TypeError(`Network access blocked in tests: ${req.method} ${req.url}`);
  };
}
export function route(prefix: string, handler: Handler) {
  routes.push({ prefix, handler });
}

// ------------------------------------------------------------------ function loader
export type FnHandler = (req: Request) => Promise<Response>;

/** Import supabase/functions/<name>/index.ts with Deno.serve stubbed and return its handler. */
export async function loadFunction(name: string): Promise<FnHandler> {
  let captured: ((req: Request, info: unknown) => Response | Promise<Response>) | null = null;
  const original = Deno.serve;
  (Deno as any).serve = (...args: any[]) => {
    captured = args.find((a) => typeof a === 'function') ?? args.find((a) => typeof a?.handler === 'function')?.handler;
    return { finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {}, addr: { transport: 'tcp', hostname: '127.0.0.1', port: 0 } };
  };
  try {
    await import(new URL(`../${name}/index.ts`, import.meta.url).href);
  } finally {
    (Deno as any).serve = original;
  }
  if (!captured) throw new Error(`${name} did not call Deno.serve`);
  const handler = captured as (req: Request, info: unknown) => Response | Promise<Response>;
  const info = { remoteAddr: { transport: 'tcp', hostname: '127.0.0.1', port: 1 }, completed: Promise.resolve() };
  return async (req: Request) => await handler(req, info);
}

// ------------------------------------------------------------------ fake Supabase Auth
export interface FakeUser {
  id: string;
  email: string;
  token: string;
}

export class FakeAuth {
  users = new Map<string, FakeUser>(); // by id
  calls = 0;

  addUser(email = `user${this.users.size + 1}@example.com`): FakeUser {
    const id = crypto.randomUUID();
    const user = { id, email, token: `token-${id}` };
    this.users.set(id, user);
    return user;
  }
  deleteUser(id: string) {
    this.users.delete(id);
  }
  userForToken(token: string | null): FakeUser | null {
    if (!token) return null;
    for (const u of this.users.values()) if (u.token === token) return u;
    return null;
  }

  handle = (req: Request): Response => {
    this.calls++;
    const url = new URL(req.url);
    if (req.headers.get('apikey') !== SERVICE_KEY) return jsonResponse({ message: 'Invalid API key' }, 401);
    if (req.method === 'GET' && url.pathname === '/auth/v1/user') {
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
      const user = this.userForToken(token);
      if (!user) {
        return jsonResponse(
          { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT: unable to parse or verify signature, token is malformed' },
          401,
        );
      }
      return jsonResponse({
        id: user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: user.email,
        app_metadata: { provider: 'email' },
        user_metadata: {},
        created_at: new Date().toISOString(),
      });
    }
    return jsonResponse({ code: 404, error_code: 'not_found', msg: `No fake for ${req.method} ${url.pathname}` }, 404);
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

// ------------------------------------------------------------------ fake PostgREST
type Row = Record<string, any>;
type ColType = 'text' | 'uuid' | 'timestamptz' | 'bool' | 'bigint';
interface Column {
  type: ColType;
  notNull?: boolean;
  default?: () => unknown;
  oneOf?: string[];
  refAuthUsers?: boolean;
  identity?: boolean;
}
interface Table {
  columns: Record<string, Column>;
  unique: string[][]; // first entry is the primary key
  touchUpdatedAt?: boolean;
  rows: Row[];
}

class PgError extends Error {
  constructor(public status: number, public code: string, message: string, public details: string | null = null) {
    super(message);
  }
}

/** CHECK (col in (...)) lists and access_level() status lists, read from the real migration. */
export function schemaFacts() {
  const sql = Deno.readTextFileSync(MIGRATION);
  const listAfter = (re: RegExp) => {
    const m = sql.match(re);
    if (!m) throw new Error(`Migration no longer matches ${re}`);
    return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  };
  const subscriptionStatuses = listAfter(/status text not null check \(status in \(([^)]*)\)\)/);
  const plans = listAfter(/plan text not null check \(plan in \(([^)]*)\)\)/);
  const fnBody = sql.slice(sql.indexOf('function public.access_level()'), sql.indexOf('revoke execute on function public.access_level()'));
  const accessLists = [...fnBody.matchAll(/s\.status in \(([^)]*)\)/g)].map((m) =>
    m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
  );
  if (accessLists.length === 0) throw new Error('access_level() status list not found');
  return { subscriptionStatuses, plans, accessLists };
}

export class FakeDb {
  tables: Record<string, Table>;
  requests: { method: string; path: string; search: string; prefer: string; body: any }[] = [];
  /** Injected failures: the next request matching (method, table) gets this PostgREST error. */
  failures: { method: string; table: string; status: number; code: string; message: string }[] = [];
  private lastNow = 0;

  constructor(private auth: FakeAuth) {
    const { subscriptionStatuses, plans } = schemaFacts();
    const now = () => this.now();
    this.tables = {
      customers: {
        columns: {
          user_id: { type: 'uuid', notNull: true, refAuthUsers: true },
          stripe_customer_id: { type: 'text', notNull: true },
          created_at: { type: 'timestamptz', notNull: true, default: now },
        },
        unique: [['user_id'], ['stripe_customer_id']],
        rows: [],
      },
      subscriptions: {
        columns: {
          id: { type: 'text', notNull: true },
          user_id: { type: 'uuid', notNull: true, refAuthUsers: true },
          status: { type: 'text', notNull: true, oneOf: subscriptionStatuses },
          plan: { type: 'text', notNull: true, oneOf: plans },
          price_id: { type: 'text', notNull: true },
          current_period_end: { type: 'timestamptz' },
          cancel_at_period_end: { type: 'bool', notNull: true, default: () => false },
          created_at: { type: 'timestamptz', notNull: true, default: now },
          updated_at: { type: 'timestamptz', notNull: true, default: now },
        },
        unique: [['id']],
        touchUpdatedAt: true,
        rows: [],
      },
      access_grants: {
        columns: {
          id: { type: 'bigint', notNull: true, identity: true },
          user_id: { type: 'uuid', notNull: true, refAuthUsers: true },
          plan: { type: 'text', notNull: true, oneOf: plans },
          expires_at: { type: 'timestamptz' },
          note: { type: 'text' },
          created_at: { type: 'timestamptz', notNull: true, default: now },
        },
        unique: [['id']],
        rows: [],
      },
      stripe_events: {
        columns: {
          id: { type: 'text', notNull: true },
          type: { type: 'text', notNull: true },
          received_at: { type: 'timestamptz', notNull: true, default: now },
        },
        unique: [['id']],
        rows: [],
      },
    };
  }

  /** Strictly increasing now() so ORDER BY created_at is deterministic. */
  now(): string {
    const t = Math.max(Date.now(), this.lastNow + 1);
    this.lastNow = t;
    return new Date(t).toISOString();
  }

  rows(table: string): Row[] {
    return this.tables[table].rows.map((r) => ({ ...r }));
  }

  /** Direct insert for seeding (goes through the same constraint checks). */
  seed(table: string, row: Row) {
    this.insertRows(this.tables[table], [row], { resolution: null, onConflict: null });
  }

  failNext(method: string, table: string, status = 500, code = 'XX000', message = 'injected failure') {
    this.failures.push({ method, table, status, code, message });
  }

  /** Hold the next (method, table) request until open() — to force a specific interleaving. */
  gate(method: string, table: string) {
    let arrive!: () => void;
    let open!: () => void;
    const arrived = new Promise<void>((r) => (arrive = r));
    const released = new Promise<void>((r) => (open = r));
    this.gates.push({ method, table, arrive, released });
    return { arrived, open };
  }
  private gates: { method: string; table: string; arrive: () => void; released: Promise<void> }[] = [];

  handle = async (req: Request): Promise<Response> => {
    await sleep(0); // let concurrent requests interleave at statement granularity
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/rest\/v1\//, '');
    const prefer = req.headers.get('Prefer') ?? '';
    const text = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text();
    const body = text ? JSON.parse(text) : undefined;
    this.requests.push({ method: req.method, path, search: url.search, prefer, body });
    const apikey = req.headers.get('apikey');
    // Tables are service-role only here; a user client (anon key + user JWT) may call rpc.
    if (apikey !== SERVICE_KEY && !(apikey === ANON_KEY && path.startsWith('rpc/'))) {
      return jsonResponse({ message: 'Invalid API key' }, 401);
    }

    const gate = this.gates.findIndex((g) => g.method === req.method && g.table === path);
    if (gate >= 0) {
      const g = this.gates.splice(gate, 1)[0];
      g.arrive();
      await g.released;
    }

    const failure = this.failures.findIndex((f) => f.method === req.method && f.table === path);
    if (failure >= 0) {
      const f = this.failures.splice(failure, 1)[0];
      return jsonResponse({ code: f.code, message: f.message, details: null, hint: null }, f.status);
    }

    try {
      if (path.startsWith('rpc/')) return this.rpc(path.slice(4), req, body);
      const table = this.tables[path];
      if (!table) throw new PgError(404, 'PGRST205', `Could not find the table 'public.${path}' in the schema cache`);
      const preferSet = new Set(prefer.split(',').map((p) => p.trim()).filter(Boolean));
      const representation = preferSet.has('return=representation');
      const select = url.searchParams.get('select');
      const project = (rows: Row[]) => rows.map((r) => this.project(table, r, select ?? '*'));

      if (req.method === 'GET' || req.method === 'HEAD') {
        let rows = this.filter(table, table.rows, url.searchParams);
        rows = this.order(table, rows, url.searchParams.get('order'));
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : Infinity;
        rows = rows.slice(offset, offset + limit);
        return this.respond(req, project(rows), 200);
      }
      if (req.method === 'POST') {
        const resolution = [...preferSet].find((p) => p.startsWith('resolution='))?.slice('resolution='.length) ?? null;
        const onConflict = url.searchParams.get('on_conflict');
        const values = Array.isArray(body) ? body : [body];
        const written = this.insertRows(table, values, { resolution, onConflict });
        return representation ? this.respond(req, project(written), 201) : new Response(null, { status: 201 });
      }
      if (req.method === 'PATCH') {
        const targets = this.filter(table, table.rows, url.searchParams);
        const updated = this.updateRows(table, targets, body);
        return representation ? this.respond(req, project(updated), 200) : new Response(null, { status: 204 });
      }
      if (req.method === 'DELETE') {
        const targets = new Set(this.filter(table, table.rows, url.searchParams));
        const removed = table.rows.filter((r) => targets.has(r));
        table.rows = table.rows.filter((r) => !targets.has(r));
        return representation ? this.respond(req, project(removed), 200) : new Response(null, { status: 204 });
      }
      throw new PgError(405, 'PGRST117', `Unsupported HTTP method: ${req.method}`);
    } catch (err) {
      if (err instanceof PgError) {
        return jsonResponse({ code: err.code, message: err.message, details: err.details, hint: null }, err.status);
      }
      throw err;
    }
  };

  private respond(req: Request, rows: Row[], status: number): Response {
    const accept = req.headers.get('Accept') ?? '';
    if (accept.startsWith('application/vnd.pgrst.object+json')) {
      if (rows.length !== 1) {
        return jsonResponse({
          code: 'PGRST116',
          details: `The result contains ${rows.length} rows`,
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        }, 406);
      }
      return jsonResponse(rows[0], status);
    }
    return jsonResponse(rows, status);
  }

  // ---- rpc: access_level() evaluated for the caller identified by the bearer token
  accessLevel(userId: string): 'free' | 'beginner' | 'advanced' {
    const { accessLists } = schemaFacts();
    const statuses = accessLists[0];
    const now = Date.now();
    const has = (plan: string) =>
      this.tables.subscriptions.rows.some((s) => s.user_id === userId && s.plan === plan && statuses.includes(s.status)) ||
      this.tables.access_grants.rows.some((g) =>
        g.user_id === userId && g.plan === plan && (g.expires_at == null || Date.parse(g.expires_at) > now)
      );
    return has('advanced') ? 'advanced' : has('beginner') ? 'beginner' : 'free';
  }

  private rpc(fn: string, req: Request, _args: any): Response {
    if (fn === 'access_level') {
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
      const user = this.auth.userForToken(token);
      if (!user) throw new PgError(401, '42501', 'permission denied for function access_level');
      return jsonResponse(this.accessLevel(user.id));
    }
    throw new PgError(404, 'PGRST202', `Could not find the function public.${fn} without parameters in the schema cache`);
  }

  // ---- value handling
  private coerce(table: Table, col: string, value: any): any {
    const def = table.columns[col];
    if (!def) throw new PgError(400, 'PGRST204', `Could not find the '${col}' column of the table in the schema cache`);
    if (value === null || value === undefined) return null;
    switch (def.type) {
      case 'uuid':
        if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
          throw new PgError(400, '22P02', `invalid input syntax for type uuid: "${value}"`);
        }
        return value.toLowerCase();
      case 'timestamptz': {
        const t = Date.parse(String(value));
        if (Number.isNaN(t)) throw new PgError(400, '22007', `invalid input syntax for type timestamp with time zone: "${value}"`);
        return new Date(t).toISOString();
      }
      case 'bool':
        if (value === true || value === 'true') return true;
        if (value === false || value === 'false') return false;
        throw new PgError(400, '22P02', `invalid input syntax for type boolean: "${value}"`);
      case 'bigint':
        if (!Number.isInteger(Number(value))) throw new PgError(400, '22P02', `invalid input syntax for type bigint: "${value}"`);
        return Number(value);
      default:
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }
  }

  private validate(table: Table, row: Row) {
    for (const [col, def] of Object.entries(table.columns)) {
      const v = row[col];
      if (def.notNull && (v === null || v === undefined)) {
        throw new PgError(400, '23502', `null value in column "${col}" violates not-null constraint`);
      }
      if (def.oneOf && v != null && !def.oneOf.includes(v)) {
        throw new PgError(400, '23514', `new row violates check constraint "${col}_check"`, `Failing value: ${v}`);
      }
      if (def.refAuthUsers && v != null && !this.auth.users.has(v)) {
        throw new PgError(409, '23503', `insert or update violates foreign key constraint "${col}_fkey"`, `Key (${col})=(${v}) is not present in table "users".`);
      }
    }
  }

  private keyOf(row: Row, cols: string[]) {
    return JSON.stringify(cols.map((c) => row[c]));
  }

  private findConflict(rows: Row[], row: Row, cols: string[], except?: Row): Row | undefined {
    if (cols.some((c) => row[c] == null)) return undefined; // NULLs never conflict
    const key = this.keyOf(row, cols);
    return rows.find((r) => r !== except && this.keyOf(r, cols) === key);
  }

  private checkUnique(table: Table, rows: Row[], row: Row, except?: Row) {
    for (const cols of table.unique) {
      if (this.findConflict(rows, row, cols, except)) {
        throw new PgError(409, '23505', `duplicate key value violates unique constraint on (${cols.join(', ')})`, `Key (${cols.join(', ')})=(${cols.map((c) => row[c]).join(', ')}) already exists.`);
      }
    }
  }

  private insertRows(table: Table, values: Row[], opts: { resolution: string | null; onConflict: string | null }): Row[] {
    const next = table.rows.map((r) => r); // statement is atomic: work on a copy of the row list
    const written: Row[] = [];
    let arbiter: string[] | null = null;
    if (opts.resolution) {
      arbiter = opts.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : table.unique[0];
      const match = table.unique.find((u) => u.length === arbiter!.length && u.every((c) => arbiter!.includes(c)));
      if (!match) throw new PgError(400, '42P10', 'there is no unique or exclusion constraint matching the ON CONFLICT specification');
    }
    const touched = new Set<Row>();
    for (const value of values) {
      const provided: Row = {};
      for (const [k, v] of Object.entries(value ?? {})) provided[k] = this.coerce(table, k, v);
      const existing = arbiter ? this.findConflict(next, provided, arbiter) : undefined;
      if (existing) {
        if (opts.resolution === 'ignore-duplicates') continue; // ON CONFLICT DO NOTHING
        if (touched.has(existing)) throw new PgError(400, '21000', 'ON CONFLICT DO UPDATE command cannot affect row a second time');
        const merged = { ...existing, ...provided };
        if (table.touchUpdatedAt) merged.updated_at = this.now();
        this.validate(table, merged);
        this.checkUnique(table, next, merged, existing);
        next[next.indexOf(existing)] = merged;
        touched.add(merged);
        written.push(merged);
        continue;
      }
      const row: Row = {};
      for (const [col, def] of Object.entries(table.columns)) {
        if (col in provided) row[col] = provided[col];
        else if (def.identity) row[col] = Math.max(0, ...next.map((r) => r[col] ?? 0)) + 1;
        else row[col] = def.default ? def.default() : null;
      }
      this.validate(table, row);
      this.checkUnique(table, next, row);
      next.push(row);
      touched.add(row);
      written.push(row);
    }
    table.rows = next;
    return written.map((r) => ({ ...r }));
  }

  private updateRows(table: Table, targets: Row[], values: Row): Row[] {
    const next = table.rows.map((r) => r);
    const updated: Row[] = [];
    for (const target of targets) {
      const patch: Row = {};
      for (const [k, v] of Object.entries(values ?? {})) patch[k] = this.coerce(table, k, v);
      const merged = { ...target, ...patch };
      if (table.touchUpdatedAt) merged.updated_at = this.now();
      this.validate(table, merged);
      this.checkUnique(table, next, merged, target);
      next[next.indexOf(target)] = merged;
      updated.push(merged);
    }
    table.rows = next;
    return updated.map((r) => ({ ...r }));
  }

  private project(table: Table, row: Row, select: string): Row {
    if (select === '*') return { ...row };
    const out: Row = {};
    for (const col of select.split(',').map((c) => c.trim()).filter(Boolean)) {
      if (!(col in table.columns)) throw new PgError(400, '42703', `column ${col} does not exist`);
      out[col] = row[col];
    }
    return out;
  }

  private compare(table: Table, col: string, a: any, b: string): number {
    const type = table.columns[col].type;
    if (a === null || a === undefined) return NaN;
    if (type === 'timestamptz') return Date.parse(a) - Date.parse(b);
    if (type === 'bigint') return Number(a) - Number(b);
    return String(a) < b ? -1 : String(a) > b ? 1 : 0;
  }

  private filter(table: Table, rows: Row[], params: URLSearchParams): Row[] {
    const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
    let out = rows;
    for (const [col, expr] of params) {
      if (reserved.has(col)) continue;
      if (!(col in table.columns)) throw new PgError(400, '42703', `column ${col} does not exist`);
      const dot = expr.indexOf('.');
      const op = expr.slice(0, dot);
      const raw = expr.slice(dot + 1);
      const typed = (v: string) => (table.columns[col].type === 'uuid' ? this.coerce(table, col, v) : v);
      let pred: (r: Row) => boolean;
      switch (op) {
        case 'eq': {
          const v = typed(raw);
          pred = (r) => r[col] != null && String(r[col]) === String(v);
          break;
        }
        case 'neq': {
          const v = typed(raw);
          pred = (r) => r[col] != null && String(r[col]) !== String(v);
          break;
        }
        case 'lt': pred = (r) => this.compare(table, col, r[col], raw) < 0; break;
        case 'lte': pred = (r) => this.compare(table, col, r[col], raw) <= 0; break;
        case 'gt': pred = (r) => this.compare(table, col, r[col], raw) > 0; break;
        case 'gte': pred = (r) => this.compare(table, col, r[col], raw) >= 0; break;
        case 'in': {
          const m = raw.match(/^\((.*)\)$/);
          if (!m) throw new PgError(400, 'PGRST100', `failed to parse filter (${expr})`);
          const list = m[1].split(',').map((s) => s.replace(/^"(.*)"$/, '$1')).map(typed).map(String);
          pred = (r) => r[col] != null && list.includes(String(r[col]));
          break;
        }
        case 'is':
          pred = raw === 'null' ? (r) => r[col] == null : raw === 'true' ? (r) => r[col] === true : (r) => r[col] === false;
          break;
        default:
          throw new PgError(400, 'PGRST100', `fake PostgREST does not support operator "${op}"`);
      }
      out = out.filter(pred);
    }
    return out;
  }

  private order(table: Table, rows: Row[], spec: string | null): Row[] {
    if (!spec) return rows;
    const keys = spec.split(',').map((part) => {
      const [col, dir = 'asc', nulls] = part.split('.');
      if (!(col in table.columns)) throw new PgError(400, '42703', `column ${col} does not exist`);
      const desc = dir === 'desc';
      return { col, desc, nullsFirst: nulls ? nulls === 'nullsfirst' : desc };
    });
    return [...rows].sort((a, b) => {
      for (const k of keys) {
        const av = a[k.col], bv = b[k.col];
        if (av == null || bv == null) {
          if (av == null && bv == null) continue;
          return (av == null) === k.nullsFirst ? -1 : 1;
        }
        const c = this.compare(table, k.col, av, String(bv));
        if (c !== 0) return k.desc ? -c : c;
      }
      return 0;
    });
  }
}

// ------------------------------------------------------------------ fake Stripe
/** Stripe's own form encoding (qs, indices) → nested objects/arrays. */
export function parseStripeForm(text: string): any {
  const root: any = {};
  for (const [key, value] of new URLSearchParams(text)) {
    const parts = key.replace(/\]/g, '').split('[');
    let node = root;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) node[p] = value;
      else node = node[p] ??= {};
    });
  }
  const arrayify = (v: any): any => {
    if (v === null || typeof v !== 'object') return v;
    const keys = Object.keys(v);
    for (const k of keys) v[k] = arrayify(v[k]);
    if (keys.length && keys.every((k) => /^\d+$/.test(k))) return keys.sort((a, b) => +a - +b).map((k) => v[k]);
    return v;
  };
  return arrayify(root);
}

interface StoredSub {
  id: string;
  customer: string;
  status: string;
  metadata: Record<string, string>;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  created: number;
  current_period_start: number;
  current_period_end: number;
  items: { id: string; price: string; quantity: number }[];
  updates: any[];
}

// Subscription fields that are expandable in the Stripe API (Subscription.* typed as
// `string | Stripe.X`). SubscriptionItem.price is a full Price and is NOT expandable.
const EXPANDABLE_SUBSCRIPTION = new Set([
  'customer', 'default_payment_method', 'default_source', 'latest_invoice', 'pending_setup_intent', 'schedule',
  'test_clock', 'application', 'discounts', 'items.data.price.product', 'on_behalf_of',
]);

function isHttpUrl(v: unknown) {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export class FakeStripe {
  customers = new Map<string, any>();
  subscriptions = new Map<string, StoredSub>();
  checkoutSessions: any[] = [];
  portalSessions: any[] = [];
  prices = new Map<string, { id: string; lookup_key: string | null; unit_amount: number }>();
  requests: { method: string; path: string; params: any; idempotencyKey: string | null; version: string | null }[] = [];
  /** Force the API version used to render responses (simulates a newer pinned version). */
  forceVersion: string | null = null;
  latencyMs = 5;
  /** Idempotency outcomes: 409 while the first request was in flight, and replays afterwards. */
  idempotencyStats = { inFlightConflicts: 0, replays: 0 };
  failures: { method: string; path: RegExp; status: number; type: string; message: string }[] = [];
  private idempotency = new Map<string, { fingerprint: string; done: boolean; status?: number; body?: string }>();
  private seq = 0;

  constructor() {
    this.addPrice(PRICE_BEGINNER, 'beginner_monthly', 1999);
    this.addPrice(PRICE_ADVANCED, 'advanced_monthly', 2999);
  }

  addPrice(id: string, lookup_key: string | null, unit_amount = 999) {
    this.prices.set(id, { id, lookup_key, unit_amount });
  }

  private id(prefix: string) {
    return `${prefix}_${(++this.seq).toString().padStart(6, '0')}`;
  }

  calls(method: string, path: string | RegExp) {
    return this.requests.filter((r) => r.method === method && (typeof path === 'string' ? r.path === path : path.test(r.path)));
  }

  failNext(method: string, path: RegExp, status = 400, type = 'invalid_request_error', message = 'injected failure') {
    this.failures.push({ method, path, status, type, message });
  }

  // ---- state helpers used by tests (what would happen inside Stripe)
  createCustomer(email: string, metadata: Record<string, string> = {}) {
    const c = { id: this.id('cus'), object: 'customer', email, metadata, created: nowSec() };
    this.customers.set(c.id, c);
    return c;
  }

  createSubscription(opts: { customer: string; price: string; status?: string; metadata?: Record<string, string>; periodEnd?: number }): StoredSub {
    const start = nowSec();
    const sub: StoredSub = {
      id: this.id('sub'),
      customer: opts.customer,
      status: opts.status ?? 'active',
      metadata: { ...(opts.metadata ?? {}) },
      cancel_at_period_end: false,
      canceled_at: null,
      created: start,
      current_period_start: start,
      current_period_end: opts.periodEnd ?? start + 30 * 86400,
      items: [{ id: this.id('si'), price: opts.price, quantity: 1 }],
      updates: [],
    };
    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  /** Complete a Checkout Session the way Stripe does: creates the subscription. */
  completeCheckout(sessionId: string): { session: any; subscription: StoredSub } {
    const s = this.checkoutSessions.find((x) => x.id === sessionId);
    if (!s) throw new Error(`no session ${sessionId}`);
    const subscription = this.createSubscription({
      customer: s.customer,
      price: s.line_items[0].price,
      metadata: s.subscription_data?.metadata ?? {},
    });
    s.status = 'complete';
    s.subscription = subscription.id;
    return { session: { ...s }, subscription };
  }

  setStatus(id: string, status: string) {
    const s = this.subscriptions.get(id)!;
    s.status = status;
    if (status === 'canceled') s.canceled_at = nowSec();
  }

  setPrice(id: string, price: string) {
    this.subscriptions.get(id)!.items[0].price = price;
  }

  render(sub: StoredSub, version: string) {
    const newShape = version >= '2025-03-31'; // basil+: billing period lives on items only
    const price = (id: string) => {
      const p = this.prices.get(id) ?? { id, lookup_key: null, unit_amount: 0 };
      return {
        id: p.id, object: 'price', active: true, currency: 'usd', lookup_key: p.lookup_key, product: `prod_${p.id}`,
        recurring: { interval: 'month', interval_count: 1 }, type: 'recurring', unit_amount: p.unit_amount,
      };
    };
    const out: any = {
      id: sub.id,
      object: 'subscription',
      customer: sub.customer,
      status: sub.status,
      metadata: { ...sub.metadata },
      cancel_at_period_end: sub.cancel_at_period_end,
      canceled_at: sub.canceled_at,
      created: sub.created,
      items: {
        object: 'list',
        has_more: false,
        url: `/v1/subscription_items?subscription=${sub.id}`,
        data: sub.items.map((it) => ({
          id: it.id,
          object: 'subscription_item',
          price: price(it.price),
          quantity: it.quantity,
          subscription: sub.id,
          ...(newShape ? { current_period_start: sub.current_period_start, current_period_end: sub.current_period_end } : {}),
        })),
      },
      latest_invoice: `in_for_${sub.id}`,
    };
    if (!newShape) {
      out.current_period_start = sub.current_period_start;
      out.current_period_end = sub.current_period_end;
    }
    return out;
  }

  // ---- HTTP
  handle = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const version = this.forceVersion ?? req.headers.get('Stripe-Version');
    const params = req.method === 'GET' ? parseStripeForm(url.search.slice(1)) : parseStripeForm(await req.text());
    const idempotencyKey = req.method === 'POST' ? req.headers.get('Idempotency-Key') : null;
    this.requests.push({ method: req.method, path: url.pathname, params, idempotencyKey, version });

    if (req.headers.get('Authorization') !== `Bearer ${STRIPE_KEY}`) {
      return stripeError(401, 'invalid_request_error', 'Invalid API Key provided');
    }

    if (idempotencyKey) {
      const fingerprint = `${req.method} ${url.pathname} ${JSON.stringify(params)}`;
      const prior = this.idempotency.get(idempotencyKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          return stripeError(400, 'idempotency_error', 'Keys for idempotent requests can only be used with the same parameters they were first used with.');
        }
        if (!prior.done) {
          this.idempotencyStats.inFlightConflicts++;
          return stripeError(409, 'idempotency_error', 'There is currently another in-progress request using this Idempotent Key.', 'idempotency_key_in_use');
        }
        this.idempotencyStats.replays++;
        return new Response(prior.body, { status: prior.status, headers: { 'Content-Type': 'application/json', 'Idempotent-Replayed': 'true' } });
      }
      this.idempotency.set(idempotencyKey, { fingerprint, done: false });
    }

    await sleep(this.latencyMs);
    const res = this.dispatch(req.method, url.pathname, params, version ?? '2025-02-24.acacia');
    if (idempotencyKey) {
      const body = await res.clone().text();
      if (res.status >= 500) this.idempotency.delete(idempotencyKey);
      else this.idempotency.set(idempotencyKey, { fingerprint: this.idempotency.get(idempotencyKey)!.fingerprint, done: true, status: res.status, body });
    }
    return res;
  };

  private dispatch(method: string, path: string, p: any, version: string): Response {
    const failure = this.failures.findIndex((f) => f.method === method && f.path.test(path));
    if (failure >= 0) {
      const f = this.failures.splice(failure, 1)[0];
      return stripeError(f.status, f.type, f.message);
    }
    let m: RegExpMatchArray | null;

    if (method === 'POST' && path === '/v1/customers') {
      const c = this.createCustomer(p.email ?? null, p.metadata ?? {});
      return jsonResponse(c);
    }

    if (method === 'POST' && path === '/v1/checkout/sessions') {
      if (!['payment', 'subscription', 'setup'].includes(p.mode)) return stripeError(400, 'invalid_request_error', 'Invalid mode', 'parameter_invalid_empty', 'mode');
      if (p.customer && !this.customers.has(p.customer)) return stripeError(400, 'invalid_request_error', `No such customer: '${p.customer}'`, 'resource_missing', 'customer');
      if (!isHttpUrl(p.success_url)) return stripeError(400, 'invalid_request_error', 'Not a valid URL', 'url_invalid', 'success_url');
      if (p.cancel_url !== undefined && !isHttpUrl(p.cancel_url)) return stripeError(400, 'invalid_request_error', 'Not a valid URL', 'url_invalid', 'cancel_url');
      const items = p.line_items ?? [];
      if (!items.length) return stripeError(400, 'invalid_request_error', 'line_items is required', 'parameter_missing', 'line_items');
      for (const li of items) {
        if (!this.prices.has(li.price)) return stripeError(400, 'invalid_request_error', `No such price: '${li.price}'`, 'resource_missing', 'line_items[0][price]');
      }
      const id = this.id('cs_test');
      const session = {
        id,
        object: 'checkout.session',
        url: `https://checkout.stripe.com/c/pay/${id}`,
        status: 'open',
        mode: p.mode,
        customer: p.customer ?? null,
        client_reference_id: p.client_reference_id ?? null,
        line_items: items,
        subscription_data: p.subscription_data ?? null,
        allow_promotion_codes: p.allow_promotion_codes ?? null,
        success_url: p.success_url,
        cancel_url: p.cancel_url ?? null,
        metadata: p.metadata ?? {},
        subscription: null,
      };
      this.checkoutSessions.push(session);
      return jsonResponse(session);
    }

    if (method === 'POST' && path === '/v1/billing_portal/sessions') {
      if (!p.customer || !this.customers.has(p.customer)) return stripeError(400, 'invalid_request_error', `No such customer: '${p.customer}'`, 'resource_missing', 'customer');
      if (p.return_url !== undefined && !isHttpUrl(p.return_url)) return stripeError(400, 'invalid_request_error', 'Not a valid URL', 'url_invalid', 'return_url');
      const id = this.id('bps');
      const session = { id, object: 'billing_portal.session', customer: p.customer, return_url: p.return_url ?? null, url: `https://billing.stripe.com/p/session/test_${id}` };
      this.portalSessions.push(session);
      return jsonResponse(session);
    }

    if ((m = path.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
      const sub = this.subscriptions.get(m[1]);
      if (!sub) return stripeError(404, 'invalid_request_error', `No such subscription: '${m[1]}'`, 'resource_missing', 'id');
      for (const e of p.expand ?? []) {
        if (!EXPANDABLE_SUBSCRIPTION.has(e)) return stripeError(400, 'invalid_request_error', `This property cannot be expanded (${e}).`);
      }
      if (method === 'GET') return jsonResponse(this.render(sub, version));
      if (method === 'POST') {
        if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
          return stripeError(400, 'invalid_request_error', 'A canceled subscription can only update its cancellation_details and metadata.');
        }
        if (p.proration_behavior && !['create_prorations', 'none', 'always_invoice'].includes(p.proration_behavior)) {
          return stripeError(400, 'invalid_request_error', 'Invalid proration_behavior', 'parameter_invalid', 'proration_behavior');
        }
        for (const it of p.items ?? []) {
          const existing = sub.items.find((x) => x.id === it.id);
          if (it.id && !existing) return stripeError(400, 'invalid_request_error', `No such subscription item: '${it.id}'`, 'resource_missing');
          if (it.price && !this.prices.has(it.price)) return stripeError(400, 'invalid_request_error', `No such price: '${it.price}'`, 'resource_missing');
          if (existing && it.price) existing.price = it.price;
        }
        if (p.cancel_at_period_end !== undefined) sub.cancel_at_period_end = p.cancel_at_period_end === 'true';
        for (const [k, v] of Object.entries(p.metadata ?? {})) {
          if (v === '') delete sub.metadata[k];
          else sub.metadata[k] = String(v);
        }
        sub.updates.push(p);
        return jsonResponse(this.render(sub, version));
      }
    }

    return stripeError(404, 'invalid_request_error', `Unrecognized request URL (${method}: ${path}).`);
  }
}

const nowSec = () => Math.floor(Date.now() / 1000);

function stripeError(status: number, type: string, message: string, code?: string, param?: string) {
  return jsonResponse({ error: { type, message, ...(code ? { code } : {}), ...(param ? { param } : {}) } }, status, {
    'Request-Id': `req_${crypto.randomUUID().slice(0, 12)}`,
  });
}

// ------------------------------------------------------------------ webhook helpers
const signer = new Stripe('sk_test_signer_only');
const cryptoProvider = Stripe.createSubtleCryptoProvider();
let eventSeq = 0;

export function makeEvent(type: string, object: unknown, opts: { id?: string; apiVersion?: string } = {}) {
  return {
    id: opts.id ?? `evt_${(++eventSeq).toString().padStart(6, '0')}`,
    object: 'event',
    api_version: opts.apiVersion ?? '2025-02-24.acacia',
    created: nowSec(),
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
  };
}

export async function signatureFor(payload: string, opts: { secret?: string; timestamp?: number } = {}) {
  return await signer.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: opts.secret ?? WEBHOOK_SECRET,
    timestamp: opts.timestamp ?? nowSec(),
    cryptoProvider,
  });
}

export async function webhookRequest(event: unknown, opts: { secret?: string; timestamp?: number; signature?: string | null; body?: string } = {}) {
  const payload = typeof event === 'string' ? event : JSON.stringify(event, null, 2);
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'Stripe/1.0 (+https://stripe.com/docs/webhooks)' };
  const signature = opts.signature === undefined ? await signatureFor(payload, opts) : opts.signature;
  if (signature !== null) headers['Stripe-Signature'] = signature;
  return new Request('http://functions.local/stripe-webhook', { method: 'POST', headers, body: opts.body ?? payload });
}

// ------------------------------------------------------------------ one-call setup
export interface Harness {
  auth: FakeAuth;
  db: FakeDb;
  stripe: FakeStripe;
}

/** Install fakes + fetch router. Call once per test file, before loading any function. */
export function installHarness(): Harness {
  const auth = new FakeAuth();
  const db = new FakeDb(auth);
  const stripe = new FakeStripe();
  installFetch();
  route(`${SUPABASE_URL}/auth/v1/`, auth.handle);
  route(`${SUPABASE_URL}/rest/v1/`, db.handle);
  route('https://api.stripe.com/', stripe.handle);
  captureConsole();
  return { auth, db, stripe };
}

export function fnRequest(
  name: string,
  opts: { method?: string; origin?: string | null; token?: string | null; body?: unknown; rawBody?: string; authorization?: string } = {},
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: ANON_KEY };
  const origin = opts.origin === undefined ? SITE_ORIGIN : opts.origin;
  if (origin !== null) headers.Origin = origin;
  if (opts.authorization !== undefined) headers.Authorization = opts.authorization;
  else if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const method = opts.method ?? 'POST';
  const body = method === 'GET' || method === 'HEAD' ? undefined : opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  return new Request(`http://functions.local/${name}`, { method, headers, body });
}
