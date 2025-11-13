# Markdown Viewer

Lean Electron + React desktop app for browsing local or remote Markdown (including Mermaid diagrams) with tabbed viewing.

## Features

- Open Markdown from disk, command-line arguments, or arbitrary URLs.
- Tabbed interface with source info and quick close controls.
- Mermaid diagrams rendered inline via a custom remark plugin.
- React Markdown + GFM support for tables, task lists, etc.
- Hyperlink interception:
  - Markdown links open inside the app (resolving local files or remote URLs, including relative paths).
  - Other internet links launch in the default browser.
- Command-line files/URLs open automatically at launch; additional invocations reuse the same window.

## Getting started

```bash
npm install
# During development: renderer + electron in watch mode
npm run dev
```

`npm run dev` starts the renderer dev server and Electron using electron-vite. The window reloads automatically as you edit code.

### Building for production

```bash
npm run build
```

Artifacts land in `dist/` (main, preload, and renderer bundles). Run them with `npm run preview` (electron-vite) or package with a tool of your choice (e.g., electron-builder).

### Packaging installers (electron-builder)

After `npm run build`, package OS-specific installers with:

```bash
# Creates unpacked directories for quick inspection
npm run pack

# Produces DMG/ZIP (macOS), NSIS/ZIP (Windows), AppImage/DEB (Linux)
npm run dist
```

Run the packaging command on the corresponding OS (or via CI runners) so signing/notarization can take place.

## Project structure

```
src/
  main/       # Electron main process (window + IPC + CLI file loading)
  preload/    # Secure bridge exposing file/url helpers to the renderer
  renderer/   # React UI, tabs, markdown viewer, Mermaid integration
```

Notes:
- `window.api` (preload) exposes async helpers for dialogs, URLs, relative markdown resolution, and external links.
- Mermaid diagrams are recognized via a remark plugin that rewrites fenced ```mermaid blocks before rendering.
- Tabs deduplicate by source (path or URL) so re-opening updates existing content instead of duplicating tabs.

## Tests

`npm run lint` type-checks the entire project via `tsc --noEmit`.
