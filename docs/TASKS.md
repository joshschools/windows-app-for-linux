# Rejestr zadań — windows-app-for-linux

## Legenda statusów

| Symbol | Znaczenie |
|---|---|
| `pending` | Nie zaczęte |
| `in_progress` | W trakcie |
| `completed` | Ukończone |
| `blocked` | Zablokowane przez inne zadanie |

Każde zadanie ma: opis, kryteria akceptacji, testy jednostkowe (gdzie zasadne) i testy manualne (dla agenta/użytkownika).

---

## Faza 1 — Fundament

---

### P1-01 — Scaffold projektu

**Status:** `completed`  
**Pliki:** `package.json`, `.gitignore`

#### Kryteria akceptacji
- [x] `package.json` zawiera `appId: io.github.mkoprowski.WindowsAppForLinux`
- [x] Targets: AppImage i flatpak (bez deb/rpm/snap)
- [x] Zależności: electron ^34, electron-builder ^25, yargs ^17
- [x] `.gitignore` wyklucza `node_modules/`, `dist/`

#### Testy jednostkowe
_Nie dotyczy — plik konfiguracyjny._

#### Testy manualne
1. `npm install` kończy się bez błędów
2. Katalog `node_modules/` istnieje po instalacji

---

### P1-02 — Flagi Chromium i entry point

**Status:** `completed`  
**Pliki:** `app/index.js`

#### Kryteria akceptacji
- [x] `enable-features` zawiera: `VaapiVideoDecoder`, `SharedArrayBuffer`, `CrossOriginOpenerPolicy`
- [x] `enable-blink-features` zawiera: `SharedArrayBuffer`
- [x] Wayland: jeśli `WAYLAND_DISPLAY` ustawiony → dodaje `UseOzonePlatform`, `WebRTCPipeWireCapturer`, `--ozone-platform=wayland`
- [x] Single-instance lock — druhie uruchomienie skupia pierwsze okno
- [x] Flagi ustawiane **przed** `app.whenReady()`

#### Testy jednostkowe
```js
// test/config/chromiumFlags.test.js
describe('Wayland detection', () => {
  it('adds Wayland flags when WAYLAND_DISPLAY is set', () => {
    process.env.WAYLAND_DISPLAY = ':0';
    const flags = buildFeatureFlags(); // wyekstrahowana funkcja pomocnicza
    expect(flags).toContain('UseOzonePlatform');
    expect(flags).toContain('WebRTCPipeWireCapturer');
    delete process.env.WAYLAND_DISPLAY;
  });

  it('omits Wayland flags when WAYLAND_DISPLAY is not set', () => {
    delete process.env.WAYLAND_DISPLAY;
    const flags = buildFeatureFlags();
    expect(flags).not.toContain('UseOzonePlatform');
  });
});
```

#### Testy manualne
1. `npm start` — okno aplikacji pojawia się (nawet z białym ekranem lub błędem sieciowym to OK na tym etapie)
2. Drugie `npm start` w tym samym czasie — pierwsze okno wysuwa się na wierzch, drugie nie otwiera się
3. Na systemie z Waylandem (`echo $WAYLAND_DISPLAY`): aplikacja uruchamia się bez błędów XWayland

---

### P1-03 — System konfiguracji

**Status:** `completed`  
**Pliki:** `app/config/options.js`, `app/config/index.js`

#### Kryteria akceptacji
- [x] `options.js` zawiera: `url`, `userAgent`, `sessionPartition`, `window`
- [x] `config/index.js` merguje: plik JSON → CLI args → defaults
- [x] Plik konfiguracyjny szukany w `~/.config/windows-app-for-linux/config.json`
- [x] Brak pliku konfiguracyjnego nie powoduje błędu — używane są defaults
- [x] CLI arg `--user-agent "..."` nadpisuje UA string

#### Testy jednostkowe
```js
// test/config/index.test.js
describe('Config loading', () => {
  it('returns defaults when no config file exists', () => {
    const cfg = loadConfig({ configPath: '/nonexistent/path.json' });
    expect(cfg.url).toBe('https://windows.cloud.microsoft/#/devices');
    expect(cfg.sessionPartition).toBe('persist:windows-app');
  });

  it('merges file config over defaults', () => {
    const cfg = loadConfig({
      configPath: fixtures.configWithCustomUA,
    });
    expect(cfg.userAgent).toBe('custom-ua-string');
    expect(cfg.url).toBe('https://windows.cloud.microsoft/#/devices'); // default preserved
  });

  it('CLI arg overrides file config', () => {
    const cfg = loadConfig({
      configPath: fixtures.configWithCustomUA,
      argv: ['--user-agent', 'cli-ua'],
    });
    expect(cfg.userAgent).toBe('cli-ua');
  });

  it('window config merges deeply', () => {
    const cfg = loadConfig({
      configPath: fixtures.configWithWindowWidth,
    });
    expect(cfg.window.width).toBe(1920);
    expect(cfg.window.height).toBe(800); // default preserved
  });
});
```

#### Testy manualne
1. Uruchom `npm start -- --user-agent "TestUA/1.0"`, otwórz DevTools (F12), w konsoli wpisz `navigator.userAgent` → powinno pokazać `TestUA/1.0` (jeśli preload nie patchuje tej wartości) lub Edge UA ze spoofa
2. Utwórz `~/.config/windows-app-for-linux/config.json` z `{"window": {"width": 1920}}`, uruchom app → okno ma szerokość ~1920px

---

### P1-04 — BrowserWindow i sesja

**Status:** `completed` ✅ przetestowane manualnie  
**Pliki:** `app/mainAppWindow/index.js`

#### Kryteria akceptacji
- [x] BrowserWindow używa partycji `persist:windows-app`
- [x] `webSecurity: true`, `contextIsolation: false`, `sandbox: false`, `nodeIntegration: false`
- [x] Session-level UA ustawiony przez `appSession.setUserAgent()`
- [x] Uprawnienia: camera, microphone, notifications, media, display-capture przyznawane automatycznie
- [x] CSP `content-security-policy-report-only` headers usuwane z odpowiedzi
- [x] `app/browser/preload.js` załadowany jako preload
- [x] `sec-ch-ua` / `sec-ch-ua-platform` nadpisywane przez `onBeforeSendHeaders` (dodane po testach — Chromium generuje je niezależnie od `setUserAgent`)
- [x] F12 i Ctrl+Shift+I otwierają DevTools (dodane przez `before-input-event`)

