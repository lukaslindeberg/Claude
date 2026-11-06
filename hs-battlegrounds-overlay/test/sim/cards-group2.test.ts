/** Group 2 card handlers: Naga, Pirate, Quilboar, Undead, Aberration, neutral/all-type, side effects. */
import { describe, expect, it } from 'vitest';
import { ensureCardsRegistered, getMinionHandler } from '../../src/core/sim/cards';
import { db } from './helpers';

ensureCardsRegistered();

const GROUP2 = new Set(['NAGA', 'PIRATE', 'QUILBOAR', 'UNDEAD', 'ABERRATION', 'NEUTRAL', 'ALL']);
const firstTribe = (tribes: string[]) => (tribes.length === 0 ? 'NEUTRAL' : tribes.includes('ALL') ? 'ALL' : tribes[0]);

describe('group 2 coverage', () => {
  it('every pool minion of these tribes is handled or marked noCombatEffect', () => {
    const missing = db
      .poolMinions()
      .filter((c) => GROUP2.has(firstTribe(c.tribes)))
      .filter((c) => !getMinionHandler(c.id, db))
      .map((c) => `${c.id} ${c.name}`);
    expect(missing).toEqual([]);
  });
});
