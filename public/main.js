import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ==========================================
// CONFIGURACIÓN GLOBAL
// ==========================================
const ROAD_WIDTH_HALF = 8.5;
const WALL_WIDTH = 1.5;
const WALL_HEIGHT = 1.2;
const CHUNK_LENGTH = 100;
const VISIBLE_CHUNKS = 15;

// Estado del Juego
const state = {
    inGame: false,
    gameSeed: 0,
    myId: null,
    players: {},    // Mapa de mallas de otros jugadores { id: Mesh }
    myCar: null,    // Referencia directa a mi coche
    mySpeed: 0,
    serverDist: 0,  // Para corrección de posición
    input: { steer: 0, gas: false, brake: false }
};

// Generador de Números Aleatorios Determinista (Seed)
let rngState = 0;
function seedRandom(seed) {
    rngState = seed;
}
// Función "random" propia que reemplaza Math.random para la generación procedural
function rng() {
    const x = Math.sin(rngState++) * 10000;
    return x - Math.floor(x);
}

// ==========================================
// RED Y UI
// ==========================================
let socket;
const ui = {
    login: document.getElementById('screen-login'),
    lobby: document.getElementById('screen-lobby'),
    loading: document.getElementById('loading'),
    hud: document.getElementById('ui-layer'),
    speed: document.getElementById('speed-display'),
    roomList: document.getElementById('room-list')
};

// Inicialización de Eventos UI
document.getElementById('btn-connect').addEventListener('click', connectToServer);
document.getElementById('btn-create').addEventListener('click', () => socket.emit('createRoom', {}));
document.getElementById('btn-refresh').addEventListener('click', () => socket.emit('getRooms'));
document.getElementById('btn-join').addEventListener('click', () => {
    const code = document.getElementById('inp-code').value;
    if(code) socket.emit('joinRoom', code);
});
// Helper global para onclicks en HTML dinámico
window.joinRoomGlobal = (id) => socket.emit('joinRoom', id);

function connectToServer() {
    const status = document.getElementById('status');
    status.innerText = "Conectando...";
    
    socket = io();

    socket.on('connect', () => {
        state.myId = socket.id;
        ui.login.style.display = 'none';
        ui.lobby.style.display = 'flex';
        socket.emit('getRooms');
    });

    socket.on('roomList', (list) => {
        ui.roomList.innerHTML = '';
        if(list.length===0) ui.roomList.innerHTML = '<div style="padding:10px; color:#666">No hay partidas activas.</div>';
        
        list.forEach(r => {
            const div = document.createElement('div');
            div.className = 'room-item';
            div.innerHTML = `<span>Sala <b>${r.id}</b> (${r.players})</span> <button onclick="window.joinRoomGlobal('${r.id}')">UNIRSE</button>`;
            ui.roomList.appendChild(div);
        });
    });

    socket.on('roomCreated', (d) => startGame(d.seed));
    socket.on('roomJoined', (d) => startGame(d.seed));
    socket.on('errorMsg', (msg) => alert(msg));
    
    // BUCLE PRINCIPAL DE RED (Update)
    socket.on('u', (data) => {
        if(state.inGame) updateNetworkPlayers(data);
    });

    socket.on('playerLeft', (id) => {
        if(state.players[id]) {
            scene.remove(state.players[id]);
            delete state.players[id];
        }
    });
}

// ==========================================
// MOTOR GRÁFICO (THREE.JS)
// ==========================================
let scene, camera, renderer, composer;
let chunks = [];
let genPoint, genAngle, totalGenDist;

// MATERIALES (Reutilizados de tu código para optimización)
const matRoad = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8, metalness: 0.1 }); 
const matWall = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
const matLineWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
const matGrass = new THREE.MeshStandardMaterial({ color: 0x112211, roughness: 1, flatShading: true });
const matCloud = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdddddd, emissiveIntensity: 0.2, flatShading: true });
const matCarBody = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.2, metalness: 0.6 }); 
const matCarBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.8 });
const matNeon = new THREE.MeshBasicMaterial({ color: 0x00ffff });

// Luces
let sunLight, sunMesh, moonLight, moonMesh, ambientLight, starField;

function startGame(seed) {
    state.gameSeed = seed;
    seedRandom(seed); // IMPORTANTE: Inicializar RNG con semilla del server
    
    ui.lobby.style.display = 'none';
    ui.loading.style.display = 'flex';

    setTimeout(() => {
        initEngine();
        ui.loading.style.display = 'none';
        ui.hud.style.display = 'block';
        state.inGame = true;
        animate();
    }, 1000);
}

