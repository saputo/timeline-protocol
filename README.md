# Timeline Protocol — Failed Flight Plan

A phone-first ARG built for **Belltown Blast 2026**. Players scan physical
tags/QR codes around Belltown to uncover CRI's cover story, decide whether
to help a hacker calling himself C@T@LY$T, and piece together what really
happened the night D.B. Cooper jumped.

Built with React + Vite + Tailwind. Runs entirely client-side; Firebase is
wired up but currently unused (see **Closed-loop mode** below).

## Quick start

```bash
npm install
npm run dev
```

Open the printed `http://localhost:5173/` URL. Leave the terminal running —
it live-reloads on save.

To test on a phone (recommended before any live run — the UI behaves
differently on small screens):

```bash
npm run dev -- --host
```

Then open the printed `Network:` address on a phone on the same wifi.

## Build & deploy

```bash
npm run build
```

Outputs a static site to `dist/`. Deploy that folder's contents to
`timelineprotocol.com` (or wherever it's hosted) — no server/backend
required. `npm run preview` serves the built output locally if you want to
sanity-check the production build before shipping it.

## How the game works

- Players pick a cosmetic identity (GUARDIAN / DETECTIVE / VIGILANTE) at
  Build Profile, then scan tags around the venue.
- There are **3 required story nodes** (one per identity's theme). They can
  be found in **any order** — there is no forced sequence. Once all 3 are
  found, the game is complete.
- On the **first** node anyone finds, all-time, a hacker persona
  (C@T@LY$T) breaks in with a one-time choice: help him (**faction:
  HACKER**) or report him to CRI (**faction: CRI**). That choice sticks for
  the rest of the playthrough.
  - **CRI faction**: every unlock after that is the same plain reveal —
    the hacker never shows up again.
  - **HACKER faction**: the hacker pops up (as a dismissible popup, not a
    full-screen takeover) on every subsequent unlock, offering to leak the
    item, and again at the end with a funding ask.
- Completing the game shows a badge inline on the map page — CRI-styled by
  default, plus an extra HACKER-only popup with its own badge if that path
  was chosen.
- A few seconds after completion, a one-time full-screen bonus stinger
  fires: **"TAG. YOU'RE IT."** for HACKER, **"L.A.Z.A.R.O. EXISTS."** for
  CRI (a payoff for anyone who read the CRI-PSA-099 lore closely).

## Content model

Game content is hardcoded in `src/App.jsx` while **`CLOSED_LOOP_DEMO`**
(top of the file) is `true` — this makes the whole game run off local
constants instead of Firestore, so it works with zero network dependency
even on bad venue wifi:

- **`STATIC_MAIN_NODES`** — the 3 required story nodes (GUARDIAN /
  DETECTIVE / VIGILANTE).
- **`STATIC_LORE_NODES`** — 9 optional bonus lore nodes.
- **`TEMPORAL_ARTISTS`** — 2 artist dossiers (Caity Johnson, Jacoby
  Hinton).

That's 14 scannable items total. Set `CLOSED_LOOP_DEMO = false` to pull
content from Firestore instead (`src/firebase.js` has the project config;
`appId` there is the database path it reads from).

## QR / RFID codes

The actual sticker/tag codes are kept out of this file on purpose — this
repo is public, and publishing the codes here would let anyone unlock the
game from their couch instead of walking Belltown. The code list lives
somewhere off-repo; ask whoever's running the show for it.

Every code becomes either a raw manual-entry string (typed into the
MANUAL SCAN tab) or a URL: `https://timelineprotocol.com/?scan=CODE`

## Dev harness

Add `?debug=1` to any URL to open a dev panel (bottom-right, never visible
to players without the flag). It's for testing the game's flow without
walking the whole map every time — live state, screen jumps, and shortcuts
that write to local state only (never the real signup endpoint). Details
intentionally not spelled out here for the same reason as the codes above.

## External services

- **Formspree** (`https://formspree.io/f/xrededjy`) — collects
  alias/email once at Build Profile, plus faction-choice and leak events.
  Registration only ever happens once; the endgame reuses the same
  alias/email instead of asking again.
- **Zeffy** (`STRIPE_LINK` constant) — the real-world fundraising link
  shown on both endings.
- **Firebase/Firestore** — wired up, currently unused while
  `CLOSED_LOOP_DEMO = true`.

## Testing

See [`TESTING.md`](TESTING.md) for the manual QA checklist (title sequence
timing, dossier scans, map behavior, known issues) and the team-only
override codes.
