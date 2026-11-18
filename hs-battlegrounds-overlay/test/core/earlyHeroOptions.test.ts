import { describe, expect, it } from 'vitest';
import { BgTracker } from '../../src/core/bg';
import { CardDb } from '../../src/core/cards/cardDb';
import { fixtureLines, ofType } from './helpers';

describe('hero options before the choice entry', () => {
  it('publishes the heroes created in hand as soon as their batch of lines is read', () => {
    const lines = fixtureLines('bg_duos_aberrations_deity_2026.power.log.gz');
    const choice = lines.findIndex((l) => l.includes('DebugPrintEntityChoices() - id=1 '));
    expect(choice).toBeGreaterThan(0);
    const tracker = new BgTracker({ cardDb: CardDb.bundled() });
    const early = ofType(tracker.feedLines(lines.slice(0, choice)), 'heroOptions');
    expect(early).toHaveLength(1);
    expect(early[0].options).toHaveLength(4);
    expect(tracker.getState().heroOptions.map((o) => o.cardId)).toEqual(early[0].options.map((o) => o.cardId));
    // In screen order (hand position), which the choice entry then confirms.
    tracker.feedLines(lines.slice(choice, choice + 8));
    expect(tracker.getState().heroOptions.map((o) => o.cardId)).toEqual(early[0].options.map((o) => o.cardId));
    expect(early[0].options.map((o) => o.cardId)).toEqual(['TB_BaconShop_HERO_76', 'BG22_HERO_201_SKIN_E', 'BG22_HERO_002_SKIN_E', 'TB_BaconShop_HERO_29_SKIN_F']);
  });
});
