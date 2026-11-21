import clsx from 'clsx';
import type { EnchantmentSnapshot, MinionKeywords, Tribe } from '@shared/types';
import { useApp } from '../store/appStore';
import { primaryTribe, tribeColor } from '../lib/tribes';
import { CardArt } from './CardArt';
import { CardTooltip, baseStats } from './CardTooltip';
import { keywordsFromMechanics } from './Icons';
import { Tooltip } from './Tooltip';

export { CardTooltip } from './CardTooltip';

export interface TokenMinion {
  cardId: string;
  name: string;
  attack: number;
  health: number;
  maxHealth?: number;
  golden?: boolean;
  tier?: number;
  tribes?: Tribe[];
  keywords?: MinionKeywords;
  /** Listed in the hover card when known (board snapshots). */
  enchantments?: EnchantmentSnapshot[];
}

export type TokenSize = 'xs' | 'sm' | 'md' | 'lg';

/** Small keyword markers that fit on a compact (xs/sm) token. */
const MARKER_MAX: Record<TokenSize, number> = { xs: 1, sm: 2, md: 4, lg: 4 };

type Mark = 'deathrattle' | 'trigger' | 'venom' | 'wind';
const MARK_LABEL: Record<Mark, string> = { deathrattle: 'Deathrattle', trigger: 'Start of Combat / Avenge', venom: 'Venomous', wind: 'Windfury' };

export interface MinionTokenProps {
  minion: TokenMinion;
  size?: TokenSize;
  showName?: boolean;
  tooltip?: boolean;
  highlight?: boolean;
  className?: string;
  /** Tier stars above the token (default: md/lg only). */
  showTier?: boolean;
}

/**
 * A minion as it stands on the Battlegrounds board: oval portrait in a stone rim
 * (gold when golden), attack in a gold disc, health in a red drop, tier stars on the
 * rim and the keywords drawn as board effects (taunt shield, divine shield bubble,
 * reborn glow, stealth mist, deathrattle/trigger plaques, venom drop, windfury swirl).
 */
export function MinionToken({ minion, size = 'md', showName, tooltip = true, highlight, className, showTier }: MinionTokenProps) {
  const db = useApp((s) => s.cardDb);
  const card = db.get(minion.cardId);
  const artId = card?.normalId ?? minion.cardId;
  const golden = minion.golden ?? !!card?.golden;
  const tribes = minion.tribes ?? card?.tribes ?? [];
  const tier = minion.tier ?? db.tier(minion.cardId);
  const kw = minion.keywords ?? keywordsFromMechanics(card?.mechanics ?? []);
  const damaged = minion.maxHealth !== undefined && minion.health < minion.maxHealth;
  const base = baseStats(card, golden);
  const atkBuffed = !!base && minion.attack > base.attack;
  const hpBuffed = !!base && !damaged && (minion.maxHealth ?? minion.health) > base.health;
  const big = size === 'md' || size === 'lg';

  const marks: Mark[] = [];
  if (kw.deathrattle) marks.push('deathrattle');
  if (kw.startOfCombat || kw.avenge) marks.push('trigger');
  if (kw.venomous || kw.poisonous) marks.push('venom');
  if (kw.windfury || kw.megaWindfury) marks.push('wind');
  const plaques = big ? marks.filter((m) => m === 'deathrattle' || m === 'trigger') : [];
  const smallMarks = big ? [] : marks.slice(0, MARKER_MAX[size]);
  const tierShown = !!tier && (showTier ?? big);

  const body = (
    <div
      className={clsx(
        'tl-token',
        `tl-token--${size}`,
        golden && 'is-golden',
        kw.taunt && 'has-taunt',
        kw.divineShield && 'has-ds',
        kw.reborn && 'has-reborn',
        kw.stealth && 'has-stealth',
        highlight && 'is-highlight',
        className,
      )}
      style={{ '--tribe': tribeColor(primaryTribe(tribes)) } as React.CSSProperties}
    >
      <div className="tl-token__figure">
        {kw.taunt ? <span className="tl-token__taunt" /> : null}
        <span className="tl-token__oval">
          <CardArt cardId={minion.cardId} artId={artId} name={minion.name} tribes={tribes} className="tl-token__art" />
          <span className="tl-token__fx" />
        </span>
        {kw.divineShield ? <span className="tl-token__bubble" /> : null}
        {tierShown ? (
          big ? (
            <span className="tl-token__stars" title={`Tier ${tier}`}>
              {Array.from({ length: tier! }, (_, i) => (
                <i key={i} style={{ '--o': Math.abs(i - (tier! - 1) / 2) } as React.CSSProperties} />
              ))}
            </span>
          ) : (
            <span className="tl-token__tierstar" title={`Tier ${tier}`}>
              {tier}
            </span>
          )
        ) : null}
        {big && marks.includes('wind') ? <span className="tl-token__side is-wind" title="Windfury" /> : null}
        {big && marks.includes('venom') ? <span className="tl-token__side is-venom" title="Venomous" /> : null}
        <span className={clsx('tl-token__atk', atkBuffed && 'is-buffed')} data-len={String(minion.attack).length}>
          {minion.attack}
        </span>
        <span className={clsx('tl-token__hp', damaged && 'is-damaged', hpBuffed && 'is-buffed')} data-len={String(minion.health).length}>
          {minion.health}
        </span>
        {plaques.length ? (
          <span className="tl-token__plaques">
            {plaques.map((m) => (
              <i key={m} className={`is-${m}`} title={MARK_LABEL[m]} />
            ))}
          </span>
        ) : null}
        {smallMarks.length ? (
          <span className="tl-token__marks">
            {smallMarks.map((m) => (
              <i key={m} className={`is-${m}`} title={MARK_LABEL[m]} />
            ))}
          </span>
        ) : null}
      </div>
      {showName ? <span className="tl-token__name">{minion.name}</span> : null}
    </div>
  );

  if (!tooltip) return body;
  return (
    <Tooltip content={() => <CardTooltip cardId={minion.cardId} minion={minion} />} placement="top" tipClassName="tl-tooltip--card">
      {body}
    </Tooltip>
  );
}
