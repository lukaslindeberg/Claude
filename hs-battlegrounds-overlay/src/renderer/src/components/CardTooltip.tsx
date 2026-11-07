import { useMemo } from 'react';
import clsx from 'clsx';
import type { BgCard, MinionKeywords, Tribe } from '@shared/types';
import { useApp } from '../store/appStore';
import { cleanCardText } from '../lib/format';
import { primaryTribe, tribeColor, tribeLabel } from '../lib/tribes';
import { CardArt, CardRender, wantLargeRender } from './CardArt';
import { StatGem, TierBadge, TribeEmblem } from './Bits';
import { KEYWORDS, keywordsFromMechanics } from './Icons';

/** What a tooltip needs from a minion on a board (a MinionSnapshot fits). */
export interface TooltipMinion {
  cardId: string;
  name: string;
  attack: number;
  health: number;
  maxHealth?: number;
  golden?: boolean;
  tier?: number;
  tribes?: Tribe[];
  keywords?: MinionKeywords;
  enchantments?: { cardId: string; creatorCardId?: string }[];
}

/** Printed stats of a card (doubled for a golden copy of a normal card). */
export function baseStats(card: BgCard | undefined, golden: boolean): { attack: number; health: number } | undefined {
  if (!card || card.attack === undefined || card.health === undefined) return undefined;
  const k = golden && !card.golden ? 2 : 1;
  return { attack: card.attack * k, health: card.health * k };
}

/**
 * Hover card: the real Battlegrounds card render (or a parchment card drawn from the
 * card data when images are off or missing) and, for a minion on a board, a parchment
 * note with its current stats, keywords and enchantments.
 */
export function CardTooltip({ cardId, minion }: { cardId: string; minion?: TooltipMinion }) {
  const db = useApp((s) => s.cardDb);
  const card = db.get(cardId);
  const renderId = card?.normalId && minion?.golden ? card.normalId : cardId;
  const large = useMemo(wantLargeRender, []);
  return (
    <div className={clsx('tl-cardtip', minion && 'has-note')}>
      <CardRender cardId={renderId} large={large} className="tl-cardtip__render" fallback={<ParchmentCard cardId={cardId} minion={minion} />} />
      {minion ? <MinionNote cardId={cardId} minion={minion} /> : null}
    </div>
  );
}

