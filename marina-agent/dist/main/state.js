"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bus = void 0;
const events_1 = require("events");
const config_1 = require("./config");
class StateBus extends events_1.EventEmitter {
    state = {
        paired: false,
        paused: false,
        windowTitlesEnabled: false,
        sampleIntervalSeconds: 30,
        flushIntervalSeconds: 300,
        userLogin: null,
        // Default to whatever config.ts resolves — the prod domain in packaged
        // builds, http://localhost:3000 when unpackaged (dev), or MARINA_SERVER_URL
        // if set. Once the user pairs, the serverBaseUrl they typed in the pairing
        // dialog is persisted to the encrypted store and overrides this on boot.
        serverBaseUrl: config_1.DEFAULT_SERVER_BASE_URL,
        lastHeartbeatAt: null,
        lastFlushAt: null,
        pendingCount: 0,
        lastError: null,
        primaryOrgId: null,
        activeBreak: null,
        activeShift: null,
        today: null,
    };
    get() {
        return this.state;
    }
    patch(patch) {
        let changed = false;
        for (const k of Object.keys(patch)) {
            const v = patch[k];
            if (this.state[k] !== v) {
                ;
                this.state[k] = v;
                changed = true;
            }
        }
        if (changed)
            this.emit('change', this.state);
    }
}
exports.bus = new StateBus();
//# sourceMappingURL=state.js.map