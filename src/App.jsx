import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { db, appId } from './firebase'; 
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { Icons } from './Icons'; 
import { CRILogo } from './CRILogo'; 

// ==========================================
// AUDIO ENGINE: DIGITAL SCREECH
// ==========================================
// Set by useAmbientResonance's mute toggle -- playGlitchSound lives outside
// React (called from plain functions, not just components) so it checks
// this module-level flag rather than a prop, but it means ONE mute switch
// silences both the one-shot stings and the ambient layers instead of only
// half of what's actually playing.
let audioMuted = false;

// Soft confirm chime — sine, not sawtooth, and a gentle upward glide rather
// than a harsh downward screech. Healing-tone brief, not glitch-horror: this
// fires on every single scan, so it's the most-heard sound in the game.
const playGlitchSound = () => {
    if (audioMuted) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(330, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.start();
        osc.stop(ctx.currentTime + 0.65);
    } catch (e) { console.warn("Audio blocked."); }
};

// ==========================================
// AMBIENT RESONANCE LAYER SYSTEM
// A quiet, additive drone: each of the 3 main node types (GUARDIAN /
// DETECTIVE / VIGILANTE) owns one sustained harmonic layer that fades in
// the moment it's found, in whatever order they're found. Bonus/lore finds
// nudge a brief detune flutter across whatever's already playing instead of
// adding new pitches, so it never gets cluttered even at all 14 items.
// Full completion resolves the power chord into a full triad -- major
// (brighter) for CRI, minor (moodier) for HACKER.
//
// Tuned to A=432Hz (not the standard A=440) — still a plain root/fifth/
// octave power chord (nothing dissonant), just pitched half a step warmer.
// In-fiction this is "CRI's recalibrated resonance frequency"; out of
// fiction it's the healing/calming tuning association. The whole point is
// to help people relax into the room, not to spike adrenaline.
//
// Entirely synthesized, same approach as playGlitchSound -- no audio
// files, no loading. Ties into the game's own "resonance research" fiction
// instead of being a bolted-on jingle.
//
// Off by default is the *safer* choice for a loud live show where people
// may have sound off out of courtesy -- this currently defaults ON to make
// testing easier. Flip DEFAULT_SOUND_ENABLED to false before shipping live.
// ==========================================
const DEFAULT_SOUND_ENABLED = true;
const RESONANCE_LAYERS = {
    GUARDIAN:  { freq: 108.00, type: 'sine' },     // A2 @432 -- root
    DETECTIVE: { freq: 162.00, type: 'triangle' }, // E3 @432 -- fifth
    VIGILANTE: { freq: 216.00, type: 'sine' }      // A3 @432 -- octave
};
// A whisper, not a wash -- roughly a third of the old level. With all 3
// layers stacked this still tops out well under the confirm-chime volume.
const LAYER_GAIN = 0.015;
// Slow inhale/exhale swell on top of the drone -- one breath every ~8.6s
// (0.0625Hz), gently rising and falling the layer volume by about a third
// of itself rather than a flat static tone. This is the "beat" -- a
// breathing pulse, not a rhythm track, so it reads as calming rather than
// energizing.
const BREATH_RATE_HZ = 0.0625;
const BREATH_DEPTH = 0.35;

// Slow arpeggio layered on top of the drone -- starts only once the loop is
// closed (the 3rd main door), as the reward for finishing, then keeps
// unlocking one more note per additional bonus/lore find found after that
// (exploring lore before completion still counts -- it just means the
// pattern starts richer instead of starting late). Same A-root @432 scale
// as the drone (A3/C#4/E4/A4/B4 -- major-add9, still consonant with the
// sustained chord underneath), plucked softly one note at a time rather
// than stacked as sustained tones, so it reads as a slow building melody,
// not a wall of pitches.
const ARPEGGIO_NOTES = [216.00, 272.14, 323.70, 432.00, 484.90];
const ARPEGGIO_STEP_SECONDS = 1.9;
const ARPEGGIO_GAIN = 0.05;

function useAmbientResonance(gameState) {
    const [soundEnabled, setSoundEnabled] = useState(() => {
        try {
            const saved = localStorage.getItem('tp_ambient_sound');
            return saved ? saved === 'on' : DEFAULT_SOUND_ENABLED;
        } catch { return DEFAULT_SOUND_ENABLED; }
    });

    // One mute switch for everything -- keeps the module-level flag that
    // playGlitchSound checks in sync with this hook's own state, on mount
    // and on every toggle.
    useEffect(() => { audioMuted = !soundEnabled; }, [soundEnabled]);

    const ctxRef = useRef(null);
    const masterGainRef = useRef(null);
    const layerNodesRef = useRef({});
    const activatedRef = useRef(new Set());
    const bonusCountRef = useRef(0);
    const resolvedRef = useRef(false);
    const breathScalerRef = useRef(null);
    const arpNotesUnlockedRef = useRef(0);
    const arpIntervalRef = useRef(null);
    const arpIndexRef = useRef(0);

    const ensureContext = () => {
        if (ctxRef.current) return ctxRef.current;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioContext();
            const compressor = ctx.createDynamicsCompressor(); // cheap safety net against any params drifting loud
            const masterGain = ctx.createGain();
            masterGain.gain.value = soundEnabled ? 1 : 0;
            masterGain.connect(compressor);
            compressor.connect(ctx.destination);

            // Shared breathing LFO -- one slow sine, fanned out into every
            // layer's gain param as they activate, so all layers swell and
            // fall in phase together like a single breath instead of each
            // drifting independently.
            const breathLFO = ctx.createOscillator();
            breathLFO.type = 'sine';
            breathLFO.frequency.value = BREATH_RATE_HZ;
            const breathScaler = ctx.createGain();
            breathScaler.gain.value = LAYER_GAIN * BREATH_DEPTH;
            breathLFO.connect(breathScaler);
            breathLFO.start();
            breathScalerRef.current = breathScaler;

            ctxRef.current = ctx;
            masterGainRef.current = masterGain;
            return ctx;
        } catch (e) {
            console.warn("Ambient audio unavailable.", e);
            return null;
        }
    };

    // Browsers refuse to start audio without a user gesture. Rather than
    // depend on which specific button someone happens to tap first, unlock
    // on literally the first tap anywhere -- this game is 100% tap-driven,
    // so that fires almost immediately either way.
    useEffect(() => {
        const unlock = () => {
            const ctx = ensureContext();
            if (ctx && ctx.state === 'suspended') ctx.resume();
        };
        document.addEventListener('pointerdown', unlock, { once: true });
        return () => document.removeEventListener('pointerdown', unlock);
    }, []);

    const toggleSound = () => {
        setSoundEnabled(prev => {
            const next = !prev;
            try { localStorage.setItem('tp_ambient_sound', next ? 'on' : 'off'); } catch {}
            const ctx = ensureContext();
            if (ctx && masterGainRef.current) {
                if (ctx.state === 'suspended') ctx.resume();
                masterGainRef.current.gain.linearRampToValueAtTime(next ? 1 : 0, ctx.currentTime + 0.3);
            }
            return next;
        });
    };

    const activateLayer = (type) => {
        if (activatedRef.current.has(type) || !RESONANCE_LAYERS[type]) return;
        activatedRef.current.add(type);
        const ctx = ensureContext();
        if (!ctx || !masterGainRef.current) return;
        const { freq, type: waveType } = RESONANCE_LAYERS[type];
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = waveType;
        osc.frequency.value = freq;
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(masterGainRef.current);
        if (breathScalerRef.current) breathScalerRef.current.connect(gain.gain);
        osc.start();
        gain.gain.linearRampToValueAtTime(LAYER_GAIN, ctx.currentTime + 1.4);
        layerNodesRef.current[type] = { osc, gain };
    };

    // A brief flutter across whatever's already playing -- feedback for a
    // bonus find without adding new pitch content to the drone.
    const flourish = () => {
        const ctx = ctxRef.current;
        if (!ctx) return;
        Object.values(layerNodesRef.current).forEach(({ osc }) => {
            const now = ctx.currentTime;
            osc.detune.cancelScheduledValues(now);
            osc.detune.setValueAtTime(0, now);
            osc.detune.linearRampToValueAtTime(18, now + 0.3);
            osc.detune.linearRampToValueAtTime(0, now + 0.6);
        });
    };

    // One soft plucked note -- short attack, gentle decay, routed through
    // masterGain so the existing mute button silences this too.
    const playArpNote = (freq) => {
        const ctx = ctxRef.current;
        if (!ctx || !masterGainRef.current) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(masterGainRef.current);
        const now = ctx.currentTime;
        osc.start(now);
        gain.gain.linearRampToValueAtTime(ARPEGGIO_GAIN, now + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.0005, now + 1.3);
        osc.stop(now + 1.4);
    };

    // Starts on the first bonus/lore find and runs for the rest of the
    // session -- a slow, quiet plucked pattern that only uses however many
    // notes have been unlocked so far (see arpNotesUnlockedRef), so it
    // visibly/audibly grows richer the more a player explores.
    const startArpeggio = () => {
        if (arpIntervalRef.current) return;
        arpIntervalRef.current = setInterval(() => {
            const unlocked = Math.max(1, arpNotesUnlockedRef.current);
            const freq = ARPEGGIO_NOTES[arpIndexRef.current % unlocked];
            arpIndexRef.current += 1;
            playArpNote(freq);
        }, ARPEGGIO_STEP_SECONDS * 1000);
    };

    // A2/E3/A3 power chord resolves into a full triad -- major third (C#4)
    // for CRI, minor third (C4) for HACKER -- then fades back down, leaving
    // the base drone playing.
    const playResolveSting = (faction) => {
        const ctx = ensureContext();
        if (!ctx || !masterGainRef.current) return;
        const thirdFreq = faction === 'HACKER' ? 261.63 : 277.18;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = thirdFreq;
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(masterGainRef.current);
        const now = ctx.currentTime;
        osc.start(now);
        gain.gain.linearRampToValueAtTime(LAYER_GAIN * 1.4, now + 0.6);
        gain.gain.linearRampToValueAtTime(LAYER_GAIN * 0.5, now + 3);
        gain.gain.linearRampToValueAtTime(0, now + 6);
        osc.stop(now + 6.2);
    };

    // "LAZARO EXISTS" spoken low, slow, and ring-modulated -- the one
    // deliberately harsh, inhuman moment in the whole design. Everything
    // else here is built to be calming; this is the villain's own voice
    // landing wrong on purpose, right at the CRI-ending reveal.
    //
    // True ring modulation needs a multiply node the Web Audio API doesn't
    // expose directly, so this approximates it the standard trick way: a
    // slow oscillator connected straight into the carrier's gain AudioParam
    // amplitude-modulates it into that same buzzy, robotic texture without
    // needing a custom AudioWorklet.
    //
    // Browser TTS audio can't be routed through the Web Audio graph itself
    // (no browser exposes speechSynthesis output as a source node), so the
    // spoken line and the buzz are two separate, simultaneous layers rather
    // than the buzz actually processing the voice.
    const speakLazaroReveal = () => {
        if (audioMuted) return;
        try {
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
                const utter = new SpeechSynthesisUtterance('LAZARO EXISTS.');
                utter.pitch = 0.1;
                utter.rate = 0.75;
                utter.volume = 1;
                window.speechSynthesis.speak(utter);
            }
        } catch (e) { console.warn("Speech synthesis unavailable.", e); }

        const ctx = ensureContext();
        if (!ctx || !masterGainRef.current) return;
        const carrier = ctx.createOscillator();
        const modulator = ctx.createOscillator();
        const modDepth = ctx.createGain();
        const outGain = ctx.createGain();
        const restingLevel = LAYER_GAIN * 4;
        carrier.type = 'square';
        carrier.frequency.value = 95;
        modulator.type = 'sine';
        modulator.frequency.value = 32;
        modDepth.gain.value = restingLevel;
        modulator.connect(modDepth);
        modDepth.connect(outGain.gain);
        carrier.connect(outGain);
        outGain.connect(masterGainRef.current);
        const now = ctx.currentTime;
        outGain.gain.setValueAtTime(restingLevel, now);
        outGain.gain.linearRampToValueAtTime(0, now + 2.2);
        carrier.start(now);
        modulator.start(now);
        carrier.stop(now + 2.3);
        modulator.stop(now + 2.3);
    };

    // Nodes are created (silently, at true gain) regardless of the mute
    // toggle, so turning sound back on always reflects the real game state
    // instead of missing whatever unlocked while muted.
    useEffect(() => {
        const foundTypes = new Set(gameState.unlockedNodes.map(n => n.type));
        Object.keys(RESONANCE_LAYERS).forEach(t => { if (foundTypes.has(t)) activateLayer(t); });

        // Bonus/lore finds always grow the arpeggio's unlocked note count,
        // whether that happens before or after the loop is closed -- but the
        // pattern itself only starts playing once gameComplete fires (see
        // below), so exploring lore early just means it starts richer.
        const bonusCount = gameState.unlockedNodes.filter(n => n.type === 'MANUAL').length;
        if (bonusCount > bonusCountRef.current) {
            flourish();
            arpNotesUnlockedRef.current = Math.min(ARPEGGIO_NOTES.length, bonusCount);
        }
        bonusCountRef.current = bonusCount;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameState.unlockedNodes]);

    // Stop the arpeggio's setInterval if this ever unmounts (session is
    // effectively one long mount in practice, but keep this honest).
    useEffect(() => () => { if (arpIntervalRef.current) clearInterval(arpIntervalRef.current); }, []);

    // The arpeggio starts here, on the 3rd main door closing the loop --
    // not on an earlier bonus find. If bonus items were already found before
    // completion, arpNotesUnlockedRef is already > 1 by this point, so it
    // starts with however many notes that exploration already earned.
    //
    // Gated on the persisted bonusRevealShown flag, not a local ref -- a
    // local ref resets to false on every mount, so a player who completes
    // the game and later reloads (phone backgrounded, tab killed, etc.)
    // would otherwise hear the resolve chord and the arpeggio kick-in
    // replay from scratch every single time they reopen the page.
    useEffect(() => {
        if (!gameState.gameComplete || gameState.bonusRevealShown) return;
        playResolveSting(gameState.faction);
        startArpeggio();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameState.gameComplete]);

    return { soundEnabled, toggleSound, speakLazaroReveal };
}

// ==========================================
// TYPEWRITER COMPONENT
// ==========================================
const TypewriterText = ({ lines, onComplete }) => {
    const [displayedLines, setDisplayedLines] = useState([]);
    const [currentLineIndex, setCurrentLineIndex] = useState(0);
    const [currentCharIndex, setCurrentCharIndex] = useState(0);

    useEffect(() => {
        if (currentLineIndex >= lines.length) {
            if (onComplete) onComplete();
            return;
        }
        const currentLine = lines[currentLineIndex];
        if (currentCharIndex < currentLine.length) {
            const timeout = setTimeout(() => {
                setDisplayedLines(prev => {
                    const newLines = [...prev];
                    if (!newLines[currentLineIndex]) newLines[currentLineIndex] = '';
                    newLines[currentLineIndex] += currentLine[currentCharIndex];
                    return newLines;
                });
                setCurrentCharIndex(prev => prev + 1);
            }, 25); 
            return () => clearTimeout(timeout);
        } else {
            const timeout = setTimeout(() => {
                setCurrentLineIndex(prev => prev + 1);
                setCurrentCharIndex(0);
            }, 500); 
            return () => clearTimeout(timeout);
        }
    }, [currentLineIndex, currentCharIndex, lines, onComplete]);

    return (
        <div className="font-mono text-[#00ff41] text-sm leading-relaxed text-shadow-glow">
            {displayedLines.map((line, i) => (
                <p key={i} className="mb-4">{line}</p>
            ))}
            {currentLineIndex < lines.length && <span className="animate-pulse">_</span>}
        </div>
    );
};

const stripHtmlToLines = (html) => {
    const tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    const text = tmp.innerText || tmp.textContent || "";
    return text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
};

// ==========================================
// CITY-WIDE CONFIGURATION
// ==========================================
const SEATTLE_CENTER = { lat: 47.6153, lng: -122.3204 };

// Map backdrop for tonight's single-venue game -- a CRI-terminal-style grid
// with a soft radar glow centered on the venue, instead of real map tiles.
// Same dark navy (#020617) and cyan the rest of the UI already uses.
const CRI_GRID_BG =
    'radial-gradient(circle at center, rgba(6,182,212,0.28) 0%, transparent 55%),' +
    'repeating-linear-gradient(0deg, rgba(6,182,212,0.14) 0px, rgba(6,182,212,0.14) 1px, transparent 1px, transparent 40px),' +
    'repeating-linear-gradient(90deg, rgba(6,182,212,0.14) 0px, rgba(6,182,212,0.14) 1px, transparent 1px, transparent 40px),' +
    '#020617';

// Sandbox Seattle — 1417 10th Ave, Capitol Hill. Tonight's venue (Subject 89,
// 10 Sept 2026) — same building as last month's Failed Flight Plan show.
const VENUE = { lat: 47.613592, lng: -122.319640, label: 'THE SANDBOX' };

// Belltown neighborhood centroid — fallback for bonus/rogue nodes that don't
// have a specific real address (GPS-at-scan-time for those is a fast-follow).
const BELLTOWN = { lat: 47.613231, lng: -122.345361, label: 'BELLTOWN — SIGNAL SOURCE' };

