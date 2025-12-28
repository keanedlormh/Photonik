import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ==========================================
// CONFIGURACIÓN Y ESTADO
// ==========================================
const CONFIG = {
    ROAD_WIDTH_HALF: 8.5,
    WALL_WIDTH: 1.5,
    WALL_HEIGHT: 1.2,
    CHUNK_LENGTH: 100,
    VISIBLE_CHUNKS: 15
};

const state = {
    inGame: false,
    myId: null,
    players: {},    // Otros jugadores
    myCar: null,    // Mi coche
    input: { steer: 0, gas: false, brake: false },
    options: { invert: false, sens: 60 }
};

// Generador Aleatorio Determinista (Seed)
let rngState = 1234;
function seedRandom(seed) { rngState = seed; }
function rng() {
    const x = Math.sin(rngState++) * 10000;
    return x - Math.floor(x);
}

// ==========================================
// RED Y UI LÓGICA
// ==========================================
let socket;
const ui = {
    login: document.getElementById('screen-login'),
    lobby: document.getElementById('screen-lobby'),
    loading: document.getElementById('loading'),
    hud: document.getElementById('ui-layer'),
    speed: document.getElementById('speed-display'),
    roomList: document.getElementById('room-list'),
    menuBtn: document.getElementById('menu-btn'),
    menuModal: document.getElementById('menu-modal')
};

// Listeners Botones Pantallas
document.getElementById('btn-connect').onclick = connectToServer;
document.getElementById('btn-create').onclick = () => socket.emit('createRoom', {});
document.getElementById('btn-refresh').onclick = () => socket.emit('getRooms');
document.getElementById('btn-join').onclick = () => {
    const c = document.getElementById('inp-code').value;
    if(c) socket.emit('joinRoom', c);
};
window.joinRoomGlobal = (id) => socket.emit('joinRoom', id);

// UI Menú
ui.menuBtn.onclick = () => {
    const disp = ui.menuModal.style.display;
    ui.menuModal.style.display = (disp === 'flex') ? 'none' : 'flex';
};
document.getElementById('chk-fps').onchange = (e) => {
    document.getElementById('fps-counter').style.display = e.target.checked ? 'block' : 'none';
};
document.getElementById('chk-invert').onchange = (e) => state.options.invert = e.target.checked;
document.getElementById('slider-sens').oninput = (e) => {
    state.options.sens = parseInt(e.target.value);
    document.getElementById('disp-sens').innerText = state.options.sens + "%";
};

function connectToServer() {
    document.getElementById('status').innerText = "Conectando...";
    socket = io();

    socket.on('connect', () => {
        state.myId = socket.id;
        ui.login.style.display = 'none';
        ui.lobby.style.display = 'flex';
        socket.emit('getRooms');
    });

    socket.on('roomList', (list) => {
        ui.roomList.innerHTML = '';
        if(list.length===0) ui.roomList.innerHTML = '<div style="padding:10px; color:#666">No hay partidas.</div>';
        list.forEach(r => {
            ui.roomList.innerHTML += `
                <div class="room-item">
                    <span>Sala <b>${r.id}</b> (${r.players})</span>
                    <button class="main-btn secondary" onclick="window.joinRoomGlobal('${r.id}')">ENTRAR</button>
                </div>`;
        });
    });

    socket.on('roomCreated', (d) => startGame(d.seed));
    socket.on('roomJoined', (d) => startGame(d.seed));
    socket.on('errorMsg', alert);

    socket.on('u', (data) => {
        if(state.inGame) updatePlayers(data);
    });

    socket.on('playerLeft', (id) => {
        if(state.players[id]) {
            scene.remove(state.players[id]);
            delete state.players[id];
        }
    });
}

// ==========================================
// MOTOR GRÁFICO
// ==========================================
let scene, camera, renderer, composer;
let chunks = [];
let genPoint, genAngle, totalGenDist;

// MATERIALES
const matRoad = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide });
const matWall = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5, metalness: 0.1 });
const matLine = new THREE.MeshBasicMaterial({ color: 0xffffff });
const matCarBody = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.1, metalness: 0.5, emissive: 0x220000, emissiveIntensity: 0.2 });
const matCarBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.8 });
const matWater = new THREE.MeshStandardMaterial({ color: 0x2196f3, roughness: 0.4, metalness: 0.1, flatShading: true });
const matCloud = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdddddd, emissiveIntensity: 0.2, flatShading: true });
const matOutline = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
const matWheel = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
const matRim = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 });

