import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ==========================================
// 0. SISTEMA DE DIAGNÓSTICO (DEBUG)
// ==========================================
const debugUI = document.getElementById('debug-console');
function log(msg, type='info') {
    console.log(`[GAME] ${msg}`);
    if(debugUI) {
        const div = document.createElement('div');
        div.className = type === 'error' ? 'log-entry log-err' : 'log-entry log-sys';
        div.innerText = `> ${msg}`;
        debugUI.prepend(div);
    }
}

window.onerror = function(msg, url, line) {
    log(`ERROR FATAL: ${msg} (Línea ${line})`, 'error');
    if(debugUI) debugUI.style.display = 'block';
    return false;
};

// ==========================================
// 1. CONFIGURACIÓN Y ESTADO
// ==========================================
const CONFIG = {
    ROAD_WIDTH_HALF: 9.0,
    WALL_WIDTH: 1.2,
    WALL_HEIGHT: 1.5,
    ROAD_Y_OFFSET: 0.2, 
    CHUNK_LENGTH: 100,
    VISIBLE_CHUNKS: 16,
    WALL_LIMIT: 7.8 
};

const state = {
    inGame: false,
    myId: null,
    isHost: false,
    myLabel: "YO",
    players: {}, 
    manualSpeed: 0.0,
    worldHeading: 0.0,
    lateralOffset: 0.0,
    trackDist: 0.0,
    input: { steer: 0, gas: false, brake: false },
    settings: {
        maxSpeed: 500, accel: 40, sens: 60, stiffness: 50, 
        invertSteer: false, camDist: 18, fpv: false
    },
    seed: 1234,
    worldGenState: { point: new THREE.Vector3(0, 4, 0), angle: 0, dist: 0 }
};

// ==========================================
// 2. RNG (Corrección Aquí)
// ==========================================
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

// DECLARACIÓN GLOBAL DE RNG (Faltaba esto)
let rng = mulberry32(1); 

function setSeed(s) { 
    log(`Semilla establecida: ${s}`);
    rng = mulberry32(s); 
    // Regenerar ruido para que el terreno coincida
    initNoise();
}

// ==========================================
// 3. UI & NETWORK
// ==========================================
let socket;
const ui = {
    login: document.getElementById('screen-login'),
    lobby: document.getElementById('screen-lobby'),
    loading: document.getElementById('loading'),
    game: document.getElementById('game-ui'),
    speed: document.getElementById('speed-display'),
    fps: document.getElementById('fps'),
    ping: document.getElementById('ping'),
    menuBtn: document.getElementById('menu-btn'),
    menuModal: document.getElementById('menu-modal'),
    roomList: document.getElementById('room-list'),
    brakeBtn: document.getElementById('brake-btn'),
    leaderboard: document.getElementById('leaderboard'),
    
    optMaxSpeed: document.getElementById('opt-max-speed'), dispMaxSpeed: document.getElementById('disp-max-speed'),
    optAccel: document.getElementById('opt-accel'), dispAccel: document.getElementById('disp-accel'),
    optSens: document.getElementById('opt-sens'), dispSens: document.getElementById('disp-sens'),
    optStiff: document.getElementById('opt-stiff'), dispStiff: document.getElementById('disp-stiff'),
    optCamDist: document.getElementById('opt-cam-dist'), dispCamDist: document.getElementById('disp-cam-dist'),
    
    hostControls: document.getElementById('host-controls'),
    adminBadge: document.getElementById('admin-badge'),
    
    chkDebug: document.getElementById('chk-debug'),
    chkInvert: document.getElementById('chk-invert'),
    chkShowBrake: document.getElementById('chk-show-brake'),
    chkFPV: document.getElementById('chk-fpv'),
    chkFps: document.getElementById('chk-fps'),
    chkPing: document.getElementById('chk-ping'),
    chkLb: document.getElementById('chk-lb')
};

ui.menuBtn.onclick = () => ui.menuModal.style.display = (ui.menuModal.style.display==='flex'?'none':'flex');
ui.chkDebug.onchange = (e) => debugUI.style.display = e.target.checked ? 'block' : 'none';

const sendConfig = () => { if(state.isHost && socket) socket.emit('updateRoomConfig', { maxSpeed: parseInt(ui.optMaxSpeed.value), accel: parseInt(ui.optAccel.value) }); };
ui.optMaxSpeed.oninput = (e) => { ui.dispMaxSpeed.innerText = e.target.value; sendConfig(); };
ui.optAccel.oninput = (e) => { ui.dispAccel.innerText = e.target.value; sendConfig(); };

ui.optSens.oninput = (e) => { state.settings.sens = parseInt(e.target.value); ui.dispSens.innerText = state.settings.sens + '%'; };
ui.optStiff.oninput = (e) => { state.settings.stiffness = parseInt(e.target.value); ui.dispStiff.innerText = state.settings.stiffness + '%'; };
ui.optCamDist.oninput = (e) => { state.settings.camDist = parseInt(e.target.value); ui.dispCamDist.innerText = state.settings.camDist; };