// The three real, physical Belltown Blast locations.
const JUPITER_BAR = { lat: 47.6132144, lng: -122.3438682, label: 'Jupiter Bar — 2126 2nd Ave' };
const SHORTYS = { lat: 47.6145079, lng: -122.3460868, label: "Shorty's Coney Island — 2316 2nd Ave" };
const DSHS = { lat: 47.6129029, lng: -122.343317, label: 'DSHS Building — 2106 2nd Ave (side door)' };

// ==========================================
// CLOSED-LOOP DEMO MODE
// T3S/Firestore currently has stale content from a previous show. While that's
// down/wrong, this flag makes the whole game run on the hardcoded content below
// instead — MONEY/SKETCH/EXIT clues, lore and unlocks all come from
// STATIC_MAIN_NODES / STATIC_LORE_NODES, zero network dependency.
// To bring T3S back once it's repopulated correctly: set this to false.
// ==========================================
const CLOSED_LOOP_DEMO = true;

// ==========================================
// SHOW KILL SWITCH
// Flip to false to take the live game down (a "the show has ended" screen
// replaces the whole app, donate link included) without deleting any code.
// This is a build-time flag, not a remote one — there's no backend live
// right now to read a runtime toggle from, so turning the show off means
// flipping this, rebuilding (`npm run build`), and re-uploading `dist/`
// the same manual way every other deploy works. Turn it back to true and
// redeploy to bring the game back.
// ==========================================
const SHOW_LIVE = true;

// Storage key versioned per-show. Bumping it on a new show means anyone
// returning with an old save doesn't have last month's completed main
// nodes silently satisfy this month's (different) main nodes — they start
// this show's loop fresh. The old key's data is left alone in their phone
// (harmless) and is what OLD_STORAGE_KEY below checks for, purely to say
// "welcome back" — see isReturningPlayer.
const STORAGE_KEY = 'timeline_protocol_subject89_v1';
const OLD_STORAGE_KEY = 'timeline_protocol_belltown_v1';

const STRIPE_LINK = "https://www.zeffy.com/en-US/donation-form/the-catalyst-accelerating-the-reaction";

// The 3 static main-sequence node types a player needs to find (any order —
// there is no required sequence). Once all 3 are in unlockedNodes, the game
// is complete. selectedPath (GUARDIAN/DETECTIVE/VIGILANTE) is now purely a
// cosmetic identity choice from Build Profile — it no longer gates order.
const MAIN_NODE_TYPES = ['GUARDIAN', 'DETECTIVE', 'VIGILANTE'];

// ==========================================
// TEMPORAL ARTISTS
// Scan codes below are wired into processScan() — print these on the
// artists' RFID tags / QR codes to open their dossier in-game.
// ==========================================
const TEMPORAL_ARTISTS = [
    {
        id: 'TA-01',
        scanCode: 'TAG-ARTIST-IMP',
        name: 'Caity Johnson',
        alias: 'THE INSPIRED IMP',
        role: 'The Curator // Inside Eyes',
        affiliation: 'CRI EVENT PROMOTER — STATUS: COMPLIANT',
        affiliationWarn: 'TAG DOUBLE AGENT — UNVERIFIED',
        tool: 'The Symbiotic Squeegee',
        color: '#f97316',
        instagram: 'https://instagram.com/inspired.imp',
        instagramHandle: '@inspired.imp',
        website: null,
        bio: [
            "Painter, band promoter, curator. Operates as The Inspired Imp — the connective tissue of the Seattle art scene. Builds the rooms where art, music and people meet.",
            "The Institute recruited her to fill those rooms. High-volume crowds make an efficient bio-acoustic centrifuge, and no one in this city can pull a crowd like she can. CRI files her as a compliant marketing asset.",
            "CRI underestimated her empathy. She recognised what the Institute was doing to the people she brought through the door, and has been quietly working against it ever since — using her clearance to identify at-risk artists and funnel them toward the Temporal Artists Guild."
        ],
        toolLore: [
            "Her squeegee blade is cut with neutralised Black Mud — chronal slag salvaged from the Pioneer Square underground — suspended in Boaz static.",
            "Every flyer she screen-prints carries a microscopic analog frequency pressed into the fibres of the paper. Stapled to a pole or taped to a venue wall, each print becomes a low-level signal jammer.",
            "A room papered in her posters reads as a dead zone. Digital scanners cannot resolve what happens inside it. She is not decorating the venue. She is shielding it."
        ]
    },
    {
        id: 'TA-02',
        scanCode: 'TAG-ARTIST-AEGIS',
        name: 'Jacoby Hinton',
        alias: 'THE VANGUARD',
        role: 'TAG Muscle // Recruiter',
        affiliation: 'TEMPORAL ARTISTS GUILD — HOSTILE TO CRI',
        affiliationWarn: null,
        tool: 'The Aegis Drop-Cloth',
        color: '#06b6d4',
        instagram: 'https://instagram.com/jacobyhintonart',
        instagramHandle: '@jacobyhintonart',
        website: 'https://jacobyhinton.art',
        bio: [
            "Formally trained fine artist and muralist. Carries himself like a bouncer. Third pillar of the Temporal Artists Guild — the spine that keeps the Guild focused, protected and moving.",
            "Years inside a corporate art world taught him exactly what exploitation looks like on paper. He does not see the Institute as mysterious. He sees a parasite harvesting the vital energy of marginalised local artists to fund its own escape.",
            "He vets every new recruit personally. He has never met Bob McKenzie and is fiercely protective of him anyway — a working man hunted across centuries by people with grant funding."
        ],
        toolLore: [
            "A heavy painter's drop-cloth rolled over one shoulder, woven from industrial hemp and chronal-displaced asbestos recovered from the 1956 lab wreckage, saturated with raw Boaz static.",
            "Thrown hard against any flat surface, the charge liquefies the architecture behind it for sixty seconds — a doorway where there was a wall. He carries his crew's escape route on his back.",
            "Dense enough to work as a Faraday cage for chronal radiation. Dropped over an active breach, it smothers the reaction and hides the signature long enough for everyone to disappear."
        ]
    }
];

// ==========================================
// STATIC RABBIT HOLE NODES (Flight 305 storyline)
// Hardcoded so these work even if nothing has been entered into T3S yet.
// Print/display the `code` value on the tag's RFID sticker or QR, or as a
// URL: https://timelineprotocol.com/?scan=FLIGHT-71
// To add real audio later, just add an `audioUrl: "https://…mp3"` field —
// renderMediaModal already knows how to play it.
// ==========================================
const STATIC_LORE_NODES = [
    {
        id: 'static-flight-71',
        code: 'FLIGHT-71',
        legacy: true,
        title: 'Intercepted Audio: The Professor',
        lat: VENUE.lat, lng: VENUE.lng,
        text: "[ CRI SIGNAL INTERCEPT — AFT AIRSTAIR DOOR RESONANCE ]<br/><br/>Audio recovered from the door's residual chronal signature. Full recording pending upload.<br/><br/>What's already decrypted: a second voice on the tape, calm, coaching. Bob isn't planning this alone.",
        artistNotes: "I just decrypted this audio file off the door's resonance. Listen to this.\n\nBob didn't hijack that plane for the money. This 'Professor' set him up. Stanton used him as a kinetic anchor. Bob had no idea what he was doing."
    },
    {
        id: 'static-tg-001',
        code: 'TG-001',
        legacy: true,
        title: 'CRI Asset Log: The Synchronization Bridge',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ CRI ASSET DETAIL — CRI-TG-001 ]<br/><br/>The Temporal Mark Generator: a capacitor bank built to imprint a decades-long displacement factor onto a paired Anchor and Siphon. The process required a surge past every safety threshold on the schematic.<br/><br/>Recovered connection ports show heat-warped scarring consistent with total overload, moments before the unit was vaporized.",
        artistNotes: "Whatever they built in that basement wasn't meant to be used twice. Look at the scoring on the metal — somebody burned this thing out on purpose, or it burned itself out stopping them.\n\nEither way, nobody's rebuilding it."
    },
    {
        id: 'static-reactor-61',
        code: 'REACTOR-61',
        legacy: true,
        title: 'AEC Order 66-9: Containment by Concrete',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ DECLASSIFIED — 1961 ]<br/><br/>Order issued for immediate construction of a research reactor directly over an existing radiation lab in this sector. Official justification on file: modernization.<br/><br/>Unofficial effect: the new reactor's baseline radiation signature ran hot enough to mask whatever the old lab underneath it was still leaking.",
        artistNotes: "They didn't shut this lab down. They poured a live reactor on top of it so nobody would ever think to dig.\n\nThat's not decommissioning. That's a cover-up with a building permit."
    },
    {
        id: 'static-hum-440',
        code: 'HUM-440',
        legacy: true,
        title: 'Research Draft: Harmonic Excitation of Cobalt-60 Derivatives',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ REJECTED RESEARCH DRAFT — AUTHOR REDACTED ]<br/><br/>Proposes that a tri-tone acoustic pressure of 440.01 Hz can displace radioactive decay entirely. Rejected by peer review. Correctly predicted a phenomenon the author called 'glass pitting.'<br/><br/>CRI runs the inverse of this exact frequency, -440.01 Hz, to keep something in this sector paralyzed. What the neighbors call 'the Hum' is the bleed.",
        artistNotes: "Someone got laughed out of a journal for this paper in the 1950s. CRI read it, flipped the sign, and built a cage with it.\n\nWhoever's stationed on that containment tone has been running it for a very long time."
    },
    {
        id: 'static-filter-protocol',
        code: 'FILTER-PROTOCOL',
        legacy: true,
        title: 'Physics Division Memo: The Frequency of Clarity',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ INTERNAL MEMO — AUTHOR REDACTED ]<br/><br/>Subject: The Filter. The average mind resolves temporal overlap as background noise — a trick of the light, deja vu, nothing worth reporting. This resistance is called the Filter.<br/><br/>Recommendation: a mass-scale, voluntary lowering of the Filter through gamified public participation. A mind searching for something is primed to find it — including things that were never meant to be found.",
        artistNotes: "This is the memo that bothers me most. They wrote up a plan to turn a night out into a psychology experiment on everyone holding a phone.\n\nYou're not just playing a game right now. You're the control group."
    },
    {
        id: 'static-sudo-clearance',
        code: 'SUDO-CLEARANCE',
        legacy: true,
        title: 'CRI Personnel File: Redacted',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ ACCESS PARTIALLY GRANTED ]<br/><br/>Most of this file is blacked out. What's left: a title, '[ REDACTED — FORMER LEAD, RESONANCE RESEARCH ]', underlined three times, and a note in different handwriting that just says <em>he's gone. the work isn't.</em>",
        artistNotes: "Whoever ran this lab is out of the picture now. Left, removed, doesn't matter — the file's been scrubbed either way.\n\nBut the equipment's still down there. Somebody's still running it."
    },
    {
        id: 'static-cri-psa-099',
        code: 'CRI-PSA-099',
        legacy: true,
        title: 'CRI Public Safety Advisory: CRI-PSA-099',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "<strong>CASCADIA RESONANCE INSTITUTE — PUBLIC SAFETY ADVISORY</strong><br/>DOC REF: CRI-PSA-099 // SUBJECT: BIO-ACOUSTIC MONITORING &amp; TEMPORAL STRESS DISCLAIMER<br/><br/><strong>I. BIO-ACOUSTIC MONITORING</strong><br/>CRI hereby notifies all participants that this environment is under continuous Bio-Acoustic Surveillance. The 1956 Resonance Echo interacts directly with human biological systems; CRI monitors &ldquo;Resonant Loads&rdquo; within the crowd to prevent an accidental Temporal Breach. Presence within the activation zone constitutes irrevocable consent to the harvesting of acoustic data, utilized by the LAZARO Core to calibrate atmospheric stabilization protocols.<br/><br/><strong>II. CHRONAL TIME DILATION</strong><br/>Participants may experience localized variations in the passage of time (&ldquo;The 69-Year Slip&rdquo;). Proximity to the Jachin/Boaz artifacts can cause stretched seconds, auditory hallucinations of 1950s-era machinery, and visual pitting of surfaces.<br/><br/><strong>III. COGNITIVE INTERFERENCE</strong><br/>CRI is not liable for memory loss resulting from interaction with this narrative. When an observer perceives a door that exists in two years simultaneously, the brain purges the impossible data — gaps in short-term memory are expected.<br/><br/><strong>IV. MANDATORY REPORTING</strong><br/>Report any physical artifact that does not belong to this era to the Central Archive immediately.<br/><br/><em>GATE FREQUENCY: 1956 / DOORS / CRI. The Cascadia Resonance Institute: Optimizing the Z-Axis for a Better Yesterday.</em>",
        artistNotes: "CRI put this in writing and taped it to a door. 'Presence constitutes irrevocable consent to harvesting acoustic data' — they're not hiding it anymore, they're just betting nobody reads the fine print.\n\nIf you see a door that doesn't belong here, don't touch it before I do."
    },
    // The closing document — physically the sticker that gets moved from the bomb
    // prop onto the DSHS window once a player finds it. Ties tonight's DB Cooper
    // hunt directly into Belltown's CRI lab arc.
    {
        id: 'static-document-j',
        code: 'DOCUMENT-J',
        legacy: true,
        title: 'FBI/CRI Joint Case File: Document J (1971)',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ DECLASSIFIED — 1971 ]<br/><br/>Joint case file confirms the man known publicly as D.B. Cooper was not a hijacker. He was a CRI Field Agent executing an authorized temporal displacement jump into 1956.<br/><br/>The parachute functioned as a kinetic decelerator. The $200,000 in ransom bills was never about money — it was exactly 21 pounds of ballast, the precise mass required to stabilize the jump.",
        artistNotes: "This is it. This is the document that closes the loop.\n\nHe didn't disappear over the forest. He jumped on purpose — straight into 1956, straight into the lab that used to sit under this block. Put this on the window. Let whoever finds this place next see it."
    },
    // Teaser that plants the Subject 89 name and drops a Belltown map pin — kept
    // deliberately light since the full story lives in the doors above now.
    {
        id: 'static-subject-89',
        code: 'SUBJECT-89',
        legacy: true,
        title: 'Internal Memo: Subject 89',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ CRI INTERNAL MEMO — AUTHOR REDACTED ]<br/><br/>Confirms the 'Bigfoot' phenomenon is a species of phase-shifting entity using a high-frequency Masking Hum to stay invisible to the human Filter. Designation: Subject 89. Status, as of this filing: contained.<br/><br/>Status, as of tonight: unconfirmed. CRI has stopped answering questions about it.",
        artistNotes: "They had a name for it before they ever had it in a cage. 'Subject 89.' Like it was already just a number to them.\n\nBob didn't just open a door for it. He gave it back its name."
    },

    // ==========================================
    // SUBJECT 89 — Sandbox, 10 Sept 2026 (Capitol Hill Art Walk)
    // Content pack: bobs-doors/project-files/subject-89-nodes.md
    // CELL/TAPE/BOB moved to STATIC_MAIN_NODES below (tonight's 3 required
    // nodes). INTAKE/HUM/RELEASE stay here as optional easter-egg lore.
    // ==========================================
    {
        id: 'static-sub89-intake',
        code: 'SUB-89-INTAKE',
        title: 'Intake Record: Subject 89',
        lat: VENUE.lat, lng: VENUE.lng,
        text: "[ CASCADIA RESONANCE INSTITUTE — INTAKE — CLASSIFICATION: EYES ONLY ]<br/><br/>" +
              "DESIGNATION: Subject 89<br/>" +
              "ACQUIRED: 09 NOV 1983, Cascade foothills, ██████ County<br/>" +
              "METHOD: Acoustic containment. Four generators. Three failed.<br/>" +
              "TRANSPORT: Overnight, unmarked, sub-level access via the Capitol Hill site<br/>" +
              "SITE NOTE: The building above is a functioning public services office. Foot traffic is " +
              "considered an asset. Nobody counts people going into a place everybody already has to go.<br/><br/>" +
              "PHYSICAL: Approx. 7'4\". Mass inconsistent between readings taken four minutes apart.<br/>" +
              "BEHAVIOUR: Compliant. Did not resist acquisition. Did not resist transport.<br/><br/>" +
              "ATTENDING NOTE — DR. ██████:<br/>" +
              "<i>He walked in. I want that in the record. Four generators and a transport team and he " +
              "walked in on his own feet and sat down in the chamber before we asked him to.<br/><br/>" +
              "He is not contained. He is waiting. I do not know what for and I have stopped putting " +
              "that question in writing.</i>",
        artistNotes: "Nine years he was loose after '56 and they never got near him. Then in '83 he just " +
                     "lets them take him.\n\nYou don't sit down in the cell unless the cell is where you " +
                     "need to be."
    },
    {
        id: 'static-sub89-hum',
        code: 'SUB-89-HUM',
        title: 'On the Negative Tri-Tone',
        lat: VENUE.lat, lng: VENUE.lng,
        text: "[ CRI RESEARCH DIGEST — SUB-LEVEL 4 — 1984–1987 ]<br/><br/>" +
              "The locals say he vanishes. Reassigns. Turns into something else entirely. All three are " +
              "true, and none of them are the same trick.<br/><br/>" +
              "Subject 89 does not hide. He shifts what he is, arrives somewhere he wasn't, and by every " +
              "account that's ever survived contact with him, has done both across periods of time that " +
              "shouldn't touch. The file that finally made sense of him didn't come from a biologist. It " +
              "came from two stones.<br/><br/>" +
              "Every door in this city carries the same natural resonance — a tri-tone, 440.01 Hz. The " +
              "Institute spent thirty years assuming that was noise. It is not noise. It is the exact " +
              "frequency Subject 89 uses to leave, and to change what he looks like doing it.<br/><br/>" +
              "<b>Jachin</b> mapped the spatial half of that tri-tone. <b>Boaz</b> mapped the chronal half. " +
              "Combined, they gave the Institute something nobody asked them for: the tri-tone, inverted — " +
              "<b>-440.01 Hz</b>, all three components at once, not one note cancelled but the whole chord.<br/><br/>" +
              "Run continuously, it does two things. It stops him leaving. It stops him becoming anything " +
              "other than exactly what's standing in the room. Neither effect has a name in the literature. " +
              "Both effects work.<br/><br/>" +
              "The recommendation attached to the first working field test was one word: <b>DON'T.</b> " +
              "Something that can rewrite its own shape and its own arrival time is not a specimen. It is " +
              "load-bearing. Whatever Subject 89 actually is, it may be the reason this stretch of coastline " +
              "has stayed one timeline instead of several.<br/><br/>" +
              "The recommendation was overruled.",
        artistNotes: "Two rocks and thirty years of calling a door hum static. That's the whole org's " +
                     "research budget in one sentence.\n\nEverything they know how to do, they learned by " +
                     "taking apart something that was holding the rest of us up."
    },
    {
        id: 'static-sub89-release',
        code: 'SUB-89-RELEASE',
        title: 'Release Order 89-R (Disputed)',
        lat: VENUE.lat, lng: VENUE.lng,
        text: "[ CRI ADMINISTRATIVE RECORD — FILED 25 MAR 1987 ]<br/><br/>" +
              "<i>Subject 89 released to Sector 4 for stabilization duty. Containment concluded per " +
              "protocol. All personnel accounted for. No incident.</i><br/><br/>" +
              "SIGNED: Dr. ██████<br/>" +
              "FILED: 25 MAR 1987<br/>" +
              "EVENT DATE ON FORM: 14 MAR 1987<br/><br/>" +
              "————<br/><br/>" +
              "Eleven days.<br/><br/>" +
              "It takes eleven days to write four sentences when the four sentences are not true. " +
              "The Institute did not release Subject 89. The Institute lost him, to one unbadged man " +
              "and a door, and then spent a week and a half deciding what to call it.<br/><br/>" +
              "This document is the oldest lie in the file. Everything after it is built on top.",
        artistNotes: "This is the one that made me start pulling the whole thing apart.\n\n" +
                     "They didn't cover it up because it was dangerous. They covered it up because it " +
                     "was embarrassing."
    },

    // ==========================================
    // EASTER EGG — ISO-RED-666. A friend-of-the-show door, not part of the
    // required 3 or the Subject 89 lore set. `legacy: true` reused again
    // purely for its "hide the Case Board slot until found" behavior --
    // this is meant to be a pure surprise for whoever scans that door,
    // never advertised or hinted at.
    // ==========================================
    {
        id: 'static-iso-red-666',
        code: 'ISO-RED-666',
        legacy: true,
        title: 'Asset Log: ISO-RED-666 (Unscheduled)',
        lat: VENUE.lat, lng: VENUE.lng,
        text: "[ CRI ASSET LOG — UNSCHEDULED ENTRY ]<br/><br/>" +
              "This door was not on the manifest. Nobody on staff installed it, requisitioned it, or " +
              "approved it. It appeared between two scheduled inspections with a fresh coat of paint and " +
              "a symbol Legal has asked us not to reproduce in this filing.<br/><br/>" +
              "SUBJECT: ██████████ ██████████. Not an artist of record. Not CRI personnel. Field notes " +
              "describe him only as playing in \"several extremely loud bands.\"<br/><br/>" +
              "INCIDENT LOG: Three staff members reported a smell like ██████. One reported hearing " +
              "██████████████████ at 3:00 AM with no identifiable source. Building maintenance found " +
              "nothing. Building maintenance did not go back down there a second time.<br/><br/>" +
              "RECOMMENDATION: Leave it exactly where it is. Do not relocate. Do not attempt to paint " +
              "over the ██████. Whatever is on the other side of 666 seems, for now, content to stay " +
              "there.",
        artistNotes: "Nobody asked this guy to paint a door. He just kind of... did. Showed up with his " +
                     "own paint, wouldn't say what the symbol meant, left before anyone could ask twice.\n\n" +
                     "He's in like four metal bands. I'm not saying that's related.\n\n" +
                     "I'm also not NOT saying that."
    },

    // ==========================================
    // HACKER-EXCLUSIVE CAPSTONE — never printed on any sticker, never
    // scanned. Auto-granted directly into unlockedNodes on completion, but
    // only for HACKER-faction players (see triggerNodeUnlock). `legacy:
    // true` is reused here purely for its display effect (Case Board hides
    // it until it's actually in unlockedNodes) -- it has nothing to do with
    // last month's show.
    // ==========================================
    {
        id: 'static-sub89-vanish',
        code: 'SUB-89-GONE',
        legacy: true,
        title: "C@T@LY$T's Own File: Where He Actually Went",
        lat: VENUE.lat, lng: VENUE.lng,
        text: "[ UNOFFICIAL — NOT A CRI DOCUMENT — COMPILED BY C@T@LY$T ]<br/><br/>" +
              "He didn't rescue Bob. He used him.<br/><br/>" +
              "Cross-referencing the chamber's dead containment log against the tape: the field dropped " +
              "for under a second at 02:13:14 — long enough for a jump, not long enough for anyone " +
              "watching to call it anything but a glitch. Subject 89 didn't walk out. He and Bob went " +
              "together. Same jump, same instant.<br/><br/>" +
              "Then Subject 89 kept going. Bob didn't. Whatever puts Subject 89 back down somewhere, it " +
              "wasn't the same stop Bob got left at.<br/><br/>" +
              "He isn't hiding from anything. He's <i>going</i> somewhere — on a clock that doesn't wait " +
              "for the person he borrowed to get there.",
        artistNotes: "This one's mine. CRI doesn't have this file and never will.\n\n" +
                     "Bob was a door, not a destination. Whatever that thing is actually doing, it's been " +
                     "doing it since long before any of us were people it could borrow."
    },

    // ==========================================
    // LEGACY / RED HERRING — last month's Failed Flight Plan + Belltown Blast
    // main-sequence nodes (formerly STATIC_MAIN_NODES). Demoted to easter-egg
    // lore for tonight: still fully scannable if a player finds a surviving
    // old sticker in the venue, but no longer required and never advertised
    // in tonight's instructions. Don't announce these — let people who
    // stumble onto them think they found something they weren't meant to.
    // ==========================================
    {
        id: 'static-dshs-1980',
        code: 'DSHS-1980',
        legacy: true,
        title: 'Field Note: The DSHS Facade',
        lat: DSHS.lat, lng: DSHS.lng,
        text: "[ CRI FIELD NOTE — 2ND AVE TRANSIT NODE ]<br/><br/>This office was never fully DSHS. The state letterhead was a facade CRI kept running for decades to explain unmarked vans, late-night deliveries, and a door nobody on staff had keys to.<br/><br/>Internally this was a Resonance Research Annex — an old lab, active long after 1956, quietly kept off every public record.",
        artistNotes: "A government office that never processed a single case file. That's not bureaucracy, that's a lid on something.\n\nWhatever CRI was doing down in that basement, they needed a very boring building on top of it."
    },
    {
        id: 'static-boaz-smash',
        code: 'BOAZ-SMASH',
        legacy: true,
        title: 'CRI Surveillance File: Subject Redacted',
        lat: SHORTYS.lat, lng: SHORTYS.lng,
        text: "[ CRI SURVEILLANCE FILE — FACE REDACTED PER PROTOCOL 12 ]<br/><br/>Standard procedure: any image of an unauthorized temporal subject gets the face stripped before filing. This one didn't stay stripped. Someone repainted around the redaction — left the jacket, the build, the posture. Enough to know him, if you already do.<br/><br/>CRI's own paperwork won't say the name. Somewhere in this city, somebody still will.",
        artistNotes: "They blacked out his face and called it handled. It isn't. Every other file in this city dances around the same blank space — follow enough of them and the shape underneath starts to matter more than the face ever would."
    },
    {
        id: 'static-tag-signal',
        code: 'TAG-SIGNAL',
        legacy: true,
        title: 'Field Note: The Ballast Count',
        lat: JUPITER_BAR.lat, lng: JUPITER_BAR.lng,
        text: "[ CRI FIELD NOTE — 2ND AVE RECOVERY ]<br/><br/>$200,000 in ransom bills, never spent, barely even wanted. What mattered was the weight: 21 pounds exactly, strapped tight to a body mid-fall.<br/><br/>Ballast isn't a metaphor here. It's the only reason a jump like that holds together long enough to land anywhere at all.",
        artistNotes: "Everyone still calls this a robbery. It was a weights-and-measures problem. Twenty-one pounds, no more, no less — that's not a ransom note, that's an engineering spec."
    }
];