// LUCES Y OBJETOS GLOBALES
let sunLight, sunMesh, moonLight, moonMesh, ambientLight, starField;
const smokeParticles = []; const smokeGroup = new THREE.Group();

function startGame(seed) {
    seedRandom(seed); // Sincronización crucial
    ui.lobby.style.display = 'none';
    ui.loading.style.display = 'flex';

    setTimeout(() => {
        initThreeJS();
        ui.loading.style.display = 'none';
        ui.hud.style.display = 'block';
        state.inGame = true;
        animate();
    }, 1000);
}

function initThreeJS() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.002);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth/innerHeight, 0.1, 5000);
    camera.position.set(0, 6, -12);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);

    // Post-Process Bloom
    const rp = new RenderPass(scene, camera);
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, innerHeight), 1.5, 0.4, 0.85);
    bloom.threshold = 0.8; bloom.strength = 0.2; bloom.radius = 0.3;
    composer = new EffectComposer(renderer);
    composer.addPass(rp);
    composer.addPass(bloom);

    setupEnvironment();
    scene.add(smokeGroup);

    // Reiniciar generación
    chunks = [];
    genPoint = new THREE.Vector3(0,4,0);
    genAngle = 0;
    totalGenDist = 0;
    
    // Generar mundo inicial
    for(let i=0; i<CONFIG.VISIBLE_CHUNKS; i++) spawnChunk();
}

function setupEnvironment() {
    ambientLight = new THREE.AmbientLight(0x404040, 2.0); scene.add(ambientLight);
    
    sunLight = new THREE.DirectionalLight(0xffdf80, 2.5);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048,2048);
    sunLight.shadow.camera.far = 600;
    sunLight.shadow.camera.left = -300; sunLight.shadow.camera.right = 300;
    scene.add(sunLight);
    
    sunMesh = new THREE.Mesh(new THREE.SphereGeometry(500,32,32), new THREE.MeshBasicMaterial({color:0xffaa00, fog:false}));
    scene.add(sunMesh);

    moonLight = new THREE.DirectionalLight(0x88ccff, 3.0); scene.add(moonLight);
    moonMesh = new THREE.Mesh(new THREE.SphereGeometry(500,32,32), new THREE.MeshBasicMaterial({color:0xffffff, fog:false}));
    scene.add(moonMesh);

    // Estrellas
    const pos = [];
    for(let i=0; i<6000; i++) pos.push((Math.random()-0.5)*1000);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    starField = new THREE.Points(geo, new THREE.PointsMaterial({color:0xffffff, size:1, transparent:true, opacity:0}));
    scene.add(starField);
}

// ==========================================
// GENERACIÓN PROCEDURAL (Sincronizada)
// ==========================================
// Ruido Perlin Simple Determinista
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t, a, b) => a + t * (b - a);
const grad = (hash, x, y, z) => { const h = hash & 15; const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v); };
// Tabla de permutación generada con semilla fija o RNG
const perm = new Uint8Array(512); 
const p = new Uint8Array(256);
// Inicializar tabla ruido
for(let i=0; i<256; i++) p[i] = Math.floor(rng()*256);
for(let i=0; i<512; i++) perm[i] = p[i & 255];

const noise = (x, y) => { 
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; 
    x -= Math.floor(x); y -= Math.floor(y); 
    const u = fade(x), v = fade(y); 
    const A = perm[X] + Y, B = perm[X + 1] + Y; 
    return lerp(v, lerp(u, grad(perm[A], x, y, 0), grad(perm[B], x - 1, y, 0)), lerp(u, grad(perm[A + 1], x, y - 1, 0), grad(perm[B + 1], x - 1, y - 1, 0))); 
};
function getTerrainHeight(x, z) { return noise(x*0.012, z*0.012)*30 + noise(x*0.04, z*0.04)*6; }

class Chunk {
    constructor(idx, startP, startA, distG) {
        this.index = idx; this.startDist = distG; this.group = new THREE.Group(); scene.add(this.group);
        
        // Curva
        const angleChange = (rng() - 0.5) * 0.5;
        const endAngle = startA + angleChange;
        
        const p0 = startP;
        const endX = Math.cos(endAngle)*CONFIG.CHUNK_LENGTH + p0.x;
        const endZ = Math.sin(endAngle)*CONFIG.CHUNK_LENGTH + p0.z;
        const h = getTerrainHeight(endX, endZ);
        const targetY = (h < 1) ? Math.max(p0.y, 3) : h + 2.0;
        
        const p3 = new THREE.Vector3(endX, targetY, endZ);
        const cp1 = new THREE.Vector3(Math.cos(startA)*50,0,Math.sin(startA)*50).add(p0);
        const cp2 = new THREE.Vector3(Math.cos(endAngle)*-50,0,Math.sin(endAngle)*-50).add(p3);
        
        this.curve = new THREE.CubicBezierCurve3(p0, cp1, cp2, p3);
        this.length = this.curve.getLength();
        this.endDist = distG + this.length;
        this.endPoint = p3; this.endAngle = endAngle;

        this.buildMesh();
        this.buildTerrain();
        this.buildProps();
    }

