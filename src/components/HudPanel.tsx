/**
 * Red translucent HUD panel with glowing corner brackets, matching the design.
 */
import type { ReactNode } from 'react';

export default function HudPanel({
  className = '',
  children,
  label,
}: {
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <section className={`hud-panel ${className}`} aria-label={label}>
      <i className="c c1" aria-hidden="true" />
      <i className="c c2" aria-hidden="true" />
      <i className="c c3" aria-hidden="true" />
      <i className="c c4" aria-hidden="true" />
      {children}
    </section>
  );
}

/** Consistent panel header: mono eyebrow, title, optional status slot. */
export function PanelHead({
  kicker,
  title,
  right,
}: {
  kicker: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="panel-head">
      <div className="panel-head-l">
        <span className="panel-kicker">{kicker}</span>
        <h2 className="panel-title">{title}</h2>
      </div>
      {right}
    </div>
  );
}