// ==========================================
// CASE BOARD CONNECTIONS
// Pairs of node ids that are narratively linked — drives the red-string lines
// on the Vault's crime board. A line only draws once at least one end is
// unlocked; it only goes solid once BOTH ends are found.
// ==========================================
const BOARD_CONNECTIONS = [
    ['static-dshs-1980', 'static-tg-001'],
    ['static-tg-001', 'static-reactor-61'],
    ['static-reactor-61', 'static-sudo-clearance'],
    ['static-dshs-1980', 'static-boaz-smash'],
    ['static-boaz-smash', 'static-subject-89'],
    ['static-subject-89', 'static-document-j'],
    ['static-flight-71', 'static-document-j'],
    ['static-hum-440', 'static-filter-protocol'],
    ['static-filter-protocol', 'static-cri-psa-099'],
    ['static-boaz-smash', 'static-tag-signal'],
    ['static-tag-signal', 'static-cri-psa-099'],
    ['static-tag-signal', 'TA-01'],
    ['TA-01', 'TA-02'],
    ['static-subject-89', 'static-sub89-cell'],
    ['static-sub89-tape', 'static-sub89-vanish']
];

// ==========================================
// STATIC MAIN-SEQUENCE NODES (GUARDIAN / DETECTIVE / VIGILANTE)
// All 3 are needed to complete the game, in any order. Replaces the T3S
// keyword search in getArtifactForType
// while CLOSED_LOOP_DEMO is on, so the clues shown on the map are always this
// show's content, never whatever T3S resolves to.
// ==========================================
const STATIC_MAIN_NODES = {
    GUARDIAN: {
        id: 'static-sub89-cell',
        code: 'SUB-89-CELL',
        title: 'Containment Chamber 4-C',
        lat: VENUE.lat, lng: VENUE.lng,
        desc: "Inside the room. Stand in the middle of it and read what these walls were built to do.",
        text: "[ CRI FACILITY SCHEMATIC — SUB-LEVEL 4 — CAPITOL HILL SITE ]<br/><br/>" +
              "You are standing in it.<br/><br/>" +
              "Chamber 4-C was built in 1983 and decommissioned in 1987. Interior surfaces were poured " +
              "in a single continuous pass with no seams, no fixtures and no right angles at floor level " +
              "— the Institute's first guess, and wrong. Doors carry their own resonant frequency. That " +
              "was never the problem. The problem was finding its inverse.<br/><br/>" +
              "Walls were held at a continuous <b>-440.01 Hz</b> for four years — the negative of the " +
              "frequency itself, tuned to cancel it rather than contain it. Staff rotated out at six weeks. " +
              "Longer postings produced nosebleeds, lost time, and what the medical files call " +
              "'persistent conviction of being observed through the wall.'<br/><br/>" +
              "The room you are standing in is a reconstruction. It is made of doors, which is either a " +
              "joke or the point.",
        artistNotes: "We built it from memory and one schematic. The proportions are right.\n\n" +
                     "Stand in the middle and stop talking for a second. That's the part they couldn't " +
                     "design out."
    },
    DETECTIVE: {
        id: 'static-sub89-tape',
        code: 'SUB-89-TAPE',
        title: 'CCTV 4C-02 — 14 MAR 1987 — 02:11:44',
        lat: VENUE.lat, lng: VENUE.lng,
        desc: "By the screen. Ninety-one seconds of tape nobody on staff wants to admit is real.",
        text: "[ SURVEILLANCE RECOVERY — CAMERA 4C-02 — SUB-LEVEL 4 ]<br/><br/>" +
              "Ninety-one seconds. No audio track — the microphone on 4C-02 recorded nothing but the " +
              "-440.01 Hz containment carrier for four years and was disconnected in 1985. That carrier " +
              "is the only thing standing between whatever's on the other side of this glass and a wall " +
              "that stops meaning anything.<br/><br/>" +
              "<b>02:11:44</b> — A man enters frame from the north corridor. Maintenance coveralls. " +
              "No visible badge. He is not on the duty roster for that night, that week, or that year.<br/><br/>" +
              "<b>02:12:19</b> — He stands in front of the chamber. He does not look at the camera. " +
              "He appears to be listening.<br/><br/>" +
              "<b>02:12:58</b> — He opens it. The interlock required two keys held simultaneously at " +
              "opposite ends of the corridor. Both remained in their housings. This has never been explained.<br/><br/>" +
              "<b>02:13:15</b> — The chamber is empty. It was not empty at 02:13:14.<br/><br/>" +
              "The man remains in frame for a further twenty seconds. Then he leaves the way he came.",
        artistNotes: "That's Bob.\n\nI've watched it maybe two hundred times. It's him. The walk is him.\n\n" +
                     "I showed it to him. He didn't recognise himself. He asked me who it was.\n\n" +
                     "He wasn't lying. I've known him since we were kids — I know what he looks like " +
                     "when he's lying. He hasn't done this yet.\n\n" +
                     "Here's the part I can't put down. That carrier is the only thing keeping Subject 89 " +
                     "solid enough to see and stupid enough to need a door. He can't walk through a wall " +
                     "in there. But something in that room clearly still walked out — through Bob instead."
    },
    VIGILANTE: {
        id: 'static-sub89-bob',
        code: 'SUB-89-BOB',
        title: "Bob's Statement",
        lat: VENUE.lat, lng: VENUE.lng,
        desc: "Near the door out. His own words, recorded, in his own denial.",
        text: "[ RECORDED BY N. SAPUTO — TRANSCRIBED ]<br/><br/>" +
              "<i>I don't know that guy.<br/><br/>" +
              "I know that's what you want me to say — that it's me, that I did it, that I remember. " +
              "I've watched it. I've watched it more than you have. It walks like me. It stands like me. " +
              "The way it holds its hands is how I hold my hands.<br/><br/>" +
              "In 1987 I was eight and I was in Everett and I have never been in a basement like that " +
              "in my life.<br/><br/>" +
              "But here's the thing that's been keeping me up. I know what he's doing in those twenty " +
              "seconds after. He's not checking the room. He's waiting to make sure the thing in there " +
              "got out clean.<br/><br/>" +
              "I know that because it's what I would do.<br/><br/>" +
              "So either it's not me, or I haven't done it yet.</i>",
        artistNotes: "He asked me not to put this one up.\n\nI'm putting it up."
    }
};

