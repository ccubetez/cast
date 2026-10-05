# CAST — Architecture

## 1. Обзор

CAST состоит из четырёх логических слоёв:

```
┌─────────────────────────────────────────────────────────┐
│  PRESENTATION (Next.js App Router)                      │
│  Ocean / Catches / Catch Detail / Discover / Profile    │
│  Zustand (UI state) · TanStack Query (server state)     │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP / fetch (typed API client)
┌──────────────────────▼──────────────────────────────────┐
│  APPLICATION (Next.js API routes / future Node service) │
│  features: trading · ocean · discover · profile         │
│  services: randomizer · eligibility · execution · pnl   │
└──────┬───────────────┬───────────────┬──────────────────┘
       │               │               │
┌──────▼─────┐  ┌──────▼──────┐  ┌─────▼───────┐
│ PROVIDERS  │  │ PERSISTENCE │  │  BLOCKCHAIN │
│ StonkFun   │  │ PostgreSQL  │  │ Solana RPC  │
│ Jupiter    │  │ Redis cache │  │ Jupiter API │
│ DexScreener│  │             │  │ Wallet Std  │
│ (adapters) │  │             │  │             │
└────────────┘  └─────────────┘  └─────────────┘
```

Правило зависимостей: **presentation → application → ports → providers**. Бизнес-логика знает только интерфейсы из `src/types/ports.ts`, конкретные реализации (StonkFun, Jupiter) подставляются через composition root.

## 2. Ключевые модули и контракты

Все контракты определены в `src/types/`:

| Контракт | Файл | Назначение |
|---|---|---|
| `Token`, `TokenStatus`, `RiskTier` | `domain.ts` | нормализованная модель токена (единая для всех источников) |
| `Catch`, `Position`, `CatchStatus` | `domain.ts` | корзина позиций и её жизненный цикл |
| `TokenDataProvider` | `ports.ts` | discovery/metadata: StonkFun → далее DexScreener, Birdeye… |
| `PriceProvider` | `ports.ts` | цены для PnL engine |
| `TokenEligibilityService` | `ports.ts` | Filtering Engine: `eligible / riskScore / reasons[]` |
| `CatchRandomizer` | `ports.ts` | выбор N токенов + распределение SOL, deterministic по seed |
| `SwapProvider` | `ports.ts` | Jupiter: quote / build tx / price impact / execute |
| `ExecutionService` | `ports.ts` | state machine исполнения CAST / PULL OUT |
| `CatchRepository` | `ports.ts` | персистентность Catch/Position |
| `WalletAdapter` | `ports.ts` | абстракция над Wallet Standard (Phantom/Backpack/Solflare) |

### 2.1 TokenDataProvider (adapter pattern)

Каждый источник данных — отдельный адаптер, реализующий `TokenDataProvider` и возвращающий нормализованный `Token`. Ingestion-слой объединяет адаптеры, дедуплицирует по `mint` и пишет в cache/DB. **Бизнес-логика никогда не импортирует StonkFun напрямую.**

### 2.2 TokenEligibilityService (Filtering Engine)

Единственные ворота в Fishing Pool. Проверки (по мере доступности данных): min liquidity, min volume, token age, mint/freeze authority, holder concentration, suspicious flags, активный рынок, валидный mint, наличие swap route, price impact, возможность продажи. Результат: `{ eligible, riskScore: 0–100, reasons[] }`. Токен без вердикта = не eligible (fail-closed).

### 2.3 CatchRandomizer

Вход: eligible pool + total SOL + constraints (`count`, `minAllocation`, `maxAllocation`) + `seed`. Выход: N уникальных токенов и веса, сумма которых **точно** равна total. Один и тот же seed → один и тот же Catch (provably fair). Алгоритм: seeded PRNG → weighted shuffle → random weights с clamp в [min, max] → нормализация с коррекцией остатка на последнюю позицию. Unit-тесты обязательны (сумма, уникальность, min/max, детерминизм).

### 2.4 ExecutionService (state machine)

```
CREATED → PREPARING → QUOTING → WAITING_FOR_SIGNATURE
        → EXECUTING → COMPLETED
                    ↘ PARTIALLY_FILLED ↗
                    ↘ FAILED
```

- Транзакции исполняются **последовательно** (или мелкими батчами), никогда "20 разом".
- Route отсутствует / price impact выше порога → токен исключается, allocation перераспределяется, событие логируется, Catch не ломается → `PARTIALLY_FILLED`.
- Каждый переход состояния — structured log + запись в БД (защита от double execution: idempotency key на CAST).
- Отдельный flow для PULL OUT: single token / winners / losers / entire Catch.

### 2.5 Wallet

Non-custodial. `WalletAdapter` — тонкая абстракция над Solana Wallet Standard: `connect / disconnect / getBalance / signTransaction`. Поддержка Phantom, Backpack, Solflare. Разработка: devnet/mock wallet → mainnet только после PHASE 7.

## 3. Структура проекта (целевая, Phase 1+)

