# CAST — Database Schema Proposal (PostgreSQL)

Предложение схемы для Phase 2+. ORM: Prisma или Drizzle (решение отложено до Phase 1/2 — оба удовлетворяют требованиям; склоняюсь к **Drizzle** за лёгкость и SQL-first, Prisma — если захотим миграции из коробки без ручной работы).

Все денежные значения SOL — `NUMERIC(20, 9)` (lamports-точность), токен-amounts — `NUMERIC(38, 9)` или `TEXT` (raw bigint). Никаких `FLOAT` для денег.

## tokens

Кэш/справочник нормализованных токенов (результат ingestion).

| Колонка | Тип | Примечание |
|---|---|---|
| mint | TEXT PK | Solana mint address, verified |
| symbol | TEXT | sanitized |
| name | TEXT | sanitized |
| image_url | TEXT NULL | sanitized/validated URL |
| decimals | SMALLINT | |
| price_usd / price_sol | NUMERIC(20,9) NULL | последняя известная |
| market_cap | NUMERIC(24,4) NULL | |
| volume_24h | NUMERIC(24,4) NULL | |
| liquidity | NUMERIC(24,4) NULL | |
| price_change_1h / 24h | NUMERIC(12,4) NULL | momentum |
| created_chain_at | TIMESTAMPTZ NULL | token age |
| status | TEXT | `ACTIVE / GRADUATING / GRADUATED / DEAD` |
| graduation_progress | NUMERIC(5,2) NULL | 0–100 |
| source | TEXT | `stonkfun`, `dexscreener`, … |
| eligible | BOOLEAN | вердикт eligibility engine |
| risk_score | SMALLINT | 0–100 |
| risk_reasons | JSONB | `string[]` |
| eligibility_checked_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Индексы: `(eligible, risk_score)`, `(volume_24h DESC)`, `(market_cap DESC)`, `(created_chain_at)`, `(graduation_progress)` — под пулы Discover.

## catches

| Колонка | Тип | Примечание |
|---|---|---|
| id | UUID PK | |
| public_id | BIGINT GENERATED ALWAYS AS IDENTITY | для shareable URL (`/catch/1842`), Phase 13 |
| wallet_address | TEXT | владелец (non-custodial, только публичный ключ) |
| created_at | TIMESTAMPTZ | |
| closed_at | TIMESTAMPTZ NULL | |
| initial_value_sol | NUMERIC(20,9) | |
| current_value_sol | NUMERIC(20,9) | |
| realized_value_sol | NUMERIC(20,9) DEFAULT 0 | |
| status | TEXT | `ACTIVE / PARTIALLY_FILLED / CLOSING / CLOSED / FAILED` |
| random_seed | TEXT | deterministic replay / provably fair |
| risk_mode | TEXT | `SURFACE / DEEP_SEA / ABYSS / FRESH_WATER / GRADUATION_HUNT / VOLUME_HUNT / CHAOS` |
| idempotency_key | TEXT UNIQUE | replay protection |
| execution_state | TEXT | состояние ExecutionService (см. data-flow) |

Индекс: `(wallet_address, created_at DESC)`.

## positions

| Колонка | Тип | Примечание |
|---|---|---|
| id | UUID PK | |
| catch_id | UUID FK → catches(id) ON DELETE CASCADE | |
| token_mint | TEXT FK → tokens(mint) | |
| symbol | TEXT | денормализовано для быстрого рендера |
| allocation_sol | NUMERIC(20,9) | плановая сумма |
| token_amount | NUMERIC(38,9) NULL | фактически куплено |
| entry_price | NUMERIC(24,12) NULL | |
| current_price | NUMERIC(24,12) NULL | |
| entry_value_sol | NUMERIC(20,9) NULL | |
| current_value_sol | NUMERIC(20,9) NULL | |
| realized_pnl_sol | NUMERIC(20,9) DEFAULT 0 | |
| unrealized_pnl_sol | NUMERIC(20,9) DEFAULT 0 | |
| status | TEXT | `PENDING / FILLED / FAILED / SELLING / SOLD` |
| buy_tx | TEXT NULL | signature |
| sell_tx | TEXT NULL | signature |

Индексы: `(catch_id)`, `(token_mint)` (для price update service).

## execution_events

Append-only журнал переходов ExecutionService (audit + debugging + recovery после сбоя).

| Колонка | Тип | Примечание |
|---|---|---|
| id | BIGSERIAL PK | |
| catch_id | UUID FK | |
| position_id | UUID NULL | NULL = событие уровня Catch |
| from_state / to_state | TEXT | |
| reason | TEXT NULL | |
| tx_signature | TEXT NULL | |
| payload | JSONB NULL | quote, error details (без чувствительных данных) |
| created_at | TIMESTAMPTZ | |

Индекс: `(catch_id, id)`.

## price_snapshots (опционально, Phase 10+)

История цен для графиков и peak value.

| Колонка | Тип |
|---|---|
| token_mint | TEXT |
| ts | TIMESTAMPTZ |
| price_sol | NUMERIC(24,12) |

PK `(token_mint, ts)`, retention policy (например 30 дней, агрегация в hourly).

## Замечания

- `wallet_address` — не auth-идентификатор сам по себе: доступ к mutating endpoints требует подписанного сообщения (sign-in with wallet), иначе любой сможет чужой `wallet_address` подставить. Auth-схема уточняется в Phase 5.
- Historical PnL после CLOSED не пересчитывается — фиксируется в `catches` + `positions.realized_pnl_sol`.
- Redis — только hot cache (pools, quotes TTL, pub/sub); источник правды — PostgreSQL.
