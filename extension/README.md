# FetchTheChange Browser Extension

Chrome/Brave extension that lets users track elements on any webpage directly from the toolbar.

## Quick Start

```bash
cd extension
npm install
npm run build
```

Then in Chrome/Brave:
1. Navigate to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/build/` directory (not `extension/` itself)

## Development

```bash
npm run watch:dev   # Rebuild on changes, pointing at localhost:5000
```

After each rebuild, click the reload icon on `chrome://extensions` to pick up changes.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Production build (→ `build/`) |
| `npm run build:dev` | Dev build pointing at localhost:5000 |
| `npm run watch` | Watch mode (production API) |
| `npm run watch:dev` | Watch mode (localhost:5000) |
| `npm run typecheck` | TypeScript type-check only |
| `npm run package` | Build + zip for distribution |

## Troubleshooting

**Blank/black popup after clicking the toolbar icon?**
The extension must be loaded from the `build/` directory. If you loaded it from `extension/` or `extension/src/`, the TypeScript source files won't execute in the browser. Run `npm run build` and reload from `extension/build/`.
