import { generateMockTokens } from '@/services/mock/mock-tokens';
import { useCastStore } from '@/lib/store';
import { executeCast } from '@/services/execution/engine';

async function main() {
  const store = useCastStore.getState;
  store().setTokens(generateMockTokens(120) as never, 'mock');
  let partial = 0, complete = 0;
  for (let i = 0; i < 30; i++) {
    const { catchId } = store().createCatch({ amountSol: 1, count: 8, mode: 'CHAOS' });
    const before = store().walletBalanceSol;
    await executeCast(catchId);
    const c = store().catches.find((x) => x.id === catchId)!;
    const exec = store().executions[catchId]!;
    const failed = c.positions.filter((p) => p.status === 'FAILED');
    const refund = store().walletBalanceSol - before;
    const expectedRefund = failed.reduce((s, p) => s + p.allocationSol, 0);
    if (Math.abs(refund - expectedRefund) > 1e-9) throw new Error(`refund mismatch: ${refund} vs ${expectedRefund}`);
    if (exec.state === 'PARTIALLY_FILLED') {
      partial++;
      console.log(`partial: ${failed.map((f) => f.symbol).join(', ')} → refund ${refund.toFixed(4)} SOL ✓`);
    } else complete++;
  }
  console.log(`\n30 casts: ${complete} COMPLETED, ${partial} PARTIALLY_FILLED — refunds exact`);
}
main().catch((e) => { console.error(e); process.exit(1); });