> **Uwaga implementacyjna:** `setUserAgent()` nie wpływa na `sec-ch-ua` headery — wymagają osobnego interceptora `onBeforeSendHeaders`.

#### Testy jednostkowe
```js
// test/mainAppWindow/sessionSetup.test.js
describe('Permission handler', () => {
  const allowedPerms = ['camera', 'microphone', 'notifications', 'media', 'display-capture', 'clipboard-read', 'clipboard-sanitized-write'];
  const deniedPerms = ['geolocation', 'fullscreen', 'unknown-perm'];

  allowedPerms.forEach(perm => {
    it(`grants ${perm}`, () => {
      expect(permissionAllowed(perm)).toBe(true);
    });
  });

  deniedPerms.forEach(perm => {
    it(`denies ${perm}`, () => {
      expect(permissionAllowed(perm)).toBe(false);
    });
  });
});

describe('CSP header stripping', () => {
  it('removes content-security-policy-report-only from response headers', () => {
    const headers = {
      'content-type': 'text/html',
      'content-security-policy-report-only': 'default-src https:',
    };
    const result = stripCspReportOnly(headers);
    expect(result['content-security-policy-report-only']).toBeUndefined();
    expect(result['content-type']).toBe('text/html');
  });

  it('is case-insensitive for header names', () => {
    const headers = { 'Content-Security-Policy-Report-Only': 'value' };
    const result = stripCspReportOnly(headers);
    expect(result['Content-Security-Policy-Report-Only']).toBeUndefined();
  });
});
```

#### Testy manualne
1. `npm start` → otwiera się okno z załadowaną stroną `windows.cloud.microsoft`
2. F12 → DevTools → Network → sprawdź request headers: `User-Agent` powinien zawierać `Edg/`
3. W DevTools Console: `navigator.userAgent` → powinien zawierać `Edg/`
4. W DevTools Console: `navigator.platform` → `"Win32"`

---

### P1-05 — Navigator / Client Hints spoof

**Status:** `completed` ✅ przetestowane manualnie  
**Pliki:** `app/browser/preload.js`

#### Kryteria akceptacji
- [x] `navigator.platform` zwraca `"Win32"`
- [x] `navigator.userAgentData.platform` zwraca `"Windows"`
- [x] `navigator.userAgentData.mobile` zwraca `false`
- [x] `navigator.userAgentData.brands` zawiera `{ brand: "Microsoft Edge", version: "143" }`
- [x] `navigator.userAgentData.getHighEntropyValues(['platform'])` zwraca `{ platform: "Windows" }`
- [x] `navigator.userAgentData.getHighEntropyValues(['architecture'])` zwraca `{ architecture: "x86", bitness: "64" }`
- [x] Błąd w spoofu nie crashuje renderera (try/catch)

> **Uwaga implementacyjna:** `Object.defineProperty(Navigator.prototype, 'userAgentData', ...)` rzuca w Chromium 132 — property jest non-configurable. Rozwiązanie: próba definicji najpierw na instancji (`navigator`), potem na `Navigator.prototype`. Pętla po `[navigator, Navigator.prototype]` z try/catch per target.

#### Testy jednostkowe
```js
// test/browser/userAgentSpoof.test.js
// Uruchamiane przez electron-mocha (dostęp do DOM/navigator)
describe('Navigator spoof', () => {
  before(() => {
    require('../../app/browser/preload.js');
  });

  it('spoofs navigator.platform to Win32', () => {
    expect(navigator.platform).toBe('Win32');
  });

  it('spoofs userAgentData.platform to Windows', () => {
    expect(navigator.userAgentData.platform).toBe('Windows');
  });

  it('spoofs userAgentData.mobile to false', () => {
    expect(navigator.userAgentData.mobile).toBe(false);
  });

  it('brands include Microsoft Edge', () => {
    const brands = navigator.userAgentData.brands;
    const edge = brands.find(b => b.brand === 'Microsoft Edge');
    expect(edge).toBeDefined();
    expect(edge.version).toBe('143');
  });

  it('getHighEntropyValues returns Windows platform', async () => {
    const result = await navigator.userAgentData.getHighEntropyValues(['platform', 'architecture']);
    expect(result.platform).toBe('Windows');
    expect(result.architecture).toBe('x86');
    expect(result.bitness).toBe('64');
  });
});
```

#### Testy manualne
1. `npm start` → F12 → Console:
   ```js
   navigator.platform                              // → "Win32"
   navigator.userAgentData.platform               // → "Windows"
   navigator.userAgentData.brands                 // → [..., {brand: "Microsoft Edge", ...}]
   await navigator.userAgentData.getHighEntropyValues(['platform', 'architecture'])
   // → {platform: "Windows", architecture: "x86", bitness: "64", ...}
   ```
2. Zaloguj się na `windows.cloud.microsoft` → logowanie nie powinno wymagać dodatkowych kroków z powodu UA

---

### P1-06 — Window open handler

**Status:** `completed`  
**Pliki:** `app/mainAppWindow/index.js`

#### Kryteria akceptacji
- [x] URL `login.microsoftonline.com` → otwiera modal child window z tą samą sesją
- [x] URL `about:blank` → `{ action: 'deny' }`
- [x] URL `/webclient/avd/` → w bieżącym oknie (tymczasowo, Phase 2 zmieni na tab)
- [x] Inne zewnętrzne URL → `shell.openExternal()`, `{ action: 'deny' }`
- [x] Auth modal child window ma `modal: true`, `parent: mainWindow`
- [x] Auth modal child window używa tej samej partycji sesji

