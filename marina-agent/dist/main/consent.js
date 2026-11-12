"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requiredPolicyVersion = requiredPolicyVersion;
exports.hasConsented = hasConsented;
exports.recordConsent = recordConsent;
exports.showConsentWindow = showConsentWindow;
exports.registerConsentIpc = registerConsentIpc;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const store_1 = require("./store");
const config_1 = require("./config");
const window_utils_1 = require("./window-utils");
let consentWindow = null;
let resolver = null;
/**
 * The policy version the user must have accepted. The server is the source of
 * truth (heartbeat `policyVersion`, from MARINA_POLICY_VERSION) so bumping it
 * there re-prompts every installed agent; the compiled-in POLICY_VERSION is
 * only the fallback before the first heartbeat.
 */
function requiredPolicyVersion() {
    return (0, store_1.get)(store_1.STORE_KEYS.requiredPolicyVersion) ?? config_1.POLICY_VERSION;
}
function hasConsented() {
    return ((0, store_1.get)(store_1.STORE_KEYS.consentAt) != null &&
        (0, store_1.get)(store_1.STORE_KEYS.policyVersionAccepted) === requiredPolicyVersion());
}
function recordConsent() {
    (0, store_1.set)(store_1.STORE_KEYS.consentAt, new Date().toISOString());
    (0, store_1.set)(store_1.STORE_KEYS.policyVersionAccepted, requiredPolicyVersion());
}
async function showConsentWindow() {
    if (consentWindow) {
        (0, window_utils_1.bringToFront)(consentWindow);
        return new Promise((res) => {
            resolver = res;
        });
    }
    consentWindow = new electron_1.BrowserWindow({
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
            preload: path_1.default.join(__dirname, 'preload-consent.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    consentWindow.removeMenu();
    await consentWindow.loadFile(path_1.default.join(__dirname, '..', 'renderer', 'consent.html'));
    (0, window_utils_1.bringToFront)(consentWindow);
    const promise = new Promise((res) => {
        resolver = res;
    });
    consentWindow.on('closed', () => {
        consentWindow = null;
        (0, window_utils_1.hideDockIfIdle)();
        if (resolver) {
            resolver(false);
            resolver = null;
        }
    });
    return promise;
}
function registerConsentIpc() {
    electron_1.ipcMain.handle('marina:consent:accept', () => {
        recordConsent();
        if (resolver) {
            resolver(true);
            resolver = null;
        }
        if (consentWindow) {
            consentWindow.close();
        }
        return true;
    });
    electron_1.ipcMain.handle('marina:consent:decline', () => {
        if (resolver) {
            resolver(false);
            resolver = null;
        }
        if (consentWindow) {
            consentWindow.close();
        }
        electron_1.app.quit();
        return false;
    });
}
//# sourceMappingURL=consent.js.map