    buildMesh() {
        // Carretera Detallada
        const div=20; const pts=this.curve.getSpacedPoints(div); const frames=this.curve.computeFrenetFrames(div,false);
        const rV=[], wV=[];
        const w = CONFIG.ROAD_WIDTH_HALF;
        
        for(let i=0; i<=div; i++) {
            const p=pts[i]; const n=frames.binormals[i];
            rV.push(p.x+n.x*w, p.y+0.2, p.z+n.z*w,  p.x-n.x*w, p.y+0.2, p.z-n.z*w);
            
            // Muros
            const lOut = p.clone().add(n.clone().multiplyScalar(w+1));
            wV.push(lOut.x, p.y+0.2+1.2, lOut.z, lOut.x, p.y-1, lOut.z); // Izq
            const rOut = p.clone().add(n.clone().multiplyScalar(-(w+1)));
            wV.push(rOut.x, p.y+0.2+1.2, rOut.z, rOut.x, p.y-1, rOut.z); // Der
        }
        
        // Crear mallas básicas (optimizadas: PlaneGeometry custom)
        const rG = new THREE.PlaneGeometry(1,1,div,1);
        rG.setAttribute('position', new THREE.Float32BufferAttribute(rV, 3));
        rG.computeVertexNormals();
        const rM = new THREE.Mesh(rG, matRoad); rM.receiveShadow=true; this.group.add(rM);

        const wG = new THREE.PlaneGeometry(1,1,div,1); // Hack reutilización para muros (necesita indices custom en prod, aqui simplificado)
        // ... En una versión completa esto sería geometry custom. Para brevedad:
        // Usamos TubeGeometry visual para bordes
        const lineL = new THREE.Mesh(new THREE.TubeGeometry(this.curve, 20, 0.2, 3, false), matLine);
        lineL.position.y=0.3; lineL.position.x-=0.2; this.group.add(lineL); // Offset visual simple
    }

