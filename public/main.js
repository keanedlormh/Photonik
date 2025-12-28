import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ==========================================
// CONFIGURACIÓN MEJORADA
// ==========================================
const CONFIG = {
    ROAD_WIDTH_HALF: 9.0,   // Un poco más ancha para evitar claustrofobia
    WALL_WIDTH: 1.2,        // Grosor del muro
    WALL_HEIGHT: 1.5,       // Altura del muro
    ROAD_THICKNESS: 0.5,    // Grosor visual de la capa de asfalto
    CHUNK_LENGTH: 100,
    VISIBLE_CHUNKS: 16
};

const state = {
    inGame: false,
    myId: null,
    players: {},    
    input: { steer: 0, gas: false, brake: false },
    seed: 1234,     
    worldGenState: { 
        point: new THREE.Vector3(0, 4, 0),
        angle: 0,
        dist: 0
    }
};

// ==========================================
// SISTEMA RNG DETERMINISTA
// ==========================================
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}
let rng = mulberry32(1); 
function setSeed(s) { rng = mulberry32(s); }

// ==========================================
// RED Y UI
// ==========================================
let socket;
const ui = {
    login: document.getElementById('screen-login'),
    lobby: document.getElementById('screen-lobby'),
    loading: document.getElementById('loading'),
    game: document.getElementById('game-ui'),
    roomList: document.getElementById('room-list'),
    speed: document.getElementById('speed-display'),
    ping: document.getElementById('ping')
};

document.getElementById('btn-connect').onclick = initNetwork;
document.getElementById('btn-create').onclick = () => socket.emit('createRoom');
document.getElementById('btn-refresh').onclick = () => socket.emit('getRooms');
document.getElementById('btn-join').onclick = () => {
    const code = document.getElementById('inp-code').value;
    if(code) socket.emit('joinRoom', code);
};
window.joinRoomId = (id) => socket.emit('joinRoom', id);

function initNetwork() {
    document.getElementById('status').innerText = "Conectando al servidor...";
    socket = io();

    socket.on('connect', () => {
        state.myId = socket.id;
        ui.login.style.display = 'none';
        ui.lobby.style.display = 'block';
        socket.emit('getRooms');
    });

    socket.on('roomList', (list) => {
        ui.roomList.innerHTML = '';
        if(list.length === 0) ui.roomList.innerHTML = '<div style="padding:10px;">No hay salas activas.</div>';
        list.forEach(r => {
            ui.roomList.innerHTML += `<div class="room-item">
                <span>SALA <b>${r.id}</b> <small>(${r.players} PILOTOS)</small></span>
                <button class="main-btn secondary" onclick="window.joinRoomId('${r.id}')" style="width:80px;">ENTRAR</button>
            </div>`;
        });
    });

    socket.on('roomCreated', (data) => startGame(data));
    socket.on('roomJoined', (data) => startGame(data));
    socket.on('errorMsg', (msg) => alert(msg));
    socket.on('u', (data) => { if(state.inGame) updateWorldState(data); });
    socket.on('playerLeft', (id) => {
        if(state.players[id]) { scene.remove(state.players[id].mesh); delete state.players[id]; }
    });

    setInterval(() => {
        const start = Date.now();
        socket.emit('ping', () => { ui.ping.innerText = `PING: ${Date.now() - start}ms`; });
    }, 2000);
}

function startGame(data) {
    state.seed = data.seed;
    setSeed(state.seed); 
    ui.lobby.style.display = 'none';
    ui.loading.style.display = 'flex';
    setTimeout(() => {
        initThreeJS();
        ui.loading.style.display = 'none';
        ui.game.style.display = 'block';
        state.inGame = true;
        animate();
    }, 1000);
}

// ==========================================
// MOTOR GRÁFICO MEJORADO
// ==========================================
let scene, camera, renderer, composer;
let chunks = [];
let sunLight, sunMesh, moonLight, moonMesh, ambientLight, starField;
const smokeParticles = []; const smokeGroup = new THREE.Group();
const matOutline = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });

