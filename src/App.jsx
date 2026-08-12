import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { db, appId } from './firebase'; 
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { Icons } from './Icons'; 

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
// Default center is now downtown Seattle
const SEATTLE_CENTER = { lat: 47.6062, lng: -122.3321 };

const SEQUENCES = {
    'KEY': ['KEY', 'LOCK', 'KNOB', 'JELLYFISH'],
    'LOCK': ['LOCK', 'KNOB', 'KEY', 'JELLYFISH'],
    'KNOB': ['KNOB', 'KEY', 'LOCK', 'JELLYFISH']
};

const NODE_CONFIG = {
    'KEY': { profile: 'THE SCIENTIST', desc: 'Analyze the resonance. Map the structure.', color: '#3b82f6', textClass: 'text-blue-400', borderClass: 'border-blue-500', bgClass: 'bg-blue-900/20', shape: 'SQUARE', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>` },
    'LOCK': { profile: 'THE GUARD', desc: 'Secure the perimeter. Contain the anomaly.', color: '#f97316', textClass: 'text-orange-400', borderClass: 'border-orange-500', bgClass: 'bg-orange-900/20', shape: 'CIRCLE', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="M10 15h4l-1.5 6h-1z"/></svg>` },
    'KNOB': { profile: 'THE SCOUT', desc: 'Reconnaissance. Open new pathways.', color: '#a855f7', textClass: 'text-purple-400', borderClass: 'border-purple-500', bgClass: 'bg-purple-900/20', shape: 'TRIANGLE', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>` }
};

const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; 
    const p1 = lat1 * Math.PI/180, p2 = lat2 * Math.PI/180;
    const dp = (lat2-lat1) * Math.PI/180, dl = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
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
    
    const [activeTab, setActiveTab] = useState('MAP');
    const [toast, setToast] = useState(null);
    const [decrypting, setDecrypting] = useState(false);
    const [activeMedia, setActiveMedia] = useState(null);
    const [rabbitHoleItem, setRabbitHoleItem] = useState(null); 
    const [hasNewVaultItem, setHasNewVaultItem] = useState(false);
    
    const [playerLoc, setPlayerLoc] = useState(null); 
    const [trackingState, setTrackingState] = useState('IDLE'); 
    const [animatingSelection, setAnimatingSelection] = useState(null);

    const [bootPhase, setBootPhase] = useState(0); 
    
    const [hackerIntroPhase, setHackerIntroPhase] = useState(0); 
    const [hackerInterludePhase, setHackerInterludePhase] = useState(0); 
    const [interludeLines, setInterludeLines] = useState([]);
    const [pendingInterludeMedia, setPendingInterludeMedia] = useState(null);
    const [hackerEndPhase, setHackerEndPhase] = useState(0); 

    const [gameState, setGameState] = useState(() => {
        const saved = localStorage.getItem('timeline_protocol_citywide');
        return saved ? JSON.parse(saved) : {
            hasSeenTutorial: false,
            hackerIntroDone: false,
            selectedPath: null,
            currentStepIndex: 0,
            unlockedNodes: [],
            clearedPaths: [], 
            gameComplete: false
        };
    });

    useEffect(() => localStorage.setItem('timeline_protocol_citywide', JSON.stringify(gameState)), [gameState]);

    // CINEMATIC BOOT SEQUENCE
    useEffect(() => {
        if (!gameState.hasSeenTutorial) {
            const t1 = setTimeout(() => setBootPhase(1), 3500); 
            const t2 = setTimeout(() => setBootPhase(2), 6500); 
            return () => { clearTimeout(t1); clearTimeout(t2); };
        } else {
            setBootPhase(3); 
        }
    }, [gameState.hasSeenTutorial]);

    useEffect(() => {
        if (!appId) return;
        const unsubArts = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'artifacts'), snap => setArtifactsDb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubIdeas = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'ideas'), snap => setIdeasDb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubJournals = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'journals'), snap => setJournalsDb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubMatrix = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'matrix', 'layout'), snap => { if (snap.exists()) setMatrixDb(snap.data()); });
        return () => { unsubArts(); unsubIdeas(); unsubJournals(); unsubMatrix(); };
    }, []);

    const getAllItems = () => [...artifactsDb, ...ideasDb, ...journalsDb];

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search || window.location.hash.split('?')[1]);
        const scanCode = urlParams.get('scan');
        if (scanCode && artifactsDb.length > 0) {
            processScan(scanCode.toUpperCase());
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, [artifactsDb]);

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    const handleReset = () => {
        if (window.confirm("WARNING: Purge device memory?")) {
            localStorage.removeItem('timeline_protocol_citywide');
            window.location.reload();
        }
    };

    const handlePathSelection = (pathKey) => {
        setAnimatingSelection(pathKey);
        setTimeout(() => {
            setGameState(prev => ({ ...prev, selectedPath: pathKey }));
            setAnimatingSelection(null);
            showToast(`${NODE_CONFIG[pathKey].profile} PROFILE LOCKED. PROCEED TO SECTOR.`);
        }, 1500);
    };

    const startTracking = () => {
        if (!navigator.geolocation) return setTrackingState('ERROR');
        setTrackingState('ACTIVE');
        navigator.geolocation.watchPosition(
            (pos) => setPlayerLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            (err) => { setTrackingState('ERROR'); showToast("GPS SIGNAL LOST.", "error"); },
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
        );
    };

    const getArtifactForType = (type) => {
        const allItems = [...artifactsDb, ...ideasDb, ...journalsDb];
        return allItems.find(a => {
            const loc = (a.location || '').toLowerCase();
            const title = (a.title || a.name || '').toLowerCase();
            if (type === 'KEY' && (loc.includes('throttle') || loc.includes('bottle') || title.includes('sector 1'))) return true;
            if (type === 'LOCK' && (loc.includes('10x20') || loc.includes('painter') || title.includes('sector 2'))) return true;
            if (type === 'KNOB' && (loc.includes('tertiary') || loc.includes('third') || loc.includes('pillar') || title.includes('sector 3'))) return true;
            if (type === 'JELLYFISH' && (loc.includes('jellyfish') || title.includes('catalyst') || title.includes('core'))) return true;
            return false;
        });
    };

    const getMatrixConnections = (mediaItem) => {
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

    const processScan = (scanCode) => {
        if (!scanCode) return;
        
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

        const edges = matrixDb?.edges || [];
        const nodes = matrixDb?.nodes || [];

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

        const customHackerText = targetItem.artistNotes || "";
        const lines = customHackerText ? stripHtmlToLines(customHackerText) : ["I broke the CRI encryption on this node. Adding the file to your Data Vault now."];
        
        setInterludeLines([isRabbitHole ? `[ DEEP MATRIX NODE: ${edgeTrack} ]` : "[ FIREWALL BYPASSED ]", ...lines]);
        setPendingInterludeMedia(targetItem);
        
        setGameState(prev => ({ ...prev, unlockedNodes: [...prev.unlockedNodes, { id: targetItem.id, type: 'MANUAL', lat: targetItem.lat, lng: targetItem.lng }] }));
        
        playGlitchSound();
        setHackerInterludePhase(1);
        setTimeout(() => setHackerInterludePhase(2), 800);
    };

    const triggerNodeUnlock = (targetArtifact, activeType, currentSequence) => {
        const isAlreadyUnlocked = gameState.unlockedNodes.some(n => n.id === targetArtifact.id);
        if (isAlreadyUnlocked) return;

        const nextStep = gameState.currentStepIndex + 1;
        const isComplete = nextStep >= currentSequence.length;
        
        if (isComplete) {
            playGlitchSound();
            setHackerEndPhase(1);
            setTimeout(() => setHackerEndPhase(2), 800);
        } else if (gameState.currentStepIndex === 0 && !gameState.hackerIntroDone) {
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

        setGameState(prev => ({
            ...prev,
            unlockedNodes: [...prev.unlockedNodes, { id: targetArtifact.id, type: activeType, lat: targetArtifact.lat, lng: targetArtifact.lng }],
            clearedPaths: [...prev.clearedPaths, activeType],
            currentStepIndex: nextStep,
            gameComplete: isComplete
        }));
    };

    useEffect(() => {
        if (activeTab !== 'MAP' || !mapRef.current || bootPhase !== 3) return;

        if (!mapInstance.current) {
            // Centers on Seattle by default, allows free roaming
            const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([SEATTLE_CENTER.lat, SEATTLE_CENTER.lng], 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
            
            dynamicLayer.current = L.layerGroup().addTo(map);
            mapInstance.current = map;

            map.on('click', (e) => setPlayerLoc({ lat: e.latlng.lat, lng: e.latlng.lng }));
        }

        if (playerLoc) {
            if (!playerMarker.current) {
                const dot = `<div style="width:14px;height:14px;background:#06b6d4;border-radius:50%;box-shadow:0 0 15px #06b6d4;border:2px solid #fff;"></div>`;
                const icon = L.divIcon({ className: 'player-pin', html: dot, iconSize: [14,14], iconAnchor: [7,7] });
                playerMarker.current = L.marker([playerLoc.lat, playerLoc.lng], { icon, zIndexOffset: 1000 }).addTo(mapInstance.current);
                mapInstance.current.flyTo([playerLoc.lat, playerLoc.lng], 16, { animate: true, duration: 1 });
            } else {
                playerMarker.current.setLatLng([playerLoc.lat, playerLoc.lng]);
            }
        }

        dynamicLayer.current.clearLayers();

        const vectorPoints = [];
        gameState.unlockedNodes.forEach(node => {
            if (!node.lat || !node.lng) return;
            vectorPoints.push([node.lat, node.lng]);
            const config = NODE_CONFIG[node.type] || { color: '#00ff41', icon: `<circle cx="12" cy="12" r="8"></circle>` };
            const svgHtml = `<div style="color:${config.color}; filter:drop-shadow(0 0 10px ${config.color});"><svg viewBox="0 0 24 24" fill="currentColor" class="w-8 h-8">${config.icon}</svg></div>`;
            L.marker([node.lat, node.lng], { icon: L.divIcon({ html: svgHtml, className: 'map-overlay', iconSize: [32,32], iconAnchor: [16,16] }) }).addTo(dynamicLayer.current);
        });

        if (vectorPoints.length > 1) {
            L.polyline(vectorPoints, { color: '#a855f7', weight: 4, dashArray: '10, 15', opacity: 0.8, className: 'vector-line' }).addTo(dynamicLayer.current);
        }

        if (gameState.selectedPath && !gameState.gameComplete && playerLoc) {
            const currentSequence = SEQUENCES[gameState.selectedPath];
            const activeType = currentSequence[gameState.currentStepIndex];
            const targetArtifact = getArtifactForType(activeType);

            if (targetArtifact && targetArtifact.lat && targetArtifact.lng) {
                const dist = getDistance(playerLoc.lat, playerLoc.lng, parseFloat(targetArtifact.lat), parseFloat(targetArtifact.lng));
                if (dist <= (parseFloat(targetArtifact.radius) || 30)) {
                    triggerNodeUnlock(targetArtifact, activeType, currentSequence);
                }
            }
        }
    }, [activeTab, playerLoc, gameState, artifactsDb, bootPhase]);

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
                .vector-line { animation: dash 20s linear infinite; }
                @keyframes dash { to { stroke-dashoffset: -1000; } }
                .leaflet-container { background: #020617 !important; font-family: 'Inter', sans-serif; }
                
                .fade-in-seq-1 { animation: fadeIn 1s ease-in forwards; }
                .fade-in-seq-2 { opacity: 0; animation: fadeIn 1s ease-in 1s forwards; }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            `}</style>

            {/* BOOT SEQUENCE 0: CRI LOGO */}
            {bootPhase === 0 && (
                <div className="fixed inset-0 bg-[#020617] z-[9999] flex flex-col items-center justify-center p-6">
                    <div className="fade-in-seq-1 mb-8">
                        <svg id="Layer_1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 1024" className="w-48 h-48 md:w-64 md:h-64 text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]" fill="currentColor" fillRule="evenodd" clipRule="evenodd">
  <path d="M630.74,174.62l15.47-.27c244.42,4.48,391.08,284.57,247.05,487.33-126.75,178.44-394.28,171.76-512.83-11.88-129.65-200.85,13.54-467.51,250.29-475.18h.02ZM848.32,698.86c192.06-184.43,63.86-508.1-200.47-514.57-201.33-4.94-351.46,189.39-294.51,383.66,62.98,214.85,332.96,286.48,494.98,130.91Z"/>
  <path d="M867.55,247.32c49.19,47.23,84.42,112.75,95.92,180.23,7.15,42,6.37,85.36-2.29,127.07l-7.55-1.79c1.26-11.31,3.87-22.45,5-33.78,20.6-205.16-150.65-376.28-356.08-352.78-127.78,14.61-237.42,111.15-270.21,234.98-15.09,56.96-14.42,117.33,2.14,173.88l-8.16,2.96c-3.66-15.16-7.63-30.46-9.8-45.93-30-213.52,147.81-398.71,362.6-374.14,70.19,8.03,137.77,40.65,188.45,89.34l-.02-.04Z"/>
  <path d="M633.39,859.54h-7.44l.84-44.56c2.35.29,7.06-.86,8.68.8,3.47,3.55,5.4,21.55,9.06,26.44l.46-27.2,7.02.74-.46,43.81c-2.23-.36-7.27.88-8.68-.82-1.64-1.95-5.97-20.33-7.59-24.59-.4-1.05-.48-2.44-1.89-2.65v28.06-.02Z"/>
  <path d="M832.35,775.35l14.86,22.68-5.53,3.64-1.53-.65-24.24-35.15c2.06-1.95,5.23-5.02,8.18-4.2,3.15.88,21.29,17.13,22.28,16.16l-14.74-21.19-.11-1.87,6.03-2.46,24.47,35.84-7.44,4.27-22.26-17.03.02-.04Z"/>
  <path d="M703.58,825.69l5.78,28.06-6.1.78-1.18-1.35-8.43-42.33,8.95-.69,14.15,24.64-4.96-27.24,6.64-.48,8.7,42.63-8.37,1.7c-5.44-8.18-8.95-18.35-15.24-25.69l.04-.02Z"/>
  <path d="M444.9,750.86c3.26,3.78,3.64,8.7,1.98,13.37-1.35,3.85-13.62,19.78-17.07,21.71-3.07,1.72-6.98,1.74-10.22.53-1.39-.53-13.24-8.74-13.66-9.48-.48-.88-.59-1.62,0-2.46l24.53-32.88c.92-.55,2.23-.19,3.13.27,1.01.5,10.47,7.97,11.29,8.93h.02ZM434.2,752.31c-1.45.38-18.2,22.53-17.55,23.88,3.55,3.22,6.12,3.87,9.96.8,2.48-1.98,12.19-15.22,12.63-17.95.48-2.94-2.17-7.46-5.04-6.71v-.02Z"/>
  <path d="M511.22,812.49c6.18,7.27-3.03,14.48-2.48,22.28l-8.3-3.01c-1.32-5.74,12.42-20.26-3.15-19.99l-5.91,15.55-8.22-2.46,17.85-40.4c1.18-.36,14.57,5.47,16.27,6.71,8.87,6.35,3.8,19.91-6.05,21.34v-.02ZM511.83,796.18c-.97-1.03-5.07-2.44-6.43-1.49-1.74,5.19-8.35,11.75,1.32,12.07,4.98.17,7.95-7.55,5.11-10.57h0Z"/>
  <path d="M601,811.86c6.85-1.07,15.01,2.61,15.91,10.11.67,5.61-.67,20.33-2.23,25.88-1.41,5.04-4.12,9.38-9.73,10.07-18.37,2.27-17.8-11.5-16-25.08,1.05-7.99,2.29-19.46,12.07-20.98h-.02ZM607.62,820.12c-1.32-1.32-5.13-1.28-6.68-.27-2.12,1.39-4.88,21.88-4.73,25.27.19,4.39,4.08,8.45,7.99,5.42,2.82-2.19,5.82-28.04,3.45-30.42h-.02Z"/>
  <path d="M915.75,671.26c-.57-.8,3.43-7.55,5.17-7.25l28.63,17.72h2.5c3.55-1.49,4.41-5.59,1.58-8.26l-28.48-17.78,4.18-7.4c7.21,6.29,28.04,14.4,32.5,21.95,4.62,7.86-2.96,20.37-11.81,20.14-8.85-.23-25.37-16-34.24-19.11h-.02Z"/>
  <path d="M323.03,685.36l-3.22-7.67,6.37-6.05c-.74-1.93-3.43-8.56-5.21-8.58l-9,2.54-3.83-6.24,43.79-13.2c1.64,2.1,5.72,6.83,4.52,9.46l-33.44,29.74h.02ZM346.13,654.82c-5.13,2.52-24.03,4.33-12.91,11.5l12.91-11.5Z"/>
  <path d="M965.23,613.54c1.47-7,3.28-16.31,11.46-8.58l-3.68,11.92,9.16,3.91,6.29-12.91,7.32,1.56-8.74,22.32-41.26-15.7c-.53-.61-.32-1.22-.21-1.91.65-4.54,6.33-14.63,7.82-19.65l6.73,2.92-4.75,12.36,9.88,3.76Z"/>
  <path d="M419.59,729.13l-22.3,40.42-6.5-5.49,4.77-8.28c.23-1.45-6.05-6.85-7.38-6.52l-6.96,5.28-6.16-5.26,36.28-25.62c2.92-.8,5.02,5.36,8.26,5.49l-.02-.02ZM408.03,734.89l-13.18,9.48,4.54,4.54,5.19-7.17s3.45-6.85,3.45-6.85Z"/>
  <path d="M330.45,638.3l-2.46-7.76c2.67-2.38,8.35-3.17,7.06-7.99-1.18-4.98-10.87-.86-13.92.23-4.41,1.58-18.67,6.62-16.96,12.42s7.82,2.12,10.99.57c.76-.36.63-1.43,1.64.02l2.9,8.24c-7.19,2.46-15.6,4.54-20.52-3.01-3.24-4.98-3.93-11.52-.13-16.37,3.49-4.44,26.67-14.21,32.2-13.31,14.48,2.38,14.84,24.47-.84,26.91l.02.04Z"/>
  <path d="M677.87,813.42l14.15,43.64-8.28-.38-2.52-8.62-9.73.84-.9,9.82-7.74.76-1.18-1.81,5.74-42.19c.8-2.48,8.3-2.44,10.51-2.06h-.04ZM674.67,824.03c-1.14-1.22-1.51.06-1.64,1.22-.61,4.98-.53,11.04-.82,16.12,1.16.15,6.45-.04,6.66-1.35l-4.2-16Z"/>
  <path d="M582.14,822.33l-7.36-.76c1.22-4.37-2.1-11.04-6.68-7.08-7,6.07,7.19,13.41,9.84,18.35,3.55,6.62.04,17.91-7.76,19.21-11.33,1.91-20.62-5.47-16.86-17.28l7.9,1.6c.82,1.05-2.67,6.16,2.35,8.39,2.8,1.24,6.66-.97,7.08-3.85.97-6.77-12.99-10.74-13.07-20.58-.15-20.58,29.93-16.75,24.53,2h.02Z"/>
  <path d="M341.08,684.61l3.26,6.01c-7.71,4.52-2.77,15.03,3.87,9.63,5.95-4.81-3.93-20.56,8.39-27.12,14.61-7.78,26.07,13.12,12.34,21.25l-4.54-5.44,3.64-5.15c.44-2-2.46-4.44-4.31-4.86-11.86,4.67.92,17.3-8.51,26.67-15.01,14.95-35.02-13.26-14.15-21.02l.02.02Z"/>
  <path d="M858.54,735.08c4.96-.8,9.56,1.37,11.77,5.97l-6.2,4.37c-1.24-.11-2.75-4.83-7.02-2.71-2.27,1.6-2.38,5.15-.44,7.06,5.09,5.13,18.33-4.14,26.51,4.88,12.59,13.87-10.97,33.13-21.02,16.25l5.3-4.69c3.07,2.96,10.11,5.7,11.14-.42,1.66-9.75-10.05-5.68-14.46-5.34-19.82,1.53-22.37-22.68-5.57-25.37h0Z"/>
  <path d="M385.04,715.21c5.99-2.14,5.49-11.01-1.98-9.02-2.48.67-18.81,15.01-19.82,17.38-1.16,2.67.11,4.81,2.44,6.24,3.66,0,6.45-2.61,9.04-4.77,9.84,4.5,3.32,11.2-4.31,12.23-11.41,1.53-19.76-10.59-13.07-20.49,3.32-4.94,19.82-18.43,25.64-19,7.17-.69,15.55,7.8,14.19,15.03-.36,1.91-4.79,8.49-6.45,9.33-2.14,1.09-6.75-5.09-5.65-6.94h-.02Z"/>
  <path d="M780.32,785.25l1.62,7.38-12.3,4.23c-.88,1.03,2.86,9.65,3.72,9.84l12.7-4.06,1.64,6.5-11.48,4.25,4.08,11.14c2.19,1.39,10.59-4.41,13.58-4.52l2.96,7.36-21.08,8.07-16.96-41.41,21.52-8.74v-.02Z"/>
  <path d="M476.52,778.61l-13.94-6.52-3.99,7.8,10.17,7-2.17,6.56c-1.79,1.24-9.4-6.03-11.83-6.5l-6.35,10.19,12.38,7.15-3.74,6.47-19.17-10.8.32-3.11,21.06-35.48c1.11-.34,2.04.17,3.01.59,1.53.65,15.85,9.25,16.37,10.07,1.39,2.12-2.23,4.29-2.14,6.6l.02-.02Z"/>
  <path d="M747.36,813.29c.02-6.41-9.06-10.51-9.75-2.67-.23,2.71,5.68,21.8,7.36,24.47s4.6,3.93,6.96,1.39c4.14-4.52-5.84-13.01,7.4-12.46,1.91.08.9.08,1.22,1.28.74,2.8,1.16,6.96.76,9.84-1.32,9.42-16.06,13.05-22.2,6.66-4.79-4.98-10.11-26.91-9.04-33.78,1.14-7.29,10.32-10.01,16.69-8.56,4.81,1.09,6.68,7.34,8.83,10.97l-8.2,2.86h-.02Z"/>
  <path d="M538.5,806.73l-2.46,8.53c5.28,4.62,16.35,1.79,9.46,11.96l-12.02-3.68-3.34,10.7,14.1,4.67-2.06,5.76c-.38.67-.95.8-1.64.86-1.05.08-20.05-5.32-20.28-6.35l12.46-42.4,20.62,6.18c4.01,13.75-12.57,2.12-14.82,3.76h-.02Z"/>
  <path d="M912.94,674.69l5.89,4.46c-.48,2.92-6.01,4.92-4.37,7.86l27.33,21.48c.99,2.04-3.11,5.59-4.16,7.4l-29.05-22.16c-3.09-.48-4.75,11.06-11.73,1.95l16.12-21h-.02Z"/>
  <path d="M895.62,746.74c-2.9-2.92-15.79-17.09-17.89-18.06-2.94-1.37-4.88,3.09-7,4.56l-4.48-4.65,17.8-18.39,5.3,5.32-5.47,6.16,24.34,26.13-6.05,6.05c-.48-.11-5.55-6.07-6.56-7.1v-.02Z"/>
  <path d="M975.95,655.62l-32.73-15.58-4.94,6.41c-3.01.29-6.6-1.35-5.72-4.88,1.39-5.53,8.01-13.37,9.52-19.44,1.83-1.28,6.05.97,7.42,2.61.46,1.93-5.3,5.91-2.42,8.18l31,15.26-2.14,7.44Z"/>
  <path d="M893.18,700.31c2.35-.63,28.88,24.87,32.9,27.98.9,1.37-3.78,5.82-4.6,6.24-2.29,1.16-28.29-25.06-32.64-27.7-1.58-1.68,3.24-6.22,4.33-6.52h.02Z"/>
  <path d="M822.51,812.45l-21.19-37.06c-.46-1.3,5.59-4.83,5.99-4.9,2.29-.36,19.42,33.61,22.49,37.61.27,1.77-6.79,4.71-7.27,4.35h-.02Z"/>
  <polygon class="st0" points="408.03 734.89 404.58 741.76 399.37 748.93 394.85 744.39 408.03 734.89"/>
  <path d="M853.49,683.41c-43.39,45.66-103.69,77.86-166.16,87.68-103.84,16.31-208.06-23.71-273.93-104.7l.44-2.88,37.54-15.3,1.22,1.22-9.06,21.9c1.16.17,2.23-.13,3.34-.38,19.3-4.33,29.03-13.35,42.9-26.44,3.11-2.94,5.99-6.14,9.06-9.1.36-1.95-.9-1.03-2.08-1.2-1.35-.19-10.32-1.26-10.32-2.12l14.04-32.58-93.01,57.68c-1.22.19-5.26-5.11-5.26-6.1,0-1.56,10.47-7.67,12.51-9,28.67-18.64,58.42-35.71,87.42-53.81l3.07.27c7.25,3.95,14.34,8.45,21.69,12.19,1.45.74,5.23,3.17,6.6,2.5l44.35-37.44c12.42,1.24,20.16-9.27,29.22-16.19,11.2-8.53,22.43-17.13,34.03-25.12l50.15,39.01,36.51,23.42c9.9-2.56,22.18-9.29,31.89-11.01,1.2-.21,2.29-.69,3.53-.19,36.62,28.38,77.52,50.45,115.38,77.04-7.69,10.41-16.06,21.13-25.08,30.63v.02ZM638.35,537.61c-.59-.65-3.3,1.62-4.04,2.14-6.24,4.44-28.61,20.26-32.29,24.89-3.49,4.37-9.08,23.65-12.21,30.48-1.32,2.86-2.77,6.01-4.69,8.51-2.92-8.34-3.64-17.61-6.16-26.04-.27-.92.55-1.47-1.24-1.2l-37.56,31.78h20.62l-73.47,85.43,96.34-38.68,1.77,1.24c.69,4.71.67,10.15,1.81,14.71.23.97-.63,1.51,1.2,1.22,11.35-6.79,25.81-11.27,36.68-18.62,4.65-3.15,10.68-9.12,14.95-13.12,5.26-4.92,10.05-10.34,15.28-15.28l-23.23-17.11-23.42,6.39,26.86-48.66,2.84-28.1-.04.02ZM759.7,584.66l-32.75,11.37-10.62-5.59-1.22,1.22,17.8,24.34-.97,9.1,33.49,23.92c-1.26-5.89-1.43-14.15-3.03-19.67-1.18-4.08-8.91-12.11-9.35-16.31l6.6-28.4.04.02Z"/>
  <path d="M809.16,597.81c-.97.69-6.81-2.1-6.58-3.62,11.43-19.84,19.74-41.75,23.04-64.53,20.12-139.45-113.76-241.48-244.86-199.46-105.14,33.7-156.68,150.99-108.21,251.46,1.35,2.8,5.84,8.98,6.37,11.06.53,2.08-4.16,7.36-7.17,2.96-29.55-43.09-30.79-113.91-12.32-161.48,59.87-154.12,286.21-162.07,356.99-13.14,26.86,56.52,24.28,122.69-7.23,176.76l-.02-.02Z"/>
  <path d="M767.18,570.53c19.67-36.11,23.04-77.77,8.81-116.51-29.91-81.43-128.73-114.83-204.53-74.52-79.29,42.17-99.07,145.99-40.42,214.22-1.41.29-2.4-.4-3.57-.97-9.86-4.65-12.74-7.42-18.04-16.65-40.74-70.9-16.33-160.07,54.06-200.47,85.97-49.31,199.88-6.03,224.2,91.42,8.7,34.91,4.5,76.39-15.2,106.68l-5.32-3.24v.04Z"/>
  <path d="M661.05,223.09c23.08,2.73,25.16,31.72,7.84,42.92,14.78,4.94,9.04,22.16,10.78,33.38.48,3.11,3.3,4.75,3.26,7.9h-20.22c-4.16,0-2.52-21.84-2.88-25.18-1.16-10.41-8.81-9.84-17.34-9.5l-.82,34.68h-18.98v-84.21c12.13,1.05,26.53-1.41,38.38,0h-.02ZM642.47,238.35v19.82c.63.95.78.84,1.7.88,8.16.27,16.16-.44,16.29-10.78.13-10.34-8.28-11.1-16.65-10.95l-1.35,1.03Z"/>
  <path d="M557.46,572.28c-3.51-5.61-8.03-10.51-11.41-16.25-52.09-88.52,40.88-188.61,135.2-152.54,69.74,26.67,91.77,115.82,40.44,170.92h-1.62l-4.96-4.18c36.13-35.69,36.55-94.21,3.3-132.09-34.45-39.24-94.7-45.89-137.32-15.91-47.38,33.32-56.8,101.11-17.95,144.83.21,1.18-4.69,5.95-5.7,5.26l.02-.02Z"/>
  <path d="M558.28,252.81c-.11-6.01-.32-15.45-7.9-16.46-5-.67-7.65.55-9.59,5.15-3.32,7.88-2.77,34.73-1.3,43.72,1.95,11.86,15.93,11.92,17.74,0,.32-2.08-.25-10.34.69-11.01,3.11-1.74,6.26-.06,9.02-.08,1.6,0,10.32-1.39,10.32.59v12.38c0,.92-2.75,8.45-3.45,9.75-9.14,17.53-45.74,16.52-52.72-3.93-3.89-11.39-3.99-46.16.69-57.17,7.99-18.77,42.92-20.35,52.02-2.98,2.63,5,5.11,15.24,2.21,20.07h-17.74v-.02Z"/>
  <path d="M521.12,309.75c.44,2.23-.59,1.41-1.64,2.06-4.96,2.98-10.09,5.84-14.8,9.16-94.02,66.15-121.6,195.84-62.07,294.77l-5.99,4.29c-1.66-.32-11.39-20.39-12.78-23.54-42.69-96.1-15.72-212.05,68.48-275.51,1.98-1.49,15.03-11.22,16.02-11.22h12.8-.02Z"/>
  <path d="M782.4,315.53c.88.23,12.68,9.65,14.46,11.14,27.6,23.08,51.56,56.1,64.76,89.61,26.11,66.26,20.56,145.04-17.32,205.54l-6.03-4.54c7.92-13.03,14.67-26.82,19.67-41.26,22.79-65.77,13.98-139.68-24.59-197.51-16.88-25.29-39.03-45.53-63.75-62.96,3.55.59,9.65-.82,12.8,0v-.02Z"/>
  <path d="M632.4,439.62c61.93-6.31,98.9,63.65,54.67,108.34l-5.76-4.1c32.18-29.18,19-81.81-21.67-94.8-58.08-18.56-104.28,51.54-59.28,94.76l-5.76,4.18c-20.81-19.07-25.1-50.66-11.71-75.32,9.29-17.09,30-31.07,49.5-33.04v-.02Z"/>
  <path d="M726.68,223.09h19.4c2.02,0,.67,4.56.67,5.72.11,15.01.08,30.14.04,45.17-.02,9.46,1.64,21.21.55,30.46-.15,1.2-.11,2.12-1.28,2.84h-18.16l-1.24-1.24v-82.97l.02.02Z"/>
  <path d="M636.48,486.6c20.18-4.12,28.5,22.79,11.29,30.27-15.51,6.75-30.16-11.33-19.65-24.59,1.81-2.27,5.53-5.09,8.37-5.68h0Z"/>
  <polygon points="607.81 288.29 607.81 307.3 590.07 307.3 588.83 306.05 588.83 288.29 607.81 288.29"/>
  <polygon points="778.68 288.29 778.68 306.05 777.44 307.3 760.52 307.3 760.52 288.29 778.68 288.29"/>
  <polygon points="711.82 288.29 711.82 307.3 694.89 307.3 693.65 306.05 693.65 289.53 694.89 288.29 711.82 288.29"/>
                        </svg>
                    </div>
                    <h1 className="fade-in-seq-2 text-2xl md:text-3xl font-sans font-black text-white tracking-[0.2em] text-center mt-4">WE ARE HERE TO HELP</h1>
                </div>
            )}

            {/* BOOT SEQUENCE 1: TIMELINE PROTOCOL */}
            {bootPhase === 1 && (
                <div className="fixed inset-0 bg-[#020617] z-[9999] flex flex-col items-center justify-center fade-in">
                    <h1 className="text-4xl md:text-6xl text-center px-4 jarring-text mb-12">TIMELINE<br/>PROTOCOL</h1>
                    <Icons.Activity size={80} className="text-cyan-500 mt-8 animate-pulse" />
                </div>
            )}

            {/* BOOT SEQUENCE 2: PLAYER MANUAL */}
            {bootPhase === 2 && (
                <div className="fixed inset-0 bg-[#020617]/95 z-[9000] flex items-center justify-center p-4 backdrop-blur-xl fade-in">
                    <div className="glass-panel w-full max-w-lg p-8 rounded-lg shadow-[0_0_50px_rgba(6,182,212,0.1)] flex flex-col max-h-[90vh]">
                        <h2 className="text-xl font-bold text-cyan-400 uppercase tracking-widest mb-6 border-b border-cyan-900/30 pb-4 flex items-center gap-2">
                            <Icons.MapPin /> CRI FIELD MANUAL
                        </h2>
                        <div className="overflow-y-auto custom-scrollbar pr-2 space-y-6 text-sm text-gray-300 font-mono leading-relaxed">
                            <p>A temporal anomaly has fractured the city. We need field operatives to map the sector and stabilize the timeline.</p>
                            <div className="p-4 bg-cyan-900/20 border border-cyan-500/50 rounded shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                                <strong className="text-[#00ff41] block mb-2 animate-pulse">▲ REQUIRED ACTION ▲</strong>
                                You must click <strong>SYNC GPS</strong> and allow location permissions to enable the tracking grid.
                            </div>
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

            {/* NORMAL HACKER INTRO HIJACK */}
            {hackerIntroPhase > 0 && !gameState.hackerIntroDone && bootPhase === 3 && (
                <div className={`fixed inset-0 z-[8000] hacker-bg flex flex-col items-center justify-center p-6 ${hackerIntroPhase === 1 ? 'screen-tear' : 'fade-in'}`}>
                    {hackerIntroPhase >= 2 && (
                        <div className="w-full max-w-md border border-[#00ff41] bg-black/90 p-8 shadow-[0_0_30px_rgba(0,255,65,0.2)]">
                            <Icons.Cpu size={48} className="text-[#00ff41] mb-6 animate-pulse mx-auto text-shadow-glow" />
                            <TypewriterText 
                                lines={[
                                    "[ FIREWALL BYPASSED. ]",
                                    "I see you just logged that node for the Cascadia Resonance Institute. Don't trust them. They aren't here to help.",
                                    "Bob didn't show up today. CRI is using this app to track his resonance trail.",
                                    "I've hijacked your scanner. Keep walking your vector, but from now on, the data you collect comes to me. Let's find out what CRI is hiding."
                                ]} 
                                onComplete={() => setHackerIntroPhase(3)} 
                            />
                            {hackerIntroPhase === 3 && (
                                <button onClick={() => setGameState(prev => ({ ...prev, hackerIntroDone: true }))} className="mt-8 fade-in w-full py-4 border border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-black font-bold font-mono text-xs uppercase transition-colors">
                                    ACCEPT OVERRIDE
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* HACKER INTERLUDE (Mid-Game Unlocks) */}
            {hackerInterludePhase > 0 && (
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
            {hackerEndPhase > 0 && gameState.gameComplete && (
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
                                            "Bob's trajectory is fracturing. He vanishes completely in exactly two weeks.",
                                            "CRI is closing in. I need a dedicated crew to protect his trail and unlock the rest of the city.",
                                            "If you want to fund the operation and keep this network online, route your support here:"
                                        ]} 
                                        onComplete={() => setHackerEndPhase(3)} 
                                    />
                                    {hackerEndPhase === 3 && (
                                        <div className="fade-in">
                                            <a href={STRIPE_LINK} target="_blank" rel="noopener noreferrer" className="block w-full text-center py-3 my-4 border-2 border-[#00ff41] text-black bg-[#00ff41] hover:bg-black hover:text-[#00ff41] font-black font-mono text-sm uppercase transition-colors shadow-[0_0_15px_rgba(0,255,65,0.5)]">
                                                [ FUND THE OPERATION ]
                                            </a>
                                            <p className="font-mono text-[#00ff41] text-sm mb-6 text-shadow-glow">
                                                Hurry. I smuggled some physical gear into Jellyfish, but there are only 20 bags. Enter your operative alias and secure frequency below to join the network and claim your clearance code.
                                            </p>
                                            
                                            <div className="flex flex-col gap-4 mt-4">
                                                <a href="YOUR_FORMSPREE_LINK_HERE" target="_blank" rel="noopener noreferrer" className="w-full py-4 bg-[#00ff41]/20 border border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-black font-bold font-mono text-xs uppercase text-center transition-colors">
                                                    1. OPEN SECURE REGISTRATION FORM
                                                </a>
                                                <button onClick={() => setHackerStep(1)} className="w-full py-4 border border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-black font-bold font-mono text-xs uppercase transition-colors">
                                                    2. I HAVE REGISTERED (REVEAL CODE)
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {hackerStep === 1 && (
                                <div className="fade-in text-center">
                                    <p className="font-mono text-[#00ff41] text-sm mb-6 text-shadow-glow">
                                        Registration confirmed. Your frequency has been added to the secure roster for future drops.<br/><br/>
                                        Write down this clearance code and present it to a CRI operative at Jellyfish to claim your physical gear.
                                    </p>
                                    <div className="inline-block bg-[#00ff41] text-black px-6 py-3 text-3xl font-black tracking-[0.2em] mb-6">
                                        ESO-C4T4-LY57
                                    </div>
                                    <p className="font-mono text-[#00ff41] text-[10px] animate-pulse">Severing connection...</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {decrypting && !gameState.gameComplete && (
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
                    {trackingState === 'IDLE' ? (
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] text-[#00ff41] font-bold animate-pulse hidden md:block">◀ REQUIRED: SYNC GPS</span>
                            <button onClick={startTracking} className="px-4 py-2 bg-cyan-500/10 border border-cyan-500/50 text-cyan-400 text-[10px] font-bold uppercase rounded hover:bg-cyan-500/20 transition-colors">SYNC GPS</button>
                        </div>
                    ) : (
                        <div className="w-3 h-3 rounded-full bg-cyan-500 shadow-[0_0_10px_#06b6d4] animate-pulse"></div>
                    )}
                    <button onClick={() => setBootPhase(2)} className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-cyan-400 transition-colors border border-gray-800 px-3 py-1.5 rounded">
                        [ MANUAL ]
                    </button>
                </div>
            </header>

            <main className="flex-1 relative overflow-hidden flex flex-col">
                
                <div className={`absolute inset-0 transition-opacity duration-300 flex flex-col ${activeTab === 'MAP' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <div className="flex-1 relative w-full border-b border-cyan-900/30">
                        <div ref={mapRef} className="w-full h-full absolute inset-0 z-10"></div>
                    </div>

                    <div className="p-4 md:p-6 bg-[#020617] shrink-0 z-[500] shadow-[0_-10px_30px_rgba(0,0,0,0.8)] relative">
                        <div className="max-w-4xl mx-auto flex flex-col">
                            {!gameState.selectedPath && (
                                <div className="fade-in text-center relative">
                                    <h3 className="text-lg font-black uppercase tracking-widest text-cyan-400 mb-2">SELECT OPERATIVE PROFILE</h3>
                                    <p className="text-xs text-cyan-700 font-mono mb-4">Choose your assignment. This will lock your trajectory.</p>
                                    <div className="grid grid-cols-3 gap-2 md:gap-4">
                                        {['KEY', 'LOCK', 'KNOB'].map(pathKey => {
                                            const config = NODE_CONFIG[pathKey];
                                            const isAnimating = animatingSelection === pathKey;
                                            const isHidden = animatingSelection && animatingSelection !== pathKey;
                                            return (
                                                <button key={pathKey} onClick={() => handlePathSelection(pathKey)} disabled={!!animatingSelection} className={`p-3 md:p-4 glass-panel hover:bg-white/5 transition-all duration-500 flex flex-col items-center gap-2 rounded ${isHidden ? 'opacity-0 scale-90' : 'opacity-100'} ${isAnimating ? 'shatter-effect' : ''}`}>
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
                                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-cyan-500 flex items-center gap-2"><Icons.Activity size={12} className="animate-pulse" /> ACTIVE NODE CLUE [{gameState.currentStepIndex + 1}/4]</h3>
                                        <span className={`text-[10px] font-mono font-bold ${NODE_CONFIG[gameState.selectedPath].textClass}`}>PROFILE: {NODE_CONFIG[gameState.selectedPath].profile}</span>
                                    </div>
                                    <div className="p-4 glass-panel rounded text-sm text-gray-300 font-mono leading-relaxed" dangerouslySetInnerHTML={{ __html: getActiveClue() }}></div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className={`absolute inset-0 bg-[#020617] p-6 transition-opacity duration-300 overflow-y-auto ${activeTab === 'SCANNER' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
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
                        <span className="text-[9px] font-bold uppercase tracking-widest">SCANNER</span>
                    </button>
                    <button onClick={() => { setActiveTab('VAULT'); setHasNewVaultItem(false); }} className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${activeTab === 'VAULT' ? 'text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}>
                        <div className="relative">
                            <Icons.Database size={20} />
                            {hasNewVaultItem && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#00ff41] rounded-full animate-pulse"></span>}
                        </div>
                        <span className="text-[9px] font-bold uppercase tracking-widest">DATA VAULT</span>
                    </button>
                </div>
            </nav>
        </div>
    );
}