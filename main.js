import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';

// FIREBASE IMPORTS
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot, updateDoc, deleteDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ==========================================
// CONFIGURACIÓN Y ESTADO
// ==========================================
const BASE_SPEED = 0.45; 
const ROAD_WIDTH_HALF = 8.5; 
const WALL_WIDTH = 1.5; 
const WALL_HEIGHT = 1.2;
const CAR_WIDTH_HALF = 1.0;
const WALL_LIMIT = ROAD_WIDTH_HALF - CAR_WIDTH_HALF - 0.2;

const state = {
    // Multiplayer State
    user: null,
    roomId: null,
    isHost: false,
    playerColor: '#' + Math.floor(Math.random()*16777215).toString(16), // Color aleatorio
    remotePlayers: {}, // Mapa de coches remotos { uid: { mesh, targetPos, targetRot } }
    lastUpload: 0,

    // Config (Set by Host)
    config: {
        maxKmh: 500,
        accel: 40,
        seed: Math.random() * 10000 // Semilla compartida
    },

    // Local Physics
    manualSpeed: 0.0,
    worldHeading: 0.0,
    lateralOffset: 0.0,
    trackDist: 0.0,
    
    // Inputs
    inputSteer: 0.0,
    inputGas: false,
    inputBrake: false,
    
    // Settings
    steeringInverted: false,
    steerSensitivity: 60,   
    menuOpen: false
};

// ==========================================
// FIREBASE SETUP
// ==========================================
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Auth
const initAuth = async () => {
    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
    } else {
        await signInAnonymously(auth);
    }
};
initAuth();

onAuthStateChanged(auth, (u) => {
    if(u) {
        state.user = u;
        console.log("Logged in as", u.uid);
        refreshRoomList();
    }
});

// ==========================================
// UI HANDLERS (LOBBY)
// ==========================================
const ui = {
    lobby: document.getElementById('lobby-screen'),
    mainLobby: document.getElementById('main-lobby'),
    createPanel: document.getElementById('create-room-panel'),
    roomList: document.getElementById('room-list'),
    loading: document.getElementById('loading'),
    loadingText: document.getElementById('loading-text'),
    uiLayer: document.getElementById('ui-layer'),
    
    // Game UI
    speedDisplay: document.getElementById('speed-display'),
    playerCount: document.getElementById('player-count'),
    menuModal: document.getElementById('menu-modal'),
    
    // Host Inputs
    hostSpeed: document.getElementById('host-speed'),
    hostAccel: document.getElementById('host-accel'),
    hostSpeedVal: document.getElementById('host-speed-val'),
    hostAccelVal: document.getElementById('host-accel-val')
};

// Navegación Lobby
document.getElementById('btn-show-create').onclick = () => {
    ui.mainLobby.style.display = 'none';
    ui.createPanel.style.display = 'flex';
};
document.getElementById('btn-back').onclick = () => {
    ui.createPanel.style.display = 'none';
    ui.mainLobby.style.display = 'flex';
};
document.getElementById('btn-refresh').onclick = refreshRoomList;

// Host Config Sliders
ui.hostSpeed.oninput = (e) => ui.hostSpeedVal.innerText = e.target.value + " km/h";
ui.hostAccel.oninput = (e) => ui.hostAccelVal.innerText = e.target.value + " km/h/s";

// CREAR SALA
document.getElementById('btn-create-confirm').onclick = async () => {
    if(!state.user) return;
    setLoading(true, "Creando servidor...");
    
    const roomId = 'room_' + Math.random().toString(36).substr(2, 5);
    const roomConfig = {
        hostId: state.user.uid,
        maxKmh: parseInt(ui.hostSpeed.value),
        accel: parseInt(ui.hostAccel.value),
        seed: Math.random() * 99999, // LA SEMILLA DEL MUNDO
        status: 'active',
        createdAt: Date.now()
    };

    // 1. Crear Sala
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId), roomConfig);
    
    // 2. Unirse como Host
    await joinGame(roomId, roomConfig);
};

