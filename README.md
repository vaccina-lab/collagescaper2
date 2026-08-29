# collagescraper

Curated Image Scraping Automation — SALVAGE/9 UI and crawler.

Quick start

1. Install dependencies

   npm ci

2. Typecheck

   npm run typecheck

3. Start dev server

   npm run dev

Notes

- The project uses TypeScript + Vite + React. The TypeScript config includes repository root files so TSC will see the .ts/.tsx files in the repository root.
- If you see missing module or type errors, run `npm ci` first then `npm run typecheck` and paste the output if you'd like me to continue fixing errors.

Repository layout (top-level)

- main.tsx, App.tsx — application entry and root component
- *.tsx/.ts — UI components and core logic at the repository root
- lib/ — thin re-export shims to the real top-level modules (engine.ts, types.ts, etc.) to preserve relative imports
- components/ — re-export shims that map to the top-level component files (ui.tsx, chrome.tsx, floor.tsx, studios.tsx)

If you'd like I will continue running typecheck and fixing any remaining errors and push commits to `main` until the project is clean.
