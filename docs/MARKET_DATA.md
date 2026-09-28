# Real market data — owner guide

The Trade School's games and lessons can use **real market charts** (the "Real market" chart
option, the Setup Playbook's real examples, the Live Market Lab and Daily Challenge). The
data comes through the Supabase Edge Function `market-data`, which caches every candle in
the database, so the whole site shares a handful of provider requests per day.

When no provider is configured, everything still works: games use textbook charts and the
realistic market simulator, clearly labelled.

## 1. Add your Alpha Vantage key (2 minutes)

1. Get a free key at <https://www.alphavantage.co/support/#api-key>.
2. Open **Supabase → project the-trade-school → Edge Functions → Secrets**:
   <https://supabase.com/dashboard/project/pedcpgmowqhqgersxxqa/functions/secrets>
3. Click **Add new secret**:
   - Name: `ALPHAVANTAGE_API_KEY`
   - Value: your key
4. Save. It takes effect immediately — no redeploy needed.

Never paste the key into chat, GitHub, or the website code. It only lives in Supabase secrets.
(Spaces or a trailing newline pasted with it are ignored. The function never writes the key to
its logs or answers: network errors that carry the request URL are scrubbed first.)

Optional secrets:

| name | default | meaning |
|---|---|---|
| `ALPHAVANTAGE_DAILY_LIMIT` | `24` | Upstream calls allowed per UTC day (free key: 25/day for your whole account). |
| `ALPHAVANTAGE_PREMIUM` | unset | Set to `1` only if you upgrade the key to a paid plan: enables intraday candles (5m, 15m, 1h) and full daily history. Raise `ALPHAVANTAGE_DAILY_LIMIT` to your plan's allowance at the same time (hourly intraday refreshes need far more than 24 calls). |
| `ALPHAVANTAGE_SPACING_MS` | `1100` | Advanced, leave unset: minimum gap between two calls (the free key rejects more than about one call per second). |

## 2. What the free key gives the site

- **Markets (12):** SPY, QQQ, GLD, AAPL, MSFT, NVDA, TSLA, EUR/USD, GBP/USD, USD/JPY, BTC-USD,
  ETH-USD.
- **Daily candles:** the latest ~100 trading days per market at first; the cache keeps every
  day it sees, so history grows over time.
- **Weekly candles:** 20+ years per market (split-adjusted for stocks), great for real
  pattern examples.
- **Refreshes:** at most once per new daily/weekly candle per market. The first day needs
  about 24 calls to fill the cache (daily + weekly for all 12 markets); after that the site
  uses roughly 12–14 calls a day no matter how many members play.
- **Not included on the free key:** intraday and live prices. Live Predict and the Live
  Market Lab run in **Replay mode** (a real historical stretch replayed in real time, clearly
  labelled) until a live source is enabled (section 4).

### How the budget is spent (details)

- A market is refreshed on the first request after each close, whatever page asked for it:
  US stocks/ETFs 90 minutes after the New York close on weekdays (21:30 UTC in summer, 22:30
  UTC in winter — the times follow US daylight saving), FX 90 minutes after the 17:00 New York
  FX close (22:30 / 23:30 UTC), BTC/ETH after 00:30 UTC every day. Weekly candles refresh at
  00:30 UTC on Saturday once the week is complete (BTC/ETH: Monday 00:30 UTC) — not on Friday
  evening, so Friday's UTC day doesn't carry ten weekly calls on top of every daily one. Between
  closes every chart is served from the database, including weekends. Busiest days: 14 calls
  (Monday), 12 on the other weekdays and on Saturday, 2 on Sunday.
- The function doesn't know exchange holidays: on a US market holiday each stock/ETF spends
  one call that brings nothing new. That is included in the 12–14 estimate.
- One call returns a whole series (the latest ~100 trading days, or the full weekly history),
  and all of it is kept. Asking for older daily windows than the cache holds never spends a
  call: those charts show what the cache has (games then fall back to textbook charts).
- **When the day's budget is used up**, charts that are already cached keep working (the
  refresh waits until the budget resets at 00:00 UTC; the first answer after the miss is marked
  stale), and markets that have never been fetched answer "budget used up" (games fall back to
  textbook charts). Nothing retries in a loop.