#### Testy jednostkowe
```js
// test/mainAppWindow/windowOpenHandler.test.js
describe('isAuthUrl', () => {
  it('detects login.microsoftonline.com', () => {
    expect(isAuthUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).toBe(true);
  });

  it('detects login.live.com', () => {
    expect(isAuthUrl('https://login.live.com/oauth20_authorize.srf')).toBe(true);
  });

  it('rejects non-auth urls', () => {
    expect(isAuthUrl('https://example.com')).toBe(false);
    expect(isAuthUrl('https://windows.cloud.microsoft')).toBe(false);
  });

  it('handles malformed urls without throwing', () => {
    expect(() => isAuthUrl('not-a-url')).not.toThrow();
    expect(isAuthUrl('not-a-url')).toBe(false);
  });
});

describe('isAvdUrl', () => {
  it('detects AVD session urls', () => {
    expect(isAvdUrl('https://windows.cloud.microsoft/webclient/avd/abc123')).toBe(true);
  });

  it('does not match panel url', () => {
    expect(isAvdUrl('https://windows.cloud.microsoft/#/devices')).toBe(false);
  });
});
```

#### Testy manualne
1. Na stronie `windows.cloud.microsoft` kliknij "Sign in" → otwiera się modalne okno logowania (nie nowa zewnętrzna przeglądarka)
2. Po zalogowaniu modal zamyka się i widać panel urządzeń
3. DevTools Console: `window.open('https://google.com')` → Google otwiera się w systemowej przeglądarce, nie w Elektronie
4. DevTools Console: `window.open('about:blank')` → nic się nie otwiera

---

### P1-07 — about:blank SSO intercept

**Status:** `completed`  
**Pliki:** `app/mainAppWindow/index.js`

#### Kryteria akceptacji
- [x] `about:blank` żądania są blokowane przez `webRequest.onBeforeRequest`
- [x] Następny HTTPS request po `about:blank` jest przekierowany do `shell.openExternal()`
- [x] Licznik `aboutBlankCount` resetuje się po obsłużeniu

#### Testy jednostkowe
```js
// test/mainAppWindow/aboutBlankInterceptor.test.js
describe('AboutBlank interceptor', () => {
  it('increments counter on about:blank request', () => {
    const interceptor = createAboutBlankInterceptor();
    const callback = jest.fn();
    interceptor.onRequest({ url: 'about:blank', resourceType: 'mainFrame' }, callback);
    expect(interceptor.getCount()).toBe(1);
    expect(callback).toHaveBeenCalledWith({ cancel: true });
  });

  it('resets counter after handling follow-up HTTPS request', () => {
    const interceptor = createAboutBlankInterceptor();
    const shellMock = { openExternal: jest.fn() };
    interceptor.onRequest({ url: 'about:blank', resourceType: 'mainFrame' }, jest.fn());
    interceptor.onRequest({ url: 'https://example.com', resourceType: 'mainFrame' }, jest.fn(), shellMock);
    expect(shellMock.openExternal).toHaveBeenCalledWith('https://example.com');
    expect(interceptor.getCount()).toBe(0);
  });
});
```

#### Testy manualne
1. Znajdź na stronie link który otwiera popup przez `about:blank` (zwykle linki "otwórz w przeglądarce" w Microsoft 365) → powinien otworzyć się w systemowej przeglądarce

---

### P1-08 — Render process crash recovery

**Status:** `completed`  
**Pliki:** `app/mainAppWindow/index.js`

#### Kryteria akceptacji
- [x] Na event `render-process-gone` z `reason !== 'clean-exit'` → `loadURL(config.url)`
- [x] Czyste zamknięcie okna nie triggeruje reload

#### Testy jednostkowe
```js
// test/mainAppWindow/crashRecovery.test.js
describe('Crash recovery', () => {
  it('reloads on non-clean exit', () => {
    const loadURL = jest.fn();
    handleRenderProcessGone({ reason: 'crashed' }, loadURL, 'https://test.url');
    expect(loadURL).toHaveBeenCalledWith('https://test.url', expect.any(Object));
  });

  it('does not reload on clean exit', () => {
    const loadURL = jest.fn();
    handleRenderProcessGone({ reason: 'clean-exit' }, loadURL, 'https://test.url');
    expect(loadURL).not.toHaveBeenCalled();
  });

  it('does not reload on kill signal (expected shutdown)', () => {
    const loadURL = jest.fn();
    handleRenderProcessGone({ reason: 'killed' }, loadURL, 'https://test.url');
    expect(loadURL).toHaveBeenCalled(); // killed = unexpected, should reload
  });
});
```

#### Testy manualne
1. F12 → DevTools → Console: `process.crash()` → aplikacja powinna przeładować się automatycznie do strony głównej

---

### P1-09 — Infrastruktura testów (Jest)

**Status:** `pending`  
**Pliki:** `package.json`, `jest.config.js`, `test/`

#### Opis
Skonfigurować Jest dla testów jednostkowych (logika pure JS) oraz `electron-mocha` dla testów renderera (gdzie potrzebny jest `navigator`).

#### Kryteria akceptacji
- [ ] `npm test` uruchamia wszystkie testy jednostkowe
- [ ] `npm run test:renderer` uruchamia testy w kontekście Elektrona (electron-mocha)
- [ ] Katalog `test/` odzwierciedla strukturę `app/` (np. `test/config/`, `test/mainAppWindow/`)
- [ ] Testy z P1-02 do P1-08 są zaimplementowane i przechodzą

#### Testy jednostkowe
_To zadanie tworzy infrastrukturę — nie ma własnych testów._

#### Testy manualne
1. `npm test` → wszystkie testy zielone
2. `npm run test:renderer` → testy preload zielone

---

### P1-10 — Window state persistence

**Status:** `pending`  
**Pliki:** `app/mainAppWindow/windowState.js`, `app/mainAppWindow/index.js`

#### Opis
Zapamiętywać rozmiar i pozycję okna między uruchomieniami. Zapisywać do `~/.config/windows-app-for-linux/window-state.json`.

