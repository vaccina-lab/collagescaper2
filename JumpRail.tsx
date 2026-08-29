import { useEffect, useState } from 'react';
import type { View } from './Header';

const SECTIONS = [
  { id: 'control', label: 'CONTROL' },
  { id: 'intake', label: 'INTAKE' },
  { id: 'tray', label: 'TRAY' },
] as const;

export function JumpRail({ view, onGoLab }: { view: View; onGoLab: () => void }) {
  const [active, setActive] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (view !== 'floor') return;
    const els = SECTIONS.map(s => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
    }, { rootMargin: '-35% 0px -55% 0px' });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [view]);

  if (view !== 'floor') return null;

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    setActive(id);
    setFlash(id);
    window.setTimeout(() => setFlash(f => (f === id ? null : f)), 400);
  };

  return (
    <nav aria-label="jump to section" className="fixed right-3 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-1.5 lg:flex">
      {SECTIONS.map(s => (
        <button
          key={s.id}
          type="button"
          onClick={() => jump(s.id)}
          title={s.label}
          className={`group relative flex h-8 w-8 items-center justify-center border-2 transition-all duration-150 ${
            active === s.id
              ? 'border-verm bg-verm text-[#f5f1e3]'
              : 'border-[var(--line)]/40 bg-[var(--panel)]/85 text-[var(--fg2)] hover:border-[var(--line)]'
          } ${flash === s.id ? 'scale-110' : ''}`}
        >
          <span className="font-mono text-[9px] font-bold">{s.label[0]}</span>
          <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap border border-[var(--line)] bg-[var(--fg)] px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.18em] text-[var(--bg)] group-hover:block">
            {s.label}
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={onGoLab}
        title="GLITCH LAB"
        className="flex h-8 w-8 items-center justify-center border-2 border-ultra/50 bg-[var(--panel)]/85 text-ultra transition-all duration-150 hover:border-ultra hover:bg-ultra hover:text-[#f5f1e3]"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4.5 14H11l-1.5 8L18 10h-6.5L13 2Z" /></svg>
      </button>
    </nav>
  );
}
