# CAST — Data Flow

## 1. Market data ingestion (Phase 2+)

```
┌──────────┐   poll (interval, e.g. 30–60s)   ┌────────────────────┐
│ StonkFun │ ───────────────────────────────► │ Ingestion service  │
│   API    │                                  │ (TokenDataProvider │
└──────────┘                                  │  adapter)          │
┌──────────┐                                  └─────────┬──────────┘
│ (future) │ ───────────────────────────────►           │ normalize
│ DexScreener│                                           ▼
│ Birdeye… │                                    ┌────────────────┐
└──────────┘                                    │ Normalizer     │
                                                │ → Token{}      │
                                                │ dedupe by mint │
                                                └───────┬────────┘
                                          ┌─────────────┼─────────────┐
                                          ▼             ▼             ▼
                                    ┌──────────┐  ┌──────────┐  ┌──────────┐
                                    │ Redis    │  │ Postgres │  │ Eligibility│
                                    │ hot cache│  │ metadata │  │ engine     │
                                    └────┬─────┘  └──────────┘  │ (risk score│
                                         │                      │  persist)  │
                                         ▼                      └──────────┘
                                   GET /api/tokens
                                         │
                                         ▼
                                    Frontend Ocean
```

Правила:
- Frontend **никогда** не ходит во внешние API напрямую.
- Ocean читает только свой backend (`/api/tokens`), backend — только cache.
- Eligibility считается на ingestion (или лениво с кешем), результат хранится вместе с токеном.

## 2. Ocean feed

```
GET /api/tokens?mode=SURFACE|DEEP_SEA|...&limit=300
  → Redis (hot pool per mode)  ──miss──►  Postgres + filter → warm cache
  → Token[] (нормализованные, с визуальными полями: normalizedRadius, momentum, ...)
```

Визуальные параметры (radius/glow/opacity) либо приходят с backend уже нормализованными, либо нормализуются в `features/ocean/` — но **никогда** не считаются в компонентах рендера напрямую из сырых данных.

## 3. CAST flow (simulation, Phase 1–7)

```
User: CAST SIZE [1 SOL] + CATCH SIZE [8] + mode [DEEP SEA]
        │  POST /api/catches/cast  { amountSol, count, mode, idempotencyKey }
        ▼
┌─────────────────────┐
│ 1. Load eligible pool│  (Redis, pre-filtered by mode)
│ 2. CatchRandomizer   │  seed = crypto random (или user seed)
│    → 8 tokens +      │  allocations, sum === amountSol
│      allocations     │
│ 3. (Phase 6+)        │  Jupiter quote per token
│    SwapProvider.     │  no route / high impact → exclude,
│    getQuote()        │  redistribute
│ 4. Persist Catch     │  status=ACTIVE (sim) или CREATED (exec)
│    + Positions       │  randomSeed сохранён
└─────────┬───────────┘
          ▼
   Catch Detail (bubble layout)
          │  price updates (PriceProvider, poll/websocket)
          ▼
   PnL пересчитывается на backend → frontend только отображает
```

## 4. CAST flow (real execution, Phase 8+)

```
POST /api/catches/cast
  → ExecutionService.create()        state: CREATED, idempotency check
  → PREPARING:  randomizer → allocations
  → QUOTING:    Jupiter quotes, exclusion + redistribution
  → build transactions (backend), return to client
  → WAITING_FOR_SIGNATURE:  wallet подписывает (точный intent на экране)
  → EXECUTING:  send sequentially, confirm each
       ├─ tx ok      → Position.status = FILLED (buyTx записан)
       ├─ tx fail    → Position.status = FAILED, allocation lost or
       │               redistributed (policy), событие залогировано
       ▼
  → COMPLETED | PARTIALLY_FILLED | FAILED
```

## 5. PULL OUT flow

```
POST /api/catches/:id/pull-out  { scope: TOKEN|WINNERS|LOSERS|ALL, tokenMint? }
  → фильтр позиций по scope
  → тот же ExecutionService state machine (sell direction)
  → Position.status = SOLD, sellTx, realizedPnL
  → все позиции проданы → Catch.status = CLOSED, historical PnL зафиксирован
```

## 6. Price / PnL updates (Phase 10)

```
Price update service (backend, interval):
  open Catches → distinct tokenMints
  → PriceProvider.getPrices(mints)  (Jupiter price API / indexed swaps)
  → update Position.currentPrice, currentValue, unrealizedPnL
  → update Catch.currentValueSol
  → publish (Redis pub/sub или poll от frontend)
```

Frontend получает готовые числа. Все финансовые вычисления — backend-only.

## 7. Failure & logging policy

- Каждый переход состояния ExecutionService — structured log: `{ catchId, positionId?, from, to, reason?, tx? }`.
- Ошибки внешних провайдеров классифицируются: retryable (rate limit, timeout) vs terminal (no route, invalid mint).
- Partial fill — штатный исход, отображается в UI как "6 of 8 tokens caught".
- Replay protection: `idempotencyKey` на mutating endpoints; повторный запрос с тем же ключом возвращает существующий Catch, не создаёт новый.