ui.chkInvert.onchange = (e) => state.settings.invertSteer = e.target.checked;
ui.chkShowBrake.onchange = (e) => ui.brakeBtn.style.display = e.target.checked ? 'flex' : 'none';
ui.chkFPV.onchange = (e) => { state.settings.fpv = e.target.checked; updateCarVisibility(); };
ui.chkFps.onchange = (e) => ui.fps.style.display = e.target.checked ? 'block' : 'none';
ui.chkPing.onchange = (e) => ui.ping.style.display = e.target.checked ? 'block' : 'none';
ui.chkLb.onchange = (e) => ui.leaderboard.style.display = e.target.checked ? 'flex' : 'none';

document.getElementById('btn-connect').onclick = () => {
    log("Iniciando conexión...");
    document.getElementById('status').innerText = "CONECTANDO...";
    document.getElementById('status').style.color = "#0af";
    socket = io(); setupSocket();
};
document.getElementById('btn-create').onclick = () => { log("Creando sala..."); socket.emit('createRoom'); };
document.getElementById('btn-refresh').onclick = () => socket.emit('getRooms');
document.getElementById('btn-join').onclick = () => { const c = document.getElementById('inp-code').value; if(c) socket.emit('joinRoom', c); };
window.joinRoomId = (id) => { log(`Uniéndose a ${id}...`); socket.emit('joinRoom', id); };

function setupSocket() {
    socket.on('connect', () => { 
        log("Conectado. ID: " + socket.id);
        state.myId = socket.id; ui.login.style.display = 'none'; ui.lobby.style.display = 'flex'; socket.emit('getRooms'); 
    });
    socket.on('disconnect', () => log("Desconectado del servidor.", 'error'));
    socket.on('roomList', (list) => {
        ui.roomList.innerHTML = '';
        if(list.length===0) ui.roomList.innerHTML = '<div style="padding:10px;color:#666">NO HAY SALAS</div>';
        list.forEach(r => { ui.roomList.innerHTML += `<div class="room-item"><span>${r.id} (${r.players}/8)</span><button class="main-btn secondary" onclick="window.joinRoomId('${r.id}')" style="width:auto;padding:5px;font-size:0.7rem;margin:0;">ENTRAR</button></div>`; });
    });
    socket.on('roomCreated', d => { log("Sala creada OK."); startGame(d); });
    socket.on('roomJoined', d => { log("Unido a sala OK."); startGame(d); });
    socket.on('errorMsg', msg => log("Error: " + msg, 'error'));
    socket.on('configUpdated', cfg => {
        state.settings.maxSpeed = cfg.maxSpeed; state.settings.accel = cfg.accel;
        if(!state.isHost) { ui.optMaxSpeed.value = cfg.maxSpeed; ui.dispMaxSpeed.innerText = cfg.maxSpeed; ui.optAccel.value = cfg.accel; ui.dispAccel.innerText = cfg.accel; }
    });
    socket.on('u', (data) => { if(state.inGame) updateRemotePlayers(data); });
    socket.on('playerLeft', id => { 
        if(state.players[id]) { scene.remove(state.players[id].mesh); delete state.players[id]; } 
    });
    setInterval(() => { const t = Date.now(); socket.emit('ping', () => { ui.ping.innerText = `PING: ${Date.now()-t}ms`; }); }, 2000);
}

function startGame(data) {
    try {
        state.seed = data.seed;
        state.isHost = data.isHost;
        state.myLabel = data.label;
        state.settings.maxSpeed = data.config.maxSpeed;
        state.settings.accel = data.config.accel;
        
        ui.optMaxSpeed.value = data.config.maxSpeed; ui.dispMaxSpeed.innerText = data.config.maxSpeed;
        ui.optAccel.value = data.config.accel; ui.dispAccel.innerText = data.config.accel;

        if(state.isHost) { ui.hostControls.classList.remove('disabled-opt'); ui.adminBadge.style.display = 'inline-block'; } 
        else { ui.hostControls.classList.add('disabled-opt'); ui.adminBadge.style.display = 'none'; }

        setSeed(state.seed); // Esto ahora funcionará porque rng está definido
        ui.lobby.style.display = 'none'; ui.loading.style.display = 'flex';
        
        log("Cargando Motor 3D...");
        setTimeout(() => { 
            initThreeJS(); 
            ui.loading.style.display = 'none'; 
            ui.game.style.display = 'block'; 
            state.inGame = true; 
            log("Juego Iniciado.");
            animate(); 
        }, 1000);
    } catch(e) {
        log("Error en startGame: " + e.message, 'error');
    }
}

// ==========================================
// 4. MOTOR 3D
// ==========================================
let scene, camera, renderer, composer, chunks=[], smokeGroup, mainCar;
let sunLight, sunMesh, moonLight, moonMesh, ambientLight, starField;
const smokeParticles = [];
const matOutline = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });

