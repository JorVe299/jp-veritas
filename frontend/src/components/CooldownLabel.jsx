/**
 * The text of a button that is waiting out its cooldown (see useCooldown).
 *
 * The seconds stand next to the label rather than replacing it, so the
 * button still says what it will do once it opens up again. Tabular
 * numerals keep the button from twitching on every tick.
 */
export default function CooldownLabel({ text, remaining }) {
    if (!remaining) return text;

    return (
        <>
            {text}
            <span className="btn__wait">({remaining}s)</span>
        </>
    );
}
