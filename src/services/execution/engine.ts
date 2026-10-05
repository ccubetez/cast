/**
 * CastExecutionService (Phase 7): simulated execution по контракту
 * ExecutionService из Phase 0. State machine:
 *
 *   CREATED → PREPARING → QUOTING → WAITING_FOR_SIGNATURE
 *           → EXECUTING → COMPLETED | PARTIALLY_FILLED | FAILED
 *
 * Исполнение СТРОГО последовательное (никогда "20 свопов разом").
 * Каждый переход — событие в журнал (в Phase 8+ уедет в execution_events,
 * форма записи уже соответствует). Failure-сценарий детерминирован
 * от randomSeed — воспроизводимо, ~6% позиций падают с "route expired".
 *
 * Fill — fake (Phase 7). В Phase 8 этот же каркас получит реальные
 * buildSwapTransaction / signTransaction / executeSignedTransaction.
 */

import { useCastStore } from '@/lib/store';
import type { ExecutionState } from '@/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Детерминированный failure-предикат: один и тот же Catch всегда падает одинаково. */
function shouldFail(seed: string, positionId: string): boolean {
  let h = 0;
  const s = `${seed}:${positionId}`;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100 < 6; // ~6%
}

function jitter(base: number): number {
  return base + Math.random() * base * 0.6;
}

/** Полный цикл исполнения CAST (fake fill, реальная машина состояний). */
export async function executeCast(catchId: string): Promise<void> {
  const store = useCastStore.getState;
  const catch_ = store().catches.find((c) => c.id === catchId);
  if (!catch_) return;

  store().beginExecution(catchId, 'cast');
  const advance = (state: ExecutionState, message: string) =>
    store().advanceExecution(catchId, state, message);

  advance('PREPARING', 'routes locked from preflight');
  await sleep(jitter(400));

  advance('QUOTING', `${catch_.positions.length} quotes verified`);
  await sleep(jitter(350));

  advance('WAITING_FOR_SIGNATURE', 'simulation — no wallet signature required');
  await sleep(jitter(500));

  let failed = 0;
  for (let i = 0; i < catch_.positions.length; i++) {
    const pos = catch_.positions[i];
    if (!pos) continue;
    advance('EXECUTING', `buying ${pos.symbol} — ${i + 1}/${catch_.positions.length}`);
    await sleep(jitter(380));

    if (shouldFail(catch_.randomSeed, pos.id)) {
      store().failCastPosition(catchId, pos.id);
      failed++;
      advance('EXECUTING', `${pos.symbol} failed — route expired, refunded`);
    } else {
      store().fillCastPosition(catchId, pos.id);
    }
    await sleep(120);
  }

  if (failed === 0) {
    advance('COMPLETED', `all ${catch_.positions.length} tokens caught`);
  } else if (failed === catch_.positions.length) {
    advance('FAILED', 'every route failed — catch aborted');
  } else {
    advance('PARTIALLY_FILLED', `${catch_.positions.length - failed} of ${catch_.positions.length} caught · ${failed} lost`);
  }
  store().finalizeCast(catchId, failed > 0 && failed < catch_.positions.length);
}

export type PullScope = 'ALL' | 'WINNERS' | 'LOSERS' | 'TOKEN';

/** Последовательная продажа позиций с прогрессом (selling 1/7…). */
export async function executePullOut(catchId: string, scope: PullScope, positionId?: string): Promise<void> {
  const store = useCastStore.getState;
  const execId = `${catchId}:sell`;
  const catch_ = store().catches.find((c) => c.id === catchId);
  if (!catch_) return;

  const tokens = new Map(store().tokens.map((t) => [t.mint, t]));
  const targets = catch_.positions.filter((p) => {
    if (p.status !== 'FILLED') return false;
    if (scope === 'TOKEN') return p.id === positionId;
    if (scope === 'ALL') return true;
    const token = tokens.get(p.tokenMint);
    const live = p.tokenAmount !== null && token?.priceSol ? p.tokenAmount * token.priceSol : p.allocationSol;
    const pnl = live - (p.entryValueSol ?? p.allocationSol);
    return scope === 'WINNERS' ? pnl > 0 : pnl < 0;
  });
  if (targets.length === 0) return;

  store().beginExecution(execId, 'sell');
  const advance = (state: ExecutionState, message: string) =>
    store().advanceExecution(execId, state, message);

  advance('PREPARING', `preparing ${targets.length} sell routes`);
  await sleep(jitter(300));
  advance('WAITING_FOR_SIGNATURE', 'simulation — no wallet signature required');
  await sleep(jitter(300));

  for (let i = 0; i < targets.length; i++) {
    const pos = targets[i];
    if (!pos) continue;
    advance('EXECUTING', `selling ${pos.symbol} — ${i + 1}/${targets.length}`);
    store().markSelling(catchId, pos.id);
    await sleep(jitter(420)); // bubble-out анимация идёт параллельно
    store().pullOutPosition(catchId, pos.id);
    await sleep(120);
  }

  const after = store().catches.find((c) => c.id === catchId);
  const allClosed = after?.positions.every((p) => p.status === 'SOLD' || p.status === 'FAILED') ?? false;
  advance('COMPLETED', allClosed ? 'catch closed · proceeds returned' : `${targets.length} positions sold`);
}
