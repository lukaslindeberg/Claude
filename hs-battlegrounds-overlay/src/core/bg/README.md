# Battlegrounds tracker (`src/core/bg`)

Turns Hearthstone `Power.log` lines into a `BgGameState` snapshot + `BgEvent`s (contract in
`src/shared/types.ts`).

```ts
import { BgTracker } from '@core/bg';
const tracker = new BgTracker();            // { cardDb?: CardDb; now?: () => number }
const events = tracker.feedLines(lines);    // any chunking; feedLine(line) for one line
const state = tracker.getState();           // plain JSON, cached per `tracker.version`
tracker.flush();                            // end of input: buffered packet + pending gameEnd
```

Pipeline: `log/powerLogParser.ts` (lines -> typed packets) -> `game/entityStore.ts` (entities,
tags, players, name resolution) -> `bg/tracker.ts` (BG semantics) + `bg/snapshots.ts`.
`getState()` is side-effect free: everything stateful is driven by packets, so feeding the same
lines in any chunk sizes gives identical events and state (tested).

## Parser

- `D HH:MM:SS.fffffff <Method>() - <payload>`; indentation is ignored (it resets for every
  `DebugPrintPowerList` chunk, so it does not reflect block depth).
- `GameState.DebugPrintPower()` and `PowerTaskList.DebugPrintPower()` can both print the same
  packets. Only one source is used: the one that printed the first `CREATE_GAME`
  (provisionally the first source seen before that). Choices / `DebugPrintGame()` only exist
  on GameState and are always parsed.
- Tags print by name or number (`tag=1068`), values by number or enum name
  (`ZONE value=PLAY`, `CARDRACE value=PET` = BEAST, `FACTION`, `RARITY`, `STEP`, ...). Everything
  is normalised to numeric ids; snapshots key tags by `GameTag` name (numeric string if unknown).
- Entity refs: `GameEntity`, bare id, `[entityName=... id=N zone=Z zonePos=P cardId=C player=Q]`
  (names may contain commas, brackets, quotes, unicode; hidden ones are
  `UNKNOWN ENTITY [cardType=INVALID]`), or a player NAME.
- `BLOCK_START ... EffectCardId=System.Collections.Generic.List\`1[System.String]` is a client
  printing bug; `TAG_CHANGE ... DEF CHANGE` suffix exists.
- BLOCK_START/BLOCK_END are NOT balanced: some ATTACK blocks never get a BLOCK_END (139963 log
  ends at depth 26). Only relative depth is used (see combat capture).

## Players and names

- Only two Player entities exist, also in duos: the local player (real `GameAccountId`) and the
  innkeeper dummy (`BACON_DUMMY_PLAYER=1`, account 0). `PlayerID`s are e.g. 5 and 13.
- The dummy is printed under CHANGING names: `The Innkeeper` (DebugPrintGame), Bob's skin
  (`Ragnaros, Tikilord`, `Bartender Bob`, `Таверна Боба`) in the shop, and the current opponent's
  name (`LadyGagaFTW`) during combat. Any name that is not the local player's resolves to the
  dummy. Opponent names are learnt by voting: names the dummy is printed under while a captured
  combat against player X is running (excluding names seen before the first combat).
- Without `DebugPrintGame`, a BattleTag-looking name (`#1234`) goes to the local player; entity
  choices are always the local player's.

## Lobby / leaderboard

- Leaderboard heroes: `CARDTYPE=HERO`, `PLAYER_ID>0` (lobby slot), controller = dummy,
  `ZONE=SETASIDE`. They carry `PLAYER_LEADERBOARD_PLACE`, `PLAYER_TECH_LEVEL`, `PLAYER_TRIPLES`,
  `HEALTH/DAMAGE/ARMOR`, `HERO_POWER` (dbfId) and in duos `BACON_DUO_TEAM_ID`. In duos they also
  have `COPIED_FROM_ENTITY_ID`, so that tag does not identify combat copies.
