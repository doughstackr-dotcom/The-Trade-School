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

Optional secrets:

| name | default | meaning |
|---|---|---|
| `ALPHAVANTAGE_DAILY_LIMIT` | `24` | Upstream calls allowed per UTC day (free key: 25/day for your whole account). |
| `ALPHAVANTAGE_PREMIUM` | unset | Set to `1` only if you upgrade the key to a paid plan: enables intraday candles (5m, 15m, 1h) and full daily history. |
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
  US stocks/ETFs after 21:30 UTC on weekdays, FX after 22:30 UTC on weekdays, BTC/ETH after
  00:30 UTC every day. Weekly candles refresh after Friday's close (BTC/ETH: after Monday
  00:30 UTC). Between closes every chart is served from the database, including weekends.
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
  next attempt (a "premium endpoint" or invalid-key answer waits until the next close). If
  Alpha Vantage itself says the key's daily limit is reached (for example because the key is
  also used elsewhere), the function treats it like its own budget running out.
- Weekly stock candles are split-adjusted. Daily candles on the free key are not (Alpha
  Vantage's adjusted daily series is premium): a stock split inside the last ~100 days shows
  up as a sharp drop on the daily chart.
- `ALPHAVANTAGE_DAILY_LIMIT` (default 24) leaves one call of the free 25 spare. Calls are
  spaced about a second apart, so a burst of first-time charts is not rejected.

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
exchange to fill an empty cache when both exchanges are down, so an exchange outage cannot
use up the daily budget.

A licensed alternative that needs no permission letter is **CoinGecko's paid API** (about
$29/month for hourly/daily history, more for arbitrary windows and a live price stream,
with a required "Data provided by CoinGecko" credit). Ask and it can be added as another
adapter.

## 5. Check that it works

- Supabase → Edge Functions → `market-data` → **Logs** shows each upstream call.
- Supabase → Table editor → `market_candles` fills up; `market_quota` shows calls used today.
  In `market_fetches`, an Alpha Vantage row's `fetched_at` + 30 minutes (1 hour for weekly) is
  when that market may be refreshed next (the next close, or 00:00 UTC after the budget ran
  out).
- `POST {"catalog": true}` to the function (or open
  `…/functions/v1/market-data?catalog=1` with the publishable key) lists which markets and
  intervals are live: `status: "unconfigured"` means no key and no exchange feed is set.
- On the site, the Live Market Lab's status bar says **Delayed (end of day)** with the
  Alpha Vantage credit, and games show a **Real market** option.
