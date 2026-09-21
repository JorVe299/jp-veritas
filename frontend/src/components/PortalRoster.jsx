import Icon from './Icon';
import PortalAvatar from './PortalAvatar';
import PortalBans from './PortalBans';
import { characterName, jobLine, numberOrNull, shown } from '../lib/portalText';
import { formatDateTime, formatMoney } from '../utils/format';

/**
 * The front door: who is signed in, which game account that reaches, and
 * the characters on it.
 *
 * The calm version of a landing page. There is no search, no paging and no
 * sorting, because a player has two or three characters and every control
 * added here would be a control that does nothing. The cards say enough to
 * recognise a character by - the name, the job, what is in their pockets -
 * and everything else waits behind the card.
 *
 * Having no characters is not a failure. A Discord member who has never
 * played is the ordinary first state of this screen, and it is written as a
 * sentence rather than dressed as an error with an icon and a tone.
 *
 * Below the characters sits the ban record, because a txAdmin ban is held
 * against the account and follows the person through all of them. An
 * account with no characters still gets it: being banned before ever
 * playing is exactly the case that would otherwise go unexplained.
 */
export default function PortalRoster({ account, onOpen }) {
    const characters = Array.isArray(account?.characters) ? account.characters : [];

    // The server counts; the list is only what it sent. Where the two
    // disagree the count is the one that is said out loud - it is the
    // server's own answer, and quietly showing a shorter list would hide
    // the disagreement.
    const counted = numberOrNull(account?.count);
    const count = counted ?? characters.length;
    const hint = typeof account?.hint === 'string' ? account.hint.trim() : '';

    const name = account?.displayName || 'Your account';
    const gameAccount = typeof account?.gameAccount === 'string' ? account.gameAccount.trim() : '';

    return (
        <>
            <section className="idhero">
                <PortalAvatar name={name} url={account?.avatarUrl} large />

                <div className="idhero__text">
                    <p className="idhero__kicker u-caps">Signed in with Discord</p>
                    <h1 className="idhero__name">{name}</h1>

                    <div className="idhero__facts">
                        {/* The game account is what ties Discord to the
                            characters. When the server did not send one,
                            that gap is named: it is the reason a list could
                            be empty, and hiding it would leave a player
                            with no idea what to ask about. */}
                        <span className="idfact">
                            <Icon name="link" size={15} className="idfact__icon" />
                            {gameAccount
                                ? <>Game account <span className="u-mono">{gameAccount}</span></>
                                : 'No game account is linked to this Discord account'}
                        </span>

                        <span className="idfact">
                            <Icon name="id" size={15} className="idfact__icon" />
                            {count === 1 ? '1 character' : `${count} characters`}
                        </span>
                    </div>
                </div>
            </section>

            {count === 0 ? (
                <section className="idblank">
                    <h2 className="idblank__title">Nothing on this account yet</h2>
                    <p className="idblank__text">
                        {hint || 'No character has been recorded for this account. Play one on the server and it will show up here.'}
                    </p>
                </section>
            ) : (
                <section className="idlist" aria-labelledby="id-characters">
                    <h2 className="idlist__title u-caps" id="id-characters">
                        {characters.length === 1 ? 'Your character' : 'Your characters'}
                    </h2>

                    <ul className="idlist__items">
                        {characters.map((character, index) => (
                            /* The citizen id is the natural key; the index
                               keeps the list sane if a broken row arrives
                               without one. */
                            <li key={character?.citizenid ?? index}>
                                <CharacterCard character={character} onOpen={onOpen} />
                            </li>
                        ))}
                    </ul>

                    {/* The server said one number and sent another. Said
                        plainly rather than smoothed over - which of the two
                        is right is not something this screen can know. */}
                    {counted !== null && counted !== characters.length && (
                        <p className="idlist__gap">
                            This account is recorded as having {counted}{' '}
                            {counted === 1 ? 'character' : 'characters'}, and{' '}
                            {characters.length} came through. Ask the server staff if that
                            looks wrong.
                        </p>
                    )}

                    {hint && <p className="idlist__gap">{hint}</p>}
                </section>
            )}

            {/* Last, and about the account rather than about any one of the
                characters above it - which is why it stands here and not in
                a character's card. It fetches for itself, the way the
                inventory and the vehicles do, so a slow or unreadable ban
                store never holds up the list of characters. It is also the
                only thing on this surface that keeps quiet about itself:
                with nothing on record it is a single sentence. */}
            <PortalBans />
        </>
    );
}

function CharacterCard({ character, onOpen }) {
    const onDuty = character?.job?.onduty === true;

    return (
        <button
            type="button"
            className="idcard"
            onClick={() => onOpen?.(character.citizenid)}
        >
            <span className="idcard__head">
                <span className="idcard__name">{characterName(character)}</span>
                {onDuty && <span className="pill pill--live"><span className="pill__dot" />On duty</span>}
            </span>

            <span className="idcard__job">{jobLine(character?.job)}</span>

            <span className="idcard__money">
                <span className="idsum">
                    <span className="idsum__key u-caps">Cash</span>
                    <span className="idsum__value u-mono">{formatMoney(character?.money?.cash)}</span>
                </span>
                <span className="idsum">
                    <span className="idsum__key u-caps">Bank</span>
                    <span className="idsum__value u-mono">{formatMoney(character?.money?.bank)}</span>
                </span>
            </span>

            <span className="idcard__foot">
                <span className="idcard__cid u-mono">{shown(character?.citizenid)}</span>
                <span className="idcard__seen">Last seen {formatDateTime(character?.lastSeen)}</span>
                <Icon name="chevronRight" size={18} className="idcard__go" />
            </span>
        </button>
    );
}
