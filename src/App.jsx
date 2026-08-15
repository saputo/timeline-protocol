import React, { useState, useEffect, useRef } from 'react';
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

// Sandbox Seattle — 1417 10th Ave, Capitol Hill. All tonight's physical props are here.
const VENUE = { lat: 47.613592, lng: -122.319640, label: 'THE SANDBOX' };

// Belltown neighborhood centroid — a hint pin for Saturday's leg, not the exact
// DSHS door (that location isn't locked in yet). Tighten to the real address
// once it's confirmed.
const BELLTOWN = { lat: 47.613231, lng: -122.345361, label: 'BELLTOWN — SIGNAL SOURCE' };

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

const SEQUENCES = {
    'MONEY': ['MONEY', 'SKETCH', 'EXIT'],
    'SKETCH': ['SKETCH', 'MONEY', 'EXIT'],
    'EXIT': ['EXIT', 'MONEY', 'SKETCH']
};

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
        instagram: 'https://instagram.com/inspirted.imp',
        instagramHandle: '@inspirted.imp',
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
        id: 'static-dshs-1980',
        code: 'DSHS-1980',
        title: 'Intercepted Audio: The Deflection',
        lat: VENUE.lat, lng: VENUE.lng,
        text: "[ CRI SIGNAL INTERCEPT — TIMELINE DEFLECTION ]<br/><br/>Stanton's voice, off the recovered tape, mid-panic. Bob missed his jump. The timeline kicked him sideways into a Department of Social and Health Services office, decades off target.<br/><br/>Full transcript pending upload.",
        artistNotes: "Bob missed his jump. The timeline deflected him into a 1980s government building.\n\nStanton is flying blind here. He's sending a warehouse mechanic into a Class-5 containment zone just to save his own skin."
    },
    {
        id: 'static-boaz-smash',
        code: 'BOAZ-SMASH',
        title: 'CRI Incident Report: Subject 89 Escape',
        lat: VENUE.lat, lng: VENUE.lng,
        text: "CRITICAL FAILURE. Containment grid shattered via brute-force Boaz impact. Acoustic static generators (-440.01 Hz) destroyed. Subject 89 has phased through the Z-Axis into the timberland. Unidentified operative escaped through the Iron Door.",
        artistNotes: "He actually did it. Bob used the Black Stone to smash the CRI mainframe and free the creature.\n\nHe isn't just a pawn anymore. CRI is hunting him, and Stanton lost control."
    },
    // Two extra hidden/bonus codes — easter eggs for players who go looking. Text is
    // placeholder-but-usable; swap the copy for anything more specific whenever there's time.
    {
        id: 'static-hum-440',
        code: 'HUM-440',
        title: 'CRI Project: The West Seattle Hum',
        lat: VENUE.lat, lng: VENUE.lng,
        text: "[ LEVEL 5 CLEARANCE ]<br/><br/>Containment is holding on something CRI won't name directly. A reverse acoustic resonance at -440.01 Hz keeps it paralyzed. The bleed is what people outside have been calling the 'Hum.'",
        artistNotes: "They didn't just capture an animal. They captured something a lot bigger, and they've been torturing it with acoustic static for years.\n\nWhoever's stationed here walked right into a slaughterhouse."
    },
    {
        id: 'static-sudo-clearance',
        code: 'SUDO-CLEARANCE',
        title: 'CRI Personnel File: Redacted',
        lat: VENUE.lat, lng: VENUE.lng,
        text: "[ ACCESS PARTIALLY GRANTED ]<br/><br/>Most of this file is blacked out. What's left: a name, 'Stanton,' underlined three times, and a note in different handwriting that just says <em>watch him, not Bob.</em>",
        artistNotes: "Somebody on the inside doesn't trust their own boss.\n\nWe might not be chasing the right guy tonight."
    },
    // Teaser for Saturday's Belltown Blast leg — deliberately vague, doesn't confirm
    // anything about Subject 89, just plants the name and points the map at Belltown.
    {
        id: 'static-subject-89',
        code: 'SUBJECT-89',
        title: 'CRI Flagged Signal: Designation Unknown',
        lat: BELLTOWN.lat, lng: BELLTOWN.lng,
        text: "[ CRI SIGNAL — PARTIAL DECRYPT ]<br/><br/>Most of this file won't resolve. What's left: a containment designation &mdash; SUBJECT 89 &mdash; and a location stamp: BELLTOWN. Nothing else comes through the noise.",
        artistNotes: "There's something else buried in this signal. A designation I've never seen CRI use before — Subject 89.\n\nWhatever it is, it's in Belltown. That's the next place we need eyes on."
    }
];