#### Kryteria akceptacji
- [ ] Po zamknięciu i ponownym otwarciu — okno ma taki sam rozmiar i pozycję
- [ ] Stan nie jest zapisywany gdy okno jest zminimalizowane lub fullscreen
- [ ] Gdy okno jest poza ekranem (np. po zmianie rozdzielczości) → reset do domyślnych wartości
- [ ] Zapis odbywa się na event `close`, nie przy każdym `resize` (debounce lub jednorazowo)

#### Testy jednostkowe
```js
// test/mainAppWindow/windowState.test.js
describe('Window state', () => {
  it('saves and restores size', () => {
    const state = createWindowStateManager({ defaultWidth: 1280, defaultHeight: 800 });
    state.save({ x: 100, y: 200, width: 1400, height: 900, isMaximized: false });
    const restored = state.load();
    expect(restored.width).toBe(1400);
    expect(restored.height).toBe(900);
  });

  it('returns defaults when no saved state', () => {
    const state = createWindowStateManager({ defaultWidth: 1280, defaultHeight: 800 });
    const restored = state.load();
    expect(restored.width).toBe(1280);
    expect(restored.height).toBe(800);
  });

  it('resets to defaults when window is off-screen', () => {
    const state = createWindowStateManager({ defaultWidth: 1280, defaultHeight: 800 });
    state.save({ x: -9999, y: -9999, width: 1280, height: 800, isMaximized: false });
    const restored = state.load({ screenBounds: { width: 1920, height: 1080 } });
    expect(restored.x).toBeUndefined(); // let Electron center it
  });
});
```

#### Testy manualne
1. Uruchom app, przesuń i zmień rozmiar okna, zamknij
2. Uruchom ponownie → okno pojawia się w tej samej pozycji z tym samym rozmiarem
3. Zmień rozdzielczość na mniejszą → okno nie jest poza ekranem

---

### P1-11 — Ikony aplikacji

**Status:** `pending`  
**Pliki:** `assets/icons/` (PNG 16, 32, 48, 64, 128, 256, 512), `assets/icons/icon.svg`

#### Opis
Stworzyć zestaw ikon dla aplikacji. Ikona powinna nawiązywać do Windows App (okno na niebieskim tle). Wymagane przez electron-builder do budowania AppImage i Flatpak.

#### Kryteria akceptacji
- [ ] Pliki: `16x16.png`, `32x32.png`, `48x48.png`, `64x64.png`, `128x128.png`, `256x256.png`, `512x512.png`
- [ ] Pliki w katalogu `assets/icons/`
- [ ] `package.json` `linux.icon` wskazuje na `assets/icons`
- [ ] `npm run build:appimage` nie zgłasza błędów o brakujących ikonach

#### Testy jednostkowe
_Nie dotyczy._

#### Testy manualne
1. `npm run build:appimage` → plik `.AppImage` tworzony bez ostrzeżeń o ikonach
2. Zainstalowana aplikacja ma ikonę widoczną w launcherze systemu

---

## Faza 2 — Tab Manager

---

### P2-01  
**Zablokowane przez:** P1-13 (manualna weryfikacja Fazy 1), P1-09 (infrastruktura testów)  
**Pliki:** `app/mainAppWindow/tabManager.js`

#### Opis
Moduł zarządzający kolekcją zakładek. Każda zakładka to `WebContentsView` z własnym preloadem i współdzieloną sesją.

```js
// Interfejs publiczny:
tabManager.createTab(url)   → { id, view, url }
tabManager.getTab(id)       → tab | undefined
tabManager.getAllTabs()      → tab[]
tabManager.getActiveTab()   → tab | undefined
```

#### Kryteria akceptacji
- [ ] `createTab(url)` tworzy `WebContentsView` z `partition: config.sessionPartition`
- [ ] Każdy tab ma unikalny ID (UUID lub incrementing number)
- [ ] `WebContentsView` dodawany do `BrowserWindow` przez `win.contentView.addChildView()`
- [ ] UA ustawiany na sesji WebContentsView
- [ ] Preload `app/browser/preload.js` załadowany w każdym WebContentsView
- [ ] Nowo utworzony tab jest niewidoczny do czasu wywołania `activateTab(id)`

#### Testy jednostkowe
```js
// test/mainAppWindow/tabManager.test.js
describe('TabManager', () => {
  it('createTab returns object with id, view, url', () => {
    const tab = tabManager.createTab('https://example.com');
    expect(tab.id).toBeDefined();
    expect(tab.url).toBe('https://example.com');
    expect(tab.view).toBeDefined();
  });

  it('getTab returns correct tab by id', () => {
    const tab = tabManager.createTab('https://example.com');
    expect(tabManager.getTab(tab.id)).toBe(tab);
  });

  it('getAllTabs returns all created tabs', () => {
    tabManager.createTab('https://a.com');
    tabManager.createTab('https://b.com');
    expect(tabManager.getAllTabs().length).toBe(2);
  });

  it('createTab with same URL creates separate tabs', () => {
    const t1 = tabManager.createTab('https://a.com');
    const t2 = tabManager.createTab('https://a.com');
    expect(t1.id).not.toBe(t2.id);
  });
});
```

#### Testy manualne
_Weryfikacja po P2-07 (routing AVD URLs do tabów)._

---

### P2-02 — TabManager: zamykanie zakładki z cleanup

**Status:** `pending`  
**Zablokowane przez:** P2-01  
**Pliki:** `app/mainAppWindow/tabManager.js`

#### Opis
Prawidłowe usuwanie zakładki: czyszczenie storage, usunięcie z BrowserWindow, zamknięcie webContents.

```js
tabManager.closeTab(id)  // async
```

#### Kryteria akceptacji
- [ ] `closeTab(id)` wywołuje `clearStorageData()` na sesji WebContentsView
- [ ] `win.contentView.removeChildView(view)` wywoływane
- [ ] `view.webContents.close()` wywoływane
- [ ] Tab usuwany z wewnętrznej kolekcji `getAllTabs()`
- [ ] Zamknięcie ostatniej (jedynej) zakładki nie crashuje — otwiera się zakładka z panelem
- [ ] Zamknięcie aktywnej zakładki → przełącza się na poprzednią lub na panel

