import { useState } from 'react';
import Icon from './Icon';
import StatusNote from './StatusNote';
import { deleteCharacter } from '../api';
import { failureNote } from '../lib/writeFeedback';

/**
 * Irreversible: mounted only with players.delete; the server re-checks online state itself
 * Typing the citizen ID arms the button: a misclick alone deletes nothing
 */
export default function CharacterDeleteManager({ selectedPlayer, online, bridgeDown, onDeleted, onStale }) {
    const citizenid = selectedPlayer?.citizenid ?? '';
    const name = selectedPlayer?.name || citizenid;

    const [confirming, setConfirming] = useState(false);
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const blocked = online || bridgeDown;
    const armed = typed.trim() === citizenid && citizenid !== '';

    const cancel = () => {
        setConfirming(false);
        setTyped('');
    };

    const handleDelete = async () => {
        setBusy(true);
        setFeedback(null);
        try {
            const answer = await deleteCharacter(citizenid);
            onDeleted?.({
                tone: 'success',
                title: answer.data?.message || 'Character deleted',
                detail: `${name} (${citizenid})`,
            });
        } catch (err) {
            const status = err.response?.status;
            // 503: nothing was tried; amber, as the status is unknown rather than failed
            setFeedback(status === 503
                ? { ...failureNote('Nothing was deleted', err), tone: 'warn' }
                : failureNote('The character could not be deleted', err));
            // 409: the wall still showed them offline
            if (status === 409) onStale?.();
            cancel();
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="panel" aria-labelledby="delete-panel-title">
            <header className="panel__head">
                <Icon name="trash" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="delete-panel-title">Delete character</h2>
                    <p className="panel__hint">Cannot be undone</p>
                </div>
            </header>

            <div className="panel__body">
                <p className="field__hint">
                    Removes the character with its vehicles, outfits and bank account. Account and
                    bans stay.
                </p>

                {online && <p className="field__hint">On the server: kick first.</p>}

                {!online && bridgeDown && (
                    <p className="field__hint">Game server unreachable: status unverified.</p>
                )}

                {confirming && (
                    <div className="field">
                        <label className="field__label" htmlFor="delete-confirm">
                            Type the citizen ID to confirm
                        </label>
                        <input
                            id="delete-confirm"
                            className="input u-mono"
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={citizenid}
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            disabled={busy}
                        />
                    </div>
                )}

                {feedback && (
                    <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                )}
            </div>

            <footer className="panel__foot">
                {confirming ? (
                    <>
                        <button type="button" className="btn btn--ghost" onClick={cancel} disabled={busy}>
                            Keep
                        </button>
                        <button
                            type="button"
                            className="btn btn--danger"
                            onClick={handleDelete}
                            disabled={busy || !armed || blocked}
                        >
                            {busy ? 'Deleting…' : 'Delete for good'}
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => { setConfirming(true); setFeedback(null); }}
                        disabled={blocked}
                    >
                        Delete character…
                    </button>
                )}
            </footer>
        </section>
    );
}
