# Veritas — backend handbook

For whoever picks this up next. It covers how the owner wants this project
worked on, how the backend is put together, and the things that have already
cost a day of someone's life. `PRODUCT.md` says what the panel is for;
`DESIGN.md` covers the frontend's visual language. This file is the backend
and the working agreement.

---

## 1. How to work here

These are the owner's standing preferences. They are not style opinions —
each came out of something going wrong.

**Everything in English.** Code, comments, variable names, UI strings,
commit messages. The project was converted from German once; a German word
anywhere is treated as a defect. Sweep for one before you hand work over.

**Frontend work goes to a subagent.** The owner's phrasing is "as always:
create an agent to integrate into frontend". Backend and frontend are done
as separate passes: build and verify the API first, then brief an agent with
the exact response shapes, the states it must handle distinctly, and the
constraints below. Tell it to stay inside `frontend/src`.

**Verify the agent's work yourself, every time.** Do not relay a report you
have not checked. The minimum: `npx eslint .` and `npx vite build` run by
you, `git status` to confirm it stayed in scope, a grep for German, and a
check that every helper, icon and CSS class it references actually exists.
Agents have caught real bugs in this codebase and have also claimed things
that were not so.

**Say plainly when you were wrong.** More than one fix in this project's
history was aimed at the wrong cause. If you diagnose by guessing and the
guess is wrong, say so and keep looking — do not build on it.

**Never write to the production database to test something.** The panel
talks to a live Qbox database. Where verification genuinely needs a write,
use the application's own routes, make it exactly reversible, restore it,
verify the restoration, and say so in your report. Reading through the
app's own routes is fine; ad-hoc scripts against the DB are not.

**Restore whatever you disturbed.** `backend/data/permissions.json` and the
catalog JSON files are runtime state. If a test creates them, delete them
again and say what the state was before and after.

**Commits go to `main`, and get pushed.** The server deploys by pulling
`main`, so a branch breaks the deploy path, and an unpushed fix never reaches
it. The owner has said to commit and push every finished change without
asking.

---

## 2. The three pieces

```
backend/     Node + Express. Talks to MySQL and to the game server.
frontend/    React + Vite. Built into frontend/dist, which the backend serves.
veritas/     A FiveM resource. The bridge: the only way into the running game.
```

They are deployed together and must stay in step. A change to `veritas/`
needs the resource restarted in-game, not just the backend.

**Two surfaces, one backend:**

- The **admin panel** at `/` — staff, role-gated.
- **Veritas ID** at `/id` — the citizen portal. A player sees only their own
  characters. Everything under `/api/me` is scoped by the signed-in Discord
  identity, never by anything the browser sends.

---

## 3. Backend layout

```
server.js            Wiring only: middleware order, static files, startup banner.
routes/              One file per area. Each exports { router }.
utils/               The parts with logic worth testing.
data/                Runtime state. Gitignored. Written by the panel and by
                     the Lua resource; never commit anything from here.
```

`utils/` worth knowing before you touch anything:

| File | What it owns |
|---|---|
| `permissions.js` | The capability list, the route→capability table, and `enforce()`. |
| `roleStore.js` | Roles as editable records, and the file they live in. |
| `auth.js` | Discord OAuth, the session cookie, and resolving a person to a role. |
| `identity.js` | Discord id ⇄ characters ⇄ identifiers. The portal's whole basis. |
| `banlist.js` | Merging the two ban records into one shape. |
| `txadmin.js` | Reading txAdmin's `playersDB.json`. Read-only, cached by mtime. |
| `bridge.js` | HTTP to the FiveM resource. |
| `dbHandler.js` | The MySQL pool, plus column/table discovery. |
| `framework.js` | Which framework this schema is (`qb` / `esx`). |
| `rateLimit.js` | `oncePer(name, ms)`: one request per window per person, 429 + `Retry-After` otherwise. |

---

## 4. Invariants — do not break these

**Permissions are enforced centrally and fail closed.** `enforce()` is
mounted in `server.js` before every router except `routes/auth.js`, which
has to run first so somebody with no session can sign in. A path with no
rule in `RULES` is **blocked**, not allowed. When you add a route, add its
rule in the same change.

Two exemptions exist and both are deliberate: the sign-in flow, and
everything under `/api/me`, which is guarded by ownership rather than by a
role. Tests assert that the second one is exactly that narrow — `/api/members`
and `/api/me-too` must not slip through it.

