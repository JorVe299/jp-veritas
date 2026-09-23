import { useCallback, useSyncExternalStore } from 'react';

// A pause after every manual "try again".
//
// A button that asks the backend again is the one place a user can send
// requests as fast as they can click. Each such button therefore waits a
// minute after it was pressed - every press counts, not only the ones that
// worked, because a failing backend is exactly the one that must not be
// hammered.
//
// The state lives out here in the module, not in the component. Switching
// tabs or picking another citizen and coming back unmounts the button, and
// a cooldown that reset on remount would be no cooldown at all. A full page
// reload does reset it; the server holds its own limit where it matters.

const DEFAULT_MS = 60_000;

/** key -> the moment the cooldown runs out (ms timestamp). */
const endsAt = new Map();

/**
 * key -> whole seconds left, as last published to the components.
 *
 * Kept apart from endsAt on purpose: useSyncExternalStore wants the same
 * snapshot back for as long as nothing was announced, and a value computed
 * from Date.now() on every read would change underneath it.
 */
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

    // Ticking only while something is actually counting down. The last
    // cooldown to run out stops the interval again.
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
 * The cooldown of one kind of button.
 *
 * `key` names the button type, not the thing it is pressed for: the position
 * refresh shares one key across all citizens, since the point is limiting
 * requests and not fairness between players.
 *
 * Returns
 *   remaining  whole seconds left, 0 when the button may be pressed
 *   ready      remaining === 0
 *   start(ms)  starts the cooldown; without an argument for the full length,
 *              with one for exactly that long (to follow a server that
 *              already said how long it will keep refusing)
 */
export function useCooldown(key, ms = DEFAULT_MS) {
    const remaining = useSyncExternalStore(subscribe, () => shown.get(key) ?? 0);

    const start = useCallback((duration = ms) => begin(key, duration), [key, ms]);

    return { remaining, ready: remaining === 0, start };
}
