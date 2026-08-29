# SALVAGE/9 — handoff spec

> **Environment note:** this workspace gets reset between sessions by the
> environment, NOT by the assistant. If you are the user: keep your own copy
> (`git init && git add -A && git commit`, or zip the folder) after any build
> you like — that backup survives every reset. If you are a future assistant:
> this doc + the file map below is the rebuild blueprint. **The canonical tap
> list lives in `src/lib/engine.ts` → `BUILTIN_DEFS` and has 40 taps. Do not
> truncate it to save budget — a short list is a user-visible regression.**

## What it is

Autonomous collage-material harvester + damage/paste-up suite, 100% client-side.
TypeScript + React 18 + Vite 6 + Tailwind CSS v4. Deps: `jszip` (ZIP batch),
`@huggingface/transformers` (RMBG cutout, code-split, never in startup bundle).
No Python, no backend, no API keys. Scraping = browser `fetch()` against
keyless CORS-open APIs: Openverse, Wikimedia Commons, Met, Cleveland, AIC, V&A.

## The 44 taps (12 lineages)

patent: **Patent Machines, FRINGE BUREAU** (unhinged filings, `policy:'open'`),
**SPACETIME BUREAU** (antigravity/tachyons, `policy:'open'`), Press Room ·
anatomy: Anatomy Atlas, Herbarium Vault, Bone Yard, Vesalius Bones,
**Optic Vault** (`policy:'open'`) · webcore: Webcore Shrines, Lost Malls,
Dead Mail · stars: **Star Charts ⏻dark**, **Celestial Atlases ⏻dark**,
Orb Depot · tarot: **Tarot Arcana ⏻dark**, **Minor Arcana ⏻dark**,
CHAOS ENGINE, Alembic Archive, GRIMOIRE CUTS, Crossworks · dore:
**Doré Inferno, Doré London**, Burin Bureau, BESTIARY (`policy:'open'`) ·
geometry: Sacred Geometry, Polyhedra Nets, Plot Bureau, GRID CHURCH ·
arch: Arch Plates, Piranesi Vaults · grim: Grim Engravings ·
retro: Retro Futures · vhs: CRT Altars, VHS Ghosts, Static Séances ·
meme lane: BOSCH WELL, FOUND TEXT, GREEN CROSS, CURSED FEED, SIGNAL TEXT,
CORPO-SLUDGE, ODDITIES CASE, CURSED LORE.

⏻dark = user asked for less of these; mounted off by default, toggleable.
`policy:'open'` = hunt flickr/rawpixel/europeana, not museums.

## Hard-won invariants (each caused a real incident)

- **Queue pacing:** throttled no-op ≠ dry well → return without rotating the
  vein. Real empty answer → rotate vein, resume at random mid-page. All-dupes
  answer → walk the page forward. Per-tap walk cursor persisted
  (`salvage9.cursor.v1`); never restart at page 1.
- **Dual-key dedupe:** id ring + content-URL ring (cap 10k) so one image can't
  repeat under different ids/mirrors.
- **Filter stack order** (`allowedItem` in remote.ts): hard bans
  (cars/geo/guitars/Rick&Morty) → night-sky → **sport/activity people on every
  lineage** (tech terms escape) → AI-markers (title+credit) → text pages →
  cover/genre soft-bans w/ art-proof → military people (tech escapes) →
  cosplay w/ art/artist/institutional proof → person words w/ ART/ARTIST/
  INSTITUTIONAL escape. Meme lane is exempt from the flesh rule (it wants
  cursed people-photos).
- **Grading:** metadata first (`gradePlate`: base 36 + res + source tier +
  art-words + relevance capped +9 + archival license + long title − junk);
  unknown dims earn +10 not 0. Raster sentry refines ±8 only. Good plates
  72–93, junk 38–40, gate ~72. Meme lineage judged at gate−18, floor-exempt.
- **Cutout = a ROUTED pipeline** (`cutout.ts`), and the routing is the part
  people keep breaking. Three tools, each only for its case:
  · `inkMatte` — ONLY for clean engravings (high `engravingConfidence` AND
    `coarseInkFraction < 0.5`, i.e. ink is a minority of the frame). Keeps
    strokes/hatching, drops paper. **Enclosed paper holes stay TRANSPARENT
    unless they contain faint hatching ink** (mean ink ≥ 0.10) — this is what
    keeps letter counters (O/P/D) and geometric interiors (triangles) open
    while hatched figures read solid. Do NOT fill every enclosed hole.
  · **Dense engravings** (`engravingConfidence ≥ 0.62` AND `coarseInkFraction
    ≥ 0.5` — a Vesalius plate, a Doré Inferno) MUST skip inkMatte and
    backgroundFlood and go to the semantic MODEL. The ink matte would keep ALL
    the ink = "everything", which is the "wall not removed" complaint.
  · `backgroundFlood` — solid/graded flat backgrounds (stickers, flat
    illustration, berries-on-leaf), then `removeInteriorFlatRegions` for the
    "cut the flat card interior too" second pass.
  · Everything else → RMBG-2.0 (1.4 fallback) + crop-and-refine when subject
    <55% of frame. Coverage guard (<1.5% or >94% kept → throw → fall back).
  · `removeSkyAndGround` runs after the matte (model + ink paths): peels sky
    above / safe ground below the subject. Safety = dilated "subject core"
    guard (textured pixels); only smooth or purely-horizontal-hatched pixels
    connected to the bbox top/bottom and OUTSIDE the guard are removed.
    Ground only removed when its tone differs from the core mean by >22 lum
    (never eats a same-tone smooth subject). Engraved sky = horizontal hatch.
  **Isolation robustness (fixes "only 1/10 plates get cut"):**
  · Model path uses a LENIENT crop (`tightCrop(c, 0.012, 0.0002)` fallback) so a
    sparse-but-present matte still yields a cut; only a truly empty matte throws.
  · `gradeCutout` softened: tiny-but-real subjects (coverage 0.01–0.04) score ~24 not
    ~8; only <20 opaque px scores 8. Real cuts still grade ~90.
  · `isoPump` SELF-RESCHEDULES in its `finally` (closes the strand gap where a cut-gate
    re-run enqueued plates but no live pump picked them up).
  · Diagnostics: `isoStats` counts cut/full-plate/threw; a `isolation: N/M cut (P%)`
    line logs every 15 plates. If the cut rate is low, READ THIS LINE to see whether
    plates are failing (full-plate) or erroring (threw).
  **Insides of objects:** `removeInteriorFlatRegions` only removes a nested region that
    is big AND flat AND paper-bright (mean lum ≥185). A subject's own interior (face,
    logo counter, dark shape) is always kept. Model path preserves interiors (refineMatte
    fills enclosed holes).
  `gradeCutout` is a SEPARATE scale over opaque pixels only. Exports honor
  `cutoutSrc` first (PNG, never JPEG). Do NOT read a color channel as alpha;
  RMBG-2.0 emits raw logits → sigmoid-detect before thresholding.
