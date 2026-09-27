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

A licensed alternative that needs no permission letter is **CoinGecko's paid API** (about
$29/month for hourly/daily history, more for arbitrary windows and a live price stream,
with a required "Data provided by CoinGecko" credit). Ask and it can be added as another
adapter.

## 5. Check that it works

- Supabase → Edge Functions → `market-data` → **Logs** shows each upstream call.
- Supabase → Table editor → `market_candles` fills up; `market_quota` shows calls used today.
- On the site, the Live Market Lab's status bar says **Delayed (end of day)** with the
  Alpha Vantage credit, and games show a **Real market** option.
