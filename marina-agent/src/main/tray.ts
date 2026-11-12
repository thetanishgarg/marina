import { Menu, Tray, app, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { bus } from './state'
import { postPause } from './api'
import { drainOnQuit } from './uploader'
import { pingOnce } from './heartbeat'
import { startSampler, stopSampler } from './sampler'
import { startShotter, stopShotter } from './shotter'
import { SCREENSHOTS_ENABLED } from './config'
import { openPairingWindow } from './pairing'
import { openOnboardingWindow } from './onboarding'
import { openBreakWindow } from './break'
import { openLeaveWindow } from './leave'
import { openPunchOutWindow, performPunchIn } from './punch'
import { openDoneWindow } from './done'

let tray: Tray | null = null

// 1x1 fully-transparent PNG — Electron requires a real image even when we set
// only the menubar title. We render the visible state via setTitle().
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

export function createTray(): Tray {
  let image: Electron.NativeImage
  if (process.platform === 'win32') {
    // Windows shows no menubar title, so it needs a real, visible tray icon —
    // the transparent placeholder would be invisible in the system tray.
    const loaded = nativeImage.createFromPath(join(__dirname, '..', 'assets', 'tray.png'))
    image = loaded.isEmpty()
      ? nativeImage.createFromBuffer(Buffer.from(TRANSPARENT_PNG_BASE64, 'base64'))
      : loaded.resize({ width: 16, height: 16 })
  } else {
    // macOS renders the visible state via setTitle(); a transparent template
    // image keeps the menubar tidy in light + dark mode.
    image = nativeImage.createFromBuffer(Buffer.from(TRANSPARENT_PNG_BASE64, 'base64'))
    image.setTemplateImage(true)
  }
  tray = new Tray(image)
  tray.setIgnoreDoubleClickEvents(true)
  rebuild()
  bus.on('change', rebuild)
  // Single-click on the tray icon opens setup if not paired — saves users
  // having to discover the menu. Routes through onboarding so consent is
  // captured before anything is tracked.
  tray.on('click', () => {
    if (!bus.get().paired) {
      openOnboardingWindow()
    }
  })
  return tray
}

let cameraUntil = 0
function statusGlyph(): string {
  const s = bus.get()
  if (Date.now() < cameraUntil) return '◉' // brief capture indicator
  if (!s.paired) return '◌'
  if (s.paused) return '⏸'
  if (s.lastError) return '!'
  return '●'
}

export function flashCameraIndicator(durationMs = 1500): void {
  cameraUntil = Date.now() + durationMs
  // Force a rebuild now and again when the flash ends.
  rebuild()
  setTimeout(() => rebuild(), durationMs + 50)
}

function statusLine(): string {
  const s = bus.get()
  if (!s.paired) return 'Not paired'
  // Personal mode (no org): there are no shifts/punch — tracking runs
  // continuously and feeds the user's own journal, so the status is about
  // tracking, not attendance.
  if (s.primaryOrgId == null) {
    if (s.paused) return 'Paused'
    if (s.lastError) return s.lastError
    return `Tracking your focus${s.pendingCount > 0 ? ` · ${s.pendingCount} pending` : ''}`
  }
  if (!s.activeShift) return 'Off-clock · not punched in'
  if (s.activeBreak) {
    const mins = Math.floor((Date.now() - new Date(s.activeBreak.startedAt).getTime()) / 60000)
    return `On break · ${mins}m`
  }
  if (s.paused) return 'Paused'
  if (s.lastError) return s.lastError
  const shiftMins = Math.floor((Date.now() - new Date(s.activeShift.punchedInAt).getTime()) / 60000)
  const h = Math.floor(shiftMins / 60)
  const m = shiftMins % 60
  return `Available · ${h}h ${m}m${s.pendingCount > 0 ? ` · ${s.pendingCount} pending` : ''}`
}

function rebuild(): void {
  if (!tray) return
  const state = bus.get()
  // macOS: text title in the menubar. Windows: tooltip on hover.
  if (process.platform === 'darwin') {
    tray.setTitle(`${statusGlyph()} Marina`)
  } else {
    tray.setToolTip(`Marina · ${statusLine()}`)
  }

  const items: Electron.MenuItemConstructorOptions[] = [
    { label: statusLine(), enabled: false },
  ]

  if (!state.paired) {
    // Top-of-menu setup CTA when not paired so users can never miss it
    items.push({
      label: '✨  Set up Marina…',
      click: () => openOnboardingWindow(),
    })
  } else if (state.userLogin) {
    items.push({ label: `@${state.userLogin}`, enabled: false })
  }
  // Today — same numbers as the web "Your day" card (from /api/agent/day).
  if (state.paired && state.today?.punchedIn) {
    const t = state.today
    items.push({
      label: `Today · ${t.productivity}% focus · ${t.deliverablesToday} shipped`,
      enabled: false,
    })
    if (t.nextMeetingAt && t.nextMeetingTitle) {
      const at = new Date(t.nextMeetingAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      const title = t.nextMeetingTitle.length > 32 ? `${t.nextMeetingTitle.slice(0, 32)}…` : t.nextMeetingTitle
      items.push({ label: `Next · ${title} at ${at}`, enabled: false })
    }
  }
  items.push({ type: 'separator' })

  if (state.paired) {
    // Employer/attendance actions (punch, breaks, mark-done, leave) only exist
    // for users who belong to an org. A standalone (personal) user has no
    // employer — their agent is purely a private focus tracker, so we omit all
    // of these and keep just the tracking controls below.
    const hasOrg = state.primaryOrgId != null
    if (hasOrg) {
      // Punch state — the primary action
      if (!state.activeShift) {
        items.push({
          label: '▶︎  Punch in for today',
          click: () => void performPunchIn(),
        })
      } else {
        items.push({
          label: '⏏︎  Punch out…',
          click: () => openPunchOutWindow(),
        })
        items.push({ type: 'separator' })
        if (state.activeBreak) {
          items.push({
            label: `End break · ${state.activeBreak.reason.slice(0, 40)}${state.activeBreak.reason.length > 40 ? '…' : ''}`,
            click: () => openBreakWindow(),
          })
        } else {
          items.push({
            label: 'Take a break…',
            accelerator: process.platform === 'darwin' ? 'Cmd+Shift+B' : 'Ctrl+Shift+B',
            click: () => openBreakWindow(),
          })
        }
        // "Mark work as done" — the fast path that puts visible output into the
        // manager's daily digest. Available whenever the user is on the clock.
        items.push({
          label: 'Mark work as done…',
          accelerator: process.platform === 'darwin' ? 'Cmd+Shift+D' : 'Ctrl+Shift+D',
          click: () => openDoneWindow(),
        })
      }
      items.push({
        label: 'Request leave…',
        click: () => openLeaveWindow(),
      })
      items.push({ type: 'separator' })
    }
    items.push({
      // Personal users track continuously (no shift), so pause is always
      // available; org users can only pause while punched in.
      label: state.paused ? 'Resume tracking' : 'Pause tracking',
      click: () => void togglePause(),
      enabled: hasOrg ? !!state.activeShift : true,
    })
    items.push({
      label: 'Open dashboard',
      click: () => void shell.openExternal(`${state.serverBaseUrl}/dashboard`),
    })
    items.push({
      label: 'Open settings',
      click: () => void shell.openExternal(`${state.serverBaseUrl}/settings`),
    })
    items.push({ type: 'separator' })
    items.push({
      label: 'Re-pair this device…',
      click: () => openPairingWindow(),
    })
  }

  items.push({ type: 'separator' })
  items.push({
    label: 'Quit Marina',
    click: async () => {
      await drainOnQuit()
      app.quit()
    },
  })

  tray.setContextMenu(Menu.buildFromTemplate(items))
}

async function togglePause(): Promise<void> {
  const desired = !bus.get().paused
  // Fast local apply for snappy UX.
  bus.patch({ paused: desired })
  if (desired) {
    stopSampler({ flush: true })
    stopShotter()
  } else {
    startSampler()
    // GATEKEPT: screenshot capture is off for now (see config.SCREENSHOTS_ENABLED).
    if (SCREENSHOTS_ENABLED) startShotter()
  }

  try {
    await postPause(desired)
    // Reconcile with the server (covers the race where pause was changed elsewhere).
    void pingOnce()
  } catch (err) {
    console.error('togglePause failed', err)
    bus.patch({ lastError: `pause: ${String(err)}` })
  }
}
