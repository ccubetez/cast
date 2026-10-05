/**
 * Идемпотентная миграция (CREATE TABLE IF NOT EXISTS).
 * Запуск: npm run db:migrate
 */
import postgres from 'postgres';

const url = process.env['DATABASE_URL'] ?? 'postgresql://cast:cast@localhost:5433/cast';

const SQL = `
CREATE TABLE IF NOT EXISTS catches (
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

async function main() {
  const client = postgres(url, { connect_timeout: 5 });
  await client.unsafe(SQL);
  const tables = await client`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  console.log(
    'migrated. tables:',
    tables.map((t) => t['tablename']).join(', '),
  );
  await client.end();
}

main().catch((e) => {
  console.error('migration failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