- **Blank/corrupt plates never reach the tray or the ZIP.** Two guards:
  (1) `engine.ts` `probe.onerror` — if a thumbnail refuses to load, the plate
  is dropped from feed AND tray immediately (it would render blank and
  download as a broken file). (2) `exporter.ts` `blobIsUsableImage` — a
  fetched blob must decode into a real image ≥16×16 and ≥200 bytes, else it
  is skipped and counted as `failed` (the "tiny jpg icon" files were corrupt
  blobs that passed the old `size > 0` check).
- **Cutout has fast/fine quality tiers.** `isolateFromUrl(url, quality, maxDim)`:
  `fast` = single inference pass (auto-isolate uses `fast` @1024); `fine` adds
  the crop-and-refine second pass (desk can use for sharper small subjects).
  Do NOT run crop-and-refine in the auto path — it doubles inference time.
- **Inference runs in a Web Worker** (`lib/isolate.worker.ts`, code-split).
  The main thread only does light compositing. The isolation pump in
  `engine.ts` processes one plate at a time and **pauses while the tab is
  hidden** (resumes on `visibilitychange`) — this is what fixes "crashes when
  I tab away / freezes while crawling". Do NOT move inference back onto the
  main thread or remove the hidden-pause.
- **NEVER move scrollbars programmatically.** Feed = manual columns, plates
  append to shortest column's bottom; tray appends. Only user-initiated jumps
  (FRESH ON THE BELT beacon, log ▼ TAIL chip). Lightbox ← / → browse the tray.
- **Save paths:** desktop Chrome → FS Access picker at click-time; iPad Safari
  → tappable SAVE ARCHIVE chip; iOS share sheet needs live gesture activation.
  ZIP validates by MAGIC BYTES; re-encode corrupt/WebP/TIFF (never trust
  blob.type/extension).
- **WebKit-safe glitch lab:** no `ctx.filter`, no `OffscreenCanvas`, no
  `createImageBitmap(ImageData)` — pixel math or downscale-blur. 24 signed
  (±100) channels, seeded; PIXEL pipeline + COMPOSITE fallback.
- Every mode wrapped in its own ErrorBoundary; `main.tsx` boot-crash catcher
  prints the real error + WIPE SAVED STATE. localStorage loaders are paranoid
  (stale shapes degrade to defaults, never throw).

## File map

| file | owns |
| --- | --- |
| `lib/remote.ts` | 6 mirrors w/ rate windows, LiveQueue, filter stack, `gradePlate`, sentry `analyzePlate` |
| `lib/engine.ts` | **BUILTIN_DEFS (44 taps)**, tick loop, taste gate, tray (cap 2000, auto-HOLD at full), crawl log, settings |
| `lib/cutout.ts` | RMBG-2.0 + ink-matte, `gradeCutout`, `onIsoProgress` |
| `lib/glitch.ts` | 24-channel signed glitch engine |
| `lib/collage.ts` | desk: layers/geometry/hit-test, FX bench, ink, snap, press |
| `lib/exporter.ts` | sheet PNG, single PNG, ZIP batch (magic-byte validation, FS Access) |
| `lib/keepawake.ts` | silent audio + Web Lock + worker heartbeat (background harvesting) |
| `components/chrome.tsx` | Header (mode switch + ticker), ControlRail, JumpRail |
| `components/floor.tsx` | Feed, TrayRail, Lightbox (←/→ tray browse) |
| `components/studios.tsx` | GlitchLab, Paste-Up Desk, Brush Forge |
| `components/ui.tsx` | icons, Toggle, Meter, Stamp, ErrorBoundary |

## Run

`npm install && npm run dev` (Node 20+). `npm run build` → static `dist/`.
LAN: `npm run dev -- --host`. Keyboard: F floor · G lab · D desk · B forge.
Keys: `salvage9.{tray,sources,settings,desk,cursor,night}.v1`.
