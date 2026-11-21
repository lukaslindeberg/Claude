import { describe, expect, it } from 'vitest';
import { RendererLogSink, sanitizeRendererLog } from '../../src/main/diagnostics/rendererLog';

function sink(now: () => number) {
  const out: Array<[string, string, unknown[]]> = [];
  const s = new RendererLogSink({ now, write: (level, scope, args) => out.push([level, scope, args]) });
  return { s, out };
}

describe('renderer log intake', () => {
  it('validates and truncates payloads', () => {
    expect(sanitizeRendererLog('fatal', 'x', 'msg')).toBeUndefined();
    expect(sanitizeRendererLog('error', 'x', '')).toBeUndefined();
    expect(sanitizeRendererLog('error', 'x', 42)).toBeUndefined();
    const ev = sanitizeRendererLog('error', 'widget:tier list<script>', 'm'.repeat(5000), { stack: 'at x' })!;
    expect(ev.scope).toBe('widget:tier_list_script_');
    expect(ev.message.length).toBeLessThan(4010);
    expect(ev.data).toBe('{"stack":"at x"}');
    expect(sanitizeRendererLog('warn', undefined, 'm')!.scope).toBe('renderer');
  });

  it('rate-limits each window to 50 per minute and reports the dropped count', () => {
    let t = 0;
    const { s, out } = sink(() => t);
    for (let i = 0; i < 80; i++) s.handle(1, 'overlay', 'error', 'window', `boom ${i}`);
    for (let i = 0; i < 5; i++) s.handle(2, 'companion', 'error', 'window', `other ${i}`);
    expect(s.accepted).toBe(55);
    expect(s.dropped).toBe(30);
    expect(out.filter(([, scope]) => scope === 'renderer:overlay/window')).toHaveLength(50);
    expect(out[0]).toEqual(['error', 'renderer:overlay/window', ['boom 0']]);
    expect(s.isForwarding(1)).toBe(true);
    expect(s.isForwarding(3)).toBe(false);

    t = 61_000;
    s.handle(1, 'overlay', 'warn', 'sim', 'later', { turn: 3 });
    const tail = out.slice(-2);
    expect(tail[0]).toEqual(['warn', 'renderer:overlay', ['30 more messages from this window in the previous minute were dropped (rate limit)']]);
    expect(tail[1]).toEqual(['warn', 'renderer:overlay/sim', ['later', '{"turn":3}']]);
  });

  it('drain() reports drops of windows that went quiet', () => {
    let t = 0;
    const { s, out } = sink(() => t);
    for (let i = 0; i < 52; i++) s.handle(7, 'overlay', 'info', 'x', `m${i}`);
    t = 60_000;
    s.drain(() => 'overlay');
    expect(out[out.length - 1]).toEqual(['warn', 'renderer:overlay', ['2 messages from this window were dropped (rate limit)']]);
  });
});