const matRoad = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }); 
const matWall = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
const matLineY = new THREE.MeshBasicMaterial({ color: 0xffcc00, side: THREE.DoubleSide, depthWrite: false });
const matLineW = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthWrite: false });
const matTailLight = new THREE.MeshBasicMaterial({ color: 0xff0000 }); 
const matWater = new THREE.MeshStandardMaterial({ color: 0x2196f3, roughness: 0.4, metalness: 0.1, flatShading: true });
const matPillar = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
const matLeaves = new THREE.MeshStandardMaterial({color: 0x2e7d32});
const matWood = new THREE.MeshStandardMaterial({ color: 0x3e2723 });
const matCloud = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdddddd, emissiveIntensity: 0.2, flatShading: true });
const matAtmosphere = new THREE.PointsMaterial({ size: 0.4, color: 0xffffff, transparent: true, opacity: 0.3 });

function initThreeJS() {
    try {
        scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x87CEEB, 0.002);
        camera = new THREE.PerspectiveCamera(60, window.innerWidth/innerHeight, 0.1, 5000); camera.position.set(0,5,-10);
        renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        const oldCanvas = document.querySelector('canvas'); if(oldCanvas) oldCanvas.remove();
        document.body.appendChild(renderer.domElement);

        const rp = new RenderPass(scene, camera);
        const bp = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, innerHeight), 1.5, 0.4, 0.85);
        bp.threshold=0.8; bp.strength=0.3; bp.radius=0.3;
        composer = new EffectComposer(renderer); composer.addPass(rp); composer.addPass(bp);

        setupEnvironment();
        smokeGroup = new THREE.Group(); scene.add(smokeGroup);
        
        const hue = Math.floor(Math.random()*360);
        mainCar = createCar(`hsl(${hue}, 100%, 50%)`); scene.add(mainCar);
        const hl = new THREE.SpotLight(0xffffff, 800, 300, 0.5, 0.5); hl.position.set(0, 1.5, 2); hl.target.position.set(0,0,20); mainCar.add(hl); mainCar.add(hl.target);

        chunks = []; state.worldGenState = { point: new THREE.Vector3(0,4,0), angle: 0, dist: 0 };
        log("Generando mundo...");
        for(let i=0; i<CONFIG.VISIBLE_CHUNKS; i++) spawnChunk();
        const startData = getTrackData(0); if(startData) state.worldHeading = Math.atan2(startData.tan.x, startData.tan.z);
    } catch(e) {
        log("Error ThreeJS: " + e.message, 'error');
        throw e;
    }
}

function updateCarVisibility() {
    if(!mainCar) return;
    const visible = !state.settings.fpv;
    mainCar.children.forEach(child => { if(child.isMesh) child.visible = visible; });
}

function setupEnvironment() {
    ambientLight = new THREE.AmbientLight(0x404040, 1.5); scene.add(ambientLight);
    sunLight = new THREE.DirectionalLight(0xffdf80, 2.5); sunLight.castShadow = true; 
    sunLight.shadow.mapSize.set(2048, 2048); sunLight.shadow.camera.far = 1000;
    sunLight.shadow.camera.left = -500; sunLight.shadow.camera.right = 500; sunLight.shadow.camera.top = 500; sunLight.shadow.camera.bottom = -500;
    scene.add(sunLight);
    sunMesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffaa00, fog: false })); scene.add(sunMesh);
    moonLight = new THREE.DirectionalLight(0x88ccff, 3.0); scene.add(moonLight);
    moonMesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })); scene.add(moonMesh);
    const sGeo = new THREE.BufferGeometry(); const sPos = []; for(let i=0; i<3000; i++) sPos.push((rng()-0.5)*2000, (rng()-0.5)*1000+500, (rng()-0.5)*2000);
    sGeo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
    starField = new THREE.Points(sGeo, new THREE.PointsMaterial({color: 0xffffff, size: 1.5, transparent: true, opacity: 0})); scene.add(starField);
}

// ==========================================
// 5. GENERACIÓN PROCEDURAL (NOISE & CHUNKS)
// ==========================================
const noisePerm = new Uint8Array(512); 
const p = new Uint8Array(256);

function initNoise() {
    // Regenerar tabla de permutación con el RNG sembrado actual
    for(let i=0; i<256; i++) p[i] = Math.floor(rng()*256);
    for(let i=0; i<512; i++) noisePerm[i] = p[i & 255];
}
// Inicializar con ruido aleatorio por si acaso
for(let i=0; i<256; i++) p[i] = Math.floor(Math.random()*256);
for(let i=0; i<512; i++) noisePerm[i] = p[i & 255];

const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerpFn = (t, a, b) => a + t * (b - a);
const grad = (hash, x, y, z) => { const h = hash & 15; const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v); };
const noise = (x, y) => { const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y); const u = fade(x), v = fade(y); const A = noisePerm[X] + Y, B = noisePerm[X + 1] + Y; return lerpFn(v, lerpFn(u, grad(noisePerm[A], x, y, 0), grad(noisePerm[B], x - 1, y, 0)), lerpFn(u, grad(noisePerm[A + 1], x, y - 1, 0), grad(noisePerm[B + 1], x - 1, y - 1, 0))); };
function getTerrainHeight(x, z) { return noise(x*0.012, z*0.012)*30 + noise(x*0.04, z*0.04)*6; }

