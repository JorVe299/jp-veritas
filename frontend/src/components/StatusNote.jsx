import Icon from './Icon';

// Dezentes Inline-Feedback statt alert(). Wird per role="status" auch von
// Screenreadern angesagt und bleibt so lange stehen, bis der naechste
// Vorgang sie ersetzt - anders als ein Dialog, den man wegklickt.

const ICONS = {
    success: 'check',
    error: 'cross',
    warn: 'warn',
    info: 'info',
};

export default function StatusNote({ tone = 'info', title, detail, className = '' }) {
    return (
        <div className={`note note--${tone} ${className}`.trim()} role="status">
            <Icon name={ICONS[tone] ?? ICONS.info} size={17} className="note__icon" />
            <div>
                <div className="note__title">{title}</div>
                {detail && <div className="note__detail">{detail}</div>}
            </div>
        </div>
    );
}
