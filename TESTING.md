# Testing Failed Flight Plan

## 1. Start the app

Open a terminal **in this folder** (`C:\Users\Nick\timeline-protocol`) and run:

```
npm install
npm run dev
```

`npm install` is only needed the first time, or after dependencies change.

Vite prints something like:

```
  ➜  Local:   http://localhost:5173/
```

Open that in your browser. Leave the terminal running — it live-reloads every time
a file is saved. Press `Ctrl+C` in the terminal to stop it.

## 2. Test on your phone (do this before the show)

This is the one that matters. The app is built for a phone held at a loud venue,
and the title sequence, the map and the Sandbox modal all behave differently
on a small screen.

```
npm run dev -- --host
```

Vite now prints a second line:

```
  ➜  Network: http://192.168.1.xxx:5173/
```

Type that address into your phone's browser. Phone and computer must be on the
same wifi. If it won't connect, Windows Firewall is blocking it — allow Node.js
on private networks when prompted.

## 3. The dev harness

Replaying a 9.5-second title sequence on every reload gets old fast. Add
`?debug=1` to the URL:

```
http://localhost:5173/?debug=1
```

A magenta **DEV** panel appears bottom-right. It gives you:

**Live state** — current boot phase, active tab, chosen path, step index, how many
nodes are unlocked.

**Firestore counts** — `12a / 3i / 5j` means 12 artifacts, 3 ideas, 5 journals
loaded. If this reads `0a / 0i / 0j` in red, the app is not talking to your
database and nothing in the game will work. That's the first thing to check when
the map looks empty.

**Node resolution** — shows which database record the keyword matcher actually
picked for MONEY, SKETCH and EXIT. This is where wrong clue descriptions come
from. If `EXIT: NO MATCH` shows red, no record contains the words
exit/parachute/forest/drop and that step is unfinishable.

**Jump to screen** — go straight to any splash card, the menu, the field manual,
or skip into the game.

**Sandbox** — open the anomaly page, the temporal rupture warning, or either
artist dossier. The lock icon next to each artist toggles their dossier between
locked and unlocked so you can check both states without hunting for a tag.

**Game state** — force-unlock the current node, jump to the endgame, or purge
saved progress and reload as a first-time visitor.

The panel only renders when `?debug=1` is in the URL, so it's safe to leave in
the live build. Players will never see it.

## 4. Testing the physical tags

You don't need real RFID tags to test scanning. Two ways:

**Manual scan tab** — bottom nav → MANUAL SCAN → type the code → INITIATE
DECRYPTION.

**URL scan** — append the code to the address, exactly as a real tag would:

```
http://localhost:5173/?scan=TAG-ARTIST-IMP
```

### Codes currently wired up

| Code | What it does |
|---|---|
| `TAG-ARTIST-IMP` | Unlocks Caity's dossier |
| `TAG-ARTIST-AEGIS` | Unlocks Jacoby's dossier |
| `TAG-NIGHTMARE-OVERRIDE` | Force-unlocks whatever node you're currently on |
| `TAG-ENDGAME-OVERRIDE` | Jumps straight to the endgame + donation screen |

Any `code` or `assetId` field on a Firestore record also works as a scan code.

## 5. What to actually check

- **Title sequence** — CRI ident on black, then the map fading up behind the
  TIMELINE PROTOCOL logo, then FAILED / FLIGHT / PLAN on three yellow lines.
  On a phone, confirm all three words fit on their own line.
- **Sandbox page** — donate button opens the Zeffy form. Both artist cards show
  as locked on a fresh install. Their Instagram links open correctly.
- **Artist dossiers** — scan each code, confirm the dossier opens and stays
  unlocked after a reload.
- **Temporal rupture** — red panel opens the full-screen advisory, and the
  ACKNOWLEDGE button returns you to the Sandbox page.
- **Map** — nodes appear as you unlock them, joined by the purple dashed line.

## 6. Known broken

- **The EXIT profile crashes the app.** `SEQUENCES` has no route defined for
  EXIT, so selecting it white-screens the player. Not yet fixed.
- **GPS proximity unlock does not exist.** The field manual promises it; no
  geolocation code is present. Scanning is the only way to unlock.
- **The map has no target markers.** It only draws nodes already collected, so
  there is nothing to navigate toward.
- **The cold-drop hacker script is unreachable.** Nothing ever triggers
  `hackerColdDropPhase`, so first-time scanners get the standard intro instead.
