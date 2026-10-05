# Alpha Release Readiness — план подготовки к закрытому альфа-тесту

Цель: 5–20 приглашённых тестеров, реальный mainnet, ограниченный доступ.
Принцип: закрыть блокеры, не строить production-инфраструктуру «на вырост».

---

## 0. Решение №1: топология деплоя (определяет половину списка)

Приложение хранит состояние в памяти процесса: ingestion/risk-кеши,
nonce Map, rate limits, snapshot tick. **Serverless (Vercel) это ломает** —
запросы одного пользователя попадают в разные инстансы.

| Вариант | Что менять | Оценка |
|---|---|---|
| **A. Long-running Node (рекомендую)** — Railway / Fly.io / VPS, `next start`, Postgres managed (Neon) | Почти ничего: архитектура in-memory остаётся валидной при одном инстансе. Docker-compose уже есть (postgres) — дописать app-сервис | 1–2 дня |
| B. Vercel + Upstash Redis | Переписать: ingestion-кеш, risk-кеш, nonces, rate limits → Redis; snapshot tick → Vercel Cron | 4–6 дней |

Решение: **вариант A** для альфы. Переезд на B — когда понадобится масштаб.

---

## 1. Блокеры (без них альфу не открываем)

### 1.1 Доступ по приглашению (wallet allowlist)
- Таблица `alpha_testers (wallet_address PK, invited_by, created_at, note)`.
- `/api/auth/session`: токен выдаётся только allowlisted кошелькам.
- Остальным — экран «alpha is invite-only» (красивый, с контактом для заявки).
- Admin-управление: на альфу достаточно SQL (`INSERT INTO alpha_testers ...`).
- **1 день.**

### 1.2 Next.js upgrade 14 → 16 + регресс
- ✅ **СДЕЛАНО 2026-10-05**: next 16.3.8 + react 19.3.0, build зелёный с
  первого раза, 33/33 тестов, auth e2e, живые ingestion/quotes. Critical
  advisory из npm audit устранена.

### 1.3 Terms of Service + risk disclosure
- Страница `/terms`: non-custodial, не advice, стоп-риски, «автоматических
  действий нет», возможна полная потеря средств, fees.
- Чекбокс принятия при первом VERIFY; факт принятия пишем в БД
  (`alpha_testers.terms_accepted_at`).
- **0.5–1 день** (текст + UI + миграция).

### 1.4 Security headers + HTTPS
- `next.config`: CSP (connect-src к нашим API + RPC), X-Frame-Options DENY,
  Referrer-Policy, nosniff.
- HTTPS из коробки у Railway/Fly.
- **0.5 дня.**

### 1.5 Kill switch + лимиты
- `TRADING_ENABLED=false` → все build/submit endpoints отвечают 503
  (мгновенная остановка торговли без редеплоя).
- Пересмотр капов на альфу: MAX_CAST_SOL=5 уже есть; multi 10×0.01 SOL
  оставить как есть (0.1 SOL ≈ $12 — разумный потолок на тест).
- Дневной лимит на кошелёк: ≤ 5 casts/день (защита и от флуда, и от
  «тестер проигрался»).
- **0.5 дня.**

### 1.6 Бэкапы и восстановление
- Managed Postgres (Neon) с point-in-time recovery — из коробки.
- Проверить restore один раз (процедура задокументирована).
- **0.5 дня.**

### 1.7 Наблюдаемость (минимум)
- `/api/health`: БД, фид (возраст), risk-кеш (возраст), Helius доступность.
- Structured logs уже есть; добавить алерт (UptimeRobot на /api/health —
  бесплатно, письмо/Telegram при падении).
- **0.5 дня.**

## 2. Сильно желательно (первые дни альфы)

### 2.1 Snapshot/enrichment без трафика
Сейчас тики живут «пока кто-то ходит». На альфе с 10 пользователями
истории будут дырявыми: перевести snapshot tick и risk enrichment на
внутренний `setInterval` сервера (вариант A это позволяет) или cron.
**0.5 дня.**

### 2.2 Мобильная вёрстка / явный отказ
Phantom Mobile — реальный сценарий. Либо быстрый фикс критичных экранов
(cast controls, intent, pull out), либо баннер «alpha: desktop only».
**1 день или 0.**

### 2.3 OG-карточки для /catch/[publicId]
Картинка-превью (invested/PnL/best) — виральность среди круга тестеров
и их чатов. Dynamic OG через next/og.
**0.5–1 день.**

### 2.4 Событийный лог (мини-аналитика)
Таблица `events (wallet, type, meta, ts)`: cast_created, cast_partial,
cast_failed, pull_out, auth_ok, api_error. Ответы на «что сломалось у
тестера» за секунды вместо «пришли скриншот».
**0.5 дня.**

### 2.5 Нагрузочный тест
10–20 виртуальных пользователей: ingestion, /api/tokens polling,
quotes, pnl. JMeter-стенд (ты это умеешь): профиль = 15с poll /tokens,
20с pnl, 1 cast/5мин. Смотрим: Helius credits/min, latency p95, memory.
**0.5–1 день.**

## 3. Helius-кредиты (проверено расчётом)

- Enrichment (доминирует): ~720k/мес — не зависит от числа пользователей.
- На пользователя: swaps ~2 кредита/quote (lite), подтверждения ~1/tx,
  price v3 пакетный — копейки. 20 активных тестеров ≈ +50k/мес.
- **Developer плана хватает с 10× запасом.**

## 4. Операционка альфы

- **Чат обратной связи** (Telegram): баг-репорты + кнопка «скопировать
  debug info» в UI (wallet, catch id, tx, timestamp).
- **Каденция**: дейли-чек health + events первую неделю.
- **Деплой-процесс**: staging = локально, prod = Railway; миграции через
  `npm run db:migrate` против prod DATABASE_URL (идемпотентны).
- **Откат**: Railway/Fly держат предыдущий деплой — rollback кнопкой.

## 5. Что НЕ делаем для альфы (осознанно)

- Redis, multi-instance, очередь задач.
- Кастомные смарт-контракты, automation (Phase 14 — отдельно).
- Полноценный admin-UI (SQL достаточно).
- Email/social-логин (wallet-only — это фича, не баг).
- Mobile app.

## 6. Итоговая оценка

| Блок | Время |
|---|---|
| Блокеры (1.1–1.7) | 4–6 дней |
| Желательно (2.1–2.5) | 2–3 дня |
| **До открытия альфы** | **~1–1.5 недели спокойной работы** |

Порядок: 0 (топология) → 1.2 (Next 16, самое рискованное — раньше) →
1.1 (allowlist) → 1.3–1.7 → 2.x → нагрузочный тест → открытие.
