import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { BgCard, MinionKeywords, Tribe } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useViewport } from '../../hooks/useViewport';
import { CardTooltip } from '../../components/MinionToken';
import { CardArt } from '../../components/CardArt';
import { StatGem, TribeChip, TribeEmblem } from '../../components/Bits';
import { CloseIcon, KEYWORD_BY_KEY, KeywordIcons, keywordsFromMechanics } from '../../components/Icons';
import { Tooltip } from '../../components/Tooltip';
import { LOBBY_TRIBES, tribeColor } from '../../lib/tribes';
import { DragHandle, FloatingWidget } from '../Widget';

const TIERS = [1, 2, 3, 4, 5, 6, 7];

export interface TribeGroup {
  tribe: Tribe | 'NEUTRAL';
  cards: BgCard[];
}

/** Group pool minions by tribe (multi-tribe minions appear under each matching tribe). */
export function groupByTribe(cards: BgCard[], tribes: Tribe[] | null): TribeGroup[] {
  const order: (Tribe | 'NEUTRAL')[] = [...(tribes ?? LOBBY_TRIBES), 'ALL', 'NEUTRAL'];
  const groups = new Map<Tribe | 'NEUTRAL', BgCard[]>();
  for (const c of cards) {
    const keys: (Tribe | 'NEUTRAL')[] = c.tribes.length === 0 ? ['NEUTRAL'] : c.tribes.includes('ALL') ? ['ALL'] : c.tribes.filter((t) => order.includes(t));
    for (const k of keys) {
      const arr = groups.get(k) ?? [];
      arr.push(c);
      groups.set(k, arr);
    }
  }
  return order.filter((t) => groups.has(t)).map((t) => ({ tribe: t, cards: groups.get(t)! }));
}

export function inLobby(c: BgCard, tribes: Tribe[] | null): boolean {
  if (!tribes) return true;
  return c.tribes.length === 0 || c.tribes.includes('ALL') || c.tribes.some((t) => tribes.includes(t));
}

/** Compact tier bar; clicking a tier opens the pool browser for that tier. */
export function TierListWidget() {
  const game = useApp((s) => s.game);
  const pulse = useApp((s) => s.togglePulse.tierList ?? 0);
  const [open, setOpen] = useState<number | null>(null);
  const firstPulse = useRef(pulse);
  const current = game?.players.find((p) => p.isLocal)?.tavernTier ?? (game?.turn ? 1 : undefined);

  useEffect(() => {
    if (pulse === firstPulse.current) return;
    setOpen((o) => (o === null ? (current ?? 1) : null));
  }, [pulse]);

  // Demo/screenshot hook: ?tierList=4 opens that tier.
  const demo = useApp((s) => s.demo);
  useEffect(() => {
    if (!demo) return;
    const t = Number(new URLSearchParams(location.search).get('tierList'));
    if (t >= 1 && t <= 7) setOpen(t);
  }, [demo]);

  if (!game || !game.active || game.phase === 'gameOver' || game.phase === 'idle' || game.phase === 'heroSelection') return null;
  return (
    <FloatingWidget id="tierList" defaultPosition={() => ({ left: 10, top: 10 })} zIndex={30}>
      {(handle) => (
        <div className="tl-tiers">
          <div className="tl-panel tl-tiers__bar">
            <DragHandle handle={handle} />
            <span className="tl-tiers__label">Tavern</span>
            {TIERS.map((t) => (
              <button
                key={t}
                className={clsx('tl-tiers__btn', current === t && 'is-current', open === t && 'is-open')}
                onClick={() => setOpen(open === t ? null : t)}
                title={`Tier ${t} minions${current === t ? ' (your tavern tier)' : ''}`}
              >
                <span>{t}</span>
              </button>
            ))}
          </div>
          {open !== null ? <TierPanel tier={open} onClose={() => setOpen(null)} onTier={setOpen} /> : null}
        </div>
      )}
    </FloatingWidget>
  );
}

