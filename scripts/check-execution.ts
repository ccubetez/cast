/**
 * Headless smoke-test execution engine (Phase 7).
 * Прогон: createCatch → executeCast → события/статусы/refund,
 * затем executePullOut → SOLD/CLOSED.
 * Запуск: npx tsx scripts/check-execution.ts
 */
import { generateMockTokens } from '@/services/mock/mock-tokens';
import { useCastStore } from '@/lib/store';
import { executeCast, executePullOut } from '@/services/execution/engine';

async function main() {
  const store = useCastStore.getState;
  store().setTokens(generateMockTokens(80) as never, 'mock');

  const { catchId } = store().createCatch({ amountSol: 1, count: 5, mode: 'CHAOS' });
  const balAfterCreate = store().walletBalanceSol;
  console.log('created:', catchId.slice(0, 26), '| balance after create:', balAfterCreate.toFixed(4));

  await executeCast(catchId);

  const exec = store().executions[catchId];
  const c = store().catches.find((x) => x.id === catchId);
  if (!exec || !c) throw new Error('catch or exec missing');

  console.log('final state:', exec.state, '| catch status:', c.status);
  console.log('positions:', c.positions.map((p) => `${p.symbol}:${p.status}`).join(' '));
  console.log('balance after refunds:', store().walletBalanceSol.toFixed(4));
  console.log('events:', exec.events.length);
  for (const e of exec.events) console.log('  ·', e.message);

  const failed = c.positions.filter((p) => p.status === 'FAILED').length;
  const filled = c.positions.filter((p) => p.status === 'FILLED').length;
  console.log(`\nfilled ${filled} / failed ${failed} (deterministic from seed)`);

  // продажа всего
  await executePullOut(catchId, 'ALL');
  const c2 = store().catches.find((x) => x.id === catchId);
  const sellExec = store().executions[`${catchId}:sell`];
  console.log('sell state:', sellExec?.state, '| catch status:', c2?.status, '| closedAt:', c2?.closedAt !== null);
  console.log('balance final:', store().walletBalanceSol.toFixed(4));

  // проверки
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
    console.log('✓', msg);
  };
  assert(exec.done, 'execution marked done');
  assert(filled + failed === 5, 'all positions resolved');
  assert(failed === 0 ? exec.state === 'COMPLETED' : exec.state === 'PARTIALLY_FILLED' || exec.state === 'FAILED', 'state matches failures');
  assert(c2?.positions.every((p) => p.status !== 'PENDING' && p.status !== 'SELLING') ?? false, 'no stuck intermediate states');
  assert((c2?.positions.filter((p) => p.status === 'SOLD').length ?? 0) === filled, 'all filled positions sold');
  assert(c2?.status === 'CLOSED' || failed > 0, 'catch closed after full pull out');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
