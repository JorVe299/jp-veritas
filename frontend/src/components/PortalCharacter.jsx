import Icon from './Icon';
import PortalInventory from './PortalInventory';
import PortalNotice from './PortalNotice';
import PortalVehicles from './PortalVehicles';
import { usePortalResource } from '../lib/usePortal';
import { fetchMyCharacter } from '../api';
import { characterName, gangLine, jobLine, numberOrNull, shown } from '../lib/portalText';
import { formatDateTime, formatMoney } from '../utils/format';

// The four licences the portal is told about, in the order they are worth
// reading. A framework that keeps more of them is not guessed at here.
const LICENCES = [
    { key: 'driver', label: 'Driver' },
    { key: 'business', label: 'Business' },
    { key: 'weapon', label: 'Weapon' },
    { key: 'pilot', label: 'Pilot' },
];

const CONDITION = [
    { key: 'hunger', label: 'Hunger' },
    { key: 'thirst', label: 'Thirst' },
    { key: 'armor', label: 'Armor' },
];

// Cash and bank lead; anything else the framework keeps money in (crypto,
// for one) follows in the order it arrived, rather than being dropped for
// not being on a list written here.
const MONEY_FIRST = ['cash', 'bank'];

function moneyRows(money) {
    if (!money || typeof money !== 'object') return [];

    const keys = [
        ...MONEY_FIRST.filter((key) => key in money),
        ...Object.keys(money).filter((key) => !MONEY_FIRST.includes(key)),
    ];

    return keys
        .map((key) => ({ key, value: numberOrNull(money[key]) }))
        .filter((row) => row.value !== null);
}

/**
 * One character, whole.
 *
 * Read-only is not a mode this view is in - it is all it can do. There is
 * no form, no input, no save, and nothing greyed out either: a disabled
 * field would suggest there is a version of this screen where it is not.
 * Everything here is a sentence about what the server has on record.
 *
 * Mounted with the citizenid as its key, so switching character remounts
 * rather than updates. That way the previous character's data can never
 * stand on screen under the new one's name while the request is in flight.
 */
