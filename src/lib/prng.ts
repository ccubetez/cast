/**
 * Seeded PRNG: xmur3 (строковый seed → 32-bit seed) + mulberry32.
 * Один seed → одна и та же последовательность. Используется
 * randomizer'ом, mock-генератором и layout'ами.
 */

export type Rng = () => number;

export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function mulberry32(a: number): Rng {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Создать детерминированный RNG из строкового seed. */
export function createRng(seed: string): Rng {
  return mulberry32(xmur3(seed)());
}

/** Случайное число в [min, max). */
export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Случайный int в [min, max]. */
export function intRange(rng: Rng, min: number, max: number): number {
  return Math.floor(range(rng, min, max + 1));
}

/** Выбор элемента массива. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  const item = arr[Math.floor(rng() * arr.length)];
  if (item === undefined) throw new Error('pick from empty array');
  return item;
}

/** Fisher–Yates shuffle (in-place на копии). */
export function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}
