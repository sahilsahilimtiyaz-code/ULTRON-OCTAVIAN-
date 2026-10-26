/** Top status strip: signal, clock, encrypted link state, battery. */
import { useEffect, useState } from 'react';
import { useStore } from '../core/store';

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(iv);
  }, []);
  return now
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
    .toUpperCase();
}

interface BatteryInfo { level: number }
type BatteryNav = Navigator & { getBattery?: () => Promise<BatteryInfo> };

function useBattery(): number {
  const [lvl, setLvl] = useState(0.87);
  useEffect(() => {
    let cancelled = false;
    const nav = navigator as BatteryNav;
    nav.getBattery?.().then((b) => {
      if (!cancelled) setLvl(b.level);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return lvl;
}

export default function StatusBar() {
  const clock = useClock();
  const battery = useBattery();
  const net = useStore((s) => s.netStatus);
  const linkText = net === 'online' ? 'ENCRYPTED' : 'LOCAL ONLY';

  return (
    <div className="statusbar" role="status">
      <div className="sb-left">
        <span className="sb-signal" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
        <span className="sb-hightech">HIGH-TECH</span>
      </div>
      <div className="sb-clock">{clock}</div>
      <div className="sb-right">
        <span className={`sb-link ${net === 'online' ? '' : 'sb-off'}`}>{linkText}</span>
        <span className="sb-batt" aria-label={`Battery ${Math.round(battery * 100)} percent`}>
          <span className="sb-batt-body">
            <span className="sb-batt-fill" style={{ width: `${Math.round(battery * 100)}%` }} />
          </span>
          <span className="sb-batt-cap" />
        </span>
      </div>
    </div>
  );
}