class Chunk {
    constructor(idx, startP, startA, globalDist) {
        this.index = idx;
        this.startDist = globalDist;
        this.group = new THREE.Group();
        this.clouds = [];
        scene.add(this.group);

        const angleChange = (rng() - 0.5) * 0.5;
        const endAngle = startA + angleChange;
        const p0 = startP;
        const endX = Math.cos(endAngle) * CONFIG.CHUNK_LENGTH + p0.x;
        const endZ = Math.sin(endAngle) * CONFIG.CHUNK_LENGTH + p0.z;
        
        let tH = getTerrainHeight(endX, endZ);
        let targetY = (tH < 1) ? Math.max(p0.y, 5) : tH + 3.0;
        targetY = THREE.MathUtils.clamp(targetY, p0.y - 6.0, p0.y + 6.0);

        const p3 = new THREE.Vector3(endX, targetY, endZ);
        const cp1 = new THREE.Vector3(Math.cos(startA)*50, 0, Math.sin(startA)*50).add(p0);
        const cp2 = new THREE.Vector3(Math.cos(endAngle)*-50, 0, Math.sin(endAngle)*-50).add(p3);
        
        this.curve = new THREE.CubicBezierCurve3(p0, cp1, cp2, p3);
        this.length = this.curve.getLength();
        this.endDist = globalDist + this.length;
        this.endPoint = p3; this.endAngle = endAngle;

        this.buildGeometry();
        this.buildTerrain();
        this.buildProps();
        this.buildClouds();
        this.buildAtmosphere();
    }

    buildGeometry() {
        const div = 40; 
        const pts = this.curve.getSpacedPoints(div);
        const frames = this.curve.computeFrenetFrames(div, false);
        
        const rV=[], rI=[], wV=[], wI=[], lV=[], lI=[], yV=[], yI=[]; 
        const lineYOffset = CONFIG.ROAD_Y_OFFSET + 0.15; 

        for(let i=0; i<=div; i++) {
            const p = pts[i]; const n = frames.binormals[i]; 
            rV.push(p.x + n.x * CONFIG.ROAD_WIDTH_HALF, p.y + CONFIG.ROAD_Y_OFFSET, p.z + n.z * CONFIG.ROAD_WIDTH_HALF, p.x - n.x * CONFIG.ROAD_WIDTH_HALF, p.y + CONFIG.ROAD_Y_OFFSET, p.z - n.z * CONFIG.ROAD_WIDTH_HALF);

            const yTop = p.y + CONFIG.ROAD_Y_OFFSET + CONFIG.WALL_HEIGHT;
            const yBot = p.y - 2.0;
            const L_In = p.clone().add(n.clone().multiplyScalar(CONFIG.ROAD_WIDTH_HALF));
            const L_Out = p.clone().add(n.clone().multiplyScalar(CONFIG.ROAD_WIDTH_HALF + CONFIG.WALL_WIDTH));
            wV.push(L_In.x, yTop, L_In.z, L_In.x, yBot, L_In.z, L_Out.x, yTop, L_Out.z, L_Out.x, yBot, L_Out.z);
            const R_In = p.clone().add(n.clone().multiplyScalar(-CONFIG.ROAD_WIDTH_HALF));
            const R_Out = p.clone().add(n.clone().multiplyScalar(-(CONFIG.ROAD_WIDTH_HALF + CONFIG.WALL_WIDTH)));
            wV.push(R_In.x, yTop, R_In.z, R_In.x, yBot, R_In.z, R_Out.x, yTop, R_Out.z, R_Out.x, yBot, R_Out.z);

            const distL = CONFIG.ROAD_WIDTH_HALF - 0.8; const sw = 0.4;
            lV.push(p.x + n.x * distL, p.y + lineYOffset, p.z + n.z * distL); 
            lV.push(p.x + n.x * (distL+sw), p.y + lineYOffset, p.z + n.z * (distL+sw));
            lV.push(p.x - n.x * distL, p.y + lineYOffset, p.z - n.z * distL);
            lV.push(p.x - n.x * (distL+sw), p.y + lineYOffset, p.z - n.z * (distL+sw));

            const lw = 0.2;
            yV.push(p.x + n.x * lw, p.y + lineYOffset, p.z + n.z * lw);
            yV.push(p.x - n.x * lw, p.y + lineYOffset, p.z - n.z * lw);
        }

        for(let i=0; i<div; i++) {
            const r = i * 2; rI.push(r, r+2, r+1, r+1, r+2, r+3);
            const w = i * 8; 
            wI.push(w+0, w+8, w+2, w+2, w+8, w+10); wI.push(w+0, w+1, w+8, w+1, w+9, w+8); wI.push(w+2, w+10, w+3, w+3, w+10, w+11);
            wI.push(w+4, w+6, w+12, w+12, w+6, w+14); wI.push(w+4, w+12, w+5, w+5, w+12, w+13); wI.push(w+6, w+7, w+14, w+7, w+15, w+14);
            const l = i * 4;
            lI.push(l, l+4, l+1, l+1, l+4, l+5); lI.push(l+2, l+6, l+3, l+3, l+6, l+7);
            if (i % 2 === 0) { const y = i * 2; yI.push(y, y+2, y+1, y+1, y+2, y+3); }
        }

        const rG = new THREE.BufferGeometry(); rG.setAttribute('position', new THREE.Float32BufferAttribute(rV, 3)); rG.setIndex(rI); rG.computeVertexNormals();
        const rM = new THREE.Mesh(rG, matRoad); rM.receiveShadow = true; this.group.add(rM);
        const wG = new THREE.BufferGeometry(); wG.setAttribute('position', new THREE.Float32BufferAttribute(wV, 3)); wG.setIndex(wI); wG.computeVertexNormals();
        const wM = new THREE.Mesh(wG, matWall); wM.castShadow = true; wM.receiveShadow = true; this.group.add(wM);
        const lG = new THREE.BufferGeometry(); lG.setAttribute('position', new THREE.Float32BufferAttribute(lV, 3)); lG.setIndex(lI); this.group.add(new THREE.Mesh(lG, matLineW));
        if(yI.length > 0) { const yG = new THREE.BufferGeometry(); yG.setAttribute('position', new THREE.Float32BufferAttribute(yV, 3)); yG.setIndex(yI); this.group.add(new THREE.Mesh(yG, matLineY)); }
    }

