import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';

// --- LOGGING ---
const consoleBody = document.getElementById('console-body');
const consoleToggle = document.getElementById('toggle-console');
let consoleOpen = true;

consoleToggle.onclick = () => {
    consoleOpen = !consoleOpen;
    document.getElementById('debug-console-container').style.height = consoleOpen ? '200px' : '30px';
    consoleToggle.innerText = consoleOpen ? '_' : '[]';
};

function log(m, c='white') { 
    consoleBody.innerHTML += `<div style="color:${c}">> ${m}</div>`; 
    consoleBody.scrollTop = consoleBody.scrollHeight;
}

// --- SOCKET CONNECTION ---
let socket;
const state = { inGame: false, myId: null, inputs: {s:0, g:false, b:false}, cfg: {inv:false} };

// Auto-conectar al host actual (Render/Localhost)
try {
    socket = io(); 
    log("Iniciando conexión...", 'yellow');
} catch(e) {
    log("Error: Socket.io no disponible", 'red');
}

// --- LISTENERS DE RED ---
socket.on('connect', () => {
    log("Conectado al servidor! ID: "+socket.id, '#5f5');
    state.myId = socket.id;
    document.getElementById('connection-status').innerText = "Online - Ping: OK";
    document.getElementById('connection-status').style.color = "#5f5";
});

socket.on('disconnect', () => {
    log("Desconectado del servidor", 'red');
    document.getElementById('connection-status').innerText = "Desconectado";
    document.getElementById('connection-status').style.color = "red";
});

socket.on('roomList', (list) => {
    const el = document.getElementById('room-list-container');
    el.innerHTML = '';
    if(list.length===0) el.innerHTML = '<div style="padding:10px;text-align:center;color:#666">No hay partidas activas</div>';
    
    list.forEach(r => {
        const row = document.createElement('div');
        row.className = 'room-item';
        row.innerHTML = `
            <div class="room-info"><span class="room-code">${r.id}</span> <span class="room-details">👥 ${r.players}</span></div>
            <button onclick="window.join('${r.id}')">ENTRAR</button>
        `;
        el.appendChild(row);
    });
});

socket.on('roomCreated', (d) => { log("Sala creada: "+d.roomId, '#5f5'); startGame(d.seed); });
socket.on('roomJoined', (d) => { 
    log("Entrando a "+d.roomId, '#5f5'); 
    // Actualizar visual de configuración
    document.getElementById('disp-max').innerText = d.config.maxKmhLimit;
    document.getElementById('disp-acc').innerText = "+"+d.config.accelKmhPerSec;
    startGame(d.seed); 
});
socket.on('error', (m) => { alert(m); });

// --- ESTADO DEL JUEGO (Con Interpolación) ---
socket.on('u', (pack) => {
    if(!state.inGame) return;
    
    // pack: Array de estados de jugadores [{id, d, l, h, s, c}, ...]
    pack.forEach(p => {
        let mesh = players[p.id];
        
        // Si el coche no existe, crearlo
        if(!mesh) {
            mesh = createCar(p.c); // p.c es el color
            scene.add(mesh);
            players[p.id] = mesh;
            
            if(p.id === state.myId) {
                myCar = mesh;
                // Luz de faros para mi coche
                const l = new THREE.SpotLight(0xffffff, 800);
                l.position.set(0,5,0); l.target.position.set(0,0,20);
                mesh.add(l); mesh.add(l.target);
            }
        }
        
        // INTERPOLACIÓN VISUAL (Suavizado de Lag)
        // Objetivo recibido del servidor
        const targetLat = p.l;
        const targetDist = p.d;
        const targetHeading = p.h;

        // Para visualización simple en esta versión, proyectamos en recta infinita (Z=Dist, X=Lat)
        // En un juego complejo 3D, aquí se calcularía el punto en el Spline
        const targetPos = new THREE.Vector3(targetLat, 0.6, targetDist);
        
        // Lerp: Mover gradualmente de la posición actual a la objetivo (factor 0.3)
        mesh.position.lerp(targetPos, 0.3);
        
        // Rotación: Lerp simple (para evitar problemas con 360->0 grados, se debería usar Quaternions, 
        // pero para este rango de giro simple funciona bien)
        mesh.rotation.y += (targetHeading - mesh.rotation.y) * 0.3;
        
        // Guardar velocidad para HUD
        if(p.id === state.myId) state.mySpeed = p.s;
    });

    // Actualizar HUD y Cámara Local
    if(myCar) {
        document.getElementById('speed-val').innerText = Math.floor((state.mySpeed || 0) * 100);
        
        // Cámara suave detrás del coche
        const camOff = new THREE.Vector3(0, 8, -18).applyAxisAngle(new THREE.Vector3(0,1,0), myCar.rotation.y);
        const camTarget = myCar.position.clone().add(camOff);
        
        camera.position.lerp(camTarget, 0.1);
        camera.lookAt(myCar.position);
    }
});

