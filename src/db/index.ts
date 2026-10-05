/**
 * DB client (postgres.js + Drizzle). Server-side only.
 * DATABASE_URL отсутствует/БД лежит → isDbAvailable() = false,
 * API отдаёт 503, клиент молча живёт в session-режиме.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env['DATABASE_URL'];

// Railway Postgres требует SSL с self-signed cert (postgres.railway.internal
// и *.proxy.rlwy.net); локальный docker postgres — без SSL.
const needsSsl = (url?.includes('railway') || url?.includes('rlwy.net')) ?? false;

const client = url
  ? postgres(url, {
      max: 5,
      connect_timeout: 3,
      ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    })
  : null;

export const db = client ? drizzle(client, { schema }) : null;

let available: boolean | null = null;
let lastCheck = 0;

/** Кешированная проверка доступности БД (раз в 15с). */
export async function isDbAvailable(): Promise<boolean> {
  if (!client || !db) return false;
  const now = Date.now();
  if (available !== null && now - lastCheck < 15_000) return available;
  try {
    await client`select 1`;
    available = true;
  } catch {
    available = false;
  }
  lastCheck = now;
  return available;
}
