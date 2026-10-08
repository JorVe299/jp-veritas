# Veritas — backend handbook

For whoever picks this up next. It covers how the owner wants this project
worked on, how the backend is put together, and the things that have already
cost a day of someone's life. `README.md` says what the panel is for and
shows it. This file is the backend and the working agreement.

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

**Restore whatever you disturbed.** `backend/data/permissions.json`,
`backend/data/banlog.json` and the catalog JSON files are runtime state. If a test creates them, delete them
again and say what the state was before and after.

**Document every change in the same commit.** Whatever a change adds,
removes or renames — a route, a key, a file, a behaviour — every mention of it
in this file, the READMEs, `backend/.env.example`, `veritas/config.lua.example`
and the code comments is brought into line before committing. Documentation
of deleted code is deleted with it. A handbook that describes code which no
longer exists misleads the next person more than no handbook would.

**Commits go to `main`, and get pushed.** The server deploys by pulling
`main`, so a branch breaks the deploy path, and an unpushed fix never reaches
it. The owner has said to commit and push every finished change without
asking.

**Commit messages follow Conventional Commits:** `type(scope): subject`.
Types are `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `style`, `chore`.
The scope is optional, one lower-case word for the area touched (`bridge`,
`bans`, `inventory`, `perms`, `portal`, `deploy`) — never a path or a file
name; drop it when the change is repo-wide. The subject is lower-case,
imperative, no trailing period, at most 72 characters including the prefix,
and names the effect rather than the files. A body after a blank line carries
the why and the history that the comment policy keeps out of the code.
`BREAKING CHANGE:` goes in a footer.

Adopted 2026-10-08. Everything before it is the older sentence style and is
left alone — history is not rewritten. Dependabot's `Bump x from a to b` and
the web UI's `Update README.md` are not corrected either.

### Comment policy

No prose in code. A comment is a short technical note; rationale that needs
paragraphs belongs in this handbook, history in the commit message.
`backend/commentPolicy.test.js` enforces the limits for every source file in
the repo (JS, JSX, CSS, Lua, shell, HTML, `.gitignore`, config templates).

- **Why, not what.** A comment states a constraint, an invariant, an external
  quirk or a non-obvious consequence. Names and structure say what the code
  does; if that needs explaining, rename or extract instead.
- **Short.** At most 3 lines per comment block, at most 100 columns per line.
  Doc-comment tag lines (`@param`, `@returns`, Lua `---@…`) and section markers
  do not count.
- **Fragments.** Sentence case, no trailing period, clauses joined with `;`
  or `:`. No first person, no narrative, no rhetoric, no filler ("simply",
  "of course", "note that").
- **No history.** Nothing like "used to", "no longer", "since the fix".
  Incidents worth keeping go into §8.
- **No echo.** No file-path headers; nothing that restates the code, a name,
  or a string right next to the comment.
- **Reference, don't retell.** Point to the handbook for long rationale:
  `(BACKEND.md §4)`.
- **Doc comments** (`/** … */`; LuaLS `---@` annotations in Lua) only on
  exports whose contract the name does not carry: one summary line; `@param` /
  `@returns` only for units, null semantics or error cases.
- **Tags.** `SECURITY:` marks code that enforces an access or data-exposure
  rule; change it only together with a test. `TODO:` only with a concrete
  next step. No other tags.
- **No commented-out code.** Git keeps it.
- **Section markers.** One line, padded with `-` to column 77:
  `// --- Name ---` (JS), `-- --- Name ---` (Lua), `/* --- Name --- */` (CSS;
  `/* === N. Name === */` for a numbered top-level section).
- **JSX.** `{/* … */}` on one line, only where the reason for the markup is
  not visible from it.
- **Config templates** (`.env.example`, `config.lua.example`): one line per
  key (meaning, format, default); details go into §5.

```js
// Before
// How stale a session's role may get before Discord is asked again. A
// minute keeps a removed role from lasting, and stays far inside what
// Discord allows per user token.

// After
// Max role age before Discord is re-asked; well under its per-token rate limit
const SYNC_SECONDS = 60;
```

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