// --- UI BINDINGS ---
window.join = (id) => socket.emit('joinRoom', id);

document.getElementById('btn-connect').onclick = () => {
    document.getElementById('intro-panel').style.display='none';
    document.getElementById('lobby-ui').style.display='flex';
    socket.emit('getRooms');
};

document.getElementById('btn-create-room').onclick = () => {
    const max = parseInt(document.getElementById('cfg-max').value);
    const acc = parseInt(document.getElementById('cfg-acc').value);
    socket.emit('createRoom', { maxKmh: max, accel: acc });
};

document.getElementById('btn-refresh').onclick = () => socket.emit('getRooms');

// Configuración Local
document.getElementById('menu-btn').onclick = () => {
    const m = document.getElementById('menu-modal');
    m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
};
document.getElementById('chk-invert').onchange = (e) => state.cfg.inv = e.target.checked;
document.getElementById('chk-brake').onchange = (e) => document.getElementById('brake-btn').style.display = e.target.checked ? 'flex' : 'none';

// --- INPUT SYSTEM ---
function sendInput() {
    if(!state.inGame) return;
    let s = state.inputs.s;
    if(state.cfg.inv) s *= -1;
    // La sensibilidad la ajusta el cliente, el servidor valida
    // Factor de sensibilidad base del cliente (puedes añadir slider si quieres)
    s *= 0.6; 
    socket.emit('playerInput', { steer: s, gas: state.inputs.g, brake: state.inputs.b });
}

// Touch Controls
const joy = document.getElementById('joystick-zone');
const knob = document.getElementById('joystick-knob');
let jId = null; const jRect={x:0,w:0};

const mvJoy = (cx) => {
    let dx = cx - (jRect.x + jRect.w/2);
    if(dx>50)dx=50; if(dx<-50)dx=-50;
    knob.style.transform=`translate(${dx-25}px, -25px)`;
    state.inputs.s = dx/50; sendInput();
};

joy.addEventListener('touchstart',e=>{e.preventDefault(); jId=e.changedTouches[0].identifier; jRect.x=joy.getBoundingClientRect().left; jRect.w=joy.offsetWidth; mvJoy(e.changedTouches[0].clientX);});
joy.addEventListener('touchmove',e=>{e.preventDefault(); const t=[...e.changedTouches].find(x=>x.identifier===jId); if(t) mvJoy(t.clientX);});
joy.addEventListener('touchend',e=>{e.preventDefault(); jId=null; state.inputs.s=0; knob.style.transform='translate(-50%,-50%)'; sendInput();});

// Pedales
const bindBtn = (id, k) => {
    const el = document.getElementById(id);
    const on = (e)=>{e.preventDefault(); state.inputs[k]=true; sendInput();}
    const off = (e)=>{e.preventDefault(); state.inputs[k]=false; sendInput();}
    el.addEventListener('mousedown', on); window.addEventListener('mouseup', off);
    el.addEventListener('touchstart', on); el.addEventListener('touchend', off);
};
bindBtn('gas-btn', 'g');
bindBtn('brake-btn', 'b');

// --- GRAPHICS ENGINE ---
let scene, camera, renderer, composer, myCar, players={};

