# Security Audit — 2026-10-05

Scope: API endpoints, auth, транзакционный контур, секреты, injection-поверхность, БД.

## Найдено и исправлено

| # | Severity | Проблема | Фикс |
|---|---|---|---|
| 1 | **HIGH** | Rate limits отсутствовали на 7 из 10 endpoints (quotes, pnl, swap/submit, auth/*, catches/*) — флуд через Jupiter/Helius за наш счёт | Общий `lib/server/rate-limit.ts` (globalThis-singleton, per route+IP, 60с окно): quotes/pnl 60/мин, auth 20/мин, swap/submit 20/мин, catches 30/мин. Проверено живым флудом (429 после лимита) |
| 2 | **MEDIUM** | `GET /api/catches?wallet=X` отдавал уловы любого кошелька без auth — деанон позиций/истории по голому адресу | `requireAuth(req, wallet)` на GET; клиент шлёт Bearer, гидратация перенесена на момент после VERIFY |
| 3 | **MEDIUM** | Nonce Map росла безгранично при флуде `/api/auth/nonce` — memory exhaustion | sweepNonces + кап 5000 записей, 503 при переполнении |
| 4 | **MEDIUM** | Миграция `setval` сбрасывала последовательность publicId при каждом запуске → reuse publicId у share-ссылок | `setval` только при `is_called=false` |
| 5 | **LOW** | `insertCatch` ветка `exists` возвращала клиентский `publicId` (мусор) вместо серверного | Возвращает publicId существующей строки из БД |
| 6 | **LOW** | `POST /api/catches` принимал payload без капов (длина строк, число позиций, значения) | Капы: id/seed ≤128, positions ≤25, symbol ≤32, суммы finite и в разумных пределах |

## Проверено — чисто

- **Секреты**: только `process.env`, server-side; `.env*` в .gitignore; NEXT_PUBLIC — только RPC URL (публичный).
- **Auth**: ed25519-подпись, single-use nonce (TTL 5 мин), HMAC-токен 24h; replay → 401; чужой wallet → 403; подделка → 401 (e2e `scripts/check-auth.ts`).
- **Wallet binding** на всех mutating endpoints; `/api/catches/[id]/sell` проверяет владение уловом.
- **Суммы захардкожены на сервере** (single 0.01, multi 10×0.01) — клиент сумму не передаёт.
- **Mint verification**: свопы только из eligible-пула фида.
- **SQL**: только Drizzle-параметризация; конкатенации нет.
- **XSS**: метаданные StonkFun санитизируются на ingestion (control chars, `<>`, image URL whitelist); React экранирует текст по умолчанию.
- **CORS**: не открыт (same-origin по умолчанию).
- **Quotes**: кап 25 swaps, amount ≤ MAX_CAST_SOL, mint regex.
- **Детерминизм/randomness**: seeded PRNG, seed хранится (provably fair).
- **Non-custodial**: подписи только в кошельке; сервер собирает/релеит, не подписывает.

## Принятые риски (осознанно)

- Токены auth живут 24h без revocation-списка (single-user, приемлемо).
- Rate limiter in-memory (single instance); production → Redis.
- `/api/swap/submit` релеит любые подписанные пользователем tx — они подписаны его ключом, он платит fees; rate limited.
- Публичные `/catch/[publicId]` страницы показывают позиции и короткий адрес кошелька — by design (шеринг).
- Snapshot tick триггерится любым POST /api/pnl — throttled 60с.
- Dev-режим Next показывает stack traces в ошибках; production build скрывает.

## Рекомендации перед публичным доступом

1. Rate limiting вынести в middleware + Redis (Upstash).
2. Security headers (CSP, X-Frame-Options) в next.config.
3. Structured logs с request id; alerts на 429/403 всплески.
4. Rotation план для HELIUS_API_KEY и AUTH_SECRET.
5. ~~**Next.js upgrade (14.2.35 → 16.x, breaking)**~~ — **ВЫПОЛНЕНО 2026-10-05**:
   next 16.3.8 + react 19.3.0. Build/dev/33 тестов/auth-e2e/ingestion/quotes —
   всё зелёное без правок кода (wallet-adapter peer `react: *` оказался
   совместим). npm audit: critical ушла (было 1 crit + 17 high → 18 high,
   остаток — build-time transitive).
6. Transitive dev-зависимости (braces, postcss — build-time only, 17 high
   по npm audit): риск только на этапе сборки, не в рантайме; обновятся
   вместе с Next 16.