async function refreshRoomList() {
    if(!state.user) return;
    ui.roomList.innerHTML = '<div style="padding:10px; color:#666;">Cargando...</div>';
    
    // Nota: En producción usaríamos queries, aquí traemos todo y filtramos (simple para demo)
    const snapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'rooms'));
    ui.roomList.innerHTML = '';
    
    if(snapshot.empty) {
        ui.roomList.innerHTML = '<div style="padding:10px;">No hay salas activas.</div>';
        return;
    }

    snapshot.forEach(doc => {
        const data = doc.data();
        if(data.status === 'active') {
            const div = document.createElement('div');
            div.className = 'room-item';
            div.innerHTML = `<div><strong>Sala ${doc.id}</strong><br><small>Vel: ${data.maxKmh} | Accel: ${data.accel}</small></div><span>UNIRSE ▶</span>`;
            div.onclick = () => joinGame(doc.id, data);
            ui.roomList.appendChild(div);
        }
    });
}

async function joinGame(roomId, roomData) {
    state.roomId = roomId;
    state.config = roomData; // Aplicar configuración del host (incluyendo SEED)
    state.isHost = (state.user.uid === roomData.hostId);
    
    // Inicializar mundo con la semilla recibida
    initWorld(state.config.seed);
    
    // Registrar jugador
    const playerRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId, 'players', state.user.uid);
    await setDoc(playerRef, {
        color: state.playerColor,
        x: 0, y: 0, z: 0,
        rot: 0,
        active: true
    });

    // Escuchar a otros jugadores
    const playersCol = collection(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId, 'players');
    onSnapshot(playersCol, (snapshot) => {
        let count = 0;
        snapshot.forEach(doc => {
            const data = doc.data();
            if(doc.id !== state.user.uid && data.active) {
                updateRemotePlayer(doc.id, data);
            }
            count++;
        });
        ui.playerCount.innerText = "Online: " + count;
    });

    setLoading(false);
    ui.lobby.style.display = 'none';
    ui.uiLayer.style.display = 'block';
    animate(); // Iniciar Loop
}

function updateRemotePlayer(uid, data) {
    // Si no existe, crear coche fantasma
    if(!state.remotePlayers[uid]) {
        const ghostCar = createSportCar(data.color); // Usar color del jugador
        scene.add(ghostCar);
        state.remotePlayers[uid] = { mesh: ghostCar };
    }
    
    // Actualizar posición objetivo (Lerp se hace en animate)
    const p = state.remotePlayers[uid];
    p.mesh.position.set(data.x, data.y, data.z);
    p.mesh.rotation.y = data.rot;
}

function setLoading(show, text="Cargando...") {
    ui.loading.style.display = show ? 'flex' : 'none';
    ui.loadingText.innerText = text;
}

// SALIR
document.getElementById('btn-exit').onclick = async () => {
    // Eliminar jugador y recargar
    if(state.roomId && state.user) {
        const playerRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', state.roomId, 'players', state.user.uid);
        await updateDoc(playerRef, { active: false });
    }
    location.reload();
};

// ==========================================
// SEEDED RANDOM (PARA CARRETERA COMPARTIDA)
// ==========================================
let seedVal = 1;
function seededRandom() {
    var x = Math.sin(seedVal++) * 10000;
    return x - Math.floor(x);
}
// Función wrapper de ruido que usa nuestra seed
function setSeed(s) { seedVal = s; }

// ==========================================
// THREE.JS & PHYSICS
// ==========================================
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x87CEEB, 0.002);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 5, -10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.8; bloomPass.strength = 0.15; bloomPass.radius = 0.3;
const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// Luces y Entorno
const ambientLight = new THREE.AmbientLight(0x404040, 2.0); scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffdf80, 2.5);
sunLight.castShadow = true; 
sunLight.shadow.camera.left = -300; sunLight.shadow.camera.right = 300; sunLight.shadow.camera.top = 300; sunLight.shadow.camera.bottom = -300; sunLight.shadow.camera.far = 600;
scene.add(sunLight);
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffaa00, fog: false })); scene.add(sunMesh);
const moonLight = new THREE.DirectionalLight(0x88ccff, 3.0); scene.add(moonLight);
const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })); scene.add(moonMesh);

