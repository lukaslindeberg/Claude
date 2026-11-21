import { describe, expect, it } from 'vitest';
import { parseLobbyTribesText } from '../../src/main/hearthstone/tribeText';

describe('parseLobbyTribesText', () => {
  it('reads the hero-pick panels', () => {
    const text = 'Reroll Reroll Confirm In this game: Beasts, Demons, Dragons, Pirates, Quilboar Not in this game: Aberrations, Elementals, Mechs, Murlocs, Undead 8';
    expect(parseLobbyTribesText(text)).toEqual({
      inGame: ['BEAST', 'DEMON', 'DRAGON', 'PIRATE', 'QUILBOAR'],
      notInGame: ['ABERRATION', 'ELEMENTAL', 'MECHANICAL', 'MURLOC', 'UNDEAD'],
    });
  });

  it('handles line breaks and the panels in either order', () => {
    const text = 'Not in this game:\nAberrations, Elementals,\nMechs, Murlocs, Undead\nIn this game:\nBeasts, Demons, Dragons,\nPirates, Quilboar';
    expect(parseLobbyTribesText(text)?.inGame).toEqual(['BEAST', 'DEMON', 'DRAGON', 'PIRATE', 'QUILBOAR']);
  });

  it('rejects partial or contradictory reads', () => {
    expect(parseLobbyTribesText('In this game: Beasts, Demons')).toBeUndefined();
    expect(parseLobbyTribesText('Not in this game: Beasts, Demons, Dragons, Pirates, Quilboar')).toBeUndefined();
    expect(parseLobbyTribesText('In this game: Beasts, Demons, Dragons, Pirates Not in this game: Beasts, Undead')).toBeUndefined();
    expect(parseLobbyTribesText('Choose a Hero')).toBeUndefined();
  });

  it('accepts Naga and singular forms', () => {
    expect(parseLobbyTribesText('In this game: Naga, Beast, Mech, Undead, Murloc')?.inGame).toEqual(['BEAST', 'MECHANICAL', 'MURLOC', 'NAGA', 'UNDEAD']);
  });
});
