import clsx from 'clsx';
import type { MinionKeywords, Tribe } from '@shared/types';
import { useApp } from '../store/appStore';
import { cleanCardText } from '../lib/format';
import { primaryTribe, tribeColor, tribeLabel } from '../lib/tribes';
import { CardArt, CardRender } from './CardArt';
import { KEYWORDS, KeywordIcons, keywordsFromMechanics } from './Icons';
import { Tooltip } from './Tooltip';

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
}

export type TokenSize = 'xs' | 'sm' | 'md' | 'lg';

const MARKER_MAX: Record<TokenSize, number> = { xs: 1, sm: 2, md: 3, lg: 4 };
/** Keywords rendered as frame effects rather than marker icons. */
const FRAME_KW: (keyof MinionKeywords)[] = ['taunt', 'divineShield', 'stealth'];

export interface MinionTokenProps {
  minion: TokenMinion;
  size?: TokenSize;
  showName?: boolean;
  tooltip?: boolean;
  highlight?: boolean;
  className?: string;
  /** Tier pips above the token (default: md/lg only). */
  showTier?: boolean;
}

export function MinionToken({ minion, size = 'md', showName, tooltip = true, highlight, className, showTier }: MinionTokenProps) {
  const db = useApp((s) => s.cardDb);
  const card = db.get(minion.cardId);
  const artId = card?.normalId ?? minion.cardId;
  const golden = minion.golden ?? !!card?.golden;
  const tribes = minion.tribes ?? card?.tribes ?? [];
  const tier = minion.tier ?? db.tier(minion.cardId);
  const kw = minion.keywords ?? keywordsFromMechanics(card?.mechanics ?? []);
  const damaged = minion.maxHealth !== undefined && minion.health < minion.maxHealth;
  const markers = KEYWORDS.filter((k) => kw[k.key] && !FRAME_KW.includes(k.key) && !(k.key === 'reborn' && size !== 'xs')).slice(0, MARKER_MAX[size]);
  const color = tribeColor(primaryTribe(tribes));

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
      style={{ '--tribe': color } as React.CSSProperties}
    >
      <div className="tl-token__figure">
        {kw.taunt ? <span className="tl-token__taunt" /> : null}
        <span className="tl-token__oval">
          <CardArt cardId={minion.cardId} artId={artId} name={minion.name} tribes={tribes} className="tl-token__art" />
          <span className="tl-token__fx" />
        </span>
        {tier && (showTier ?? (size === 'md' || size === 'lg')) ? (
          <span className="tl-token__tier" title={`Tier ${tier}`}>
            {size === 'xs' || size === 'sm' ? tier : Array.from({ length: tier }, (_, i) => <i key={i} />)}
          </span>
        ) : null}
        <span className="tl-token__atk">{minion.attack}</span>
        <span className={clsx('tl-token__hp', damaged && 'is-damaged')}>{minion.health}</span>
        {markers.length ? (
          <span className="tl-token__marks">
            {markers.map(({ key, color: c, Icon, label }) => (
              <span key={key} style={{ color: c }} title={label}>
                <Icon size={size === 'lg' ? 11 : size === 'md' ? 9 : 8} />
              </span>
            ))}
          </span>
        ) : null}
      </div>
      {showName ? <span className="tl-token__name">{minion.name}</span> : null}
    </div>
  );

  if (!tooltip) return body;
  return (
    <Tooltip content={() => <CardTooltip cardId={minion.cardId} minion={minion} />} placement="top">
      {body}
    </Tooltip>
  );
}

/** Rich hover card: render image (if enabled) or a text card. */
export function CardTooltip({ cardId, minion }: { cardId: string; minion?: TokenMinion }) {
  const db = useApp((s) => s.cardDb);
  const card = db.get(cardId);
  const name = minion?.name ?? card?.name ?? cardId;
  const tribes = minion?.tribes ?? card?.tribes ?? [];
  const text = cleanCardText(card?.text);
  const kw = minion?.keywords ?? keywordsFromMechanics(card?.mechanics ?? []);
  const tier = minion?.tier ?? db.tier(cardId);
  return (
    <div className="tl-cardtip">
      <CardRender cardId={card?.normalId && minion?.golden ? card.normalId : cardId} className="tl-cardtip__render" />
      <div className="tl-cardtip__text">
        <div className="tl-cardtip__head">
          <span className="tl-cardtip__name">{name}</span>
          {tier ? <span className="tl-cardtip__tier">T{tier}</span> : null}
        </div>
        <div className="tl-cardtip__meta">
          {tribes.length ? (
            tribes.map((t) => (
              <span key={t} className="tl-cardtip__tribe" style={{ color: tribeColor(t) }}>
                {tribeLabel(t)}
              </span>
            ))
          ) : card?.type === 'SPELL' ? (
            <span className="tl-cardtip__tribe">Tavern spell{card.cost !== undefined ? ` · ${card.cost} gold` : ''}</span>
          ) : (
            <span className="tl-cardtip__tribe">Neutral</span>
          )}
          {minion || card?.attack !== undefined ? (
            <span className="tl-cardtip__stats">
              <b className="atk">{minion?.attack ?? card?.attack}</b>/<b className="hp">{minion?.health ?? card?.health}</b>
              {minion && card?.attack !== undefined && (minion.attack !== card.attack || minion.health !== card.health) && !minion.golden ? (
                <span className="tl-cardtip__base"> (base {card.attack}/{card.health})</span>
              ) : null}
            </span>
          ) : null}
        </div>
        {text ? <p className="tl-cardtip__body" dangerouslySetInnerHTML={{ __html: text }} /> : null}
        <KeywordIcons keywords={kw} size={12} />
        {minion?.golden ? <div className="tl-cardtip__golden">Golden</div> : null}
      </div>
    </div>
  );
}