// Generación Procedural
const chunks = [];
let genPoint = new THREE.Vector3(0, 4, 0); let genAngle = 0; let totalGenDist = 0;

// Noise Function con Seed
const perm = new Uint8Array(512); 
function initNoise(seed) {
    setSeed(seed);
    const p = new Uint8Array(256);
    for(let i=0; i<256; i++) p[i] = Math.floor(seededRandom()*256);
    for(let i=0; i<512; i++) perm[i] = p[i & 255];
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t, a, b) => a + t * (b - a);
const grad = (hash, x, y, z) => { const h = hash & 15; const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v); };
const noise = (x, y) => { const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y); const u = fade(x), v = fade(y); const A = perm[X] + Y, B = perm[X + 1] + Y; return lerp(v, lerp(u, grad(perm[A], x, y, 0), grad(perm[B], x - 1, y, 0)), lerp(u, grad(perm[A + 1], x, y - 1, 0), grad(perm[B + 1], x - 1, y - 1, 0)), lerp(u, grad(perm[A + 1], x, y - 1, 0), grad(perm[B + 1], x - 1, y - 1, 0))); };
function getTerrainHeight(x, z) { return noise(x*0.012, z*0.012)*30 + noise(x*0.04, z*0.04)*6; }

// Clases y Funciones de Construcción (Adaptadas para usar seededRandom)
const matRoad = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide }); 
const matWall = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
const matLine = new THREE.MeshBasicMaterial({ color: 0xffff00 }); 
const matLineWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
const matGrass = new THREE.MeshStandardMaterial({vertexColors:true, flatShading:true});
const matWater = new THREE.MeshStandardMaterial({ color: 0x2196f3, roughness: 0.4, metalness: 0.1, flatShading: true });

