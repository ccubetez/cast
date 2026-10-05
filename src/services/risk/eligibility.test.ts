/**
 * Token-2022 правила risk engine: transfer fee / hook / non-transferable.
 */

import { describe, expect, it } from 'vitest';
import { evaluateToken } from './eligibility';
import type { Token } from '@/types';

function makeToken(): Token {
  return {
    mint: 'So11111111111111111111111111111111111111112',
    symbol: 'TST',
    name: 'Test Token',
    imageUrl: null,
    priceUsd: 1,
    priceSol: 0.01,
    marketCapUsd: 1_000_000,
    volume24hUsd: 100_000,
    liquidityUsd: 50_000,
    priceChange1hPct: 0,
    priceChange24hPct: 0,
    createdChainAt: new Date(Date.now() - 30 * 24 * 3600_000),
    status: 'GRADUATED',
    graduationProgress: 100,
    category: null,
    source: 'stonkfun',
    decimals: 9,
    updatedAt: new Date(),
  };
}

const baseEnrich = {
  liquidityUsd: 50_000,
  mintAuthorityRevoked: true,
  freezeAuthorityRevoked: true,
  top1HolderPct: 5,
  top10HolderPct: 20,
  tokenProgram: 'spl-token' as const,
  transferFeeBps: null,
  hasTransferHook: false,
  nonTransferable: false,
};

describe('evaluateToken — Token-2022', () => {
  it('clean spl-token → eligible LOW', () => {
    const r = evaluateToken(makeToken(), baseEnrich);
    expect(r.eligible).toBe(true);
    expect(r.riskScore).toBeLessThan(25);
    expect(r.tokenProgram).toBe('spl-token');
  });

  it('non-transferable → hard fail', () => {
    const r = evaluateToken(makeToken(), { ...baseEnrich, tokenProgram: 'token-2022', nonTransferable: true });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join()).toContain('non-transferable');
  });

  it('transfer hook → hard fail (fail-closed)', () => {
    const r = evaluateToken(makeToken(), { ...baseEnrich, tokenProgram: 'token-2022', hasTransferHook: true });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join()).toContain('transfer hook');
  });

  it('transfer fee ≥3% → hard fail', () => {
    const r = evaluateToken(makeToken(), { ...baseEnrich, tokenProgram: 'token-2022', transferFeeBps: 500 });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join()).toContain('hidden tax');
  });

  it('transfer fee <3% → eligible, но score растёт', () => {
    const clean = evaluateToken(makeToken(), baseEnrich);
    const taxed = evaluateToken(makeToken(), { ...baseEnrich, tokenProgram: 'token-2022', transferFeeBps: 100 });
    expect(taxed.eligible).toBe(true);
    expect(taxed.riskScore).toBe(clean.riskScore + 25);
    expect(taxed.transferFeeBps).toBe(100);
  });
});