// MATERIALES (Asfalto oscuro y rugoso)
const matRoad = new THREE.MeshStandardMaterial({ 
    color: 0x222222, // Gris muy oscuro casi negro
    roughness: 0.9, 
    metalness: 0.1,
    flatShading: false
}); 
const matWall = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.5, metalness: 0.2 });
const matLine = new THREE.MeshBasicMaterial({ color: 0xffff00 }); // Línea amarilla brillante
const matWater = new THREE.MeshStandardMaterial({ color: 0x2196f3, roughness: 0.4, metalness: 0.1, flatShading: true });
const matPillar = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.9 });
const matCloud = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcccccc, emissiveIntensity: 0.2, flatShading: true });
const matLeaves = new THREE.MeshStandardMaterial({color: 0x2e7d32});
const matWood = new THREE.MeshStandardMaterial({ color: 0x3e2723 });

function initThreeJS() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.002);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);
    camera.position.set(0, 5, -10);

    renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true }); // Logarithmic para evitar flickering
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    
    const oldCanvas = document.querySelector('canvas');
    if(oldCanvas) oldCanvas.remove();
    document.body.appendChild(renderer.domElement);

    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.85; bloomPass.strength = 0.3; bloomPass.radius = 0.2;
    
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    setupEnvironment();
    scene.add(smokeGroup);

    chunks = [];
    state.worldGenState = { point: new THREE.Vector3(0, 4, 0), angle: 0, dist: 0 };
    for(let i=0; i<CONFIG.VISIBLE_CHUNKS; i++) spawnChunk();
}

function setupEnvironment() {
    ambientLight = new THREE.AmbientLight(0x404040, 1.5); scene.add(ambientLight);
    sunLight = new THREE.DirectionalLight(0xffdf80, 2.5);
    sunLight.castShadow = true; 
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.far = 1000;
    sunLight.shadow.camera.left = -500; sunLight.shadow.camera.right = 500;
    sunLight.shadow.camera.top = 500; sunLight.shadow.camera.bottom = -500;
    scene.add(sunLight);
    sunMesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffaa00, fog: false }));
    scene.add(sunMesh);
    moonLight = new THREE.DirectionalLight(0x88ccff, 3.0); scene.add(moonLight);
    moonMesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    scene.add(moonMesh);
    
    const sGeo = new THREE.BufferGeometry();
    const sPos = []; for(let i=0; i<3000; i++) sPos.push((rng()-0.5)*2000, (rng()-0.5)*1000+500, (rng()-0.5)*2000);
    sGeo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
    starField = new THREE.Points(sGeo, new THREE.PointsMaterial({color: 0xffffff, size: 1.5, transparent: true, opacity: 0}));
    scene.add(starField);
}

// ==========================================
// GENERACIÓN PROCEDURAL ROBUSTA
// ==========================================
const noisePerm = new Uint8Array(512); const p = new Uint8Array(256);
for(let i=0; i<256; i++) p[i] = Math.floor(rng()*256);
for(let i=0; i<512; i++) noisePerm[i] = p[i & 255];
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t, a, b) => a + t * (b - a);
const grad = (hash, x, y, z) => { const h = hash & 15; const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v); };
const noise = (x, y) => { const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y); const u = fade(x), v = fade(y); const A = noisePerm[X] + Y, B = noisePerm[X + 1] + Y; return lerp(v, lerp(u, grad(noisePerm[A], x, y, 0), grad(noisePerm[B], x - 1, y, 0)), lerp(u, grad(noisePerm[A + 1], x, y - 1, 0), grad(noisePerm[B + 1], x - 1, y - 1, 0))); };
function getTerrainHeight(x, z) { return noise(x*0.012, z*0.012)*30 + noise(x*0.04, z*0.04)*6; }

