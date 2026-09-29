/** Cooldown button text (see useCooldown); seconds sit beside the label, never replace it */
export default function CooldownLabel({ text, remaining }) {
    if (!remaining) return text;

    return (
        <>
            {text}
            <span className="btn__wait">({remaining}s)</span>
        </>
    );
}