### Extending the bridge

`veritas/bridge/custom.lua` ships as an empty template for local additions.
Commit what you put there: `deploy/update.sh` resets uncommitted edits on the
server.

**Own routes.** `Veritas.route(method, path, handler, opts)` registers
`http://<server>:30120/veritas/<path>`. The handler receives `(body, res)`:
`body` is the decoded JSON of a POST, an empty table for a GET. Answer with
`Veritas.ok(res, table)` or `Veritas.fail(res, 'message')`. `{ needsToken = true }`
demands the `X-Veritas-Token` header even while `Config.RequireTokenEverywhere`
is off; use it for anything that changes state. The backend can call a new
route right away.

```lua
-- How many people are in a given job right now
Veritas.route('POST', '/job-headcount', function(body, res)
    local adapter = Bridge.require()
    if not adapter then return Veritas.fail(res, 'No framework active') end

    local count = 0
    for id in pairs(adapter.getOnline()) do
        local player = adapter.getPlayer(id)
        if player and player.PlayerData and player.PlayerData.job.name == body.job then
            count = count + 1
        end
    end
    Veritas.ok(res, { job = body.job, online = count })
end)

-- A value from another resource's state bag
Veritas.route('GET', '/weather', function(_, res)
    Veritas.ok(res, { weather = GlobalState.weather })
end)
```

**Own framework.** Fill in the adapter in `custom.lua` and set
`Config.Framework = 'custom'`. The contract is the `VeritasAdapter` annotation
in `bridge/adapter.lua`. An operation the framework cannot do returns `false`;
the panel then reports it as unsupported instead of showing a success that
never happened.

---

## 3. Backend layout

```
server.js              Wiring only: middleware order, static files, startup banner.
routes/                One file per area. Each exports { router }.
utils/                 The parts with logic worth testing.
data/                  Runtime state. Gitignored. Written by the panel and by
                       the Lua resource; never commit anything from here.
commentPolicy.test.js  Repo-wide guard for the comment policy (§1).
```

`utils/` worth knowing before you touch anything:

| File | What it owns |
|---|---|
| `permissions.js` | The capability list, the route→capability table, and `enforce()`. |
| `roleStore.js` | Roles as editable records, and the file they live in. |
| `auth.js` | Discord OAuth, the session cookie, and resolving a person to a role. |
| `resourceAuth.js` | The FiveM resource as a principal: the shared secret, and the one capability it carries. |
| `identity.js` | Discord id ⇄ characters ⇄ identifiers. The portal's whole basis. |
| `banlist.js` | Merging the two ban records into one shape. |
| `banLog.js` | The ban history: panel bans kept past their `bans` row, in `data/banlog.json`. |
| `txadmin.js` | Reading txAdmin's `playersDB.json`. Read-only, cached by mtime. |
| `bridge.js` | HTTP to the FiveM resource. |
| `dbHandler.js` | The MySQL pool, plus column/table discovery. |
| `framework.js` | Which framework this schema is (`qb` / `esx`). |
| `search.js` | How every free-text search reads a query: case-blind, words in any order, spacing ignored. |
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

One caller reaches past the *session* check without being either: the FiveM
resource, which presents `RESOURCE_SECRET` instead (`utils/resourceAuth.js`,
§5). It is not an exemption from `enforce()` — it is a principal with a fixed
one-capability list, so an unruled or out-of-reach route answers 403 the same
way. A wrong secret ends the request rather than degrading to an anonymous
caller.

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

**A character is deleted by its framework, never by SQL here.** QBCore and
Qbox each keep their own list of the tables a character spans (Qbox makes it
configurable), so `routes/characters.js` hands the delete to the core through
the bridge and then polls `players` until the row is gone; no confirmation within
five seconds answers 504, not success. It refuses while the character is
connected, because the core saves a connected character back on logout, and
while the bridge is unreachable, because then nobody knows whether it is
connected. ESX has no core delete and answers 501. `players.delete` is not in
the administrator's defaults: a fresh install leaves it with the owner until
it is granted on purpose.

