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
const playGlitchSound = () => {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
    } catch (e) { console.warn("Audio blocked."); }
};

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

// Sandbox Seattle — 1417 10th Ave, Capitol Hill. Last night's venue; kept for
// old codes/history, not part of tonight's Belltown map.
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
        title: 'Intercepted Audio: The Professor',
        lat: VENUE.lat, lng: VENUE.lng,
        text: "[ CRI SIGNAL INTERCEPT — AFT AIRSTAIR DOOR RESONANCE ]<br/><br/>Audio recovered from the door's residual chronal signature. Full recording pending upload.<br/><br/>What's already decrypted: a second voice on the tape, calm, coaching. Bob isn't planning this alone.",
        artistNotes: "I just decrypted this audio file off the door's resonance. Listen to this.\n\nBob didn't hijack that plane for the money. This 'Professor' set him up. Stanton used him as a kinetic anchor. Bob had no idea what he was doing."
    },
    {
        id: 'static-tg-001',
        code: 'TG-001',
        title: 'CRI Asset Log: The Synchronization Bridge',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ CRI ASSET DETAIL — CRI-TG-001 ]<br/><br/>The Temporal Mark Generator: a capacitor bank built to imprint a decades-long displacement factor onto a paired Anchor and Siphon. The process required a surge past every safety threshold on the schematic.<br/><br/>Recovered connection ports show heat-warped scarring consistent with total overload, moments before the unit was vaporized.",
        artistNotes: "Whatever they built in that basement wasn't meant to be used twice. Look at the scoring on the metal — somebody burned this thing out on purpose, or it burned itself out stopping them.\n\nEither way, nobody's rebuilding it."
    },
    {
        id: 'static-reactor-61',
        code: 'REACTOR-61',
        title: 'AEC Order 66-9: Containment by Concrete',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ DECLASSIFIED — 1961 ]<br/><br/>Order issued for immediate construction of a research reactor directly over an existing radiation lab in this sector. Official justification on file: modernization.<br/><br/>Unofficial effect: the new reactor's baseline radiation signature ran hot enough to mask whatever the old lab underneath it was still leaking.",
        artistNotes: "They didn't shut this lab down. They poured a live reactor on top of it so nobody would ever think to dig.\n\nThat's not decommissioning. That's a cover-up with a building permit."
    },
    {
        id: 'static-hum-440',
        code: 'HUM-440',
        title: 'Research Draft: Harmonic Excitation of Cobalt-60 Derivatives',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ REJECTED RESEARCH DRAFT — AUTHOR REDACTED ]<br/><br/>Proposes that a tri-tone acoustic pressure of 440.01 Hz can displace radioactive decay entirely. Rejected by peer review. Correctly predicted a phenomenon the author called 'glass pitting.'<br/><br/>CRI runs the inverse of this exact frequency, -440.01 Hz, to keep something in this sector paralyzed. What the neighbors call 'the Hum' is the bleed.",
        artistNotes: "Someone got laughed out of a journal for this paper in the 1950s. CRI read it, flipped the sign, and built a cage with it.\n\nWhoever's stationed on that containment tone has been running it for a very long time."
    },
    {
        id: 'static-filter-protocol',
        code: 'FILTER-PROTOCOL',
        title: 'Physics Division Memo: The Frequency of Clarity',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ INTERNAL MEMO — AUTHOR REDACTED ]<br/><br/>Subject: The Filter. The average mind resolves temporal overlap as background noise — a trick of the light, deja vu, nothing worth reporting. This resistance is called the Filter.<br/><br/>Recommendation: a mass-scale, voluntary lowering of the Filter through gamified public participation. A mind searching for something is primed to find it — including things that were never meant to be found.",
        artistNotes: "This is the memo that bothers me most. They wrote up a plan to turn a night out into a psychology experiment on everyone holding a phone.\n\nYou're not just playing a game right now. You're the control group."
    },
    {
        id: 'static-sudo-clearance',
        code: 'SUDO-CLEARANCE',
        title: 'CRI Personnel File: Redacted',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ ACCESS PARTIALLY GRANTED ]<br/><br/>Most of this file is blacked out. What's left: a title, '[ REDACTED — FORMER LEAD, RESONANCE RESEARCH ]', underlined three times, and a note in different handwriting that just says <em>he's gone. the work isn't.</em>",
        artistNotes: "Whoever ran this lab is out of the picture now. Left, removed, doesn't matter — the file's been scrubbed either way.\n\nBut the equipment's still down there. Somebody's still running it."
    },
    {
        id: 'static-cri-psa-099',
        code: 'CRI-PSA-099',
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
        title: 'Internal Memo: Subject 89',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ CRI INTERNAL MEMO — AUTHOR REDACTED ]<br/><br/>Confirms the 'Bigfoot' phenomenon is a species of phase-shifting entity using a high-frequency Masking Hum to stay invisible to the human Filter. Designation: Subject 89. Status, as of this filing: contained.<br/><br/>Status, as of tonight: unconfirmed. CRI has stopped answering questions about it.",
        artistNotes: "They had a name for it before they ever had it in a cage. 'Subject 89.' Like it was already just a number to them.\n\nBob didn't just open a door for it. He gave it back its name."
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
    ['TA-01', 'TA-02']
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
        id: 'static-dshs-1980',
        code: 'DSHS-1980',
        title: 'Field Note: The DSHS Facade',
        lat: DSHS.lat, lng: DSHS.lng,
        desc: "2106 2nd Ave. The office is closed and locked — don't try the door. Look through the front window. A government facade is hiding something CRI doesn't want found.",
        text: "[ CRI FIELD NOTE — 2ND AVE TRANSIT NODE ]<br/><br/>This office was never fully DSHS. The state letterhead was a facade CRI kept running for decades to explain unmarked vans, late-night deliveries, and a door nobody on staff had keys to.<br/><br/>Internally this was a Resonance Research Annex — an old lab, active long after 1956, quietly kept off every public record.",
        artistNotes: "A government office that never processed a single case file. That's not bureaucracy, that's a lid on something.\n\nWhatever CRI was doing down in that basement, they needed a very boring building on top of it."
    },
    DETECTIVE: {
        id: 'static-boaz-smash',
        code: 'BOAZ-SMASH',
        title: 'CRI Surveillance File: Subject Redacted',
        lat: SHORTYS.lat, lng: SHORTYS.lng,
        desc: "Shorty's Coney Island, 2316 2nd Ave. Find the portrait CRI didn't want painted. His face is gone — they couldn't redact everything.",
        text: "[ CRI SURVEILLANCE FILE — FACE REDACTED PER PROTOCOL 12 ]<br/><br/>Standard procedure: any image of an unauthorized temporal subject gets the face stripped before filing. This one didn't stay stripped. Someone repainted around the redaction — left the jacket, the build, the posture. Enough to know him, if you already do.<br/><br/>CRI's own paperwork won't say the name. Somewhere in this city, somebody still will.",
        artistNotes: "They blacked out his face and called it handled. It isn't. Every other file in this city dances around the same blank space — follow enough of them and the shape underneath starts to matter more than the face ever would."
    },
    VIGILANTE: {
        id: 'static-tag-signal',
        code: 'TAG-SIGNAL',
        title: 'Field Note: The Ballast Count',
        lat: JUPITER_BAR.lat, lng: JUPITER_BAR.lng,
        desc: "Jupiter Bar, 2126 2nd Ave. Find the money. Not currency — cargo. Somebody weighed it to the ounce.",
        text: "[ CRI FIELD NOTE — 2ND AVE RECOVERY ]<br/><br/>$200,000 in ransom bills, never spent, barely even wanted. What mattered was the weight: 21 pounds exactly, strapped tight to a body mid-fall.<br/><br/>Ballast isn't a metaphor here. It's the only reason a jump like that holds together long enough to land anywhere at all.",
        artistNotes: "Everyone still calls this a robbery. It was a weights-and-measures problem. Twenty-one pounds, no more, no less — that's not a ransom note, that's an engineering spec."
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

    const [gameState, setGameState] = useState(() => {
        const saved = localStorage.getItem('timeline_protocol_belltown_v1');
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

    const isArtistUnlocked = (artistId) => (gameState.unlockedArtists || []).includes(artistId);

    useEffect(() => localStorage.setItem('timeline_protocol_belltown_v1', JSON.stringify(gameState)), [gameState]);

    // BONUS REVEAL — a beat after the game completes (any order, either faction),
    // a full-screen stinger fires once and never again. Higher z-index than the
    // hacker end popup so it lands on top of it if that's still open.
    useEffect(() => {
        if (gameState.gameComplete && !gameState.bonusRevealShown) {
            const t = setTimeout(() => setShowBonusReveal(true), 2800);
            return () => clearTimeout(t);
        }
    }, [gameState.gameComplete, gameState.bonusRevealShown]);

    const dismissBonusReveal = () => {
        setShowBonusReveal(false);
        setGameState(prev => ({ ...prev, bonusRevealShown: true }));
    };

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
            localStorage.removeItem('timeline_protocol_belltown_v1');
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
            body: JSON.stringify({ alias, email, archetype: pathKey, source: 'Belltown Blast — Profile Build' })
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
            if (gameState.faction === 'HACKER') setHackerEndPhase(1);
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
            const center = CLOSED_LOOP_DEMO ? DSHS : SEATTLE_CENTER;
            const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([center.lat, center.lng], CLOSED_LOOP_DEMO ? 17 : 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

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
            body: JSON.stringify({ alias: userAlias, email: userEmail, faction, source: 'Belltown Blast — Faction Report', ...extra })
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
                .leaflet-container { background: #020617 !important; font-family: 'Inter', sans-serif; }
                
                .fade-in-seq-1 { animation: fadeIn 1s ease-in forwards; }
                .fade-in-seq-2 { opacity: 0; animation: fadeIn 1s ease-in 1s forwards; }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            `}</style>

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
                            <span className="block">BELLTOWN</span>
                            <span className="block">BLAST</span>
                        </h1>
                        <p className="mt-8 text-[10px] md:text-xs font-mono text-yellow-600/80 uppercase tracking-[0.4em] text-center">
                            Seattle &nbsp;//&nbsp; Sector 2
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

            {/* BLAST!/INFO PANEL — instructions, shown once automatically after profile build,
                reopenable anytime via the header button. Donate + artist unlocks now live
                in the Archive (Data Vault) instead of a separate Sandbox screen. */}
            {showSandbox && (
                <div className="fixed inset-0 bg-[#020617]/95 z-[9500] flex items-center justify-center p-4 backdrop-blur-xl fade-in">
                    <div className="glass-panel w-full max-w-lg p-6 rounded-lg shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col max-h-[90vh]">
                        <div className="flex justify-between items-start mb-4 border-b border-cyan-900/40 pb-4 shrink-0">
                            <div>
                                <h2 className="text-xl font-black text-cyan-400 tracking-widest flex items-center gap-2">
                                    <Icons.Activity size={18} /> BLAST / HELP
                                </h2>
                                <p className="text-[10px] font-mono text-cyan-700 mt-1 tracking-widest uppercase">
                                    SECTOR: BELLTOWN &nbsp;//&nbsp; EVENT: BOB'S DOORS &mdash; BELLTOWN BLAST
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
                                        I helped Bob hack the planet at Belltown Blast 2026 and all I got was this lousy screenshot!
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
                <div className="flex items-center gap-4">
                    <button onClick={() => setShowSandbox(true)} className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-cyan-400 transition-colors border border-gray-800 px-3 py-1.5 rounded">
                        [ BLAST / HELP ]
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
                    <div className="flex-1 min-h-[30vh] relative w-full border-b border-cyan-900/30">
                        <div ref={mapRef} className="w-full h-full absolute inset-0 z-10"></div>
                    </div>

                    <div className="p-4 md:p-6 bg-[#020617] shrink-0 max-h-[45vh] overflow-y-auto custom-scrollbar z-[500] shadow-[0_-10px_30px_rgba(0,0,0,0.8)] relative">
                        <div className="max-w-4xl mx-auto flex flex-col">
                            {!gameState.selectedPath && (
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
                                        YOU SECURED SECTOR 02. Great job, operative {userAlias || 'operative'}. You successfully logged the known anomalies — we can now retrieve the doors for further study.<br/><br/>
                                        Add us on Instagram <span className="font-bold">@cascadiaresonanceinstitute</span> and upload a screenshot and photo of your mission.
                                    </p>
                                    <div className="border-2 border-cyan-400 bg-[#020617] p-6 rounded-lg shadow-[0_0_35px_rgba(34,211,238,0.5)] max-w-sm mx-auto">
                                        <div className="text-6xl mb-3 select-none" style={{ filter: 'drop-shadow(0 0 12px #22d3ee)' }}>🛡️</div>
                                        <p className="text-cyan-300 font-black text-2xl tracking-widest" style={{textShadow: '0 0 10px #22d3ee'}}>CRI-{(userAlias || 'OPERATIVE').toUpperCase()}</p>
                                        <p className="text-white font-bold text-lg mt-1">BELLTOWN SECURED 2026</p>
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
                                    {[...getAllItems(), ...TEMPORAL_ARTISTS].map(item => {
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