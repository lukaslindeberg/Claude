import { describe, expect, it } from 'vitest';
import { CardDb } from '../../src/core/cards/cardDb';
import { relatedTribesFromText } from '../../src/core/cards/hsdataConverter';

describe('relatedTribes', () => {
  it('finds tribe words and plurals, ignoring markup and "any type" wording', () => {
    expect(relatedTribesFromText('Give your <b>Beasts</b> and a random Mech +2/+2.')).toEqual(['BEAST', 'MECHANICAL']);
    expect(relatedTribesFromText('Your Undead and Naga have +1 Attack. Summon 2 Aberrations, a Demon and Quilboar.')).toEqual([
      'ABERRATION',
      'DEMON',
      'NAGA',
      'QUILBOAR',
      'UNDEAD',
    ]);
    expect(relatedTribesFromText('Elementals, Pirates, Dragons, Murlocs')).toEqual(['DRAGON', 'ELEMENTAL', 'MURLOC', 'PIRATE']);
    expect(relatedTribesFromText('Give a friendly minion of each type +1/+2.')).toEqual([]);
    expect(relatedTribesFromText('Summon a minion of any type.')).toEqual([]);
    expect(relatedTribesFromText('Mechanize the beastly Pirateship')).toEqual([]);
    expect(relatedTribesFromText(undefined)).toEqual([]);
  });

  it('is computed into the bundled card data', () => {
    const db = CardDb.bundled();
    expect(db.get('BG30_MagicItem_411')?.relatedTribes).toEqual(['QUILBOAR']); // Hoggy Bank (trinket)
    expect(db.get('BG30_MagicItem_418')?.relatedTribes).toEqual(['DRAGON', 'MURLOC']); // Bronzebeard Portrait
    expect(db.get('BG30_MagicItem_998')?.relatedTribes).toBeUndefined(); // Bob-blehead
    expect(db.get('BG33_Reward_011')?.relatedTribes).toEqual(['MURLOC']); // quest reward
    expect(db.get('BG23_350')?.relatedTribes).toBeUndefined(); // "a friendly minion of each type"
    // Heroes inherit their hero power's tribes.
    expect(db.get('BG22_HERO_007p')?.relatedTribes).toEqual(['NAGA']);
    expect(db.get('BG22_HERO_007')?.relatedTribes).toEqual(['NAGA']); // Queen Azshara
    expect(db.get('TB_BaconShop_HERO_18')?.relatedTribes).toEqual(['PIRATE']); // Patches the Pirate
  });
});