**Panel bans are kept in a history until someone deletes them.** Lifting a
ban deletes its `bans` row, and qb-core drops expired rows on connect, so the
table alone forgets. `utils/banLog.js` records every ban issued in the panel
and marks it on lift (a lift of an in-game ban gets an entry too), in
`data/banlog.json` beside the roles: panel state stays out of the game
database. Each entry's state is derived on read: `active` while its row
exists, `lifted`, `ended` past its end, `removed` when the row went some
other way. Entries go only through `DELETE /api/manage/ban-history/:id`
(`banlog.delete`). A file that cannot be parsed is an error, never an empty
history, or the next ban would overwrite it. A refused history write leaves
the ban standing and says so in the answer. Veritas ID and the server-wide list (`/api/bans/all`,
filter `source=history`) show entries that are no longer in force under their
own source, `history`.

**Ban references are derived, never stored.** Every ban shows a reference
like `VRT-65S1-ZNPT`: Crockford base32 of a SHA-256 over source and native id
(`referenceFor` in `utils/banlist.js`). The same ban has the same reference in
the panel, in Veritas ID, in the kick message and after a lift (history
entries reuse their row's reference), and the staff search finds it. Changing
the formula renames every reference players may already have quoted.

**Manual refresh buttons wait a minute.** Every "refresh" / "try again"
button in the frontend goes through `lib/useCooldown.js` and is disabled for
60 s after a press. That is a courtesy, not a guard: routes where a request
is expensive also carry `oncePer(...)` server-side (currently
`POST /api/system/refresh`).

**A state-changing request must come from the panel's own host.** There is no
CSRF token, because issuing one would need the frontend to carry it.
`utils/originGuard.js` runs before the sign-in routes and refuses any
`POST`/`PUT`/`PATCH`/`DELETE` under `/api/` whose `Origin` — or `Referer`,
when `Origin` is absent — does not name this host, `X-Forwarded-Host`, or
`PANEL_ORIGIN`. Together with `sameSite: 'lax'` on the session cookie that is
the whole CSRF defence. Two deliberate holes: the comparison is by **host,
not scheme**, because a TLS terminator forwards plain http to this process
(§7); and a request carrying the `X-Veritas-Secret` header is exempt, because
a cross-site page cannot set a custom header without a preflight this backend
never approves. `GET` is never blocked — nothing under it changes state. A
full token flow would add a route issuing a per-session token, its
`enforce()` rule, and a frontend that echoes the token in a header on every
write; do not half-build that.

**One rate limiter covers every route.** `express-rate-limit` is mounted
centrally in `server.js` — once on `/api/auth` (before the sign-in routes,
where there is no id to key on yet) and once after `requireAuth` for
everything else, so the bucket is the signed-in Discord id rather than one
address shared behind a proxy. `utils/apiLimits.js` holds the window, the two
limits and the key function; the FiveM resource gets a bucket of its own, so
a noisy staff member cannot starve its sync. Static files are skipped, which
keeps the panel loadable while a flood is being refused. `oncePer(...)` in
`utils/rateLimit.js` is unchanged and still the per-action cooldown behind
the refresh buttons — the two are layers, not alternatives.

**The middleware order in `server.js` is load-bearing.** It is: CORS,
`express.json`, `cookieParser`, `originGuard`, the `/api/auth` limiter, the
sign-in routes, `resourceAuth.identify`, `requireAuth`, the API limiter,
`enforce()`, then the data routes. A limiter moved before `requireAuth` loses
the per-user bucket; `originGuard` moved after the sign-in routes stops
covering `POST /api/auth/logout`.

**The sign-in cookies get their flags in one place.** `utils/oauthCookies.js`
writes both short-lived cookies of a sign-in attempt (the OAuth state and the
surface to return to), so the route cannot set a weaker flag by accident:
`httpOnly`, `sameSite: 'lax'`, `path: '/'`, 10 minutes, and `secure` as §5
describes.

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
  be an open redirect. It is also the one cross-origin host `originGuard`
  accepts for a write (§4), so it belongs empty in production.
- `BRIDGE_TOKEN` — only checked once `Config.RequireTokenEverywhere = true`
  in the bridge's `config.lua`. While that is false a token protects nothing:
  every built-in bridge route answers whoever can reach the FiveM HTTP port.
- `BRIDGE_TOKEN` again: deleting a character needs it whatever
  `RequireTokenEverywhere` says. Without `Config.Token` set on both sides the
  delete answers 502 and names the missing token.
- `RESOURCE_SECRET` — what the FiveM resource is recognised by. It has no
  session, so its start-up POST to `/api/system/refresh` carries the secret in
  an `X-Veritas-Secret` header (`Config.BackendSecret` on the resource side).
  `utils/resourceAuth.js` runs before `requireAuth`, compares over SHA-256
  digests, and lets the request on as a principal that holds `system.edit` and
  nothing else — `enforce()` still decides, so this is a secret, not a path
  exemption. An unset or empty value matches nothing: a caller presenting any
  secret is refused, including an empty one. The resource posts to
  `Config.BackendUrl`, which falls back to `http://localhost:3001`.
- `COOKIE_SECURE` — marks the sign-in cookies `secure`. Empty is the default
  and derives the flag from the `DISCORD_REDIRECT_URI` scheme: `https://`
  there means the panel is behind a TLS terminator, so the flag is safe to
  set; plain `http://` leaves it off, because a secure cookie never arrives
  over `http://ip:3001` and an unconditional flag would lock the owner out of
  a LAN install. `true` and `false` still override, and an existing `.env`
  that says `false` keeps its old behaviour. `utils/oauthCookies.js` owns
  this; `utils/auth.js` reads `COOKIE_SECURE` directly for the session
  cookie, so the two agree except that an unset value hardens the sign-in
  cookies first.
- `TRUST_PROXY` — how many reverse-proxy hops sit in front of this process
  (`1` behind one Caddy or nginx; an address list or `true` also work). Empty
  means none, so `X-Forwarded-For` is ignored and nobody can forge an address
  to get a fresh rate-limit bucket. It only matters for requests with no
  session: those are bucketed by address, and with the setting wrong behind a
  proxy every visitor shares one bucket.
- `DISCORD_ADMIN_IDS` / `DISCORD_ADMIN_ROLE_IDS` — no longer read. An old
  `.env` that maps the owner only through them lets nobody in; rename them to
  `DISCORD_OWNER_IDS` / `DISCORD_ROLE_OWNER`.

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
cd backend  && npm test         # node --test, currently 251 tests
cd frontend && npm test         # vitest run, currently 100 tests
cd frontend && npx eslint . && npx vite build
```

The frontend suite covers the pure helpers in `frontend/src/utils` and
`frontend/src/lib` only (`frontend/README.md` lists them). Components are
verified by lint, build, and reading.

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
  `permissions.json` and `banlog.json` there. If it is not writable, saving a role fails — see
  the next section.

---

## 8. Things that have already cost time

**The catalog files start empty.** `data/jobs.json`, `items.json`,
`vehicles.json`, `gangs.json` are filled by the Lua resource on first start.
Until then dropdowns are empty and the panel is not broken.

**The `bans` table has no created-at column.** Its rows genuinely carry no
date. They are marked undated and sort after dated ones. Do not invent a date
from the row id.

**A permanent ban is the column's ceiling.** `bans.expire` is a signed
`INT(11)` on the stock qb-core and qbx_core schema, and the game keeps a
player out while `os.time()` is below it. So the panel writes `2147483647`
for a permanent ban — the value qb-adminmenu writes too — and reads that value
as permanent. Timed bans are capped there as well: from 2028 on, the longest
one the form offers would otherwise overflow the column, and strict-mode MySQL
refuses the insert. Writing and reading both live in `utils/banlist.js`
(`expiryFor` beside `shapeBan`). The write path once referred to a constant
that had moved there, and every permanent ban answered 500.

**ox_inventory weapons are upper-case.** Items are `water`, weapons
`WEAPON_STUNGUN`, and a core's own item table may hold them lower-case or not
at all. So with ox_inventory running the bridge exports `items.json` from
`exports.ox_inventory:Items()`, the inventory route looks names up
case-blind, and the catalog only gates handing something out: removing what a
player already holds never needs it. That check once refused to delete a taser.

**`player_vehicles.mods` is not mods.** It holds the ox_lib vehicle property
table, which is what qbx_garages reads. Writing `'{}'` there produces
`attempt to perform arithmetic on a nil value (field 'engineHealth')` and the
car cannot leave the garage.

**An item name that becomes a file name needs both guards.** `GET
/api/items/:name/image` builds a path out of the name, so `routes/inventory.js`
keeps the allowlist `/^[a-z0-9_-]{1,64}$/i` *and* resolves the joined path and
asserts it is still under the image folder (`underImageRoot`). The allowlist
alone already refuses every traversal, but it is one regex away from not doing
so, and the containment check is what a traversal then runs into. An escape is
refused with 404, never trimmed and served. Weapon names are upper-case
(above), so the allowlist is deliberately case-insensitive — a case-sensitive
one would hide every weapon icon.

**A vehicle model name is validated even when the catalog is empty.** The
model arrives in the request body, feeds the Jenkins loop in `getHashKey()`
and lands in `mods`. `vehicles.json` cannot be the only gate: it starts empty
(above), and an empty catalog deliberately lets anything through, so a
multi-megabyte `model` once reached a loop that ran over its whole length.
`POST /api/manage/vehicle` therefore shape-checks it against `SAFE_MODEL`
(`/^[a-z0-9_-]{1,32}$/i`, the shape of a spawn name) before the catalog, and
`getHashKey()` caps its input at `MODEL_NAME_MAX` so the loop bound is a
constant. Real spawn names are at most 23 characters, so the cap changes no
hash a game would compute; the tests pin `adder`, `police` and `sultanrs`.

**Neither ban record stores a `citizenid`.** Both store identifiers.
Filtering "by citizen" means resolving that person to their identifiers and
matching exactly — a near miss on an identifier is a different person, not a
weaker match.

**The portal flag lives in the cookie.** It is set at sign-in and refreshed
by the minute-by-minute role check, and only an explicit `true` opens
Veritas ID. A session that carries no Discord tokens cannot be checked, so it
is ended with a sentence saying so rather than kept.

**`information_schema` row counts are estimates.** `bans` reported 0 rows
while holding a live ban. Count through the app's own routes.

**Escaping.** Writing regex-bearing JavaScript through a shell heredoc has
mangled this codebase repeatedly. Use the `Write` tool for new files and
`String.raw` for regex literals; when patching, assert the anchor exists and
fail loudly if it does not.

**The role store once reported successes it had not written.** Saving a role
answered "The permissions could not be saved" on the live server, and moving a
role up or down appeared to do nothing. One fault, not two: every mutation —
`create`, `update`, `remove`, `reorder`, `saveMatrix` — goes through the same
`persist()` in `roleStore.js`, so a refused file write stopped all of them
while the UI still claimed success. Since `8f4cef1` the write is a temp file
renamed into place, the new state is adopted only after that succeeds, and a
failure carries a `hint` naming the real cause (`EACCES` → the folder to
`chown`, `EROFS`, `ENOSPC`, …). Note the write is a rename, so the **folder**
must be writable — a `chown` on `permissions.json` alone does not fix it.
Confirmed working on the live server 2026-10-08. If it ever returns,
`deploy/role-write-check.md` walks through finding the errno.

---

## 9. Open at the time of writing

**`groups.edit` is close to `job.edit`.** Adding a job membership lets the
player switch to that job in game on a multi-job setup. The two are separate
capabilities on purpose, but whoever grants `groups.edit` should know this.
The permission table says so where the tick is: `CapabilityMatrix.jsx` keeps a
`REACH` map of capability id to one line, shown under the capability's
identifier. Disclosure only — the permission model is unchanged.

**The resource sync is fixed but unverified in production.** The shared secret
(`RESOURCE_SECRET` / `Config.BackendSecret`, §5) is covered by tests, but no
one has yet watched a real resource start reach a login-protected backend.
The resource logs a distinct line on 401/403 naming the mismatch.
