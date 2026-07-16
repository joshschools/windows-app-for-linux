# Plan implementacji — windows-app-for-linux

## Cel projektu

Natywna aplikacja Linux opakowująca `https://windows.cloud.microsoft` (Windows App / Azure Virtual Desktop). Pozwala pracować z chmurą Windows tak jak z lokalną aplikacją: wielozakładkowy interfejs, obsługa klawiatury w fullscreenie, integracja z systemem.

Dystrybucja: **AppImage** (standalone) i **Flatpak** (Flathub: `io.github.mariuszkopowski.WindowsAppForLinux`).

---

## Decyzje technologiczne

### Electron, nie PWA

PWA nie daje dostępu do:
- `app.commandLine.appendSwitch` — bez tego nie można włączyć VAAPI ani SharedArrayBuffer
- `session.setUserAgent()` na poziomie sesji (a nie pojedynczego okna)
- `setWindowOpenHandler` do pełnej kontroli nad oknami
- natywnej integracji (tray, global shortcuts, protokół URL)

### Baza kodu

Architektura wzorowana na [teams-for-linux](https://github.com/IsmaelMartinez/teams-for-linux) i [outlook-for-linux](https://github.com/mahmoudbahaa/outlook-for-linux) — ten sam wzorzec `BrowserWindow` + preload + `setWindowOpenHandler` + `webRequest` interceptors.

Kluczowe różnice wobec tych projektów:
- Wielozakładkowy interfejs (`WebContentsView` per sesja AVD) zamiast jednego okna
- Fullscreen per zakładka (nie per okno)
- Własny pasek zakładek (HTML overlay) zamiast natywnego menu

---

## Architektura

### Struktura procesów

```
Electron Main Process
├── app/index.js                  — flagi Chromium, single-instance lock, lifecycle
├── app/config/                   — konfiguracja (defaults + plik JSON + CLI)
├── app/mainAppWindow/
│   ├── index.js                  — BrowserWindow, session, windowOpenHandler
│   └── tabManager.js             — WebContentsView per sesja AVD [Faza 2]
└── app/menus/appMenu.js          — menu aplikacji, skróty [Faza 3]

Renderer / Preload (per WebContentsView)
└── app/browser/preload.js        — navigator.platform + userAgentData spoof

Tab Bar (własny renderer)
└── app/tabBar/                   — HTML/CSS/JS overlay nad oknami [Faza 2]
```

### Model zakładek (Faza 2+)

```
BrowserWindow
├── [Tab Bar WebContentsView] ← zawsze na wierzchu, 40px wysokości
├── [WebContentsView #0]      ← https://windows.cloud.microsoft/#/devices (panel)
├── [WebContentsView #1]      ← /webclient/avd/[guid1] (sesja 1)
└── [WebContentsView #2]      ← /webclient/avd/[guid2] (sesja 2, opcjonalnie)
```

Wszystkie WebContentsViews dzielą **jedną sesję** (`persist:windows-app`). Jest to konieczne — tokeny Entra ID muszą być widoczne we wszystkich zakładkach.

### Fullscreen (Faza 3)

W trybie fullscreen aktywnej zakładki:
1. Tab Bar jest ukrywany
2. Aktywny WebContentsView zajmuje 100% okna
3. Web app samodzielnie przejmuje klawiaturę po wejściu w fullscreen
4. ESC lub F11 przywraca Tab Bar i poprzednie rozmiary

---

## Krytyczne wymagania techniczne

### UA spoof — dwa poziomy

**Poziom 1 (HTTP headers):** `session.setUserAgent()` + `loadURL({ userAgent })` — każde żądanie HTTP wysyła Edge/Windows UA.

**Poziom 2 (JavaScript):** `preload.js` patchuje:
- `Navigator.prototype.platform` → `"Win32"`
- `navigator.userAgentData.platform` → `"Windows"`
- `navigator.userAgentData.brands` → Edge 143 brands
- `navigator.userAgentData.getHighEntropyValues()` → zwraca Windows architekturę i wersję

Poziom 2 jest konieczny bo Entra ID i Conditional Access używają Client Hints API zamiast (lub oprócz) legacy UA string.

### Chromium flags

Ustawiane przed `app.ready` w `app/index.js`:

| Flaga | Powód |
|---|---|
| `VaapiVideoDecoder` | Hardware H.264 decode dla RDP graphics stream (bez tego — CPU) |
| `SharedArrayBuffer` | Wymagany przez RDP WebAssembly codec |
| `CrossOriginOpenerPolicy` | Wymagany przez stronę dla SharedArrayBuffer |
| `WebRTCPipeWireCapturer` | Udostępnianie ekranu na Wayland (conditional) |
| `UseOzonePlatform` | Natywny Wayland (conditional na `WAYLAND_DISPLAY`) |

### Session security

- `webSecurity: true` — **nie wolno zmieniać** — strona wymaga COOP/COEP dla SharedArrayBuffer
- `contextIsolation: false` — wymagane żeby preload mógł patchować `navigator` strony
- `sandbox: false` — wymagane żeby preload miał dostęp do Node.js APIs
- `nodeIntegration: false` — strona sama nie ma dostępu do Node.js

---

## Fazy implementacji

### Faza 1 — Fundament ✅ (częściowo)

Działająca aplikacja Electron ładująca Windows App, z UA spoof i obsługą auth.

**Zrobione:**
- package.json (AppImage + Flatpak targets)
- Chromium flags z Wayland detection
- Config system (options.js + index.js z yargs)
- BrowserWindow z persist session
- UA spoof — HTTP i JS (preload)
- windowOpenHandler — auth, AVD, external
- CSP header stripping (SSO)
- about:blank SSO intercept
- Render process crash recovery

**Pozostało:**
- Window state persistence (rozmiar/pozycja)
- Ikony aplikacji (assets/)
- Test infrastruktura (Jest)

### Faza 2 — Tab Manager

Każda sesja AVD otwiera się jako zakładka. Własny Tab Bar jako HTML overlay.

Kluczowe elementy:
- `TabManager` — tworzy/niszczy/przełącza WebContentsViews
- `TabBar` — HTML/CSS, IPC z main process
- windowOpenHandler routuje `/webclient/avd/` do TabManager
- Ctrl+T (nowy tab do panelu), Ctrl+W (zamknij tab), Ctrl+Tab (następny tab)
- Tytuły zakładek z `webContents.getTitle()`

### Faza 3 — Fullscreen & Klawiatura

Fullscreen per zakładka z ukryciem Tab Bar.

- F11 → fullscreen aktywnej zakładki → Tab Bar znika → WebContentsView = 100% okna
- ESC / F11 ponownie → wyjście z fullscreen → Tab Bar wraca
- Overlay informacyjny przy pierwszym wejściu (jakie skróty działają: Ctrl+Alt+End, Alt+F3 itd.)
- Kompletne menu aplikacji ze skrótami

### Faza 4 — Integracja systemowa

- System tray (ikona + Show/Quit)
- Window state persistence (zapisywanie rozmiaru/pozycji)
- Zoom (Ctrl+/-/0) z persistencją per partition
- Nawigacja Alt+←/→
- Detekcja braku połączenia + retry

### Faza 5 — Packaging & Flathub

- Kompletny zestaw ikon (16–512px, PNG + SVG source)
- AppStream metadata (appdata.xml)
- .desktop file
- Działający build AppImage
- Działający build Flatpak
- Manifest do oddzielnego repo na Flathub

---

## Znane ograniczenia (web client vs. natywny klient)

| Feature | Web client | Natywny Windows App |
|---|---|---|
| Wiele monitorów | ❌ | ✅ |
| RDP Shortpath (UDP) | ❌ | ✅ |
| Teams WebRTC optimization | ❌ | ✅ |
| Screen capture protection | ❌ | ✅ |
| Intune MAM (pełne) | ⚠️ Edge only | ✅ |
| Przekierowanie kamery (webcam redirection) | ⚠️ Niestabilne | ✅ |

Ograniczenia web clienta — nie możemy ich naprawić w Elektronie.

**Kamera:** aplikacja przyznaje uprawnienie `camera` automatycznie (`permissionAllowed()` w `app/mainAppWindow/helpers.js`), ale samo podłączenie kamery w sesji AVD zależy od web clienta Windows App, który **nie ma jeszcze pełnego wsparcia dla przekierowania kamery** — bywa, że urządzenie nie pojawia się w sesji zdalnej mimo przyznanych uprawnień, nawet gdy w natywnym kliencie Windows App (nie-web) działa bez problemu. To ograniczenie po stronie Microsoftu, nie da się go naprawić w tym wrapperze.

---

## Ryzyka

| Ryzyko | Prawdopodobieństwo | Mitygacja |
|---|---|---|
| Tenant wymaga prawdziwego Edge | Średnie | Dokumentacja; alert w UI gdy spoof może nie wystarczyć |
| COOP/COEP blokuje auth popupy | Średnie | Wspólna sesja w modal child window |
| Fullscreen na Wayland działa inaczej | Wysokie | Testy na XWayland i native Wayland |
| Dwie równoległe sesje AVD kolidują | Niskie | Każda sesja ma oddzielny WebSocket do AVD gateway |
| Aktualizacje Edge zmieniają Client Hints API | Niskie | UA string konfigurowalny w config.json |