export default function PortalCharacter({ citizenid, summary = null, onBack }) {
    const state = usePortalResource(fetchMyCharacter, citizenid);

    const record = state.status === 'ready' ? state.data : null;
    // While it loads, the name from the list is already known. Better than
    // an empty heading, and it is the same character either way.
    const heading = characterName(record || summary || { citizenid });
    const onDuty = record?.job?.onduty === true;
    const gang = gangLine(record?.gang);
    const balances = moneyRows(record?.money);

    return (
        <>
            <header className="idhead">
                {onBack && (
                    <button type="button" className="idback" onClick={onBack}>
                        <Icon name="chevronLeft" size={16} />
                        All characters
                    </button>
                )}

                <div className="idhead__line">
                    <h1 className="idhead__name">{heading}</h1>
                    {onDuty && <span className="pill pill--live"><span className="pill__dot" />On duty</span>}
                </div>

                <p className="idhead__meta">
                    <span className="u-mono">{shown(citizenid)}</span>
                    {record && (
                        <>
                            <span className="idrow__sep" aria-hidden="true">·</span>
                            Last seen {formatDateTime(record.lastSeen)}
                        </>
                    )}
                </p>
            </header>

            {state.status === 'loading' && (
                <p className="idnone" role="status">Loading this character…</p>
            )}

            {state.status === 'failed' && (
                <PortalNotice
                    code={state.code}
                    error={state.error}
                    hint={state.hint}
                    onRetry={state.reload}
                />
            )}

            {record && (
                <>
                    <div className="idpanels">
                        <section className="idpanel">
                            <header className="idpanel__head">
                                <Icon name="id" size={18} className="idpanel__icon" />
                                <h2 className="idpanel__title">Papers</h2>
                            </header>
                            <div className="idpanel__body">
                                <dl className="kv">
                                    <Row label="First name" value={record.charinfo?.firstname} />
                                    <Row label="Last name" value={record.charinfo?.lastname} />
                                    {/* Shown exactly as the server keeps it.
                                        Reformatting a date of birth means
                                        guessing which way round the day and
                                        the month are. */}
                                    <Row label="Date of birth" value={record.charinfo?.birthdate} mono />
                                    <Row label="Nationality" value={record.charinfo?.nationality} />
                                    <Row label="Phone" value={record.charinfo?.phone} mono />
                                </dl>
                            </div>
                        </section>

                        <section className="idpanel">
                            <header className="idpanel__head">
                                <Icon name="briefcase" size={18} className="idpanel__icon" />
                                <h2 className="idpanel__title">Work</h2>
                            </header>
                            <div className="idpanel__body">
                                <dl className="kv">
                                    <Row label="Job" value={jobLine(record.job)} />
                                    <Row label="On duty" value={onDuty ? 'Yes' : 'No'} />
                                    {/* Belonging to no gang is the ordinary
                                        case, so it is written out rather
                                        than left as an empty row. */}
                                    <Row label="Gang" value={gang || 'None'} />
                                </dl>
                            </div>
                        </section>

                        <section className="idpanel">
                            <header className="idpanel__head">
                                <Icon name="cash" size={18} className="idpanel__icon" />
                                <h2 className="idpanel__title">Money</h2>
                            </header>
                            <div className="idpanel__body">
                                {balances.length === 0 ? (
                                    <p className="idnone">No balances are recorded for this character.</p>
                                ) : (
                                    <ul className="idsums">
                                        {balances.map((row) => (
                                            <li key={row.key} className="idsum idsum--block">
                                                <span className="idsum__key u-caps">{row.key}</span>
                                                <span className="idsum__value idsum__value--big u-mono">
                                                    {formatMoney(row.value)}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </section>

                        <section className="idpanel">
                            <header className="idpanel__head">
                                <Icon name="check" size={18} className="idpanel__icon" />
                                <h2 className="idpanel__title">Licences</h2>
                            </header>
                            <div className="idpanel__body">
                                <ul className="idlics">
                                    {LICENCES.map((licence) => (
                                        <Licence
                                            key={licence.key}
                                            label={licence.label}
                                            held={record.licences?.[licence.key]}
                                        />
                                    ))}
                                </ul>
                            </div>
                        </section>

                        <section className="idpanel">
                            <header className="idpanel__head">
                                <Icon name="pulse" size={18} className="idpanel__icon" />
                                <h2 className="idpanel__title">Condition</h2>
                            </header>
                            <div className="idpanel__body idpanel__body--gauges">
                                {CONDITION.map((entry) => (
                                    <Gauge
                                        key={entry.key}
                                        label={entry.label}
                                        value={record.condition?.[entry.key]}
                                    />
                                ))}
                            </div>
                        </section>
                    </div>

                    <div className="idpanels idpanels--wide">
                        <PortalInventory citizenid={citizenid} />
                        <PortalVehicles citizenid={citizenid} />
                    </div>
                </>
            )}
        </>
    );
}

function Row({ label, value, mono = false }) {
    const shownValue = shown(value);
    const known = shownValue !== '—';

    return (
        <div className="kv__row">
            <dt className="kv__key">{label}</dt>
            <dd className={`kv__value${mono && known ? ' u-mono' : ''}${known ? '' : ' kv__value--none'}`}>
                {known ? shownValue : 'Not recorded'}
            </dd>
        </div>
    );
}

/**
 * Held or not held - and a third case that is neither. If the server sent
 * no value for a licence at all, saying "not held" would be an answer
 * nobody gave.
 */
function Licence({ label, held }) {
    const known = held === true || held === false;

    return (
        <li className={`idlic${held === true ? ' idlic--held' : ''}`}>
            <Icon name={held === true ? 'check' : known ? 'cross' : 'info'} size={16} className="idlic__icon" />
            <span className="idlic__label">{label}</span>
            <span className="idlic__state">
                {held === true ? 'Held' : known ? 'Not held' : 'Not recorded'}
            </span>
        </li>
    );
}

/**
 * A condition reading as a bar. The bar is scaled with a transform rather
 * than a width, the same way the panel's weight bar is: a width animates
 * through layout, a transform does not.
 */
function Gauge({ label, value }) {
    const n = numberOrNull(value);

    if (n === null) {
        return (
            <div className="weigh">
                <div className="weigh__head">
                    <span>{label}</span>
                    <span className="weigh__value kv__value--none">Not recorded</span>
                </div>
            </div>
        );
    }

    // The reading is shown as it came; only the drawing is clamped, because
    // a bar cannot be longer than its track.
    const scale = Math.min(1, Math.max(0, n / 100));

    return (
        <div className="weigh">
            <div className="weigh__head">
                <span>{label}</span>
                <span className="weigh__value u-mono">{n}</span>
            </div>
            <div className="weigh__bar">
                <span className="weigh__fill" style={{ transform: `scaleX(${scale})` }} />
            </div>
        </div>
    );
}
