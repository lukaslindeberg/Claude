/**
 * Parses the hero-pick screen's tribe panels ("In this game: Beasts, Demons, ...",
 * "Not in this game: ...") from recognised text. No Electron imports.
 */
import type { Tribe } from '@shared/types';

/** Tribe names as the game prints them (English), tolerant of OCR spacing and case. */
const WORDS: [RegExp, Tribe][] = [
  [/\baberrations?\b/i, 'ABERRATION'],
  [/\bbeasts?\b/i, 'BEAST'],
  [/\bdemons?\b/i, 'DEMON'],
  [/\bdragons?\b/i, 'DRAGON'],
  [/\belementals?\b/i, 'ELEMENTAL'],
  [/\bmech(anical)?s?\b/i, 'MECHANICAL'],
  [/\bmurlocs?\b/i, 'MURLOC'],
  [/\bnagas?\b/i, 'NAGA'],
  [/\bpirates?\b/i, 'PIRATE'],
  [/\bquil+boars?\b/i, 'QUILBOAR'],
  [/\bundead\b/i, 'UNDEAD'],
];

const IN_RE = /\bin\s*this\s*game\b/i;
const NOT_IN_RE = /\bnot\s*in\s*this\s*game\b/i;

function tribesIn(text: string): Tribe[] {
  return WORDS.filter(([re]) => re.test(text)).map(([, t]) => t);
}

export interface LobbyTribesText {
  inGame: Tribe[];
  notInGame: Tribe[];
}

/**
 * Reads both panels from OCR text. Returns undefined unless the "In this game" panel is
 * found with a plausible lobby (4-6 tribes, none also listed as "Not in this game").
 */
export function parseLobbyTribesText(raw: string): LobbyTribesText | undefined {
  const text = raw.replace(/\s+/g, ' ');
  const notMatch = NOT_IN_RE.exec(text);
  // "Not in this game" contains "in this game": find an "In this game" that is not part of it.
  let inIdx = -1;
  const re = new RegExp(IN_RE.source, 'gi');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text.slice(Math.max(0, m.index - 6), m.index);
    if (!/not\s*$/i.test(before)) {
      inIdx = m.index + m[0].length;
      break;
    }
  }
  if (inIdx < 0) return undefined;
  const notIdx = notMatch ? notMatch.index : -1;
  const inPart = notIdx > inIdx ? text.slice(inIdx, notIdx) : text.slice(inIdx);
  const notPart = notMatch ? text.slice(notMatch.index + notMatch[0].length, notIdx > inIdx ? undefined : inIdx) : '';
  const inGame = tribesIn(inPart);
  const notInGame = tribesIn(notPart);
  if (inGame.length < 4 || inGame.length > 6) return undefined;
  if (inGame.some((t) => notInGame.includes(t))) return undefined;
  return { inGame, notInGame };
}
