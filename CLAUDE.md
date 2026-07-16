# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Electron wrapper for `https://windows.cloud.microsoft` (Windows App / Azure Virtual Desktop) targeting Linux desktops. Distributed as AppImage and Flatpak (Flathub: `io.github.mkoprowski.WindowsAppForLinux`).

Reference projects (same architecture): [teams-for-linux](https://github.com/IsmaelMartinez/teams-for-linux), [outlook-for-linux](https://github.com/mahmoudbahaa/outlook-for-linux).

## Commands

```bash
npm install          # first time setup
npm start            # run in development
npm run build:appimage
npm run build:flatpak
npm run build        # both targets
```

## Architecture

```
app/
├── index.js                   # main process entry; Chromium flags set here before app.ready
├── config/
│   ├── options.js             # defaults (UA string, URLs, window size)
│   └── index.js               # merges: config.json file → CLI args → defaults (yargs)
├── mainAppWindow/
│   └── index.js               # BrowserWindow lifecycle, UA injection, windowOpenHandler, session setup
└── browser/
    └── preload.js             # navigator.platform + userAgentData (Client Hints) spoof for Edge/Windows
```

**Planned additions (Phase 2+):**
- `mainAppWindow/tabManager.js` — WebContentsView per AVD session
- `tabBar/` — custom HTML tab bar overlay
- `app/menus/appMenu.js` — keyboard shortcuts (Ctrl+T, Ctrl+W, F11)

## Critical design decisions

**User-Agent spoof is mandatory.** Conditional Access / Intune MAM policies on many tenants require Edge on Windows. The spoof is two-layered:
1. `session.setUserAgent()` + `loadURL({userAgent})` — HTTP header level
2. `preload.js` patches `Navigator.prototype.platform` and `navigator.userAgentData` — JS level (Client Hints)

**Session partition `persist:windows-app` is shared** across all windows (main + auth popups + AVD sessions). This is intentional — Entra ID auth cookies must be visible to all child windows.

**`contextIsolation: false`** is required so the preload can patch the page's `navigator` directly. `webSecurity: true` must stay enabled — the AVD web client requires COOP/COEP headers for SharedArrayBuffer.

**Chromium flags** set in `app/index.js` before `app.ready`:
- `VaapiVideoDecoder` — hardware H.264 decode for the RDP graphics stream
- `SharedArrayBuffer` + `CrossOriginOpenerPolicy` — required by the RDP WebAssembly codec
- `UseOzonePlatform` + `WebRTCPipeWireCapturer` — Wayland support (conditional on `WAYLAND_DISPLAY`)

**AVD sessions open as tabs (Phase 2).** The entry panel is `/#/devices`. Clicking a machine navigates to `/webclient/avd/[guid...]`. In Phase 1 this loads in the main window; Phase 2 uses `WebContentsView` per session with a custom tab bar.

**Fullscreen keyboard passthrough** is handled by the web app itself once Electron enters fullscreen — no custom key interception needed. F11 will toggle Electron fullscreen.

**Auth popups from federated IdPs (ADFS, Okta, Ping, ...) can't be allow-listed by domain** — `isAuthUrl()` only covers Microsoft's own domains. `isLikelyAuthPopup()` (window size/disposition heuristic) is a fallback that lets these stay in-app as a modal instead of falling through to `shell.openExternal`.

**AVD session windows clear indexeddb/sessionstorage/serviceworkers/cachestorage before `loadURL`** (`clearAvdSessionState`) to avoid a grey screen on reconnect. `localStorage` and cookies are deliberately excluded — they hold the portal's first-run flags (`preload.js`) and SSO state, which live on the same shared origin.

## Config file location

`~/.config/windows-app-for-linux/config.json` — overrides any value from `options.js`. No GUI, JSON only.

`cloudEnvironment` (`commercial` | `gcchigh` | `dod`, also `--cloud-environment` on the CLI) resolves to a preset URL in `options.js`. An explicit `url` (file or `--url`) always wins over the preset.
