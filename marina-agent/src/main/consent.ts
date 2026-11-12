import { BrowserWindow, app, ipcMain } from 'electron'
import path from 'path'
import { STORE_KEYS, get, set } from './store'
import { POLICY_VERSION } from './config'
import { bringToFront, hideDockIfIdle } from './window-utils'

let consentWindow: BrowserWindow | null = null
let resolver: ((accepted: boolean) => void) | null = null

/**
 * The policy version the user must have accepted. The server is the source of
 * truth (heartbeat `policyVersion`, from MARINA_POLICY_VERSION) so bumping it
 * there re-prompts every installed agent; the compiled-in POLICY_VERSION is
 * only the fallback before the first heartbeat.
 */
export function requiredPolicyVersion(): string {
  return get(STORE_KEYS.requiredPolicyVersion) ?? POLICY_VERSION
}

export function hasConsented(): boolean {
  return (
    get(STORE_KEYS.consentAt) != null &&
    get(STORE_KEYS.policyVersionAccepted) === requiredPolicyVersion()
  )
}

export function recordConsent(): void {
  set(STORE_KEYS.consentAt, new Date().toISOString())
  set(STORE_KEYS.policyVersionAccepted, requiredPolicyVersion())
}

export async function showConsentWindow(): Promise<boolean> {
  if (consentWindow) {
    bringToFront(consentWindow)
    return new Promise((res) => {
      resolver = res
    })
  }

  consentWindow = new BrowserWindow({
    width: 540,
    height: 600,
    title: 'Marina — Consent',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    alwaysOnTop: true,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-consent.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  consentWindow.removeMenu()
  await consentWindow.loadFile(path.join(__dirname, '..', 'renderer', 'consent.html'))
  bringToFront(consentWindow)

  const promise = new Promise<boolean>((res) => {
    resolver = res
  })

  consentWindow.on('closed', () => {
    consentWindow = null
    hideDockIfIdle()
    if (resolver) {
      resolver(false)
      resolver = null
    }
  })

  return promise
}

export function registerConsentIpc(): void {
  ipcMain.handle('marina:consent:accept', () => {
    recordConsent()
    if (resolver) {
      resolver(true)
      resolver = null
    }
    if (consentWindow) {
      consentWindow.close()
    }
    return true
  })

  ipcMain.handle('marina:consent:decline', () => {
    if (resolver) {
      resolver(false)
      resolver = null
    }
    if (consentWindow) {
      consentWindow.close()
    }
    app.quit()
    return false
  })
}