class Chunk {
    constructor(index, startPoint, startAngle, startDistGlobal) {
        this.index = index; this.startDistGlobal = startDistGlobal; this.group = new THREE.Group(); scene.add(this.group);
        const angleChange = (seededRandom() - 0.5) * 0.5; const endAngle = startAngle + angleChange;
        const p0 = startPoint;
        const endX = Math.cos(endAngle) * 100 + p0.x; const endZ = Math.sin(endAngle) * 100 + p0.z;
        const terrainH = getTerrainHeight(endX, endZ);
        let targetY = (terrainH < 1) ? Math.max(p0.y, 3) : terrainH + 2.0; targetY = THREE.MathUtils.clamp(targetY, p0.y - 6.0, p0.y + 6.0);
        const p3 = new THREE.Vector3(endX, targetY, endZ);
        const cp1 = new THREE.Vector3(Math.cos(startAngle)*50, 0, Math.sin(startAngle)*50).add(p0);
        const cp2 = new THREE.Vector3(Math.cos(endAngle)*-50, 0, Math.sin(endAngle)*-50).add(p3);
        this.curve = new THREE.CubicBezierCurve3(p0, cp1, cp2, p3);
        this.length = this.curve.getLength(); this.endDistGlobal = startDistGlobal + this.length;
        this.endPoint = p3; this.endAngle = endAngle;
        this.buildRoadAndWalls(); this.buildTerrain(); 
    }
    buildRoadAndWalls() {
        const div = 40; const pts = this.curve.getSpacedPoints(div); const frames = this.curve.computeFrenetFrames(div, false);
        const rV=[],rN=[],rI=[], wV=[],wN=[],wI=[], lV=[],lN=[],lI=[];
        for(let i=0; i<=div; i++) {
            const p=pts[i], n=frames.binormals[i], up=frames.normals[i];
            rV.push(p.x+n.x*ROAD_WIDTH_HALF, p.y+ROAD_Y_OFFSET, p.z+n.z*ROAD_WIDTH_HALF, p.x-n.x*ROAD_WIDTH_HALF, p.y+ROAD_Y_OFFSET, p.z-n.z*ROAD_WIDTH_HALF);
            rN.push(up.x, up.y, up.z, up.x, up.y, up.z);
            // Walls (Simplificado)
            const LO=p.clone().add(n.clone().multiplyScalar(ROAD_WIDTH_HALF+WALL_WIDTH)), RO=p.clone().add(n.clone().multiplyScalar(-(ROAD_WIDTH_HALF+WALL_WIDTH)));
            const LI=p.clone().add(n.clone().multiplyScalar(ROAD_WIDTH_HALF)), RI=p.clone().add(n.clone().multiplyScalar(-ROAD_WIDTH_HALF));
            const yT=p.y+ROAD_Y_OFFSET+WALL_HEIGHT, yB=p.y+ROAD_Y_OFFSET-1;
            wV.push(LI.x,yT,LI.z, LI.x,yB,LI.z, LO.x,yT,LO.z, LO.x,yB,LO.z, RI.x,yT,RI.z, RI.x,yB,RI.z, RO.x,yT,RO.z, RO.x,yB,RO.z);
            wN.push(0,1,0,0,1,0,0,1,0,0,1,0, 0,1,0,0,1,0,0,1,0,0,1,0);
            // Linea
            lV.push(p.x+n.x*0.15, p.y+ROAD_Y_OFFSET+0.08, p.z+n.z*0.15, p.x-n.x*0.15, p.y+ROAD_Y_OFFSET+0.08, p.z-n.z*0.15);
            lN.push(0,1,0,0,1,0);
        }
        for(let i=0; i<div; i++) {
            const b=i*2; rI.push(b,b+2,b+1, b+1,b+2,b+3);
            if(i%2===0) lI.push(b,b+2,b+1, b+1,b+2,b+3);
            const w=i*8; 
            wI.push(w,w+8,w+1, w+1,w+8,w+9, w,w+2,w+8, w+2,w+10,w+8, w+2,w+3,w+10, w+3,w+11,w+10); // Left
            wI.push(w+4,w+5,w+12, w+5,w+13,w+12, w+6,w+4,w+14, w+4,w+12,w+14, w+7,w+6,w+15, w+6,w+14,w+15); // Right
        }
        const rM=new THREE.Mesh(new THREE.BufferGeometry(), matRoad); rM.geometry.setAttribute('position',new THREE.Float32BufferAttribute(rV,3)); rM.geometry.setAttribute('normal',new THREE.Float32BufferAttribute(rN,3)); rM.geometry.setIndex(rI); rM.receiveShadow=true; this.group.add(rM);
        const wM=new THREE.Mesh(new THREE.BufferGeometry(), matWall); wM.geometry.setAttribute('position',new THREE.Float32BufferAttribute(wV,3)); wM.geometry.setAttribute('normal',new THREE.Float32BufferAttribute(wN,3)); wM.geometry.setIndex(wI); wM.geometry.computeVertexNormals(); wM.castShadow=true; this.group.add(wM);
        const lM=new THREE.Mesh(new THREE.BufferGeometry(), matLineWhite); lM.geometry.setAttribute('position',new THREE.Float32BufferAttribute(lV,3)); lM.geometry.setAttribute('normal',new THREE.Float32BufferAttribute(lN,3)); lM.geometry.setIndex(lI); this.group.add(lM);
    }
    buildTerrain() {
        const divL=30, divW=60, w=800, vs=[], cs=[], is=[], cObj=new THREE.Color();
        const pts=this.curve.getSpacedPoints(divL), frames=this.curve.computeFrenetFrames(divL, false);
        for(let i=0; i<=divL; i++) {
            const P=pts[i], N=frames.binormals[i];
            for(let j=0; j<=divW; j++) {
                const u=(j/divW)-0.5, xOff=u*w, px=P.x+N.x*xOff, pz=P.z+N.z*xOff;
                let py=getTerrainHeight(px, pz); const dist=Math.abs(xOff);
                if(dist<ROAD_WIDTH_HALF+2) { if(py>P.y-2) py=P.y-2; } else if(dist<ROAD_WIDTH_HALF+15) { let t=py; if(py>P.y-2) t=P.y-2; py=lerp(1-(dist-(ROAD_WIDTH_HALF+2))/13, py, t); }
                vs.push(px, py, pz);
                if(py<-1) cObj.setHex(0xe6c288); else if(py<5) cObj.setHex(0x558b2f); else if(py<22) cObj.setHex(0x4e342e); else cObj.setHex(0xffffff);
                cs.push(cObj.r, cObj.g, cObj.b);
            }
        }
        for(let i=0; i<divL; i++) for(let j=0; j<divW; j++) { const a=i*(divW+1)+j, b=(i+1)*(divW+1)+j, c=(i+1)*(divW+1)+j+1, d=i*(divW+1)+j+1; is.push(a,b,d, b,c,d); }
        const m=new THREE.Mesh(new THREE.BufferGeometry(), matGrass); m.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vs,3)); m.geometry.setAttribute('color',new THREE.Float32BufferAttribute(cs,3)); m.geometry.setIndex(is); m.geometry.computeVertexNormals(); m.receiveShadow=true; this.group.add(m);
        const wm=new THREE.Mesh(new THREE.PlaneGeometry(w, 100), matWater); wm.rotateX(-Math.PI/2); wm.position.set(this.curve.getPointAt(0.5).x, -2, this.curve.getPointAt(0.5).z); this.group.add(wm);
    }
    dispose() { scene.remove(this.group); this.group.traverse(o=>{if(o.geometry)o.geometry.dispose();}); }
}