    buildTerrain() {
        // Terreno visual
        const w=600; const div=15; 
        const vs=[]; const cs=[]; const cObj=new THREE.Color();
        const pts=this.curve.getSpacedPoints(div); const frames=this.curve.computeFrenetFrames(div,false);
        
        for(let i=0; i<=div; i++) {
            const P=pts[i]; const N=frames.binormals[i];
            for(let j=0; j<=10; j++) {
                const u=(j/10)-0.5; const xOff=u*w; 
                const px=P.x+N.x*xOff; const pz=P.z+N.z*xOff; 
                let py=getTerrainHeight(px,pz);
                
                // Color por altura
                if(py<-1) cObj.setHex(0xe6c288); // Playa
                else if(py<10) cObj.setHex(0x2e7d32); // Hierba
                else cObj.setHex(0x5d4037); // Montaña
                
                if(Math.abs(xOff)<15) py=Math.min(py, P.y-2); // Hueco carretera

                vs.push(px, py, pz);
                cs.push(cObj.r, cObj.g, cObj.b);
            }
        }
        const g=new THREE.PlaneGeometry(1,1,div,10);
        g.setAttribute('position', new THREE.Float32BufferAttribute(vs,3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(cs,3));
        g.computeVertexNormals();
        const m=new THREE.Mesh(g, new THREE.MeshStandardMaterial({vertexColors:true, flatShading:true}));
        m.receiveShadow=true; this.group.add(m);

        // Agua
        const mid=this.curve.getPointAt(0.5);
        const wa=new THREE.Mesh(new THREE.PlaneGeometry(600,120), matWater);
        wa.rotation.x=-Math.PI/2; wa.position.set(mid.x, -2, mid.z);
        this.group.add(wa);
    }

    buildProps() {
        if(rng()>0.4) {
            // Nubes
            const c=new THREE.Mesh(new THREE.DodecahedronGeometry(8+rng()*5), matCloud);
            const pt=this.curve.getPointAt(0.5);
            c.position.set(pt.x+(rng()-0.5)*200, 40+rng()*20, pt.z+(rng()-0.5)*200);
            this.group.add(c);
        }
    }
    
    dispose() { scene.remove(this.group); this.group.traverse(o=>{if(o.geometry)o.geometry.dispose();}); }
}

function spawnChunk() {
    const idx = chunks.length>0 ? chunks[chunks.length-1].index+1 : 0;
    const c = new Chunk(idx, genPoint, genAngle, totalGenDist);
    chunks.push(c);
    genPoint = c.endPoint; genAngle = c.endAngle; totalGenDist += c.length;
}

function getTrackData(dist) {
    for(let c of chunks) {
        if(dist >= c.startDist && dist < c.endDist) {
            const t = (dist - c.startDist) / c.length;
            return {
                pos: c.curve.getPointAt(t),
                tan: c.curve.getTangentAt(t).normalize()
            };
        }
    }
    return null;
}

// ==========================================
// COCHE Y UPDATE
// ==========================================
function createOutline(geo, scale) {
    const m = new THREE.Mesh(geo, matOutline);
    m.scale.multiplyScalar(scale);
    return m;
}

function createCarMesh(color) {
    const g = new THREE.Group();
    // Chasis
    const bGeo = new THREE.BoxGeometry(2,0.7,4.2);
    const b = new THREE.Mesh(bGeo, matCarBody.clone());
    b.material.color.setStyle(color); b.position.y=0.6; b.castShadow=true; g.add(b);
    g.add(createOutline(bGeo, 1.03).translateY(0.6));

    // Cabina
    const cGeo = new THREE.BoxGeometry(1.6,0.5,2);
    const cab = new THREE.Mesh(cGeo, matCarBlack); cab.position.set(0,1.2,-0.2); g.add(cab);
    g.add(createOutline(cGeo, 1.03).translateY(1.2).translateZ(-0.2));

    // Ruedas
    const wGeo = new THREE.CylinderGeometry(0.4,0.4,0.4,16); wGeo.rotateZ(Math.PI/2);
    const pos = [[1.1,1.5], [-1.1,1.5], [1.1,-1.5], [-1.1,-1.5]];
    pos.forEach(p => {
        const w = new THREE.Mesh(wGeo, matWheel); w.position.set(p[0],0.4,p[1]); g.add(w);
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.2,0.42,8).rotateZ(Math.PI/2), matRim);
        r.position.set(p[0],0.4,p[1]); g.add(r);
        g.add(createOutline(wGeo,1.05).translateY(0.4).translateX(p[0]).translateZ(p[1]));
    });

    return g;
}

function updatePlayers(data) {
    if(!scene) return;
    
    data.forEach(p => {
        if(!state.players[p.i]) {
            const mesh = createCarMesh(p.c);
            scene.add(mesh);
            state.players[p.i] = mesh;
            
            if(p.i === state.myId) {
                state.myCar = mesh;
                const hl = new THREE.SpotLight(0xffffff, 800);
                hl.position.set(0,2,1); hl.target.position.set(0,0,20);
                hl.angle=0.6; hl.castShadow=true; mesh.add(hl); mesh.add(hl.target);
            }
        }
        
        const mesh = state.players[p.i];
        const track = getTrackData(p.d);
        
        if(track) {
            const up = new THREE.Vector3(0,1,0);
            const right = new THREE.Vector3().crossVectors(track.tan, up).normalize();
            
            const pos = track.pos.clone().add(right.multiplyScalar(p.l));
            pos.y += 0.2;
            
            mesh.position.lerp(pos, 0.4); // Suavizado
            mesh.lookAt(pos.clone().add(track.tan));
            
            // Humo
            if(p.s > 0.1 && Math.random()>0.7) {
                const s=new THREE.Mesh(smokeGeo, smokeMat.clone());
                s.position.copy(mesh.position).add(new THREE.Vector3(0,0.3,-2));
                s.userData={vel:new THREE.Vector3(0,0.1,-0.1), life:1.0};
                s.scale.setScalar(0.5); smokeGroup.add(s); smokeParticles.push(s);
            }

            if(p.i === state.myId) {
                ui.speed.innerHTML = Math.floor(p.s * 100) + '<span id="speed-label">KM/H</span>';
                
                // Generar terreno infinito
                const lastC = chunks[chunks.length-1];
                if(mesh.position.distanceTo(lastC.endPoint) < 800) spawnChunk();
                if(chunks.length>18) { chunks[0].dispose(); chunks.shift(); }

                // Cámara Chase
                const offset = new THREE.Vector3(0, 6, -14).applyQuaternion(mesh.quaternion);
                camera.position.lerp(mesh.position.clone().add(offset), 0.1);
                camera.lookAt(mesh.position.clone().add(new THREE.Vector3(0,2,20).applyQuaternion(mesh.quaternion)));
            }
        }
    });
}