function initEngine() {
    // Scene Setup
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.002);
    
    camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 4000);
    camera.position.set(0, 5, -10);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);

    // Post-Processing
    const rp = new RenderPass(scene, camera);
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloom.threshold = 0.7; bloom.strength = 0.35; bloom.radius = 0.4;
    composer = new EffectComposer(renderer);
    composer.addPass(rp);
    composer.addPass(bloom);

    // Environment
    setupEnvironment();

    // Reset Generación Procedural
    genPoint = new THREE.Vector3(0,0,0);
    genAngle = 0;
    totalGenDist = 0;
    chunks = [];

    // Generar tramos iniciales usando el RNG sincronizado
    for(let i=0; i<VISIBLE_CHUNKS; i++) spawnChunk();
}

function setupEnvironment() {
    ambientLight = new THREE.AmbientLight(0x404040, 2.0);
    scene.add(ambientLight);

    sunLight = new THREE.DirectionalLight(0xffdf80, 2.5);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048,2048);
    sunLight.shadow.camera.far = 1000;
    sunLight.shadow.camera.left = -500; sunLight.shadow.camera.right=500;
    sunLight.shadow.camera.top=500; sunLight.shadow.camera.bottom=-500;
    scene.add(sunLight);

    sunMesh = new THREE.Mesh(new THREE.SphereGeometry(400,32,32), new THREE.MeshBasicMaterial({color:0xffaa00, fog:false}));
    scene.add(sunMesh);

    moonLight = new THREE.DirectionalLight(0x445566, 0.5);
    scene.add(moonLight);
    
    // Estrellas
    const starsGeo = new THREE.BufferGeometry();
    const starPos = [];
    for(let i=0; i<2000; i++) starPos.push((Math.random()-0.5)*2000, (Math.random()-0.5)*1000 + 500, (Math.random()-0.5)*2000);
    starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    starField = new THREE.Points(starsGeo, new THREE.PointsMaterial({color:0xffffff, size:1.5, transparent:true, opacity:0}));
    scene.add(starField);
}

// ==========================================
// GENERACIÓN PROCEDURAL (CLASE CHUNK)
// ==========================================
class Chunk {
    constructor(index, startP, startAngle, globalDist) {
        this.index = index;
        this.startDist = globalDist;
        this.group = new THREE.Group();
        scene.add(this.group);

        // Curva Bezier usando RNG determinista
        const angleChange = (rng() - 0.5) * 1.5; 
        const endAngle = startAngle + angleChange;
        
        const p0 = startP;
        const p3 = new THREE.Vector3(
            Math.cos(endAngle) * CHUNK_LENGTH + p0.x,
            (rng() - 0.5) * 20, // Altura variable
            Math.sin(endAngle) * CHUNK_LENGTH + p0.z
        );
        
        const cp1 = new THREE.Vector3(Math.cos(startAngle)*CHUNK_LENGTH*0.5, 0, Math.sin(startAngle)*CHUNK_LENGTH*0.5).add(p0);
        const cp2 = new THREE.Vector3(Math.cos(endAngle)*-CHUNK_LENGTH*0.5, 0, Math.sin(endAngle)*-CHUNK_LENGTH*0.5).add(p3);
        
        this.curve = new THREE.CubicBezierCurve3(p0, cp1, cp2, p3);
        this.length = this.curve.getLength();
        this.endDist = globalDist + this.length;
        this.endPoint = p3;
        this.endAngle = endAngle;

        this.buildMesh();
        this.buildProps();
    }

    buildMesh() {
        // Generar carretera detallada a lo largo de la curva
        const segments = 20;
        const points = this.curve.getSpacedPoints(segments);
        const frames = this.curve.computeFrenetFrames(segments, false);
        
        const roadGeo = new THREE.PlaneGeometry(1,1, segments, 1);
        const pos = roadGeo.attributes.position;
        
        // Manipular vértices del plano para seguir la curva y anchura
        for(let i=0; i<=segments; i++) {
            const p = points[i];
            const n = frames.binormals[i];
            // Izquierda y Derecha (Top y Bottom en PlaneGeometry original)
            // Indices: 2*i (izq), 2*i+1 (der)
            const v1 = new THREE.Vector3(p.x + n.x * ROAD_WIDTH_HALF, p.y, p.z + n.z * ROAD_WIDTH_HALF);
            const v2 = new THREE.Vector3(p.x - n.x * ROAD_WIDTH_HALF, p.y, p.z - n.z * ROAD_WIDTH_HALF);
            
            pos.setXYZ(i*2, v1.x, v1.y, v1.z);
            pos.setXYZ(i*2+1, v2.x, v2.y, v2.z);
        }
        roadGeo.computeVertexNormals();
        
        const road = new THREE.Mesh(roadGeo, matRoad);
        road.receiveShadow = true;
        this.group.add(road);

        // Muros
        // Simplificado para rendimiento: usar extrusión visual simple o cubos a lo largo del camino
        // Aquí añadimos lineas laterales
        const lineL = new THREE.Mesh(roadGeo.clone(), matLineWhite);
        lineL.position.y = 0.05; lineL.scale.setScalar(0.98); // Hack visual
        this.group.add(lineL);
    }

