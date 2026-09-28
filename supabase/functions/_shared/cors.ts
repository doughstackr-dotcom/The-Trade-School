// Origin allow-list shared by every Edge Function (no dependencies, so the public
// market-data function can use it without pulling in Stripe).
//
// SITE_URL is the public site's base URL (it may include a path, e.g. a GitHub Pages
// project site). ALLOWED_ORIGINS (comma separated) adds extra origins such as
// http://localhost:5173 that may call the functions. Only an allow-listed origin is ever
// echoed in Access-Control-Allow-Origin; there is no '*' fallback.

const env = (name: string) => Deno.env.get(name) ?? '';

/** The http(s) origin of `url` ('' when it has none: invalid, opaque, blob:, ftp:, …). */
export function originOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : '';
  } catch {
    return '';
  }
}

export const SITE_ORIGIN = originOf(env('SITE_URL'));
export const ALLOWED_ORIGINS = env('ALLOWED_ORIGINS')
  .split(',')
  .map((o) => originOf(o.trim()))
  .filter(Boolean);

/** SITE_URL's origin or one listed in ALLOWED_ORIGINS (exact match: scheme, host and port). */
export const isAllowedOrigin = (origin: string) =>
  Boolean(origin) && (origin === SITE_ORIGIN || ALLOWED_ORIGINS.includes(origin));

/**
 * http://localhost, http://127.0.0.1 or http://[::1] on any port: a page served from the
 * developer's own machine (e.g. `npm run serve`). Only used for public, read-only data.
 */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' || u.origin !== origin) return false;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * The Access-Control-Allow-Origin header for this request: the request's own origin when it
 * is allowed, otherwise nothing at all (the browser then refuses to expose the response).
 * `loopback: true` also allows loopback origins for local development.
 */
export function allowOriginHeader(req: Request, opts: { loopback?: boolean } = {}): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const ok = isAllowedOrigin(origin) || (opts.loopback === true && isLoopbackOrigin(origin));
  return ok ? { 'Access-Control-Allow-Origin': origin } : {};
}