#### Testy jednostkowe
```js
describe('TabManager.closeTab', () => {
  it('removes tab from collection', async () => {
    const tab = tabManager.createTab('https://a.com');
    await tabManager.closeTab(tab.id);
    expect(tabManager.getTab(tab.id)).toBeUndefined();
    expect(tabManager.getAllTabs().length).toBe(0);
  });

  it('closing non-existent id does not throw', async () => {
    await expect(tabManager.closeTab('nonexistent')).resolves.not.toThrow();
  });

  it('closing last tab opens panel tab', async () => {
    const tab = tabManager.createTab('https://a.com');
    tabManager.activateTab(tab.id);
    await tabManager.closeTab(tab.id);
    expect(tabManager.getActiveTab().url).toContain('windows.cloud.microsoft');
  });
});
```

#### Testy manualne
1. Otwórz sesję AVD, zamknij zakładkę (X na tablecie) → wracasz do panelu urządzeń
2. Sprawdź DevTools → Memory → nie ma wycieków po zamknięciu kilku zakładek z rzędu

---

### P2-03 — TabManager: aktywacja zakładki i bounds

**Status:** `pending`  
**Zablokowane przez:** P2-01  
**Pliki:** `app/mainAppWindow/tabManager.js`

#### Opis
Przełączanie aktywnej zakładki: ustawienie bounds, z-order i widoczności.

```js
tabManager.activateTab(id)
```

#### Kryteria akceptacji
- [ ] Aktywna zakładka ma bounds = cały obszar okna minus Tab Bar (40px na górze)
- [ ] Poprzednia aktywna zakładka jest ukrywana (`setBounds({width:0, height:0})` lub `removeChildView`)
- [ ] `getActiveTab()` zwraca nowo aktywowaną zakładkę

#### Testy jednostkowe
```js
describe('TabManager.activateTab', () => {
  it('sets active tab', () => {
    const t1 = tabManager.createTab('https://a.com');
    const t2 = tabManager.createTab('https://b.com');
    tabManager.activateTab(t2.id);
    expect(tabManager.getActiveTab().id).toBe(t2.id);
  });

  it('activating already-active tab is a no-op', () => {
    const tab = tabManager.createTab('https://a.com');
    tabManager.activateTab(tab.id);
    expect(() => tabManager.activateTab(tab.id)).not.toThrow();
  });
});
```

#### Testy manualne
1. Otwórz dwie sesje AVD → zakładki widoczne w Tab Bar
2. Kliknij w zakładkę #1 → widzisz sesję #1
3. Kliknij w zakładkę #2 → widzisz sesję #2, sesja #1 znika

---

### P2-04 — TabManager: resize przy zmianie rozmiaru okna

**Status:** `pending`  
**Zablokowane przez:** P2-03  
**Pliki:** `app/mainAppWindow/tabManager.js`

#### Opis
Gdy BrowserWindow zmienia rozmiar, aktywny WebContentsView musi być dostosowany.

#### Kryteria akceptacji
- [ ] `BrowserWindow` event `resize` triggeruje aktualizację bounds aktywnego taba
- [ ] Bounds = `{x: 0, y: TAB_BAR_HEIGHT, width: winWidth, height: winHeight - TAB_BAR_HEIGHT}`
- [ ] W trybie fullscreen bounds = `{x: 0, y: 0, width: winWidth, height: winHeight}` (bez Tab Bar)

#### Testy jednostkowe
```js
describe('calculateTabBounds', () => {
  it('leaves room for tab bar in normal mode', () => {
    const bounds = calculateTabBounds(1280, 800, { fullscreen: false, tabBarHeight: 40 });
    expect(bounds).toEqual({ x: 0, y: 40, width: 1280, height: 760 });
  });

  it('fills full window in fullscreen mode', () => {
    const bounds = calculateTabBounds(1920, 1080, { fullscreen: true, tabBarHeight: 40 });
    expect(bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});
```

#### Testy manualne
1. Zmień rozmiar okna przeciągając krawędź → sesja AVD wypełnia całą dostępną przestrzeń (bez nakładania się na Tab Bar)
2. Zmaksymalizuj okno → sesja nadal poprawnie wypełnia obszar

---

### P2-05 — Tab Bar: UI (HTML/CSS)

**Status:** `pending`  
**Zablokowane przez:** P2-01  
**Pliki:** `app/tabBar/index.html`, `app/tabBar/renderer.js`, `app/tabBar/styles.css`

#### Opis
Pasek zakładek o wysokości 40px wyświetlany na górze okna. Zawiera:
- Listę zakładek z tytułem i przyciskiem X
- Przycisk `+` do otwarcia nowej zakładki (→ panel urządzeń)
- Wizualne wskazanie aktywnej zakładki

