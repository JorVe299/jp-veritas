# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: a **FiveM server administrator** on a QBCore-style roleplay server — the owner or a member of the admin team. Two situations, both confirmed as in-scope:

1. **Mid-session, second monitor.** The admin is in-game. Something breaks (a player lost money to a bug, a job didn't apply, an item vanished). They alt-tab, find the player, fix one value, and go back. Speed and glanceability dominate; the interaction is measured in seconds.
2. **Sit-down desktop session.** Bulk or investigative work — checking balances, correcting several characters, preparing for an event.

Phone use happens occasionally and must work, not merely avoid breaking.

## Product Purpose

Veritas is a web administration panel that gives FiveM server admins direct control over persistent player data **whether or not the player is currently connected**. Success is: an admin finds the right character and applies a correct change in seconds, with unambiguous confirmation of whether the change went to the live server or to the database.

## Positioning

The **hybrid live/offline write path** is the mechanism. Every mutation resolves at request time:

- Player online → the change is pushed through the FiveM bridge resource (`jp-veritas`) and applies live in-session.
- Player offline → the change is written straight to the MySQL row.

Neighboring tools require the player to be connected, or only ever touch the database and desync the running server. Veritas does both and **tells the admin which path was taken** (`mode: 'live' | 'offline'` comes back on every mutation). That disclosure is not a detail — it is the product.

A second confirmed commitment: Veritas distinguishes **"offline"** from **"we don't know"**. When the bridge is unreachable, online status is reported as *unknown*, never silently rendered as offline. The backend surfaces `bridge.reachable` and a `dbMismatch` diagnostic for the case where the panel and the game server are pointed at different databases.

## Operating Context

- Runs against a QBCore-shaped MySQL schema; player state lives in JSON columns (`money`, `job`, `charinfo`) on the `players` table.
- Talks to a companion FiveM resource (the bridge) over HTTP at `FIVEM_API_URL`, default `http://127.0.0.1:30120/jp-veritas`, with a short timeout (`BRIDGE_TIMEOUT`, default 2500ms). **The bridge being down is a normal operating state, not an error condition.**
- Job and grade master data is loaded from `backend/data/jobs.json`, exported from the game server. Item and vehicle master data exist alongside it (`items.json`, `vehicles.json`) and are not yet surfaced in the UI.
- Backend: Express on port 3001. Frontend: React 19 + Vite, plain CSS, no UI framework, no CSS framework. In production the backend serves the built frontend from the same origin.
- Identification is by **citizen ID** — a short opaque string. Admins search by character name or citizen ID; names are not unique, citizen IDs are.
- Server-side pagination, 15 rows per page, with a debounced search. There is no total count from the API; "is there a next page" is inferred from a full page.

## Capabilities and Constraints

Shipping today:

- Paginated, searchable player roster with live online status.
- Job and grade assignment.
- Cash / bank credit and debit.
- Bridge-health and database-mismatch diagnostics.

Confirmed as the next surfaces the layout must absorb **without a second redesign**:

- **Inventory & items** — slot/grid-shaped, image-capable, needs real width. Not a narrow form card.
- **Vehicles & garage** — tabular (plate, model, state), needs horizontal room.

Constraints:

- **UI language is English.** Every user-visible string is English. (Source comments are German and stay German; this is a copy decision, not a codebase decision.)
- Plain CSS only. No Tailwind, no component library — this is a deliberate existing property of the project.
- Must hold up from phone width through wide desktop with a layout that genuinely reflows.
- No authentication layer exists yet. Do not design UI that implies one (no user menus, no "signed in as", no role badges) until it does.

Explicitly undecided: authentication and admin identity, permission tiers, and any audit/history surface. Not designed for, not designed against.

## Brand Commitments

- The product name **Veritas** is fixed.
- The current "V in a box" mark is **not** fixed and is being replaced as part of this work.
- No other binding assets, colors, or typefaces exist.

## Evidence on Hand

- Real backend, real schema, real bridge protocol — all behavior above is read from `backend/server.js` and `backend/utils/`.
- `backend/data/jobs.json`, `items.json`, `vehicles.json` are real game-data exports.
- There are **no** customers, testimonials, install counts, uptime figures, server counts, or benchmarks. None may be invented anywhere in the UI.

## Product Principles

1. **Never fake certainty.** Unknown state is shown as unknown. The live-vs-offline write path is always disclosed. A stale list is visibly stale.
2. **The character is the subject.** Everything on screen orients around "who am I looking at, and what is true about them right now."
3. **Seconds, not minutes.** The mid-session repair is the design's load-bearing case: find, verify, change, confirm.
4. **Every change is reversible in the admin's head.** Show the current value and the resulting value before the write, not just after.
5. **Modules are additive.** New capabilities dock into the character workspace without renegotiating the shell.

## Accessibility & Inclusion

No externally imposed standard was established. The incumbent implementation already commits to real focus-visible outlines, semantic buttons over clickable divs, `role="status"` inline feedback instead of `alert()`, labelled controls, and `prefers-reduced-motion`. These are treated as a floor the redesign must not fall below.