// ==========================================
// STATIC MAIN-SEQUENCE NODES (MONEY / SKETCH / EXIT)
// Every operative profile (MONEY, SKETCH or EXIT) eventually needs all three of
// these — SEQUENCES above just changes the order. Replaces the T3S keyword
// search in getArtifactForType while CLOSED_LOOP_DEMO is on, so the clues shown
// on the map are always this show's content, never whatever T3S resolves to.
// Edit the `desc` (pre-scan clue) and `text`/`artistNotes` (post-scan) freely —
// plain strings, no T3S needed.
// ==========================================
const STATIC_MAIN_NODES = {
    MONEY: {
        id: 'static-money',
        code: 'RANSOM-200K',
        title: 'The Ransom Bills',
        lat: VENUE.lat, lng: VENUE.lng,
        desc: "Locate the irradiated currency. CRI's tracer bills are still bleeding chronal static — the trail runs hot near the drop point.",
        text: "[ CRI ASSET LOG — RECOVERED CURRENCY ]<br/><br/>Serial-tagged bills from the original ransom drop, corroded and warm to the touch. Chronal residue reads active — someone has been handling this cash recently. Decades after the jump, it shouldn't still be radioactive. Someone's been shuttling it back and forth.",
        artistNotes: "Found the money. It's still hot — like it just changed hands five minutes ago, not fifty years ago.\n\nCRI's been quietly recovering these bills for years and burying the story. Bob's not hoarding this cash. Someone else is moving it."
    },
    SKETCH: {
        id: 'static-sketch',
        code: 'COMPOSITE-71',
        title: 'The Composite Sketch',
        lat: VENUE.lat, lng: VENUE.lng,
        desc: "Locate the temporal echo. Witnesses keep describing the same face across decades — CRI calls it a resonance ghost.",
        text: "[ CRI ASSET LOG — WITNESS COMPOSITE ]<br/><br/>Multiple composite sketches, filed forty years apart, of the same face. CRI's official line is coincidence. The bone structure, the eyes — it's not coincidence. It's the same man, refusing to age on schedule.",
        artistNotes: "This sketch shouldn't exist twice. Same guy, same face, forty years apart, filed by two different sketch artists who never met.\n\nCRI knows exactly why. They're just not telling anyone who he really is."
    },
    EXIT: {
        id: 'static-exit',
        code: 'DROPZONE-305',
        title: 'The Drop Zone',
        lat: VENUE.lat, lng: VENUE.lng,
        desc: "Find the exit portal. Somewhere along his vector, Flight 305's aft stairs opened onto more than just Washington air.",
        text: "CRI FIELD NOTE — EXIT VECTOR CONFIRMED. Aft airstair deployed at low altitude over dense timberland. Standard jump physics do not account for the total absence of a body, a chute, or wreckage. The exit point reads as a seam, not a landing site.",
        artistNotes: "He jumped off that plane and just... didn't land. Not here, not in this decade.\n\nCRI keeps calling it a disappearance. It's not a disappearance. It's a door."
    }
};

