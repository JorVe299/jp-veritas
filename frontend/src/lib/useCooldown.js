import { useCallback, useSyncExternalStore } from 'react';

// Every retry press starts a cooldown, failures too: a failing backend must not be hammered
// Module state: a remount must not reset it; a page reload does (the server has its own limit)

const DEFAULT_MS = 60_000;

// key -> end time (ms timestamp)
const endsAt = new Map();

// key -> whole seconds left, as last published
// Separate from endsAt: useSyncExternalStore needs a stable snapshot between notifications
const shown = new Map();

const listeners = new Set();
let timer = null;

function tick() {
    const now = Date.now();

    for (const [key, end] of endsAt) {
        const left = Math.max(0, Math.ceil((end - now) / 1000));
        if (left > 0) {
            shown.set(key, left);
        } else {
            endsAt.delete(key);
            shown.delete(key);
        }
    }

    if (endsAt.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
    }

    listeners.forEach((listener) => listener());
}

function begin(key, ms) {
    endsAt.set(key, Date.now() + Math.max(0, ms));
    if (timer === null) timer = setInterval(tick, 1000);
    tick();
}

function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/**
 * One cooldown per key: the key names the button type, not its target (it limits requests)
 * remaining: whole seconds; start() runs the full length, start(ms) matches a server's refusal
 */
export function useCooldown(key, ms = DEFAULT_MS) {
    const remaining = useSyncExternalStore(subscribe, () => shown.get(key) ?? 0);

    const start = useCallback((duration = ms) => begin(key, duration), [key, ms]);

    return { remaining, ready: remaining === 0, start };
}