function initWorld(seed) {
    initNoise(seed);
    genPoint.set(0,4,0); genAngle=0; totalGenDist=0;
    // Limpiar anterior si existe
    chunks.forEach(c => c.dispose()); chunks.length=0;
    for(let i=0; i<14; i++) spawnChunk();
    
    // Crear Coche Propio
    createSportCar(state.playerColor).then(car => {
        mainCar = car;
        scene.add(mainCar);
    });
}

function spawnChunk() {
    const idx = chunks.length>0 ? chunks[chunks.length-1].index+1 : 0;
    const c = new Chunk(idx, genPoint, genAngle, totalGenDist);
    chunks.push(c);
    genPoint = c.endPoint; genAngle = c.endAngle; totalGenDist += c.length;
}

function getTrackData(dist) {
    for(let c of chunks) {
        if(dist >= c.startDistGlobal && dist < c.endDistGlobal) {
            const t = (dist - c.startDistGlobal) / c.length;
            const pos = c.curve.getPointAt(t);
            const tangent = c.curve.getTangentAt(t).normalize();
            const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0,1,0)).normalize();
            return { pos, tangent, right };
        }
    }
    return null;
}

// COCHE
let mainCar;
const matOutline = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
async function createSportCar(colorHex) {
    const car = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.1, metalness: 0.5 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
    
    // Body
    const chG = new THREE.BoxGeometry(2.0, 0.7, 4.2);
    const chassis = new THREE.Mesh(chG, bodyMat); chassis.position.y=0.6; chassis.castShadow=true; car.add(chassis);
    
    // Cabin
    const cbG = new THREE.BoxGeometry(1.6, 0.5, 2.0);
    const cabin = new THREE.Mesh(cbG, blackMat); cabin.position.set(0, 1.2, -0.2); car.add(cabin);
    
    // Wheels
    const wG = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 16).rotateZ(Math.PI/2);
    const wM = new THREE.MeshStandardMaterial({color:0x222});
    [{x:1,z:1.2},{x:-1,z:1.2},{x:1,z:-1.2},{x:-1,z:-1.2}].forEach(p => {
        const w = new THREE.Mesh(wG, wM); w.position.set(p.x, 0.4, p.z); car.add(w);
    });

    // Outline (Cell Shading)
    const outCh = new THREE.Mesh(chG, matOutline); outCh.scale.multiplyScalar(1.03); outCh.position.y=0.6; car.add(outCh);
    const outCb = new THREE.Mesh(cbG, matOutline); outCb.scale.multiplyScalar(1.03); outCb.position.set(0,1.2,-0.2); car.add(outCb);

    // Luces (Solo si es mi coche, para no saturar)
    if(colorHex === state.playerColor) {
        const hl = new THREE.SpotLight(0xffffff, 400, 300, 0.6, 0.5, 1);
        hl.position.set(0, 1.0, 1.5); hl.target.position.set(0,0,10);
        car.add(hl); car.add(hl.target);
    }
    
    return car;
}