Design: minimalistyczny, dark theme (#1a1a2e background, biały tekst).

#### Kryteria akceptacji
- [ ] Zakładki wyświetlają tytuł strony (max 20 znaków z `...`)
- [ ] Aktywna zakładka wizualnie wyróżniona (np. jaśniejsze tło)
- [ ] Przycisk X zamyka zakładkę
- [ ] Przycisk `+` otwiera nową zakładkę z panelem
- [ ] Tab Bar renderowany jako `WebContentsView` na z-index powyżej zakładek sesji
- [ ] Nie scrolluje — gdy za dużo zakładek tytuły się skracają (max ~8 zakładek widocznych)

#### Testy jednostkowe
_Testy DOM — przeprowadzić przez electron-mocha lub Playwright._

#### Testy manualne
1. Uruchom app → Tab Bar widoczny u góry z jedną zakładką "Windows App"
2. Otwórz sesję AVD → pojawia się nowa zakładka z nazwą maszyny
3. Najedź myszą na zakładkę → pojawia się X
4. Kliknij X → zakładka zamknięta, wracasz do poprzedniej
5. Kliknij `+` → otwiera się panel urządzeń w nowej zakładce

---

### P2-06 — IPC: Tab Bar ↔ Main Process

**Status:** `pending`  
**Zablokowane przez:** P2-05  
**Pliki:** `app/tabBar/renderer.js`, `app/mainAppWindow/tabManager.js`

#### Opis
Komunikacja dwukierunkowa przez IPC:

```
Renderer (Tab Bar) → Main:
  'tab:activate' (id)
  'tab:close' (id)
  'tab:new' ()

Main → Renderer (Tab Bar):
  'tabs:update' ([{ id, title, active }])
```

#### Kryteria akceptacji
- [ ] Kliknięcie zakładki w Tab Bar wysyła `'tab:activate'` → `tabManager.activateTab(id)`
- [ ] Kliknięcie X wysyła `'tab:close'` → `tabManager.closeTab(id)`
- [ ] Po każdej zmianie stanu tabów main wysyła `'tabs:update'` z nową listą
- [ ] Tab Bar re-renderuje się po każdym `'tabs:update'`
- [ ] Zmiana tytułu strony (webContents `page-title-updated`) aktualizuje Tab Bar

#### Testy jednostkowe
```js
// test/mainAppWindow/ipcTabBridge.test.js
describe('IPC Tab Bridge', () => {
  it('tab:activate triggers tabManager.activateTab', () => {
    const activateMock = jest.fn();
    const bridge = createTabBridge({ tabManager: { activateTab: activateMock } });
    bridge.handleMessage('tab:activate', 'tab-123');
    expect(activateMock).toHaveBeenCalledWith('tab-123');
  });

  it('sends tabs:update after closeTab', async () => {
    const sendMock = jest.fn();
    const bridge = createTabBridge({ send: sendMock, tabManager });
    await bridge.handleMessage('tab:close', 'tab-123');
    expect(sendMock).toHaveBeenCalledWith('tabs:update', expect.any(Array));
  });
});
```

#### Testy manualne
1. Otwórz kilka sesji → Tab Bar dynamicznie aktualizuje się
2. Zmień tytuł w sesji AVD (wejdź na remote desktop, zmień nazwę okna) → tytuł w Tab Bar aktualizuje się

---

### P2-07 — Routing AVD URLs do TabManager

**Status:** `pending`  
**Zablokowane przez:** P2-01, P2-03  
**Pliki:** `app/mainAppWindow/index.js`

#### Opis
Zaktualizować `windowOpenHandler` w `mainAppWindow/index.js`: URL pasujący do `/webclient/avd/` tworzy nową zakładkę zamiast ładować w głównym oknie.

#### Kryteria akceptacji
- [ ] `setWindowOpenHandler` dla URL `/webclient/avd/` wywołuje `tabManager.createTab(url)` + `tabManager.activateTab(id)`
- [ ] Zwraca `{ action: 'deny' }` (WebContentsView, nie nowe okno)
- [ ] Jeśli ta sama sesja AVD jest już otwarta jako tab → aktywuje istniejący tab (nie duplikuje)
- [ ] Nowy tab natychmiast aktywny i widoczny

#### Testy jednostkowe
```js
// test/mainAppWindow/avdUrlRouting.test.js
describe('AVD URL routing', () => {
  it('routes avd url to tabManager.createTab', () => {
    const createTabMock = jest.fn().mockReturnValue({ id: 'new-tab' });
    const result = handleWindowOpen(
      { url: 'https://windows.cloud.microsoft/webclient/avd/abc123' },
      { createTab: createTabMock, activateTab: jest.fn(), findTabByUrl: jest.fn() }
    );
    expect(createTabMock).toHaveBeenCalledWith('https://windows.cloud.microsoft/webclient/avd/abc123');
    expect(result).toEqual({ action: 'deny' });
  });

  it('activates existing tab if same AVD url already open', () => {
    const existingTab = { id: 'existing-tab', url: 'https://windows.cloud.microsoft/webclient/avd/abc123' };
    const activateMock = jest.fn();
    const createTabMock = jest.fn();
    handleWindowOpen(
      { url: 'https://windows.cloud.microsoft/webclient/avd/abc123' },
      { createTab: createTabMock, activateTab: activateMock, findTabByUrl: () => existingTab }
    );
    expect(createTabMock).not.toHaveBeenCalled();
    expect(activateMock).toHaveBeenCalledWith('existing-tab');
  });
});
```

#### Testy manualne
1. Zaloguj się na `windows.cloud.microsoft/#/devices`
2. Kliknij maszynę → pojawia się nowa zakładka z URL `/webclient/avd/...`
3. Wróć do panelu, kliknij tę samą maszynę ponownie → aktywuje istniejącą zakładkę, nie otwiera nowej

---

### P2-08 — Skróty klawiaturowe zakładek

**Status:** `pending`  
**Zablokowane przez:** P2-06  
**Pliki:** `app/menus/appMenu.js`

#### Kryteria akceptacji
- [ ] `Ctrl+T` — nowa zakładka z panelem urządzeń (`/#/devices`)
- [ ] `Ctrl+W` — zamknij aktywną zakładkę (jeśli jedyna — nie zamykaj okna)
- [ ] `Ctrl+Tab` — następna zakładka (cyklicznie)
- [ ] `Ctrl+Shift+Tab` — poprzednia zakładka
- [ ] `Ctrl+1` … `Ctrl+8` — aktywuj zakładkę nr 1-8
- [ ] `Ctrl+R` — odśwież aktywną zakładkę

#### Testy jednostkowe
_Menu accelerators — weryfikacja przez electron-mocha / integration test._

#### Testy manualne
1. Otwórz kilka zakładek → `Ctrl+Tab` przełącza między nimi
2. `Ctrl+W` na zakładce sesji → zakładka zamknięta, wróciłeś do poprzedniej
3. `Ctrl+W` gdy tylko panel → okno **nie zamyka się** (tylko zakładka, ale jest jedyna → ignoruj)
4. `Ctrl+R` → aktywna zakładka przeładowuje się

---

### P2-09 — Manualny test E2E Fazy 2

**Status:** `pending`  
**Zablokowane przez:** P2-07, P2-08

#### Testy manualne (pełny scenariusz)
1. Uruchom `npm start`
2. Zaloguj się przez modal auth
3. Panel urządzeń widoczny jako pierwsza zakładka
4. Kliknij maszynę A → otwiera się zakładka "Maszyna A" z sesją AVD
5. Wróć do panelu (`Ctrl+Tab` lub klik w zakładkę)
6. Kliknij maszynę B → otwiera się zakładka "Maszyna B"
7. Masz 3 zakładki: Panel, Maszyna A, Maszyna B
8. `Ctrl+W` na Maszyna B → zakładka zamknięta, wracasz do poprzedniej
9. Sprawdź że Panel wciąż działa poprawnie
10. Zamknij okno → app kończy działanie

---

## Faza 3 — Fullscreen & Klawiatura

---

### P3-01 — F11: toggle fullscreen aktywnej zakładki

**Status:** `pending`  
**Zablokowane przez:** P2-09

#### Opis
F11 w głównym oknie przełącza tryb fullscreen. W fullscreenie Tab Bar jest ukryty, aktywny WebContentsView zajmuje 100% okna.

#### Kryteria akceptacji
- [ ] F11 → `mainWindow.setFullScreen(true)` + ukrycie Tab Bar + resize aktywnego WebContentsView do 100%
- [ ] F11 ponownie → wyjście z fullscreen, Tab Bar wraca, WebContentsView resize do normal bounds
- [ ] `Escape` wysyłany do webContents (wymagany przez web app do wyjścia z fullscreen UI)
- [ ] Fullscreen state zachowany per zakładka (zakładka #1 w fullscreen, zakładka #2 nie)

#### Testy jednostkowe
```js
// test/mainAppWindow/fullscreen.test.js
describe('calculateTabBounds in fullscreen', () => {
  it('returns full window bounds when fullscreen=true', () => {
    const bounds = calculateTabBounds(1920, 1080, { fullscreen: true, tabBarHeight: 40 });
    expect(bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});

describe('Fullscreen state', () => {
  it('tracks fullscreen per tab id', () => {
    const state = createFullscreenState();
    state.setFullscreen('tab-1', true);
    state.setFullscreen('tab-2', false);
    expect(state.isFullscreen('tab-1')).toBe(true);
    expect(state.isFullscreen('tab-2')).toBe(false);
  });
});
```

#### Testy manualne
1. Otwórz sesję AVD
2. F11 → Tab Bar znika, sesja zajmuje cały ekran
3. F11 ponownie → Tab Bar wraca
4. Wejdź w fullscreen, przełącz zakładkę → poprzednia zakładka wychodzi z fullscreen

---

### P3-02 — Overlay informacyjny przy pierwszym fullscreen

**Status:** `pending`  
**Zablokowane przez:** P3-01  
**Pliki:** `app/browser/fullscreenOverlay.js` lub inline w preload

#### Opis
Przy pierwszym wejściu w fullscreen wyświetl krótki overlay (3 sekundy) z informacją o dostępnych skrótach.

Treść:
```
Fullscreen aktywny
Ctrl+Alt+End → Ctrl+Alt+Del (zdalne)
Alt+F3 → klawisz Windows (zdalne)
F11 → wyjdź z fullscreen
```

#### Kryteria akceptacji
- [ ] Overlay pojawia się tylko raz (zapisać flagę w `electron-store` lub `localStorage`)
- [ ] Overlay znika po 3 sekundach
- [ ] Overlay można zamknąć wcześniej klikając na niego

#### Testy jednostkowe
```js
describe('Fullscreen overlay', () => {
  it('shows only once', () => {
    const store = new MockStore();
    expect(shouldShowOverlay(store)).toBe(true);
    markOverlayShown(store);
    expect(shouldShowOverlay(store)).toBe(false);
  });
});
```

#### Testy manualne
1. Pierwszy raz wejdź w fullscreen → overlay widoczny przez 3s
2. Wyjdź i wejdź ponownie w fullscreen → overlay nie pojawia się

---

### P3-03 — Menu aplikacji z wszystkimi skrótami

**Status:** `pending`  
**Zablokowane przez:** P2-08  
**Pliki:** `app/menus/appMenu.js`

#### Kryteria akceptacji
- [ ] Menu `Widok`: F11 (Fullscreen), Ctrl+R (Reload), Ctrl+= (Zoom In), Ctrl+- (Zoom Out), Ctrl+0 (Reset Zoom)
- [ ] Menu `Plik`: Ctrl+Q (Quit)
- [ ] Menu `Zakładki`: Ctrl+T, Ctrl+W, Ctrl+Tab, Ctrl+1…8
- [ ] Menu `Pomoc`: F12 (DevTools — tylko w dev), Ctrl+Shift+I (DevTools)
- [ ] Menu widoczne przez `Alt` na klawiaturze (standardowe zachowanie Linux)

#### Testy manualne
1. Naciśnij `Alt` → menu pojawia się
2. Każdy skrót z listy działa zgodnie z opisem

---

### P3-04 — Manualny test klawiatury w fullscreen

**Status:** `pending`  
**Zablokowane przez:** P3-01, P3-03

#### Testy manualne (na prawdziwej sesji AVD)
1. Wejdź w sesję AVD, naciśnij F11 → fullscreen aktywny
2. Przejdź do ustawień sesji (ikona koła zębatego w toolbarze) → włącz "Keyboard shortcuts (preview)"
3. Przetestuj:
   - `Ctrl+Alt+End` → na remote pojawia się dialog Ctrl+Alt+Del ✅
   - `Alt+F3` → otwiera menu Start na remote ✅
   - `Ctrl+C` / `Ctrl+V` → kopiuj/wklej przekazywane do remote ✅
   - `Alt+Tab` → przełącza okna na **remote** (nie na lokalnym) ✅
4. Wyjdź z fullscreen przez F11 → `Alt+Tab` z powrotem przełącza lokalne okna ✅

---

## Faza 4 — Integracja systemowa

---

### P4-01 — System Tray

**Status:** `pending`  
**Zablokowane przez:** P3-04  
**Pliki:** `app/tray/index.js`

#### Kryteria akceptacji
- [ ] Ikona tray pojawia się po uruchomieniu aplikacji
- [ ] Kliknięcie ikony → show/focus głównego okna
- [ ] Prawy klik → menu: "Pokaż" / "Zakończ"
- [ ] Zamknięcie okna (X) → minimalizuje do tray (nie kończy procesu)
- [ ] "Zakończ" w menu tray → `app.quit()`

#### Testy manualne
1. Uruchom app → ikona w system tray
2. Zamknij okno przez X → ikona zostaje, app działa
3. Kliknij ikonę → okno wraca
4. Prawy klik → "Zakończ" → ikona znika, app kończy

---

### P4-02 — Zoom z persistencją

**Status:** `pending`  
**Zablokowane przez:** P3-04  
**Pliki:** `app/browser/tools/zoom.js`, `app/mainAppWindow/index.js`

#### Kryteria akceptacji
- [ ] `Ctrl++` / `Ctrl+-` / `Ctrl+0` — zoom in/out/reset przez `webContents.setZoomLevel()`
- [ ] Poziom zoom zapisywany do `~/.config/windows-app-for-linux/config.json` (lub `electron-store`)
- [ ] Po ponownym uruchomieniu zoom przywrócony
- [ ] Zoom niezależny per zakładka (panel i sesje mogą mieć różne poziomy)

#### Testy manualne
1. `Ctrl++` kilka razy → strona się powiększa
2. Zamknij i otwórz app → zoom zachowany
3. `Ctrl+0` → zoom resetuje się do 100%

---

### P4-03 — Manualny test E2E Fazy 4

**Status:** `pending`  
**Zablokowane przez:** P4-01, P4-02

#### Testy manualne
1. Tray działa poprawnie (P4-01)
2. Zoom zapisuje się (P4-02)
3. Window state zapisuje się (P1-10)
4. App uruchamia się na Wayland bez błędów (jeśli dostępny)
5. Na X11: brak ostrzeżeń `libva`/`VAAPI` w stdout

---

## Faza 5 — Packaging & Flathub

---

### P5-01 — Kompletny zestaw ikon

**Status:** `pending`  
**Zablokowane przez:** P1-11

#### Kryteria akceptacji
- [ ] SVG źródłowe w `assets/icons/icon.svg`
- [ ] PNG: 16, 32, 48, 64, 128, 256, 512 w `assets/icons/`
- [ ] electron-builder konfiguracja wskazuje prawidłowy katalog

---

### P5-02 — AppStream metadata

**Status:** `pending`  
**Zablokowane przez:** P5-01  
**Pliki:** `assets/io.github.mkoprowski.WindowsAppForLinux.appdata.xml`

#### Kryteria akceptacji
- [ ] `<id>`: `io.github.mkoprowski.WindowsAppForLinux`
- [ ] `<name>`: `Windows App`
- [ ] `<summary>` i `<description>` w języku angielskim
- [ ] `<url type="homepage">` wskazuje na repozytorium GitHub
- [ ] `<releases>` z aktualną wersją i datą
- [ ] `<screenshots>` — minimum 1 zrzut ekranu (może być placeholder)
- [ ] `appstreamcli validate` przechodzi bez błędów

#### Testy manualne
1. `appstreamcli validate assets/io.github.mkoprowski.WindowsAppForLinux.appdata.xml` → brak błędów

---

### P5-03 — Build AppImage

**Status:** `pending`  
**Zablokowane przez:** P5-01, P5-02  

#### Kryteria akceptacji
- [ ] `npm run build:appimage` kończy się sukcesem
- [ ] Plik `dist/Windows App-*.AppImage` istnieje
- [ ] AppImage uruchamia się bez sudo: `chmod +x *.AppImage && ./*.AppImage`
- [ ] App ładuje `windows.cloud.microsoft` po uruchomieniu z AppImage

#### Testy manualne
1. Zbuduj: `npm run build:appimage`
2. `chmod +x dist/*.AppImage && dist/*.AppImage`
3. App uruchamia się, ładuje stronę, logowanie działa

---

### P5-04 — Build Flatpak

**Status:** `pending`  
**Zablokowane przez:** P5-01, P5-02  

#### Kryteria akceptacji
- [ ] `npm run build:flatpak` kończy się sukcesem
- [ ] Plik `dist/*.flatpak` istnieje
- [ ] `flatpak install --user dist/*.flatpak` działa
- [ ] App uruchamia się z Flatpak sandbox bez błędów uprawnień (sieć, audio, Wayland/X11)
- [ ] Logowanie do `windows.cloud.microsoft` działa z sandboxu

#### Testy manualne
1. `npm run build:flatpak`
2. `flatpak install --user dist/*.flatpak`
3. `flatpak run io.github.mkoprowski.WindowsAppForLinux`
4. Logowanie i sesja AVD działają
5. Sprawdź że kamera i mikrofon są dostępne w sesji (jeśli tenant to pozwala)

---

### P5-05 — Manifest do Flathub

**Status:** `pending`  
**Zablokowane przez:** P5-04

#### Opis
Flathub wymaga oddzielnego publicznego repozytorium GitHub z manifestem. Nie jest częścią głównego repo.

#### Kryteria akceptacji
- [ ] Repozytorium `flathub/io.github.mkoprowski.WindowsAppForLinux` (lub fork flathub template)
- [ ] Plik `io.github.mkoprowski.WindowsAppForLinux.yml` z manifestem Flatpak
- [ ] Manifest pobiera release AppImage z GitHub Releases lub buduje z source
- [ ] `flatpak-builder --install --user builddir io.github.mkoprowski.WindowsAppForLinux.yml` działa lokalnie
- [ ] PR do `github.com/flathub/flathub` otwarte (ostatni krok)

#### Testy manualne
1. Lokalny build z manifestu Flathub: `flatpak-builder --install --user builddir manifest.yml`
2. App uruchamia się z tego builda

---

## Podsumowanie

| Faza | Zadań | Gotowe |
|---|---|---|
| 1 — Fundament | 11 | 8 |
| 2 — Tab Manager | 9 | 0 |
| 3 — Fullscreen | 4 | 0 |
| 4 — System | 3 | 0 |
| 5 — Packaging | 5 | 0 |
| **Razem** | **32** | **8** |
