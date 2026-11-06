/**
 * Small, fast, seedable PRNG (mulberry32). Deterministic for a given seed,
 * which makes simulator runs reproducible in tests.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). Returns 0 for n <= 1. */
  int(n: number): number {
    return n <= 1 ? 0 : Math.floor(this.next() * n);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Random element (undefined for an empty array). */
  pick<T>(arr: readonly T[]): T | undefined {
    return arr.length === 0 ? undefined : arr[this.int(arr.length)];
  }

  /** Up to `n` distinct random elements, in random order. Does not mutate `arr`. */
  sample<T>(arr: readonly T[], n: number): T[] {
    if (n <= 0 || arr.length === 0) return [];
    const copy = arr.slice();
    const k = Math.min(n, copy.length);
    for (let i = 0; i < k; i++) {
      const j = i + this.int(copy.length - i);
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    copy.length = k;
    return copy;
  }
}

/** Derive a 32-bit seed when the caller did not supply one. */
export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}
