import { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { BgCard, Tribe } from '@shared/types';
import { useApp } from '../../store/appStore';
import { MinionToken } from '../../components/MinionToken';
import { TribeChip } from '../../components/Bits';
import { KeywordIcons, SearchIcon, keywordsFromMechanics } from '../../components/Icons';
import { Toggle } from '../../components/Bits';
import { cleanCardText } from '../../lib/format';
import { LOBBY_TRIBES } from '../../lib/tribes';
import { Empty, SectionHeader, Segmented } from '../ui';

type TierFilter = 'all' | '1' | '2' | '3' | '4' | '5' | '6' | '7';

export function Minions() {
  const db = useApp((s) => s.cardDb);
  const [tier, setTier] = useState<TierFilter>('all');
  const [tribes, setTribes] = useState<Set<Tribe>>(new Set());
  const [query, setQuery] = useState('');
  const [spells, setSpells] = useState(false);
  const q = query.trim().toLowerCase();

  const pool = useMemo(() => (spells ? db.poolSpells() : db.poolMinions()), [db, spells]);
  const list = useMemo(
    () =>
      pool.filter((c) => {
        if (tier !== 'all' && c.tier !== Number(tier)) return false;
        if (q && !c.name.toLowerCase().includes(q) && !(c.text ?? '').toLowerCase().includes(q)) return false;
        if (!spells && tribes.size) {
          if (!c.tribes.some((t) => tribes.has(t) || t === 'ALL')) return false;
        }
        return true;
      }),
    [pool, tier, q, tribes, spells],
  );
  const byTier = useMemo(() => {
    const m = new Map<number, BgCard[]>();
    for (const c of list) {
      const arr = m.get(c.tier ?? 0) ?? [];
      arr.push(c);
      m.set(c.tier ?? 0, arr);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [list]);

  const toggleTribe = (t: Tribe) => {
    const next = new Set(tribes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setTribes(next);
  };

  return (
    <div className="tl-section">
      <SectionHeader
        title="Minions"
        subtitle={`Current Battlegrounds pool · patch ${db.patch ?? '?'} · ${db.poolMinions().length} minions, ${db.poolSpells().length} tavern spells`}
        actions={
          <label className="tl-search">
            <SearchIcon size={13} />
            <input className="tl-input" placeholder="Search name or text…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        }
      />
      <div className="tl-toolbar">
        <Segmented<TierFilter>
          value={tier}
          onChange={setTier}
          options={[{ value: 'all', label: 'All tiers' }, ...(['1', '2', '3', '4', '5', '6', '7'] as const).map((t) => ({ value: t, label: `T${t}` }))]}
        />
        <Toggle checked={spells} onChange={setSpells} label="Tavern spells" />
        <span className="tl-muted tl-toolbar__count">{list.length} cards</span>
      </div>
      {!spells ? (
        <div className="tl-toolbar tl-toolbar--tribes">
          {LOBBY_TRIBES.map((t) => (
            <TribeChip key={t} tribe={t} onClick={() => toggleTribe(t)} active={tribes.size === 0 || tribes.has(t)} />
          ))}
          {tribes.size ? (
            <button className="tl-btn tl-btn--ghost" onClick={() => setTribes(new Set())}>
              Reset
            </button>
          ) : null}
        </div>
      ) : null}
      {list.length === 0 ? (
        <Empty title="Nothing matches">Try another tier, tribe or search.</Empty>
      ) : (
        byTier.map(([t, cards]) => (
          <section key={t} className="tl-minions__tier">
            <h2 className="tl-minions__tierhead">
              <span className="tl-minions__tiernum">{t}</span>
              Tier {t}
              <span className="tl-muted">{cards.length}</span>
            </h2>
            <div className="tl-minions__grid">
              {cards.map((c) => (
                <MinionCardTile key={c.id} card={c} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function MinionCardTile({ card }: { card: BgCard }) {
  const text = cleanCardText(card.text);
  const isSpell = card.type === 'SPELL';
  return (
    <div className={clsx('tl-mcard', isSpell && 'is-spell')}>
      <div className="tl-mcard__art">
        {isSpell ? (
          <span className="tl-mcard__cost">{card.cost ?? '?'}</span>
        ) : (
          <MinionToken minion={{ cardId: card.id, name: card.name, attack: card.attack ?? 0, health: card.health ?? 0, tier: card.tier, tribes: card.tribes }} size="md" showTier={false} />
        )}
      </div>
      <div className="tl-mcard__body">
        <div className="tl-mcard__name">{card.name}</div>
        <div className="tl-mcard__tribes">
          {isSpell ? <span className="tl-mcard__type">Tavern spell</span> : card.tribes.length ? card.tribes.map((t) => <TribeChip key={t} tribe={t} compact />) : <TribeChip tribe="NEUTRAL" compact muted />}
          <KeywordIcons keywords={keywordsFromMechanics(card.mechanics)} size={11} />
        </div>
        {text ? <p className="tl-mcard__text" dangerouslySetInnerHTML={{ __html: text }} /> : null}
      </div>
    </div>
  );
}
