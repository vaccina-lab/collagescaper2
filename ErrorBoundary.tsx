import { Component, type ReactNode } from 'react';

/* a single misfiring mode must never white-screen the whole machine —
   each tab renders inside its own boundary with a recovery path. */
export class ErrorBoundary extends Component<
  { label: string; onReset?: () => void; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[SALVAGE/9] ${this.props.label} misfeed:`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="mx-auto grid max-w-[640px] place-items-center px-4 py-24">
          <div className="w-full border-2 border-verm bg-[var(--panel)] p-6 text-center shadow-[6px_6px_0_var(--shadow-ink)]">
            <div className="stamp mx-auto w-fit text-verm">MISFEED</div>
            <h2 className="mt-4 font-display text-2xl font-extrabold text-[var(--fg)]">
              {this.props.label} JAMMED
            </h2>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-[var(--fg2)]">
              {this.state.error.message || 'an unknown fault in the mechanism'}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="border-2 border-[var(--line)] bg-[var(--fg)] px-4 py-2 font-mono text-[11px] font-bold tracking-[0.16em] text-[var(--bg)] transition-colors hover:bg-ultra hover:border-ultra hover:text-[#f5f1e3]"
              >
                ⟳ RETRY
              </button>
              {this.props.onReset && (
                <button
                  type="button"
                  onClick={() => { this.props.onReset?.(); this.setState({ error: null }); }}
                  className="border-2 border-verm px-4 py-2 font-mono text-[11px] font-bold tracking-[0.16em] text-verm transition-colors hover:bg-verm hover:text-[#f5f1e3]"
                >
                  WIPE SAVED STATE
                </button>
              )}
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
