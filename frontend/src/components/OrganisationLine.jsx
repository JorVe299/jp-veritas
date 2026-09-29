import { useCallback, useState } from 'react';
import AccountLine from './AccountLine';
import StatusNote from './StatusNote';
import { fetchOrganisationMembers } from '../api';
import { useServerFetch } from '../lib/useServerData';
import { formatMoney } from '../utils/format';

const MEMBER_LIMIT = 200;

/**
 * `activeMembers` (character jobs) and `memberships` (player_groups) may disagree: both shown
 * `account: null` means no account row, not zero; without accounts.view no money column
 */
export default function OrganisationLine({
    organisation,
    moneyVisible,
    groupsAvailable,
    canEditAccounts,
    onAccountChanged,
}) {
    const [open, setOpen] = useState(false);

    const name = organisation.name;
    const label = organisation.label || name;
    const isGang = organisation.type === 'gang';
    const account = organisation.account ?? null;
    const hasAccountField = Object.prototype.hasOwnProperty.call(organisation, 'account');

    const active = Number(organisation.activeMembers) || 0;
    const memberships = groupsAvailable && organisation.memberships !== null
        ? Number(organisation.memberships) || 0
        : null;
    const diverges = memberships !== null && memberships !== active;

    const grades = Number(organisation.gradeCount) || 0;

    // Stable per organisation: opening the row fires exactly one request
    const loadMembers = useCallback(
        () => fetchOrganisationMembers(name, { limit: MEMBER_LIMIT }),
        [name],
    );
    const members = useServerFetch(loadMembers, { enabled: open });

    return (
        <li className="line">
            <div className="line__top">
                <span className="line__name">{label}</span>
                <span className="pill">{isGang ? 'Gang' : 'Job'}</span>
                {account?.frozen && <span className="pill pill--debit">Frozen</span>}

                {/* No account field: nothing here, since even "No account" would be a guess */}
                {moneyVisible && hasAccountField && (account
                    ? <span className="line__amount u-mono">{formatMoney(account.amount)}</span>
                    : <span className="pill pill--unknown line__badge">No account</span>
                )}
            </div>

            <div className="line__meta">
                <span className="u-mono">{name}</span>
                {organisation.topGrade
                    ? <span>{`Top grade: ${organisation.topGrade}`}</span>
                    : <span>No grades defined</span>}
                {moneyVisible && account && <span>{authorizedText(account)}</span>}
            </div>

            <div className="tally">
                <div className="tally__item">
                    <span className="tally__value u-mono">{active}</span>
                    <span className="tally__key">working it now</span>
                </div>

                <div className="tally__item">
                    {memberships === null ? (
                        <>
                            <span className="tally__value tally__value--none">—</span>
                            <span className="tally__key">memberships not stored</span>
                        </>
                    ) : (
                        <>
                            <span className="tally__value u-mono">{memberships}</span>
                            <span className="tally__key">on the membership list</span>
                        </>
                    )}
                </div>

                <div className="tally__item">
                    <span className="tally__value u-mono">{grades}</span>
                    <span className="tally__key">{grades === 1 ? 'grade' : 'grades'}</span>
                </div>
            </div>

            {/* Only a net difference is known here: no claim about who is missing where */}
            {diverges && (
                <p className="line__meta line__meta--flag">
                    These two do not match. The character record and the membership
                    list do not describe the same people here — open the members to
                    see who stands on one side only.
                </p>
            )}

            <div className="line__actions">
                <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                >
                    {open ? 'Hide details' : 'Members and account'}
                </button>
            </div>

            {open && (
                <div className="orgdetail">
                    {/* Money first: the editable part */}
                    {moneyVisible && hasAccountField && (
                        <section className="orgdetail__part">
                            <h4 className="orgdetail__title u-caps">Account</h4>

                            {account ? (
                                <ul className="lines">
                                    {/* Same row as elsewhere, second press included */}
                                    <AccountLine
                                        account={{ ...account, kind: 'business', label }}
                                        canEdit={canEditAccounts}
                                        onChanged={onAccountChanged}
                                    />
                                </ul>
                            ) : (
                                <p className="field__hint">
                                    No account row exists for this organisation. That is not a
                                    balance of zero — there is nothing here to adjust until the
                                    game server creates the account.
                                </p>
                            )}
                        </section>
                    )}

                    <section className="orgdetail__part">
                        <h4 className="orgdetail__title u-caps">Members</h4>
                        <MemberList res={members} groupsAvailable={groupsAvailable} />
                    </section>
                </div>
            )}

            {/* Money visible but no account field: no balance is invented */}
            {moneyVisible && !hasAccountField && (
                <StatusNote
                    tone="warn"
                    title="This row carries no account information"
                    detail="The server did not send an account field for this organisation, so nothing is claimed about its balance."
                />
            )}
        </li>
    );
}

