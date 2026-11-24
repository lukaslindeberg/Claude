export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function pct(v: number | undefined, digits = 1): string {
  if (v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

export function num(v: number | undefined, digits = 1): string {
  if (v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(digits);
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Placement colour class: 1 = gold, 2-4 = green, 5-8 = red-ish. */
export function placementTone(place: number | undefined, duos = false): 'win' | 'top' | 'bottom' | 'none' {
  if (!place) return 'none';
  if (place === 1) return 'win';
  const cut = duos ? 2 : 4;
  return place <= cut ? 'top' : 'bottom';
}

export function placementColor(place: number | undefined, duos = false): string {
  switch (placementTone(place, duos)) {
    case 'win':
      return '#f2c14e';
    case 'top':
      return place === 2 ? '#7fd88f' : place === 3 ? '#5cc47a' : '#46a866';
    case 'bottom':
      return place! >= 7 ? '#d9534f' : '#e07a54';
    default:
      return '#6b7080';
  }
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, today)) return `Today ${time}`;
  if (sameDay(d, yest)) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isToday(ts: number): boolean {
  return sameDay(new Date(ts), new Date());
}

export function duration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function initials(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9' -]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w && !/^(the|of|a)$/i.test(w));
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Deterministic 32-bit hash of a string (for stable fallback colours). */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Card text from hsdata may contain the alternative "improved" text after a
 * `[x]` marker and a trailing counter digit. Keep only the primary text and only
 * <b>, <i> and <br> tags.
 */
export function cleanCardText(text: string | undefined): string {
  if (!text) return '';
  let t = text.split('[x]')[0];
  t = t.replace(/([.!)>])\s*[0-9X]{1,3}$/, '$1');
  t = t.replace(/<(?!\/?(b|i|br)\s*\/?>)[^>]*>/gi, '');
  t = t.replace(/[$#@](\d)/g, '$1');
  // Separate stand-alone keywords ("<b>Taunt</b> <b>Deathrattle:</b> …").
  t = t.replace(/(<b>[^<:]+<\/b>)\s+(?=<b>)/g, '$1 · ');
  return t.trim();
}

export function plainText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
}