const NODE_CONFIG = {
    'MONEY': { profile: 'TRACK THE RANSOM', desc: 'Locate the irradiated currency.', color: '#10b981', textClass: 'text-green-400', borderClass: 'border-green-500', bgClass: 'bg-green-900/20', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>` },
    'SKETCH': { profile: 'TRACK THE SUSPECT', desc: 'Locate the temporal echo.', color: '#f97316', textClass: 'text-orange-400', borderClass: 'border-orange-500', bgClass: 'bg-orange-900/20', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>` },
    'EXIT': { profile: 'THE DROP ZONE', desc: 'Find the exit portal.', color: '#a855f7', textClass: 'text-purple-400', borderClass: 'border-purple-500', bgClass: 'bg-purple-900/20', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 12H16c-.7 2-2 3-4 3s-3.3-1-4-3H2.5"/><path d="M5.5 5.1L2 12v6c0 1.1.9 2 2 2h16a2 2 0 002-2v-6l-3.4-6.9A2 2 0 0017 4h-10c-.8 0-1.5.5-1.8 1.1z"/></svg>` }
};

export default function App() {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const playerMarker = useRef(null);
    const dynamicLayer = useRef(null);

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
    const [showRupture, setShowRupture] = useState(false);
    const [activeArtist, setActiveArtist] = useState(null);

    // DEV HARNESS — enabled with ?debug=1 in the URL. Never shows for players.
    const [debugMode] = useState(() => {
        try { return new URLSearchParams(window.location.search).has('debug'); }
        catch { return false; }
    });
    const [debugOpen, setDebugOpen] = useState(true);
    
    const [hackerIntroPhase, setHackerIntroPhase] = useState(0); 
    const [hackerColdDropPhase, setHackerColdDropPhase] = useState(0); 
    const [pendingColdDropMedia, setPendingColdDropMedia] = useState(null);
    const [hackerInterludePhase, setHackerInterludePhase] = useState(0); 
    const [interludeLines, setInterludeLines] = useState([]);
    const [pendingInterludeMedia, setPendingInterludeMedia] = useState(null);
    const [hackerEndPhase, setHackerEndPhase] = useState(0); 
    
    const [hackerStep, setHackerStep] = useState(0); 
    const [userAlias, setUserAlias] = useState('');
    const [userEmail, setUserEmail] = useState('');
    const [isTransmitting, setIsTransmitting] = useState(false);

    const [gameState, setGameState] = useState(() => {
        const saved = localStorage.getItem('timeline_protocol_flight305_v3');
        return saved ? JSON.parse(saved) : {
            hasSeenTutorial: false,
            hackerIntroDone: false,
            selectedPath: null,
            currentStepIndex: 0,
            unlockedNodes: [],
            unlockedArtists: [],
            gameComplete: false
        };
    });

    const isArtistUnlocked = (artistId) => (gameState.unlockedArtists || []).includes(artistId);

    useEffect(() => localStorage.setItem('timeline_protocol_flight305_v3', JSON.stringify(gameState)), [gameState]);

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
            localStorage.removeItem('timeline_protocol_flight305_v3');
            window.location.reload();
        }
    };

    const handlePathSelection = (pathKey) => {
        setAnimatingSelection(pathKey);
        setTimeout(() => {
            setGameState(prev => ({ ...prev, selectedPath: pathKey }));
            setAnimatingSelection(null);
            setBootPhase(2.5); // Go to Field Manual
        }, 1500);
    };

    const getArtifactForType = (type) => {
        // Closed-loop demo: always this show's hardcoded node, never a T3S keyword
        // guess (that's how "TOM" / old-show clues were leaking through before).
        if (CLOSED_LOOP_DEMO) return STATIC_MAIN_NODES[type] || null;

        const allItems = getAllItems();
        return allItems.find(a => {
            const everything = `${a.title || ''} ${a.name || ''} ${a.location || ''} ${a.desc || ''} ${a.lore || ''} ${a.artistNotes || ''}`.toLowerCase();
            if (type === 'MONEY' && (everything.includes('money') || everything.includes('ransom') || everything.includes('cash'))) return true;
            if (type === 'SKETCH' && (everything.includes('sketch') || everything.includes('cooper') || everything.includes('suspect'))) return true;
            if (type === 'EXIT' && (everything.includes('exit') || everything.includes('parachute') || everything.includes('forest') || everything.includes('drop'))) return true;
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
            if (!gameState.selectedPath || gameState.gameComplete) return showToast("NO ACTIVE NODE TO OVERRIDE.", "error");
            const currentSequence = SEQUENCES[gameState.selectedPath];
            const activeType = currentSequence[gameState.currentStepIndex];
            const targetArtifact = getArtifactForType(activeType);
            
            if (targetArtifact) {
                showToast("SUDO OVERRIDE ACCEPTED.", "success");
                triggerNodeUnlock(targetArtifact, activeType, currentSequence);
                return;
            }
        }

        if (scanCode === 'TAG-ENDGAME-OVERRIDE') {
            showToast("ENDGAME OVERRIDE ACCEPTED.", "success");
            playGlitchSound();
            setHackerEndPhase(1);
            setTimeout(() => setHackerEndPhase(2), 800);
            setGameState(prev => ({ ...prev, gameComplete: true }));
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

        // Check if this scan matches the current required step in their sequence
        let activeType = null;
        let currentSequence = null;
        if (gameState.selectedPath && !gameState.gameComplete) {
            currentSequence = SEQUENCES[gameState.selectedPath];
            activeType = currentSequence[gameState.currentStepIndex];
            const expectedArtifact = getArtifactForType(activeType);
            
            if (expectedArtifact && expectedArtifact.id === targetItem.id) {
                setDecrypting(true);
                setTimeout(() => {
                    setDecrypting(false);
                    triggerNodeUnlock(targetItem, activeType, currentSequence);
                }, 2500);
                return;
            }
        }

        // Random sticker or rabbit hole
        setDecrypting(true);
        setTimeout(() => {
            setDecrypting(false);
            
            if (!gameState.hackerIntroDone) {
                setBootPhase(3);
                // Unlock immediately — the intro cutscene used to swallow this scan:
                // ACCEPT OVERRIDE only flipped hackerIntroDone and never touched
                // pendingInterludeMedia, so the very first tag a player ever scanned
                // vanished instead of landing in the vault.
                setGameState(prev => ({ ...prev, hasSeenTutorial: true, unlockedNodes: [...prev.unlockedNodes, { id: targetItem.id, type: 'MANUAL', lat: targetItem.lat, lng: targetItem.lng }] }));
                playGlitchSound();
                setHackerIntroPhase(1);
                setTimeout(() => setHackerIntroPhase(2), 800);
                setPendingInterludeMedia(targetItem);
                return;
            }

            const customHackerText = targetItem.artistNotes || "";
            const lines = customHackerText ? stripHtmlToLines(customHackerText) : ["I broke the CRI encryption on this node. Adding the file to your Data Vault now."];
            
            setInterludeLines([isRabbitHole ? `[ DEEP MATRIX NODE: ${edgeTrack} ]` : "[ FIREWALL BYPASSED ]", ...lines]);
            setPendingInterludeMedia(targetItem);
            setGameState(prev => ({ ...prev, unlockedNodes: [...prev.unlockedNodes, { id: targetItem.id, type: 'MANUAL', lat: targetItem.lat, lng: targetItem.lng }] }));
            
            playGlitchSound();
            setHackerInterludePhase(1);
            setTimeout(() => setHackerInterludePhase(2), 800);
        }, 2500);
    };

    const triggerNodeUnlock = (targetArtifact, activeType, currentSequence) => {
        const isAlreadyUnlocked = gameState.unlockedNodes.some(n => n.id === targetArtifact.id);
        if (isAlreadyUnlocked) return;

        const nextStep = gameState.currentStepIndex + 1;
        const isComplete = nextStep >= currentSequence.length;
        
        setGameState(prev => ({
            ...prev,
            unlockedNodes: [...prev.unlockedNodes, { id: targetArtifact.id, type: activeType, lat: targetArtifact.lat, lng: targetArtifact.lng }],
            currentStepIndex: nextStep,
            gameComplete: isComplete
        }));

        if (isComplete) {
            playGlitchSound();
            setHackerEndPhase(1);
            setTimeout(() => setHackerEndPhase(2), 800);
        } else if (gameState.currentStepIndex === 0 && !gameState.hackerIntroDone) {
            setPendingInterludeMedia(targetArtifact);
            playGlitchSound();
            setHackerIntroPhase(1);
            setTimeout(() => setHackerIntroPhase(2), 800);
        } else {
            const customHackerText = targetArtifact.artistNotes || "";
            const lines = customHackerText ? stripHtmlToLines(customHackerText) : ["I broke the CRI encryption on this node. Adding the file to your Data Vault now."];
            setInterludeLines([`[ NODE SECURED: ${targetArtifact.title} ]`, ...lines]);
            setPendingInterludeMedia(targetArtifact);
            playGlitchSound();
            setHackerInterludePhase(1);
            setTimeout(() => setHackerInterludePhase(2), 800);
        }
    };

    useEffect(() => {
        // NOTE: no longer gated on bootPhase — the map builds immediately so it is
        // visible behind the cinematic splash screens.
        if (activeTab !== 'MAP' || !mapRef.current) return;

        if (!mapInstance.current) {
            const center = CLOSED_LOOP_DEMO ? VENUE : SEATTLE_CENTER;
            const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([center.lat, center.lng], CLOSED_LOOP_DEMO ? 16 : 13);
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
            const venueSvg = `<div style="color:#06b6d4; filter:drop-shadow(0 0 10px #06b6d4);"><svg viewBox="0 0 24 24" fill="currentColor" class="w-9 h-9"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg></div>`;
            L.marker([VENUE.lat, VENUE.lng], { icon: L.divIcon({ html: venueSvg, className: 'map-overlay', iconSize: [36,36], iconAnchor: [18,36] }) })
                .bindTooltip(VENUE.label, { permanent: false, direction: 'top' })
                .addTo(dynamicLayer.current);
        }

        const vectorPoints = [];
        gameState.unlockedNodes.forEach(node => {
            if (!node.lat || !node.lng) return;
            vectorPoints.push([node.lat, node.lng]);
            const svgHtml = `<div style="color:#00ff41; filter:drop-shadow(0 0 10px #00ff41);"><svg viewBox="0 0 24 24" fill="currentColor" class="w-8 h-8"><circle cx="12" cy="12" r="8"></circle></svg></div>`;
            L.marker([node.lat, node.lng], { icon: L.divIcon({ html: svgHtml, className: 'map-overlay', iconSize: [32,32], iconAnchor: [16,16] }) }).addTo(dynamicLayer.current);
        });

        if (vectorPoints.length > 1) {
            L.polyline(vectorPoints, { color: '#a855f7', weight: 4, dashArray: '10, 15', opacity: 0.8, className: 'vector-line' }).addTo(dynamicLayer.current);
        }

    }, [activeTab, gameState, artifactsDb, bootPhase]);

    const handleTagRegistration = async (e) => {
        if (e) e.preventDefault();
        
        if (!userAlias.trim() || !userEmail.trim()) {
            return showToast("ENTER ALIAS AND FREQUENCY.", "error");
        }
        
        setIsTransmitting(true);
        
        try {
            const FORM_ENDPOINT = "https://formspree.io/f/xrededjy"; 
            
            const response = await fetch(FORM_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ alias: userAlias, email: userEmail, source: 'Flight 305 V1' })
            });

            if (response.ok) {
                setHackerStep(1); 
            } else {
                showToast("TRANSMISSION FAILED. TRY AGAIN.", "error");
            }
        } catch(err) {
            console.error("Form Error:", err);
            showToast("NETWORK INTERFERENCE. CHECK CONNECTION.", "error");
        } finally {
            setIsTransmitting(false);
        }
    };

    const getActiveClue = () => {
        if (!gameState.selectedPath || gameState.gameComplete) return null;
        const targetArtifact = getArtifactForType(SEQUENCES[gameState.selectedPath][gameState.currentStepIndex]);
        if (!targetArtifact) return "AWAITING T3S UPLINK FOR NEXT SECTOR...";
        return targetArtifact.desc || targetArtifact.lore || "INVESTIGATE THE AREA.";
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
                
                .hacker-bg { background-color: #050505; background-image: radial-gradient(rgba(0, 255, 65, 0.15) 1px, transparent 1px); background-size: 20px 20px; }
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
                            <span className="block">FAILED</span>
                            <span className="block">FLIGHT</span>
                            <span className="block">PLAN</span>
                        </h1>
                        <p className="mt-8 text-[10px] md:text-xs font-mono text-yellow-600/80 uppercase tracking-[0.4em] text-center">
                            Seattle &nbsp;//&nbsp; Sector 305
                        </p>
                    </div>
                </div>
            )}

            {/* BOOT SEQUENCE 2: THE CHOICE MENU */}
            {bootPhase === 2 && hackerColdDropPhase === 0 && !showSandbox && (
                <div className="fixed inset-0 bg-[#020617]/95 z-[9000] flex items-center justify-center p-4 backdrop-blur-xl fade-in">
                    <div className="glass-panel w-full max-w-lg p-8 rounded-lg shadow-[0_0_50px_rgba(6,182,212,0.1)] flex flex-col gap-6 text-center">
                        <h2 className="text-2xl font-black text-white tracking-widest flex items-center justify-center gap-2">
                            <Icons.Activity className="text-cyan-500" /> SYSTEM ACCESS
                        </h2>
                        <p className="text-xs text-gray-400 font-mono">Select your protocol.</p>
                        
                        <button onClick={() => setBootPhase(2.5)} className="w-full py-4 bg-cyan-950/30 border border-cyan-500 text-cyan-400 font-bold uppercase tracking-widest text-xs transition-colors hover:bg-cyan-900 rounded">
                            1. ENTER THE TIMELINE PROTOCOL (ARG)
                        </button>
                        
                        <button onClick={() => setShowSandbox(true)} className="w-full py-4 bg-[#00ff41]/20 border border-[#00ff41] text-[#00ff41] font-bold uppercase tracking-widest text-xs transition-colors hover:bg-[#00ff41] hover:text-black rounded flex items-center justify-center gap-2">
                            <Icons.AlertTriangle size={14} className="animate-pulse" />
                            2. SANDBOX &mdash; ANOMALY DETECTED
                        </button>
                    </div>
                </div>
            )}

            {/* THE SANDBOX / ANOMALY PAGE */}
            {showSandbox && (
                <div className="fixed inset-0 bg-[#020617]/95 z-[9500] flex items-center justify-center p-4 backdrop-blur-xl fade-in">
                    <div className="glass-panel w-full max-w-lg p-6 rounded-lg shadow-[0_0_50px_rgba(0,255,65,0.1)] flex flex-col max-h-[90vh]">
                        <div className="flex justify-between items-start mb-4 border-b border-[#00ff41]/30 pb-4 shrink-0">
                            <div>
                                <h2 className="text-xl font-black text-[#00ff41] tracking-widest flex items-center gap-2">
                                    <Icons.AlertTriangle size={18} className="animate-pulse" /> ANOMALY DETECTED
                                </h2>
                                <p className="text-[10px] font-mono text-[#00ff41]/60 mt-1 tracking-widest uppercase">
                                    SECTOR: THE SANDBOX &nbsp;//&nbsp; EVENT: BOB LOVES DOORS 3
                                </p>
                            </div>
                            <button onClick={() => setShowSandbox(false)} className="text-[#00ff41] hover:text-white transition-colors p-2"><Icons.X /></button>
                        </div>

                        <div className="overflow-y-auto custom-scrollbar pr-2 space-y-4">
                            <p className="text-xs text-gray-300 font-mono text-center leading-relaxed">
                                Live music. Two Temporal Artists. Rewards.<br/>
                                <span className="text-[#00ff41]">Sustained resonance event in progress. Head directly to The Sandbox.</span>
                            </p>

                            <div className="bg-[#00ff41]/10 border border-[#00ff41]/50 p-3 rounded text-center">
                                <p className="text-[10px] font-mono text-[#00ff41] uppercase tracking-widest leading-relaxed">
                                    See a sticker marked &ldquo;ANOMALY DETECTED&rdquo;? Tap it with your phone &mdash; or scan it under MANUAL SCAN &mdash; to decrypt hidden CRI files.
                                </p>
                            </div>

                            <a href={STRIPE_LINK} target="_blank" rel="noopener noreferrer" className="block w-full text-center py-3 mb-6 border-2 border-[#00ff41] text-black bg-[#00ff41] hover:bg-black hover:text-[#00ff41] font-black font-mono text-xs uppercase transition-colors shadow-[0_0_15px_rgba(0,255,65,0.5)] rounded">
                                DONATE TO THE CATALYST (Suggested $20)
                            </a>

                            {/* TEMPORAL ARTISTS */}
                            <div className="space-y-3">
                                <h3 className="text-xs font-black text-cyan-400 uppercase tracking-widest flex items-center gap-2">
                                    <Icons.Brush size={14} /> TEMPORAL ARTISTS
                                </h3>

                                {TEMPORAL_ARTISTS.map(artist => {
                                    const unlocked = isArtistUnlocked(artist.id);
                                    return (
                                        <div key={artist.id} className="bg-black/50 p-4 rounded border" style={{ borderColor: `${artist.color}55` }}>
                                            <div className="flex justify-between items-start gap-3 mb-3">
                                                <div className="min-w-0">
                                                    <p className="text-[9px] font-mono uppercase tracking-widest mb-1" style={{ color: artist.color }}>{artist.id}</p>
                                                    <p className="text-base font-bold text-white leading-tight truncate">{artist.name}</p>
                                                    <p className="text-[10px] font-mono mt-1 uppercase tracking-widest" style={{ color: artist.color }}>
                                                        {unlocked ? artist.alias : 'STATUS: CLASSIFIED'}
                                                    </p>
                                                </div>
                                                {unlocked
                                                    ? <Icons.Unlock size={16} className="shrink-0 mt-1" style={{ color: artist.color }} />
                                                    : <Icons.Lock size={16} className="text-gray-600 shrink-0 mt-1" />}
                                            </div>

                                            <div className="flex flex-wrap gap-2 mb-3">
                                                <a href={artist.instagram} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono px-3 py-2 rounded border border-white/15 text-gray-300 hover:text-white hover:border-white/40 transition-colors">
                                                    {artist.instagramHandle}
                                                </a>
                                                {artist.website && (
                                                    <a href={artist.website} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono px-3 py-2 rounded border border-white/15 text-gray-300 hover:text-white hover:border-white/40 transition-colors">
                                                        WEBSITE
                                                    </a>
                                                )}
                                            </div>

                                            {unlocked ? (
                                                <button onClick={() => setActiveArtist(artist)} className="w-full py-3 rounded border font-mono text-[10px] font-bold uppercase tracking-widest transition-colors" style={{ borderColor: artist.color, color: artist.color }}>
                                                    [ OPEN DOSSIER ]
                                                </button>
                                            ) : (
                                                <div className="w-full py-3 rounded border border-red-500/30 bg-red-900/15 text-center">
                                                    <p className="text-[10px] font-mono text-red-400 uppercase tracking-widest">[ DOSSIER ENCRYPTED ]</p>
                                                    <p className="text-[9px] font-mono text-gray-600 mt-1">SCAN THE ARTIST&rsquo;S CRI TAG TO DECRYPT</p>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* RESTRICTED ZONE */}
                            <button
                                onClick={() => { playGlitchSound(); setShowRupture(true); }}
                                className="w-full text-left bg-red-950/30 border border-red-500/60 hover:bg-red-900/40 hover:border-red-500 transition-colors p-4 rounded"
                            >
                                <p className="text-xs font-black text-red-500 uppercase tracking-widest flex items-center gap-2 mb-1">
                                    <Icons.Radiation size={14} className="animate-pulse" /> RESTRICTED ZONE &mdash; BACK ROOM
                                </p>
                                <p className="text-[10px] font-mono text-red-300 leading-relaxed">
                                    WARNING: TEMPORAL RUPTURE. NO UNAUTHORIZED PERSONNEL BEYOND THIS POINT.
                                </p>
                                <p className="text-[9px] font-mono text-red-700 uppercase tracking-widest mt-2">
                                    [ TAP FOR CRI ADVISORY ]
                                </p>
                            </button>
                        </div>
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

            {/* RESTRICTED ZONE: TEMPORAL RUPTURE ADVISORY */}
            {showRupture && (
                <div className="fixed inset-0 z-[9600] rupture-bg flex items-center justify-center p-4 overflow-y-auto fade-in">
                    <div className="w-full max-w-md border-2 border-red-600 bg-black/95 p-6 md:p-8 shadow-[0_0_50px_rgba(239,68,68,0.35)] my-auto rounded">
                        <Icons.Radiation size={56} className="text-red-500 mx-auto mb-6 animate-pulse drop-shadow-[0_0_15px_rgba(239,68,68,0.8)]" />

                        <h2 className="text-2xl md:text-3xl font-black text-red-500 text-center leading-tight tracking-widest mb-2 drop-shadow-[0_0_10px_rgba(239,68,68,0.6)]">
                            WARNING<br/>TEMPORAL RUPTURE
                        </h2>
                        <p className="text-[11px] font-mono text-red-400 text-center uppercase tracking-widest mb-6 border-y border-red-900/60 py-3">
                            NO UNAUTHORIZED PERSONNEL<br/>BEYOND THIS POINT
                        </p>

                        <div className="text-[11px] font-mono text-gray-300 leading-relaxed space-y-2 bg-red-950/20 border border-red-900/50 p-4 rounded">
                            <p className="text-red-600 uppercase tracking-widest text-[9px]">
                                // CRI CONTAINMENT NOTICE &mdash; SECTOR 305
                            </p>
                            <p>
                                The rear room of this venue is <span className="text-red-400">sealed</span>. Sustained
                                exposure to the standing wave has torn a rupture in the local timeline. It has not closed.
                            </p>
                            <p>
                                Field operatives are instructed to observe the boundary and report anomalies. Do not
                                attempt entry. Do not photograph the interior. Do not respond if something inside
                                addresses you by name.
                            </p>
                            <p className="text-red-500">
                                The Cascadia Resonance Institute is here to help.
                            </p>
                        </div>

                        <button
                            onClick={() => setShowRupture(false)}
                            className="mt-6 w-full py-4 border-2 border-red-600 text-red-500 hover:bg-red-600 hover:text-black font-black font-mono text-xs uppercase tracking-widest transition-colors rounded"
                        >
                            ACKNOWLEDGE &amp; WITHDRAW
                        </button>
                    </div>
                </div>
            )}

            {/* BOOT SEQUENCE 2.5: PLAYER MANUAL */}
            {bootPhase === 2.5 && hackerColdDropPhase === 0 && (
                <div className="fixed inset-0 bg-[#020617]/95 z-[9000] flex items-center justify-center p-4 backdrop-blur-xl fade-in">
                    <div className="glass-panel w-full max-w-lg p-8 rounded-lg shadow-[0_0_50px_rgba(6,182,212,0.1)] flex flex-col max-h-[90vh]">
                        <h2 className="text-xl font-bold text-cyan-400 uppercase tracking-widest mb-6 border-b border-cyan-900/30 pb-4 flex items-center gap-2">
                            <Icons.MapPin /> CRI FIELD MANUAL
                        </h2>
                        <div className="overflow-y-auto custom-scrollbar pr-2 space-y-6 text-sm text-gray-300 font-mono leading-relaxed">
                            <p>A temporal anomaly has fractured the city. We need field operatives to map the sector and stabilize the timeline.</p>
                            <ul className="space-y-4">
                                <li><strong className="text-cyan-400">1. LOCK YOUR PROFILE:</strong> Select your operative profile. This dictates your route.</li>
                                <li><strong className="text-cyan-400">2. TRACK COORDINATES:</strong> Follow the clues on your Tactical Map. When you get close, your phone’s GPS will automatically decrypt the node.</li>
                                <li><strong className="text-cyan-400">3. SCAN ASSETS:</strong> Tap physical CRI RFID stickers hidden on doors and art installations to bypass local firewalls and collect Lore.</li>
                                <li><strong className="text-cyan-400">4. CLAIM YOUR GEAR:</strong> Follow your clues to the final destination. Stabilize the timeline to receive your VIP Clearance Code.</li>
                            </ul>
                        </div>
                        <button onClick={() => { setGameState(prev => ({ ...prev, hasSeenTutorial: true })); setBootPhase(3); }} className="mt-8 shrink-0 w-full py-4 bg-cyan-950/30 border border-cyan-800 hover:bg-cyan-900 text-cyan-400 font-bold uppercase tracking-widest text-xs transition-colors rounded">
                            ACKNOWLEDGE DIRECTIVES
                        </button>
                    </div>
                </div>
            )}

            {/* STREET-FIRST HACKER COLD DROP */}
            {hackerColdDropPhase > 0 && (
                <div className={`fixed inset-0 z-[9500] hacker-bg flex flex-col items-center justify-center p-6 ${hackerColdDropPhase === 1 ? 'screen-tear' : 'fade-in'}`}>
                    {hackerColdDropPhase >= 2 && (
                        <div className="w-full max-w-md border border-[#00ff41] bg-black/90 p-8 shadow-[0_0_30px_rgba(0,255,65,0.2)]">
                            <Icons.Cpu size={48} className="text-[#00ff41] mb-6 animate-pulse mx-auto text-shadow-glow" />
                            <TypewriterText 
                                lines={[
                                    "[ UNREGISTERED DEVICE DETECTED ]",
                                    "You bypassed the perimeter check and went straight for the physical data. I like your style. I'm hijacking your scanner.",
                                    "Bob didn't show up today. CRI is tracking him... We have 14 days to prepare for what comes next.",
                                    "I am decrypting the tag you just found. Read the file, then select a profile on the map to help me find the rest."
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

            {/* NORMAL HACKER INTRO HIJACK */}
            {hackerIntroPhase > 0 && !gameState.hackerIntroDone && bootPhase === 3 && hackerColdDropPhase === 0 && (
                <div className={`fixed inset-0 z-[8000] hacker-bg flex flex-col items-center justify-center p-6 ${hackerIntroPhase === 1 ? 'screen-tear' : 'fade-in'}`}>
                    {hackerIntroPhase >= 2 && (
                        <div className="w-full max-w-md border border-[#00ff41] bg-black/90 p-8 shadow-[0_0_30px_rgba(0,255,65,0.2)]">
                            <Icons.Cpu size={48} className="text-[#00ff41] mb-6 animate-pulse mx-auto text-shadow-glow" />
                            <TypewriterText 
                                lines={[
                                    "[ FIREWALL BYPASSED. ]",
                                    "I see you just logged that node for the Cascadia Resonance Institute. Don't trust them. They aren't here to help.",
                                    "Bob didn't just vanish in 1971. He jumped from Flight 305. CRI is using this app to track his resonance trail.",
                                    "I've hijacked your scanner. Keep walking your vector, but from now on, the data you collect comes to me. Let's find out what CRI is hiding."
                                ]} 
                                onComplete={() => setHackerIntroPhase(3)} 
                            />
                            {hackerIntroPhase === 3 && (
                                <button onClick={() => {
                                    setGameState(prev => ({ ...prev, hackerIntroDone: true }));
                                    if (pendingInterludeMedia) {
                                        setActiveMedia(pendingInterludeMedia);
                                        setHasNewVaultItem(true);
                                    }
                                }} className="mt-8 fade-in w-full py-4 border border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-black font-bold font-mono text-xs uppercase transition-colors">
                                    ACCEPT OVERRIDE
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* HACKER INTERLUDE (Mid-Game Unlocks) */}
            {hackerInterludePhase > 0 && bootPhase >= 2 && (
                <div className={`fixed inset-0 z-[7000] hacker-bg flex flex-col items-center justify-center p-6 ${hackerInterludePhase === 1 ? 'screen-tear' : 'fade-in'}`}>
                    {hackerInterludePhase >= 2 && (
                        <div className="w-full max-w-md border border-[#00ff41] bg-black/90 p-8 shadow-[0_0_30px_rgba(0,255,65,0.2)]">
                            <Icons.Cpu size={48} className="text-[#00ff41] mb-6 animate-pulse mx-auto text-shadow-glow" />
                            <TypewriterText 
                                lines={interludeLines} 
                                onComplete={() => setHackerInterludePhase(3)} 
                            />
                            {hackerInterludePhase === 3 && (
                                <button onClick={() => {
                                    setHackerInterludePhase(0);
                                    if (pendingInterludeMedia?.isRabbitHole) {
                                        setRabbitHoleItem(pendingInterludeMedia);
                                    } else {
                                        setActiveMedia(pendingInterludeMedia);
                                        setHasNewVaultItem(true);
                                    }
                                }} className="mt-8 fade-in w-full py-4 border border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-black font-bold font-mono text-xs uppercase transition-colors">
                                    ACCESS DECRYPTED FILE
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* END GAME HACKER HIJACK */}
            {hackerEndPhase > 0 && gameState.gameComplete && bootPhase >= 2 && (
                <div className={`fixed inset-0 z-[6000] hacker-bg flex flex-col items-center justify-center p-6 overflow-y-auto ${hackerEndPhase === 1 ? 'screen-tear' : 'fade-in'}`}>
                    {hackerEndPhase >= 2 && (
                        <div className="w-full max-w-md border border-[#00ff41] bg-black/90 p-8 shadow-[0_0_30px_rgba(0,255,65,0.2)] my-auto">
                            <Icons.Cpu size={48} className="text-[#00ff41] mb-6 animate-pulse mx-auto text-shadow-glow" />
                            
                            {hackerStep === 0 && (
                                <div>
                                    <TypewriterText 
                                        lines={[
                                            "[ FIREWALL BYPASSED ]",
                                            "We secured the primary nodes, but the grid is massive.",
                                            "He didn't land here. The timeline is scattering into Belltown.",
                                            "Last clean ping before the signal died: 2nd Ave, Belltown — near an old DSHS door that shouldn't still be standing. Coordinates are locking on your map now.",
                                            "CRI is closing in. I need a dedicated crew to protect his trail and unlock the rest of the city before the deadline.",
                                            "If you want to fund the operation and keep this network online, route your support here:"
                                        ]} 
                                        onComplete={() => setHackerEndPhase(3)} 
                                    />
                                    {hackerEndPhase === 3 && (
                                        <div className="fade-in">
                                            <a href={STRIPE_LINK} target="_blank" rel="noopener noreferrer" className="block w-full text-center py-3 my-4 border-2 border-[#00ff41] text-black bg-[#00ff41] hover:bg-black hover:text-[#00ff41] font-black font-mono text-sm uppercase transition-colors shadow-[0_0_15px_rgba(0,255,65,0.5)]">
                                                [ FUND THE OPERATION ]
                                            </a>
                                            <p className="font-mono text-[#00ff41] text-sm mb-4 text-shadow-glow">
                                                The trail doesn't end here. It picks back up Saturday at Belltown Blast — same network, new sector.
                                            </p>
                                            <a href={`https://www.google.com/maps/dir/?api=1&destination=${BELLTOWN.lat},${BELLTOWN.lng}`} target="_blank" rel="noopener noreferrer" className="block w-full text-center py-4 mb-6 border-2 border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-black font-black font-mono text-sm uppercase transition-colors">
                                                [ GET DIRECTIONS TO BELLTOWN ]
                                            </a>
                                            <p className="font-mono text-[#00ff41] text-sm mb-6 text-shadow-glow">
                                                Enter your operative alias and secure frequency below to join the network — you'll be the first to know when the Belltown signal goes live.
                                            </p>
                                            <form onSubmit={handleTagRegistration} className="flex flex-col gap-3 mt-4">
                                                <input type="text" value={userAlias} onChange={e=>setUserAlias(e.target.value)} className="w-full p-4 bg-black border border-[#00ff41] text-[#00ff41] font-mono outline-none focus:shadow-[0_0_15px_rgba(0,255,65,0.5)]" placeholder="OPERATIVE ALIAS" />
                                                <input type="email" value={userEmail} onChange={e=>setUserEmail(e.target.value)} className="w-full p-4 bg-black border border-[#00ff41] text-[#00ff41] font-mono outline-none focus:shadow-[0_0_15px_rgba(0,255,65,0.5)]" placeholder="SECURE FREQUENCY (EMAIL)" />
                                                <button type="submit" disabled={isTransmitting} className="w-full py-4 bg-[#00ff41]/20 border border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-black font-bold font-mono text-xs uppercase transition-colors disabled:opacity-50">
                                                    {isTransmitting ? 'TRANSMITTING...' : 'TRANSMIT'}
                                                </button>
                                            </form>
                                        </div>
                                    )}
                                </div>
                            )}

                            {hackerStep === 1 && (
                                <div className="fade-in text-center">
                                    <p className="font-mono text-[#00ff41] text-sm mb-6 text-shadow-glow">
                                        Registration confirmed. Your frequency is on the secure roster.<br/><br/>
                                        The trail picks back up Saturday at Belltown Blast. Same network, new sector.
                                    </p>
                                    <a href={`https://www.google.com/maps/dir/?api=1&destination=${BELLTOWN.lat},${BELLTOWN.lng}`} target="_blank" rel="noopener noreferrer" className="block w-full text-center py-4 mb-6 border-2 border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-black font-black font-mono text-sm uppercase transition-colors">
                                        [ GET DIRECTIONS TO BELLTOWN ]
                                    </a>
                                    <p className="font-mono text-[#00ff41] text-[10px] animate-pulse">Severing connection...</p>
                                </div>
                            )}
                        </div>
                    )}
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
                    <button onClick={() => setBootPhase(2)} className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-cyan-400 transition-colors border border-gray-800 px-3 py-1.5 rounded">
                        [ INFO / SANDBOX ]
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
                    <div className="flex-1 relative w-full border-b border-cyan-900/30">
                        <div ref={mapRef} className="w-full h-full absolute inset-0 z-10"></div>
                    </div>

                    <div className="p-4 md:p-6 bg-[#020617] shrink-0 z-[500] shadow-[0_-10px_30px_rgba(0,0,0,0.8)] relative">
                        <div className="max-w-4xl mx-auto flex flex-col">
                            {!gameState.selectedPath && (
                                <div className="fade-in text-center relative">
                                    <h3 className="text-lg font-black uppercase tracking-widest text-cyan-400 mb-2">SELECT OPERATIVE PROFILE</h3>
                                    <p className="text-xs text-cyan-700 font-mono mb-1">Choose your assignment. This will lock your trajectory.</p>
                                    <p className="tap-hint text-[10px] text-white font-bold uppercase tracking-widest mb-4">👇 Tap one to begin 👇</p>
                                    <div className="grid grid-cols-3 gap-2 md:gap-4">
                                        {['MONEY', 'SKETCH', 'EXIT'].map(pathKey => {
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

                            {gameState.selectedPath && !gameState.gameComplete && (
                                <div className="fade-in">
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-cyan-500 flex items-center gap-2"><Icons.Activity size={12} className="animate-pulse" /> ACTIVE NODE CLUE [{gameState.currentStepIndex + 1}/3]</h3>
                                        <span className={`text-[10px] font-mono font-bold ${NODE_CONFIG[gameState.selectedPath].textClass}`}>PROFILE: {NODE_CONFIG[gameState.selectedPath].profile}</span>
                                    </div>
                                    <div className="p-4 glass-panel rounded text-sm text-gray-300 font-mono leading-relaxed" dangerouslySetInnerHTML={{ __html: getActiveClue() }}></div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className={`absolute inset-0 bg-[#020617] p-6 transition-opacity duration-300 overflow-y-auto custom-scrollbar ${activeTab === 'VAULT' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <div className="max-w-4xl mx-auto">
                        <div className="flex justify-between items-center mb-6 border-b border-cyan-900/30 pb-4">
                            <h2 className="text-lg font-bold text-cyan-500 uppercase tracking-widest flex items-center gap-2"><Icons.Database size={18} /> SECURED DATA VAULT</h2>
                            <button onClick={handleReset} className="text-[9px] text-gray-700 hover:text-red-500 font-bold uppercase tracking-widest transition-colors">[ PURGE MEMORY ]</button>
                        </div>
                        
                        {gameState.unlockedNodes.length === 0 ? (
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
                                <div>path: <span className="text-white">{gameState.selectedPath || 'none'}</span> &nbsp; step: <span className="text-white">{gameState.currentStepIndex}</span></div>
                                <div>unlocked: <span className="text-white">{gameState.unlockedNodes.length}</span> &nbsp; complete: <span className="text-white">{String(gameState.gameComplete)}</span></div>
                                <div className={getAllItems().length === 0 ? 'text-red-400 font-bold' : 'text-gray-400'}>
                                    firestore: <span className="text-white">{artifactsDb.length}a / {ideasDb.length}i / {journalsDb.length}j</span>
                                    {getAllItems().length === 0 && <div className="text-red-400">NO DATA — check firebase.js appId</div>}
                                </div>
                                <div>matrix: <span className="text-white">{(matrixDb.nodes || []).length} nodes</span></div>
                            </div>

                            {/* WHAT THE KEYWORD MATCHER RESOLVED TO */}
                            <div className="border-t border-fuchsia-900 pt-2">
                                <div className="text-fuchsia-400 mb-1">NODE RESOLUTION</div>
                                {['MONEY', 'SKETCH', 'EXIT'].map(t => {
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
                                <button onClick={() => processScan('TAG-NIGHTMARE-OVERRIDE')} className="w-full text-left px-2 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">force-unlock current node</button>
                                <button onClick={() => processScan('TAG-ENDGAME-OVERRIDE')} className="w-full text-left px-2 py-1.5 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800">jump to endgame</button>
                                <button onClick={handleReset} className="w-full text-left px-2 py-1.5 bg-red-950 border border-red-800 text-red-400 rounded hover:bg-red-900">purge memory + reload</button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}