There is a test that reads every `router.get/post/...` in `routes/` and
fails if any lacks a rule. It has caught three separate mistakes in this
project, including one where a missing comma made JavaScript parse
`[...]['POST', …]` as an index and quietly write `undefined` into the rules
table — valid syntax, dead rule. **Do not weaken that test.**

**The owner can never be locked out.** The `owner` role always exists,
always holds every capability, is always first in the ranking, and cannot be
deleted. `permissions.edit` is deliberately *not* in `CAPABILITY_IDS`, so it
cannot be granted, copied or taken away through the UI.

**The `.env` role mappings are the way back in.** They are read before
anything the panel wrote. A panel that can edit its own door needs a key
kept somewhere it cannot reach. Do not move them into the store.

**A deleted role grants nothing, immediately.** A session naming a role that
no longer exists resolves to an empty capability set. Access ends when the
role does, not when the cookie expires.

**"Could not be read" is never "nothing on record".** This runs through the
whole ban and portal code. An unreadable txAdmin store must never render as
a clean record, and a merged list that loses one source must say so. Telling
someone they are clear when nobody checked is the worst answer these routes
can give.

**The citizen portal never accepts an identity from the client.** A
`citizenid` in a `/api/me` URL only ever narrows a set already established as
theirs. A character that is not theirs answers **404**, the same as one that
does not exist — otherwise the portal becomes a lookup oracle.

**Writes that fail must change nothing.** `roleStore` writes to a temporary
file and renames it into place, and only adopts the new state after the write
succeeded. It used to do the reverse, which left the process holding roles
the file knew nothing about.

**Path checks are case-blind.** Express matches routes without regard to
case, so `/API/players` reaches the players route. `requireAuth` and
`enforce()` lower-case the path before deciding whether it is under `/api/`;
an exact-case check there once let `/API/...` past the login entirely. The
RULES stay exact-case, so an odd spelling matches no rule and is denied.

**Cash is money, even as an item.** On ox_inventory cash *is* the `money`
item. `POST /api/manage/inventory` therefore also needs `money.edit` for
`money`, `black_money` and `markedbills` — otherwise `inventory.edit` is a way
round `money.edit`.

**The role in the cookie is re-checked against Discord.** The Discord tokens
ride in the session cookie, sealed with AES-GCM under a key derived from
`SESSION_SECRET`. Once a minute per user (`SYNC_SECONDS`), the next request
asks Discord again and re-issues the cookie (`currentSession` in
`utils/auth.js`). Discord unreachable → the role is kept and retried after a
back-off; grant revoked, or no role and no character left → the session
ends. A re-issue keeps the original `exp`, so the check never extends a
session. The frontend polls `/api/auth/me` every minute while visible.

**Manual refresh buttons wait a minute.** Every "refresh" / "try again"
button in the frontend goes through `lib/useCooldown.js` and is disabled for
60 s after a press. That is a courtesy, not a guard: routes where a request
is expensive also carry `oncePer(...)` server-side (currently
`POST /api/system/refresh`).

---

## 5. Configuration

One `.env` in `backend/`, gitignored. `backend/.env.example` carries the same
key set with no values — **keep the two key sets identical**; there is no
tolerance here for a key that exists in one and not the other.

The owner has asked specifically that nothing be configured twice. Before
adding a key, check whether an existing one already answers the question.

Keys that have caused trouble:

- `TXADMIN_DB_PATH` — txAdmin keeps bans in a JSON file, not the database.
  Accepts the `txData` folder, a profile folder, or the file itself. Empty
  means "look for `txData` near the panel".
- `TXADMIN_SHOW_BAN_AUTHOR` — off by default. Players see the reason, not
  which staff member typed it.
- `PANEL_ORIGIN` — where the sign-in returns to. Never taken from the
  request; the surface is picked from a fixed two-entry table, or it would
  be an open redirect.
- `DISCORD_ADMIN_IDS` / `DISCORD_ADMIN_ROLE_IDS` — deprecated, still read as
  Owner, and warned about at startup.

`require('dotenv').config()` is given an explicit path. Without it dotenv
resolves against the working directory, so a systemd unit with a different
`WorkingDirectory` finds no `.env` — and the panel comes up with Discord
login **silently switched off**. Do not remove that path.

---

## 6. Running and verifying

```bash
cd backend  && npm start        # or npm run dev
cd frontend && npm run dev      # proxies /api to :3001
```

```bash
cd backend  && npm test         # node --test, currently 150 tests
cd frontend && npx eslint . && npx vite build
```

There is no frontend test runner. Frontend verification is lint, build, and
reading.

