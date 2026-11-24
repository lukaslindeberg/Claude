/**
 * Entity store: applies Power.log packets to an in-memory model of the game
 * (entities with their tags, players, name resolution).
 *
 * Name-resolution quirks handled here (see src/core/bg/README.md):
 *  - Players are referred to by NAME in TAG_CHANGE / BLOCK_START / choices.
 *  - In Battlegrounds there are only two Player entities: the local player (real
 *    GameAccountId) and the innkeeper "dummy" player (BACON_DUMMY_PLAYER=1). The dummy
 *    is printed under changing names: Bob's skin name ("Ragnaros, Tikilord") during the
 *    shop, the current opponent's BattleTag-less name ("LadyGagaFTW") during combat.
 *    Any name that is not the local player's resolves to the dummy player.
 */
import { GameTag } from '../log/enums';
import type { EntityRef, Packet, TagList } from '../log/powerLogParser';

export interface Entity {
  id: number;
  cardId: string;
  tags: Map<number, number>;
  /** Last entityName printed for this entity (useful when the card id is unknown to the card db). */
  name?: string;
}

export interface PlayerInfo {
  entityId: number;
  /** PlayerID (controller id), not the BG lobby slot. */
  playerId: number;
  accountHi: string;
  accountLo: string;
  /** Primary display name (from DebugPrintGame or first resolution). */
  name?: string;
  /** All names this player was printed under (dummy player in BG has many). */
  aliases: Set<string>;
}

const T = GameTag;

export interface TagChangeListener {
  (entity: Entity, tag: number, prev: number, value: number): void;
}

export class EntityStore {
  readonly entities = new Map<number, Entity>();
  readonly players = new Map<number, PlayerInfo>(); // by entity id
  readonly playerByPlayerId = new Map<number, number>(); // PlayerID -> entity id
  private readonly names = new Map<string, number>(); // name -> player entity id
  gameEntityId = 0;
  /** Names from DebugPrintGame keyed by PlayerID (may arrive before or after the Player packets). */
  private readonly debugNames = new Map<number, string>();
  /** Last name that resolved to each player entity. */
  readonly lastNameOf = new Map<number, string>();

  onTagChange?: TagChangeListener;
  /** Called whenever a player NAME (not an id) is resolved to a player entity. */
  onNameResolved?: (entityId: number, name: string) => void;

  reset(): void {
    this.entities.clear();
    this.players.clear();
    this.playerByPlayerId.clear();
    this.names.clear();
    this.debugNames.clear();
    this.lastNameOf.clear();
    this.gameEntityId = 0;
  }

  get(id: number | undefined): Entity | undefined {
    return id === undefined ? undefined : this.entities.get(id);
  }

  get game(): Entity | undefined {
    return this.entities.get(this.gameEntityId);
  }

  tag(id: number | undefined, tag: number): number {
    if (id === undefined) return 0;
    return this.entities.get(id)?.tags.get(tag) ?? 0;
  }

  /** The local player: real GameAccountId and not the BG dummy. */
  get localPlayer(): PlayerInfo | undefined {
    let fallback: PlayerInfo | undefined;
    for (const p of this.players.values()) {
      if (this.isDummy(p.entityId)) continue;
      if (p.accountHi !== '0' || p.accountLo !== '0') return p;
      fallback ??= p;
    }
    return fallback;
  }

  get dummyPlayer(): PlayerInfo | undefined {
    for (const p of this.players.values()) if (this.isDummy(p.entityId)) return p;
    return undefined;
  }

  isDummy(entityId: number): boolean {
    return this.tag(entityId, T.BACON_DUMMY_PLAYER) === 1;
  }

  playerByController(controller: number): PlayerInfo | undefined {
    const eid = this.playerByPlayerId.get(controller);
    return eid === undefined ? undefined : this.players.get(eid);
  }

  /** Register a name from `DebugPrintGame()` (`PlayerID=5, PlayerName=Foo#1234`). */
  setDebugName(playerId: number, name: string): void {
    this.debugNames.set(playerId, name);
    const eid = this.playerByPlayerId.get(playerId);
    if (eid !== undefined) this.bindName(eid, name, true);
  }

  private bindName(entityId: number, name: string, primary = false): void {
    this.names.set(name, entityId);
    const p = this.players.get(entityId);
    if (p) {
      p.aliases.add(name);
      if (primary || !p.name) p.name = name;
    }
  }

