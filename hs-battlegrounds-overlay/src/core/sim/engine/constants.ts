/**
 * Tag names the simulator reads from `SimSide.playerTags` / `heroTags` /
 * `MinionSnapshot.tags`.
 *
 * Real GameTag names are used where the game has one. Values for which the game
 * has no single tag (they live on player enchantments) use `SIM_*` keys: the
 * tracker may fill them in when it can compute them; otherwise defaults apply.
 */
export const TAG = {
  // Real GameTags
  SD1: 'TAG_SCRIPT_DATA_NUM_1',
  SD2: 'TAG_SCRIPT_DATA_NUM_2',
  SD3: 'TAG_SCRIPT_DATA_NUM_3',
  SD4: 'TAG_SCRIPT_DATA_NUM_4',
  TECH_LEVEL: 'TECH_LEVEL',
  PREMIUM: 'PREMIUM',
  /** Extra attack given by Blood Gems (a gem gives 1 + this). */
  BLOOD_GEM_ATK: 'BACON_BLOODGEMBUFFATKVALUE',
  /** Extra health given by Blood Gems (a gem gives 1 + this). */
  BLOOD_GEM_HP: 'BACON_BLOODGEMBUFFHEALTHVALUE',
  OLD_GOD_DBID: 'BACON_GLOBAL_OLD_GOD_DBID',
  OLD_GOD_ATK: 'BACON_OLD_GOD_ATTACK',
  OLD_GOD_HP: 'BACON_OLD_GOD_HEALTH',
  NUM_SPELLS_PLAYED_THIS_GAME: 'NUM_SPELLS_PLAYED_THIS_GAME',

  // Simulator-specific keys (optional; see README "Player tags")
  /** "Your Undead have +X Attack this game" total. */
  UNDEAD_ATK: 'SIM_UNDEAD_ATTACK_BONUS',
  /** Current Beetle stats (default 2/2). */
  BEETLE_ATK: 'SIM_BEETLE_ATTACK',
  BEETLE_HP: 'SIM_BEETLE_HEALTH',
  /** Friendly Eternal Knights that died this game. */
  ETERNAL_KNIGHTS_DEAD: 'SIM_ETERNAL_KNIGHTS_DEAD',
  /** "Your Tavern spells give an extra +X/+Y" totals. */
  SPELL_ATK: 'SIM_TAVERN_SPELL_ATTACK_BONUS',
  SPELL_HP: 'SIM_TAVERN_SPELL_HEALTH_BONUS',
  /** Elementals played this game (Flourishing Frostling). */
  ELEMENTALS_PLAYED: 'SIM_ELEMENTALS_PLAYED',
  /** Ancestral Automatons summoned this game. */
  AUTOMATONS_SUMMONED: 'SIM_AUTOMATONS_SUMMONED',
} as const;

/** Safety limits for a single combat. */
export const LIMITS = {
  /** Attacks after which the combat is declared a tie (infinite loops / stalemates). */
  maxAttacks: 400,
  /** Max nested trigger depth (blood gem ping-pong, deathrattle chains...). */
  maxDepth: 40,
  /** Max death-resolution passes in one batch. */
  maxDeathPasses: 120,
} as const;
