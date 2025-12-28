import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';

// ==========================================
// 1. SISTEMA DE LOGS Y ERRORES
// ==========================================
const consoleBody = document.getElementById('console-body');
const statusDiv = document.getElementById('connection-status');

function log(msg, type='info') {
    const div = document.createElement('div');
    div.innerText = `> ${msg}`;
    div.className = `log-${type}`; // defined in css or default
    if(type==='error') { div.style.color = '#ff5555'; console.error(msg); }
    else if(type==='success') { div.style.color = '#55ff55'; }
    else { div.style.color = '#aaa'; }
    consoleBody.appendChild(div);
    consoleBody.scrollTop = consoleBody.scrollHeight;
}

// ==========================================
// 2. INICIALIZACIÓN SEGURA
// ==========================================
let socket;
const state = {
    connected: false,
    inGame: false,
    myId: null,
    inputs: { steer: 0, gas: false, brake: false },
    config: { invert: false, sens: 60 }
};

document.addEventListener("DOMContentLoaded", () => {
    log("Iniciando aplicación...");

    // Verificar Socket.IO
    if (typeof io === 'undefined') {
        log("ERROR CRÍTICO: Socket.IO no cargado.", 'error');
        statusDiv.innerText = "Error: Librería no encontrada";
        statusDiv.style.color = "red";
        return;
    }

    // Conectar
    socket = io();

    // Listeners de Conexión
    socket.on('connect', () => {
        state.connected = true;
        state.myId = socket.id;
        statusDiv.innerText = "🟢 Conectado al Servidor";
        statusDiv.style.color = "#00ff00";
        log("Conexión establecida. ID: " + socket.id, 'success');
        
        // Habilitar botón
        const btn = document.getElementById('btn-connect');
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
    });

    socket.on('disconnect', () => {
        state.connected = false;
        statusDiv.innerText = "🔴 Desconectado";
        statusDiv.style.color = "red";
        log("Desconectado del servidor.", 'error');
    });

    // Eventos de Sala
    socket.on('roomList', updateRoomList);
    socket.on('roomCreated', (d) => { log("Sala creada!", 'success'); startGame(d.seed); });
    socket.on('roomJoined', (d) => { 
        log("Entrando a sala...", 'success'); 
        document.getElementById('manual-max-speed').value = d.config.maxKmhLimit;
        document.getElementById('disp-max').innerText = d.config.maxKmhLimit;
        startGame(d.seed); 
    });
    
    // Evento de Juego (Bucle principal de red)
    socket.on('gameState', (data) => {
        if(state.inGame) updateGame(data);
    });

    // VINCULAR BOTONES (Ahora que el DOM está listo)
    bindUI();
});

function bindUI() {
    // Botón Principal
    document.getElementById('btn-connect').addEventListener('click', () => {
        if(!state.connected) {
            log("Esperando conexión...", 'error');
            return;
        }
        document.getElementById('intro-panel').style.display = 'none';
        document.getElementById('lobby-ui').style.display = 'flex';
        socket.emit('getRooms');
    });

    // Botones Lobby
    document.getElementById('btn-refresh').addEventListener('click', () => {
        log("Actualizando lista...");
        socket.emit('getRooms');
    });

    document.getElementById('btn-create-room').addEventListener('click', () => {
        const max = parseInt(document.getElementById('manual-max-speed').value);
        const acc = parseInt(document.getElementById('manual-accel').value);
        log(`Creando sala (Max: ${max}, Acc: ${acc})...`);
        socket.emit('createRoom', { maxKmh: max, accel: acc });
    });

    // Botones Config
    document.getElementById('manual-max-speed').addEventListener('input', (e) => document.getElementById('disp-max').innerText = e.target.value);
    document.getElementById('manual-accel').addEventListener('input', (e) => document.getElementById('disp-acc').innerText = "+"+e.target.value);
    document.getElementById('chk-invert').addEventListener('change', (e) => state.config.invert = e.target.checked);
    document.getElementById('chk-brake').addEventListener('change', (e) => document.getElementById('brake-btn').style.display = e.target.checked ? 'flex' : 'none');
    
    // Menu Toggle
    document.getElementById('menu-btn').addEventListener('click', () => {
        const m = document.getElementById('menu-modal');
        m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
    });

    // CONTROLES (Touch & Mouse)
    const joy = document.getElementById('joystick-zone');
    const knob = document.getElementById('joystick-knob');
    let joyId = null; const joyRect = {x:0, w:0};

    const handleJoy = (cx) => {
        let dx = cx - (joyRect.x + joyRect.w/2);
        if(dx > 50) dx = 50; if(dx < -50) dx = -50;
        knob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
        state.inputs.steer = dx / 50;
        sendInput();
    };

    joy.addEventListener('touchstart', (e) => {
        e.preventDefault();
        joyId = e.changedTouches[0].identifier;
        const r = joy.getBoundingClientRect();
        joyRect.x = r.left; joyRect.w = r.width;
        handleJoy(e.changedTouches[0].clientX);
    });
    joy.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const t = [...e.changedTouches].find(x=>x.identifier===joyId);
        if(t) handleJoy(t.clientX);
    });
    joy.addEventListener('touchend', (e) => {
        e.preventDefault(); joyId=null;
        state.inputs.steer = 0;
        knob.style.transform = `translate(-50%, -50%)`;
        sendInput();
    });

    // Pedales
    const bindPedal = (id, key) => {
        const el = document.getElementById(id);
        const on = (e) => { e.preventDefault(); state.inputs[key] = true; sendInput(); };
        const off = (e) => { e.preventDefault(); state.inputs[key] = false; sendInput(); };
        el.addEventListener('mousedown', on); window.addEventListener('mouseup', off);
        el.addEventListener('touchstart', on); el.addEventListener('touchend', off);
    };
    bindPedal('gas-btn', 'gas');
    bindPedal('brake-btn', 'brake');
}

