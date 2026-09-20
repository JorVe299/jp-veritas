// backend/utils/slots.js
// Die reine Slot-Arithmetik des Inventars, bewusst ohne Datenbank und ohne
// Express: verschieben, stapeln, tauschen und teilen sind die Stellen, an
// denen ein Fehler stillschweigend Items verdoppelt oder verschluckt.
// Getrennt, damit sie ohne Produktionsdaten pruefbar sind.

// Verschiebt `amount` Stueck von Slot `from` auf Slot `to`.
// Gibt entweder { ok: true, items, partial } zurueck oder
// { ok: false, status, error } - der Aufrufer macht daraus eine Antwort.
//
// `items` wird nicht veraendert; das Ergebnis ist eine neue Liste.
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
        // Freier Platz: ganz hinueber, oder einen Teilstapel abspalten
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
        // Gleiches stapelbares Item: zusammenlegen
        target.amount += amount;
        source.amount -= amount;
        if (source.amount <= 0) next.splice(next.indexOf(source), 1);
    } else {
        // Unterschiedliche Items (oder Einzelstuecke): nur ein vollstaendiger
        // Tausch ergibt Sinn. Ein Teilstapel haette hier kein Ziel.
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
