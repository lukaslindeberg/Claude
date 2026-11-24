import clsx from 'clsx';
import type { ReactNode } from 'react';

export function SectionHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="tl-sechead">
      <div>
        <h1 className="tl-sechead__title">{title}</h1>
        {subtitle ? <p className="tl-sechead__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="tl-sechead__actions">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, extra, children, className, pad = true }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx('tl-card', !pad && 'is-flush', className)}>
      {title || extra ? (
        <header className="tl-card__head">
          {title ? <h2 className="tl-card__title">{title}</h2> : <span />}
          {extra}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'gold' | 'good' | 'bad' }) {
  return (
    <div className={clsx('tl-kpi', tone && `is-${tone}`)}>
      <span className="tl-kpi__label">{label}</span>
      <span className="tl-kpi__value">{value}</span>
      {hint ? <span className="tl-kpi__hint">{hint}</span> : null}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="tl-seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={clsx('tl-seg__btn', o.value === value && 'is-on')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="tl-empty">
      <div className="tl-empty__title">{title}</div>
      {children ? <div className="tl-empty__body">{children}</div> : null}
    </div>
  );
}
