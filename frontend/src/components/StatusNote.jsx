import Icon from './Icon';

const ICONS = {
    success: 'check',
    error: 'cross',
    warn: 'warn',
    info: 'info',
};

/** Inline feedback instead of alert(); role="status" gets it announced; stays until replaced */
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
