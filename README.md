# CAST

**CAST** — игровой интерфейс для массовой покупки небольших позиций в токенах экосистемы Solana.

Пользователь не выбирает один токен. Он задаёт сумму SOL, нажимает **CAST** — приложение случайно выбирает несколько токенов из отфильтрованного пула и распределяет между ними сумму. Совокупность позиций называется **Catch** (Улов).

Главный экран — **Ocean**: интерактивная визуализация рынка (radar / sonar / bubble map), где каждый объект — реальный токен.

> Не "DEX с кнопкой random", а **visual market exploration product**:
> SEE MARKET → CAST → DISCOVER CATCH → WATCH → PULL OUT.

## Статус

**PHASE 0 — Architecture** (текущий). Только документация и контракты (TypeScript interfaces). Никакой торговли, wallet integration и blockchain-транзакций.

Дорожная карта по фазам — в [docs/architecture.md](docs/architecture.md#9-фазы-разработки).

## Структура репозитория

```
cast/
├── README.md
├── docs/
│   ├── architecture.md        # архитектура, модули, принципы, фазы
│   ├── data-flow.md           # потоки данных: ingestion → ocean, cast → execution
│   └── database-schema.md     # предлагаемая схема PostgreSQL
├── src/
│   └── types/                 # контракты Phase 0 (domain model + ports)
│       ├── domain.ts          # Token, Catch, Position, enums
│       ├── ports.ts           # TokenDataProvider, SwapProvider, ExecutionService, ...
│       └── index.ts
├── .env.example               # список переменных окружения
├── package.json
└── tsconfig.json
```

Целевая структура `src/` (Phase 1+) — в [docs/architecture.md](docs/architecture.md#3-структура-проекта).

## Стек (целевой)

| Слой | Технология |
|---|---|
| Frontend | Next.js, React, TypeScript (strict), Tailwind, shadcn/ui, Zustand, TanStack Query |
| Backend | Next.js API routes (вынесение в отдельный Node-сервис — по мере роста) |
| DB | PostgreSQL + Prisma/Drizzle |
| Cache | Redis |
| Market data | StonkFun (первый), далее Jupiter / DexScreener / Birdeye / Helius — через adapter |
| Swap | Jupiter (через `SwapProvider` abstraction) |
| Wallet | Solana Wallet Adapter / Wallet Standard (non-custodial) |
| Validation | Zod |
| Tests | Vitest, Playwright |
| Infra | Docker, docker-compose (dev) |

## Проверка контрактов Phase 0

```bash
npm install
npm run typecheck   # tsc --noEmit — все интерфейсы должны компилироваться
```

## Ключевые принципы

1. **Non-custodial.** Приватные ключи никогда не покидают кошелёк пользователя. Все транзакции подписывает пользователь, перед подписью показывается точный intent (сумма, комиссии, slippage).
2. **UI отделён от бизнес-логики.** Randomizer, pricing, swaps, blockchain, db — независимые модули за интерфейсами (`src/types/ports.ts`).
3. **Ни один токен не попадает в Fishing Pool без Filtering Engine** (`TokenEligibilityService`).
4. **CAST исполняется через state machine** (`ExecutionService`), а не "10 swap-транзакций разом". Partial fill — норма, не сбой.
5. **Deterministic randomizer**: каждый Catch хранит `randomSeed` → reproducible / provably fair.
6. **Финансовые вычисления — только на backend.** Frontend не считает PnL.
7. **Progressive enhancement**: сначала Canvas, потом PixiJS/Three.js; сначала devnet/mock, mainnet — только после PHASE 7.
