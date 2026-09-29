// Pure inventory slot arithmetic: move, stack, swap, split
// No DB, no Express: tested in isolation, since mistakes here duplicate or swallow items

/**
 * Moves `amount` units from slot `from` to `to`; `items` is never mutated
 * @returns {{ok: true, items, partial, amount, name}|{ok: false, status, error}}
 */
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
        // Different or unique items: full swap only; a partial stack has nowhere to land
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
