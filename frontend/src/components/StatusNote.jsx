import Icon from './Icon';

// Discreet inline feedback instead of alert(). role="status" has screen
// readers announce it too, and it stays until the next operation replaces
// it - unlike a dialog that gets clicked away.

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
