import React from 'react';
import type { ReactNode } from 'react';

export interface IconProps { size?: number; className?: string }
function S({ size = 14, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}
export const IcPlay = (p: IconProps) => (<S {...p}><path d="M7 4.5 19 12 7 19.5Z" /></S>);
export const IcPause = (p: IconProps) => (<S {...p}><path d="M7 4.5v15M17 4.5v15" /></S>);
export const IcTrash = (p: IconProps) => (
  <S {...p}><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" /></S>
);
export const IcScissors = (p: IconProps) => (
  <S {...p}><circle cx="6" cy="6.5" r="2.7" /><circle cx="6" cy="17.5" r="2.7" /><path d="M8.3 8 20 18M8.3 16 20 6" /></S>
);
export const IcDown = (p: IconProps) => (<S {...p}><path d="M12 3v12M6.5 10.5 12 16l5.5-5.5M4 20h16" /></S>);
export const IcX = (p: IconProps) => (<S {...p}><path d="M5 5l14 14M19 5 5 19" /></S>);
export const IcPrint = (p: IconProps) => (
  <S {...p}><path d="M7 8V3h10v5M4 8h16v8h-3v5H7v-5H4zM7 16h10" /></S>
);
export const IcBolt = (p: IconProps) => (<S {...p}><path d="M13 2 4.5 14H11l-1.5 8L18 10h-6.5L13 2Z" /></S>);
export const IcGrid = (p: IconProps) => (<S {...p}><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></S>);
export const IcLayers = (p: IconProps) => (<S {...p}><path d="m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5" /></S>);
export const IcHammer = (p: IconProps) => (
  <S {...p}><path d="M14 4 6 12l3 3 8-8M4 21l5-5M14 4l3-1 4 4-1 3-3-3" /></S>
);
export const IcMoon = (p: IconProps) => (<S {...p}><path d="M20 13.5A8.5 8.5 0 1 1 10.5 4a7 7 0 0 0 9.5 9.5Z" /></S>);
export const IcSun = (p: IconProps) => (
  <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></S>
);
export const IcChevL = (p: IconProps) => (<S {...p}><path d="M14.5 5 8 12l6.5 7" /></S>);
export const IcChevR = (p: IconProps) => (<S {...p}><path d="M9.5 5 16 12l-6.5 7" /></S>);

export function Led({ running, pulse = false }: { running: boolean; pulse?: boolean }) {
  return (
    <span
      className={`inline-block h-3 w-3 rounded-full ${running ? 'anim-led bg-[#7ebe5c]' : pulse ? 'anim-led bg-[#e8b341]' : 'bg-verm'}`}
      aria-hidden="true"
    />
  );
}

export function Meter({ score }: { score: number }) {
  const tone = score >= 80 ? 'bg-ultra' : score >= 60 ? 'bg-moss' : 'bg-verm';
  return (
    <span className="inline-block h-2 w-12 border border-[var(--line)]/50 bg-[var(--line)]/10" aria-hidden="true">
      <span className={`block h-full ${tone}`} style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
    </span>
  );
}

export function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} title={hint}
      className="group flex w-full items-center justify-between gap-2 py-1 text-left">
      <span className={`font-mono text-[10px] font-semibold tracking-[0.2em] ${on ? 'text-[var(--fg)]' : 'text-[var(--mut)]'}`}>{label}</span>
      <span className={`relative inline-block h-4 w-8 shrink-0 border-2 border-[var(--line)] transition-colors ${on ? 'bg-moss' : 'bg-[var(--line)]/15'}`}>
        <span className={`absolute top-0 h-3 w-3 bg-[var(--panel2)] transition-all ${on ? 'left-4' : 'left-0'}`} />
      </span>
    </button>
  );
}

export function Stamp({ kind, score }: { kind: 'pass' | 'reject' | 'tray'; score?: number }) {
  if (kind === 'pass') return <span className="stamp text-ultra">PASS {score ?? ''}</span>;
  if (kind === 'reject') return <span className="stamp text-verm">BIN</span>;
  return <span className="stamp text-moss">CUT ✓</span>;
}

export function SourceChip({ code, hue }: { code: string; hue: number }) {
  return (
    <span className="inline-flex max-w-[120px] items-center gap-1 border border-[var(--line)]/40 bg-[var(--panel)] px-1.5 py-px font-mono text-[9px] font-semibold tracking-[0.08em] text-[var(--fg2)]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: `hsl(${hue} 72% 44%)`, boxShadow: `0 0 4px hsl(${hue} 72% 44% / 0.8)` }} />
      <span className="truncate">{code}</span>
    </span>
  );
}

/* Error boundary — one jammed view must never white-screen the machine. */
interface EBProps { label: string; children: ReactNode; onReset?: () => void }
interface EBState { err: Error | null }
export class ErrorBoundary extends React.Component<EBProps, EBState> {
  state: EBState = { err: null };
  static getDerivedStateFromError(err: Error): EBState { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="grid min-h-[60vh] place-items-center px-6">
        <div className="max-w-lg border-2 border-verm bg-[var(--panel)] p-6 shadow-[6px_6px_0_var(--shadow-ink)]">
          <div className="font-display text-2xl font-extrabold text-verm">{this.props.label} — MISFEED</div>
          <p className="mt-2 break-words font-mono text-[11px] leading-relaxed text-[var(--fg2)]">
            {this.state.err.message || 'an unknown jam occurred'}
          </p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => this.setState({ err: null })}
              className="border-2 border-[var(--line)] bg-[var(--fg)] px-3 py-1.5 font-mono text-[11px] font-bold text-[var(--bg)] hover:bg-verm hover:border-verm">
              RETRY
            </button>
            <button type="button" onClick={() => { this.props.onReset?.(); this.setState({ err: null }); }}
              className="border-2 border-[var(--line)] px-3 py-1.5 font-mono text-[11px] font-bold text-[var(--fg)] hover:bg-verm hover:border-verm hover:text-[#f5f1e3]">
              WIPE SAVED STATE
            </button>
          </div>
        </div>
      </div>
    );
  }
}
