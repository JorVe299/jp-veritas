import { useCallback, useState } from 'react';
import AccountLine from './AccountLine';
import StatusNote from './StatusNote';
import { fetchOrganisationMembers } from '../api';
import { useServerFetch } from '../lib/useServerData';
import { formatMoney } from '../utils/format';

const MEMBER_LIMIT = 200;

/**
 * One organisation as a row: a police force, a taxi firm, a gang.
 *
 * Three distinctions carry this row, and all three are easy to flatten by
 * accident:
 *
 * 1. `activeMembers` and `memberships` are not two readings of one number.
 *    The first counts characters carrying this job on their record, the
 *    second counts rows in player_groups. On Qbox both exist and they can
 *    disagree - somebody set as police in one place and not the other. That
 *    disagreement is a fact about the server, so both numbers stand next to
 *    each other and the row says so when they differ.
 *
 * 2. `account: null` means no account row exists at all. It is not a
 *    balance of zero, and an admin hunting for missing setup needs to see
 *    which of the two it is.
 *
 * 3. Without accounts.view the server sends no account field at all. Then
 *    no money column appears - an empty one would suggest the balances are
 *    zero rather than unseen.
 *
 * The member list is only fetched once the row is opened. Thirty
 * organisations would otherwise mean thirty queries for a page nobody has
 * looked at yet.
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
    // Distinguishes "the field is missing" from "the field says null".
    const hasAccountField = Object.prototype.hasOwnProperty.call(organisation, 'account');

    const active = Number(organisation.activeMembers) || 0;
    const memberships = groupsAvailable && organisation.memberships !== null
        ? Number(organisation.memberships) || 0
        : null;
    const diverges = memberships !== null && memberships !== active;

    const grades = Number(organisation.gradeCount) || 0;

    // Stable per organisation, so opening the row fires exactly one request.
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

                {/* No money column at all without accounts.view: an empty
                    one would read as "nothing in there".

                    With it, three states and not two. A balance, an
                    explicit null meaning no account row exists, and - only
                    if the server sends no account field at all - nothing
                    here, because then even "no account" would be a guess. */}
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

            {/* The two headcounts side by side rather than merged. */}
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

            {/* Only a net difference is visible from here, so nothing is
                claimed about who is missing where - the member list below
                answers that, name by name. */}
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
                    {/* Money first: it is the part that can be changed. */}
                    {moneyVisible && hasAccountField && (
                        <section className="orgdetail__part">
                            <h4 className="orgdetail__title u-caps">Account</h4>

                            {account ? (
                                <ul className="lines">
                                    {/* The very same row as everywhere else, so a
                                        society balance is operated exactly like any
                                        other - including the second press that a
                                        company account demands. */}
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

            {/* Only reachable when the server sent no account field at all
                while still reporting money as visible - a shape we do not
                invent a balance for. */}
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

/* -------------------------------------------------------------------------
   Who is in it.

   Two lists, not one: the active holders come off the character record, the
   memberships out of player_groups. Merging them would hide exactly the case
   worth seeing - somebody who holds a membership but is not working the job
   right now.
   ------------------------------------------------------------------------- */

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

    // Memberships carry only a citizenid. Where the active list knows the
    // name, it is borrowed - otherwise the id stands on its own rather than
    // a placeholder name being made up.
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
                                    {/* The case this whole list exists for. */}
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
