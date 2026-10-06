import Amount from './Amount';
import Icon from './Icon';
import Plate from './Plate';
import PortalAvatar from './PortalAvatar';
import PortalBans from './PortalBans';
import { characterName, jobLine, numberOrNull, shown } from '../lib/portalText';
import { formatDateTime } from '../utils/format';

// Up to a billion a full figure fits the ~9rem text column beside the poster
const CARD_COMPACT_FROM = 1e9;

/**
 * The signed-in account and its characters; no search, paging or sorting for two or three
 * No characters is the ordinary first state: a sentence, not an error
 * Bans shown even without characters: a ban before first play would go unexplained
 */
export default function PortalRoster({ account, onOpen }) {
    const characters = Array.isArray(account?.characters) ? account.characters : [];

    // The server's count wins over the list length; a mismatch is stated below
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
                    <h1 className="idhero__name">{name}</h1>

                    <div className="idhero__facts">
                        <span className="idfact">
                            <Icon name="users" size={15} className="idfact__icon" />
                            Signed in with Discord
                        </span>

                        {/* A missing game account is named: it explains an empty list */}
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
                        {hint || 'Play on the server and your character shows up here.'}
                    </p>
                </section>
            ) : (
                <section className="idlist" aria-labelledby="id-characters">
                    <h2 className="idlist__title u-caps" id="id-characters">
                        {characters.length === 1 ? 'Your character' : 'Your characters'}
                    </h2>

                    <ul className="idlist__items">
                        {characters.map((character, index) => (
                            /* Index only for a broken row without a citizen id */
                            <li key={character?.citizenid ?? index}>
                                <CharacterCard character={character} onOpen={onOpen} />
                            </li>
                        ))}
                    </ul>

                    {/* Count/list mismatch said plainly: which is right is unknown here */}
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

            {/* Account-level, fetches itself: a slow ban store never holds up the list */}
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
            <span className="idcard__plate">
                <Plate citizenid={character?.citizenid} />
                <span className="idcard__grain" aria-hidden="true" />
            </span>

            <span className="idcard__body">
                <span className="idcard__head">
                    <span className="idcard__name">{characterName(character)}</span>
                    {onDuty && <span className="pill pill--live"><span className="pill__dot" />On duty</span>}
                </span>

                <span className="idcard__job">{jobLine(character?.job)}</span>

                <span className="idcard__money">
                    <span className="idsum">
                        <span className="idsum__key u-caps">Cash</span>
                        <Amount value={character?.money?.cash} compactFrom={CARD_COMPACT_FROM} className="idsum__value u-mono" />
                    </span>
                    <span className="idsum">
                        <span className="idsum__key u-caps">Bank</span>
                        <Amount value={character?.money?.bank} compactFrom={CARD_COMPACT_FROM} className="idsum__value u-mono" />
                    </span>
                </span>

                <span className="idcard__foot">
                    <span className="idcard__cid u-mono" title={shown(character?.citizenid)}>
                        {shown(character?.citizenid)}
                    </span>
                    <span className="idcard__seen">Last seen {formatDateTime(character?.lastSeen)}</span>
                    <Icon name="chevronRight" size={18} className="idcard__go" />
                </span>
            </span>
        </button>
    );
}
