/**
 * Veritas ID mark: a landscape ID card
 * Silhouette must differ from the panel's Mark: at 26px it tells the two surfaces apart
 */
export default function IdMark({ size = 26, className = '' }) {
    return (
        <svg
            className={`mark ${className}`.trim()}
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
        >
            <rect x="3" y="7" width="26" height="18" rx="3.2" />
            <circle cx="11.2" cy="14.4" r="2.5" />
            <path d="M7.4 21.4a3.9 3.9 0 0 1 7.6 0" />
            <path d="M19.4 13.4h6.2M19.4 17.2h6.2M19.4 21h3.8" />
        </svg>
    );
}