- Local hero: the local Player's `HERO_ENTITY` unless it is the `TB_BaconShop_HERO_PH`
  placeholder or a duos teammate copy (`COPIED_FROM_ENTITY_ID`, other `PLAYER_ID`). Its
  `PLAYER_ID` equals the local `PlayerID`. `NEXT_OPPONENT_PLAYER_ID` is on the local Player (and hero).
- Dead: `HEALTH - DAMAGE <= 0` on the leaderboard hero. Tier history = increases of
  `PLAYER_TECH_LEVEL` (turn = BG turn when seen).
- Hero selection: `DebugPrintEntityChoices` `ChoiceType=MULLIGAN`, chosen via
  `DebugPrintEntitiesChosen` (fallback: the local `HERO_ENTITY`). Rerolls are `CHANGE_ENTITY` on
  an option entity -> a new `heroOptions` event.
- Tribes: there is no tag listing the lobby's tribes (HDT/Firestone read them from memory).
  They are inferred (`tribesSource: 'inferred'`) from shop offers (dummy minions in PLAY on an
  odd TURN) that are pool minions (`IS_BACON_POOL_MINION`, or the card db's pool flag when the
  tag is missing) with exactly one `BACON_SUBSET_*` tag (dual-tribe minions carry two; some
  neutrals carry one, e.g. Nadina -> DRAGON), else their single `CARDRACE`. The card db's tribes
  are not used (cards are re-tagged between patches). Fixtures show 5 tribes per lobby (2022-2026).
  Late-game effects can offer non-pool cards (hero buddies): the pool requirement excludes them.
- `BACON_GLOBAL_ANOMALY_DBID`, `BACON_TRINKETS_ACTIVE`, `BACON_QUESTS_ACTIVE`,
  `BACON_COMBAT_DAMAGE_CAP` (+ `..._ENABLED`, changes during the game: 5 -> 10 -> 15 -> off) are on
  the GameEntity. Trinkets are `BATTLEGROUND_TRINKET` in PLAY (`BG30_Trinket_1st/2nd` are empty
  slot placeholders and ignored); quest rewards are `BATTLEGROUND_QUEST_REWARD` in PLAY.

## Turns and phases

- GameEntity `TURN`: odd = recruit, even = combat; BG turn = ceil(TURN/2). The Player entities
  also get `TURN` changes - ignore them.
- GameEntity `BOARD_VISUAL_STATE`: 1 = shop, 2 = combat. Combat starts at `TURN` even or
  `BOARD_VISUAL_STATE=2` (whichever first) and ends at `BOARD_VISUAL_STATE=1` / next odd `TURN`.
- Shop offers: dummy-controlled MINION/SPELL in PLAY during the recruit phase.

## Combat (`combatStart` / BattleSimInput)

1. Combat start: our board snapshot is taken (duos may later swap it out).
2. Setup (TRIGGER block of `TB_BaconShop_8P_PlayerE`): the opponent's hero is copied into PLAY for
   the dummy and the dummy's `HERO_ENTITY` is switched to it ("install"; Bob goes SETASIDE),
   opponent minions/hero power/trinkets are created for the dummy, SETASIDE backup copies of our
   board are created (`COPIED_FROM_ENTITY_ID`). The order inside the block varies (minions can be
   created before the hero).
3. The input is captured when the block that installed the opponent hero ends (depth falls
   below the install depth), i.e. after the setup and before any start-of-combat trigger or
   attack; fallback: first ATTACK block. Opponent combat entities are always created for that
   combat, so only dummy entities newer than the combat start are used (stripped HSReplay
   replays never remove old shop minions).
4. Other players' leaderboard damage for this turn is applied right after (spoilers).
5. The winner's hero attacks the loser (`BLOCK_START BlockType=ATTACK` by a HERO). Result =
   attacking side; damage = drop of the loser's HEALTH-DAMAGE+ARMOR after that attack (max drop,
   because Kel'Thuzad ghosts heal back to full); hero ATK as fallback; no hero attack = tie.
   Verified against leaderboard health on all fixtures (ghost combats excluded).
- Kel'Thuzad: a dead player's ghost (`TB_BaconShop_HERO_KelThuzad`) can replace the opponent copy
  inside the setup block; `NEXT_OPPONENT_PLAYER_ID` still names the dead player.