class Chunk {
    constructor(idx, startP, startA, globalDist) {
        this.index = idx;
        this.startDist = globalDist;
        this.group = new THREE.Group();
        scene.add(this.group);

        const angleChange = (rng() - 0.5) * 0.5;
        const endAngle = startA + angleChange;
        const p0 = startP;
        const endX = Math.cos(endAngle) * CONFIG.CHUNK_LENGTH + p0.x;
        const endZ = Math.sin(endAngle) * CONFIG.CHUNK_LENGTH + p0.z;
        
        let tH = getTerrainHeight(endX, endZ);
        let targetY = (tH < 1) ? Math.max(p0.y, 3) : tH + 2.0;
        targetY = THREE.MathUtils.clamp(targetY, p0.y - 6.0, p0.y + 6.0);

        const p3 = new THREE.Vector3(endX, targetY, endZ);
        const cp1 = new THREE.Vector3(Math.cos(startA)*50, 0, Math.sin(startA)*50).add(p0);
        const cp2 = new THREE.Vector3(Math.cos(endAngle)*-50, 0, Math.sin(endAngle)*-50).add(p3);
        
        this.curve = new THREE.CubicBezierCurve3(p0, cp1, cp2, p3);
        this.length = this.curve.getLength();
        this.endDist = globalDist + this.length;
        this.endPoint = p3; this.endAngle = endAngle;

        this.buildRoadMesh();
        this.buildTerrain();
        this.buildProps();
    }

    buildRoadMesh() {
        const div = 30; 
        const pts = this.curve.getSpacedPoints(div);
        const frames = this.curve.computeFrenetFrames(div, false);
        
        // Arrays para geometría
        const roadV = [], roadN = []; // Asfalto
        const wallV = [], wallN = []; // Muros Sólidos
        const lineV = [], lineN = []; // Líneas discontinuas

        for(let i=0; i<=div; i++) {
            const p = pts[i]; 
            const n = frames.binormals[i]; // Vector Lateral
            const up = frames.normals[i];  // Vector Vertical (Arriba)

            // 1. CARRETERA (Superficie)
            // Calculamos bordes izquierdo y derecho
            const rLeft = p.clone().add(n.clone().multiplyScalar(CONFIG.ROAD_WIDTH_HALF));
            const rRight = p.clone().add(n.clone().multiplyScalar(-CONFIG.ROAD_WIDTH_HALF));
            
            // Asfalto (Quad Strip)
            roadV.push(
                rLeft.x, rLeft.y, rLeft.z,
                rRight.x, rRight.y, rRight.z
            );
            roadN.push(up.x, up.y, up.z, up.x, up.y, up.z);

            // 2. MUROS SÓLIDOS (Grosor real)
            const wHeight = CONFIG.WALL_HEIGHT;
            const wThick = CONFIG.WALL_WIDTH;

            // Muro Izquierdo
            const wlInner = rLeft; // Borde interior (tocando carretera)
            const wlOuter = rLeft.clone().add(n.clone().multiplyScalar(wThick)); // Borde exterior
            
            // Generamos geometría "Strip" para las caras visibles del muro (Top, Inner, Outer)
            // Para simplificar en un solo draw call usamos una lógica de extrusión simple o múltiples strips
            // Aquí usaremos strips verticales para simular solidez.
            
            // Top Muro Izq
            wallV.push(
                wlOuter.x, wlOuter.y + wHeight, wlOuter.z, // Outer Top
                wlInner.x, wlInner.y + wHeight, wlInner.z  // Inner Top
            );
            wallN.push(0,1,0, 0,1,0);

            // 3. LÍNEAS DISCONTINUAS
            // Solo dibujamos si estamos en un segmento "pintado"
            // Patrón: 3 segmentos sí, 2 no
            if (i % 5 < 3 && i < div) {
                // Pequeño quad flotando sobre el asfalto (0.05 arriba)
                const lWidth = 0.25;
                const lLeft = p.clone().add(n.clone().multiplyScalar(lWidth));
                const lRight = p.clone().add(n.clone().multiplyScalar(-lWidth));
                
                // Necesitamos el siguiente punto para hacer el quad (i+1)
                // Como este loop es por vértices para strips, la lógica de líneas es mejor hacerla separada o "hackearla"
                // Para simplificar: solo añadimos vértices si i < div, creando quads independientes luego
            }
        }

        // Construir Asfalto
        const roadGeo = createStripGeometry(roadV, roadN);
        const roadMesh = new THREE.Mesh(roadGeo, matRoad); 
        roadMesh.receiveShadow = true; 
        // Desplazamiento visual vertical para que no se solape con pilares
        roadMesh.position.y = CONFIG.ROAD_THICKNESS; 
        this.group.add(roadMesh);

        // Construir Muros (Usamos Top Strip por ahora, para total solidez se necesitarían 3 strips: Inner, Top, Outer)
        // Simplificación visual efectiva: Muro grueso solo dibujando el tope y usando extrusión o caras laterales
        // Vamos a hacer algo mejor: Muros como objetos extruidos a lo largo de la curva es costoso.
        // Haremos el "Top" del muro y las caras laterales.
        
        // Muro Izquierdo Completo
        this.createWallSolid(pts, frames, 1); // 1 = Izquierda
        this.createWallSolid(pts, frames, -1); // -1 = Derecha

        // Líneas Discontinuas (Generación dedicada)
        this.createDashedLines(pts, frames);
    }

