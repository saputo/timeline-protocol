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

Every code becomes either a raw manual-entry string or a URL:
`https://timelineprotocol.com/?scan=CODE`

| Code | What it unlocks |
|---|---|
| `DSHS-1980` | GUARDIAN node — DSHS office window, 2106 2nd Ave |
| `BOAZ-SMASH` | DETECTIVE node — Shorty's Coney Island, 2316 2nd Ave |
| `TAG-SIGNAL` | VIGILANTE node — Jupiter Bar, 2126 2nd Ave |
| `FLIGHT-71` | Intercepted Audio: The Professor |
| `TG-001` | CRI Asset Log: The Synchronization Bridge |
| `REACTOR-61` | AEC Order 66-9: Containment by Concrete |
| `HUM-440` | Research Draft: Harmonic Excitation of Cobalt-60 |
| `FILTER-PROTOCOL` | Physics Division Memo: The Frequency of Clarity |
| `SUDO-CLEARANCE` | CRI Personnel File: Redacted |
| `CRI-PSA-099` | CRI Public Safety Advisory |
| `DOCUMENT-J` | FBI/CRI Joint Case File (1971) — the sticker that gets physically moved onto the DSHS window once found |
| `SUBJECT-89` | Internal Memo: Subject 89 |
| `TAG-ARTIST-IMP` | Caity Johnson (The Inspired Imp) dossier |
| `TAG-ARTIST-AEGIS` | Jacoby Hinton (The Vanguard) dossier |

There are also team-only recovery codes for live troubleshooting (force an
unlock, jump straight to the ending). They're intentionally not listed
here — see `TESTING.md` if you need them, and never print them on a public
tag or QR code.

## Dev harness

Add `?debug=1` to any URL to open a dev panel (bottom-right, never visible
to players without the flag):

- Live game state (boot phase, path, faction, unlock counts)
- Jump to any screen (title sequence, menu, field manual, straight into
  the game)
- Force a faction, force-unlock the current node, unlock all 14 items at
  once, jump to the ending, or fire the bonus reveal on demand
- Purge saved progress and reload as a first-time visitor

Everything in the panel writes to local React/localStorage state only — it
never hits the real signup endpoint, so testing never spams the real
inbox.

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