**On Windows**, kill stray Node processes before starting a server —
Windows will happily let two processes bind 3001 and the second one's
requests go to the first. `taskkill //F //IM node.exe`.

**Validate your own checkers.** If you write a script that checks something,
break the input on purpose once and confirm the check fails. This has paid
for itself twice here: a Lua block-balance checker, and a guard test that
reported "pass" only because the script meant to break it had silently done
nothing.

---

## 7. Deployment

Debian host, repo at `/opt/veritas`, owned by `fivem`. `deploy/update.sh`
does: fetch → `git reset --hard` → `npm ci` → vite build →
`systemctl restart veritas`.

Consequences worth holding on to:

- **`git reset --hard` means anything the server writes must be gitignored.**
  `backend/.env`, `backend/data/*.json`, `frontend/dist`. A tracked runtime
  file gets wiped on every deploy.
- **`frontend/dist` is gitignored**, so a pull alone does not update the UI.
  `npm run build` has to run on the server. If a feature "isn't showing", check
  this before anything else — `grep -l "<some new string>" frontend/dist/assets/*.js`
  settles it in one command.
- **The FiveM resource is a symlink** into `resources/[local]/veritas`. The
  repo has to stay outside `resources/`, because FiveM only descends into
  `[bracketed]` folders. Changes to `veritas/` need the resource restarted.
- **`backend/data/` must be writable by the service user.** The panel writes
  `permissions.json` there. If it is not writable, saving a role fails — see
  the next section.

---

## 8. Things that have already cost time

**The catalog files start empty.** `data/jobs.json`, `items.json`,
`vehicles.json`, `gangs.json` are filled by the Lua resource on first start.
Until then dropdowns are empty and the panel is not broken.

**The `bans` table has no created-at column.** Its rows genuinely carry no
date. They are marked undated and sort after dated ones. Do not invent a date
from the row id.

**`player_vehicles.mods` is not mods.** It holds the ox_lib vehicle property
table, which is what qbx_garages reads. Writing `'{}'` there produces
`attempt to perform arithmetic on a nil value (field 'engineHealth')` and the
car cannot leave the garage.

**Neither ban record stores a `citizenid`.** Both store identifiers.
Filtering "by citizen" means resolving that person to their identifiers and
matching exactly — a near miss on an identifier is a different person, not a
weaker match.

**The portal flag lives in the cookie.** It is set at sign-in and refreshed
by the minute-by-minute role check. A cookie from before the portal existed
carries no flag at all; that is reported separately from a refusal, because
telling someone their account is barred when it is only an old cookie is a
lie. (Cookies from before the role check carry no Discord tokens and are
ended once, with a sentence saying so.)

**`information_schema` row counts are estimates.** `bans` reported 0 rows
while holding a live ban. Count through the app's own routes.

**Escaping.** Writing regex-bearing JavaScript through a shell heredoc has
mangled this codebase repeatedly. Use the `Write` tool for new files and
`String.raw` for regex literals; when patching, assert the anchor exists and
fail loudly if it does not.

---

## 9. Open at the time of writing

**The resource's data sync cannot reach the backend with login on.** On
start, `veritas/server.lua` POSTs `/api/system/refresh` with no session, so
with Discord login configured it gets a 401 and logs "Could not sync with
the backend". The catalog files are still written to disk; they are only
picked up on the next backend restart or a press of "Reload reference data".
Fixing it means a shared secret the resource sends, not an exemption by path.

**`groups.edit` is close to `job.edit`.** Adding a job membership lets the
player switch to that job in game on a multi-job setup. The two are separate
capabilities on purpose, but whoever grants `groups.edit` should know this.

**Role saving fails on the live server** with "The permissions could not be
saved". The cause is almost certainly that `/opt/veritas/backend/data/` is not
writable by the user the service runs as. Both halves of this are addressed in
the working tree but **not yet committed**:

- `roleStore.js` now writes to a temp file, renames it into place, adopts the
  new state only on success, and returns a `hint` naming the actual cause
  (`EACCES` → which folder to `chown`, `EROFS`, `ENOSPC`, …).
- `RoleRoster.jsx` no longer heads a failed write with a success title — the
  reported symptom was a red box reading "Role created" above "The permissions
  could not be saved".

**"Move up / move down does not refresh"** was reported in the same breath and
is most likely the same fault: the write was refused, so the order never
changed, while the UI reported success. Worth re-testing once the write works
before hunting it separately.

Neither of these has been verified against the live server yet.