    buildTerrain() {
        const div = 25; const w = 400; const divW = 10;
        const vs = [], cs = []; const col = new THREE.Color();
        const pts = this.curve.getSpacedPoints(div);
        const frames = this.curve.computeFrenetFrames(div, false);
        for(let i=0; i<=div; i++) {
            const P = pts[i]; const N = frames.binormals[i];
            for(let j=0; j<=divW; j++) {
                const u = (j/divW) - 0.5; const xOff = u * w;
                const px = P.x + N.x * xOff; const pz = P.z + N.z * xOff;
                let py = getTerrainHeight(px, pz);
                if(py < -1) col.setHex(0xe6c288); else if(py < 10) col.setHex(0x2e7d32); else col.setHex(0x5d4037);
                if(Math.abs(xOff) < CONFIG.ROAD_WIDTH_HALF + 5) py = Math.min(py, P.y - 8);
                vs.push(px, py, pz); cs.push(col.r, col.g, col.b);
            }
        }
        const g = createGridGeometry(vs, cs, div, divW);
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({vertexColors: true, flatShading: true}));
        m.receiveShadow = true; this.group.add(m);
        const mid = this.curve.getPointAt(0.5);
        const wa = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), matWater);
        wa.rotation.x = -Math.PI/2; wa.position.set(mid.x, -2, mid.z);
        this.group.add(wa);
    }

    buildProps() {
        for(let i=0; i<=1; i+=0.15) {
            const p = this.curve.getPointAt(i);
            const th = getTerrainHeight(p.x, p.z);
            if(p.y > th + 4) {
                const h = (p.y - 0.5) - th; 
                const pil = new THREE.Mesh(new THREE.BoxGeometry(6, h, 4), matPillar);
                pil.position.set(p.x, th + h/2, p.z);
                pil.castShadow = true;
                this.group.add(pil);
            }
        }
        for(let i=0; i<20; i++) {
            const t = rng(); const side = rng() > 0.5 ? 1 : -1; const dist = CONFIG.ROAD_WIDTH_HALF + 15 + rng() * 60;
            const p = this.curve.getPointAt(t); const tan = this.curve.getTangentAt(t);
            const bin = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
            const pos = p.clone().add(bin.multiplyScalar(side * dist));
            const y = getTerrainHeight(pos.x, pos.z);
            if(y > 0) {
                const gr = new THREE.Group();
                const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 10, 5), matWood); tr.position.y = 5;
                const lv = new THREE.Mesh(new THREE.ConeGeometry(3.5, 9, 5), matLeaves); lv.position.y = 10;
                gr.add(tr, lv); gr.position.set(pos.x, y - 2.0, pos.z); gr.scale.setScalar(0.8 + rng() * 0.5); gr.castShadow = true;
                this.group.add(gr);
            }
        }
    }

    buildClouds() {
        if (rng() > 0.2) { 
            const cloud = new THREE.Group();
            const segs = 4 + Math.floor(rng() * 5); 
            for(let i=0; i<segs; i++) {
                const size = 6 + rng() * 10;
                const m = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), matCloud);
                m.position.set((rng()-0.5)*20, (rng()-0.5)*8, (rng()-0.5)*20);
                m.castShadow = true;
                cloud.add(m);
            }
            const p = this.curve.getPointAt(0.5);
            cloud.position.set(p.x + (rng()-0.5)*400, 50 + rng()*40, p.z + (rng()-0.5)*400);
            this.group.add(cloud);
            this.clouds.push(cloud);
        }
    }

    buildAtmosphere() {
        const pGeo = new THREE.BufferGeometry();
        const pPos = [];
        for(let i=0; i<250; i++) {
            const t = Math.random(); const p = this.curve.getPointAt(t);
            pPos.push(p.x + (Math.random()-0.5)*120, p.y + Math.random()*40, p.z + (Math.random()-0.5)*120);
        }
        pGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
        const parts = new THREE.Points(pGeo, matAtmosphere);
        this.group.add(parts);
    }

    dispose() { scene.remove(this.group); this.group.traverse(o => { if(o.geometry) o.geometry.dispose(); }); }
}