    buildProps() {
        // Añadir decoración usando RNG determinista
        if(rng() > 0.3) {
            // Arboles / Pilares
            const t = rng();
            const p = this.curve.getPointAt(t);
            const tan = this.curve.getTangentAt(t);
            const n = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
            
            const offset = (rng() > 0.5 ? 1 : -1) * (ROAD_WIDTH_HALF + 5 + rng()*20);
            const pos = p.clone().add(n.multiplyScalar(offset));
            
            const pillar = new THREE.Mesh(new THREE.BoxGeometry(2, 20, 2), matWall);
            pillar.position.set(pos.x, pos.y, pos.z);
            pillar.castShadow = true;
            this.group.add(pillar);
        }
    }

    dispose() {
        scene.remove(this.group);
        this.group.traverse(o => { if(o.geometry) o.geometry.dispose(); });
    }
}

function spawnChunk() {
    const idx = chunks.length > 0 ? chunks[chunks.length-1].index + 1 : 0;
    const c = new Chunk(idx, genPoint, genAngle, totalGenDist);
    chunks.push(c);
    genPoint = c.endPoint; genAngle = c.endAngle; totalGenDist += c.length;
}

function getTrackDataAtDist(d) {
    for(let c of chunks) {
        if(d >= c.startDist && d < c.endDist) {
            const t = (d - c.startDist) / c.length;
            return {
                pos: c.curve.getPointAt(t),
                tan: c.curve.getTangentAt(t).normalize()
            };
        }
    }
    return null; // Fuera de rango (esperar carga)
}

// ==========================================
// COCHE Y ACTUALIZACIÓN
// ==========================================
function createCarMesh(color) {
    const car = new THREE.Group();
    
    // Carrocería
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.2), matCarBody.clone());
    body.material.color.setStyle(color);
    body.position.y = 0.6; body.castShadow = true;
    car.add(body);

    // Cabina
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.0), matCarBlack);
    cabin.position.set(0, 1.2, -0.2);
    car.add(cabin);

    // Ruedas
    const wGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 16);
    wGeo.rotateZ(Math.PI/2);
    const wheels = [
        [1.1, 0.4, 1.5], [-1.1, 0.4, 1.5],
        [1.1, 0.4, -1.5], [-1.1, 0.4, -1.5]
    ];
    wheels.forEach(pos => {
        const w = new THREE.Mesh(wGeo, matCarBlack);
        w.position.set(...pos);
        car.add(w);
    });

    // Neones traseros (Trail)
    const trail = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.1), matNeon);
    trail.position.set(0, 0.6, -2.15);
    car.add(trail);

    return car;
}

function updateNetworkPlayers(data) {
    if(!scene) return;

    data.forEach(p => {
        // Crear coche si no existe
        if(!state.players[p.i]) {
            const mesh = createCarMesh(p.c);
            scene.add(mesh);
            state.players[p.i] = mesh;

            if(p.i === state.myId) {
                state.myCar = mesh;
                // Faros
                const hl = new THREE.SpotLight(0xffffff, 800);
                hl.position.set(0, 2, 1);
                hl.target.position.set(0, 0, 20);
                hl.angle = 0.6; hl.penumbra = 0.5;
                hl.castShadow = true;
                mesh.add(hl);
                mesh.add(hl.target);
            }
        }

        const mesh = state.players[p.i];
        
        // Mapear posición abstracta del servidor (dist, lat) a la curva visual
        const track = getTrackDataAtDist(p.d);
        
        if(track) {
            // Calcular vector "derecha" (Binormal)
            const up = new THREE.Vector3(0,1,0);
            const right = new THREE.Vector3().crossVectors(track.tan, up).normalize();
            
            // Posición final = PuntoCurva + (Right * LateralOffset)
            const finalPos = track.pos.clone().add(right.multiplyScalar(p.l));
            finalPos.y += 0.2; // Altura sobre suelo

            // Interpolación visual
            mesh.position.lerp(finalPos, 0.3);
            
            // Orientación (Mirar adelante en la curva)
            const lookTarget = finalPos.clone().add(track.tan);
            mesh.lookAt(lookTarget);

            if(p.i === state.myId) {
                state.mySpeed = p.s;
                ui.speed.innerHTML = Math.floor(p.s * 100) + '<span id="speed-label">KM/H</span>';
            }
        }
    });
}