  /**
   * Resolve a player name. `hint` = 'local' when the context implies the local
   * player (e.g. entity choices in BG).
   */
  resolveName(name: string, hint?: 'local'): number | undefined {
    const known = this.names.get(name);
    if (known !== undefined) {
      this.lastNameOf.set(known, name);
      this.onNameResolved?.(known, name);
      return known;
    }
    if (this.players.size === 0) return undefined;
    const local = this.localPlayer;
    const dummy = this.dummyPlayer;
    let target: number | undefined;
    if (hint === 'local' && local) target = local.entityId;
    else if (dummy && local) {
      // BG: anything that is not the local player's name is the dummy player,
      // unless the local player has no name yet and this looks like a BattleTag.
      if (!local.name && /#\d+$/.test(name)) target = local.entityId;
      else target = dummy.entityId;
    } else {
      // Regular 2-player game: assign to the (single) player without a name.
      const unnamed = [...this.players.values()].filter((p) => !p.name);
      if (unnamed.length === 1) target = unnamed[0].entityId;
      else if (unnamed.length > 1 && local && !local.name && /#\d+$/.test(name)) target = local.entityId;
    }
    if (target === undefined) return undefined;
    // The dummy's names are transient: don't make them its primary name.
    const isDummyTarget = dummy !== undefined && target === dummy.entityId;
    if (isDummyTarget) {
      const p = this.players.get(target)!;
      p.aliases.add(name);
      this.names.set(name, target);
    } else this.bindName(target, name);
    this.lastNameOf.set(target, name);
    this.onNameResolved?.(target, name);
    return target;
  }

  /** Resolve an entity reference to an entity id (undefined if unknown). */
  resolve(ref: EntityRef | undefined, hint?: 'local'): number | undefined {
    if (!ref) return undefined;
    if (ref.kind === 'id') {
      const id = ref.id!;
      if (ref.name) {
        const e = this.entities.get(id);
        if (e && !ref.name.startsWith('UNKNOWN ENTITY')) e.name = ref.name;
      }
      return id;
    }
    if (ref.kind === 'game') return this.gameEntityId || undefined;
    return this.resolveName(ref.name!, hint);
  }

  private ensure(id: number): Entity {
    let e = this.entities.get(id);
    if (!e) {
      e = { id, cardId: '', tags: new Map() };
      this.entities.set(id, e);
    }
    return e;
  }

  private applyTags(e: Entity, tags: TagList, notify: boolean): void {
    for (const [t, v] of tags) this.setTag(e, t, v, notify);
  }

  setTag(e: Entity, tag: number, value: number, notify = true): void {
    const prev = e.tags.get(tag) ?? 0;
    e.tags.set(tag, value);
    if (notify && this.onTagChange && prev !== value) this.onTagChange(e, tag, prev, value);
  }

  /**
   * Apply a packet. Returns the entity affected (if any).
   * CreateGame resets the store.
   */
  apply(pk: Packet): Entity | undefined {
    switch (pk.type) {
      case 'CreateGame':
        this.reset();
        return undefined;
      case 'GameEntity': {
        this.gameEntityId = pk.id;
        const e = this.ensure(pk.id);
        e.cardId = 'GameEntity';
        this.applyTags(e, pk.tags, false);
        return e;
      }
      case 'Player': {
        const e = this.ensure(pk.id);
        this.applyTags(e, pk.tags, false);
        const info: PlayerInfo = {
          entityId: pk.id,
          playerId: pk.playerId,
          accountHi: pk.accountHi,
          accountLo: pk.accountLo,
          aliases: new Set(),
        };
        this.players.set(pk.id, info);
        this.playerByPlayerId.set(pk.playerId, pk.id);
        const dn = this.debugNames.get(pk.playerId);
        if (dn) this.bindName(pk.id, dn, true);
        return e;
      }
      case 'FullEntity': {
        const e = this.ensure(pk.id);
        e.cardId = pk.cardId;
        e.tags.clear();
        this.applyTags(e, pk.tags, false);
        return e;
      }
      case 'ShowEntity':
      case 'ChangeEntity': {
        const id = this.resolve(pk.entity);
        if (id === undefined) return undefined;
        const e = this.ensure(id);
        if (pk.cardId) e.cardId = pk.cardId;
        this.applyTags(e, pk.tags, true);
        return e;
      }
      case 'HideEntity': {
        const id = this.resolve(pk.entity);
        if (id === undefined) return undefined;
        const e = this.ensure(id);
        this.setTag(e, T.ZONE, pk.zone, true);
        return e;
      }
      case 'TagChange': {
        const id = this.resolve(pk.entity);
        if (id === undefined) return undefined;
        const e = this.ensure(id);
        this.setTag(e, pk.tag, pk.value, true);
        return e;
      }
      case 'GameInfo':
        if (pk.key === 'Player' && pk.playerId !== undefined && pk.playerName) this.setDebugName(pk.playerId, pk.playerName);
        return undefined;
      case 'EntityChoices':
      case 'EntitiesChosen':
        this.resolve(pk.player, 'local');
        return undefined;
      case 'BlockStart':
        this.resolve(pk.entity);
        return undefined;
      default:
        return undefined;
    }
  }
}