function createGridGeometry(verts, colors, rows, cols) {
    const g = new THREE.BufferGeometry(); const idx = [];
    for(let i=0; i<rows; i++) for(let j=0; j<cols; j++) {
        const a = i * (cols + 1) + j; const b = (i + 1) * (cols + 1) + j;
        const c = (i + 1) * (cols + 1) + (j + 1); const d = i * (cols + 1) + (j + 1);
        idx.push(a, b, d, b, c, d);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
}

function createOutline(geo, scale) { const m = new THREE.Mesh(geo, matOutline); m.scale.multiplyScalar(scale); return m; }

function createCar(colorStr) {
    const car = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorStr), roughness: 0.2, metalness: 0.6 });
    const bGeo = new THREE.BoxGeometry(2.0, 0.7, 4.2);
    const body = new THREE.Mesh(bGeo, matBody); body.position.y = 0.6; body.castShadow = true; car.add(body);
    car.add(createOutline(bGeo, 1.03).translateY(0.6));
    const cGeo = new THREE.BoxGeometry(1.6, 0.5, 2.0);
    const cab = new THREE.Mesh(cGeo, new THREE.MeshStandardMaterial({color:0x111111})); cab.position.set(0, 1.2, -0.2); car.add(cab);
    car.add(createOutline(cGeo, 1.03).translateY(1.2).translateZ(-0.2));
    const sGeo = new THREE.BoxGeometry(2.2, 0.1, 0.6);
    const sp = new THREE.Mesh(sGeo, new THREE.MeshStandardMaterial({color:0x111111})); sp.position.set(0, 1.3, -2.0); car.add(sp);
    const wGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 16).rotateZ(Math.PI/2);
    const matW = new THREE.MeshStandardMaterial({color:0x222222});
    [[1, 1.3], [-1, 1.3], [1, -1.3], [-1, -1.3]].forEach(p => {
        const w = new THREE.Mesh(wGeo, matW); w.position.set(p[0], 0.4, p[1]); car.add(w);
        car.add(createOutline(wGeo, 1.05).translateX(p[0]).translateY(0.4).translateZ(p[1]));
    });
    
    const tlGeo = new THREE.BoxGeometry(0.4, 0.2, 0.1);
    const tl1 = new THREE.Mesh(tlGeo, matTailLight); tl1.position.set(0.6, 0.7, -2.15); car.add(tl1);
    const tl2 = new THREE.Mesh(tlGeo, matTailLight); tl2.position.set(-0.6, 0.7, -2.15); car.add(tl2);
    const tlGlow = new THREE.PointLight(0xff0000, 2, 5); tlGlow.position.set(0, 0.7, -2.5); car.add(tlGlow);

    return car;
}

function spawnChunk() {
    const idx = chunks.length > 0 ? chunks[chunks.length-1].index + 1 : 0;
    const c = new Chunk(idx, state.worldGenState.point, state.worldGenState.angle, state.worldGenState.dist);
    chunks.push(c);
    state.worldGenState.point = c.endPoint; state.worldGenState.angle = c.endAngle; state.worldGenState.dist += c.length;
}

function getTrackData(dist) {
    for(let c of chunks) {
        if(dist >= c.startDist && dist < c.endDist) {
            const t = (dist - c.startDist) / c.length;
            const pos = c.curve.getPointAt(t);
            const tan = c.curve.getTangentAt(t).normalize();
            const up = new THREE.Vector3(0,1,0);
            const right = new THREE.Vector3().crossVectors(tan, up).normalize();
            return { pos, tan, right };
        }
    }
    return null;
}

