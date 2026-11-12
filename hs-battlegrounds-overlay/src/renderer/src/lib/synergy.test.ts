import { describe, expect, it } from 'vitest';
import { rankByPlacement, tribeRelevance, signedImpact } from './synergy';

describe('rankByPlacement', () => {
  it('ranks lower placement first and leaves unknown options unranked', () => {
    expect(rankByPlacement([4.1, 3.6, undefined, 3.9])).toEqual([3, 1, undefined, 2]);
  });

  it('puts flagged options after every other option', () => {
    expect(rankByPlacement([3.4, 3.7, 3.8], [true, false, false])).toEqual([3, 1, 2]);
  });

  it('keeps the offered order on ties', () => {
    expect(rankByPlacement([3.8, 3.8])).toEqual([1, 2]);
  });
});

describe('tribe relevance', () => {
  it('flags a wanted tribe that is missing from a known lobby', () => {
    expect(tribeRelevance(['PIRATE'], ['BEAST', 'MECHANICAL']).status).toBe('missing');
    expect(tribeRelevance(['PIRATE', 'BEAST'], ['BEAST']).status).toBe('ok');
    expect(tribeRelevance(['PIRATE'], []).status).toBe('unknown');
    expect(tribeRelevance([], ['BEAST']).status).toBe('none');
  });

  it('formats impacts compactly with a sign', () => {
    expect(signedImpact(-0.09)).toBe('−.09');
    expect(signedImpact(0.15)).toBe('+.15');
  });
});