function startGame(seed) {
    window.seed = seed;
    document.getElementById('start-screen').style.display='none';
    document.getElementById('ui-layer').style.display='block';
    document.getElementById('loading').style.display='flex';
    
    // Init ThreeJS
    scene = new THREE.Scene(); 
    scene.fog = new THREE.FogExp2(0x050510, 0.002);
    camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 5000);
    
    renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);
    
    const rp = new RenderPass(scene, camera);
    const bp = new UnrealBloomPass(new THREE.Vector2(window.innerWidth,innerHeight), 1.5, 0.4, 0.85);
    bp.threshold=0.8; bp.strength=0.15; bp.radius=0.3;
    composer = new EffectComposer(renderer); composer.addPass(rp); composer.addPass(bp);

    const amb = new THREE.AmbientLight(0x404040, 2); scene.add(amb);
    const sun = new THREE.DirectionalLight(0xffdf80, 2.5); 
    sun.position.set(100,300,100); sun.castShadow=true; 
    sun.shadow.mapSize.width=2048; sun.shadow.mapSize.height=2048;
    scene.add(sun);

    // Sol y Luna Visuales (Grandes)
    const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(500,32,32), new THREE.MeshBasicMaterial({color:0xffaa00, fog:false}));
    sunMesh.position.set(0, 500, -3000); scene.add(sunMesh);

    // Suelo Infinito (Visualización)
    const road = new THREE.Mesh(new THREE.PlaneGeometry(20, 20000), new THREE.MeshStandardMaterial({color:0x333333, roughness:0.8}));
    road.rotation.x = -Math.PI/2; road.position.z = 10000; road.receiveShadow=true; scene.add(road);
    
    // Linea central
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 20000), new THREE.MeshBasicMaterial({color:0xffffff}));
    line.rotation.x = -Math.PI/2; line.position.set(0, 0.05, 10000); scene.add(line);

    // Muros
    const wallGeo = new THREE.BoxGeometry(1.5, 2, 20000);
    const wallMat = new THREE.MeshStandardMaterial({color:0xeeeeee});
    const wL = new THREE.Mesh(wallGeo, wallMat); wL.position.set(9.5, 1, 10000); scene.add(wL);
    const wR = new THREE.Mesh(wallGeo, wallMat); wR.position.set(-9.5, 1, 10000); scene.add(wR);

    // Suelo entorno
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({color:0x112211, roughness:1}));
    grass.rotation.x = -Math.PI/2; grass.position.y = -0.5; scene.add(grass);

    setTimeout(() => {
        document.getElementById('loading').style.display='none';
        state.inGame = true;
        animate();
    }, 500);
}

// Helpers Coches
const matBody = new THREE.MeshStandardMaterial({roughness:0.1, metalness:0.5});
const matBlack = new THREE.MeshStandardMaterial({color:0x111111});
const matOut = new THREE.MeshBasicMaterial({color:0x000000, side:THREE.BackSide});

function createCar(colorStr) { // colorStr viene del server como string HSL
    const g = new THREE.Group();
    
    // Carroceria
    const b = new THREE.Mesh(new THREE.BoxGeometry(2,0.7,4.2), matBody.clone());
    b.material.color.setStyle(colorStr); // Usar setStyle para strings CSS
    b.position.y=0.6; b.castShadow=true; g.add(b);
    
    // Outline (Cell Shading)
    const out = new THREE.Mesh(new THREE.BoxGeometry(2,0.7,4.2), matOut);
    out.position.y=0.6; out.scale.set(1.05,1.05,1.05); g.add(out);

    // Cabina
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6,0.5,2), matBlack);
    cab.position.set(0,1.2,-0.2); g.add(cab);
    const outCab = new THREE.Mesh(new THREE.BoxGeometry(1.6,0.5,2), matOut);
    outCab.position.set(0,1.2,-0.2); outCab.scale.set(1.05,1.05,1.05); g.add(outCab);

    return g;
}

function animate() {
    requestAnimationFrame(animate);
    if(state.inGame) composer.render();
}

window.addEventListener('resize', () => { 
    camera.aspect = window.innerWidth/window.innerHeight; 
    camera.updateProjectionMatrix(); 
    renderer.setSize(window.innerWidth, window.innerHeight); 
    composer.setSize(window.innerWidth, window.innerHeight); 
});