// INPUTS
document.getElementById('gas-btn').addEventListener('touchstart', (e)=>{ e.preventDefault(); state.inputGas=true; });
document.getElementById('gas-btn').addEventListener('touchend', (e)=>{ e.preventDefault(); state.inputGas=false; });
document.getElementById('gas-btn').addEventListener('mousedown', (e)=>{ state.inputGas=true; });
document.getElementById('gas-btn').addEventListener('mouseup', (e)=>{ state.inputGas=false; });

document.getElementById('brake-btn').addEventListener('touchstart', (e)=>{ e.preventDefault(); state.inputBrake=true; });
document.getElementById('brake-btn').addEventListener('touchend', (e)=>{ e.preventDefault(); state.inputBrake=false; });
document.getElementById('brake-btn').addEventListener('mousedown', (e)=>{ state.inputBrake=true; });
document.getElementById('brake-btn').addEventListener('mouseup', (e)=>{ state.inputBrake=false; });

const joyZone = document.getElementById('joystick-zone');
const joyKnob = document.getElementById('joystick-knob');
let joyTouchId = null; const joyCenter = {x:0, y:0};

joyZone.addEventListener('touchstart', (e)=>{
    e.preventDefault();
    const t = e.changedTouches[0];
    joyTouchId = t.identifier;
    const r = joyZone.getBoundingClientRect();
    joyCenter.x = r.left + r.width/2;
    updateJoy(t.clientX);
});
joyZone.addEventListener('touchmove', (e)=>{
    e.preventDefault();
    if(joyTouchId===null) return;
    const t = [...e.changedTouches].find(x=>x.identifier===joyTouchId);
    if(t) updateJoy(t.clientX);
});
joyZone.addEventListener('touchend', (e)=>{
    e.preventDefault(); joyTouchId=null; state.inputSteer=0; joyKnob.style.transform=`translate(-50%,-50%)`;
});
// Mouse fallback
joyZone.addEventListener('mousedown', (e)=>{
    joyTouchId='mouse'; 
    const r = joyZone.getBoundingClientRect();
    joyCenter.x = r.left + r.width/2;
    updateJoy(e.clientX);
});
window.addEventListener('mousemove', (e)=>{ if(joyTouchId==='mouse') updateJoy(e.clientX); });
window.addEventListener('mouseup', (e)=>{ if(joyTouchId==='mouse') { joyTouchId=null; state.inputSteer=0; joyKnob.style.transform=`translate(-50%,-50%)`; }});

function updateJoy(cx) {
    let dx = cx - joyCenter.x;
    if(dx > 50) dx = 50; if(dx < -50) dx = -50;
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
    state.inputSteer = dx / 50;
}

// CONTROLES DE MENÚ
document.getElementById('menu-btn').onclick = () => {
    state.menuOpen = !state.menuOpen;
    ui.menuModal.style.display = state.menuOpen ? 'flex' : 'none';
};
document.getElementById('chk-invert-steering').onchange = (e) => state.steeringInverted = e.target.checked;
document.getElementById('steer-sens').oninput = (e) => state.steerSensitivity = parseInt(e.target.value);

