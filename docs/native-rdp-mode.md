# Native RDP mode (FreeRDP) — development plan

Branch: `feature/native-rdp-freerdp`

## Goal

Add an optional **native RDP connection path** alongside the existing **web client** (Electron + `windows.cloud.microsoft` / GCC High web client). Native mode targets features the web stack cannot provide, starting with **multi-monitor** and **dynamic resolution**.

The current app remains the default; native mode is a separate launch path until it is stable enough to integrate into the UI.

## Why a separate mode

| Capability | Web client (current) | Native RDP (FreeRDP) |
|------------|----------------------|----------------------|
| Multi-monitor | No | Yes (`/multimon`, `/monitors`) |
| GCC High / DoD via web SSO | Yes (our strength) | Requires ARM gateway + AAD token flow |
| Camera / mic in session | Via WebRTC in browser | Via RDP redirection channels |
| RDP Shortpath (UDP) | No | Possible with native client |
| Microsoft-supported on Linux | Web only | Third-party (FreeRDP) |

## Architecture (target)

```
┌─────────────────────────────────────────────────────────┐
│  windows-app-for-linux                                  │
├─────────────────────┬───────────────────────────────────┤
│  Web mode (default) │  Native RDP mode (new)            │
│  Electron shell     │  FreeRDP subprocess OR embedded   │
│  + Microsoft web    │  + ARM gateway auth               │
│    RDP (WASM/WebRTC)│  + multimon / dynamic-resolution  │
└─────────────────────┴───────────────────────────────────┘
         ▲                           ▲
         │                           │
   Settings: cloud env          Workspace .rdpw / subscription
   Commercial / GCC High         OAuth token → gateway API
```

### Phase 1 — Manual validation (this branch first)

Prove FreeRDP works for your tenant before touching Electron integration.

1. Build or install **FreeRDP 3.x** with `WITH_AAD=ON` (distro packages often lack ARM gateway support).
2. Export a workspace connection (`.rdpw`) from the web portal or Windows App.
3. Run `scripts/freerdp-avd-connect.sh` with `/multimon` and verify both monitors in the VM.

**Exit criteria:** Multi-monitor session works on Commercial and/or GCC High with your credentials.

### Phase 2 — Auth automation

The web client uses browser SSO; FreeRDP needs a **bearer token** for the ARM gateway.

- [ ] Document token acquisition (device code flow / cached token from `az login` where allowed).
- [ ] Parse `.rdpw` for `gatewayhostname`, `loadbalanceinfo`, application id.
- [ ] POST to `https://<gateway>/api/arm/v2/connections/` → WebSocket endpoint.
- [ ] Pass token to `xfreerdp /gateway:type:arm /gw:bearer:...`

References:

- [FreeRDP FAQ — connect to AVD](https://github.com/FreeRDP/FreeRDP/wiki/FAQ#connect-to-azure-virtual-desktop-avd)
- [FreeRDP issue #6529](https://github.com/FreeRDP/FreeRDP/issues/6529) (ARM gateway flow)

### Phase 3 — Electron integration

- [ ] Settings toggle: **Connection mode** → Web | Native RDP.
- [ ] Native mode: spawn `xfreerdp` (or link `libfreerdp` later) from main process; no BrowserWindow for the session.
- [ ] Reuse `CLOUD_ENVIRONMENTS` gateway URLs for GCC High / DoD endpoint selection.
- [ ] Surface errors (missing FreeRDP, AAD not compiled in, auth failure) in a dialog.

### Phase 4 — Packaging

- [ ] Optional snap/flatpak stage-package for `freerdp3` / `xfreerdp`.
- [ ] Document that native mode is **best-effort / unsupported by Microsoft**.

## FreeRDP build (CachyOS / Arch)

Many distro builds disable AAD. From source:

```bash
git clone https://github.com/FreeRDP/FreeRDP.git
cd FreeRDP
cmake -GNinja \
  -DWITH_AAD=ON \
  -DWITH_DSP_FFMPEG=ON \
  -B build -H.
cmake --build build --target xfreerdp
```

Verify ARM support:

```bash
./build/client/X11/xfreerdp /buildconfig | grep -i aad
```

## Quick test (Phase 1)

```bash
# After placing a workspace .rdpw file:
./scripts/freerdp-avd-connect.sh ~/Downloads/workspace.rdpw --multimon
```

## Open questions

1. **GCC High auth** — Does your tenant allow device-code / service-principal flows for ARM, or only interactive browser SSO?
2. **Session broker** — Personal desktop vs pooled; multimon host-pool RDP properties (`use multimon:i:1`) must be enabled server-side.
3. **Embedded vs subprocess** — Subprocess is faster to ship; embedding FreeRDP in Electron is a later optimization.

## Non-goals (for now)

- Replacing the web client entirely.
- Multi-window Electron hacks to fake multi-monitor on the web path.
- Microsoft support or official endorsement.