function updateRoomList(list) {
    const c = document.getElementById('room-list-container');
    c.innerHTML = '';
    if(list.length === 0) { c.innerHTML = '<div style="padding:10px;text-align:center;color:#666">No hay salas</div>'; return; }
    
    list.forEach(r => {
        const d = document.createElement('div');
        d.className = 'room-item';
        d.innerHTML = `<span><b>${r.id}</b> (${r.players} Jug)</span> <button>UNIRSE</button>`;
        d.querySelector('button').onclick = () => socket.emit('joinRoom', r.id);
        c.appendChild(d);
    });
}

function sendInput() {
    if(!state.inGame) return;
    let s = state.inputs.steer;
    if(state.config.invert) s *= -1;
    socket.emit('playerInput', { steer: s, gas: state.inputs.gas, brake: state.inputs.brake });
}

// ==========================================
// 3. MOTOR GRÁFICO (THREE.JS)
// ==========================================
let scene, camera, renderer, composer, myCar;
let players = {}; // Map socketId -> mesh

function startGame(seed) {
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('loading').style.display = 'flex';
    
    // Init 3D
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050510, 0.002);
    
    camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 5000);
    renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);

    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.8; bloomPass.strength = 0.2; bloomPass.radius = 0.3;
    composer = new EffectComposer(renderer);
    composer.addPass(renderScene); composer.addPass(bloomPass);

    // Entorno básico
    const amb = new THREE.AmbientLight(0x404040, 2.0); scene.add(amb);
    const sun = new THREE.DirectionalLight(0xffdf80, 2.5);
    sun.position.set(100, 300, 100); sun.castShadow = true; scene.add(sun);
    
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({color:0x222222, roughness:0.8}));
    floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; scene.add(floor);
    
    const grid = new THREE.GridHelper(20000, 400, 0x444444, 0x111111);
    scene.add(grid);

    // Finalizar carga
    setTimeout(() => {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('ui-layer').style.display = 'block';
        state.inGame = true;
        animate();
    }, 500);
}

function updateGame(data) {
    // data = [{id, dist, lat, heading, speed, color}, ...]
    data.forEach(p => {
        let mesh = players[p.id];
        if(!mesh) {
            mesh = createCar(p.color);
            scene.add(mesh);
            players[p.id] = mesh;
            if(p.id === state.myId) {
                myCar = mesh;
                // Add light
                const l = new THREE.SpotLight(0xffffff, 1000);
                l.position.set(0,5,0); l.target.position.set(0,0,20);
                mesh.add(l); mesh.add(l.target);
            }
        }
        
        // Render Position (Simple projection for demo)
        // Z = dist, X = lat. 
        mesh.position.set(p.lat, 0.6, p.dist);
        mesh.rotation.y = p.heading;
    });

    // Update Camera & HUD
    const myData = data.find(p => p.id === state.myId);
    if(myData && myCar) {
        document.getElementById('speed-val').innerText = Math.floor(myData.speed * 100);
        
        const offset = new THREE.Vector3(0, 8, -18);
        offset.applyAxisAngle(new THREE.Vector3(0,1,0), myData.heading);
        const target = myCar.position.clone().add(offset);
        camera.position.lerp(target, 0.1);
        camera.lookAt(myCar.position);
    }
}

function createCar(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({color: color, roughness:0.2, metalness:0.6});
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2), mat);
    body.position.y = 0.6; body.castShadow = true; g.add(body);
    // Outline
    const out = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2), new THREE.MeshBasicMaterial({color:0x000000, side:THREE.BackSide}));
    out.position.y = 0.6; out.scale.set(1.05,1.05,1.05); g.add(out);
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