function authorizedText(account) {
    const count = Number(account.authorizedCount);
    if (!Number.isFinite(count)) return 'Authorized citizens unknown';
    if (count === 0) return 'Nobody authorized';
    return count === 1 ? '1 citizen authorized' : `${count} citizens authorized`;
}

// --- Members --------------------------------------------------------------
// Two lists, not merged: a membership without the active job is the case worth seeing

function MemberList({ res, groupsAvailable }) {
    if (res.status === 'loading') {
        return <p className="field__hint">Loading the members…</p>;
    }

    if (res.status === 'unavailable') {
        return (
            <StatusNote
                tone="warn"
                title="The members cannot be read in this schema"
                detail={[res.error, res.hint].filter(Boolean).join(' ')}
            />
        );
    }

    if (res.status === 'unreachable') {
        return (
            <StatusNote
                tone="warn"
                title="The game server did not answer"
                detail={[res.error, res.hint].filter(Boolean).join(' ')}
            />
        );
    }

    if (res.status === 'error') {
        return (
            <StatusNote
                tone="error"
                title="The members could not be loaded"
                detail={[res.error, res.hint].filter(Boolean).join(' ')}
            />
        );
    }

    const data = res.data || {};
    const active = Array.isArray(data.active) ? data.active : [];
    const members = Array.isArray(data.members) ? data.members : null;

    // Memberships carry only a citizenid: names borrowed from the active list, never made up
    const names = new Map(active.map((entry) => [entry.citizenid, entry.name]));

    return (
        <div className="orgdetail__lists">
            <div className="orgdetail__list">
                <p className="field__label">{`Working it now — ${active.length}`}</p>
                {active.length === 0 ? (
                    <p className="field__hint">No character carries this as their active job.</p>
                ) : (
                    <ul className={`lines${active.length > 6 ? ' lines--scroll' : ''}`}>
                        {active.map((entry) => (
                            <li className="line" key={`a-${entry.citizenid}`}>
                                <div className="line__top">
                                    <span className="line__name">{entry.name || entry.citizenid}</span>
                                </div>
                                <div className="line__meta">
                                    <span className="u-mono">{entry.citizenid}</span>
                                    {entry.jobLabel && <span>{entry.jobLabel}</span>}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="orgdetail__list">
                <p className="field__label">
                    {members === null ? 'Membership list' : `On the membership list — ${members.length}`}
                </p>

                {members === null ? (
                    <p className="field__hint">
                        {groupsAvailable
                            ? 'The server returned no membership list for this organisation.'
                            : 'This schema has no player_groups table, so memberships are not stored at all. Only the job set on each character is counted.'}
                    </p>
                ) : members.length === 0 ? (
                    <p className="field__hint">Nobody holds a membership here.</p>
                ) : (
                    <ul className={`lines${members.length > 6 ? ' lines--scroll' : ''}`}>
                        {members.map((entry) => (
                            <li className="line" key={`m-${entry.citizenid}-${entry.type}`}>
                                <div className="line__top">
                                    <span className="line__name">
                                        {names.get(entry.citizenid) || entry.citizenid}
                                    </span>
                                    <span className={`pill line__badge${entry.alsoActive ? '' : ' pill--unknown'}`}>
                                        {entry.alsoActive ? 'Also working it' : 'Not working it'}
                                    </span>
                                </div>
                                <div className="line__meta">
                                    <span className="u-mono">{entry.citizenid}</span>
                                    <span>{`Grade ${entry.grade ?? 0}`}</span>
                                    <span>{entry.type === 'gang' ? 'Gang membership' : 'Job membership'}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {data.truncated && (
                <p className="field__hint">
                    {`Only the first ${MEMBER_LIMIT} are listed — this organisation has more.`}
                </p>
            )}
        </div>
    );
}
