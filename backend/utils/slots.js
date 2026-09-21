// backend/utils/slots.js
// The pure slot arithmetic of the inventory, deliberately without a
// database and without Express: moving, stacking, swapping and splitting
// are the places where a mistake silently duplicates or swallows items.
// Kept separate so it can be tested without production data.

// Moves `amount` units from slot `from` to slot `to`.
// Returns either { ok: true, items, partial } or
// { ok: false, status, error } - the caller turns that into a response.
//
// `items` is never mutated; the result is a new list.
function applyMove(items, from, to, requestedAmount) {
    const next = items.map(it => ({ ...it }));

    const source = next.find(i => i.slot === from);
    if (!source) {
        return { ok: false, status: 404, error: `Slot ${from} is empty` };
    }

    const amount = requestedAmount == null ? source.amount : Number(requestedAmount);
    if (!Number.isInteger(amount) || amount < 1 || amount > source.amount) {
        return { ok: false, status: 400, error: `amount must be between 1 and ${source.amount}` };
    }

    const target = next.find(i => i.slot === to);
    const partial = amount < source.amount;

    if (!target) {
        // Empty slot: move it all, or split off part of the stack
        if (partial) {
            source.amount -= amount;
            next.push({
                slot: to,
                name: source.name,
                amount,
                metadata: source.metadata,
                label: source.label,
                weight: source.weight,
                unique: source.unique
            });
        } else {
            source.slot = to;
        }
    } else if (target.name === source.name && !source.unique) {
        // Same stackable item: merge them
        target.amount += amount;
        source.amount -= amount;
        if (source.amount <= 0) next.splice(next.indexOf(source), 1);
    } else {
        // Different items (or unique ones): only a complete swap makes
        // sense here. A partial stack would have nowhere to land.
        if (partial) {
            return {
                ok: false,
                status: 409,
                error: `Slot ${to} holds ${target.label || target.name}. Split moves only work onto an empty slot.`
            };
        }
        target.slot = from;
        source.slot = to;
    }

    return { ok: true, items: next, partial, amount, name: source.name };
}

module.exports = { applyMove };
