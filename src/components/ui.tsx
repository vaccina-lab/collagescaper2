import React from 'react';

export interface IconProps { size?: number; className?: string }
function S({ size = 14, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>
  );
}
export const IcPlay = (p: IconProps) => <S {...p}><path d="M6 4l14 8-14 8z" /></S>;
export const IcPause = (p: IconProps) => <S {...p}><path d="M7 4v16M17 4v16" /></S>;
export const IcBolt = (p: IconProps) => <S {...p}><path d="M13 2L4 14h6l-1 8 9-12h-6z" /></S>;
export const IcGrid = (p: IconProps) => <S {...p}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></S>;
export const IcLayers = (p: IconProps) => <S {...p}><path d="M12 2l10 6-10 6L2 8z" /><path d="M2 14l10 6 10-6" /></S>;
export const IcHammer = (p: IconProps) => <S {...p}><path d="M14 4l6 6-3 3-6-6z" /><path d="M11 7L3 15l3 3 8-8" /></S>;
export const IcMoon = (p: IconProps) => <S {...p}><path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" /></S>;
export const IcSun = (p: IconProps) => <S {...p}><circle cx="12" cy="12" r="5" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M18 6l2-2M6 18l-2 2" /></S>;
export const IcScissors = (p: IconProps) => <S {...p}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M8.5 8L20 19M8.5 16L20 5" /></S>;
export const IcTrash = (p: IconProps) => <S {...p}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></S>;
export const IcDown = (p: IconProps) => <S {...p}><path d="M12 3v12M6 11l6 6 6-6M4 21h16" /></S>;
export const IcX = (p: IconProps) => <S {...p}><path d="M5 5l14 14M19 5L5 19" /></S>;
export const IcPrint = (p: IconProps) => <S {...p}><rect x="6" y="2" width="12" height="7" /><rect x="4" y="9" width="16" height="9" /><rect x="7" y="14" width="10" height="8" /></S>;

export function Led({ running, pulse }: { running: boolean; pulse?: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${running ? 'bg-moss anim-led' : pulse ? 'bg-gold anim-led' : 'bg-verm'}`} aria-hidden="true" />;
}

export function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} title={hint}
      className="flex w-full items-center justify-between gap-2 py-1 text-left">
      <span>
        <span className={`block font-mono text-[10.5px] font-bold tracking-[0.14em] ${on ? 'text-[var(--fg)]' : 'text-[var(--mut)]'}`}>{label}</span>
        {hint && <span className="block font-mono text-[8px] text-[var(--mut)]">{hint}</span>}
      </span>
      <span className={`relative h-4 w-8 shrink-0 border border-[var(--line)] transition-colors ${on ? 'bg-moss' : 'bg-[var(--line-soft)]'}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 transition-all ${on ? 'left-4 bg-[var(--panel)]' : 'left-0.5 bg-[var(--panel)]'}`} />
      </span>
    </button>
  );
}

export function Meter({ score }: { score: number }) {
  const color = score >= 75 ? 'bg-moss' : score >= 50 ? 'bg-gold' : 'bg-verm';
  return (
    <span className="inline-block h-1.5 w-14 overflow-hidden bg-[var(--line-soft)]">
      <span className={`block h-full ${color}`} style={{ width: `${Math.min(100, Math.max(4, score))}%` }} />
    </span>
  );
}

export function Stamp({ kind, score }: { kind: 'pass' | 'reject' | 'cut' | 'tray'; score?: number }) {
  const map = { pass: ['PASS', 'text-moss'], reject: ['BIN', 'text-verm'], cut: [`CUT ${score ?? ''}`, 'text-ultra'], tray: ['TRAY', 'text-ultra'] } as const;
  const [txt, cls] = map[kind];
  return <span className={`stamp anim-stamp inline-block ${cls}`}>{txt}</span>;
}

export function SourceChip({ code, hue }: { code: string; hue: number }) {
  return (
    <span className="inline-flex items-center gap-1 border border-[var(--line-soft)] px-1 py-px font-mono text-[8px] font-bold tracking-wider text-[var(--fg2)]">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${hue} 72% 44%)` }} />
      {code}
    </span>
  );
}

export class ErrorBoundary extends React.Component<
  { label: string; onReset?: () => void; children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { label: string; onReset?: () => void; children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="border-2 border-verm bg-[var(--panel)] p-4 text-center">
          <div className="font-display text-lg font-extrabold text-verm">{this.props.label} MISFIRED</div>
          <p className="mt-1 font-mono text-[10px] text-[var(--mut)]">{this.state.error.message}</p>
          <button type="button"
            onClick={() => { this.props.onReset?.(); this.setState({ error: null }); }}
            className="mt-3 border-2 border-[var(--line)] px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">
            RESET &amp; RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
