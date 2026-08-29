import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCrawler } from './lib/engine';
import type { Specimen } from './lib/types';
import type { Family } from './lib/types';
import { exportSingle, exportTrayBatch, exportTraySheet } from './lib/exporter';
import { ErrorBoundary } from './components/ui';
import { ControlRail, Header, JumpRail, type View } from './components/chrome';
import { Feed, Lightbox, TrayRail, type BatchProgress } from './components/floor';
import { BrushForge, CollageDesk, GlitchLab } from './components/studios';

function Ambient() {
  return (
    <>
      <div className="ambient" aria-hidden="true" />
      <svg className="ambient-mark" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="0.5" />
        <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" strokeWidth="0.4" />
        <path d="M50 2v96M2 50h96" stroke="currentColor" strokeWidth="0.4" />
        <path d="M16 16l68 68M84 16l-68 68" stroke="currentColor" strokeWidth="0.3" />
      </svg>
      <div className="noise-layer" aria-hidden="true" />
    </>
  );
}

function viewFromHash(): View {
  if (window.location.hash.startsWith('#/lab')) return 'lab';
  if (window.location.hash.startsWith('#/desk')) return 'desk';
  if (window.location.hash.startsWith('#/forge')) return 'forge';
  return 'floor';
}

export default function App() {
  const c = useCrawler();
  const [view, setView] = useState<View>(viewFromHash);
  const [night, setNight] = useState(() => { try { return localStorage.getItem('salvage9.night.v1') === '1'; } catch { return false; } });
  const [inspected, setInspected] = useState<Specimen | null>(null);
  const [zap, setZap] = useState<{ sp: Specimen; n: number } | null>(null);
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const [archive, setArchive] = useState<{ url: string; name: string } | null>(null);
  const [busySheet, setBusySheet] = useState(false);
  const archiveRef = useRef(archive);
  useEffect(() => { archiveRef.current = archive; }, [archive]);
  useEffect(() => () => { if (archiveRef.current) URL.revokeObjectURL(archiveRef.current.url); }, []);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('night', night);
    try { localStorage.setItem('salvage9.night.v1', night ? '1' : '0'); } catch {}
  }, [night]);

  const go = useCallback((v: View) => {
    window.location.hash = v === 'lab' ? '#/lab' : v === 'desk' ? '#/desk' : v === 'forge' ? '#/forge' : '#/floor';
    window.scrollTo(0, 0);
  }, []);
  /* global mode shortcuts (don't fire while typing) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'g') go('lab');
      else if (k === 'd') go('desk');
      else if (k === 'b') go('forge');
      else if (k === 'f' || k === 'escape') go('floor');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const trayIds = useMemo(() => new Set(c.tray.map(t => t.id)), [c.tray]);
  const zapToLab = useCallback((sp: Specimen) => { setZap(z => ({ sp, n: (z?.n ?? 0) + 1 })); go('lab'); }, [go]);
  const downloadOne = useCallback(async (sp: Specimen) => {
    try { await exportSingle(sp); c.say('sys', `exported ${sp.code} → png`); }
    catch { c.say('err', `export failed for ${sp.code}`); }
  }, [c]);
  const handleSheet = useCallback(async () => {
    if (busySheet || c.tray.length === 0) return;
    setBusySheet(true);
    try {
      const res = await exportTraySheet(c.tray, c.gate);
      c.say('sys', `sheet pressed — ${res.count} cuts @ ${res.w}×${res.h}`);
    } catch (e) {
      c.say('err', e instanceof Error && e.message.includes('caps') ? e.message : 'sheet export failed');
    } finally { setBusySheet(false); }
  }, [busySheet, c]);
  const handleBatch = useCallback(async (mode: 'full' | 'jpg1400') => {
    if (batch || c.tray.length === 0) return;
    if (archive) { URL.revokeObjectURL(archive.url); setArchive(null); }
    setBatch({ done: 0, total: c.tray.length, failed: 0, mb: 0 });
    c.say('sys', mode === 'jpg1400'
      ? `batch dump started — ${c.tray.length} plates → 1400px JPG`
      : `batch dump started — ${c.tray.length} originals`);
    try {
      const res = await exportTrayBatch(
        c.tray,
        (done, total, failed, mb) => setBatch({ done, total, failed, mb }),
        mode === 'jpg1400' ? { jpg1400: true } : undefined,
      );
      setArchive({ url: res.url, name: res.name });
      setBatch(null);
      const mended = res.failed > 0 ? ` · ${res.failed} blocked` : '';
      c.say('cut', mode === 'jpg1400'
        ? `zip packed — ${res.count} JPGs @1400px (${res.mb} MB)${mended} · SAVE ARCHIVE armed`
        : `zip packed — ${res.count} plates (${res.mb} MB)${mended} · SAVE ARCHIVE armed`);
    } catch {
      setBatch(null);
      c.say('err', 'batch dump failed');
    }
  }, [batch, archive, c]);
  const addTap = useCallback((input: { name: string; query: string; family: Family }) => {
    const err = c.addSource({ name: input.name, code: '', blurb: '', family: input.family, hue: Math.floor(Math.random() * 360), query: input.query });
    if (err) c.say('warn', err);
  }, [c]);

  return (
    <div className="relative min-h-screen">
      <Ambient />
      <div className="relative z-10">
        <Header
          running={c.running} trayHeld={c.trayHeld} uptime={c.uptime} seen={c.stats.seen}
          passRate={c.passRate} gate={c.gate} trayCount={c.tray.length} log={c.log}
          night={night} view={view}
          onToggleRun={c.toggleRun} onToggleNight={() => setNight(n => !n)} onView={go}
        />
        <JumpRail view={view} onGo={go} />

        {view === 'floor' && (
          <main className="mx-auto grid max-w-[1560px] items-start gap-5 px-4 py-5 lg:px-6 xl:grid-cols-[308px_minmax(0,1fr)_292px]">
            <div id="control" className="min-w-0">
              <ErrorBoundary label="CONTROL RAIL">
                <ControlRail
                  defs={c.defs} sources={c.sources} gate={c.gate} cutGate={c.cutGate} autoCut={c.autoCut} autoIso={c.autoIso}
                  showRejects={c.showRejects} pace={c.pace} keepAwake={c.keepAwake} log={c.log} running={c.running}
                  onGate={c.setGate} onCutGate={c.setCutGate} onToggleSource={c.toggleSource} onToggleAutoCut={c.toggleAutoCut}
                  onToggleAutoIso={c.toggleAutoIso} onToggleKeepAwake={c.toggleKeepAwake}
                  onShowRejects={c.setShowRejects} onPace={c.setPace} onAddTap={addTap}
                />
              </ErrorBoundary>
            </div>
            <div id="intake" className="min-w-0">
              <ErrorBoundary label="LIVE INTAKE">
                <Feed
                  feed={c.feed} seen={c.stats.seen} showRejects={c.showRejects} trayIds={trayIds}
                  running={c.running} spm={c.spm}
                  onInspect={setInspected} onCut={c.cut} onBin={c.bin} onZap={zapToLab}
                  onDownload={downloadOne} onPurge={c.purgeFeed}
                />
              </ErrorBoundary>
            </div>
            <div id="tray" className="min-w-0">
              <ErrorBoundary label="CUTTING TRAY" onReset={() => { try { localStorage.removeItem('salvage9.tray.v1'); } catch {} }}>
                <TrayRail
                  tray={c.tray} busy={busySheet} batch={batch} archive={archive} gate={c.gate}
                  keysEnabled={!inspected}
                  onInspect={setInspected} onRemove={c.removeFromTray} onClear={c.clearTray}
                  onCull={c.cullTray} onExport={handleSheet} onBatch={handleBatch}
                />
              </ErrorBoundary>
            </div>
          </main>
        )}

        {view === 'lab' && (
          <ErrorBoundary label="GLITCH LAB">
            <GlitchLab feed={c.feed} tray={c.tray} zap={zap} onLog={c.say} />
          </ErrorBoundary>
        )}
        {view === 'desk' && (
          <ErrorBoundary label="PASTE-UP DESK" onReset={() => { try { localStorage.removeItem('salvage9.desk.v1'); } catch {} }}>
            <CollageDesk tray={c.tray} onLog={c.say} />
          </ErrorBoundary>
        )}
        {view === 'forge' && (
          <ErrorBoundary label="BRUSH FORGE">
            <BrushForge onLog={c.say} />
          </ErrorBoundary>
        )}

        {inspected && (
          <Lightbox
            sp={inspected} tray={c.tray} pace={c.pace} onPace={c.setPace}
            onClose={() => setInspected(null)}
            onCut={() => { c.cut(inspected); }}
            onBin={() => { c.bin(inspected.id); setInspected(null); }}
            onDownload={() => downloadOne(inspected)}
            onSelect={setInspected}
          />
        )}
      </div>
    </div>
  );
}