/** Keyword filters (mouse-only: the overlay window never takes keyboard focus). */
const KEYWORD_FILTERS: { key: keyof MinionKeywords; mechanics: string[] }[] = [
  { key: 'taunt', mechanics: ['TAUNT'] },
  { key: 'divineShield', mechanics: ['DIVINE_SHIELD'] },
  { key: 'deathrattle', mechanics: ['DEATHRATTLE'] },
  { key: 'startOfCombat', mechanics: ['START_OF_COMBAT'] },
  { key: 'avenge', mechanics: ['AVENGE'] },
  { key: 'reborn', mechanics: ['REBORN'] },
  { key: 'venomous', mechanics: ['VENOMOUS', 'POISONOUS'] },
  { key: 'windfury', mechanics: ['WINDFURY', 'MEGA_WINDFURY'] },
  { key: 'magnetic', mechanics: ['MAGNETIC'] },
];

function TierPanel({ tier, onClose, onTier }: { tier: number; onClose: () => void; onTier: (t: number) => void }) {
  const db = useApp((s) => s.cardDb);
  const game = useApp((s) => s.game);
  const vp = useViewport();
  const [allTribes, setAllTribes] = useState(false);
  const [tribeFilter, setTribeFilter] = useState<Set<Tribe>>(new Set());
  const [kwFilter, setKwFilter] = useState<keyof MinionKeywords | null>(null);
  const [allTiers, setAllTiers] = useState(false);
  const lobbyTribes = game && game.availableTribes.length && game.tribesSource !== 'unknown' ? game.availableTribes : null;
  const tribes = allTribes ? null : lobbyTribes;
  const shopIds = useMemo(() => new Set((game?.shop ?? []).map((s) => db.normalOf(s.cardId))), [game?.shop, db]);
  const kwMechanics = KEYWORD_FILTERS.find((k) => k.key === kwFilter)?.mechanics;
  const crossTier = allTiers;

  const minions = useMemo(() => {
    const pool = db.poolMinions().filter((c) => !c.duosOnly || game?.mode === 'duos').filter((c) => !c.soloOnly || game?.mode !== 'duos');
    return pool
      .filter((c) => crossTier || c.tier === tier)
      .filter((c) => inLobby(c, tribes))
      .filter((c) => !tribeFilter.size || c.tribes.length === 0 || c.tribes.includes('ALL') || c.tribes.some((t) => tribeFilter.has(t)))
      .filter((c) => !kwMechanics || c.mechanics.some((m) => kwMechanics.includes(m)));
  }, [db, tier, tribes, tribeFilter, kwMechanics, crossTier, game?.mode]);
  const spells = useMemo(() => (kwMechanics || tribeFilter.size ? [] : db.poolSpells().filter((c) => c.tier === tier)), [db, tier, kwMechanics, tribeFilter]);
  const groups = useMemo(() => groupByTribe(minions, tribeFilter.size ? [...tribeFilter] : tribes), [minions, tribes, tribeFilter]);
  const chipTribes = tribes ?? LOBBY_TRIBES;

  const toggleTribe = (t: Tribe) => {
    const next = new Set(tribeFilter);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setTribeFilter(next);
  };

  return (
    <div className="tl-panel tl-tierpanel" style={{ maxHeight: `calc(${Math.round(vp.height * 0.82)}px / var(--tl-scale))` }}>
      <div className="tl-tierpanel__head">
        <span className="tl-tierpanel__title">{crossTier ? 'All tiers' : `Tier ${tier}`}</span>
        <span className="tl-tierpanel__count">
          {minions.length} minion{minions.length === 1 ? '' : 's'}
          {tribes ? ' in this lobby' : ' · all tribes'}
        </span>
        <button className="tl-btn tl-btn--ghost tl-btn--icon tl-tierpanel__close" onClick={onClose} title="Close">
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="tl-tierpanel__tiers">
        {TIERS.map((t) => (
          <button
            key={t}
            className={clsx('tl-tierpanel__tier', t === tier && !allTiers && 'is-on')}
            onClick={() => {
              setAllTiers(false);
              onTier(t);
            }}
            title={`Tier ${t}`}
          >
            <span>{t}</span>
          </button>
        ))}
        <button className={clsx('tl-tierpanel__tier is-all', allTiers && 'is-on')} onClick={() => setAllTiers(true)} title="Every tier">
          All
        </button>
      </div>
      <div className="tl-tierpanel__filters">
        {chipTribes.map((t) => (
          <TribeChip key={t} tribe={t} compact onClick={() => toggleTribe(t)} active={tribeFilter.size === 0 || tribeFilter.has(t)} />
        ))}
        <button className={clsx('tl-chipbtn', allTribes && 'is-on')} onClick={() => setAllTribes(!allTribes)} disabled={!lobbyTribes} title="Include tribes that are not in this lobby">
          All tribes
        </button>
      </div>
      <div className="tl-tierpanel__filters is-keywords">
        {KEYWORD_FILTERS.map(({ key }) => {
          const info = KEYWORD_BY_KEY[key];
          return (
            <button
              key={key}
              className={clsx('tl-kwbtn', kwFilter === key && 'is-on')}
              style={{ '--c': info.color } as React.CSSProperties}
              onClick={() => setKwFilter(kwFilter === key ? null : key)}
              title={`Only ${info.label} minions`}
            >
              <info.Icon size={12} />
            </button>
          );
        })}
        {kwFilter || tribeFilter.size ? (
          <button
            className="tl-kwbtn is-clear"
            onClick={() => {
              setKwFilter(null);
              setTribeFilter(new Set());
            }}
            title="Clear filters"
          >
            <CloseIcon size={10} />
          </button>
        ) : null}
      </div>
      <div className="tl-tierpanel__body tl-scroll">
        {groups.map((g) => (
          <section key={g.tribe} className="tl-tiergroup" style={{ '--c': tribeColor(g.tribe) } as React.CSSProperties}>
            <header className="tl-tiergroup__head">
              <TribeEmblem tribe={g.tribe} size={17} />
              <span className="tl-tiergroup__name">{g.tribe === 'NEUTRAL' ? 'Neutral' : g.tribe === 'ALL' ? 'All types' : g.tribe.charAt(0) + g.tribe.slice(1).toLowerCase()}</span>
              <span className="tl-tiergroup__count">{g.cards.length}</span>
            </header>
            {g.cards.map((c) => (
              <MinionRow key={c.id} card={c} inShop={shopIds.has(c.id)} showTier={crossTier} />
            ))}
          </section>
        ))}
        {groups.length === 0 ? <div className="tl-tierpanel__empty">No minions match these filters.</div> : null}
        {spells.length ? (
          <section className="tl-tiergroup is-spells">
            <header className="tl-tiergroup__head">
              <span className="tl-tiergroup__spellmark" />
              <span className="tl-tiergroup__name">Tavern spells</span>
              <span className="tl-tiergroup__count">{spells.length}</span>
            </header>
            {spells.map((c) => (
              <Tooltip key={c.id} as="div" placement="right" content={() => <CardTooltip cardId={c.id} />} tipClassName="tl-tooltip--card">
                <div className={clsx('tl-tierrow is-spell', shopIds.has(c.id) && 'is-shop')}>
                  <StatGem kind="atk" value={c.cost ?? '?'} size={20} className="tl-tierrow__cost" title="Cost" />
                  <span className="tl-tierrow__name">{c.name}</span>
                  {shopIds.has(c.id) ? <span className="tl-tag is-shop">Shop</span> : null}
                </div>
              </Tooltip>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function MinionRow({ card, inShop, showTier }: { card: BgCard; inShop: boolean; showTier: boolean }) {
  const kw = keywordsFromMechanics(card.mechanics);
  return (
    <Tooltip as="div" placement="right" content={() => <CardTooltip cardId={card.id} />} tipClassName="tl-tooltip--card">
      <div className={clsx('tl-tierrow', inShop && 'is-shop')}>
        <span className="tl-tierrow__art">
          <CardArt cardId={card.id} name={card.name} tribes={card.tribes} initialsSize={9} />
        </span>
        <span className="tl-tierrow__name">{card.name}</span>
        {card.tribes.length > 1 && !card.tribes.includes('ALL') ? (
          <span className="tl-tierrow__dots">
            {card.tribes.map((t) => (
              <i key={t} style={{ background: tribeColor(t) }} title={t} />
            ))}
          </span>
        ) : null}
        {inShop ? <span className="tl-tag is-shop">Shop</span> : null}
        <KeywordIcons keywords={kw} size={11} max={3} />
        {showTier ? <span className="tl-tierrow__tier">T{card.tier}</span> : null}
        <span className="tl-tierrow__stats">
          <StatGem kind="atk" value={card.attack ?? 0} size={19} />
          <StatGem kind="hp" value={card.health ?? 0} size={19} />
        </span>
      </div>
    </Tooltip>
  );
}