function animate() {
    requestAnimationFrame(animate);

    // Enviar Input
    if(state.inGame && socket) {
        socket.emit('playerInput', state.input);
    }

    // Gestión de Chunks Infinita (Basado en mi posición)
    if(state.myCar && chunks.length > 0) {
        // Cámara Follow
        const offset = new THREE.Vector3(0, 7, -14);
        offset.applyQuaternion(state.myCar.quaternion);
        const camPos = state.myCar.position.clone().add(offset);
        camera.position.lerp(camPos, 0.1);
        camera.lookAt(state.myCar.position.clone().add(new THREE.Vector3(0, 0, 20).applyQuaternion(state.myCar.quaternion)));

        // Generar terreno al avanzar
        const lastC = chunks[chunks.length-1];
        if(state.myCar.position.distanceTo(lastC.endPoint) < 800) {
            spawnChunk();
        }
        // Limpiar basura
        if(chunks.length > 20) {
            chunks[0].dispose();
            chunks.shift();
        }

        // Ciclo Día/Noche
        const time = Date.now() * 0.0001;
        const lx = state.myCar.position.x; 
        const lz = state.myCar.position.z;
        
        sunLight.position.set(lx + Math.cos(time)*2000, Math.sin(time)*2000, lz + 500);
        sunLight.target.position.set(lx, 0, lz);
        sunMesh.position.copy(sunLight.position);

        // Ajustar ambiente según altura sol
        if(Math.sin(time) < 0) { // Noche
            starField.material.opacity = 1;
            scene.fog.color.setHex(0x050510);
        } else { // Día
            starField.material.opacity = 0;
            scene.fog.color.setHex(0x87CEEB);
        }
    }

    composer.render();
}

// ==========================================
// CONTROLES
// ==========================================
// Joystick
const joyZone = document.getElementById('joystick-zone');
const joyKnob = document.getElementById('joystick-knob');
let joyId = null; const joyRect = {x:0, w:0};

const moveJoy = (cx) => {
    let dx = cx - (joyRect.x + joyRect.w/2);
    dx = Math.max(-60, Math.min(60, dx));
    joyKnob.style.transform = `translate(${dx-25}px, -25px)`;
    state.input.steer = -(dx / 60); // Invertir para ThreeJS
};

joyZone.addEventListener('touchstart', e=>{ e.preventDefault(); joyId=e.changedTouches[0].identifier; const r=joyZone.getBoundingClientRect(); joyRect.x=r.left; joyRect.w=r.width; moveJoy(e.changedTouches[0].clientX); });
joyZone.addEventListener('touchmove', e=>{ e.preventDefault(); for(let t of e.changedTouches) if(t.identifier===joyId) moveJoy(t.clientX); });
joyZone.addEventListener('touchend', e=>{ e.preventDefault(); joyId=null; state.input.steer=0; joyKnob.style.transform='translate(-50%,-50%)'; });

// Pedales
const bindBtn = (id, key) => {
    const el = document.getElementById(id);
    const on = e=>{e.preventDefault(); state.input[key]=true;};
    const off = e=>{e.preventDefault(); state.input[key]=false;};
    el.addEventListener('touchstart', on); el.addEventListener('touchend', off);
    el.addEventListener('mousedown', on); window.addEventListener('mouseup', off);
};
bindBtn('gas-btn', 'gas');
bindBtn('brake-btn', 'brake');

// Teclado
window.addEventListener('keydown', e=>{
    if(e.key==='ArrowUp'||e.key==='w') state.input.gas=true;
    if(e.key==='ArrowDown'||e.key==='s') state.input.brake=true;
    if(e.key==='ArrowLeft'||e.key==='a') state.input.steer=1;
    if(e.key==='ArrowRight'||e.key==='d') state.input.steer=-1;
});
window.addEventListener('keyup', e=>{
    if(e.key==='ArrowUp'||e.key==='w') state.input.gas=false;
    if(e.key==='ArrowDown'||e.key==='s') state.input.brake=false;
    if(e.key==='ArrowLeft'||e.key==='a'||e.key==='ArrowRight'||e.key==='d') state.input.steer=0;
});