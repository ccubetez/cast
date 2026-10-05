/**
 * Prod-миграция при старте контейнера (идемпотентная).
 * Запускается перед server.js: node scripts/migrate.mjs && node server.js
 * Внутри Railway виден postgres.railway.internal.
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn('[migrate] DATABASE_URL not set — skipping');
  process.exit(0);
}

const SQL = `CREATE TABLE IF NOT EXISTS catches (
  id TEXT PRIMARY KEY,
  public_id BIGINT NOT NULL,
  wallet_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  initial_value_sol NUMERIC(20,9) NOT NULL,
  current_value_sol NUMERIC(20,9) NOT NULL,
  realized_value_sol NUMERIC(20,9) NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  random_seed TEXT NOT NULL UNIQUE,
  risk_mode TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catches_wallet_idx ON catches (wallet_address, created_at DESC);

-- серверная последовательность publicId (уникальность между сессиями/устройствами);
-- setval ТОЛЬКО если последовательность ещё не использовалась (is_called=false) —
-- иначе повторный запуск миграции откатит счётчик → reuse publicId у share-ссылок.
CREATE SEQUENCE IF NOT EXISTS catch_public_id_seq;
DO $$
BEGIN
  IF NOT (SELECT is_called FROM catch_public_id_seq) THEN
    PERFORM setval('catch_public_id_seq', GREATEST((SELECT COALESCE(MAX(public_id), 1999) FROM catches) + 1, 2000), false);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  catch_id TEXT NOT NULL REFERENCES catches(id) ON DELETE CASCADE,
  token_mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  allocation_sol NUMERIC(20,9) NOT NULL,
  token_amount NUMERIC(38,18),
  entry_price_sol NUMERIC(30,18),
  current_price_sol NUMERIC(30,18),
  entry_value_sol NUMERIC(20,9),
  current_value_sol NUMERIC(20,9),
  realized_pnl_sol NUMERIC(20,9) NOT NULL DEFAULT 0,
  unrealized_pnl_sol NUMERIC(20,9) NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  buy_tx TEXT,
  sell_tx TEXT
);

CREATE TABLE IF NOT EXISTS catch_snapshots (
  catch_id TEXT NOT NULL REFERENCES catches(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  value_sol NUMERIC(20,9) NOT NULL,
  PRIMARY KEY (catch_id, ts)
);
CREATE INDEX IF NOT EXISTS positions_catch_idx ON positions (catch_id);
`;

const sql = postgres(url, { max: 1, connect_timeout: 20, ssl: { rejectUnauthorized: false } });
try {
  // multi-statement SQL → simple query protocol
  await sql.unsafe(SQL, [], { simple: true });
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`;
  console.log('[migrate] ok. tables:', tables.map((t) => t.table_name).join(', '));
} catch (e) {
  // миграция идемпотентна; фейл не должен ронять старт приложения
  console.warn('[migrate] failed (non-fatal):', JSON.stringify({ msg: e.message, code: e.code, detail: e.detail ?? null }));
} finally {
  await sql.end();
}
