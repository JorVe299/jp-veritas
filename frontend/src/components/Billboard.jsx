import Icon from './Icon';
import Plate from './Plate';
import { formatCurrency, jobTitle } from '../utils/format';

/**
 * Der Kopfbereich. Ohne Auswahl bleibt er flach und zeigt nur, was diese
 * Oberflaeche ist. Mit Auswahl wird er zum Schluesselbild des Citizens und
 * beantwortet auf einen Blick "wen habe ich vor mir und was stimmt gerade".
 *
 * Der Online-Status unterscheidet ausdruecklich zwischen "nicht auf dem
 * Server" und "unbekannt", solange die FiveM-Bruecke nicht antwortet.
 */
export default function Billboard({ player, bridgeDown, writeLog, onClear }) {
    if (!player) {
        return (
            <section className="billboard billboard--idle">
                <div className="billboard__art" aria-hidden="true">
                    <Plate citizenid="los-santos-dusk" shape="wide" />
                    <span className="billboard__grain" />
                    <span className="billboard__scrim" />
                </div>

                <div className="billboard__intro">
                    <h1 className="billboard__lede u-display">
                        Every citizen on this server, online or not.
                    </h1>
                    <p className="billboard__sub">
                        Pick a citizen below to change their job, rank or balances. Changes
                        apply live when they are connected, and go straight to the database
                        when they are not.
                    </p>
                </div>
            </section>
        );
    }

    const status = bridgeDown
        ? { cls: 'pill--unknown', text: 'Status unverified' }
        : player.isOnline
            ? { cls: 'pill--live', text: 'On the server now' }
            : { cls: 'pill--off', text: 'Not on the server' };

    const char = player.charinfo || {};

    return (
        <section className="billboard" aria-labelledby="citizen-name">
            <div className="billboard__art" aria-hidden="true">
                <Plate citizenid={player.citizenid} shape="wide" />
                <span className="billboard__grain" />
                <span className="billboard__scrim" />
            </div>

            <div className="billboard__inner">
                <div className="billboard__ident">
                    <h1 className="billboard__name u-display" id="citizen-name">
                        {player.name}
                    </h1>

                    {/* Ohne Trennpunkte: sobald die Zeile umbricht, stuende
                        sonst ein Punkt verwaist am Zeilenanfang. Der Abstand
                        allein traegt die Gliederung zuverlaessiger. */}
                    <div className="billboard__meta">
                        <span className={`pill ${status.cls}`}>
                            <span className="pill__dot" aria-hidden="true" />
                            {status.text}
                        </span>
                        <span className="billboard__cid u-mono">{player.citizenid}</span>
                        <span className="billboard__fact">{jobTitle(player)}</span>
                        {player.isOnline && !bridgeDown && player.sourceID != null && (
                            <span className="billboard__fact">
                                Server ID <span className="u-mono">{player.sourceID}</span>
                            </span>
                        )}
                        {char.phone && (
                            <span className="billboard__fact u-mono">{char.phone}</span>
                        )}
                    </div>
                </div>

                <div className="billboard__balances">
                    <div className="balance">
                        <span className="balance__key u-caps">
                            <Icon name="cash" size={14} />
                            Cash
                        </span>
                        <span className="balance__value u-mono">{formatCurrency(player.money?.cash)}</span>
                    </div>
                    <div className="balance">
                        <span className="balance__key u-caps">
                            <Icon name="bank" size={14} />
                            Bank
                        </span>
                        <span className="balance__value u-mono">{formatCurrency(player.money?.bank)}</span>
                    </div>
                </div>
            </div>

            {/* Abgeschlossene Schreibvorgaenge bleiben stehen, statt als
                kurzlebige Meldung zu verschwinden: der Datensatz zeigt,
                was in dieser Sitzung schon an ihm geaendert wurde. */}
            {writeLog.length > 0 && (
                <div className="ledger">
                    <div className="ledger__head">
                        <h2 className="ledger__title u-caps">Changed this session</h2>
                        <button type="button" className="ledger__clear" onClick={onClear}>
                            Clear
                        </button>
                    </div>
                    <ul className="ledger__list">
                        {writeLog.map((entry) => (
                            <li className={`ledger__row ledger__row--${entry.mode}`} key={entry.id}>
                                <Icon name={entry.mode === 'live' ? 'link' : 'check'} size={14} />
                                <span className="ledger__what">{entry.text}</span>
                                <span className="ledger__mode u-caps">
                                    {entry.mode === 'live' ? 'Applied live' : 'Saved to database'}
                                </span>
                                <time className="ledger__time u-mono">{entry.time}</time>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}