function MinionNote({ cardId, minion }: { cardId: string; minion: TooltipMinion }) {
  const db = useApp((s) => s.cardDb);
  const card = db.get(cardId);
  const golden = minion.golden ?? !!card?.golden;
  const base = baseStats(card, golden);
  const kw = minion.keywords ?? keywordsFromMechanics(card?.mechanics ?? []);
  const keywords = KEYWORDS.filter((k) => kw[k.key]);
  const tier = minion.tier ?? db.tier(cardId);
  const tribes = minion.tribes ?? card?.tribes ?? [];
  const damaged = minion.maxHealth !== undefined && minion.health < minion.maxHealth;
  const maxHp = minion.maxHealth ?? minion.health;
  const enchants = useMemo(() => {
    const byName = new Map<string, { name: string; text?: string; count: number }>();
    for (const e of minion.enchantments ?? []) {
      const ench = db.get(e.cardId);
      const name = ench?.name ?? (e.creatorCardId ? db.get(e.creatorCardId)?.name : undefined);
      if (!name) continue;
      const prev = byName.get(name);
      if (prev) prev.count++;
      else byName.set(name, { name, text: ench?.text ? cleanCardText(ench.text) : undefined, count: 1 });
    }
    return [...byName.values()];
  }, [db, minion.enchantments]);

  return (
    <div className="tl-cardtip__note">
      <div className="tl-cardtip__name">{minion.name || card?.name}</div>
      <div className="tl-cardtip__meta">
        {tier ? <TierBadge tier={tier} size={13} /> : null}
        {golden ? <span className="tl-cardtip__golden">Golden</span> : null}
        <span>{tribes.length ? tribes.map((t) => tribeLabel(t)).join(' · ') : 'Neutral'}</span>
      </div>
      <div className="tl-cardtip__stats">
        <StatGem kind="atk" value={minion.attack} size={26} tone={base && minion.attack > base.attack ? 'buffed' : undefined} />
        <StatGem kind="hp" value={minion.health} size={26} tone={damaged ? 'damaged' : base && maxHp > base.health ? 'buffed' : undefined} />
        <span className="tl-cardtip__base">
          {damaged ? (
            <>
              <b>{maxHp - minion.health}</b> damage taken
              <br />
            </>
          ) : null}
          {base ? (
            <>
              Printed {base.attack}/{base.health}
              {minion.attack !== base.attack || maxHp !== base.health ? (
                <>
                  {' '}
                  · <b>{signed(minion.attack - base.attack)}/{signed(maxHp - base.health)}</b>
                </>
              ) : null}
            </>
          ) : null}
        </span>
      </div>
      {keywords.length ? (
        <div className="tl-cardtip__kws">
          {keywords.map(({ key, label, color, Icon }) => (
            <span key={key} className="tl-cardtip__kw">
              <span style={{ color }}>
                <Icon size={11} />
              </span>
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {enchants.length ? (
        <div className="tl-cardtip__ench">
          <span className="tl-cardtip__label">Enchantments</span>
          {enchants.slice(0, 6).map((e) => (
            <div key={e.name} className="tl-cardtip__enchrow">
              <b>{e.name}</b>
              {e.count > 1 ? <span className="tl-cardtip__count">×{e.count}</span> : null}
              {e.text ? <span className="tl-cardtip__enchtext" dangerouslySetInnerHTML={{ __html: e.text }} /> : null}
            </div>
          ))}
          {enchants.length > 6 ? <div className="tl-cardtip__more">+{enchants.length - 6} more</div> : null}
        </div>
      ) : null}
    </div>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** A Battlegrounds-style card drawn from card data (images off, or the render is missing). */
export function ParchmentCard({ cardId, minion }: { cardId: string; minion?: TooltipMinion }) {
  const db = useApp((s) => s.cardDb);
  const card = db.get(cardId);
  const name = minion?.name ?? card?.name ?? cardId;
  const tribes = minion?.tribes ?? card?.tribes ?? [];
  const tier = minion?.tier ?? db.tier(cardId);
  const golden = minion?.golden ?? !!card?.golden;
  const text = cleanCardText(card?.text);
  const spell = card?.type === 'SPELL';
  const base = baseStats(card, golden);
  const tribe = primaryTribe(tribes);
  return (
    <div className={clsx('tl-pcard', golden && 'is-golden', spell && 'is-spell')} style={{ '--tribe': tribeColor(tribe) } as React.CSSProperties}>
      <div className="tl-pcard__body">
        <span className="tl-pcard__art">
          <CardArt cardId={cardId} artId={card?.normalId ?? cardId} name={name} tribes={tribes} initialsSize={26} />
        </span>
        <span className="tl-pcard__name">{name}</span>
        <div className="tl-pcard__text">{text ? <p dangerouslySetInnerHTML={{ __html: text }} /> : <p className="tl-pcard__empty">No card text</p>}</div>
        {tribes.length || spell ? (
          <span className="tl-pcard__tribe">
            {spell ? 'Tavern spell' : tribes.map((t) => tribeLabel(t)).join(' · ')}
            {!spell ? <TribeEmblem tribe={tribe} size={13} /> : null}
          </span>
        ) : null}
      </div>
      {tier ? <TierBadge tier={tier} size={24} className="tl-pcard__tier" /> : null}
      {spell && card?.cost !== undefined ? <StatGem kind="atk" value={card.cost} size={30} className="tl-pcard__cost" title="Cost" /> : null}
      {!spell && base ? (
        <>
          <StatGem kind="atk" value={base.attack} size={36} className="tl-pcard__atk is-sword" />
          <StatGem kind="hp" value={base.health} size={36} className="tl-pcard__hp" />
        </>
      ) : null}
    </div>
  );
}
