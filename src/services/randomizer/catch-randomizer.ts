/**
 * CatchRandomizer — реальная реализация контракта из Phase 0.
 * Уже deterministic (seed) и с гарантиями суммы/min/max/уникальности.
 * Unit-тесты добавляются в Phase 4; здесь используется для mock-CAST.
 *
 * Точность: вся математика в лампортах (integer), float только на границах.
 */

import type { CatchRandomizer, RandomizeRequest, RandomizeResult } from '@/types';
import { createRng, shuffled } from '@/lib/prng';

const LAMPORTS_PER_SOL = 1_000_000_000;

export class SeededCatchRandomizer implements CatchRandomizer {
  randomize(request: RandomizeRequest): RandomizeResult {
    const { pool, totalSol, count, minAllocationSol, maxAllocationSol, seed } = request;

    if (count <= 0) throw new Error('count must be positive');
    if (pool.length < count) {
      throw new Error(`pool too small: ${pool.length} tokens for ${count} slots`);
    }
    const totalLamports = Math.round(totalSol * LAMPORTS_PER_SOL);
    const minLamports = Math.round(minAllocationSol * LAMPORTS_PER_SOL);
    const maxLamports = Math.round(maxAllocationSol * LAMPORTS_PER_SOL);
    if (minLamports * count > totalLamports) {
      throw new Error(`min allocation × count (${count}) exceeds total`);
    }
    if (maxLamports * count < totalLamports) {
      throw new Error(`max allocation × count (${count}) below total`);
    }

    const rng = createRng(seed);

    // 1. выбор N уникальных токенов
    const chosen = shuffled(rng, pool).slice(0, count);

    // 2. все позиции стартуют с min, остаток распределяем случайными
    //    порциями по токенам со свободным headroom — сумма сохраняется точно
    const alloc = chosen.map(() => minLamports);
    let remaining = totalLamports - minLamports * count;

    while (remaining > 0) {
      const withHeadroom: number[] = [];
      for (let i = 0; i < count; i++) {
        if ((alloc[i] as number) < maxLamports) withHeadroom.push(i);
      }
      if (withHeadroom.length === 0) break; // не должно случаться при валидных границах
      const idx = withHeadroom[Math.floor(rng() * withHeadroom.length)] as number;
      const headroom = maxLamports - (alloc[idx] as number);
      // случайная порция: до 25% остатка, но не меньше 1 лампорта
      const portion = Math.min(headroom, Math.max(1, Math.floor(rng() * remaining * 0.25)));
      alloc[idx] = (alloc[idx] as number) + portion;
      remaining -= portion;
    }

    // 3. лёгкий финальный shuffle, чтобы «последняя позиция» не была особенной
    const order = shuffled(rng, chosen.map((_, i) => i));

    return {
      seed,
      allocations: order.map((i) => ({
        tokenMint: (chosen[i] as (typeof chosen)[number]).token.mint,
        symbol: (chosen[i] as (typeof chosen)[number]).token.symbol,
        allocationSol: (alloc[i] as number) / LAMPORTS_PER_SOL,
      })),
    };
  }
}

export const catchRandomizer = new SeededCatchRandomizer();

export function newSeed(): string {
  return `cast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