    createWallSolid(pts, frames, side) {
        // side: 1 (Izq), -1 (Der)
        const verts = [];
        const norms = [];
        
        // Definir offsets
        const distInner = CONFIG.ROAD_WIDTH_HALF;
        const distOuter = CONFIG.ROAD_WIDTH_HALF + CONFIG.WALL_WIDTH;
        const h = CONFIG.WALL_HEIGHT;
        const yBase = CONFIG.ROAD_THICKNESS; // Base del muro sobre el asfalto

        // Generaremos 3 caras: Interior (mirando a pista), Superior, Exterior
        // Para optimizar, haremos una sola malla con normales calculadas
        
        for(let i=0; i<pts.length-1; i++) {
            const p1 = pts[i]; const n1 = frames.binormals[i].clone().multiplyScalar(side);
            const p2 = pts[i+1]; const n2 = frames.binormals[i+1].clone().multiplyScalar(side);

            // Puntos base
            const p1In = p1.clone().add(n1.clone().multiplyScalar(distInner));
            const p1Out = p1.clone().add(n1.clone().multiplyScalar(distOuter));
            const p2In = p2.clone().add(n2.clone().multiplyScalar(distInner));
            const p2Out = p2.clone().add(n2.clone().multiplyScalar(distOuter));

            // Ajustar altura base
            p1In.y += yBase; p1Out.y += yBase; p2In.y += yBase; p2Out.y += yBase;

            // CARA SUPERIOR (Top)
            pushQuad(verts, norms, 
                new THREE.Vector3(p1Out.x, p1Out.y+h, p1Out.z),
                new THREE.Vector3(p1In.x, p1In.y+h, p1In.z),
                new THREE.Vector3(p2Out.x, p2Out.y+h, p2Out.z),
                new THREE.Vector3(p2In.x, p2In.y+h, p2In.z),
                new THREE.Vector3(0,1,0)
            );

            // CARA INTERIOR (La que ve el coche)
            // Normal apunta hacia el centro de la pista (aprox -n1)
            const normIn = n1.clone().multiplyScalar(-1);
            pushQuad(verts, norms,
                new THREE.Vector3(p1In.x, p1In.y+h, p1In.z),
                new THREE.Vector3(p1In.x, p1In.y-2, p1In.z), // Extendemos hacia abajo para cubrir pilares
                new THREE.Vector3(p2In.x, p2In.y+h, p2In.z),
                new THREE.Vector3(p2In.x, p2In.y-2, p2In.z),
                normIn
            );

            // CARA EXTERIOR
            pushQuad(verts, norms,
                new THREE.Vector3(p1Out.x, p1Out.y-2, p1Out.z),
                new THREE.Vector3(p1Out.x, p1Out.y+h, p1Out.z),
                new THREE.Vector3(p2Out.x, p2Out.y-2, p2Out.z),
                new THREE.Vector3(p2Out.x, p2Out.y+h, p2Out.z),
                n1 // Normal hacia afuera
            );
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
        const mesh = new THREE.Mesh(geo, matWall);
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.group.add(mesh);
    }

    createDashedLines(pts, frames) {
        const verts = [];
        const width = 0.3; // Ancho de línea
        const yOff = CONFIG.ROAD_THICKNESS + 0.05; // Apenas por encima del asfalto

        for(let i=0; i<pts.length-1; i+=2) { // Saltamos de 2 en 2 para hacer huecos
            // i=0 dibuja, i=1 salta (efecto dash simple)
            // Para dash más largo: dibujar i, i+1, i+2 y saltar i+3
            
            if(i % 6 < 4) { // Patrón: Dibuja 4, salta 2
                const p1 = pts[i]; const n1 = frames.binormals[i];
                const p2 = pts[i+1]; const n2 = frames.binormals[i+1];

                const p1L = p1.clone().add(n1.clone().multiplyScalar(width));
                const p1R = p1.clone().add(n1.clone().multiplyScalar(-width));
                const p2L = p2.clone().add(n2.clone().multiplyScalar(width));
                const p2R = p2.clone().add(n2.clone().multiplyScalar(-width));

                // Elevamos
                p1L.y += yOff; p1R.y += yOff; p2L.y += yOff; p2R.y += yOff;

                pushQuad(verts, [], p1L, p1R, p2L, p2R); // No necesitamos normales para BasicMaterial
            }
        }
        
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        const mesh = new THREE.Mesh(geo, matLine);
        this.group.add(mesh);
    }

    buildTerrain() {
        const div = 20; const w = 400; const divW = 10;
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

                // Hueco enorme bajo la carretera para que los pilares se vean bien
                if(Math.abs(xOff) < CONFIG.ROAD_WIDTH_HALF + 5) py = Math.min(py, P.y - 15);
                
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
        // Pilares Centrales Masivos
        for(let i=0; i<=1; i+=0.1) {
            const p = this.curve.getPointAt(i);
            const th = getTerrainHeight(p.x, p.z);
            if(p.y > th + 5) {
                const h = (p.y + CONFIG.ROAD_THICKNESS) - th; // Desde abajo del asfalto hasta suelo
                const pil = new THREE.Mesh(new THREE.BoxGeometry(10, h, 4), matPillar);
                pil.position.set(p.x, th + h/2, p.z);
                pil.castShadow = true;
                this.group.add(pil);
            }
        }
        // Árboles
        for(let i=0; i<8; i++) {
            const t = rng(); const side = rng() > 0.5 ? 1 : -1; const dist = CONFIG.ROAD_WIDTH_HALF + 15 + rng() * 60;
            const p = this.curve.getPointAt(t); const tan = this.curve.getTangentAt(t);
            const bin = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
            const pos = p.clone().add(bin.multiplyScalar(side * dist));
            const y = getTerrainHeight(pos.x, pos.z);
            if(y > 0) {
                const gr = new THREE.Group();
                const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 6, 5), matWood); tr.position.y = 3;
                const lv = new THREE.Mesh(new THREE.ConeGeometry(3, 8, 5), matLeaves); lv.position.y = 8;
                gr.add(tr, lv); gr.position.set(pos.x, y, pos.z); gr.scale.setScalar(0.8 + rng() * 0.5); gr.castShadow = true;
                this.group.add(gr);
            }
        }
    }
    dispose() { scene.remove(this.group); this.group.traverse(o => { if(o.geometry) o.geometry.dispose(); }); }
}

