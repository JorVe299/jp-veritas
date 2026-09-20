---
version: 1
slug: "frontend-src-app-jsx"
primary_target: "frontend/src/App.jsx"
related_targets: ["frontend/src/App.css","frontend/src/index.css","frontend/src/components"]
---

## Scope

The whole Veritas admin panel frontend: shell, roster, citizen detail, job module, money module, and every state. Visitor mode: **Operate**. Audience: a FiveM server admin, either alt-tabbed mid-session at 2am or in a sit-down desktop session; occasional phone use must genuinely work. Task: find a citizen, verify who they are, change one value, and know for certain whether the write went live through the FiveM bridge or into the database. UI language is English.

## Direction contract

**THESIS.** Veritas is a catalog of citizens, browsed the way the audience browses everything else on that second monitor: a wall of horizontally scrolling rows of poster tiles, the focused tile swelling to tell you what it is while the rest of the wall gets out of the way. It refuses the panel-shaped default this category ships — sidebar plus data table plus rounded form cards plus a toast — and it refuses the streaming skin's own default just as hard: no gold-on-blue-black, no Bebas, no Inter. The two objections I raised against this form are the build's actual work, not excuses. Citizens have no artwork, so the artwork is generated: one deterministic Los Santos plate per citizen ID. Horizontal rails are bad for scanning, so the rails are grouped by a fact worth scanning — online first, then by job — and search stays the fast path.

**OWN-WORLD.** Warm asphalt near-black ground (#0D0C0B, surface #171614), never blue-black. Colour does not live in the chrome: it lives in the plates, which are saturated, varied, and full-bleed — Los Santos dusk, sodium, palm, smog and ocean duotones, each seeded from a citizen ID and therefore stable for that citizen forever. Chrome is achromatic bone (#EDE9E1) with exactly one focus accent, pure white, on the focused tile's ring. Three semantic signals only, each carried by wording first and hue second: live green #48E08A, unverified amber #F5A623, debit red #F0503C. Type is Archivo variable throughout, run wide across its width axis — condensed heavy caps for citizen names and row headings, normal width for interface copy — with Spline Sans Mono for citizen IDs, amounts and timestamps, where it is measurement and not costume. Tiles are 2:3 posters with tight gutters. Depth is a real offset-and-blur shadow under the focused tile, never a zero-offset halo. Icons are one authored SVG set at a single stroke weight; no Unicode glyph stands in for one anywhere.

**STORY.** The admin lands on the wall and immediately sees who is on the server right now, because ONLINE NOW is the first row and every live citizen's tile carries a LIVE badge. They search or they scan a job row, they focus a tile and it swells to show citizen ID, job, rank and both balances before they ever commit to opening it. They open it, the billboard becomes that citizen's plate at full bleed, and everything they need to change sits directly beneath. They make the change and the panel tells them, permanently and in plain words, which path the write took.

**FIRST VIEWPORT.** Top rail: the Veritas mark — a poster tile with a V cut out of it as negative space, the right stroke breaking past the tile edge — then the wordmark in Archivo at width 70, weight 800; the search field centred as the primary control, because search is the fast path; and at the right the bridge reported as a broadcast status, LIVE LINK in green, or LINK DOWN · STATUS UNVERIFIED in amber. Below it the billboard, compact while nothing is selected: a generated Los Santos dusk plate at full bleed behind a long scrim, carrying one line naming what this panel does and nothing invented beyond it. Beneath the billboard the wall begins, so the first row of tiles is visible without scrolling: ONLINE NOW first, then one row per job present on the page, each with a tracked-caps row heading and prev/next rail controls at the right. Once a citizen is selected the billboard becomes their plate full-bleed with the name at display scale, a metadata line of status, citizen ID, job and rank, both balances set large in mono, and the management panels immediately below it — so the whole repair sits in one viewport.

**FORM.** The streaming catalog title-card wall (`pop-culture-shelf-streaming-title-card-wall`), taken by the user over the assigned direction after two rolls; the roll had assigned candidate 6 of my grounded list and I had declined this challenger on both axes. A user-pinned direction beats the roll, so it is built at full commitment, with its two declined-for reasons treated as the engineering problems to solve. Seed key **b9834f6f**, re-roll round 1, mode operate, code-led. Four disciplines donated by cards declined in that round survive into this build because they serve the product rather than the world: the rank selector shows the whole grade ladder with the current rank struck forward instead of hiding ranks in a native dropdown (cathode gauze); controls have honest press travel and a disabled state that flattens rather than fades (CD-ROM console); colour has a stated boundary, so running prose and record data stay achromatic and the signals never tint body text (iridescent cloud edge); and completed writes stay visible on the record for the session rather than vanishing into a toast (orizuru fold sequence). The fifth donation, numbered section headings, is dropped: the craft floor bans section numbers where the sequence carries no information, and here it carries none.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints

- Plain CSS only, no Tailwind or component library; React 19 + Vite; axios against a same-origin `/api`.
- No authentication exists: no user menus, no "signed in as", no role badges.
- The API returns a 15-row page with no total count; "is there a next page" is inferred from a full page. Rows are grouped client-side into rails from the page that was returned — the grouping describes this page, not the database, and the copy must not imply otherwise.
- Bridge-unreachable is a normal state and must read as *unknown*, never as offline.
- Layout must absorb Inventory & items and Vehicles & garage later without a second redesign; both get their own rails/panels in the same grammar.

## Memorable moment

Focus expansion: the tile swells, its neighbours slide aside, its row lifts and the rest of the wall dims, revealing citizen ID, job, rank and balances inside the tile before the admin commits to opening it. One authored motion moment, exponential ease-out from an already-visible default, disabled under `prefers-reduced-motion`.

## Unresolved

- Authentication, permission tiers and an audit surface are undecided product facts; nothing in this design may imply they exist.