- A failed call still costs a unit, so a market whose refresh failed waits an hour before the
  next attempt (a "premium endpoint" or invalid-key answer waits until the next close). Each
  market and interval may also use at most 4 calls per UTC day (a first fill, the refresh after
  the close and two retries): one market that keeps failing — Alpha Vantage erroring for one
  symbol, or changing a response format — can't use up the budget of the others. If Alpha
  Vantage itself says the key's daily limit is reached (for example because the key is also
  used elsewhere), the function treats it like its own budget running out.
- Weekly stock candles are split-adjusted, including the week in which a split takes effect
  mid-week (e.g. TSLA's Thursday split in August 2022): that week's open and pre-split high or
  low use the previous week's factor, so there is no fake crash inside the candle. If the key's
  plan doesn't include the adjusted weekly series, the function falls back to plain weekly
  candles (one more call, then remembered for 12 hours), which are not adjusted. Daily candles
  on the free key are not adjusted either (Alpha Vantage's adjusted daily series is premium): a
  future stock split shows up as a sharp drop on the daily chart, and since the cache keeps
  every day it has seen, the drop stays in the cached daily history.
- `ALPHAVANTAGE_DAILY_LIMIT` (default 24) leaves one call of the free 25 spare. Calls are
  spaced about a second apart (including the weekly fallback's second call), so a burst of
  first-time charts is not rejected.
- Browsers may keep an answer for at most a minute when it includes the newest candles, an
  hour for an older complete window, and not at all when it is stale or when the market has
  never been fetched yet.

## 3. Licensing — please read

Alpha Vantage's terms ask anyone using the platform **for commercial purposes** to contact
them (premium@alphavantage.co). A subscription website is commercial. They also mention
free access for educational projects, so ask. A draft you can send:

> Subject: Commercial use for an educational trading school
>
> Hi Alpha Vantage team,
>
> I run The Trade School, an online course that teaches chart reading and risk management
> with interactive lessons and games (subscriptions $19.99–$29.99/month). I'd like to show
> end-of-day and weekly OHLC charts (12 symbols: SPY, QQQ, GLD, AAPL, MSFT, NVDA, TSLA,
> EUR/USD, GBP/USD, USD/JPY, BTC, ETH) to members as practice material, cached on our server
> (about 15 requests per day), with "Market data: Alpha Vantage" shown on every chart.
>
> Is this allowed on the free key, or which plan/licence do you recommend? We are an
> educational project and would appreciate your educational terms if they apply.
>
> Thank you,
> [your name, site URL]

The site shows "Market data: Alpha Vantage" on every real chart automatically.

## 4. Optional: true live crypto (exchange feeds)

The function also contains adapters for **Kraken** and **Coinbase** public candles (real
1-minute data, 24/7). Their market-data terms don't allow showing the data to paying users
without written permission, so they are **off** unless you enable them after you have that
permission in writing:

| secret | value |
|---|---|
| `MARKET_EXCHANGE_FEEDS` | e.g. `kraken` or `kraken,coinbase` (only after written approval) |

With a feed on, crypto charts (every coin listed on that exchange, 1-minute to daily) come
from the exchange in real time and the Live Market Lab switches from Replay to Live for them.
Coinbase is preferred and Kraken is the fallback. BTC/ETH weekly candles still come from
Alpha Vantage (the exchanges have no weekly candles). Alpha Vantage is only used behind an
exchange to fill an empty cache when both exchanges are down, through a hold of its own (a
failed attempt waits an hour, a spent budget until 00:00 UTC — the exchanges themselves are
retried every few seconds), so an exchange outage cannot use up the daily budget.

A licensed alternative that needs no permission letter is **CoinGecko's paid API** (about
$29/month for hourly/daily history, more for arbitrary windows and a live price stream,
with a required "Data provided by CoinGecko" credit). Ask and it can be added as another
adapter.

## 5. Check that it works

- Supabase → Edge Functions → `market-data` → **Logs** shows each upstream call.
- Supabase → Table editor → `market_candles` fills up; `market_quota` shows calls used today
  (`alphavantage` for the whole site, plus one row per market and interval, e.g.
  `alphavantage:SPY:1d`, for its own 4-a-day allowance). In `market_fetches`, an Alpha Vantage
  row's `fetched_at` + 30 minutes (1 hour for weekly) is when that market may be refreshed next
  (the next close, or 00:00 UTC after the budget ran out); rows whose interval ends in
  `/fallback` hold the Alpha Vantage fallback behind the exchange feeds.
- `POST {"catalog": true}` to the function (or open
  `…/functions/v1/market-data?catalog=1` with the publishable key) lists which markets and
  intervals are live: `status: "unconfigured"` means no key and no exchange feed is set.
- On the site, the Live Market Lab's status bar says **Delayed (end of day)** with the
  Alpha Vantage credit, and games show a **Real market** option.

## 6. Live Lab quotes (Massive.com)

The Live Market Lab (`#live`) needs last price / daily change for a quote board. Alpha Vantage’s
free key is already used for candle history, so quotes use **Massive.com** (formerly Polygon.io;
Polygon-compatible REST at `api.massive.com`), fetched **server-side** inside the `market-data`
Edge Function (`POST { quotes: true, symbols: [...] }`).

Why server-side: the API key must never reach the browser. The client (`js/core/market.js`
`getQuotes`) only talks to Supabase with the publishable key — same pattern as candles.

### Secret

1. Get a key at <https://massive.com/> (Basic / free tier is enough for EOD aggregates).
2. Set the Edge Function secret (never commit the real value):

```bash
supabase secrets set MASSIVE_API_KEY=YOUR_KEY --project-ref pedcpgmowqhqgersxxqa
```

Or Dashboard → Edge Functions → Secrets → `MASSIVE_API_KEY`. Then redeploy if the function
was not yet reading this secret:

```bash
supabase functions deploy market-data --project-ref pedcpgmowqhqgersxxqa
```

Local reference only: add `MASSIVE_API_KEY=YOUR_KEY` to `.env` (see `.env.example`).

Without the secret, `POST { quotes: true }` returns **503** `{ unconfigured: true, source: "massive" }`.

| detail | value |
|---|---|
| Upstream (stocks board) | `GET /v2/aggs/grouped/locale/us/market/stocks/{date}` — 1–2 calls for the whole US board (today + prior session) |
| Upstream (crypto/FX + chart) | `GET /v2/aggs/ticker/{ticker}/range/1/{day\|week}/{from}/{to}` |
| Auth | `Authorization: Bearer …` and `?apiKey=` (secret `MASSIVE_API_KEY`) |
| Symbols | SPY, QQQ, AAPL, MSFT, NVDA, TSLA, GLD; crypto `X:BTCUSD` / `X:ETHUSD`; FX `C:EURUSD` |
| Free tier | **End-of-day** aggregates, **~5 requests/min** (no realtime snapshot on Basic) |
| Server cache | ~55s quotes / grouped; ~120s candle history; upstream paced ≥12.5s apart |
| Client poll | ~60 seconds; pauses while the tab is hidden; last daily bar OHLC patched from quotes |
| On failure | Last good quote is kept and marked `stale`; the page never blanks |
| Unconfigured | **503** `{ unconfigured: true }` with clear `MASSIVE_API_KEY` message — never “unknown symbol” for catalog tickers |
| Attribution | `Data: Massive.com (end-of-day on free tier…). Educational use.` |

Live Lab **daily charts** also use Massive when the secret is set (`1d` / `1w` for Massive symbols).
Games / lessons still prefer Alpha Vantage / exchange feeds when those are configured (sections 1–4).

### Owner setup (required for live numbers)

`MASSIVE_API_KEY` was **not** available in this agent environment and the Supabase CLI was not logged in, so the secret must be set by the project owner:

```bash
npx supabase login
npx supabase secrets set MASSIVE_API_KEY=YOUR_KEY --project-ref pedcpgmowqhqgersxxqa
npx supabase functions deploy market-data --project-ref pedcpgmowqhqgersxxqa
```

Or Dashboard → Project Settings → Edge Functions → Secrets → add `MASSIVE_API_KEY`, then redeploy `market-data` from the multi-file sources under `supabase/functions/market-data/` (index.ts, massive.ts, providers.ts, alphavantage.ts). A compact Massive-only restore may already be live; redeploying the git tree restores Alpha Vantage / exchange candle paths for games.