// ==========================================
// 6. BUCLE PRINCIPAL
// ==========================================
let lastTime = performance.now();
let frames = 0, lastFpsTime = 0;
const COLORS = { night: new THREE.Color(0x020205), dawn: new THREE.Color(0xFD5E53), day: new THREE.Color(0x00BFFF), dusk: new THREE.Color(0x4B0082) };

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    frames++; if(now - lastFpsTime >= 1000) { ui.fps.innerText = "FPS: " + frames; frames=0; lastFpsTime=now; }

    if(state.inGame) {
        // FÍSICAS LOCALES
        const maxSpeed = state.settings.maxSpeed / 100.0; const accel = (state.settings.accel / 100.0) * dt * 2.0;
        if(state.input.gas) { if(state.manualSpeed < maxSpeed) state.manualSpeed += accel; } 
        else if(state.input.brake) { state.manualSpeed -= accel * 2.5; } else { state.manualSpeed *= 0.99; }
        if(state.manualSpeed < 0) state.manualSpeed = 0;

        const baseSens = 0.02 + (state.settings.sens / 100.0) * 0.05; const stiff = (state.settings.stiffness / 100.0) * 5.0; const turnSens = baseSens / (1.0 + (state.manualSpeed * stiff));
        let steerDir = -state.input.steer; if(state.settings.invertSteer) steerDir *= -1;
        state.worldHeading += steerDir * turnSens * (state.manualSpeed * 30.0 * dt);

        const moveX = Math.sin(state.worldHeading) * state.manualSpeed; const moveZ = Math.cos(state.worldHeading) * state.manualSpeed;
        const curData = getTrackData(state.trackDist);
        if(curData) {
            const moveVec = new THREE.Vector3(moveX, 0, moveZ);
            state.trackDist += moveVec.dot(curData.tan); state.lateralOffset += moveVec.dot(curData.right);
            if(Math.abs(state.lateralOffset) > CONFIG.WALL_LIMIT) {
                const roadAngle = Math.atan2(curData.tan.x, curData.tan.z);
                let rel = state.worldHeading - roadAngle; while(rel > Math.PI) rel -= Math.PI*2; while(rel < -Math.PI) rel += Math.PI*2;
                state.lateralOffset = Math.sign(state.lateralOffset) * CONFIG.WALL_LIMIT; state.worldHeading = roadAngle + (-rel * 0.5); state.manualSpeed *= 0.6;
            }
        }

        // UPDATE VISUAL
        const finalData = getTrackData(state.trackDist);
        if(finalData) {
            const pos = finalData.pos.clone(); pos.add(finalData.right.multiplyScalar(state.lateralOffset)); pos.y += CONFIG.ROAD_Y_OFFSET + 0.05;
            mainCar.position.copy(pos); mainCar.rotation.set(0, state.worldHeading, 0);
            
            const targetDist = state.settings.fpv ? -0.5 : state.settings.camDist; const targetHeight = state.settings.fpv ? 2.5 : 7;
            const backVec = new THREE.Vector3(-Math.sin(state.worldHeading), 0, -Math.cos(state.worldHeading));
            const camTarget = pos.clone().add(backVec.multiplyScalar(targetDist)); camTarget.y += targetHeight;
            camera.position.lerp(camTarget, state.settings.fpv ? 0.3 : 0.1);
            camera.lookAt(pos.clone().add(new THREE.Vector3(0, 2, 0)).add(finalData.tan.multiplyScalar(state.settings.fpv ? 50 : 0)));

            const distToEnd = chunks[chunks.length-1].endDist - state.trackDist;
            if(distToEnd < 600) spawnChunk();
            if(chunks.length > CONFIG.VISIBLE_CHUNKS) { chunks[0].dispose(); chunks.shift(); }
        }

        ui.speed.innerText = Math.floor(state.manualSpeed * 100);
        socket.emit('myState', { d: parseFloat(state.trackDist.toFixed(2)), l: parseFloat(state.lateralOffset.toFixed(2)), s: parseFloat(state.manualSpeed.toFixed(3)), h: parseFloat(state.worldHeading.toFixed(3)) });

        // ENTORNO
        const tEnv = now * 0.00005; const carPos = mainCar.position;
        sunLight.position.set(carPos.x + Math.cos(tEnv)*1500, Math.sin(tEnv)*1500, carPos.z); sunLight.target.position.copy(carPos);
        moonLight.position.set(carPos.x - Math.cos(tEnv)*1500, -Math.sin(tEnv)*1500, carPos.z);
        chunks.forEach(c => c.clouds.forEach(cl => cl.position.z += 0.2));
        
        const sin = Math.sin(tEnv); let target = new THREE.Color(); let opStars = 0;
        if (sin < -0.4) { target.copy(COLORS.night); opStars = 1; } else if (sin < 0.1) { const t=(sin+0.4)/0.5; target.copy(COLORS.night).lerp(COLORS.dawn, t); opStars=1-t; } else if (sin < 0.4) { const t=(sin-0.1)/0.3; target.copy(COLORS.dawn).lerp(COLORS.day, t); opStars=0; } else if (sin < 0.8) { target.copy(COLORS.day); opStars=0; } else { const t=(sin-0.8)/0.2; target.copy(COLORS.day).lerp(COLORS.dusk, t); opStars=t*0.5; }
        scene.background = target; scene.fog.color.copy(target); starField.material.opacity = opStars; starField.position.copy(carPos); ambientLight.intensity = Math.max(0.2, sin + 0.5);

        for(let i=smokeParticles.length-1; i>=0; i--) { const p = smokeParticles[i]; p.position.add(p.userData.vel); p.scale.addScalar(0.05); p.userData.life -= 0.02; p.material.opacity = p.userData.life * 0.4; if(p.userData.life <= 0) { smokeGroup.remove(p); smokeParticles.splice(i,1); } }
        composer.render();
    }
}