// GAME LOOP
function animate() {
    requestAnimationFrame(animate);
    if(!mainCar) return;

    // --- PHYSICS ---
    // Usar la config del HOST (state.config)
    const MAX_SPEED_INTERNAL = state.config.maxKmh / 100.0;
    const ACCEL_INTERNAL = (state.config.accel / 100.0) / 60.0;

    // Aceleración
    if(state.inputGas) {
        if(state.manualSpeed < MAX_SPEED_INTERNAL) state.manualSpeed += ACCEL_INTERNAL;
    } else if(state.inputBrake) {
        state.manualSpeed -= ACCEL_INTERNAL * 2;
    } else {
        state.manualSpeed *= 0.99;
    }
    if(state.manualSpeed < 0) state.manualSpeed = 0;

    // Dirección
    const sens = 0.02 + (state.steerSensitivity/100.0)*0.13;
    const stiffness = 2.0; // Fixed stiffness for stability
    const turnRate = sens / (1.0 + (state.manualSpeed * stiffness));
    let dir = state.inputSteer;
    if(state.steeringInverted) dir *= -1;
    state.worldHeading += dir * turnRate;

    // Movimiento
    const track = getTrackData(state.trackDist);
    let currentY = 0.8;
    if(track) {
        const moveX = Math.sin(state.worldHeading) * state.manualSpeed;
        const moveZ = Math.cos(state.worldHeading) * state.manualSpeed;
        const moveVec = new THREE.Vector3(moveX, 0, moveZ);
        
        state.trackDist += moveVec.dot(track.tangent);
        state.lateralOffset += moveVec.dot(track.right);

        // Rebote
        if(Math.abs(state.lateralOffset) > WALL_LIMIT) {
            const roadAngle = Math.atan2(track.tangent.x, track.tangent.z);
            let relA = state.worldHeading - roadAngle;
            while(relA > Math.PI) relA -= Math.PI*2;
            while(relA < -Math.PI) relA += Math.PI*2;
            state.worldHeading = roadAngle + (-relA * 0.3);
            state.lateralOffset = Math.sign(state.lateralOffset) * (WALL_LIMIT - 0.1);
            state.manualSpeed *= 0.8;
        }
        
        // Render Pos
        const pos = track.pos.clone().add(track.right.clone().multiplyScalar(state.lateralOffset));
        pos.y += ROAD_Y_OFFSET + 0.05;
        currentY = pos.y;
        mainCar.position.copy(pos);
        mainCar.rotation.set(0, state.worldHeading, 0);
        
        // Camera
        const back = new THREE.Vector3(-Math.sin(state.worldHeading), 0, -Math.cos(state.worldHeading));
        const camPos = pos.clone().add(back.multiplyScalar(18 * state.cameraZoom));
        camPos.y += 8 * state.cameraZoom;
        camera.position.lerp(camPos, 0.1);
        camera.lookAt(pos);
    }

    // --- UPLOAD STATE (Throttled) ---
    const now = Date.now();
    if(now - state.lastUpload > 100) { // 10 updates per sec
        if(state.roomId && state.user) {
            updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', state.roomId, 'players', state.user.uid), {
                x: mainCar.position.x,
                y: mainCar.position.y,
                z: mainCar.position.z,
                rot: state.worldHeading
            }).catch(()=>{}); // Ignore errors on exit
        }
        state.lastUpload = now;
    }

    // UI Updates
    ui.speedDisplay.innerText = Math.floor(state.manualSpeed * 100);
    
    // Chunk Mgmt
    if(state.trackDist > chunks[chunks.length-1].startDistGlobal - 400) spawnChunk();
    if(chunks.length > 0 && state.trackDist > chunks[0].endDistGlobal + 400) chunks.shift().dispose();

    // Environment
    const time = (Date.now() % 60000) / 60000; 
    const ang = time * Math.PI * 2;
    const sin = Math.sin(ang);
    const lx=mainCar.position.x, lz=mainCar.position.z;
    sunLight.position.set(lx + Math.cos(ang)*3000, sin*3000, lz + Math.sin(ang)*400);
    sunMesh.position.copy(sunLight.position);
    moonLight.position.set(lx - Math.cos(ang)*3000, -sin*3000, lz - Math.sin(ang)*400);
    moonMesh.position.copy(moonLight.position);
    starField.position.set(lx, 0, lz);

    if(sin > 0) {
        sunLight.intensity = sin * 2.0; moonLight.intensity = 0;
        ambientLight.intensity = 2.0 + sin;
        const col = new THREE.Color(0x87CEEB);
        if(sin < 0.2) col.lerp(new THREE.Color(0xff8c00), 1 - (sin/0.2));
        scene.background = col; scene.fog.color = col;
        starsMat.opacity = 0;
    } else {
        sunLight.intensity = 0; moonLight.intensity = Math.abs(sin) * 3.0;
        ambientLight.intensity = 2.0;
        const col = new THREE.Color(0x1a1a2e);
        scene.background = col; scene.fog.color = col;
        starsMat.opacity = Math.abs(sin);
    }

    composer.render();
}