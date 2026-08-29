import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Specimen } from './lib/types';
import { useCrawler } from './lib/engine';
import { ErrorBoundary } from './components/ui';
import { Header, ControlRail, JumpRail, type View } from './components/chrome';
import { Feed, TrayRail, Lightbox, exportTrayBatch, exportTraySheet, exportSingle, exportCutoutBatch, type BatchProgress } from './components/floor';
import { GlitchLab, CollageDesk, BrushForge } from './components/studios';

const viewFromHash = (): View => {
  const h = window.location.hash;
  if (h.startsWith('#/lab')) return 'lab';
  if (h.startsWith('#/desk')) return 'desk';
  if (h.startsWith('#/forge')) return 'forge';
  return 'floor';
};

function Ambient() {
  return (
    <>
      <div className="ambient" aria-hidden="true" />
      <div className="ambient-glow" aria-hidden="true" />
      <svg className="ambient-mark" viewBox="0 0 560 560" aria-hidden="true">
        <circle cx="280" cy="280" r="270" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="280" cy="280" r="210" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4 8" />
        <path d="M280 10v540M10 280h540" stroke="currentColor" strokeWidth="1" />
        <circle cx="280" cy="280" r="6" fill="currentColor" />
      </svg>
    </>
  );
}

export default function App() {
  const c = useCrawler();
  const [view, setView] = useState<View>(viewFromHash);
  const [night, setNight] = useState(() => {
    try { return localStorage.getItem('salvage9.night.v1') === '1'; } catch { return false; }
  });
  const [inspected, setInspected] = useState<Specimen | null>(null);
  const [zap, setZap] = useState<{ sp: Specimen; n: number } | null>(null);
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const [archive, setArchive] = useState<{ url: string; name: string } | null>(null);
  const [busySheet, setBusySheet] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('night', night);
    try { localStorage.setItem('salvage9.night.v1', night ? '1' : '0'); } catch { /* noop */ }
  }, [night]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') window.location.hash = '#/floor';
      else if (k === 'g') window.location.hash = '#/lab';
      else if (k === 'd') window.location.hash = '#/desk';
      else if (k === 'b') window.location.hash = '#/forge';
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const trayIds = useMemo(() => new Set(c.tray.map(t => t.id)), [c.tray]);

  const zapToLab = useCallback((sp: Specimen) => {
    setZap({ sp, n: (zap?.n ?? 0) + 1 });
    window.location.hash = '#/lab';
  }, [zap]);

  const downloadOne = useCallback((sp: Specimen) => {
    void exportSingle(sp).then(() => c.say('cut', `exported ${sp.code} @1400px jpg`)).catch(() => c.say('err', `export failed — ${sp.code} (CORS)`));
  }, [c]);

  const handleBatch = useCallback(async (mode: 'full' | 'jpg1400' | 'cutouts') => {
    if (batch) return;
    const items = mode === 'cutouts' ? c.tray.filter(t => !!t.cutoutSrc) : c.tray;
    if (items.length === 0) {
      c.say('warn', mode === 'cutouts' ? 'no isolated cutouts in the tray yet' : 'tray is empty');
      return;
    }
    if (archive) { URL.revokeObjectURL(archive.url); setArchive(null); }
    setBatch({ done: 0, total: items.length, failed: 0, mb: 0 });
    const modeLabel = mode === 'cutouts' ? 'CUTOUTS' : mode === 'jpg1400' ? 'JPG-1400' : 'FULL';
    c.say('sys', `batch ${modeLabel} dump — ${items.length} ${mode === 'cutouts' ? 'cutouts' : 'plates'}`);
    try {
      const res = mode === 'cutouts'
        ? await exportCutoutBatch(items, (done, total, failed, mb) => setBatch({ done, total, failed, mb }))
        : await exportTrayBatch(items, (done, total, failed, mb) => setBatch({ done, total, failed, mb }),
            mode === 'jpg1400' ? { jpg1400: true } : undefined);
      const url = URL.createObjectURL(res.blob);
      setArchive({ url, name: res.name });
      setBatch(null);
      c.say('cut', `zip packed — ${res.count} ${mode === 'cutouts' ? 'cutouts' : 'plates'} (${res.mb} MB)${res.failed > 0 ? ` · ${res.failed} skipped` : ''}`);
    } catch {
      setBatch(null);
      c.say('err', 'batch dump failed');
    }
  }, [batch, archive, c]);

  const handleSheet = useCallback(async () => {
    setBusySheet(true);
    try {
      const res = await exportTraySheet(c.tray, c.gate);
      c.say('cut', `sheet pressed — ${res.count} plates @ ${res.w}×${res.h}`);
    } catch { c.say('err', 'sheet export failed'); }
    finally { setBusySheet(false); }
  }, [c]);

  const wipeState = useCallback(() => {
    try {
      ['salvage9.tray.v1', 'salvage9.settings.v1', 'salvage9.sources.v1', 'salvage9.cursor.v1', 'salvage9.night.v1'].forEach(k => localStorage.removeItem(k));
    } catch { /* noop */ }
    window.location.reload();
  }, []);

  return (
    <div className="relative min-h-screen text-[var(--fg)]">
      <Ambient />
      <div className="noise-layer" aria-hidden="true" />
      <div className="relative z-10">
        <Header
          running={c.running} trayHeld={c.trayHeld} uptime={c.uptime} seen={c.stats.seen}
          passRate={c.passRate} gate={c.gate} trayCount={c.tray.length} log={c.log}
          night={night} view={view}
          onToggleRun={c.toggleRun} onToggleNight={() => setNight(n => !n)}
          onView={v => { window.location.hash = v === 'floor' ? '#/floor' : `#/${v}`; }}
        />

        {view === 'floor' && (
          <ErrorBoundary label="SALVAGE FLOOR" onReset={wipeState}>
            <div className="mx-auto grid max-w-[1560px] items-start gap-5 px-4 py-5 lg:px-6 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
              <div id="control"><ControlRail
                defs={c.defs} sources={c.sources} gate={c.gate} cutGate={c.cutGate}
                autoCut={c.autoCut} autoIso={c.autoIso} keepAwake={c.keepAwake} showRejects={c.showRejects}
                pace={c.pace} log={c.log}
                onGate={c.setGate} onCutGate={c.setCutGate} onPace={c.setPace}
                onToggleSource={c.toggleSource} onToggleAutoCut={c.toggleAutoCut}
                onToggleAutoIso={c.toggleAutoIso} onToggleKeepAwake={c.toggleKeepAwake}
                onShowRejects={c.setShowRejects} onAddTap={c.addSource} onRemoveTap={c.removeSource}
              /></div>
              <div id="intake"><Feed
                feed={c.feed} showRejects={c.showRejects} trayIds={trayIds} running={c.running} spm={c.spm}
                onInspect={setInspected} onCut={c.cut} onBin={c.bin} onZap={zapToLab} onDownload={downloadOne} onPurge={c.purgeFeed}
              /></div>
              <div id="tray"><TrayRail
                tray={c.tray} busySheet={busySheet} batch={batch} archive={archive} gate={c.gate}
                onInspect={setInspected} onRemove={c.removeFromTray} onClear={c.clearTray} onCull={c.cullTray}
                onExport={() => void handleSheet()} onBatch={m => void handleBatch(m)}
                onDismissArchive={() => { if (archive) URL.revokeObjectURL(archive.url); setArchive(null); }}
              /></div>
            </div>
            <JumpRail view={view} onGoLab={() => { window.location.hash = '#/lab'; }} />
          </ErrorBoundary>
        )}

        {view === 'lab' && (
          <ErrorBoundary label="GLITCH LAB" onReset={wipeState}>
            <GlitchLab feed={c.feed} tray={c.tray} zap={zap} onLog={c.say} />
          </ErrorBoundary>
        )}

        {view === 'desk' && (
          <ErrorBoundary label="PASTE-UP DESK" onReset={wipeState}>
            <CollageDesk feed={c.feed} tray={c.tray} onLog={c.say} />
          </ErrorBoundary>
        )}

        {view === 'forge' && (
          <ErrorBoundary label="BRUSH FORGE" onReset={wipeState}>
            <BrushForge onLog={c.say} />
          </ErrorBoundary>
        )}

        {inspected && (
          <Lightbox
            sp={inspected} tray={c.tray} pace={c.pace} onPace={c.setPace}
            onClose={() => setInspected(null)}
            onCut={() => { c.cut(inspected); setInspected(null); }}
            onBin={() => { c.bin(inspected.id); setInspected(null); }}
            onDownload={() => downloadOne(inspected)}
            onSelect={setInspected}
          />
        )}
      </div>
    </div>
  );
}
