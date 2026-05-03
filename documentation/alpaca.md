# Alpaca Trading API Ñ Complete Guide
## Paper Trading, Market Data, Orders, Positions & Streaming

> Everything you need to go from zero to a fully functional paper trading system using `alpaca-py`, Alpaca's official Python SDK.

---

## Table of Contents

1. [Why Alpaca](#why-alpaca)
2. [Account Setup](#account-setup)
3. [Installation & Environment](#installation--environment)
4. [Client Architecture](#client-architecture)
5. [Paper vs Live Ñ The One Line Difference](#paper-vs-live)
6. [Account & Portfolio Info](#account--portfolio-info)
7. [Market Status & Calendar](#market-status--calendar)
8. [Assets Ñ What Can You Trade?](#assets)
9. [Market Data Ñ Historical](#market-data--historical)
10. [Market Data Ñ Real-Time WebSocket](#market-data--real-time-websocket)
11. [Snapshots Ñ Complete Market Picture](#snapshots)
12. [Order Types Ñ Complete Reference](#order-types)
13. [Time in Force Ñ When Orders Expire](#time-in-force)
14. [Advanced Orders Ñ Bracket, OCO, OTO](#advanced-orders)
15. [Managing Orders](#managing-orders)
16. [Positions Ñ Tracking Your Portfolio](#positions)
17. [Portfolio History](#portfolio-history)
18. [Streaming Trade Updates](#streaming-trade-updates)
19. [Watchlists](#watchlists)
20. [Corporate Actions](#corporate-actions)
21. [Error Handling & Rate Limits](#error-handling--rate-limits)
22. [Agent Tool Functions Ñ Ready to Use](#agent-tool-functions)
23. [Quick Reference Card](#quick-reference-card)

---

## Why Alpaca

Alpaca is an API-first brokerage built specifically for algorithmic and automated trading:

- **Commission-free** stock and ETF trading via API
- **Paper trading** is completely free with full feature parity to live trading
- **No minimum deposit** to start paper trading
- **Best Broker for Algorithmic Trading** award (December 2025)
- MCP server available Ñ agents can trade via natural language tool calls
- SDKs in Python, TypeScript/Node, Go, C#, and more
- Real execution infrastructure Ñ the same system used for live trades runs paper trading

The paper environment uses real market data and simulates execution identically to live. If it works in paper, it works live. That's the contract.

---

## Account Setup

1. Sign up at [app.alpaca.markets](https://app.alpaca.markets/signup) Ñ free, no deposit required
2. From the dashboard dropdown in the top-left, select **Paper Trading**
3. Navigate to **API Keys ? Generate New Key**
4. Copy both `API Key ID` and `Secret Key` Ñ the secret is only shown once
5. Store both in your environment (never hardcode in source)

```bash
# .env file
ALPACA_API_KEY=PKxxxxxxxxxxxxxxxxxxxxxxxx
ALPACA_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Paper vs Live key spaces are separate.** Paper keys only work with paper endpoints. Live keys only work with live endpoints. You'll have two separate key pairs.

---

## Installation & Environment

```bash
pip install alpaca-py python-dotenv
```

```python
import os
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.environ["ALPACA_API_KEY"]
SECRET_KEY = os.environ["ALPACA_SECRET_KEY"]
```

**Package note:** `alpaca-py` is the official current SDK. The older `alpaca-trade-api` package is deprecated and should not be used for new projects.

---

## Client Architecture

`alpaca-py` uses separate client classes for separate concerns. You instantiate the ones you need:

| Client | Purpose | Requires Keys? |
|---|---|---|
| `TradingClient` | Orders, positions, account, assets | Yes |
| `StockHistoricalDataClient` | Historical bars, quotes, trades | Yes |
| `CryptoHistoricalDataClient` | Historical crypto data | No (but rates improve with keys) |
| `OptionHistoricalDataClient` | Historical options data | Yes |
| `StockDataStream` | Real-time stock data WebSocket | Yes |
| `CryptoDataStream` | Real-time crypto data WebSocket | No |
| `OptionDataStream` | Real-time options data WebSocket | Yes |
| `TradingStream` | Order update WebSocket | Yes |

```python
from alpaca.trading.client import TradingClient
from alpaca.data.historical import StockHistoricalDataClient, CryptoHistoricalDataClient
from alpaca.data.live import StockDataStream

# Trading client Ñ paper mode
trading_client = TradingClient(API_KEY, SECRET_KEY, paper=True)

# Market data clients
stock_data_client = StockHistoricalDataClient(API_KEY, SECRET_KEY)
crypto_data_client = CryptoHistoricalDataClient()  # no keys needed

# Real-time stream
stock_stream = StockDataStream(API_KEY, SECRET_KEY)
```

---

## Paper vs Live

The entire difference between paper and live is **one parameter**:

```python
# Paper trading Ñ test everything here first
trading_client = TradingClient(API_KEY, SECRET_KEY, paper=True)

# Live trading Ñ real money, real execution
trading_client = TradingClient(API_KEY, SECRET_KEY, paper=False)  # or omit paper= entirely
```

Also swap your keys Ñ use paper keys for `paper=True`, live keys for live.

The paper environment:
- Uses real market data
- Simulates real fills at market prices
- Tracks portfolio with real P&L calculations
- Supports all order types including bracket, OCO, OTO
- Starts with $100,000 virtual cash
- You can reset your paper account from the dashboard at any time

---

## Account & Portfolio Info

```python
from alpaca.trading.client import TradingClient

trading_client = TradingClient(API_KEY, SECRET_KEY, paper=True)

account = trading_client.get_account()
```

**Key account fields:**

```python
# Cash and buying power
account.cash                    # "98452.31" Ñ available cash
account.buying_power            # "98452.31" Ñ total buying power (includes margin)
account.non_marginable_buying_power  # buying power for non-marginable assets
account.daytrading_buying_power # 4x for intraday (if PDT eligible)

# Portfolio value
account.portfolio_value         # "102341.50" Ñ total portfolio value
account.equity                  # same as portfolio_value for most accounts
account.last_equity             # equity at previous close
account.unrealized_pl           # total unrealized P&L across all positions

# Account status
account.status                  # "ACTIVE" | "INACTIVE" | "ACCOUNT_CLOSED"
account.account_blocked         # True if account is blocked
account.trade_suspended_by_user # True if you've suspended trading
account.pattern_day_trader      # True if flagged as PDT

# Day trading info
account.daytrade_count          # number of day trades in last 5 trading days
account.last_maintenance_margin # margin maintenance requirement
account.multiplier              # "1" for cash, "2" for margin overnight

# Flags
account.shorting_enabled        # can you short?
account.long_market_value       # total long position value
account.short_market_value      # total short position value
```

**Print a clean account summary:**

```python
def print_account_summary(account) -> None:
    print(f"""
???????????????????????????????????
  ACCOUNT SUMMARY
???????????????????????????????????
  Portfolio Value:  ${float(account.portfolio_value):>12,.2f}
  Cash:             ${float(account.cash):>12,.2f}
  Buying Power:     ${float(account.buying_power):>12,.2f}
  Unrealized P&L:   ${float(account.unrealized_pl):>12,.2f}
  Day Trades:       {account.daytrade_count}
  PDT Flag:         {account.pattern_day_trader}
  Status:           {account.status}
???????????????????????????????????
""")

print_account_summary(account)
```

---

## Market Status & Calendar

### Clock Ñ Is the Market Open Right Now?

```python
clock = trading_client.get_clock()

print(f"Market is {'OPEN' if clock.is_open else 'CLOSED'}")
print(f"Current time: {clock.timestamp}")
print(f"Next open:  {clock.next_open}")
print(f"Next close: {clock.next_close}")
```

### Calendar Ñ Trading Day Schedule

```python
from alpaca.trading.requests import GetCalendarRequest
from datetime import date

# Get trading calendar for date range
request = GetCalendarRequest(
    start=date(2026, 5, 1),
    end=date(2026, 5, 31)
)

calendar = trading_client.get_calendar(request)

for day in calendar:
    print(f"{day.date}: open {day.open} ? close {day.close}")
```

**Always check the clock before placing orders.** Orders placed outside market hours are queued and fill at next open, which may not be what you want.

---

## Assets

The assets API tells you what's tradable on Alpaca and key metadata about each asset.

### Get a Single Asset

```python
from alpaca.trading.requests import GetAssetsRequest
from alpaca.trading.enums import AssetClass, AssetStatus

# Get info on a specific ticker
pltr_asset = trading_client.get_asset("PLTR")

print(f"Symbol:        {pltr_asset.symbol}")
print(f"Name:          {pltr_asset.name}")
print(f"Class:         {pltr_asset.asset_class}")
print(f"Exchange:      {pltr_asset.exchange}")
print(f"Tradable:      {pltr_asset.tradable}")
print(f"Shortable:     {pltr_asset.shortable}")
print(f"Marginable:    {pltr_asset.marginable}")
print(f"Fractionable:  {pltr_asset.fractionable}")
print(f"Easy-to-borrow:{pltr_asset.easy_to_borrow}")
```

### Search All Assets

```python
# All active US stocks
request = GetAssetsRequest(
    asset_class=AssetClass.US_EQUITY,
    status=AssetStatus.ACTIVE
)
all_stocks = trading_client.get_all_assets(request)

# Filter for tradable and fractionable
tradable = [a for a in all_stocks if a.tradable and a.fractionable]
print(f"Found {len(tradable)} tradable fractionable stocks")
```

**Always check `asset.tradable` before placing an order.** Not all assets listed are tradable.

---

## Market Data Ñ Historical

### Setup

```python
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import (
    StockBarsRequest,
    StockLatestQuoteRequest,
    StockLatestTradeRequest,
    StockSnapshotRequest,
    StockTradesRequest,
)
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
from datetime import datetime, timedelta

stock_client = StockHistoricalDataClient(API_KEY, SECRET_KEY)
```

### Historical Bars (OHLCV)

```python
# Daily bars for last 90 days
request = StockBarsRequest(
    symbol_or_symbols="PLTR",
    timeframe=TimeFrame.Day,
    start=datetime.now() - timedelta(days=90),
    end=datetime.now(),
    adjustment="all",  # adjust for splits and dividends
    feed="iex",        # "iex" (free) or "sip" (paid, more complete)
)

bars = stock_client.get_stock_bars(request)

# Access as list of Bar objects
pltr_bars = bars["PLTR"]
for bar in pltr_bars[-5:]:  # last 5 bars
    print(f"{bar.timestamp.date()}: O={bar.open:.2f} H={bar.high:.2f} L={bar.low:.2f} C={bar.close:.2f} V={bar.volume:,}")

# Convert to pandas DataFrame Ñ very useful
df = bars.df
print(df.tail())
```

**TimeFrame options:**

```python
TimeFrame.Minute          # 1 minute
TimeFrame(5, TimeFrameUnit.Minute)   # 5 minutes
TimeFrame(15, TimeFrameUnit.Minute)  # 15 minutes
TimeFrame(30, TimeFrameUnit.Minute)  # 30 minutes
TimeFrame(1, TimeFrameUnit.Hour)     # 1 hour
TimeFrame.Hour            # 1 hour
TimeFrame.Day             # 1 day
TimeFrame.Week            # 1 week
TimeFrame.Month           # 1 month
```

### Multi-Symbol Bars

```python
# Get bars for multiple tickers at once
request = StockBarsRequest(
    symbol_or_symbols=["PLTR", "NVDA", "AAPL", "MSFT"],
    timeframe=TimeFrame.Day,
    start=datetime.now() - timedelta(days=30),
)

multi_bars = stock_client.get_stock_bars(request)

# Access by symbol
pltr_close = multi_bars["PLTR"][-1].close
nvda_close = multi_bars["NVDA"][-1].close
```

### Latest Quote (Bid/Ask)

```python
# Single symbol
request = StockLatestQuoteRequest(symbol_or_symbols="PLTR")
quotes = stock_client.get_stock_latest_quote(request)

pltr_quote = quotes["PLTR"]
print(f"Bid: ${pltr_quote.bid_price:.2f} x {pltr_quote.bid_size}")
print(f"Ask: ${pltr_quote.ask_price:.2f} x {pltr_quote.ask_size}")
print(f"Spread: ${pltr_quote.ask_price - pltr_quote.bid_price:.4f}")

# Multiple symbols
request = StockLatestQuoteRequest(symbol_or_symbols=["PLTR", "NVDA", "AAPL"])
quotes = stock_client.get_stock_latest_quote(request)
for symbol in ["PLTR", "NVDA", "AAPL"]:
    q = quotes[symbol]
    print(f"{symbol}: ${q.bid_price:.2f} / ${q.ask_price:.2f}")
```

### Latest Trade (Last Price)

```python
request = StockLatestTradeRequest(symbol_or_symbols="PLTR")
trades = stock_client.get_stock_latest_trade(request)

last_trade = trades["PLTR"]
print(f"Last price:  ${last_trade.price:.2f}")
print(f"Last size:   {last_trade.size} shares")
print(f"Timestamp:   {last_trade.timestamp}")
print(f"Exchange:    {last_trade.exchange}")
```

### Historical Trades (Tick Data)

```python
from alpaca.data.requests import StockTradesRequest

request = StockTradesRequest(
    symbol_or_symbols="PLTR",
    start=datetime.now() - timedelta(hours=1),
    end=datetime.now(),
    limit=500,
)

trades = stock_client.get_stock_trades(request)
for trade in trades["PLTR"]:
    print(f"{trade.timestamp}: ${trade.price:.2f} x {trade.size} @ {trade.exchange}")
```

---

## Market Data Ñ Real-Time WebSocket

For real-time streaming data as it happens, use the data stream clients.

### Real-Time Stock Quotes

```python
from alpaca.data.live import StockDataStream
import asyncio

stream = StockDataStream(API_KEY, SECRET_KEY)

async def handle_quote(data):
    print(f"[QUOTE] {data.symbol}: bid=${data.bid_price:.2f} ask=${data.ask_price:.2f}")

async def handle_trade(data):
    print(f"[TRADE] {data.symbol}: ${data.price:.2f} x {data.size}")

async def handle_bar(data):
    print(f"[BAR] {data.symbol}: O={data.open:.2f} H={data.high:.2f} L={data.low:.2f} C={data.close:.2f} V={data.volume:,}")

# Subscribe to specific symbols
stream.subscribe_quotes(handle_quote, "PLTR", "NVDA")
stream.subscribe_trades(handle_trade, "PLTR", "NVDA")
stream.subscribe_bars(handle_bar, "PLTR", "NVDA")

# Start streaming (blocks)
stream.run()
```

### Unsubscribe

```python
stream.unsubscribe_quotes("PLTR")
stream.unsubscribe_trades("NVDA")
```

### Real-Time Crypto Data (No Keys Required)

```python
from alpaca.data.live import CryptoDataStream

crypto_stream = CryptoDataStream()

async def handle_crypto_trade(data):
    print(f"{data.symbol}: ${data.price:.2f}")

crypto_stream.subscribe_trades(handle_crypto_trade, "BTC/USD", "ETH/USD")
crypto_stream.run()
```

---

## Snapshots

A snapshot returns everything in one call: latest bar, latest trade, latest quote, and daily bar for a symbol. This is what you want for pre-trade price checks.

```python
from alpaca.data.requests import StockSnapshotRequest

request = StockSnapshotRequest(symbol_or_symbols=["PLTR", "NVDA"])
snapshots = stock_client.get_stock_snapshot(request)

pltr = snapshots["PLTR"]

# Latest bar (most recent completed minute)
print(f"Latest bar close: ${pltr.latest_trade.price:.2f}")

# Daily bar
print(f"Today open:  ${pltr.daily_bar.open:.2f}")
print(f"Today high:  ${pltr.daily_bar.high:.2f}")
print(f"Today low:   ${pltr.daily_bar.low:.2f}")
print(f"Today vwap:  ${pltr.daily_bar.vwap:.2f}")
print(f"Today vol:   {pltr.daily_bar.volume:,}")

# Previous daily bar
print(f"Prev close:  ${pltr.prev_daily_bar.close:.2f}")

# Latest quote
print(f"Bid: ${pltr.latest_quote.bid_price:.2f}")
print(f"Ask: ${pltr.latest_quote.ask_price:.2f}")
```

**Use `get_stock_snapshot()` instead of multiple separate calls** when you need current price context before a trade.

---

## Order Types Ñ Complete Reference

All orders require a `TradingClient` and an `OrderRequest` object.

```python
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import (
    MarketOrderRequest,
    LimitOrderRequest,
    StopOrderRequest,
    StopLimitOrderRequest,
    TrailingStopOrderRequest,
    TakeProfitRequest,
    StopLossRequest,
)
from alpaca.trading.enums import OrderSide, TimeInForce, OrderClass, OrderType

trading_client = TradingClient(API_KEY, SECRET_KEY, paper=True)
```

### Market Order

Buy or sell at best available price. Executes immediately during market hours.

```python
# Buy 10 shares at market
order = trading_client.submit_order(
    MarketOrderRequest(
        symbol="PLTR",
        qty=10,
        side=OrderSide.BUY,
        time_in_force=TimeInForce.DAY
    )
)

# Buy fractional shares
order = trading_client.submit_order(
    MarketOrderRequest(
        symbol="PLTR",
        qty=2.5,  # fractional
        side=OrderSide.BUY,
        time_in_force=TimeInForce.DAY
    )
)

# Buy by dollar amount (notional)
order = trading_client.submit_order(
    MarketOrderRequest(
        symbol="PLTR",
        notional=500.00,  # $500 worth of PLTR
        side=OrderSide.BUY,
        time_in_force=TimeInForce.DAY
    )
)

# Sell
order = trading_client.submit_order(
    MarketOrderRequest(
        symbol="PLTR",
        qty=10,
        side=OrderSide.SELL,
        time_in_force=TimeInForce.DAY
    )
)
```

**Order response fields:**
```python
print(order.id)              # UUID Ñ save this to track the order
print(order.client_order_id) # your optional custom ID
print(order.status)          # "accepted", "pending_new", "new", "filled", etc.
print(order.symbol)
print(order.qty)
print(order.filled_qty)      # how many shares filled so far
print(order.filled_avg_price) # average fill price
print(order.created_at)
print(order.filled_at)
```

### Limit Order

Buy or sell at a specific price or better. Will not execute above (buy) or below (sell) your limit price.

```python
# Limit buy Ñ only executes if price drops to $85 or below
order = trading_client.submit_order(
    LimitOrderRequest(
        symbol="PLTR",
        qty=10,
        side=OrderSide.BUY,
        time_in_force=TimeInForce.GTC,  # Good Till Cancelled
        limit_price=85.00
    )
)

# Limit sell Ñ only executes if price rises to $95 or above
order = trading_client.submit_order(
    LimitOrderRequest(
        symbol="PLTR",
        qty=10,
        side=OrderSide.SELL,
        time_in_force=TimeInForce.GTC,
        limit_price=95.00
    )
)
```

### Stop Order

Triggers a market order when price hits the stop price. Used for stop-losses.

```python
# Stop-loss sell Ñ triggers market sell if price drops to $80
order = trading_client.submit_order(
    StopOrderRequest(
        symbol="PLTR",
        qty=10,
        side=OrderSide.SELL,
        time_in_force=TimeInForce.GTC,
        stop_price=80.00
    )
)
```

**Warning:** Stop orders trigger a market order at the stop price, so actual fill may be below stop price in fast markets.

### Stop-Limit Order

Like a stop order, but triggers a limit order instead of a market order. More price control, but may not fill.

```python
# Triggers at $80, but won't sell below $79
order = trading_client.submit_order(
    StopLimitOrderRequest(
        symbol="PLTR",
        qty=10,
        side=OrderSide.SELL,
        time_in_force=TimeInForce.GTC,
        stop_price=80.00,
        limit_price=79.00
    )
)
```

### Trailing Stop Order

Automatically adjusts the stop price as the stock moves in your favor. Locks in gains while letting profits run.

```python
# Trailing stop by percentage Ñ stop moves up as price rises
order = trading_client.submit_order(
    TrailingStopOrderRequest(
        symbol="PLTR",
        qty=10,
        side=OrderSide.SELL,
        time_in_force=TimeInForce.GTC,
        trail_percent=5.0  # stop is always 5% below highest price
    )
)

# Trailing stop by dollar amount
order = trading_client.submit_order(
    TrailingStopOrderRequest(
        symbol="PLTR",
        qty=10,
        side=OrderSide.SELL,
        time_in_force=TimeInForce.GTC,
        trail_price=4.00  # stop is always $4 below highest price
    )
)
```

**Trailing stop rules:** Only supports `DAY` and `GTC`. Does not trigger outside regular market hours. Only supported as single orders (not inside bracket orders currently).

---

## Time in Force Ñ When Orders Expire

| Code | Name | Behavior |
|---|---|---|
| `DAY` | Day Order | Expires at end of trading day |
| `GTC` | Good Till Cancelled | Stays active until filled or manually cancelled |
| `IOC` | Immediate or Cancel | Fill immediately or cancel entirely |
| `FOK` | Fill or Kill | Fill entire quantity immediately or cancel |
| `OPG` | Market on Open | Executes at the opening auction only |
| `CLS` | Market on Close | Executes at the closing auction only |

```python
# Most common for algorithmic trading
TimeInForce.DAY   # intraday strategies
TimeInForce.GTC   # swing trades, persistent limit orders
TimeInForce.IOC   # when you need partial fills or nothing
TimeInForce.FOK   # when you need the full quantity or nothing
```

---

## Advanced Orders

### Bracket Order (Entry + Take Profit + Stop Loss)

Three linked orders: entry order ? two exit orders (one take profit, one stop loss). Only one exit can fill. The other is automatically cancelled.

```python
# Buy PLTR, take profit at +10%, stop loss at -5%
current_price = 89.00

bracket_order = trading_client.submit_order(
    MarketOrderRequest(
        symbol="PLTR",
        qty=10,
        side=OrderSide.BUY,
        time_in_force=TimeInForce.DAY,
        order_class=OrderClass.BRACKET,
        take_profit=TakeProfitRequest(
            limit_price=round(current_price * 1.10, 2)   # $97.90
        ),
        stop_loss=StopLossRequest(
            stop_price=round(current_price * 0.95, 2),   # $84.55
            limit_price=round(current_price * 0.94, 2)   # $83.66 (optional limit)
        )
    )
)

# Limit entry bracket order
limit_bracket = trading_client.submit_order(
    LimitOrderRequest(
        symbol="PLTR",
        qty=10,
        side=OrderSide.BUY,
        time_in_force=TimeInForce.GTC,
        limit_price=87.00,            # only enter at $87 or below
        order_class=OrderClass.BRACKET,
        take_profit=TakeProfitRequest(limit_price=96.00),
        stop_loss=StopLossRequest(stop_price=83.00)
    )
)
```

**This is the most important order type for your trading system.** Bracket orders let the agent place a complete position Ñ entry, exit plan, and risk management Ñ in a single API call without needing to monitor the position.

### OCO (One Cancels Other)

Two exit orders for an existing position. When one fills, the other cancels. Use when you already hold a position.

```python
from alpaca.trading.requests import LimitOrderRequest
from alpaca.trading.enums import OrderClass

# You already hold PLTR. Place OCO to exit.
oco_order = trading_client.submit_order(
    LimitOrderRequest(
        symbol="PLTR",
        qty=10,
        side=OrderSide.SELL,
        time_in_force=TimeInForce.GTC,
        limit_price=96.00,             # take profit leg
        order_class=OrderClass.OCO,
        stop_loss=StopLossRequest(
            stop_price=84.00,
            limit_price=83.50
        )
    )
)
```

### OTO (One Triggers Other)

When the primary order fills, it automatically triggers the secondary order.

```python
from alpaca.trading.requests import LimitOrderRequest

# Buy limit order. When filled, automatically place stop loss.
oto_order = trading_client.submit_order(
    LimitOrderRequest(
        symbol="PLTR",
        qty=10,
        side=OrderSide.BUY,
        time_in_force=TimeInForce.GTC,
        limit_price=87.00,
        order_class=OrderClass.OTO,
        stop_loss=StopLossRequest(stop_price=83.00)
    )
)
```

---

## Managing Orders

### Get a Specific Order

```python
# By Alpaca order ID
order = trading_client.get_order_by_id(order.id)

# By your custom client_order_id
order = trading_client.get_order_by_client_order_id("my_trade_001")
```

### List All Orders

```python
from alpaca.trading.requests import GetOrdersRequest
from alpaca.trading.enums import QueryOrderStatus

# All open orders
request = GetOrdersRequest(status=QueryOrderStatus.OPEN)
open_orders = trading_client.get_orders(filter=request)

# All filled orders today
from datetime import date
request = GetOrdersRequest(
    status=QueryOrderStatus.CLOSED,
    after=datetime.combine(date.today(), datetime.min.time()),
    limit=50
)
filled_today = trading_client.get_orders(filter=request)

# Orders for a specific symbol
request = GetOrdersRequest(
    symbols=["PLTR"],
    status=QueryOrderStatus.ALL
)
pltr_orders = trading_client.get_orders(filter=request)

# Print order summary
for order in open_orders:
    print(f"{order.symbol:6} {order.side.value:4} {order.qty} @ {order.type.value} "
          f"limit={order.limit_price} status={order.status.value}")
```

### Cancel an Order

```python
# Cancel specific order
trading_client.cancel_order_by_id(order_id)

# Cancel all open orders
cancel_results = trading_client.cancel_orders()
for result in cancel_results:
    print(f"Cancel {result.id}: status {result.status}")
```

### Replace an Order

Modify price or quantity without cancelling and re-submitting.

```python
from alpaca.trading.requests import ReplaceOrderRequest

# Move limit price up
trading_client.replace_order_by_id(
    order_id=order.id,
    order_data=ReplaceOrderRequest(
        limit_price=88.00,   # new limit price
        qty=15               # new quantity
    )
)
```

---

## Positions Ñ Tracking Your Portfolio

### Get All Positions

```python
positions = trading_client.get_all_positions()

for pos in positions:
    print(f"""
{pos.symbol}
  Qty:           {pos.qty} ({pos.side.value})
  Avg entry:     ${float(pos.avg_entry_price):.2f}
  Current price: ${float(pos.current_price):.2f}
  Market value:  ${float(pos.market_value):.2f}
  Unrealized P&L: ${float(pos.unrealized_pl):.2f} ({float(pos.unrealized_plpc)*100:.2f}%)
  Today's P&L:    ${float(pos.unrealized_intraday_pl):.2f}
""")
```

**Position fields:**

```python
pos.symbol                # "PLTR"
pos.qty                   # "10" (string, convert with float())
pos.qty_available         # shares available to close or sell short
pos.side                  # PositionSide.LONG | PositionSide.SHORT
pos.avg_entry_price       # average cost basis
pos.current_price         # current market price
pos.market_value          # qty * current_price
pos.cost_basis            # total cost (qty * avg_entry_price)
pos.unrealized_pl         # unrealized P&L in dollars
pos.unrealized_plpc       # unrealized P&L as percentage (0.05 = 5%)
pos.unrealized_intraday_pl    # today's P&L
pos.unrealized_intraday_plpc  # today's P&L as percentage
pos.change_today          # price change today
pos.asset_class           # AssetClass.US_EQUITY
```

### Get a Single Position

```python
pltr_pos = trading_client.get_open_position("PLTR")
print(f"Holding {pltr_pos.qty} shares of PLTR")
print(f"P&L: ${float(pltr_pos.unrealized_pl):.2f}")
```

### Close a Specific Position

```python
# Close all shares
trading_client.close_position("PLTR")

# Close partial position
from alpaca.trading.requests import ClosePositionRequest
trading_client.close_position(
    "PLTR",
    close_options=ClosePositionRequest(qty="5")  # close 5 of your 10
)

# Close by percentage
trading_client.close_position(
    "PLTR",
    close_options=ClosePositionRequest(percentage="50")  # close 50%
)
```

### Close All Positions

```python
# Close all positions
trading_client.close_all_positions()

# Close all AND cancel all open orders (prevents new entries)
trading_client.close_all_positions(cancel_orders=True)
```

---

## Portfolio History

Get your portfolio equity curve over time. Useful for performance tracking.

```python
from alpaca.trading.requests import GetPortfolioHistoryRequest
from alpaca.trading.enums import TimeFrameUnit

request = GetPortfolioHistoryRequest(
    period="1M",            # 1D, 1W, 1M, 3M, 6M, 1A
    timeframe="1D",         # granularity: 1Min, 5Min, 15Min, 1H, 1D
    extended_hours=False,
    intraday_reporting="market_hours"
)

history = trading_client.get_portfolio_history(request)

# Equity curve
for timestamp, equity, profit_loss in zip(
    history.timestamp,
    history.equity,
    history.profit_loss
):
    from datetime import datetime
    dt = datetime.fromtimestamp(timestamp)
    print(f"{dt.date()}: ${equity:,.2f} (P&L: ${profit_loss:+,.2f})")

# Summary
print(f"Base value:       ${history.base_value:,.2f}")
print(f"Base value date:  {history.base_value_asof}")
print(f"Profit/Loss %:    {history.profit_loss_pct[-1]*100:.2f}%")

# Convert to DataFrame
import pandas as pd
df = pd.DataFrame({
    "timestamp": [datetime.fromtimestamp(t) for t in history.timestamp],
    "equity": history.equity,
    "profit_loss": history.profit_loss,
    "profit_loss_pct": history.profit_loss_pct,
})
df.set_index("timestamp", inplace=True)
print(df)
```

---

## Streaming Trade Updates

Get real-time updates whenever any of your orders change state Ñ submitted, filled, cancelled, etc.

```python
from alpaca.trading.stream import TradingStream

trading_stream = TradingStream(API_KEY, SECRET_KEY, paper=True)

async def order_update_handler(data):
    """Called whenever an order changes state."""
    event = data.event       # "new", "fill", "partial_fill", "canceled", "expired", etc.
    order = data.order

    if event == "fill":
        print(f"? FILLED: {order.symbol} {order.filled_qty} shares @ ${order.filled_avg_price}")
    elif event == "partial_fill":
        print(f"? PARTIAL: {order.symbol} {order.filled_qty}/{order.qty} @ ${order.filled_avg_price}")
    elif event == "canceled":
        print(f"? CANCELLED: {order.symbol}")
    elif event == "new":
        print(f"?? NEW ORDER: {order.symbol} {order.side.value} {order.qty}")
    elif event == "rejected":
        print(f"?? REJECTED: {order.symbol} Ñ {data}")

# Subscribe and start
trading_stream.subscribe_trade_updates(order_update_handler)
trading_stream.run()
```

**Trade update events:**

| Event | Meaning |
|---|---|
| `new` | Order accepted and on the book |
| `fill` | Order completely filled |
| `partial_fill` | Order partially filled |
| `canceled` | Order cancelled |
| `expired` | Order expired (DAY order at EOD) |
| `pending_new` | Order received, waiting confirmation |
| `replaced` | Order replaced with new parameters |
| `rejected` | Order rejected (insufficient funds, etc.) |
| `held` | Order held pending review |

---

## Watchlists

Maintain named lists of symbols for easy access.

```python
from alpaca.trading.requests import CreateWatchlistRequest, UpdateWatchlistRequest

# Create a watchlist
watchlist = trading_client.create_watchlist(
    CreateWatchlistRequest(
        name="AI Defense Stocks",
        symbols=["PLTR", "BBAI", "SAIC", "LDOS", "BAH"]
    )
)

print(f"Created: {watchlist.id} Ñ {watchlist.name}")

# Get all watchlists
watchlists = trading_client.get_all_watchlists()
for wl in watchlists:
    print(f"{wl.name}: {[a.symbol for a in wl.assets]}")

# Get specific watchlist
watchlist = trading_client.get_watchlist_by_id(watchlist.id)

# Add symbol
trading_client.add_asset_to_watchlist_by_id(watchlist.id, symbol="RGEN")

# Remove symbol
trading_client.remove_asset_from_watchlist_by_id(watchlist.id, symbol="RGEN")

# Delete watchlist
trading_client.delete_watchlist_by_id(watchlist.id)
```

---

## Corporate Actions

Track dividends, splits, mergers, and other corporate events.

```python
from alpaca.data.requests import CorporateActionsRequest
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.enums import CorporateActionType
from datetime import date

# Using the StockHistoricalDataClient
data_client = StockHistoricalDataClient(API_KEY, SECRET_KEY)

request = CorporateActionsRequest(
    symbols=["AAPL", "NVDA", "GOOGL"],
    start=date(2025, 1, 1),
    end=date(2026, 5, 1),
    types=[
        CorporateActionType.CASH_DIVIDEND,
        CorporateActionType.STOCK_SPLIT,
    ]
)

actions = data_client.get_stock_corporate_actions(request)
```

---

## Error Handling & Rate Limits

### Common Errors

```python
from alpaca.common.exceptions import APIError

def safe_submit_order(trading_client, order_request):
    try:
        order = trading_client.submit_order(order_request)
        return order
    except APIError as e:
        error_code = e.status_code
        message = str(e)

        if error_code == 403:
            print(f"Forbidden: {message}")
            # Could be: insufficient buying power, asset not tradable,
            # account blocked, market closed
        elif error_code == 422:
            print(f"Unprocessable: {message}")
            # Invalid order parameters Ñ check qty, price, symbol
        elif error_code == 429:
            print(f"Rate limited. Backing off...")
            import time
            time.sleep(5)
        elif error_code == 500:
            print(f"Alpaca server error: {message}")
        else:
            print(f"API Error {error_code}: {message}")
        return None
```

### Common Error Causes

| Error | Likely Cause |
|---|---|
| 403 Forbidden | Insufficient buying power, account blocked, PDT restriction |
| 422 Unprocessable | Invalid symbol, bad order params, market closed for OPG/CLS |
| 429 Rate Limited | Too many requests per minute |
| Order rejected | Fractional shares not allowed for this symbol, extended hours without extended_hours=True |
| PDT violation | 4th day trade in 5 rolling days with < $25k equity |

### Rate Limits

Alpaca doesn't publish exact rate limits, but practical guidance:
- REST calls: ~200/min on free tier
- WebSocket: no practical limit on subscriptions
- Paper trading has the same limits as live

```python
import time
import functools

def rate_limited(max_per_minute: int = 180):
    """Decorator to rate-limit API calls."""
    min_interval = 60.0 / max_per_minute
    last_called = [0.0]

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            elapsed = time.time() - last_called[0]
            if elapsed < min_interval:
                time.sleep(min_interval - elapsed)
            result = func(*args, **kwargs)
            last_called[0] = time.time()
            return result
        return wrapper
    return decorator
```

### Pre-Trade Checks

Always validate before submitting:

```python
def pre_trade_checks(
    trading_client: TradingClient,
    symbol: str,
    qty: float,
    direction: str,
    current_price: float
) -> tuple[bool, str]:
    """Returns (ok, reason). Check before submitting any order."""

    # 1. Is market open?
    clock = trading_client.get_clock()
    if not clock.is_open:
        return False, f"Market is closed. Next open: {clock.next_open}"

    # 2. Is asset tradable?
    try:
        asset = trading_client.get_asset(symbol)
        if not asset.tradable:
            return False, f"{symbol} is not tradable on Alpaca"
    except Exception:
        return False, f"{symbol} not found"

    # 3. Sufficient buying power?
    account = trading_client.get_account()
    order_value = qty * current_price
    if float(account.buying_power) < order_value:
        return False, f"Insufficient buying power: need ${order_value:.2f}, have ${float(account.buying_power):.2f}"

    # 4. PDT check (< $25k equity + 3 day trades already used)
    if (float(account.equity) < 25000 and
        account.daytrade_count >= 3 and
        direction == "BUY"):
        return False, f"PDT restriction: {account.daytrade_count} day trades used, equity ${float(account.equity):.2f}"

    return True, "OK"
```

---

## Agent Tool Functions Ñ Ready to Use

Pre-built tool functions for your agent nodes. Drop these directly into your system.

```python
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import (
    MarketOrderRequest, LimitOrderRequest, GetOrdersRequest,
    ClosePositionRequest, GetPortfolioHistoryRequest
)
from alpaca.trading.enums import OrderSide, TimeInForce, OrderClass, QueryOrderStatus
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockSnapshotRequest, StockBarsRequest
from alpaca.data.timeframe import TimeFrame
from datetime import datetime, timedelta
import os

# Initialize clients once
trading_client = TradingClient(
    os.environ["ALPACA_API_KEY"],
    os.environ["ALPACA_SECRET_KEY"],
    paper=True
)
data_client = StockHistoricalDataClient(
    os.environ["ALPACA_API_KEY"],
    os.environ["ALPACA_SECRET_KEY"]
)


# ?? MARKET DATA TOOLS ????????????????????????????????????????????????????????

def get_current_price(ticker: str) -> dict:
    """
    Get current price, bid/ask, and today's range for a ticker.
    Use before any trade to check current market conditions.
    """
    try:
        req = StockSnapshotRequest(symbol_or_symbols=ticker)
        snap = data_client.get_stock_snapshot(req)[ticker]
        return {
            "ticker": ticker,
            "price": float(snap.latest_trade.price),
            "bid": float(snap.latest_quote.bid_price),
            "ask": float(snap.latest_quote.ask_price),
            "spread": round(float(snap.latest_quote.ask_price) - float(snap.latest_quote.bid_price), 4),
            "day_open": float(snap.daily_bar.open),
            "day_high": float(snap.daily_bar.high),
            "day_low": float(snap.daily_bar.low),
            "day_vwap": float(snap.daily_bar.vwap),
            "day_volume": int(snap.daily_bar.volume),
            "prev_close": float(snap.prev_daily_bar.close),
            "change_pct": round((float(snap.latest_trade.price) - float(snap.prev_daily_bar.close)) / float(snap.prev_daily_bar.close) * 100, 2)
        }
    except Exception as e:
        return {"error": f"Could not fetch price for {ticker}: {str(e)}"}


def get_price_history(ticker: str, days: int = 30, timeframe: str = "1D") -> list[dict]:
    """
    Get OHLCV bar history for a ticker.
    Use for trend analysis, support/resistance, and context before trading.

    Args:
        ticker: Stock symbol e.g. 'PLTR'
        days: How many days of history (1-365)
        timeframe: Bar size Ñ '1D' daily, '1H' hourly, '15Min', '5Min', '1Min'
    """
    tf_map = {
        "1D": TimeFrame.Day, "1H": TimeFrame.Hour,
        "15Min": TimeFrame(15, "Minute"), "5Min": TimeFrame(5, "Minute"),
        "1Min": TimeFrame.Minute
    }
    tf = tf_map.get(timeframe, TimeFrame.Day)

    try:
        req = StockBarsRequest(
            symbol_or_symbols=ticker,
            timeframe=tf,
            start=datetime.now() - timedelta(days=days),
            adjustment="all"
        )
        bars = data_client.get_stock_bars(req)[ticker]
        return [
            {"date": b.timestamp.isoformat(), "open": float(b.open),
             "high": float(b.high), "low": float(b.low),
             "close": float(b.close), "volume": int(b.volume)}
            for b in bars
        ]
    except Exception as e:
        return [{"error": str(e)}]


# ?? ACCOUNT TOOLS ????????????????????????????????????????????????????????????

def get_account_summary() -> dict:
    """
    Get current account state Ñ buying power, equity, P&L, day trade count.
    Check this before deciding on position size.
    """
    try:
        acct = trading_client.get_account()
        return {
            "portfolio_value": float(acct.portfolio_value),
            "cash": float(acct.cash),
            "buying_power": float(acct.buying_power),
            "unrealized_pl": float(acct.unrealized_pl),
            "daytrade_count": acct.daytrade_count,
            "pattern_day_trader": acct.pattern_day_trader,
            "status": acct.status.value
        }
    except Exception as e:
        return {"error": str(e)}


def is_market_open() -> dict:
    """
    Check if the market is currently open. Always call before placing orders.
    """
    try:
        clock = trading_client.get_clock()
        return {
            "is_open": clock.is_open,
            "current_time": clock.timestamp.isoformat(),
            "next_open": clock.next_open.isoformat(),
            "next_close": clock.next_close.isoformat()
        }
    except Exception as e:
        return {"error": str(e)}


# ?? POSITION TOOLS ???????????????????????????????????????????????????????????

def get_positions() -> list[dict]:
    """
    Get all current open positions with P&L.
    Use to check existing exposure before adding new positions.
    """
    try:
        positions = trading_client.get_all_positions()
        return [
            {
                "ticker": p.symbol,
                "qty": float(p.qty),
                "side": p.side.value,
                "avg_entry_price": float(p.avg_entry_price),
                "current_price": float(p.current_price),
                "market_value": float(p.market_value),
                "unrealized_pl": float(p.unrealized_pl),
                "unrealized_pl_pct": round(float(p.unrealized_plpc) * 100, 2),
                "today_pl": float(p.unrealized_intraday_pl),
            }
            for p in positions
        ]
    except Exception as e:
        return [{"error": str(e)}]


def get_position(ticker: str) -> dict | None:
    """
    Get current position for a specific ticker.
    Returns None if no position held.
    """
    try:
        p = trading_client.get_open_position(ticker)
        return {
            "ticker": p.symbol,
            "qty": float(p.qty),
            "side": p.side.value,
            "avg_entry_price": float(p.avg_entry_price),
            "current_price": float(p.current_price),
            "unrealized_pl": float(p.unrealized_pl),
            "unrealized_pl_pct": round(float(p.unrealized_plpc) * 100, 2),
        }
    except Exception:
        return None  # No position held


# ?? ORDER TOOLS ??????????????????????????????????????????????????????????????

def place_market_order(
    ticker: str,
    qty: float,
    direction: str,  # "BUY" or "SELL"
    take_profit_pct: float | None = None,
    stop_loss_pct: float | None = None,
) -> dict:
    """
    Place a market order, optionally with bracket (take profit + stop loss).
    Use this for trade execution after debate reaches a decision.

    Args:
        ticker: Stock symbol e.g. 'PLTR'
        qty: Number of shares (can be fractional e.g. 2.5)
        direction: 'BUY' or 'SELL'
        take_profit_pct: Optional take profit as decimal e.g. 0.10 = 10%
        stop_loss_pct: Optional stop loss as decimal e.g. 0.05 = 5%
    """
    # Pre-trade checks
    market = is_market_open()
    if not market.get("is_open"):
        return {"error": f"Market is closed. Next open: {market.get('next_open')}"}

    price_data = get_current_price(ticker)
    if "error" in price_data:
        return price_data

    current_price = price_data["price"]
    account = get_account_summary()
    order_value = qty * current_price

    if account["buying_power"] < order_value and direction == "BUY":
        return {"error": f"Insufficient buying power: need ${order_value:.2f}, have ${account['buying_power']:.2f}"}

    try:
        side = OrderSide.BUY if direction.upper() == "BUY" else OrderSide.SELL

        # Build order request
        if take_profit_pct and stop_loss_pct:
            # Bracket order with risk management
            tp_price = round(current_price * (1 + take_profit_pct), 2)
            sl_price = round(current_price * (1 - stop_loss_pct), 2)

            order_req = MarketOrderRequest(
                symbol=ticker,
                qty=qty,
                side=side,
                time_in_force=TimeInForce.DAY,
                order_class=OrderClass.BRACKET,
                take_profit=TakeProfitRequest(limit_price=tp_price),
                stop_loss=StopLossRequest(stop_price=sl_price)
            )
        else:
            order_req = MarketOrderRequest(
                symbol=ticker,
                qty=qty,
                side=side,
                time_in_force=TimeInForce.DAY
            )

        order = trading_client.submit_order(order_req)

        return {
            "success": True,
            "order_id": str(order.id),
            "ticker": ticker,
            "direction": direction,
            "qty": qty,
            "estimated_value": round(order_value, 2),
            "status": order.status.value,
            "take_profit_price": tp_price if take_profit_pct else None,
            "stop_loss_price": sl_price if stop_loss_pct else None,
        }

    except Exception as e:
        return {"error": f"Order failed: {str(e)}"}


def place_limit_order(
    ticker: str,
    qty: float,
    direction: str,
    limit_price: float,
    take_profit_price: float | None = None,
    stop_loss_price: float | None = None,
) -> dict:
    """
    Place a limit order, optionally with bracket orders.
    Use when you want price control rather than immediate execution.
    """
    try:
        side = OrderSide.BUY if direction.upper() == "BUY" else OrderSide.SELL

        kwargs = dict(
            symbol=ticker,
            qty=qty,
            side=side,
            time_in_force=TimeInForce.GTC,
            limit_price=limit_price,
        )

        if take_profit_price and stop_loss_price:
            kwargs["order_class"] = OrderClass.BRACKET
            kwargs["take_profit"] = TakeProfitRequest(limit_price=take_profit_price)
            kwargs["stop_loss"] = StopLossRequest(stop_price=stop_loss_price)

        order = trading_client.submit_order(LimitOrderRequest(**kwargs))
        return {
            "success": True,
            "order_id": str(order.id),
            "ticker": ticker,
            "direction": direction,
            "qty": qty,
            "limit_price": limit_price,
            "status": order.status.value,
        }
    except Exception as e:
        return {"error": f"Limit order failed: {str(e)}"}


def close_position(ticker: str, percentage: float = 100.0) -> dict:
    """
    Close a position fully or partially.

    Args:
        ticker: Stock symbol
        percentage: Percentage to close (1-100). Default 100 = full close.
    """
    try:
        if percentage == 100.0:
            result = trading_client.close_position(ticker)
        else:
            result = trading_client.close_position(
                ticker,
                close_options=ClosePositionRequest(percentage=str(int(percentage)))
            )
        return {
            "success": True,
            "ticker": ticker,
            "percentage_closed": percentage,
            "order_id": str(result.id) if hasattr(result, "id") else None,
        }
    except Exception as e:
        return {"error": f"Could not close {ticker}: {str(e)}"}


def cancel_all_orders() -> dict:
    """Cancel all open orders."""
    try:
        results = trading_client.cancel_orders()
        return {
            "success": True,
            "cancelled_count": len(results)
        }
    except Exception as e:
        return {"error": str(e)}


def get_open_orders(ticker: str | None = None) -> list[dict]:
    """
    Get all open orders, optionally filtered by ticker.
    """
    try:
        params = GetOrdersRequest(status=QueryOrderStatus.OPEN)
        if ticker:
            params = GetOrdersRequest(status=QueryOrderStatus.OPEN, symbols=[ticker])
        orders = trading_client.get_orders(filter=params)
        return [
            {
                "order_id": str(o.id),
                "ticker": o.symbol,
                "side": o.side.value,
                "type": o.type.value,
                "qty": float(o.qty) if o.qty else None,
                "limit_price": float(o.limit_price) if o.limit_price else None,
                "stop_price": float(o.stop_price) if o.stop_price else None,
                "status": o.status.value,
                "created_at": o.created_at.isoformat(),
            }
            for o in orders
        ]
    except Exception as e:
        return [{"error": str(e)}]
```

---

## Quick Reference Card

```python
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest, LimitOrderRequest, GetOrdersRequest
from alpaca.trading.enums import OrderSide, TimeInForce, OrderClass, QueryOrderStatus
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockSnapshotRequest, StockBarsRequest
from alpaca.data.timeframe import TimeFrame

# ?? SETUP ?????????????????????????????????????????????????????????????????????
tc = TradingClient("key", "secret", paper=True)
dc = StockHistoricalDataClient("key", "secret")

# ?? ACCOUNT ???????????????????????????????????????????????????????????????????
account = tc.get_account()
clock   = tc.get_clock()

# ?? MARKET DATA ???????????????????????????????????????????????????????????????
snap = dc.get_stock_snapshot(StockSnapshotRequest(symbol_or_symbols="PLTR"))["PLTR"]
bars = dc.get_stock_bars(StockBarsRequest(symbol_or_symbols="PLTR", timeframe=TimeFrame.Day, start=...))["PLTR"]

# ?? ORDERS ????????????????????????????????????????????????????????????????????
tc.submit_order(MarketOrderRequest(symbol="PLTR", qty=10, side=OrderSide.BUY, time_in_force=TimeInForce.DAY))
tc.submit_order(LimitOrderRequest(symbol="PLTR", qty=10, limit_price=87.00, side=OrderSide.BUY, time_in_force=TimeInForce.GTC))
tc.cancel_orders()                          # cancel all open
tc.get_orders(filter=GetOrdersRequest(status=QueryOrderStatus.OPEN))

# ?? POSITIONS ?????????????????????????????????????????????????????????????????
tc.get_all_positions()
tc.get_open_position("PLTR")
tc.close_position("PLTR")
tc.close_all_positions(cancel_orders=True)

# ?? PAPER ENDPOINTS ???????????????????????????????????????????????????????????
# Trading:    paper=True on TradingClient
# Data:       same endpoints, same clients Ñ no paper/live difference
# Dashboard:  https://app.alpaca.markets ? select Paper account top-left
```

---

## Migration Path: Paper ? Live

When you're ready to go live:

1. Create a live account at [app.alpaca.markets](https://app.alpaca.markets) and fund it
2. Generate **live** API keys (separate from paper keys)
3. Change one line: `paper=True` ? `paper=False`
4. Swap environment variables to live keys
5. Start with small position sizes Ñ 1-2 shares Ñ until execution is confirmed

Everything else Ñ order types, SDK calls, streaming, webhooks Ñ is identical between paper and live.

---

*SDK: `pip install alpaca-py` | Docs: `docs.alpaca.markets` | Dashboard: `app.alpaca.markets`*