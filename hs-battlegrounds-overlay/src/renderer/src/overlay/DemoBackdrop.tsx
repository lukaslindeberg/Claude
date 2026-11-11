import { useMemo } from 'react';
import { useApp } from '../store/appStore';
import { useViewport } from '../hooks/useViewport';
import { HeroPortrait } from '../components/HeroPortrait';
import { CardArt } from '../components/CardArt';
import { MinionToken, type TokenMinion } from '../components/MinionToken';
import { effectiveScale, heroPickCenters, leaderboardSlots, trinketPickLayout } from './layout';

/**
 * Browser-demo only: a dim stand-in for the Hearthstone game window so the
 * overlay widgets can be judged in context (screenshots, development).
 */
export function DemoBackdrop() {
  const game = useApp((s) => s.game);
  const db = useApp((s) => s.cardDb);
  const cal = useApp((s) => s.settings.leaderboardCalibration);
  const vp = useViewport();
  const players = useMemo(() => [...(game?.players ?? [])].sort((a, b) => a.leaderboardPlace - b.leaderboardPlace), [game?.players]);
  const slots = leaderboardSlots(cal, vp, players.length || 8);
  const H = vp.height;
  const local = players.find((p) => p.isLocal);
  const phase = game?.phase ?? 'idle';
  const opponent = players.find((p) => p.playerId === game?.currentOpponentPlayerId);
  const shop: TokenMinion[] = (game?.shop ?? [])
    .filter((s) => s.type === 'MINION')
    .map((s) => ({ cardId: s.cardId, name: s.name, attack: s.attack, health: s.health, tier: s.tier, tribes: s.tribes, golden: s.golden }));
  const spellsInShop = (game?.shop ?? []).filter((s) => s.type === 'SPELL');
  const scale = useApp((s) => effectiveScale(s.settings.scale, vp));
  const trinkets = phase === 'recruit' ? (game?.trinketOptions ?? []) : [];

  return (
    <div className="tl-demo-bg" aria-hidden>
      <div className="tl-demo-bg__board" style={{ width: Math.min(vp.width, H * 1.5), left: (vp.width - Math.min(vp.width, H * 1.5)) / 2 }} />
      {phase === 'heroSelection' && game ? (
        <>
          <div className="tl-demo-bg__caption" style={{ top: H * 0.255 }}>
            Choose your hero
          </div>
          {heroPickCenters(game.heroOptions.length, vp).map((x, i) => {
            const h = game.heroOptions[i];
            const size = Math.round(H * 0.26);
            return (
              <div key={h.cardId} className="tl-demo-bg__pick" style={{ left: x - size / 2, top: H * 0.33, width: size }}>
                <HeroPortrait cardId={h.cardId} size={size} shape="rounded" />
                <span>{h.name}</span>
              </div>
            );
          })}
        </>
      ) : null}

      {(phase === 'recruit' || phase === 'combat') && players.length ? (
        <>
          {players.map((p, i) => {
            const s = slots[i];
            if (!s) return null;
            const size = Math.round(s.height * 0.78);
            return (
              <div key={p.playerId} className="tl-demo-bg__lb" style={{ left: s.left, top: s.top, width: s.width, height: s.height }}>
                <HeroPortrait cardId={p.heroCardId} size={size} dead={p.dead} shape="rounded" ring={p.isLocal ? '#7fd88f' : undefined} />
                {!p.dead ? <span className="tl-demo-bg__lbhp">{p.health + p.armor}</span> : null}
                <span className="tl-demo-bg__lbtier">{p.tavernTier}</span>
              </div>
            );
          })}
          {phase === 'recruit' ? (
            <>
              <div className="tl-demo-bg__bob" style={{ left: vp.width / 2 - H * 0.07, top: H * 0.05, width: H * 0.14, height: H * 0.14 }}>
                <span>Bob</span>
              </div>
              <div className="tl-demo-bg__row" style={{ top: H * 0.29 }}>
                {shop.map((m, i) => (
                  <MinionToken key={i} minion={m} size="lg" tooltip={false} />
                ))}
                {spellsInShop.map((s) => (
                  <div key={s.entityId} className="tl-demo-bg__spell">
                    {db.name(s.cardId)}
                  </div>
                ))}
              </div>
            </>
          ) : opponent ? (
            <>
              <div className="tl-demo-bg__opphero" style={{ left: vp.width / 2 - H * 0.07, top: H * 0.13 }}>
                <HeroPortrait cardId={opponent.heroCardId} size={Math.round(H * 0.14)} shape="rounded" />
              </div>
              <div className="tl-demo-bg__row" style={{ top: H * 0.33 }}>
                {(game?.battle.input?.opponent.minions ?? opponent.lastBoard?.minions ?? []).map((m) => (
                  <MinionToken key={m.entityId} minion={m} size="lg" tooltip={false} />
                ))}
              </div>
            </>
          ) : null}
          <div className="tl-demo-bg__row" style={{ top: H * 0.53 }}>
            {(game?.localBoard ?? []).map((m) => (
              <MinionToken key={m.entityId} minion={m} size="lg" tooltip={false} />
            ))}
          </div>
          {local ? (
            <div className="tl-demo-bg__myhero" style={{ left: vp.width / 2 - H * 0.075, top: H * 0.74 }}>
              <HeroPortrait cardId={local.heroCardId} size={Math.round(H * 0.15)} shape="rounded" />
            </div>
          ) : null}
        </>
      ) : null}

      {trinkets.length ? (
        // The game's trinket offer: a dimmed board with the trinket cards across the middle.
        <div className="tl-demo-bg__offer">
          <div className="tl-demo-bg__caption" style={{ top: H * 0.3 }}>
            Choose a Lesser Trinket
          </div>
          {trinketPickLayout(trinkets.length, vp, scale).centers.map((x, i) => {
            const size = Math.round(H * 0.17);
            return (
              <div key={trinkets[i].entityId} className="tl-demo-bg__trinket" style={{ left: x - size / 2, top: H * 0.38, width: size }}>
                <span className="tl-demo-bg__trinketart" style={{ width: size, height: size }}>
                  <CardArt cardId={trinkets[i].cardId} name={trinkets[i].name} />
                </span>
                <span>{trinkets[i].name}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {phase === 'gameOver' || phase === 'idle' ? <div className="tl-demo-bg__caption" style={{ top: H * 0.12 }}>{phase === 'idle' ? 'Main menu' : 'Game over'}</div> : null}
      <div className="tl-demo-bg__label">Browser demo · placeholder game backdrop (not part of the overlay)</div>
    </div>
  );
}