function updateRemotePlayers(data) {
    const racers = [{ label: state.myLabel, dist: state.trackDist, isMe: true }];
    data.forEach(p => {
        if(p.i === state.myId) return;
        racers.push({ label: p.n, dist: p.d, isMe: false });
        if(!state.players[p.i]) { const mesh = createCar(p.c); scene.add(mesh); state.players[p.i] = { mesh: mesh }; }
        const other = state.players[p.i];
        const tData = getTrackData(p.d);
        if(tData) {
            const pos = tData.pos.clone().add(tData.right.multiplyScalar(p.l)); pos.y += CONFIG.ROAD_Y_OFFSET + 0.05;
            other.mesh.position.lerp(pos, 0.3);
            const curRot = other.mesh.rotation.y; let tgtRot = p.h;
            if(tgtRot - curRot > Math.PI) tgtRot -= Math.PI*2; if(tgtRot - curRot < -Math.PI) tgtRot += Math.PI*2;
            other.mesh.rotation.y += (tgtRot - curRot) * 0.2;
            if(p.s > 0.3 && Math.random() > 0.7) {
                const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3,0), new THREE.MeshStandardMaterial({color:0xaaaaaa, transparent:true, opacity:0.4}));
                s.position.copy(other.mesh.position).add(new THREE.Vector3((Math.random()-0.5), 0.2, -2)); s.userData = { vel: new THREE.Vector3(0, 0.1, -0.2), life: 1.0 }; s.scale.setScalar(0.5); smokeGroup.add(s); smokeParticles.push(s);
            }
        }
    });
    racers.sort((a, b) => b.dist - a.dist);
    const leaderDist = racers[0].dist;
    let html = '';
    racers.forEach((r, idx) => {
        const cls = r.isMe ? 'lb-row lb-me' : 'lb-row';
        let valText = idx === 0 ? (r.dist / 2000).toFixed(2) + ' KM' : ((r.dist - leaderDist) / 2000).toFixed(3) + ' KM';
        html += `<div class="${cls}"><span class="lb-name">${idx+1}. ${r.label}</span><span class="lb-val">${valText}</span></div>`;
    });
    ui.leaderboard.innerHTML = html;
}

// INPUTS
const joyZone = document.getElementById('joystick-zone'); const joyKnob = document.getElementById('joystick-knob');
let joyId = null; const joyCenter = { x: 0, width: 0 };
function handleJoyMove(clientX) {
    let dx = clientX - (joyCenter.x + joyCenter.width/2);
    dx = Math.max(-50, Math.min(50, dx));
    joyKnob.style.transform = `translate(${dx - 25}px, -25px)`;
    state.input.steer = -(dx / 50);
}
joyZone.addEventListener('touchstart', e => { e.preventDefault(); joyId = e.changedTouches[0].identifier; const rect = joyZone.getBoundingClientRect(); joyCenter.x = rect.left; joyCenter.width = rect.width; handleJoyMove(e.changedTouches[0].clientX); });
joyZone.addEventListener('touchmove', e => { e.preventDefault(); for(let i=0; i<e.changedTouches.length; i++) if(e.changedTouches[i].identifier === joyId) handleJoyMove(e.changedTouches[i].clientX); });
joyZone.addEventListener('touchend', e => { e.preventDefault(); joyId = null; joyKnob.style.transform = `translate(-50%, -50%)`; state.input.steer = 0; });
const bindBtn = (id, key) => { const el = document.getElementById(id); const set = (v) => { state.input[key] = v; el.style.transform = v?'scale(0.9)':'scale(1)'; el.style.opacity = v?'1':'0.8'; }; el.addEventListener('touchstart', (e)=>{ e.preventDefault(); set(true); }); el.addEventListener('touchend', (e)=>{ e.preventDefault(); set(false); }); el.addEventListener('mousedown', (e)=>{ e.preventDefault(); set(true); }); el.addEventListener('mouseup', (e)=>{ e.preventDefault(); set(false); }); };
bindBtn('gas-btn', 'gas'); bindBtn('brake-btn', 'brake');
window.addEventListener('keydown', e => { if(e.key === 'ArrowUp' || e.key === 'w') state.input.gas = true; if(e.key === 'ArrowDown' || e.key === 's') state.input.brake = true; if(e.key === 'ArrowLeft' || e.key === 'a') state.input.steer = 1; if(e.key === 'ArrowRight' || e.key === 'd') state.input.steer = -1; });
window.addEventListener('keyup', e => { if(e.key === 'ArrowUp' || e.key === 'w') state.input.gas = false; if(e.key === 'ArrowDown' || e.key === 's') state.input.brake = false; if(['ArrowLeft','ArrowRight','a','d'].includes(e.key)) state.input.steer = 0; });
window.addEventListener('resize', () => { if(camera && renderer) { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight); } });