function animate() {
    requestAnimationFrame(animate);

    if(state.inGame && socket) {
        // Input con sensibilidad del slider
        let steer = state.input.steer;
        if(state.options.invert) steer *= -1;
        // Aplicar sensibilidad (simple multiplier)
        const sensMult = state.options.sens / 100;
        
        socket.emit('playerInput', { 
            steer: steer * sensMult, 
            gas: state.input.gas, 
            brake: state.input.brake 
        });
    }

    // Partículas Humo
    for(let i=smokeParticles.length-1; i>=0; i--) {
        const p = smokeParticles[i];
        p.position.add(p.userData.vel);
        p.scale.addScalar(0.05);
        p.userData.life -= 0.02;
        p.material.opacity = p.userData.life * 0.4;
        if(p.userData.life<=0) { smokeGroup.remove(p); smokeParticles.splice(i,1); }
    }

    // Ciclo Día/Noche
    const time = Date.now() * 0.0001;
    const lx = state.myCar ? state.myCar.position.x : 0;
    const lz = state.myCar ? state.myCar.position.z : 0;
    
    const sunX = Math.cos(time)*2000;
    const sunY = Math.sin(time)*2000;
    
    sunLight.position.set(lx + sunX, sunY, lz + 500);
    sunLight.target.position.set(lx, 0, lz);
    sunMesh.position.copy(sunLight.position);
    
    moonLight.position.set(lx - sunX, -sunY, lz - 500);
    moonMesh.position.copy(moonLight.position);

    if(sunY < 0) { // Noche
        starField.material.opacity = 1;
        scene.fog.color.setHex(0x050510);
    } else { // Día
        starField.material.opacity = 0;
        scene.fog.color.setHex(0x87CEEB);
    }

    composer.render();
}

// ==========================================
// CONTROLES TÁCTILES Y TECLADO
// ==========================================
const joyZone = document.getElementById('joystick-zone');
const joyKnob = document.getElementById('joystick-knob');
let joyId = null; const joyRect = {x:0, w:0};

function moveJoy(cx) {
    let dx = cx - (joyRect.x + joyRect.w/2);
    dx = Math.max(-60, Math.min(60, dx));
    joyKnob.style.transform = `translate(${dx-25}px, -25px)`;
    state.input.steer = -(dx / 60);
}
joyZone.addEventListener('touchstart', e=>{ e.preventDefault(); joyId=e.changedTouches[0].identifier; const r=joyZone.getBoundingClientRect(); joyRect.x=r.left; joyRect.w=r.width; moveJoy(e.changedTouches[0].clientX); });
joyZone.addEventListener('touchmove', e=>{ e.preventDefault(); for(let t of e.changedTouches) if(t.identifier===joyId) moveJoy(t.clientX); });
joyZone.addEventListener('touchend', e=>{ e.preventDefault(); joyId=null; state.input.steer=0; joyKnob.style.transform='translate(-50%,-50%)'; });

const bind = (id, k) => {
    const el = document.getElementById(id);
    const on=e=>{e.preventDefault();state.input[k]=true;};
    const off=e=>{e.preventDefault();state.input[k]=false;};
    el.addEventListener('touchstart', on); el.addEventListener('touchend', off);
    el.addEventListener('mousedown', on); window.addEventListener('mouseup', off);
};
bind('gas-btn', 'gas');
bind('brake-btn', 'brake');

window.addEventListener('keydown', e => {
    if(e.key==='w'||e.key==='ArrowUp') state.input.gas=true;
    if(e.key==='s'||e.key==='ArrowDown') state.input.brake=true;
    if(e.key==='a'||e.key==='ArrowLeft') state.input.steer=1;
    if(e.key==='d'||e.key==='ArrowRight') state.input.steer=-1;
});
window.addEventListener('keyup', e => {
    if(e.key==='w'||e.key==='ArrowUp') state.input.gas=false;
    if(e.key==='s'||e.key==='ArrowDown') state.input.brake=false;
    if(e.key==='a'||e.key==='d'||e.key==='ArrowLeft'||e.key==='ArrowRight') state.input.steer=0;
});