// Helpers Geometría
function pushQuad(verts, norms, tl, tr, bl, br, norm) {
    verts.push(tl.x, tl.y, tl.z, bl.x, bl.y, bl.z, tr.x, tr.y, tr.z);
    verts.push(tr.x, tr.y, tr.z, bl.x, bl.y, bl.z, br.x, br.y, br.z);
    if(norm) {
        norms.push(norm.x, norm.y, norm.z, norm.x, norm.y, norm.z, norm.x, norm.y, norm.z);
        norms.push(norm.x, norm.y, norm.z, norm.x, norm.y, norm.z, norm.x, norm.y, norm.z);
    }
}

function createStripGeometry(verts, norms) {
    const g = new THREE.BufferGeometry();
    const idx = [];
    const vCount = verts.length / 3;
    for(let i=0; i<vCount-2; i+=2) idx.push(i, i+1, i+2, i+2, i+1, i+3);
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    if(norms) g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
    g.setIndex(idx);
    return g;
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

// ==========================================
// GESTIÓN DEL COCHE
// ==========================================
function createOutline(geo, scale) {
    const m = new THREE.Mesh(geo, matOutline); m.scale.multiplyScalar(scale); return m;
}

function createCar(colorStr) {
    const car = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorStr), roughness: 0.2, metalness: 0.6 });

    const bGeo = new THREE.BoxGeometry(2.0, 0.7, 4.2);
    const body = new THREE.Mesh(bGeo, matBody); body.position.y = 0.6; body.castShadow = true; car.add(body);
    car.add(createOutline(bGeo, 1.03).translateY(0.6));

    const cGeo = new THREE.BoxGeometry(1.6, 0.5, 2.0);
    const cab = new THREE.Mesh(cGeo, new THREE.MeshStandardMaterial({color:0x111111})); 
    cab.position.set(0, 1.2, -0.2); car.add(cab);
    car.add(createOutline(cGeo, 1.03).translateY(1.2).translateZ(-0.2));

    const sGeo = new THREE.BoxGeometry(2.2, 0.1, 0.6);
    const sp = new THREE.Mesh(sGeo, new THREE.MeshStandardMaterial({color:0x111111})); sp.position.set(0, 1.3, -2.0); car.add(sp);

    const wGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 16).rotateZ(Math.PI/2);
    const matW = new THREE.MeshStandardMaterial({color:0x222222});
    [[1, 1.3], [-1, 1.3], [1, -1.3], [-1, -1.3]].forEach(p => {
        const w = new THREE.Mesh(wGeo, matW); w.position.set(p[0], 0.4, p[1]); car.add(w);
        car.add(createOutline(wGeo, 1.05).translateX(p[0]).translateY(0.4).translateZ(p[1]));
    });
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
            const up = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(tan, up).normalize();
            return { pos, tan, right };
        }
    }
    return null;
}