```
src/
├── app/                    # Next.js App Router: routes + API
│   ├── (app)/
│   │   ├── page.tsx        # Ocean (главный экран)
│   │   ├── catches/
│   │   ├── catches/[id]/
│   │   ├── discover/
│   │   └── profile/
│   └── api/
│       ├── tokens/         # ocean feed (из cache, не из StonkFun напрямую)
│       ├── catches/        # CRUD + cast/pull-out endpoints
│       └── quotes/         # Jupiter quote proxy
├── components/             # generic UI (shadcn-based)
├── features/
│   ├── ocean/              # визуализация (Canvas → PixiJS), bubble mapping
│   ├── catches/            # список, detail, bubble layout
│   ├── discover/           # режимы: SURFACE / DEEP SEA / ABYSS / ...
│   ├── wallet/             # connect button, balance, wallet store
│   └── trading/            # CAST controls, execution progress UI
├── services/               # бизнес-логика (framework-agnostic)
│   ├── token-data/         # ingestion, нормализация, кеширование
│   │   └── providers/      # stonksfun.ts, dexscreener.ts, ... (adapters)
│   ├── risk/               # TokenEligibilityService impl
│   ├── randomizer/         # CatchRandomizer impl + seeded PRNG
│   ├── pricing/            # PriceProvider impl, PnL engine
│   ├── swap/               # SwapProvider impl (jupiter.ts)
│   └── execution/          # ExecutionService impl (state machine)
├── lib/                    # db client, redis, logger, zod schemas, utils
├── db/                     # prisma/drizzle schema + migrations
└── types/                  # domain.ts + ports.ts (уже созданы, Phase 0)
```

## 4. Пулы Discover

Режимы реализуются как **пресеты фильтров поверх eligible pool**, а не отдельные источники данных:

| Режим | Критерии (ориентир) |
|---|---|
| SURFACE | высокая ликвидность, крупный mcap, LOW risk |
| DEEP SEA | small caps, MEDIUM risk |
| ABYSS | EXTREME risk, минимальные фильтры (только hard-fail проверки) |
| FRESH WATER | возраст < N часов |
| GRADUATION HUNT | graduationProgress > порога |
| VOLUME HUNT | аномально высокий volume24h |
| CHAOS | random sample из всего eligible pool |

## 5. Безопасность (архитектурные требования)

- Никогда не хранить seed/private key; подпись — только в кошельке.
- Zod-валидация всех API input; rate limiting на endpoints.
- Санитизация token metadata (image URL, name, symbol) перед рендером — защита от XSS/injection через вредоносные токены.
- Перед подписью показывать точный intent: сумма, сеть, estimated network/swap fees, max slippage, estimated total.
- Simulation транзакции перед отправкой; верификация mint-адресов.
- Лимит максимальной суммы CAST (env `MAX_CAST_SOL`).
- Idempotency keys на CAST / PULL OUT — защита от replay/double execution.
- Structured logs для всех blockchain operations (без чувствительных данных).

## 6. Визуальная логика Ocean

Маппинг данных в визуал (нормализация в [0..1] на backend или в feature-слое):

| Параметр bubble | Источник |
|---|---|
| radius | `marketCap` (log-scale) |
| movement speed | `volume24h` |
| glow | price momentum (1h/24h change) |
| opacity | liquidity confidence |
| color | green/red по price change; Solana green/purple — акценты |
| pulse / halo | risk tier (irregular pulse для рискованных, без агрессивного мигания) |

Progressive disclosure: bubble+PnL → hover tooltip → detail panel → full analytics. Движение медленное, физика не хаотичная. Canvas на Phase 1, PixiJS/Three.js — на Phase 12.

## 7. Нефункциональные требования

- TypeScript `strict`, без `any` в бизнес-логике.
- Тесты: Vitest для randomizer / eligibility / PnL (critical logic), Playwright для UX-флоу.
- Ocean: 100–300 объектов на Phase 1 (mock), до ~1000 на реальных данных — рендер через Canvas, не DOM.
- Ingestion: polling StonkFun по расписанию (cron/interval), TTL в Redis; frontend читает только свой backend.

## 8. Переменные окружения

См. `.env.example`. Принципы: секреты только в server-side env (`*_KEY`, `*_URL` без `NEXT_PUBLIC_`), публичное — через `NEXT_PUBLIC_`.

## 9. Фазы разработки

| Phase | Содержание | Критерий выхода |
|---|---|---|
| **0** | Architecture (этот документ + `src/types/`) | `npm run typecheck` зелёный |
| 1 | Mock UI prototype: Ocean, CAST controls, Catches, Discover, Profile; 100–300 mock tokens; fake prices real-time | UX проверен руками |
| 2 | StonkFun provider + ingestion + cache; реальные токены в Ocean; CAST всё ещё simulation | Ocean на живых данных |
| 3 | Eligibility engine, risk tiers, пулы Discover | Фильтры работают на реальных данных |
| 4 | Deterministic CatchRandomizer + unit-тесты | Сумма/уникальность/min-max/seed — зелёные тесты |
| 5 | Wallet connect (devnet): connect/disconnect/balance/signature | Подпись в devnet |
| 6 | Jupiter quotes (без исполнения); исключение токенов без route | Quote panel на реальных routes |
| 7 | Simulated execution: полный флоу CAST→fake fill→PnL→sell sim; failure scenarios | Все failure paths покрыты |
| 8 | Mainnet single swap (1 токен, 0.01 SOL) | Успешный реальный swap |
| 9 | Multi-token CAST: 3 → 5 → 10 токенов | Reliability достаточна для 10 |
| 10 | PnL engine на backend | PnL считается сервером |
| 11 | PULL OUT: single / winners / losers / all + progress UI | Catch → CLOSED с historical PnL |
| 12 | Advanced Ocean: zoom, clusters, sectors, reveal animation | Usability не пострадал |
| 13 | Social: shareable Catch pages, leaderboards | Публичная страница Catch |
| 14 | Automation (TP/SL/timed) — только после отдельного security/legal анализа | Отдельное решение |

Переход к следующей фазе — только после верификации текущей и явного подтверждения.