- Duos: at combat start SETASIDE "templates" (controlled by the LOCAL player) are created for the
  three other combatants: hero with `PLAYER_ID`, hero power, trinkets, hidden player enchants,
  minions (creation order = board order, no ZONE_POSITION), hand cards (marked by an attached
  `TB_BaconShopBadsongE` "Costs 0" enchant), followed by backups of our board. Then
  `BACON_CURRENT_COMBAT_PLAYER_ID` is set on both players and the first fighters are installed.
  If our teammate fights first (`BACON_DUO_PLAYER_FIGHTS_FIRST_NEXT_COMBAT=0`) our hero/minions go
  SETASIDE, the teammate copy becomes the local `HERO_ENTITY` and the local Player entity's tags
  (tier, gold...) temporarily become the teammate's. `input.player` is the first fighter of our
  team (`teammate` = the other one), `input.opponent` likewise. Teams share health.
- Duos teammate player tags: a template's player enchant is hidden; its tags (Tasty Lobster count
  4803, Undead bonuses...) reach a Player entity (via a `Bacon_TagTransferPlayerE`) only when that
  player joins the fight. The tracker caches each Player entity's tags under the
  `BACON_CURRENT_COMBAT_PLAYER_ID` fighting for it (at every ATTACK) and gives a template side the
  tags last seen for its PLAYER_ID (empty before that player first fought).
- Duos teams: teammates share health/armor/place, but the client updates their two leaderboard
  heroes one after the other (up to a turn apart), so the state uses the most recently changed
  one for both. Teams come from `BACON_DUO_TEAM_ID`, `BACON_DUO_TEAMMATE_PLAYER_ID`,
  `NEXT_OPPONENT_TEAMMATE_PLAYER_ID` and the combat sides. In combat the dummy keeps the FIRST
  enemy fighter's name until the end (also while the teammate fights): names are voted for it only.
- Secrets (Akazamzarak, `TB_Bacon_Secrets_*`, SECRET zone) go to `SimSide.secrets`.
- `playerTags` = all tags of the Player entity (dummy during combat for the opponent, which then
  carries the opponent's transferred tags) + lobby-wide GameEntity tags
  (`BACON_GLOBAL_OLD_GOD_DBID`, anomaly, damage cap). `heroTags` = all tags of the hero entity.

## Game end

- Local `PLAYSTATE` WON/LOST/TIED ends tracking; the server keeps simulating afterwards (victory
  laps, ghost combats, combats after a concede) - those are ignored.
- After a loss the local hero's final `PLAYER_LEADERBOARD_PLACE` is printed AFTER
  `PLAYSTATE=LOST`, so `gameEnd` (MatchRecord) is emitted at GameEntity `STATE=COMPLETE`, the next
  `CREATE_GAME` or `flush()`. Placement = 1 if WON, else the local hero's place (duos: team place 1-4).
- Reconnect: a new `CREATE_GAME` with the full state; if `GAME_SEED` equals the running game's,
  history is kept. A log that starts mid-game works (no hero options).
- Non-BG games (`GameType` without BATTLEGROUNDS, no dummy player) leave `active=false`.
- Spectating: lines containing `Begin Spectating` / `Start Spectator` / `End Spectator`.

## Fixtures (`test/fixtures/logs`, CC0 HearthSim hsreplay-test-data)

Raw logs: `bg_139963_perfect_game` (2022, 1st), `bg_36393` (2019). Converted from HSReplay XML
with `node --experimental-strip-types scripts/hsreplay-xml-to-log.ts in.xml out.power.log.gz`:
duos+trinkets (2024), duos with Aberrations/deity (2026), quests (2022, stripped replay), hero
reroll (2025), Kel'Thuzad ghosts (2019), reconnect, async game over, conceded games. The
converter output of the 139963 XML gives the same tracker results as the raw 139963 log.
HSReplay XML omits tags equal to the card definition (CARDRACE, TECH_LEVEL,
IS_BACON_POOL_MINION...), so unknown old cards in converted fixtures may lack tribes.
