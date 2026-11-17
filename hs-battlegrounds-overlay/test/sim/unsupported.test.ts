import { describe, expect, it } from 'vitest';
import { findUnsupportedCards } from '../../src/core/sim';
import { battle, side, vanilla } from './helpers';

const withTrinket = (cardId: string) => battle(side([vanilla(2, 2)], { trinkets: [{ cardId }] }), side([vanilla(2, 2)]));

describe('unsupported effect detection', () => {
  // Trinkets whose combat effects aren't simulated must be flagged, never silently ignored.
  it.each([
    ['BG30_MagicItem_432', 'Belcher Portrait (loses Venomous)'],
    ['BG30_MagicItem_803', 'Kaboom Bot Portrait (Deathrattle damage)'],
    ['BG32_MagicItem_820', 'Impulsive Portrait (Deathrattle targets)'],
    ['BG35_MagicItem_431t', 'Thornspike Pauldron (after a Deathrattle)'],
    ['BG30_MagicItem_438t', "Mug of the Sire (summon doesn't fit)"],
  ])('flags %s — %s', (cardId) => {
    expect(findUnsupportedCards(withTrinket(cardId))).toContain(cardId);
  });

  it.each([
    ['BG35_MagicItem_852', 'Lightning in a Bottle (after Refresh)'],
    ['BG32_MagicItem_230', 'Extravagant Scale (spend Gold)'],
    ['BG36_MagicItem_410', 'Soul Battery (replaces itself)'],
  ])('does not flag shop-only %s — %s', (cardId) => {
    expect(findUnsupportedCards(withTrinket(cardId))).not.toContain(cardId);
  });
});

describe('secrets', () => {
  it('flags secrets on either side', () => {
    const b = battle(side([vanilla(2, 2)]), side([vanilla(2, 2)], { secrets: ['TB_Bacon_Secrets_01'] }));
    expect(findUnsupportedCards(b)).toContain('TB_Bacon_Secrets_01');
  });
});