function updateWorldState(data) {
    if(!scene) return;
    data.forEach(pData => {
        const pid = pData.i;
        if(!state.players[pid]) {
            const mesh = createCar(pData.c); scene.add(mesh);
            if(pid === state.myId) {
                const hl = new THREE.SpotLight(0xffffff, 800, 300, 0.5, 0.5);
                hl.position.set(0, 1.5, 2); hl.target.position.set(0, 0, 20);
                mesh.add(hl); mesh.add(hl.target);
            }
            state.players[pid] = { mesh: mesh };
        }
        const playerObj = state.players[pid];
        const trackInfo = getTrackData(pData.d);
        if(trackInfo) {
            const finalPos = trackInfo.pos.clone();
            finalPos.add(trackInfo.right.multiplyScalar(pData.l)); 
            
            // CORRECCIÓN FÍSICA: COCHE SOBRE ASFALTO
            // Asfalto está en Y + ROAD_THICKNESS. El coche tiene su origen en 0, y las ruedas radius 0.4
            finalPos.y += CONFIG.ROAD_THICKNESS + 0.05; 

            playerObj.mesh.position.lerp(finalPos, 0.3);
            const lookTarget = finalPos.clone().add(trackInfo.tan);
            playerObj.mesh.lookAt(lookTarget);

            if(pid === state.myId) {
                ui.speed.innerText = Math.floor(pData.s * 100);
                const offset = new THREE.Vector3(0, 6, -12); offset.applyQuaternion(playerObj.mesh.quaternion);
                const camPos = playerObj.mesh.position.clone().add(offset);
                camera.position.lerp(camPos, 0.1); camera.lookAt(playerObj.mesh.position.clone().add(new THREE.Vector3(0, 2, 0)));
                const distToEnd = chunks[chunks.length-1].endDist - pData.d;
                if(distToEnd < 600) spawnChunk();
                if(chunks.length > CONFIG.VISIBLE_CHUNKS) { chunks[0].dispose(); chunks.shift(); }
            }
            
            if(pData.s > 0.3 && Math.random() > 0.7) {
                const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3,0), new THREE.MeshStandardMaterial({color:0xaaaaaa, transparent:true, opacity:0.4}));
                s.position.copy(playerObj.mesh.position).add(new THREE.Vector3((Math.random()-0.5), 0.2, -2));
                s.userData = { vel: new THREE.Vector3(0, 0.1, -0.2), life: 1.0 }; s.scale.setScalar(0.5);
                smokeGroup.add(s); smokeParticles.push(s);
            }
        }
    });
}

