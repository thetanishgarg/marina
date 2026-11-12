import { app, globalShortcut } from 'electron'
import { AGENT_VERSION, DEFAULT_SERVER_BASE_URL, STORE_KEYS } from './config'
import { get, readToken, set } from './store'
import { bus } from './state'
import { createTray } from './tray'
import { startUploader, stopUploader, drainOnQuit } from './uploader'
import { stopSampler } from './sampler'
import { stopShotter } from './shotter'
import { startHeartbeat, stopHeartbeat, pingOnce, resetRevokedFlag } from './heartbeat'
import { hasConsented, registerConsentIpc } from './consent'
import { registerPairingIpc } from './pairing'
import { openOnboardingWindow, registerOnboardingIpc } from './onboarding'
import { registerBreakIpc, openBreakWindow } from './break'
import { registerLeaveIpc } from './leave'
import { registerPunchIpc, performPunchIn, openPunchOutWindow } from './punch'
import { registerDoneIpc, openDoneWindow } from './done'
import { startNotifications, stopNotifications } from './notifications'
import { startServerFeed, stopServerFeed } from './server-feed'

/**
 * Deep-link handler for the `marina://` protocol. The web app uses this to let
 * an employee punch in/out from the browser while still going through the
 * desktop agent (so activity tracking stays on). Shapes we accept:
 *   marina://punch          → toggle (punch out if on shift, else punch in)
 *   marina://punch/in       → punch in
 *   marina://punch/out      → open the punch-out summary window
 */
function handleDeepLink(rawUrl: string | undefined): void {
  if (!rawUrl) return
  let action = ''
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'marina:') return
    // marina://punch/in → host 'punch', path '/in'. Be lenient about both.
    const seg = `${u.hostname}${u.pathname}`.replace(/\/+$/, '').toLowerCase()
    if (seg === 'punch' || seg === 'punch/in') action = 'in'
    else if (seg === 'punch/out') action = 'out'
    else if (seg === 'punch') action = 'toggle'
  } catch {
    return
  }
  if (!action) return

  const onShift = !!bus.get().activeShift
  if (action === 'out' || (action === 'toggle' && onShift)) {
    openPunchOutWindow()
  } else {
    void performPunchIn()
  }
}

// Single-instance lock — second launch focuses any open pairing/consent window.
const got = app.requestSingleInstanceLock()
if (!got) {
  app.quit()
}

app.on('second-instance', (_e, argv) => {
  // Windows/Linux deliver `marina://…` deep links as an argv entry on the
  // second launch (the first instance owns the lock). macOS uses 'open-url'.
  const deepLink = argv.find((a) => a.startsWith('marina://'))
  if (deepLink) handleDeepLink(deepLink)
  // Otherwise no-op — the agent is a menubar app with nothing to refocus.
})

// macOS delivers deep links here (can fire before whenReady on a cold launch).
app.on('open-url', (e, url) => {
  e.preventDefault()
  handleDeepLink(url)
})

// macOS: prevent the dock icon entirely. (Also handled via LSUIElement in plist.)
// Windows: nothing to hide — tray-only by virtue of never creating a frame window.
if (process.platform === 'darwin' && app.dock && typeof app.dock.hide === 'function') {
  app.dock.hide()
}

app.on('window-all-closed', () => {
  // Keep the app alive when all windows close; tray is the only UI.
  // (Default behavior on macOS is to keep running; we add this to be explicit
  // and to ensure platforms other than macOS also keep the tray active.)
})

let isQuitting = false
app.on('before-quit', async (e) => {
  if (isQuitting) return
  isQuitting = true
  e.preventDefault()
  try {
    stopShotter()
    stopSampler({ flush: true })
    await drainOnQuit()
  } finally {
    stopNotifications()
    stopServerFeed()
    stopHeartbeat()
    stopUploader()
    app.exit(0)
  }
})

app.whenReady().then(async () => {
  console.log('marina-agent', AGENT_VERSION, 'starting')

  // Register as the handler for marina:// so the web app can launch a punch.
  // In production electron-builder also writes the OS association; this call
  // covers dev and re-asserts it on every boot.
  try {
    app.setAsDefaultProtocolClient('marina')
  } catch (err) {
    console.error('setAsDefaultProtocolClient failed', err)
  }
  // Windows cold-launch: the deep link is in our own argv.
  if (process.platform !== 'darwin') {
    const deepLink = process.argv.find((a) => a.startsWith('marina://'))
    if (deepLink) setTimeout(() => handleDeepLink(deepLink), 1500)
  }

  // Auto-launch at login (off in dev — only persist for packaged builds).
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
    })
  }

  // Seed state from store.
  const storedServer = get(STORE_KEYS.serverBaseUrl) ?? DEFAULT_SERVER_BASE_URL
  bus.patch({
    serverBaseUrl: storedServer,
    paused: get(STORE_KEYS.paused) ?? false,
    windowTitlesEnabled: get(STORE_KEYS.windowTitlesEnabled) ?? false,
    sampleIntervalSeconds: get(STORE_KEYS.sampleIntervalSeconds) ?? 30,
    flushIntervalSeconds: get(STORE_KEYS.flushIntervalSeconds) ?? 300,
    userLogin: get(STORE_KEYS.userLogin) ?? null,
  })

  registerConsentIpc()
  registerOnboardingIpc()
  registerBreakIpc()
  registerLeaveIpc()
  registerPunchIpc()
  registerDoneIpc()
  registerPairingIpc(() => {
    // Once paired, start the always-on services. Tracking (sampler+shotter)
    // only starts when the user punches in — heartbeat will turn it on.
    resetRevokedFlag()
    startHeartbeat()
    startUploader()
    startNotifications()
    startServerFeed()
  })

  // Always create the tray first so the user has UI even before consent finishes.
  createTray()

  // Global keyboard shortcuts — these stay registered as long as the agent
  // is running, regardless of which app is focused. The shortcut hints in
  // the tray menu (`accelerator` field) only describe these, they do NOT
  // register them — `globalShortcut.register()` is the source of truth.
  //
  // Mac uses Cmd+Shift+<key>, Windows/Linux uses Ctrl+Shift+<key>. We pick
  // letters that don't collide with anything common in IDEs or browsers.
  const mod = process.platform === 'darwin' ? 'Cmd' : 'Ctrl'
  try {
    globalShortcut.register(`${mod}+Shift+D`, () => openDoneWindow())
    globalShortcut.register(`${mod}+Shift+B`, () => openBreakWindow())
  } catch (err) {
    console.error('globalShortcut.register failed', err)
  }

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })

  // First-run flow. If this device is already paired AND consent is on record,
  // boot straight into the always-on services. Otherwise run onboarding — one
  // guided flow that covers consent + pairing + how-to and starts services the
  // moment pairing completes (via the onPaired callback above). Consent is a
  // hard gate, enforced because every "not paired" entry point routes here.
  const token = readToken()
  if (token && hasConsented()) {
    bus.patch({ paired: true })
    startHeartbeat()
    startUploader()
    startNotifications()
    startServerFeed()
    await pingOnce() // initial state sync — heartbeat reconciles tracking
  } else {
    openOnboardingWindow()
  }
})
