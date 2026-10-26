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
