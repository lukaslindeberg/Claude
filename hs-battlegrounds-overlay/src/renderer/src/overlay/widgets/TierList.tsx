import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { BgCard, Tribe } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useViewport } from '../../hooks/useViewport';
import { CardTooltip } from '../../components/MinionToken';
import { CardArt } from '../../components/CardArt';
import { TribeChip } from '../../components/Bits';
import { CloseIcon, CrownIcon, KeywordIcons, SearchIcon, keywordsFromMechanics } from '../../components/Icons';
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
            <CrownIcon size={13} className="tl-gold" />
            {TIERS.map((t) => (
              <button
                key={t}
                className={clsx('tl-tiers__btn', current === t && 'is-current', open === t && 'is-open')}
                onClick={() => setOpen(open === t ? null : t)}
                title={`Tier ${t} minions`}
              >
                {t}
              </button>
            ))}
          </div>
          {open !== null ? <TierPanel tier={open} onClose={() => setOpen(null)} onTier={setOpen} /> : null}
        </div>
      )}
    </FloatingWidget>
  );
}

function TierPanel({ tier, onClose, onTier }: { tier: number; onClose: () => void; onTier: (t: number) => void }) {
  const db = useApp((s) => s.cardDb);
  const game = useApp((s) => s.game);
  const vp = useViewport();
  const [allTribes, setAllTribes] = useState(false);
  const [query, setQuery] = useState('');
  const lobbyTribes = game && game.availableTribes.length && game.tribesSource !== 'unknown' ? game.availableTribes : null;
  const tribes = allTribes ? null : lobbyTribes;
  const shopIds = useMemo(() => new Set((game?.shop ?? []).map((s) => db.normalOf(s.cardId))), [game?.shop, db]);
  const q = query.trim().toLowerCase();

  const minions = useMemo(() => {
    const pool = db.poolMinions().filter((c) => !c.duosOnly || game?.mode === 'duos').filter((c) => !c.soloOnly || game?.mode !== 'duos');
    const list = q
      ? pool.filter((c) => c.name.toLowerCase().includes(q) || (c.text ?? '').toLowerCase().includes(q))
      : pool.filter((c) => c.tier === tier);
    return list.filter((c) => inLobby(c, tribes));
  }, [db, tier, q, tribes, game?.mode]);
  const spells = useMemo(() => db.poolSpells().filter((c) => (q ? c.name.toLowerCase().includes(q) : c.tier === tier)), [db, tier, q]);
  const groups = useMemo(() => groupByTribe(minions, tribes), [minions, tribes]);

  return (
    <div className="tl-panel tl-tierpanel" style={{ maxHeight: `calc(${Math.round(vp.height * 0.82)}px / var(--tl-scale))` }}>
      <div className="tl-tierpanel__head">
        <span className="tl-heading">{q ? 'Search' : `Tier ${tier}`}</span>
        <span className="tl-muted tl-small">
          {minions.length} minion{minions.length === 1 ? '' : 's'}
          {tribes ? ' in this lobby' : ' · all tribes'}
        </span>
        <button className="tl-btn tl-btn--ghost tl-btn--icon tl-tierpanel__close" onClick={onClose} title="Close">
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="tl-tierpanel__tools">
        <label className="tl-search">
          <SearchIcon size={12} />
          <input className="tl-input" placeholder="Search name or text…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className={clsx('tl-chipbtn', allTribes && 'is-on')} onClick={() => setAllTribes(!allTribes)} disabled={!lobbyTribes} title="Show minions of tribes not in this lobby">
          All tribes
        </button>
      </div>
      {q ? null : (
        <div className="tl-tierpanel__tiers">
          {TIERS.map((t) => (
            <button key={t} className={clsx('tl-tierpanel__tier', t === tier && 'is-on')} onClick={() => onTier(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="tl-tierpanel__body tl-scroll">
        {groups.map((g) => (
          <section key={g.tribe} className="tl-tiergroup" style={{ '--c': tribeColor(g.tribe) } as React.CSSProperties}>
            <header className="tl-tiergroup__head">
              <TribeChip tribe={g.tribe} />
              <span className="tl-tiergroup__count">{g.cards.length}</span>
            </header>
            {g.cards.map((c) => (
              <MinionRow key={c.id} card={c} inShop={shopIds.has(c.id)} showTier={!!q} />
            ))}
          </section>
        ))}
        {groups.length === 0 ? <div className="tl-tierpanel__empty">No minions match.</div> : null}
        {spells.length ? (
          <section className="tl-tiergroup is-spells">
            <header className="tl-tiergroup__head">
              <span className="tl-heading">Tavern spells</span>
              <span className="tl-tiergroup__count">{spells.length}</span>
            </header>
            {spells.map((c) => (
              <Tooltip key={c.id} as="div" placement="right" content={() => <CardTooltip cardId={c.id} />}>
                <div className={clsx('tl-tierrow is-spell', shopIds.has(c.id) && 'is-shop')}>
                  <span className="tl-tierrow__cost">{c.cost ?? '?'}</span>
                  <span className="tl-tierrow__name">{c.name}</span>
                  {shopIds.has(c.id) ? <span className="tl-tag is-shop">Shop</span> : null}
                  {q ? <span className="tl-tierrow__tier">T{c.tier}</span> : null}
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
    <Tooltip as="div" placement="right" content={() => <CardTooltip cardId={card.id} />}>
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
          <b className="atk">{card.attack}</b>
          <span>/</span>
          <b className="hp">{card.health}</b>
        </span>
      </div>
    </Tooltip>
  );
}