function animate() {
    requestAnimationFrame(animate);
    if(state.inGame) {
        socket.emit('playerInput', state.input);
        const time = Date.now() * 0.0001;
        if(state.players[state.myId]) {
            const carPos = state.players[state.myId].mesh.position;
            sunLight.position.set(carPos.x + Math.cos(time)*1000, Math.sin(time)*1000, carPos.z);
            sunLight.target.position.copy(carPos); sunMesh.position.copy(sunLight.position);
            moonLight.position.set(carPos.x - Math.cos(time)*1000, -Math.sin(time)*1000, carPos.z);
            moonMesh.position.copy(moonLight.position);
            if(Math.sin(time) > 0) { scene.background = new THREE.Color(0x87CEEB); scene.fog.color.setHex(0x87CEEB); starField.material.opacity = 0; } 
            else { scene.background = new THREE.Color(0x050510); scene.fog.color.setHex(0x050510); starField.material.opacity = 1; starField.position.copy(carPos); }
        }
        for(let i=smokeParticles.length-1; i>=0; i--) {
            const p = smokeParticles[i]; p.position.add(p.userData.vel); p.scale.addScalar(0.05); p.userData.life -= 0.02; p.material.opacity = p.userData.life * 0.4;
            if(p.userData.life <= 0) { smokeGroup.remove(p); smokeParticles.splice(i, 1); }
        }
        composer.render();
    }
}

// INPUTS
const joyZone = document.getElementById('joystick-zone'); const joyKnob = document.getElementById('joystick-knob');
let joyId = null; const joyCenter = { x: 0, width: 0 };
function handleJoyMove(clientX) {
    let dx = clientX - (joyCenter.x + joyCenter.width/2); dx = Math.max(-50, Math.min(50, dx));
    joyKnob.style.transform = `translate(${dx - 25}px, -25px)`; state.input.steer = -(dx / 50);
}
joyZone.addEventListener('touchstart', e => { e.preventDefault(); joyId = e.changedTouches[0].identifier; const rect = joyZone.getBoundingClientRect(); joyCenter.x = rect.left; joyCenter.width = rect.width; handleJoyMove(e.changedTouches[0].clientX); });
joyZone.addEventListener('touchmove', e => { e.preventDefault(); for(let i=0; i<e.changedTouches.length; i++) if(e.changedTouches[i].identifier === joyId) handleJoyMove(e.changedTouches[i].clientX); });
joyZone.addEventListener('touchend', e => { e.preventDefault(); joyId = null; joyKnob.style.transform = `translate(-50%, -50%)`; state.input.steer = 0; });
const bindBtn = (id, key) => { const el = document.getElementById(id); const set = (v) => { state.input[key] = v; el.style.transform = v ? 'scale(0.9)' : 'scale(1)'; el.style.opacity = v ? '1' : '0.8'; }; el.addEventListener('touchstart', (e)=>{ e.preventDefault(); set(true); }); el.addEventListener('touchend', (e)=>{ e.preventDefault(); set(false); }); el.addEventListener('mousedown', (e)=>{ e.preventDefault(); set(true); }); el.addEventListener('mouseup', (e)=>{ e.preventDefault(); set(false); }); };
bindBtn('gas-btn', 'gas'); bindBtn('brake-btn', 'brake');
window.addEventListener('keydown', e => { if(e.key === 'ArrowUp' || e.key === 'w') state.input.gas = true; if(e.key === 'ArrowDown' || e.key === 's') state.input.brake = true; if(e.key === 'ArrowLeft' || e.key === 'a') state.input.steer = 1; if(e.key === 'ArrowRight' || e.key === 'd') state.input.steer = -1; });
window.addEventListener('keyup', e => { if(e.key === 'ArrowUp' || e.key === 'w') state.input.gas = false; if(e.key === 'ArrowDown' || e.key === 's') state.input.brake = false; if(['ArrowLeft','ArrowRight','a','d'].includes(e.key)) state.input.steer = 0; });
window.addEventListener('resize', () => { if(camera && renderer) { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight); } });