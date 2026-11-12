"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const config_1 = require("./config");
const store_1 = require("./store");
const state_1 = require("./state");
const tray_1 = require("./tray");
const uploader_1 = require("./uploader");
const sampler_1 = require("./sampler");
const shotter_1 = require("./shotter");
const heartbeat_1 = require("./heartbeat");
const consent_1 = require("./consent");
const pairing_1 = require("./pairing");
const onboarding_1 = require("./onboarding");
const break_1 = require("./break");
const leave_1 = require("./leave");
const punch_1 = require("./punch");
const done_1 = require("./done");
const notifications_1 = require("./notifications");
const server_feed_1 = require("./server-feed");
/**
 * Deep-link handler for the `marina://` protocol. The web app uses this to let
 * an employee punch in/out from the browser while still going through the
 * desktop agent (so activity tracking stays on). Shapes we accept:
 *   marina://punch          → toggle (punch out if on shift, else punch in)
 *   marina://punch/in       → punch in
 *   marina://punch/out      → open the punch-out summary window
 */
function handleDeepLink(rawUrl) {
    if (!rawUrl)
        return;
    let action = '';
    try {
        const u = new URL(rawUrl);
        if (u.protocol !== 'marina:')
            return;
        // marina://punch/in → host 'punch', path '/in'. Be lenient about both.
        const seg = `${u.hostname}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
        if (seg === 'punch' || seg === 'punch/in')
            action = 'in';
        else if (seg === 'punch/out')
            action = 'out';
        else if (seg === 'punch')
            action = 'toggle';
    }
    catch {
        return;
    }
    if (!action)
        return;
    const onShift = !!state_1.bus.get().activeShift;
    if (action === 'out' || (action === 'toggle' && onShift)) {
        (0, punch_1.openPunchOutWindow)();
    }
    else {
        void (0, punch_1.performPunchIn)();
    }
}
// Single-instance lock — second launch focuses any open pairing/consent window.
const got = electron_1.app.requestSingleInstanceLock();
if (!got) {
    electron_1.app.quit();
}
electron_1.app.on('second-instance', (_e, argv) => {
    // Windows/Linux deliver `marina://…` deep links as an argv entry on the
    // second launch (the first instance owns the lock). macOS uses 'open-url'.
    const deepLink = argv.find((a) => a.startsWith('marina://'));
    if (deepLink)
        handleDeepLink(deepLink);
    // Otherwise no-op — the agent is a menubar app with nothing to refocus.
});
// macOS delivers deep links here (can fire before whenReady on a cold launch).
electron_1.app.on('open-url', (e, url) => {
    e.preventDefault();
    handleDeepLink(url);
});
// macOS: prevent the dock icon entirely. (Also handled via LSUIElement in plist.)
// Windows: nothing to hide — tray-only by virtue of never creating a frame window.
if (process.platform === 'darwin' && electron_1.app.dock && typeof electron_1.app.dock.hide === 'function') {
    electron_1.app.dock.hide();
}
electron_1.app.on('window-all-closed', () => {
    // Keep the app alive when all windows close; tray is the only UI.
    // (Default behavior on macOS is to keep running; we add this to be explicit
    // and to ensure platforms other than macOS also keep the tray active.)
});
let isQuitting = false;
electron_1.app.on('before-quit', async (e) => {
    if (isQuitting)
        return;
    isQuitting = true;
    e.preventDefault();
    try {
        (0, shotter_1.stopShotter)();
        (0, sampler_1.stopSampler)({ flush: true });
        await (0, uploader_1.drainOnQuit)();
    }
    finally {
        (0, notifications_1.stopNotifications)();
        (0, server_feed_1.stopServerFeed)();
        (0, heartbeat_1.stopHeartbeat)();
        (0, uploader_1.stopUploader)();
        electron_1.app.exit(0);
    }
});
electron_1.app.whenReady().then(async () => {
    console.log('marina-agent', config_1.AGENT_VERSION, 'starting');
    // Register as the handler for marina:// so the web app can launch a punch.
    // In production electron-builder also writes the OS association; this call
    // covers dev and re-asserts it on every boot.
    try {
        electron_1.app.setAsDefaultProtocolClient('marina');
    }
    catch (err) {
        console.error('setAsDefaultProtocolClient failed', err);
    }
    // Windows cold-launch: the deep link is in our own argv.
    if (process.platform !== 'darwin') {
        const deepLink = process.argv.find((a) => a.startsWith('marina://'));
        if (deepLink)
            setTimeout(() => handleDeepLink(deepLink), 1500);
    }
    // Auto-launch at login (off in dev — only persist for packaged builds).
    if (electron_1.app.isPackaged) {
        electron_1.app.setLoginItemSettings({
            openAtLogin: true,
            openAsHidden: true,
        });
    }
    // Seed state from store.
    const storedServer = (0, store_1.get)(config_1.STORE_KEYS.serverBaseUrl) ?? config_1.DEFAULT_SERVER_BASE_URL;
    state_1.bus.patch({
        serverBaseUrl: storedServer,
        paused: (0, store_1.get)(config_1.STORE_KEYS.paused) ?? false,
        windowTitlesEnabled: (0, store_1.get)(config_1.STORE_KEYS.windowTitlesEnabled) ?? false,
        sampleIntervalSeconds: (0, store_1.get)(config_1.STORE_KEYS.sampleIntervalSeconds) ?? 30,
        flushIntervalSeconds: (0, store_1.get)(config_1.STORE_KEYS.flushIntervalSeconds) ?? 300,
        userLogin: (0, store_1.get)(config_1.STORE_KEYS.userLogin) ?? null,
    });
    (0, consent_1.registerConsentIpc)();
    (0, onboarding_1.registerOnboardingIpc)();
    (0, break_1.registerBreakIpc)();
    (0, leave_1.registerLeaveIpc)();
    (0, punch_1.registerPunchIpc)();
    (0, done_1.registerDoneIpc)();
    (0, pairing_1.registerPairingIpc)(() => {
        // Once paired, start the always-on services. Tracking (sampler+shotter)
        // only starts when the user punches in — heartbeat will turn it on.
        (0, heartbeat_1.resetRevokedFlag)();
        (0, heartbeat_1.startHeartbeat)();
        (0, uploader_1.startUploader)();
        (0, notifications_1.startNotifications)();
        (0, server_feed_1.startServerFeed)();
    });
    // Always create the tray first so the user has UI even before consent finishes.
    (0, tray_1.createTray)();
    // Global keyboard shortcuts — these stay registered as long as the agent
    // is running, regardless of which app is focused. The shortcut hints in
    // the tray menu (`accelerator` field) only describe these, they do NOT
    // register them — `globalShortcut.register()` is the source of truth.
    //
    // Mac uses Cmd+Shift+<key>, Windows/Linux uses Ctrl+Shift+<key>. We pick
    // letters that don't collide with anything common in IDEs or browsers.
    const mod = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
    try {
        electron_1.globalShortcut.register(`${mod}+Shift+D`, () => (0, done_1.openDoneWindow)());
        electron_1.globalShortcut.register(`${mod}+Shift+B`, () => (0, break_1.openBreakWindow)());
    }
    catch (err) {
        console.error('globalShortcut.register failed', err);
    }
    electron_1.app.on('will-quit', () => {
        electron_1.globalShortcut.unregisterAll();
    });
    // First-run flow. If this device is already paired AND consent is on record,
    // boot straight into the always-on services. Otherwise run onboarding — one
    // guided flow that covers consent + pairing + how-to and starts services the
    // moment pairing completes (via the onPaired callback above). Consent is a
    // hard gate, enforced because every "not paired" entry point routes here.
    const token = (0, store_1.readToken)();
    if (token && (0, consent_1.hasConsented)()) {
        state_1.bus.patch({ paired: true });
        (0, heartbeat_1.startHeartbeat)();
        (0, uploader_1.startUploader)();
        (0, notifications_1.startNotifications)();
        (0, server_feed_1.startServerFeed)();
        await (0, heartbeat_1.pingOnce)(); // initial state sync — heartbeat reconciles tracking
    }
    else {
        (0, onboarding_1.openOnboardingWindow)();
    }
});
//# sourceMappingURL=index.js.map