const NODE_CONFIG = {
    'GUARDIAN': { profile: 'THE GUARDIAN', desc: 'The rules are there for a reason. Start where the paperwork says to.', color: '#3b82f6', textClass: 'text-blue-400', borderClass: 'border-blue-500', bgClass: 'bg-blue-900/20', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L4 5 V11 C4 16.5 7.5 20.7 12 22 C16.5 20.7 20 16.5 20 11 V5 Z"></path></svg>` },
    'DETECTIVE': { profile: 'THE DETECTIVE', desc: 'Neutral. Thorough. Follow the evidence wherever it leads.', color: '#eab308', textClass: 'text-yellow-400', borderClass: 'border-yellow-500', bgClass: 'bg-yellow-900/20', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>` },
    'VIGILANTE': { profile: 'THE VIGILANTE', desc: "Some rules are made to be broken. Take matters into your own hands.", color: '#ef4444', textClass: 'text-red-400', borderClass: 'border-red-500', bgClass: 'bg-red-900/20', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>` }
};

export default function App() {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const playerMarker = useRef(null);
    const dynamicLayer = useRef(null);
    const boardCardRefs = useRef({});
    const [boardLines, setBoardLines] = useState([]);

    const [artifactsDb, setArtifactsDb] = useState([]);
    const [ideasDb, setIdeasDb] = useState([]);
    const [journalsDb, setJournalsDb] = useState([]);
    const [matrixDb, setMatrixDb] = useState({ nodes: [], edges: [] });
    
    const [activeTab, setActiveTab] = useState('MAP'); // Default to MAP
    const [toast, setToast] = useState(null);
    const [decrypting, setDecrypting] = useState(false);
    const [activeMedia, setActiveMedia] = useState(null);
    const [rabbitHoleItem, setRabbitHoleItem] = useState(null); 
    const [hasNewVaultItem, setHasNewVaultItem] = useState(false);
    
    const [playerLoc, setPlayerLoc] = useState(null); 
    const [trackingState, setTrackingState] = useState('IDLE'); 
    const [animatingSelection, setAnimatingSelection] = useState(null);

    const [bootPhase, setBootPhase] = useState(0);
    const [showSandbox, setShowSandbox] = useState(false);
    const [showHelpUs, setShowHelpUs] = useState(false);
    const [showRupture, setShowRupture] = useState(false);
    const [activeArtist, setActiveArtist] = useState(null);

    // DEV HARNESS — enabled with ?debug=1 in the URL. Never shows for players.
    const [debugMode] = useState(() => {
        try { return new URLSearchParams(window.location.search).has('debug'); }
        catch { return false; }
    });
    const [debugOpen, setDebugOpen] = useState(true);
    
    const [hackerIntroPhase, setHackerIntroPhase] = useState(0);
    const [hackerBreachChoice, setHackerBreachChoice] = useState(null); // null | 'PENDING_NO' | 'REPORTED'
    const [hackerColdDropPhase, setHackerColdDropPhase] = useState(0); 
    const [pendingColdDropMedia, setPendingColdDropMedia] = useState(null);
    const [hackerInterludePhase, setHackerInterludePhase] = useState(0); 
    const [interludeLines, setInterludeLines] = useState([]);
    const [pendingInterludeMedia, setPendingInterludeMedia] = useState(null);
    const [hackerEndPhase, setHackerEndPhase] = useState(0);
    const [userAlias, setUserAlias] = useState('');
    const [userEmail, setUserEmail] = useState('');
    const [showBonusReveal, setShowBonusReveal] = useState(false);
    const bonusRevealHandledRef = useRef(false);

    // A returning player has an old show's save but none yet under this
    // show's key -- purely for the one-time "welcome back" toast below,
    // never used to carry old progress into this show's requirements.
    const [isReturningPlayer] = useState(() => {
        try { return !!localStorage.getItem(OLD_STORAGE_KEY) && !localStorage.getItem(STORAGE_KEY); }
        catch { return false; }
    });
    const returningWelcomeShownRef = useRef(false);

    const [gameState, setGameState] = useState(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : {
            hasSeenTutorial: false,
            hackerIntroDone: false,
            selectedPath: null,
            unlockedNodes: [],
            unlockedArtists: [],
            gameComplete: false,
            faction: null, // null | 'HACKER' | 'CRI' — set on the first-unlock breach choice
            bonusRevealShown: false
        };
    });

    const { soundEnabled, toggleSound, speakLazaroReveal } = useAmbientResonance(gameState);

    const isArtistUnlocked = (artistId) => (gameState.unlockedArtists || []).includes(artistId);

    useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState)), [gameState]);

    // BONUS REVEAL — a beat after the game completes (any order, either faction),
    // a full-screen stinger fires once and never again. Higher z-index than the
    // hacker end popup so it lands on top of it if that's still open.
    //
    // bonusRevealShown is flipped to true immediately here (not in the
    // dismiss handler) -- it means "this has already played," not "the
    // player tapped to close it." If it only flipped on dismiss, a player
    // who completes and then backgrounds/reloads the tab before tapping
    // (extremely plausible on a phone at a live show) would get the whole
    // completion stinger AND the ambient audio's resolve chord replayed
    // from scratch every time they reopen it. Same flag also gates the
    // audio side -- see useAmbientResonance below.
    //
    // bonusRevealHandledRef guards against React StrictMode's dev-only
    // double-invoke (mount -> cleanup -> mount): without it, the first
    // invocation's setTimeout gets cancelled by that simulated cleanup,
    // and the second invocation sees bonusRevealShown already flipped and
    // skips rescheduling -- net result, the popup silently never fires.
    // Deliberately no cleanup on the timeout itself: this component never
    // truly unmounts during real play, and a real unmount firing one no-op
    // setShowBonusReveal afterwards is harmless.
    useEffect(() => {
        if (gameState.gameComplete && !gameState.bonusRevealShown && !bonusRevealHandledRef.current) {
            bonusRevealHandledRef.current = true;
            setGameState(prev => ({ ...prev, bonusRevealShown: true }));
            setTimeout(() => setShowBonusReveal(true), 2800);
        }
    }, [gameState.gameComplete, gameState.bonusRevealShown]);

    const dismissBonusReveal = () => setShowBonusReveal(false);

    // The Dalek-voiced "LAZARO EXISTS" line fires the moment that screen
    // actually appears (CRI ending only -- HACKER gets "TAG. YOU'RE IT."
    // instead, which isn't Lazaro's line). Keyed off showBonusReveal itself
    // rather than duplicated at both its trigger sites (the real 2800ms
    // delay and the debug harness's instant button).
    useEffect(() => {
        if (showBonusReveal && gameState.faction !== 'HACKER') speakLazaroReveal();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showBonusReveal]);

    // CINEMATIC BOOT SEQUENCE TIMING
    useEffect(() => {
        if (!gameState.hasSeenTutorial && hackerColdDropPhase === 0) {
            const t1 = setTimeout(() => setBootPhase(1), 3500);   // CRI Logo -> Timeline Protocol
            const t2 = setTimeout(() => setBootPhase(1.5), 6500); // Timeline Protocol -> Failed Flight Plan
            const t3 = setTimeout(() => setBootPhase(2), 9500);   // Failed Flight Plan -> Sandbox Menu
            return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
        } else if (hackerColdDropPhase === 0) {
            setBootPhase(3);
        }
    }, [gameState.hasSeenTutorial, hackerColdDropPhase]);

    // WELCOME BACK — a returning player (old show's save on this phone, none
    // yet for this one) gets a one-time friendly toast once Build Profile
    // appears. Their old progress never carries over into this show's
    // requirements; this is purely a greeting.
    useEffect(() => {
        if (bootPhase === 2 && isReturningPlayer && !returningWelcomeShownRef.current) {
            returningWelcomeShownRef.current = true;
            const t = setTimeout(() => showToast("WELCOME BACK, OPERATIVE. NEW ANOMALIES DETECTED.", "success"), 600);
            return () => clearTimeout(t);
        }
    }, [bootPhase, isReturningPlayer]);

    useEffect(() => {
        if (!appId) return;
        const unsubArts = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'artifacts'), snap => setArtifactsDb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubIdeas = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'ideas'), snap => setIdeasDb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubJournals = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'journals'), snap => setJournalsDb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubMatrix = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'matrix', 'layout'), snap => { if (snap.exists()) setMatrixDb(snap.data()); });
        return () => { unsubArts(); unsubIdeas(); unsubJournals(); unsubMatrix(); };
    }, []);

    const getAllItems = () => {
        const staticItems = [...Object.values(STATIC_MAIN_NODES), ...STATIC_LORE_NODES];
        if (CLOSED_LOOP_DEMO) return staticItems;
        return [...artifactsDb, ...ideasDb, ...journalsDb, ...staticItems];
    };

    // CRIME BOARD — measures actual rendered card positions (relative to the
    // board wrapper, not the viewport) so the red-string SVG lines line up
    // regardless of grid reflow/scroll. Recomputes whenever the Vault opens or
    // new items unlock.
    useLayoutEffect(() => {
        if (activeTab !== 'VAULT') return;
        const isNodeUnlocked = (id) => gameState.unlockedNodes.some(n => n.id === id) || (gameState.unlockedArtists || []).includes(id);
        const compute = () => {
            const lines = [];
            BOARD_CONNECTIONS.forEach(([aId, bId]) => {
                const aUnlocked = isNodeUnlocked(aId);
                const bUnlocked = isNodeUnlocked(bId);
                if (!aUnlocked && !bUnlocked) return;
                const aEl = boardCardRefs.current[aId];
                const bEl = boardCardRefs.current[bId];
                if (!aEl || !bEl) return;
                lines.push({
                    key: aId + '__' + bId,
                    x1: aEl.offsetLeft + aEl.offsetWidth / 2,
                    y1: aEl.offsetTop + aEl.offsetHeight / 2,
                    x2: bEl.offsetLeft + bEl.offsetWidth / 2,
                    y2: bEl.offsetTop + bEl.offsetHeight / 2,
                    solid: aUnlocked && bUnlocked
                });
            });
            setBoardLines(lines);
        };
        compute();
        const t = setTimeout(compute, 260); // catch the tab fade-in transition settling
        window.addEventListener('resize', compute);
        return () => { clearTimeout(t); window.removeEventListener('resize', compute); };
    }, [activeTab, gameState.unlockedNodes, gameState.unlockedArtists]);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search || window.location.hash.split('?')[1]);
        const scanCode = urlParams.get('scan');
        if (!scanCode) return;

        // Artist dossier tags and closed-loop static content don't depend on
        // Firestore, so they must not wait for it — venue wifi may have no
        // internet at all tonight, and artifactsDb would just never load.
        const normalized = scanCode.trim().toUpperCase();
        const isArtistTag = TEMPORAL_ARTISTS.some(a => a.scanCode === normalized);

        if (isArtistTag || CLOSED_LOOP_DEMO || artifactsDb.length > 0) {
            processScan(normalized);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, [artifactsDb]);

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    const handleReset = () => {
        if (window.confirm("WARNING: Purge device memory?")) {
            localStorage.removeItem(STORAGE_KEY);
            window.location.reload();
        }
    };

    const handlePathSelection = (pathKey) => {
        // Legacy path — profile is normally built at boot (handleProfileBuild).
        // Kept as a safety net; should be unreachable in the current flow.
        setAnimatingSelection(pathKey);
        setTimeout(() => {
            setGameState(prev => ({ ...prev, selectedPath: pathKey, hasSeenTutorial: true }));
            setAnimatingSelection(null);
            setBootPhase(3);
        }, 1500);
    };

    // BUILD YOUR PROFILE — alias + email + identity, all in one step, right at
    // the start. Submits to the same Formspree endpoint as the endgame form so
    // both land in the same inbox; the endgame form (still reachable) just
    // updates the same alias/email if someone fills it again.
    const handleProfileBuild = (pathKey) => {
        const aliasEl = document.getElementById('profileAlias');
        const emailEl = document.getElementById('profileEmail');
        const alias = aliasEl ? aliasEl.value.trim() : '';
        const email = emailEl ? emailEl.value.trim() : '';
        if (!alias || !email) return showToast("ENTER ALIAS AND FREQUENCY.", "error");

        setUserAlias(alias);
        setUserEmail(email);
        setAnimatingSelection(pathKey);

        fetch("https://formspree.io/f/xrededjy", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ alias, email, archetype: pathKey, source: 'Subject 89 — Profile Build' })
        }).catch(() => {});

        setTimeout(() => {
            setGameState(prev => ({ ...prev, selectedPath: pathKey }));
            setAnimatingSelection(null);
            setBootPhase(3);
            setShowSandbox(true); // Instructions auto-show once, right after profile build.
        }, 1500);
    };

    const getArtifactForType = (type) => {
        // Closed-loop demo: always this show's hardcoded node, never a T3S keyword
        // guess (that's how "TOM" / old-show clues were leaking through before).
        if (CLOSED_LOOP_DEMO) return STATIC_MAIN_NODES[type] || null;

        const allItems = getAllItems();
        return allItems.find(a => {
            const everything = `${a.title || ''} ${a.name || ''} ${a.location || ''} ${a.desc || ''} ${a.lore || ''} ${a.artistNotes || ''}`.toLowerCase();
            if (type === 'GUARDIAN' && (everything.includes('guardian') || everything.includes('official') || everything.includes('dshs'))) return true;
            if (type === 'DETECTIVE' && (everything.includes('detective') || everything.includes('incident') || everything.includes('evidence'))) return true;
            if (type === 'VIGILANTE' && (everything.includes('vigilante') || everything.includes('paint') || everything.includes('tag'))) return true;
            return false;
        });
    };

    const getMatrixConnections = (mediaItem) => {
        // Matrix connections are a T3S-only feature — nothing to link while closed-loop.
        if (CLOSED_LOOP_DEMO) return [];
        if (!mediaItem || !matrixDb || !matrixDb.nodes || !matrixDb.edges) return [];
        const connections = [];
        const myMatrixNodes = matrixDb.nodes.filter(n => n.dataId === mediaItem.id);
        
        myMatrixNodes.forEach(mNode => {
            const linkedEdges = matrixDb.edges.filter(e => e.source === mNode.id || e.target === mNode.id);
            linkedEdges.forEach(edge => {
                const otherNodeId = edge.source === mNode.id ? edge.target : edge.source;
                const otherNode = matrixDb.nodes.find(n => n.id === otherNodeId);
                if (otherNode) {
                    const otherItem = getAllItems().find(i => i.id === otherNode.dataId);
                    if (otherItem) {
                        const isUnlocked = gameState.unlockedNodes.some(un => un.id === otherItem.id);
                        connections.push({ item: otherItem, isUnlocked, cipherCode: edge.cipherCode });
                    }
                }
            });
        });
        return Array.from(new Map(connections.map(c => [c.item.id, c])).values());
    };

    const processScan = (rawScanCode) => {
        if (!rawScanCode) return;

        // Normalize once. The manual-entry field is only styled uppercase via CSS —
        // its actual value keeps whatever case was typed, so lowercase input used to
        // silently fail every exact-match comparison below.
        const scanCode = String(rawScanCode).trim().toUpperCase();

        // TEMPORAL ARTIST DOSSIER TAGS
        const artistHit = TEMPORAL_ARTISTS.find(a => a.scanCode === scanCode);
        if (artistHit) {
            playGlitchSound();
            setDecrypting(true);
            setTimeout(() => {
                setDecrypting(false);
                setGameState(prev => ({
                    ...prev,
                    unlockedArtists: Array.from(new Set([...(prev.unlockedArtists || []), artistHit.id]))
                }));
                setActiveArtist(artistHit);
                showToast(`DOSSIER ${artistHit.id} DECRYPTED.`, "success");
            }, 2000);
            return;
        }

        if (scanCode === 'TAG-NIGHTMARE-OVERRIDE') {
            if (gameState.gameComplete) return showToast("NO ACTIVE NODE TO OVERRIDE.", "error");
            const foundTypes = new Set(gameState.unlockedNodes.map(n => n.type));
            const nextType = MAIN_NODE_TYPES.find(t => !foundTypes.has(t));
            const targetArtifact = nextType ? getArtifactForType(nextType) : null;

            if (targetArtifact) {
                showToast("SUDO OVERRIDE ACCEPTED.", "success");
                triggerNodeUnlock(targetArtifact, nextType);
                return;
            }
        }

        if (scanCode === 'TAG-ENDGAME-OVERRIDE') {
            showToast("ENDGAME OVERRIDE ACCEPTED.", "success");
            playGlitchSound();
            setGameState(prev => ({ ...prev, gameComplete: true }));
            if (gameState.faction === 'HACKER') {
                setHackerEndPhase(1);
            }
            return;
        }

        let targetItem = null;
        let isRabbitHole = false;
        let edgeTrack = 'UNKNOWN';

        // Matrix/edge cipher lookups are T3S-only — skip entirely in closed-loop mode.
        const edges = CLOSED_LOOP_DEMO ? [] : (matrixDb?.edges || []);
        const nodes = CLOSED_LOOP_DEMO ? [] : (matrixDb?.nodes || []);

        const edge = edges.find(e => e.cipherCode && e.cipherCode.toUpperCase() === scanCode);
        if (edge) {
            const targetNode = nodes.find(n => n.id === edge.target);
            if (targetNode) {
                targetItem = getAllItems().find(i => i.id === targetNode.dataId);
                isRabbitHole = true;
                edgeTrack = edge.track;
            }
        }

        if (!targetItem) {
            targetItem = getAllItems().find(a => (a.code && a.code.toUpperCase() === scanCode) || (a.assetId && a.assetId.toUpperCase() === scanCode));
        }

        if (!targetItem) return showToast("UNRECOGNIZED ASSET SIGNATURE.", "error");

        if (gameState.unlockedNodes.some(n => n.id === targetItem.id)) {
            setActiveMedia(targetItem);
            return showToast("ASSET ALREADY IN DATA VAULT.", "success");
        }

        // Does this scan match one of the 3 main-sequence node types? Order doesn't
        // matter — whichever of GUARDIAN/DETECTIVE/VIGILANTE this is, it counts.
        if (!gameState.gameComplete) {
            const foundTypes = new Set(gameState.unlockedNodes.map(n => n.type));
            const matchedType = MAIN_NODE_TYPES.find(t => {
                if (foundTypes.has(t)) return false;
                const art = getArtifactForType(t);
                return art && art.id === targetItem.id;
            });

            if (matchedType) {
                setDecrypting(true);
                setTimeout(() => {
                    setDecrypting(false);
                    triggerNodeUnlock(targetItem, matchedType);
                }, 2500);
                return;
            }
        }

        // Random sticker or rabbit hole
        setDecrypting(true);
        setTimeout(() => {
            setDecrypting(false);
            revealUnlockedItem(targetItem, { isRabbitHole, edgeTrack });
        }, 2500);
    };

    // Every unlock — main node or random sticker — lands here once its reveal
    // delay finishes. Always shows the same plain CRI reveal underneath; the
    // hacker only ever pops up on top of it, and only for HACKER-faction players.
    const revealUnlockedItem = (targetItem, { isRabbitHole = false, edgeTrack = 'UNKNOWN', nodeType = 'MANUAL' } = {}) => {
        const isFirstEver = !gameState.hackerIntroDone;

        setGameState(prev => ({ ...prev, hasSeenTutorial: true, unlockedNodes: [...prev.unlockedNodes, { id: targetItem.id, type: nodeType, lat: targetItem.lat, lng: targetItem.lng }] }));
        setBootPhase(3);
        if (isRabbitHole) {
            setRabbitHoleItem(targetItem);
        } else {
            setActiveMedia(targetItem);
        }
        setHasNewVaultItem(true);
        showToast("ASSET DECRYPTED.", "success");

        if (isFirstEver) {
            // First unlock of the whole session — same reveal as any other, plus
            // the hacker's one-time popup asking whether to help him.
            playGlitchSound();
            setHackerIntroPhase(1);
            return;
        }

        if (gameState.faction === 'HACKER') {
            const customHackerText = targetItem.artistNotes || "";
            const lines = customHackerText ? stripHtmlToLines(customHackerText) : ["I broke the CRI encryption on this node. Adding the file to your Data Vault now."];
            setInterludeLines([isRabbitHole ? `[ DEEP MATRIX NODE: ${edgeTrack} ]` : "[ FIREWALL BYPASSED ]", ...lines]);
            setPendingInterludeMedia(targetItem);
            playGlitchSound();
            setHackerInterludePhase(1);
        }
        // faction === 'CRI': nothing further. The reveal above is the whole thing.
    };

    const triggerNodeUnlock = (targetArtifact, nodeType) => {
        const isAlreadyUnlocked = gameState.unlockedNodes.some(n => n.id === targetArtifact.id);
        if (isAlreadyUnlocked) return;

        const foundTypes = new Set([...gameState.unlockedNodes.map(n => n.type), nodeType]);
        const isComplete = MAIN_NODE_TYPES.every(t => foundTypes.has(t));
        const isFirstEver = !gameState.hackerIntroDone;

        setGameState(prev => {
            const unlockedNodes = [...prev.unlockedNodes, { id: targetArtifact.id, type: nodeType, lat: targetArtifact.lat, lng: targetArtifact.lng }];
            return { ...prev, hasSeenTutorial: true, unlockedNodes, gameComplete: isComplete };
        });
        setBootPhase(3);
        setActiveMedia(targetArtifact);
        setHasNewVaultItem(true);
        showToast("ASSET DECRYPTED.", "success");
        playGlitchSound();

        if (isFirstEver) {
            // First unlock of the whole session, whichever node it happened to be —
            // same reveal as any other, plus the hacker's one-time popup.
            setHackerIntroPhase(1);
            return;
        }

        if (isComplete) {
            if (gameState.faction === 'HACKER') {
                setHackerEndPhase(1);
                // The hacker-exclusive capstone -- no sticker, nothing to scan.
                // This is the one thing CRI-faction players never get access to.
                setGameState(prev => prev.unlockedNodes.some(n => n.id === 'static-sub89-vanish')
                    ? prev
                    : { ...prev, unlockedNodes: [...prev.unlockedNodes, { id: 'static-sub89-vanish', type: 'MANUAL', lat: VENUE.lat, lng: VENUE.lng }] });
            }
            return;
        }

        if (gameState.faction === 'HACKER') {
            const customHackerText = targetArtifact.artistNotes || "";
            const lines = customHackerText ? stripHtmlToLines(customHackerText) : ["I broke the CRI encryption on this node. Adding the file to your Data Vault now."];
            setInterludeLines([`[ NODE SECURED: ${targetArtifact.title} ]`, ...lines]);
            setPendingInterludeMedia(targetArtifact);
            setHackerInterludePhase(1);
        }
    };

    useEffect(() => {
        // NOTE: no longer gated on bootPhase — the map builds immediately so it is
        // visible behind the cinematic splash screens.
        if (activeTab !== 'MAP' || !mapRef.current) return;

        if (!mapInstance.current) {
            const center = CLOSED_LOOP_DEMO ? VENUE : SEATTLE_CENTER;
            const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([center.lat, center.lng], CLOSED_LOOP_DEMO ? 17 : 13);
            // No tile layer at all -- tonight's game is one venue, one point.
            // CARTO's dark_all basemap (used previously) needs a key CRI never had;
            // plain OpenStreetMap tiles work with no key but bring real street names
            // and full navigation detail, which fights "our own info" and doesn't
            // match the old muted-navy look. There's nothing to navigate to this
            // time anyway, so skip real map tiles entirely: CRI_GRID_BG (a CSS grid
            // + radial glow, no network request, no API key, ever) lives on the
            // *parent* wrapper (see the .leaflet-container-transparent rule in this
            // component's <style> block) rather than directly on mapRef -- setting
            // it directly on the Leaflet container gets silently overwritten by
            // Leaflet's own default background from leaflet.css. Pins/markers still
            // place normally on top -- Leaflet's positioning math doesn't depend on
            // tile images existing.
            dynamicLayer.current = L.layerGroup().addTo(map);
            mapInstance.current = map;
        }

        // Leaflet mis-measures if it mounted while overlaid; re-measure on reveal.
        setTimeout(() => mapInstance.current && mapInstance.current.invalidateSize(), 250);

        dynamicLayer.current.clearLayers();

        // Always-visible venue pin so the map isn't empty before anyone has scanned
        // anything — all of tonight's physical props are at this one location.
        if (CLOSED_LOOP_DEMO) {
            const targetSvg = (color) => `<div style="color:${color}; filter:drop-shadow(0 0 10px ${color});"><svg viewBox="0 0 24 24" fill="currentColor" class="w-9 h-9"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg></div>`;
            // Orange = not scanned yet, cyan = already unlocked (matches the unlocked-node pin color below).
            [
                { ...DSHS, id: 'static-dshs-1980' },
                { ...SHORTYS, id: 'static-boaz-smash' },
                { ...JUPITER_BAR, id: 'static-tag-signal' }
            ].forEach(loc => {
                const isUnlocked = gameState.unlockedNodes.some(n => n.id === loc.id);
                L.marker([loc.lat, loc.lng], { icon: L.divIcon({ html: targetSvg(isUnlocked ? '#06b6d4' : '#f97316'), className: 'map-overlay', iconSize: [36, 36], iconAnchor: [18, 36] }) })
                    .bindTooltip(loc.label, { permanent: false, direction: 'top' })
                    .addTo(dynamicLayer.current);
            });
        }

        const vectorPoints = [];
        gameState.unlockedNodes.forEach(node => {
            if (!node.lat || !node.lng) return;
            vectorPoints.push([node.lat, node.lng]);
            const svgHtml = `<div style="color:#06b6d4; filter:drop-shadow(0 0 10px #06b6d4);"><svg viewBox="0 0 24 24" fill="currentColor" class="w-8 h-8"><circle cx="12" cy="12" r="8"></circle></svg></div>`;
            L.marker([node.lat, node.lng], { icon: L.divIcon({ html: svgHtml, className: 'map-overlay', iconSize: [32,32], iconAnchor: [16,16] }) }).addTo(dynamicLayer.current);
        });

        if (vectorPoints.length > 1) {
            L.polyline(vectorPoints, { color: '#a855f7', weight: 4, dashArray: '10, 15', opacity: 0.8, className: 'vector-line' }).addTo(dynamicLayer.current);
        }

    }, [activeTab, gameState, artifactsDb, bootPhase]);

    // Fires the first time someone answers the hacker's YES/NO, and again on
    // every LEAK from then on. Separate Formspree hit, same inbox — cross
    // reference by alias/email against the profile-build submission.
    const submitFactionReport = (faction, extra = {}) => {
        fetch("https://formspree.io/f/xrededjy", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ alias: userAlias, email: userEmail, faction, source: 'Subject 89 — Faction Report', ...extra })
        }).catch(() => {});
    };

    // alias/email are already on file from Build Profile — nothing left here
    // needs a second signup form, this just returns whichever of the 3
    // main-sequence clues haven't been found yet (order doesn't matter).
    const getRemainingClues = () => {
        if (gameState.gameComplete) return [];
        const foundTypes = new Set(gameState.unlockedNodes.map(n => n.type));
        return MAIN_NODE_TYPES.filter(t => !foundTypes.has(t)).map(t => {
            const art = getArtifactForType(t);
            return { type: t, clue: art ? (art.desc || art.lore || "INVESTIGATE THE AREA.") : "AWAITING T3S UPLINK FOR NEXT SECTOR..." };
        });
    };

    const renderMediaModal = (mediaItem, closeFunc, isRabbitHoleModal) => {
        if (!mediaItem) return null;
        const connections = getMatrixConnections(mediaItem);

        return (
            <div className="fixed inset-0 bg-[#020617]/95 z-[4000] flex items-center justify-center p-4 backdrop-blur-xl fade-in">
                <div className={`glass-panel w-full max-w-lg p-6 rounded-lg flex flex-col max-h-[90vh] ${isRabbitHoleModal ? (mediaItem._type === 'sigil' ? 'border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.2)]' : 'border-green-500 shadow-[0_0_50px_rgba(34,197,94,0.2)]') : 'shadow-[0_0_50px_rgba(6,182,212,0.1)]'}`}>
                    <div className={`flex justify-between items-center mb-6 border-b pb-4 shrink-0 ${isRabbitHoleModal ? (mediaItem._type === 'sigil' ? 'border-red-900/50' : 'border-green-900/50') : 'border-cyan-900/30'}`}>
                        <div>
                            <h2 className={`text-lg font-bold uppercase tracking-widest flex items-center gap-2 ${isRabbitHoleModal ? (mediaItem._type === 'sigil' ? 'text-red-500' : 'text-green-500') : 'text-cyan-400'}`}>
                                {isRabbitHoleModal ? <Icons.Network size={16} /> : <Icons.Activity size={16} />} 
                                {isRabbitHoleModal ? 'DEEP MATRIX NODE' : 'ASSET RECOVERED'}
                            </h2>
                            <p className={`text-[10px] font-mono mt-1 uppercase tracking-widest ${isRabbitHoleModal ? (mediaItem._type === 'sigil' ? 'text-red-400' : 'text-green-400') : 'text-cyan-700'}`}>ID: {mediaItem.id.slice(0,8)}</p>
                        </div>
                        <button onClick={closeFunc} className="text-gray-500 hover:text-white transition-colors p-2"><Icons.X /></button>
                    </div>
                    
                    <div className="overflow-y-auto custom-scrollbar pr-2 space-y-6">
                        <h3 className="text-xl font-bold text-white">{mediaItem.title || mediaItem.name}</h3>
                        
                        {mediaItem.assignedTo && (
                            <div className="bg-blue-900/20 border border-blue-500/50 p-3 rounded flex items-center gap-2">
                                <Icons.Cpu className="text-blue-400" size={16}/>
                                <span className="text-xs font-mono text-blue-300 uppercase tracking-widest">ARTIST: {mediaItem.assignedTo}</span>
                            </div>
                        )}

                        {mediaItem.imageUrl && <img src={mediaItem.imageUrl} alt="Asset" className="w-full rounded border border-gray-800 shadow-lg" />}
                        {mediaItem.videoUrl && <video src={mediaItem.videoUrl} controls autoPlay className="w-full rounded border border-gray-800 shadow-lg" />}
                        {mediaItem.audioUrl && <audio src={mediaItem.audioUrl} controls className="w-full" />}
                        
                        <div className="text-sm text-gray-300 font-mono leading-relaxed bg-black/40 p-4 rounded border border-white/5">
                            {mediaItem.text ? <div dangerouslySetInnerHTML={{ __html: mediaItem.text }} /> : mediaItem.lore || mediaItem.desc ? <div dangerouslySetInnerHTML={{ __html: mediaItem.lore || mediaItem.desc }} /> : <p className="italic text-gray-600">No text data found in this asset.</p>}
                        </div>

                        {connections.length > 0 && (
                            <div className="mt-6 border-t border-gray-800 pt-4">
                                <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2"><Icons.Network size={12} /> MATRIX CONNECTIONS</h4>
                                <div className="space-y-2">
                                    {connections.map((conn, idx) => (
                                        conn.isUnlocked ? (
                                            <button key={idx} onClick={() => { closeFunc(); setTimeout(() => isRabbitHoleModal ? setRabbitHoleItem(conn.item) : setActiveMedia(conn.item), 100); }} className="w-full text-left p-3 bg-[#00ff41]/10 border border-[#00ff41]/50 hover:bg-[#00ff41]/20 transition-colors rounded flex items-center gap-2">
                                                <Icons.Unlock size={14} className="text-[#00ff41] shrink-0" />
                                                <span className="text-xs font-bold text-[#00ff41] truncate">{conn.item.title || conn.item.name}</span>
                                            </button>
                                        ) : (
                                            <div key={idx} className="w-full text-left p-3 bg-red-900/20 border border-red-500/30 rounded flex items-center gap-2">
                                                <Icons.Lock size={14} className="text-red-500 shrink-0" />
                                                <span className="text-xs font-mono text-red-400 truncate">[ ENCRYPTED LINK DETECTED ]</span>
                                            </div>
                                        )
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <button onClick={closeFunc} className={`mt-6 shrink-0 w-full py-4 font-bold uppercase tracking-widest text-xs transition-colors rounded border ${isRabbitHoleModal ? 'bg-black border-gray-600 text-gray-400 hover:text-white' : 'bg-cyan-950/30 border-cyan-800 hover:bg-cyan-900 text-cyan-400'}`}>
                        CLOSE CONNECTION
                    </button>
                </div>
            </div>
        );
    };

    // SHOW KILL SWITCH — short-circuits the whole game render. Placed after
    // every hook above so hook order never changes between renders; only
    // the JSX output branches here.
    if (!SHOW_LIVE) {
        return (
            <div className="h-[100dvh] w-full bg-[#020617] text-white font-sans flex flex-col items-center justify-center p-6 text-center gap-6">
                <CRILogo className="w-24 h-24 text-white/70" />
                <div>
                    <h1 className="text-xl font-black tracking-widest uppercase text-cyan-400">Timeline Protocol</h1>
                    <p className="mt-3 text-sm text-gray-400 font-mono max-w-sm mx-auto leading-relaxed">
                        This anomaly has been logged and closed for now. Thanks for playing — follow
                        @boblovesdoors for the next one.
                    </p>
                </div>
                <a href={STRIPE_LINK} target="_blank" rel="noopener noreferrer" className="px-6 py-3 border-2 border-cyan-500 text-black bg-cyan-400 hover:bg-black hover:text-cyan-400 font-black font-mono text-xs uppercase transition-colors shadow-[0_0_15px_rgba(6,182,212,0.5)] rounded">
                    Support the Catalyst
                </a>
            </div>
        );
    }

    return (
        <div className="h-[100dvh] w-full bg-[#020617] text-white font-sans overflow-hidden flex flex-col">
            <style>{`
                .glass-panel { background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(12px); border: 1px solid rgba(6, 182, 212, 0.2); }
                .text-shadow-glow { text-shadow: 0 0 8px currentColor; }
                .progress-bar { width: 100%; height: 2px; background: rgba(6, 182, 212, 0.2); overflow: hidden; position: relative; }
                .progress-bar::after { content: ''; position: absolute; top: 0; left: 0; height: 100%; width: 50%; background: #06b6d4; animation: scan 1.5s infinite linear; box-shadow: 0 0 10px #06b6d4; }
                @keyframes scan { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
                
                .hacker-bg {
                    background-color: #050505;
                    background-image:
                        repeating-linear-gradient(0deg, rgba(0,255,65,0.07) 0px, rgba(0,255,65,0.07) 1px, transparent 1px, transparent 3px),
                        radial-gradient(rgba(0, 255, 65, 0.15) 1px, transparent 1px);
                    background-size: 100% 4px, 20px 20px;
                    animation: hackerFlicker 4s steps(1) infinite, scanlineDrift 5s linear infinite;
                }
                .hacker-bg::before {
                    content: '';
                    position: absolute; inset: 0;
                    background-image: radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px);
                    background-size: 3px 3px;
                    animation: staticNoise 0.15s steps(1) infinite;
                    pointer-events: none;
                }
                @keyframes scanlineDrift { from { background-position: 0 0, 0 0; } to { background-position: 0 200px, 0 0; } }
                @keyframes staticNoise { 0% { background-position: 0 0; } 25% { background-position: 3px 1px; } 50% { background-position: -2px 3px; } 75% { background-position: 1px -3px; } 100% { background-position: 0 0; } }
                @keyframes hackerFlicker { 0%, 91%, 100% { opacity: 1; } 92% { opacity: 0.82; } 93% { opacity: 1; } 96% { opacity: 0.88; } 97% { opacity: 1; } }

                /* "Hackery" glitch text — chromatic-fringe flicker for the hacker's own box */
                .glitch-text { animation: glitchShift 2.4s steps(1) infinite; }
                @keyframes glitchShift {
                    0%, 88%, 100% { text-shadow: none; transform: rotate(-1deg) translate(0,0); }
                    89% { text-shadow: -2px 0 #ef4444, 2px 0 #06b6d4; transform: rotate(-1deg) translate(-2px,0); }
                    90% { text-shadow: 2px 0 #ef4444, -2px 0 #06b6d4; transform: rotate(-1deg) translate(2px,0); }
                    91% { text-shadow: none; transform: rotate(-1deg) translate(0,0); }
                }
                .hacker-text { color: #00ff41; font-family: monospace; text-shadow: 0 0 5px #00ff41; }

                /* CINEMATIC TITLE SEQUENCE */
                .title-card { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-weight: 900; font-size: clamp(3.2rem, 19vw, 9rem); line-height: 0.86; letter-spacing: -0.02em; text-transform: uppercase; text-shadow: 0 0 40px rgba(234,179,8,0.45), 0 6px 0 rgba(0,0,0,0.6); animation: titlePunch 0.9s cubic-bezier(0.16, 1, 0.3, 1) both; }
                @keyframes titlePunch { 0% { opacity: 0; transform: scale(1.18); letter-spacing: 0.12em; } 100% { opacity: 1; transform: scale(1); letter-spacing: -0.02em; } }
                .letterbox-top, .letterbox-bottom { height: 8vh; animation: letterbox 1.2s ease-out both; }
                @keyframes letterbox { from { height: 0; } to { height: 8vh; } }

                .rupture-bg { background-color: #0a0000; background-image: radial-gradient(rgba(239, 68, 68, 0.18) 1px, transparent 1px); background-size: 20px 20px; backdrop-filter: blur(6px); animation: rupturePulse 3s ease-in-out infinite; }
                @keyframes rupturePulse { 0%, 100% { box-shadow: inset 0 0 120px rgba(239,68,68,0.15); } 50% { box-shadow: inset 0 0 200px rgba(239,68,68,0.35); } }
                
                .jarring-text { font-family: 'Impact', 'Arial Black', sans-serif; font-weight: 900; text-transform: uppercase; letter-spacing: 0.1em; transform: scaleY(1.4) skewX(-4deg); text-shadow: 3px 3px 0px rgba(255,0,60,0.7), -3px -3px 0px rgba(0,234,255,0.7); color: #fff; }

                .typewriter { overflow: hidden; border-right: .15em solid #00ff41; white-space: nowrap; margin: 0 auto; letter-spacing: .15em; animation: typing 2.5s steps(40, end), blink-caret .75s step-end infinite; }
                @keyframes typing { from { width: 0 } to { width: 100% } }
                @keyframes blink-caret { from, to { border-color: transparent } 50% { border-color: #00ff41; } }

                .screen-tear { animation: tear 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) both infinite; }
                @keyframes tear {
                    0% { clip-path: inset(10% 0 80% 0); transform: translateX(-10px); }
                    20% { clip-path: inset(80% 0 5% 0); transform: translateX(10px); }
                    40% { clip-path: inset(40% 0 40% 0); transform: translateX(-10px); }
                    60% { clip-path: inset(20% 0 60% 0); transform: translateX(10px); }
                    80% { clip-path: inset(60% 0 20% 0); transform: translateX(-10px); }
                    100% { clip-path: inset(0 0 0 0); transform: translateX(0); }
                }

                @keyframes shatter { 0% { transform: scale(1); filter: blur(0px); opacity: 1; } 20% { transform: scale(1.4) translate(-5px, 5px) skewX(20deg); filter: blur(2px); opacity: 0.8; } 100% { transform: scale(1) translate(0,0); opacity: 1; } }
                .shatter-effect { animation: shatter 1.5s ease-out forwards; z-index: 50; position: relative; }

                /* Draws the eye to the profile buttons so people tap instead of reading first. */
                @keyframes profilePulse {
                    0%, 100% { box-shadow: 0 0 0 0 var(--pulse-color, rgba(6,182,212,0.55)), 0 0 12px 2px var(--pulse-color, rgba(6,182,212,0.35)); }
                    50% { box-shadow: 0 0 0 6px transparent, 0 0 22px 6px var(--pulse-color, rgba(6,182,212,0.55)); }
                }
                .profile-pulse { animation: profilePulse 1.6s ease-in-out infinite; }
                @keyframes tapBounce { 0%, 100% { transform: translateY(0); opacity: 0.9; } 50% { transform: translateY(4px); opacity: 0.5; } }
                .tap-hint { animation: tapBounce 1.2s ease-in-out infinite; }
                .vector-line { animation: dash 20s linear infinite; }
                @keyframes dash { to { stroke-dashoffset: -1000; } }
                /* Originally masked gaps between loading tiles with navy instead of
                   Leaflet's default white/gray -- now that there's no tile layer at
                   all (see the map-init effect), that same solid fill would just
                   permanently hide CRI_GRID_BG sitting on the parent behind it, so
                   it's transparent instead. */
                .leaflet-container { background: transparent !important; font-family: 'Inter', sans-serif; }
                
                .fade-in-seq-1 { animation: fadeIn 1s ease-in forwards; }
                .fade-in-seq-2 { opacity: 0; animation: fadeIn 1s ease-in 1s forwards; }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            `}</style>

            {/* TOAST — brief bottom-center confirmation/error strip for showToast().
                Was previously set into state with no render block anywhere, so
                every scan confirmation/error in the live game was silently
                invisible to players. */}
            {toast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-lg border font-mono text-xs font-bold uppercase tracking-widest text-center shadow-lg fade-in pointer-events-none"
                     style={toast.type === 'error'
                         ? { background: 'rgba(2,6,23,0.95)', borderColor: '#ef4444', color: '#f87171' }
                         : { background: 'rgba(2,6,23,0.95)', borderColor: '#22d3ee', color: '#67e8f9' }}>
                    {toast.message}
                </div>
            )}

            {/* ==========================================
                CINEMATIC TITLE SEQUENCE
                Three cards over the live map: CRI ident -> game logo -> title card.
                Backdrop opacity steps down each card so the city fades up underneath.
                ========================================== */}
            {bootPhase < 2 && hackerColdDropPhase === 0 && (
                <div className="fixed inset-0 z-[9999] pointer-events-none">
                    {/* Letterbox bars */}
                    <div className="absolute top-0 left-0 right-0 bg-black z-20 letterbox-top" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black z-20 letterbox-bottom" />

                    {/* BOOT 0: CRI IDENT — opens on solid black like a studio card */}
                    <div className={`absolute inset-0 flex flex-col items-center justify-center p-6 transition-all duration-1000 ${bootPhase === 0 ? 'opacity-100' : 'opacity-0'}`}
                         style={{ background: '#020617' }}>
                        <div className="fade-in-seq-1 mb-8">
                            <CRILogo className="w-48 h-48 md:w-64 md:h-64 text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]" />
                        </div>
                        <h1 className="fade-in-seq-2 text-2xl md:text-3xl font-sans font-black text-white tracking-[0.2em] text-center mt-4">WE ARE HERE TO HELP</h1>
                    </div>

                    {/* BOOT 1: GAME LOGO — city starts bleeding through */}
                    <div className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-1000 ${bootPhase === 1 ? 'opacity-100' : 'opacity-0'}`}
                         style={{ background: 'radial-gradient(ellipse at center, rgba(2,6,23,0.72) 0%, rgba(2,6,23,0.94) 70%)', backdropFilter: 'blur(3px)' }}>
                        <h1 className="text-4xl md:text-6xl text-center px-4 jarring-text mb-12">TIMELINE<br/>PROTOCOL</h1>
                        <Icons.Activity size={80} className="text-cyan-500 mt-8 animate-pulse" />
                    </div>

                    {/* BOOT 1.5: TITLE CARD — three lines, heavy sans, yellow */}
                    <div className={`absolute inset-0 flex flex-col items-center justify-center px-6 transition-all duration-1000 ${bootPhase === 1.5 ? 'opacity-100' : 'opacity-0'}`}
                         style={{ background: 'radial-gradient(ellipse at center, rgba(2,6,23,0.55) 0%, rgba(2,6,23,0.9) 75%)', backdropFilter: 'blur(2px)' }}>
                        <h1 className="title-card text-yellow-400 text-center">
                            <span className="block">SUBJECT</span>
                            <span className="block">89</span>
                        </h1>
                        <p className="mt-8 text-[10px] md:text-xs font-mono text-yellow-600/80 uppercase tracking-[0.4em] text-center">
                            Capitol Hill &nbsp;//&nbsp; Sandbox
                        </p>
                    </div>
                </div>
            )}

            {/* BOOT SEQUENCE 2: BUILD YOUR PROFILE — alias + email + identity, all at once */}
            {bootPhase === 2 && hackerColdDropPhase === 0 && !showSandbox && (
                <div className="fixed inset-0 bg-[#020617]/95 z-[9000] flex items-center justify-center p-4 backdrop-blur-xl fade-in overflow-y-auto">
                    <div className="glass-panel w-full max-w-lg p-8 rounded-lg shadow-[0_0_50px_rgba(6,182,212,0.1)] flex flex-col gap-5 text-center my-auto relative">
                        <h2 className="text-2xl font-black text-white tracking-widest flex items-center justify-center gap-2">
                            <Icons.Activity className="text-cyan-500" /> BUILD YOUR PROFILE
                        </h2>
                        <p className="text-xs text-gray-400 font-mono">Register as a field operative, then pick your identity.</p>

                        <div className="flex flex-col gap-3">
                            <input id="profileAlias" type="text" placeholder="OPERATIVE ALIAS" className="w-full p-4 bg-black/50 border border-cyan-900/50 text-cyan-300 font-mono text-center uppercase focus:border-cyan-500 outline-none rounded" />
                            <input id="profileEmail" type="email" placeholder="SECURE FREQUENCY (EMAIL)" className="w-full p-4 bg-black/50 border border-cyan-900/50 text-cyan-300 font-mono text-center focus:border-cyan-500 outline-none rounded" />
                        </div>

                        <div className="grid grid-cols-3 gap-2 md:gap-4 mt-2">
                            {['GUARDIAN', 'DETECTIVE', 'VIGILANTE'].map(pathKey => {
                                const config = NODE_CONFIG[pathKey];
                                const isAnimating = animatingSelection === pathKey;
                                const isHidden = animatingSelection && animatingSelection !== pathKey;
                                return (
                                    <button key={pathKey} onClick={() => handleProfileBuild(pathKey)} disabled={!!animatingSelection} style={{ '--pulse-color': `${config.color}99` }} className={`p-3 md:p-4 glass-panel hover:bg-white/5 transition-all duration-500 flex flex-col items-center gap-2 rounded ${isHidden ? 'opacity-0 scale-90' : 'opacity-100'} ${isAnimating ? 'shatter-effect' : !animatingSelection ? 'profile-pulse' : ''}`}>
                                        <div style={{ color: config.color }} dangerouslySetInnerHTML={{ __html: config.icon }} className="w-8 h-8 drop-shadow-md" />
                                        <span className="text-[11px] font-black uppercase tracking-widest text-white">{config.profile.replace('THE ', '')}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* SANDBOX!/INFO PANEL — instructions, shown once automatically after profile build,
                reopenable anytime via the header button. Donate + artist unlocks now live
                in the Archive (Data Vault) instead of a separate Sandbox screen. */}
            {showSandbox && (
                <div className="fixed inset-0 bg-[#020617]/95 z-[9500] flex items-center justify-center p-4 backdrop-blur-xl fade-in">
                    <div className="glass-panel w-full max-w-lg p-6 rounded-lg shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col max-h-[90vh]">
                        <div className="flex justify-between items-start mb-4 border-b border-cyan-900/40 pb-4 shrink-0">
                            <div>
                                <h2 className="text-xl font-black text-cyan-400 tracking-widest flex items-center gap-2">
                                    <Icons.Activity size={18} /> SANDBOX / HELP
                                </h2>
                                <p className="text-[10px] font-mono text-cyan-700 mt-1 tracking-widest uppercase">
                                    SECTOR: CAPITOL HILL &nbsp;//&nbsp; EVENT: BOB'S DOORS &mdash; SUBJECT 89
                                </p>
                            </div>
                            <button onClick={() => { setGameState(prev => ({ ...prev, hasSeenTutorial: true })); setShowSandbox(false); }} className="text-cyan-500 hover:text-white transition-colors p-2"><Icons.X /></button>
                        </div>

                        <div className="overflow-y-auto custom-scrollbar pr-2 space-y-4">
                            <p className="text-xs text-gray-300 font-mono text-center leading-relaxed">Find the doors. Log the anomalies. Close the loop.</p>
                            <ul className="space-y-3 text-sm text-gray-300 font-mono leading-relaxed text-left">
                                <li><strong className="text-cyan-400">1. FOLLOW THE MAP:</strong> Track your active clue.</li>
                                <li><strong className="text-cyan-400">2. SCAN OR TAP:</strong> Tap a CRI sticker with your phone, or open MANUAL SCAN and type the code by hand — either works.</li>
                                <li><strong className="text-cyan-400">3. CLOSE THE LOOP:</strong> Find every document. Everything you find lives in the Archive (Data Vault tab) — artists included.</li>
                            </ul>

                            <a href={STRIPE_LINK} target="_blank" rel="noopener noreferrer" className="block w-full text-center py-3 border-2 border-cyan-500 text-black bg-cyan-400 hover:bg-black hover:text-cyan-400 font-black font-mono text-xs uppercase transition-colors shadow-[0_0_15px_rgba(6,182,212,0.5)] rounded">
                                DONATE TO THE CATALYST (Suggested $20)
                            </a>
                            <a href="https://cascadiaresonance.org" target="_blank" rel="noopener noreferrer" className="block w-full text-center py-3 border border-white/20 text-gray-300 hover:text-white hover:border-white/40 font-mono text-[10px] uppercase transition-colors rounded">
                                QUESTIONS? VISIT CRI'S OFFICIAL SITE
                            </a>
                        </div>

                        <button onClick={() => { setGameState(prev => ({ ...prev, hasSeenTutorial: true })); setShowSandbox(false); }} className="mt-6 shrink-0 w-full py-4 border-2 border-cyan-600 text-cyan-400 hover:bg-cyan-600 hover:text-black font-black font-mono text-xs uppercase tracking-widest transition-colors rounded">
                            ACCEPT DIRECTIVES
                        </button>
                    </div>
                </div>
            )}

            {/* HELP US — the honest, out-of-character pitch. Reached from the endgame. */}
            {showHelpUs && (
                <div className="fixed inset-0 bg-[#020617]/95 z-[9800] flex items-center justify-center p-4 backdrop-blur-xl fade-in overflow-y-auto">
                    <div className="glass-panel w-full max-w-lg p-6 rounded-lg flex flex-col max-h-[90vh] my-auto">
                        <div className="flex justify-between items-start mb-4 border-b border-cyan-900/40 pb-4 shrink-0">
                            <h2 className="text-xl font-black text-cyan-400 tracking-widest flex items-center gap-2">
                                <Icons.Activity size={18} /> HELP US
                            </h2>
                            <button onClick={() => setShowHelpUs(false)} className="text-cyan-500 hover:text-white transition-colors p-2"><Icons.X /></button>
                        </div>

                        <div className="overflow-y-auto custom-scrollbar pr-2 space-y-4 text-sm text-gray-300 leading-relaxed">
                            <p>We're a nonprofit doing this for the love of our community. Tonight is just a demo — we're building toward a fully immersive, city-wide experience, and we can't get there without help.</p>

                            <div>
                                <p className="text-cyan-400 text-xs font-bold uppercase tracking-widest mb-2">What we're raising for</p>
                                <ul className="list-disc list-inside space-y-1 text-gray-300">
                                    <li>A homebase — rent and building materials</li>
                                    <li>Props, paint, and technology</li>
                                    <li>Paying our artists, musicians, actors, writers, developers, builders, testers, photographers, videographers, sound designers, producers, and directors</li>
                                    <li>More doors</li>
                                </ul>
                            </div>

                            <a href={STRIPE_LINK} target="_blank" rel="noopener noreferrer" className="block w-full text-center py-3 border-2 border-cyan-500 text-black bg-cyan-400 hover:bg-black hover:text-cyan-400 font-black font-mono text-xs uppercase transition-colors shadow-[0_0_15px_rgba(6,182,212,0.5)] rounded">
                                DONATE TO THE CATALYST
                            </a>

                            <p className="text-xs text-gray-400">
                                Want to support the project another way? Email <a href="mailto:nick@catalyst-art.org" className="text-cyan-400 hover:underline">nick@catalyst-art.org</a> — we'd love to hear from you.
                            </p>

                            <p className="text-sm text-white font-bold text-center pt-2">Thank you for playing.</p>
                        </div>

                        <button onClick={() => setShowHelpUs(false)} className="mt-6 shrink-0 w-full py-4 border-2 border-cyan-600 text-cyan-400 hover:bg-cyan-600 hover:text-black font-black font-mono text-xs uppercase tracking-widest transition-colors rounded">
                            CLOSE
                        </button>
                    </div>
                </div>
            )}

            {/* TEMPORAL ARTIST DOSSIER */}
            {activeArtist && (
                <div className="fixed inset-0 bg-[#020617]/95 z-[9700] flex items-center justify-center p-4 backdrop-blur-xl fade-in overflow-y-auto">
                    <div className="glass-panel w-full max-w-lg p-6 rounded-lg flex flex-col max-h-[90vh] my-auto" style={{ borderColor: activeArtist.color }}>
                        <div className="flex justify-between items-start gap-3 mb-5 border-b pb-4 shrink-0" style={{ borderColor: `${activeArtist.color}40` }}>
                            <div className="min-w-0">
                                <p className="text-[9px] font-mono uppercase tracking-widest" style={{ color: activeArtist.color }}>
                                    TAG DOSSIER {activeArtist.id} &mdash; DECRYPTED
                                </p>
                                <h2 className="text-xl font-black text-white tracking-wide mt-1 truncate">{activeArtist.name}</h2>
                                <p className="text-xs font-mono mt-1 uppercase tracking-widest" style={{ color: activeArtist.color }}>{activeArtist.alias}</p>
                            </div>
                            <button onClick={() => setActiveArtist(null)} className="text-gray-500 hover:text-white transition-colors p-2 shrink-0"><Icons.X /></button>
                        </div>

                        <div className="overflow-y-auto custom-scrollbar pr-2 space-y-5 text-[12px] font-mono text-gray-300 leading-relaxed">
                            <div className="space-y-1">
                                <p className="text-[9px] uppercase tracking-widest text-gray-500">ROLE</p>
                                <p className="text-white">{activeArtist.role}</p>
                                <p className="text-[10px] mt-2" style={{ color: activeArtist.color }}>{activeArtist.affiliation}</p>
                                {activeArtist.affiliationWarn && (
                                    <p className="text-[10px] text-red-400 flex items-center gap-1.5">
                                        <Icons.AlertTriangle size={11} /> {activeArtist.affiliationWarn}
                                    </p>
                                )}
                            </div>

                            <div className="space-y-2 border-t border-white/10 pt-4">
                                <p className="text-[9px] uppercase tracking-widest text-gray-500">FIELD ASSESSMENT</p>
                                {activeArtist.bio.map((p, i) => <p key={i}>{p}</p>)}
                            </div>

                            <div className="space-y-2 border-t border-white/10 pt-4">
                                <p className="text-[9px] uppercase tracking-widest text-gray-500">ESOTERIC TOOL</p>
                                <p className="text-white font-bold">{activeArtist.tool}</p>
                                {activeArtist.toolLore.map((p, i) => <p key={i}>{p}</p>)}
                            </div>

                            <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
                                <a href={activeArtist.instagram} target="_blank" rel="noopener noreferrer" className="flex-1 text-center text-[10px] font-mono py-3 rounded border transition-colors" style={{ borderColor: activeArtist.color, color: activeArtist.color }}>
                                    {activeArtist.instagramHandle}
                                </a>
                                {activeArtist.website && (
                                    <a href={activeArtist.website} target="_blank" rel="noopener noreferrer" className="flex-1 text-center text-[10px] font-mono py-3 rounded border transition-colors" style={{ borderColor: activeArtist.color, color: activeArtist.color }}>
                                        WEBSITE
                                    </a>
                                )}
                            </div>
                        </div>

                        <button onClick={() => setActiveArtist(null)} className="mt-5 shrink-0 w-full py-4 rounded border border-gray-700 bg-black text-gray-400 hover:text-white font-bold uppercase tracking-widest text-xs transition-colors">
                            CLOSE DOSSIER
                        </button>
                    </div>
                </div>
            )}

            {/* STREET-FIRST HACKER COLD DROP */}
            {hackerColdDropPhase > 0 && (
                <div className={`fixed inset-0 z-[9500] hacker-bg flex flex-col items-center justify-center p-6 ${hackerColdDropPhase === 1 ? 'screen-tear' : 'fade-in'}`}>
                    {hackerColdDropPhase >= 2 && (
                        <div className="w-full max-w-md border border-[#00ff41] bg-black/90 p-8 shadow-[0_0_30px_rgba(0,255,65,0.2)]">
                            <div className="text-5xl mb-6 text-center animate-pulse select-none" style={{ filter: 'drop-shadow(0 0 10px #00ff41)' }}>🐈‍⬛</div>
                            <TypewriterText 
                                lines={[
                                    "[ UNREGISTERED DEVICE DETECTED ]",
                                    "I like your style. I'm hijacking your scanner.",
                                    "Read the file, then pick a profile on the map."
                                ]} 
                                onComplete={() => setHackerColdDropPhase(3)} 
                            />
                            {hackerColdDropPhase === 3 && (
                                <button onClick={() => {
                                    setGameState(prev => ({ ...prev, hackerIntroDone: true, unlockedNodes: [...prev.unlockedNodes, { id: pendingColdDropMedia.id, type: 'MANUAL', lat: pendingColdDropMedia.lat, lng: pendingColdDropMedia.lng }] }));
                                    setHackerColdDropPhase(0);
                                    setActiveMedia(pendingColdDropMedia);
                                    setHasNewVaultItem(true);
                                }} className="mt-8 fade-in w-full py-4 border border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-black font-bold font-mono text-xs uppercase transition-colors">
                                    ACCEPT OVERRIDE
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* HACKER FIRST-CONTACT CHOICE — fires once, the first time any node is
                unlocked (main or bonus, whichever comes first). Pops up over the
                same plain reveal every other unlock gets; not a takeover. */}
            {hackerIntroPhase > 0 && !gameState.hackerIntroDone && hackerColdDropPhase === 0 && (
                <div className="fixed inset-0 z-[8000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 fade-in">
                    <div className="relative w-full max-w-md rounded-lg overflow-hidden border border-[#00ff41]/60 shadow-[0_0_35px_rgba(0,255,65,0.35)] glitch-text">
                        <div className="flex items-center gap-3 px-4 py-3 bg-black border-b border-[#00ff41]/30">
                            <span className="text-2xl leading-none select-none">🐈‍⬛</span>
                            <div>
                                <p className="text-[#00ff41] text-sm font-black tracking-widest">C@T@LY$T</p>
                                <p className="text-[#00ff41]/60 text-[9px] uppercase tracking-widest flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#00ff41] animate-pulse inline-block" /> connected
                                </p>
                            </div>
                        </div>
                        <div className="bg-[#050505] p-6">
                            <TypewriterText
                                lines={[
                                    "The CRI is not here to help. I've breached their firewall.",
                                    "Will you help him?"
                                ]}
                                onComplete={() => setHackerIntroPhase(2)}
                            />
                            {hackerIntroPhase === 2 && (
                                <div className="mt-8 fade-in">
                                    {hackerBreachChoice === 'REPORTED' ? (
                                        <p className="text-center font-mono text-red-500 font-black text-sm uppercase tracking-widest animate-pulse">ERROR REPORT RECEIVED</p>
                                    ) : hackerBreachChoice === 'PENDING_NO' ? (
                                        <button onClick={() => {
                                            submitFactionReport('CRI');
                                            setHackerBreachChoice('REPORTED');
                                            setTimeout(() => {
                                                setGameState(prev => ({ ...prev, hackerIntroDone: true, faction: 'CRI' }));
                                                setHackerIntroPhase(0);
                                            }, 1200);
                                        }} className="w-full py-4 border-2 border-cyan-500 text-cyan-400 hover:bg-cyan-500 hover:text-black font-bold font-mono text-xs uppercase transition-colors rounded">
                                            REPORT ERROR
                                        </button>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-3">
                                            <button onClick={() => {
                                                submitFactionReport('HACKER');
                                                setGameState(prev => ({ ...prev, hackerIntroDone: true, faction: 'HACKER' }));
                                                setHackerIntroPhase(0);
                                            }} className="py-5 border-2 border-red-500 bg-red-600 text-white hover:bg-red-500 font-black font-mono text-sm uppercase transition-colors rounded animate-pulse shadow-[0_0_20px_rgba(220,38,38,0.7)]">
                                                YES
                                            </button>
                                            <button onClick={() => setHackerBreachChoice('PENDING_NO')} className="py-5 border-2 border-blue-500 text-blue-400 hover:bg-blue-500 hover:text-black font-bold font-mono text-sm uppercase transition-colors rounded">
                                                NO
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* HACKER INTERLUDE (Mid-Game Unlocks) — HACKER faction only. Pops up over
                the reveal that's already open; dismissing it just closes the popup,
                the same CRI reveal card stays put underneath. */}
            {hackerInterludePhase > 0 && gameState.faction === 'HACKER' && (
                <div className="fixed inset-0 z-[7000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 fade-in">
                    <div className="w-full max-w-md border border-[#00ff41] bg-black/95 p-8 rounded-lg shadow-[0_0_30px_rgba(0,255,65,0.3)]">
                        <div className="text-5xl mb-6 text-center animate-pulse select-none" style={{ filter: 'drop-shadow(0 0 10px #00ff41)' }}>🐈‍⬛</div>
                        <TypewriterText
                            lines={interludeLines}
                            onComplete={() => setHackerInterludePhase(2)}
                        />
                        {hackerInterludePhase === 2 && (
                            <div className="mt-8 fade-in space-y-3">
                                {pendingInterludeMedia && (
                                    <button onClick={() => { submitFactionReport('HACKER', { leaked: pendingInterludeMedia.code || pendingInterludeMedia.id }); showToast("LEAKED TO C@T@LY$T.", "success"); }} className="w-full py-3 border-2 border-red-600 text-red-500 hover:bg-red-600 hover:text-black font-bold font-mono text-xs uppercase transition-colors rounded">
                                        [ LEAK TO C@T@LY$T ]
                                    </button>
                                )}
                                <button onClick={() => setHackerInterludePhase(0)} className="w-full py-4 border border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-black font-bold font-mono text-xs uppercase transition-colors">
                                    BACK TO CRI FEED
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* END GAME — HACKER-ONLY POPUP. CRI-faction players never see this; their
                ending is the badge shown inline on the CRI map page. Dismissing this
                popup drops back to that same CRI page underneath. */}
            {hackerEndPhase > 0 && gameState.faction === 'HACKER' && gameState.gameComplete && (
                <div className="fixed inset-0 z-[6000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 overflow-y-auto fade-in">
                    <div className="w-full max-w-md border border-[#00ff41] bg-black/95 p-8 rounded-lg shadow-[0_0_30px_rgba(0,255,65,0.3)] my-auto">
                        <div className="text-5xl mb-6 text-center animate-pulse select-none" style={{ filter: 'drop-shadow(0 0 10px #00ff41)' }}>🐈‍⬛</div>
                        <TypewriterText
                            lines={[
                                "[ FIREWALL BYPASSED ]",
                                "Three nodes secured. Bob is safe.",
                                `Great work, ${userAlias || 'operative'} — we couldn't have done it without you.`
                            ]}
                            onComplete={() => setHackerEndPhase(2)}
                        />
                        {hackerEndPhase === 2 && (
                            <div className="fade-in">
                                <a href={STRIPE_LINK} target="_blank" rel="noopener noreferrer" className="block w-full text-center py-3 mt-4 mb-2 border-2 border-[#00ff41] text-black bg-[#00ff41] hover:bg-black hover:text-[#00ff41] font-black font-mono text-sm uppercase transition-colors shadow-[0_0_15px_rgba(0,255,65,0.5)]">
                                    [ FUND THE OPERATION ]
                                </a>
                                <button onClick={() => setShowHelpUs(true)} className="block w-full text-center py-2 mb-4 text-[#00ff41]/70 hover:text-[#00ff41] font-mono text-[10px] uppercase tracking-widest underline underline-offset-2">
                                    why we're asking — help us
                                </button>
                                <p className="font-mono text-[#00ff41] text-sm mb-6 text-shadow-glow">
                                    We'll analyze from here and let you know what the next move is.<br/><br/>
                                    Add our IG page <span className="font-bold">@boblovesdoors</span> &amp; tag us in any photos you took!
                                </p>

                                <div className="border-2 border-[#00ff41] bg-black p-6 rounded-lg shadow-[0_0_35px_rgba(0,255,65,0.5)] text-center">
                                    <p className="text-[#00ff41] font-black text-base leading-snug uppercase" style={{textShadow: '0 0 10px #00ff41, 0 0 22px #00ff41'}}>
                                        I helped Bob hack the planet at Subject 89 2026 and all I got was this lousy screenshot!
                                    </p>
                                    <div className="text-7xl my-4 select-none" style={{ filter: 'drop-shadow(0 0 12px #00ff41)' }}>🐈‍⬛</div>
                                    <p className="text-[#00ff41] text-[10px] font-mono uppercase tracking-[0.3em]">Timeline Protocol</p>
                                </div>

                                <button onClick={() => setHackerEndPhase(0)} className="w-full py-4 mt-4 border border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-black font-bold font-mono text-xs uppercase transition-colors rounded">
                                    BACK TO CRI FEED
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* BONUS REVEAL — fires once, a couple seconds after full completion,
                regardless of faction. Sits above everything (even the hacker end
                popup) since it's the last word either way. Tap anywhere to dismiss. */}
            {showBonusReveal && (
                <div onClick={dismissBonusReveal} className="fixed inset-0 z-[9800] rupture-bg flex flex-col items-center justify-center p-6 fade-in cursor-pointer">
                    {gameState.faction === 'HACKER' ? (
                        <h1 className="jarring-text text-5xl md:text-8xl text-center leading-tight" style={{ color: '#00ff41' }}>
                            TAG.<br/>YOU'RE IT.
                        </h1>
                    ) : (
                        <h1 className="jarring-text text-5xl md:text-7xl text-center leading-tight" style={{ color: '#22d3ee' }}>
                            L.A.Z.A.R.O.<br/>EXISTS.
                        </h1>
                    )}
                    <p className="mt-10 font-mono text-[10px] text-white/50 uppercase tracking-[0.3em] animate-pulse">Tap to dismiss</p>
                </div>
            )}

            {decrypting && !gameState.gameComplete && bootPhase >= 2 && (
                <div className="fixed inset-0 bg-[#020617]/90 z-[6000] flex flex-col items-center justify-center p-6 backdrop-blur-lg fade-in">
                    <Icons.Cpu size={48} className="text-cyan-500 mb-6 animate-pulse" />
                    <h2 className="text-xl font-mono text-cyan-400 tracking-[0.3em] mb-8 text-shadow-glow">DECRYPTING ASSET</h2>
                    <div className="w-full max-w-xs progress-bar"></div>
                </div>
            )}

            {/* MEDIA VIEWER MODALS */}
            {renderMediaModal(activeMedia, () => setActiveMedia(null), false)}
            {renderMediaModal(rabbitHoleItem, () => setRabbitHoleItem(null), true)}

            <header className="p-4 md:p-5 glass-panel border-b-0 shrink-0 z-[500] flex justify-between items-center">
                <div>
                    <h1 className="text-xl font-black uppercase tracking-widest text-white text-shadow-glow flex items-center gap-2">
                        CRI <span className="text-cyan-500 font-light">|</span> OS
                    </h1>
                    <p className="text-[9px] text-cyan-600 font-mono mt-1 tracking-widest">FIELD OPERATIVE TERMINAL</p>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={toggleSound} title={soundEnabled ? "Mute ambient sound" : "Unmute ambient sound"} className="text-gray-500 hover:text-cyan-400 transition-colors border border-gray-800 p-1.5 rounded">
                        {soundEnabled ? <Icons.Volume2 size={14} /> : <Icons.VolumeX size={14} />}
                    </button>
                    <button onClick={() => setShowSandbox(true)} className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-cyan-400 transition-colors border border-gray-800 px-3 py-1.5 rounded">
                        [ SANDBOX / HELP ]
                    </button>
                </div>
            </header>

            <main className="flex-1 relative overflow-hidden flex flex-col">
                
                <div className={`absolute inset-0 transition-opacity duration-300 flex flex-col ${activeTab === 'SCANNER' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <div className="max-w-md mx-auto mt-10">
                        <div className="glass-panel p-8 rounded-xl text-center shadow-2xl">
                            <Icons.Cpu size={48} className="mx-auto text-cyan-500 mb-6 opacity-80" />
                            <h2 className="text-lg font-bold text-white uppercase tracking-widest mb-2">MANUAL OVERRIDE</h2>
                            <p className="text-xs text-cyan-700 font-mono mb-8">Tap your device to a physical CRI NFC tag, or manually enter the asset signature below.</p>
                            <div className="flex flex-col gap-4">
                                <input id="manualInput" type="text" placeholder="ENTER SIGNATURE..." className="w-full p-4 bg-black/50 border border-cyan-900/50 text-cyan-300 font-mono text-center uppercase focus:border-cyan-500 outline-none rounded" />
                                <button onClick={() => {
                                    const val = document.getElementById('manualInput').value;
                                    if(val) { processScan(val); document.getElementById('manualInput').value = ''; }
                                }} className="w-full py-4 bg-cyan-500/10 border border-cyan-500/50 text-cyan-400 font-bold uppercase tracking-widest hover:bg-cyan-500/20 transition-colors rounded">
                                    INITIATE DECRYPTION
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={`absolute inset-0 transition-opacity duration-300 flex flex-col ${activeTab === 'MAP' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <div className="flex-1 min-h-[30vh] relative w-full border-b border-cyan-900/30" style={{ background: CRI_GRID_BG }}>
                        <div ref={mapRef} className={`w-full h-full absolute inset-0 z-10 ${activeTab === 'MAP' ? '' : 'pointer-events-none'}`}></div>
                    </div>

                    <div className="p-4 md:p-6 bg-[#020617] shrink-0 max-h-[45vh] overflow-y-auto custom-scrollbar z-[500] shadow-[0_-10px_30px_rgba(0,0,0,0.8)] relative">
                        <div className="max-w-4xl mx-auto flex flex-col">
                            {!gameState.selectedPath && bootPhase >= 3 && (
                                <div className="fade-in text-center relative">
                                    <h3 className="text-lg font-black uppercase tracking-widest text-cyan-400 mb-2">SELECT OPERATIVE PROFILE</h3>
                                    <p className="text-xs text-cyan-700 font-mono mb-1">Choose your assignment. This will lock your trajectory.</p>
                                    <p className="tap-hint text-[10px] text-white font-bold uppercase tracking-widest mb-4">👇 Tap one to begin 👇</p>
                                    <div className="grid grid-cols-3 gap-2 md:gap-4">
                                        {['GUARDIAN', 'DETECTIVE', 'VIGILANTE'].map(pathKey => {
                                            const config = NODE_CONFIG[pathKey];
                                            const isAnimating = animatingSelection === pathKey;
                                            const isHidden = animatingSelection && animatingSelection !== pathKey;
                                            return (
                                                <button key={pathKey} onClick={() => handlePathSelection(pathKey)} disabled={!!animatingSelection} style={{ '--pulse-color': `${config.color}99` }} className={`p-3 md:p-4 glass-panel hover:bg-white/5 transition-all duration-500 flex flex-col items-center gap-2 rounded ${isHidden ? 'opacity-0 scale-90' : 'opacity-100'} ${isAnimating ? 'shatter-effect' : !animatingSelection ? 'profile-pulse' : ''}`}>
                                                    <div style={{ color: config.color }} dangerouslySetInnerHTML={{ __html: config.icon }} className="w-10 h-10 drop-shadow-md mb-1" />
                                                    <span className="text-[14px] font-black uppercase tracking-widest text-white">{pathKey}</span>
                                                    <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: config.color }}>{config.profile}</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}

                            {gameState.selectedPath && NODE_CONFIG[gameState.selectedPath] && !gameState.gameComplete && (
                                <div className="fade-in space-y-2">
                                    <div className="flex justify-between items-center mb-1">
                                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-cyan-500 flex items-center gap-2"><Icons.Activity size={12} className="animate-pulse" /> SECTORS SECURED [{3 - getRemainingClues().length}/3]</h3>
                                        <span className={`text-[10px] font-mono font-bold ${NODE_CONFIG[gameState.selectedPath].textClass}`}>PROFILE: {NODE_CONFIG[gameState.selectedPath].profile}</span>
                                    </div>
                                    {getRemainingClues().map(c => (
                                        <div key={c.type} className="p-4 glass-panel rounded text-sm text-gray-300 font-mono leading-relaxed">
                                            <div className="text-[9px] text-cyan-600 uppercase tracking-widest mb-1">{c.type} NODE</div>
                                            <div dangerouslySetInnerHTML={{ __html: c.clue }} />
                                        </div>
                                    ))}
                                </div>
                            )}

                            {gameState.gameComplete && (
                                <div className="fade-in text-center">
                                    <p className="font-mono text-cyan-400 text-sm mb-4" style={{textShadow: '0 0 8px rgba(34,211,238,0.6)'}}>
                                        SITE LOGGED. Great job, operative {userAlias || 'operative'}. You successfully logged the known anomalies — we can now mark this site as secured.<br/><br/>
                                        Add us on Instagram <span className="font-bold">@cascadiaresonanceinstitute</span> and upload a screenshot and photo of your mission.
                                    </p>
                                    <div className="border-2 border-cyan-400 bg-[#020617] p-6 rounded-lg shadow-[0_0_35px_rgba(34,211,238,0.5)] max-w-sm mx-auto">
                                        <div className="text-6xl mb-3 select-none" style={{ filter: 'drop-shadow(0 0 12px #22d3ee)' }}>🛡️</div>
                                        <p className="text-cyan-300 font-black text-2xl tracking-widest" style={{textShadow: '0 0 10px #22d3ee'}}>CRI-{(userAlias || 'OPERATIVE').toUpperCase()}</p>
                                        <p className="text-white font-bold text-lg mt-1">CAPITOL HILL SECURED 2026</p>
                                        <p className="text-cyan-400 text-[10px] font-mono uppercase tracking-[0.3em] mt-3">Timeline Protocol</p>
                                    </div>
                                    <a href={STRIPE_LINK} target="_blank" rel="noopener noreferrer" className="inline-block mt-4 px-6 py-2 border border-cyan-500 text-cyan-400 hover:bg-cyan-500 hover:text-black font-bold font-mono text-[10px] uppercase tracking-widest transition-colors rounded">
                                        Support the show
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className={`absolute inset-0 bg-[#020617] p-6 transition-opacity duration-300 overflow-y-auto custom-scrollbar ${activeTab === 'VAULT' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <div className="max-w-4xl mx-auto">
                        <div className="flex justify-between items-center mb-6 border-b border-cyan-900/30 pb-4">
                            <h2 className="text-lg font-bold text-cyan-500 uppercase tracking-widest flex items-center gap-2"><Icons.Database size={18} /> {CLOSED_LOOP_DEMO ? 'CASE BOARD' : 'SECURED DATA VAULT'}</h2>
                            <button onClick={handleReset} className="text-[9px] text-gray-700 hover:text-red-500 font-bold uppercase tracking-widest transition-colors">[ PURGE MEMORY ]</button>
                        </div>

                        {CLOSED_LOOP_DEMO ? (
                            <div className="relative">
                                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
                                    {boardLines.map(l => (
                                        <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                                            stroke="#dc2626" strokeWidth={l.solid ? 2 : 1.5}
                                            strokeDasharray={l.solid ? undefined : '5,5'}
                                            opacity={l.solid ? 0.75 : 0.35} />
                                    ))}
                                </svg>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 relative" style={{ zIndex: 2 }}>
                                    {[...getAllItems(), ...TEMPORAL_ARTISTS]
                                        // Legacy (last show's) items never get a "? CLASSIFIED" placeholder --
                                        // this board should only advertise tonight's own loop. A legacy item
                                        // still fully works if scanned (old stickers, easter egg for whoever
                                        // finds one), it just doesn't show up here as something to look for
                                        // until it's actually been found.
                                        .filter(item => {
                                            if (!item.legacy) return true;
                                            return gameState.unlockedNodes.some(n => n.id === item.id);
                                        })
                                        .map(item => {
                                        const isArtist = !!item.scanCode;
                                        const unlocked = isArtist ? isArtistUnlocked(item.id) : gameState.unlockedNodes.some(n => n.id === item.id);
                                        const tilt = (item.id.charCodeAt(item.id.length - 1) % 5) - 2;
                                        return (
                                            <div key={item.id}
                                                ref={el => { boardCardRefs.current[item.id] = el; }}
                                                onClick={() => unlocked && (isArtist ? setActiveArtist(item) : setActiveMedia(item))}
                                                style={{ transform: `rotate(${tilt}deg)` }}
                                                className={`relative p-3 pt-4 rounded border min-h-[110px] flex flex-col justify-between shadow-lg transition-colors ${unlocked ? 'bg-black/70 border-cyan-700/50 hover:border-cyan-400 cursor-pointer' : 'bg-black/40 border-red-900/40'}`}>
                                                <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-red-600 shadow-[0_0_6px_rgba(220,38,38,0.9)] border border-red-950" />
                                                {unlocked ? (
                                                    <>
                                                        <div className="text-[8px] text-cyan-600 font-mono uppercase tracking-widest mb-1 truncate">{item.code || item.id.slice(0, 8)}</div>
                                                        <h3 className="text-xs font-bold text-white line-clamp-3">{item.title || item.name}</h3>
                                                        <div className="text-[8px] text-gray-500 font-mono mt-2 uppercase">TAP TO REVIEW</div>
                                                    </>
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center h-full text-center">
                                                        <span className="text-2xl text-red-700 font-black leading-none">?</span>
                                                        <span className="text-[8px] text-red-700 font-mono uppercase tracking-widest mt-1">CLASSIFIED</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : gameState.unlockedNodes.length === 0 ? (
                            <div className="glass-panel p-10 rounded text-center">
                                <p className="text-xs text-cyan-700 font-mono uppercase tracking-widest">VAULT IS EMPTY. DECRYPT ASSETS IN THE FIELD TO POPULATE.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {getAllItems().filter(a => gameState.unlockedNodes.some(n => n.id === a.id)).map(item => (
                                    <div key={item.id} onClick={() => setActiveMedia(item)} className="glass-panel p-4 rounded cursor-pointer hover:border-cyan-500/50 transition-colors group flex flex-col justify-between min-h-[120px]">
                                        <div>
                                            <div className="text-[9px] text-cyan-600 font-mono uppercase tracking-widest mb-2 flex justify-between">
                                                <span>ASSET: {item.code || item.assetId || item.id.slice(0,6)}</span>
                                                {(item.videoUrl || item.audioUrl) && <Icons.Activity size={10} className="text-cyan-400" />}
                                            </div>
                                            <h3 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors line-clamp-2">{item.title || item.name}</h3>
                                        </div>
                                        <div className="text-[10px] text-gray-500 font-mono mt-4 uppercase">TAP TO REVIEW</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </main>

            <nav className="glass-panel border-t border-cyan-900/30 shrink-0 z-[500] pb-safe">
                <div className="flex max-w-md mx-auto">
                    <button onClick={() => setActiveTab('MAP')} className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${activeTab === 'MAP' ? 'text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}>
                        <Icons.MapPin size={20} />
                        <span className="text-[9px] font-bold uppercase tracking-widest">TACTICAL MAP</span>
                    </button>
                    <button onClick={() => setActiveTab('SCANNER')} className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${activeTab === 'SCANNER' ? 'text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}>
                        <Icons.Activity size={20} />
                        <span className="text-[9px] font-bold uppercase tracking-widest">MANUAL SCAN</span>
                    </button>
                    <button data-vault-tab onClick={() => { setActiveTab('VAULT'); setHasNewVaultItem(false); }} className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${activeTab === 'VAULT' ? 'text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}>
                        <div className="relative">
                            <Icons.Database size={20} />
                            {hasNewVaultItem && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#00ff41] rounded-full animate-pulse"></span>}
                        </div>
                        <span className="text-[9px] font-bold uppercase tracking-widest">DATA VAULT</span>
                    </button>
                </div>
            </nav>

            {/* ==========================================
                DEV HARNESS — add ?debug=1 to the URL to show this.
                Players never see it. Safe to leave in the shipped build.
                ========================================== */}
            {debugMode && (
                <div className="fixed bottom-2 right-2 z-[99999] font-mono text-[10px] max-w-[280px]">
                    {!debugOpen ? (
                        <button onClick={() => setDebugOpen(true)} className="bg-fuchsia-600 text-white px-3 py-2 rounded font-bold shadow-lg">
                            DEV
                        </button>
                    ) : (
                        <div className="bg-black/95 border-2 border-fuchsia-500 rounded p-3 shadow-2xl space-y-3 max-h-[80vh] overflow-y-auto">
                            <div className="flex justify-between items-center border-b border-fuchsia-800 pb-2">
                                <span className="text-fuchsia-400 font-bold tracking-widest">DEV HARNESS</span>
                                <button onClick={() => setDebugOpen(false)} className="text-fuchsia-400 px-2">&times;</button>
                            </div>

                            {/* LIVE STATE */}
                            <div className="text-gray-400 space-y-0.5">
                                <div>boot: <span className="text-white">{String(bootPhase)}</span> &nbsp; tab: <span className="text-white">{activeTab}</span></div>
                                <div>path: <span className="text-white">{gameState.selectedPath || 'none'}</span> &nbsp; faction: <span className="text-white">{gameState.faction || 'none'}</span></div>
                                <div>unlocked: <span className="text-white">{gameState.unlockedNodes.length}</span> ({MAIN_NODE_TYPES.filter(t => gameState.unlockedNodes.some(n => n.type === t)).length}/3 main) &nbsp; complete: <span className="text-white">{String(gameState.gameComplete)}</span></div>
                                <div className={getAllItems().length === 0 ? 'text-red-400 font-bold' : 'text-gray-400'}>
                                    firestore: <span className="text-white">{artifactsDb.length}a / {ideasDb.length}i / {journalsDb.length}j</span>
                                    {getAllItems().length === 0 && <div className="text-red-400">NO DATA — check firebase.js appId</div>}
                                </div>
                                <div>matrix: <span className="text-white">{(matrixDb.nodes || []).length} nodes</span></div>
                            </div>

                            {/* WHAT THE KEYWORD MATCHER RESOLVED TO */}
                            <div className="border-t border-fuchsia-900 pt-2">
                                <div className="text-fuchsia-400 mb-1">NODE RESOLUTION</div>
                                {['GUARDIAN', 'DETECTIVE', 'VIGILANTE'].map(t => {
                                    const hit = getArtifactForType(t);
                                    return (
                                        <div key={t} className="truncate">
                                            <span className="text-gray-500">{t}:</span>{' '}
                                            <span className={hit ? 'text-green-400' : 'text-red-400'}>
                                                {hit ? (hit.title || hit.name) : 'NO MATCH'}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* SCREEN JUMPS */}
                            <div className="border-t border-fuchsia-900 pt-2 space-y-1">
                                <div className="text-fuchsia-400 mb-1">JUMP TO SCREEN</div>
                                <button onClick={() => { setBootPhase(0); setTimeout(() => setBootPhase(1), 3500); setTimeout(() => setBootPhase(1.5), 6500); setTimeout(() => setBootPhase(2), 9500); }} className="w-full text-left px-2 py-1.5 bg-fuchsia-950 border border-fuchsia-800 rounded hover:bg-fuchsia-900">replay title sequence</button>
                                <div className="grid grid-cols-3 gap-1">
                                    <button onClick={() => setBootPhase(0)} className="px-1 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">CRI</button>
                                    <button onClick={() => setBootPhase(1)} className="px-1 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">logo</button>
                                    <button onClick={() => setBootPhase(1.5)} className="px-1 py-1.5 bg-yellow-950 border border-yellow-700 text-yellow-400 rounded hover:bg-yellow-900">title</button>
                                </div>
                                <button onClick={() => setBootPhase(2)} className="w-full text-left px-2 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">menu (system access)</button>
                                <button onClick={() => setBootPhase(2.5)} className="w-full text-left px-2 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">field manual</button>
                                <button onClick={() => { setBootPhase(3); setShowSandbox(false); }} className="w-full text-left px-2 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">skip to game</button>
                            </div>

                            {/* SANDBOX CONTENT */}
                            <div className="border-t border-fuchsia-900 pt-2 space-y-1">
                                <div className="text-fuchsia-400 mb-1">SANDBOX</div>
                                <button onClick={() => { setBootPhase(2); setShowSandbox(true); }} className="w-full text-left px-2 py-1.5 bg-green-950 border border-green-800 text-green-400 rounded hover:bg-green-900">open anomaly page</button>
                                <button onClick={() => setShowRupture(true)} className="w-full text-left px-2 py-1.5 bg-red-950 border border-red-800 text-red-400 rounded hover:bg-red-900">temporal rupture screen</button>
                                {TEMPORAL_ARTISTS.map(a => (
                                    <div key={a.id} className="flex gap-1">
                                        <button onClick={() => setActiveArtist(a)} className="flex-1 text-left px-2 py-1.5 bg-cyan-950 border border-cyan-800 text-cyan-400 rounded hover:bg-cyan-900 truncate">
                                            {a.name.split(' ')[0]} dossier
                                        </button>
                                        <button
                                            onClick={() => setGameState(prev => ({
                                                ...prev,
                                                unlockedArtists: isArtistUnlocked(a.id)
                                                    ? (prev.unlockedArtists || []).filter(x => x !== a.id)
                                                    : [...(prev.unlockedArtists || []), a.id]
                                            }))}
                                            className="px-2 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800"
                                            title="toggle lock"
                                        >
                                            {isArtistUnlocked(a.id) ? '🔓' : '🔒'}
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* GAME STATE */}
                            <div className="border-t border-fuchsia-900 pt-2 space-y-1">
                                <div className="text-fuchsia-400 mb-1">GAME STATE</div>
                                <button onClick={() => { setGameState(prev => ({ ...prev, selectedPath: 'GUARDIAN' })); setBootPhase(3); setShowSandbox(false); }} className="w-full text-left px-2 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">force selectedPath (no form POST)</button>
                                <button onClick={() => processScan('TAG-NIGHTMARE-OVERRIDE')} className="w-full text-left px-2 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">force-unlock current node</button>
                                <button onClick={() => {
                                    const unlockedNodes = getAllItems().map(item => {
                                        const mainType = MAIN_NODE_TYPES.find(t => STATIC_MAIN_NODES[t].id === item.id);
                                        return { id: item.id, type: mainType || 'MANUAL', lat: item.lat, lng: item.lng };
                                    });
                                    setGameState(prev => ({ ...prev, unlockedNodes, unlockedArtists: TEMPORAL_ARTISTS.map(a => a.id), gameComplete: true }));
                                    playGlitchSound();
                                    if (gameState.faction === 'HACKER') setHackerEndPhase(1);
                                }} className="w-full text-left px-2 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">unlock ALL case board items ({getAllItems().length + TEMPORAL_ARTISTS.length} total, no form POST)</button>
                                <button onClick={() => {
                                    const unlockedNodes = MAIN_NODE_TYPES.map(t => {
                                        const art = getArtifactForType(t);
                                        return art ? { id: art.id, type: t, lat: art.lat, lng: art.lng } : null;
                                    }).filter(Boolean);
                                    setGameState(prev => ({ ...prev, unlockedNodes, gameComplete: true }));
                                    playGlitchSound();
                                    if (gameState.faction === 'HACKER') setHackerEndPhase(1);
                                }} className="w-full text-left px-2 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">unlock just the 3 main nodes (no form POST)</button>
                                <div className="grid grid-cols-2 gap-1">
                                    <button onClick={() => setGameState(prev => ({ ...prev, faction: 'HACKER' }))} className={`px-1 py-1.5 border rounded ${gameState.faction === 'HACKER' ? 'bg-[#00ff41]/30 border-[#00ff41] text-[#00ff41]' : 'bg-gray-900 border-gray-700'}`}>faction: HACKER</button>
                                    <button onClick={() => setGameState(prev => ({ ...prev, faction: 'CRI' }))} className={`px-1 py-1.5 border rounded ${gameState.faction === 'CRI' ? 'bg-cyan-500/30 border-cyan-400 text-cyan-300' : 'bg-gray-900 border-gray-700'}`}>faction: CRI</button>
                                </div>
                                <button onClick={() => { if (!userAlias) setUserAlias('OPERATIVE'); processScan('TAG-ENDGAME-OVERRIDE'); }} className="w-full text-left px-2 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">jump to endgame (picks CRI or HACKER popup by current faction)</button>
                                <button onClick={() => setShowBonusReveal(true)} className="w-full text-left px-2 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">show bonus reveal now</button>
                                <button onClick={handleReset} className="w-full text-left px-2 py-1.5 bg-red-950 border border-red-800 text-red-400 rounded hover:bg-red-900">purge memory + reload</button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}