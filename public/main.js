import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ==========================================
// LOGGER VISUAL INTELIGENTE
// ==========================================
const consoleContainer = document.getElementById('debug-console-container');
const consoleBody = document.getElementById('console-body');
const consoleToggleBtn = document.getElementById('console-toggle-btn');
let isConsoleMinimized = false;

window.toggleConsole = () => {
    isConsoleMinimized = !isConsoleMinimized;
    if (isConsoleMinimized) {
        consoleContainer.classList.add('minimized');
        consoleToggleBtn.innerText = '[]'; // Maximize icon
    } else {
        consoleContainer.classList.remove('minimized');
        consoleToggleBtn.innerText = '_'; // Minimize icon
    }
};

function logToScreen(msg, type='info') {
    const line = document.createElement('div');
    const time = new Date().toLocaleTimeString().split(' ')[0];
    line.innerText = `[${time}] ${msg}`;
    if(type === 'error') {
        line.style.color = '#ff3333';
        // AUTO-OPEN ON ERROR
        if (isConsoleMinimized) window.toggleConsole(); 
    }
    if(type === 'success') line.style.color = '#33ff33';
    if(type === 'warn') line.style.color = '#ffff33';
    
    consoleBody.appendChild(line);
    consoleBody.scrollTop = consoleBody.scrollHeight;
    console.log(msg);
}

// ==========================================
// SOCKET.IO & STATE
// ==========================================
const socket = io();

const state = {
    gameStarted: false,
    isConnected: false,
    myId: null,
    
    steeringInverted: false,
    steerSensitivity: 60,
    steerStiffness: 50,
    input: { steer: 0, gas: false, brake: false }
};

socket.on('connect', () => {
    state.isConnected = true;
    state.myId = socket.id;
    document.getElementById('server-status').innerText = "Conectado. ID: " + socket.id;
    document.getElementById('server-status').style.color = "#00ff00";
    logToScreen(`Conectado al servidor.`, 'success');
});

socket.on('disconnect', () => {
    state.isConnected = false;
    document.getElementById('server-status').innerText = "Desconectado";
    document.getElementById('server-status').style.color = "#ff3333";
    logToScreen("Desconectado del servidor.", 'error');
});

// ROOM LOGIC
socket.on('roomCreated', (data) => {
    logToScreen(`Sala creada: ${data.roomId}`, 'success');
    startGame(data.seed);
});

socket.on('roomJoined', (data) => {
    logToScreen(`Unido a sala: ${data.roomId}`, 'success');
    // Actualizar config visual en menú
    document.getElementById('disp-max-speed').innerText = data.config.maxKmhLimit;
    document.getElementById('disp-accel').innerText = "+" + data.config.accelKmhPerSec;
    startGame(data.seed);
});

socket.on('roomList', (rooms) => {
    const container = document.getElementById('room-list-container');
    container.innerHTML = '';
    
    if (rooms.length === 0) {
        container.innerHTML = '<div style="padding:10px; color:#aaa; text-align:center;">No hay salas activas.</div>';
        return;
    }

    rooms.forEach(r => {
        const item = document.createElement('div');
        item.className = 'room-item';
        item.innerHTML = `
            <div class="room-info">
                <span class="room-code">${r.id}</span>
                <span class="room-details">👥 ${r.players} | 🚀 ${r.config.maxKmhLimit} km/h</span>
            </div>
            <button class="btn-join-room" onclick="window.joinSpecificRoom('${r.id}')">UNIRSE</button>
        `;
        container.appendChild(item);
    });
    logToScreen(`Lista de salas actualizada: ${rooms.length} encontradas.`);
});

socket.on('playerLeft', (id) => {
    logToScreen(`Jugador ${id.substr(0,4)}... ha salido.`, 'warn');
    if (playersMeshes[id]) {
        scene.remove(playersMeshes[id]);
        delete playersMeshes[id];
    }
});

socket.on('error', (msg) => {
    logToScreen(`Error Servidor: ${msg}`, 'error');
    alert(msg);
});

// UI GLOBAL FUNCTIONS
window.enterLobby = () => {
    if(!state.isConnected) {
        logToScreen("No hay conexión con el servidor.", 'error');
        return; 
    }
    document.getElementById('intro-panel').style.display = 'none';
    document.getElementById('lobby-ui').style.display = 'flex';
    // Cargar lista al entrar
    window.refreshRoomList();
};

window.refreshRoomList = () => {
    logToScreen("Buscando salas...");
    socket.emit('getRooms');
};

window.createGameRoom = () => {
    // Aquí podriamos abrir un modal para configurar, por ahora usamos defaults o hardcoded 500/40
    // O mejor, cogemos los valores por defecto del server si no enviamos nada, 
    // o añadimos un mini form. Para simplificar, creamos con valores "Standard".
    const maxKmh = 500; 
    const accel = 40;
    logToScreen(`Creando sala estandar...`);
    socket.emit('createRoom', { maxKmh, accel });
};

window.joinGameRoom = () => {
    const code = document.getElementById('room-code-input').value;
    if(code) {
        logToScreen(`Intentando unirse a: ${code}...`);
        socket.emit('joinRoom', code);
    } else {
        logToScreen("Código inválido", 'warn');
    }
};

window.joinSpecificRoom = (id) => {
    logToScreen(`Uniendo a sala seleccionada: ${id}...`);
    socket.emit('joinRoom', id);
};

// ==========================================
// GAME ENGINE
// ==========================================
let scene, camera, renderer, composer;
let playersMeshes = {}; 
let myCarMesh = null;
let lightTarget;
let lastTimeFPS = 0;
let frames = 0;

function startGame(seed) {
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('loading').style.display = 'flex';
    
    initThreeJS(seed);
    
    setTimeout(() => {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('ui-layer').style.display = 'block';
        state.gameStarted = true;
        logToScreen("Motor Gráfico Iniciado.");
        animate();
    }, 1000);
}

const matCarBody = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.5 });
const matOutline = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
const matWheel = new THREE.MeshStandardMaterial({ color: 0x222222 });

function createCarMesh(colorHex) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2), matCarBody.clone());
    body.material.color.set(colorHex);
    body.position.y = 0.6; body.castShadow = true;
    grp.add(body);
    const outBody = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2), matOutline);
    outBody.position.y = 0.6; outBody.scale.multiplyScalar(1.03);
    grp.add(outBody);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.0), new THREE.MeshStandardMaterial({color:0x111}));
    cabin.position.set(0, 1.2, -0.2); grp.add(cabin);
    const outCabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.0), matOutline);
    outCabin.position.set(0, 1.2, -0.2); outCabin.scale.multiplyScalar(1.03); grp.add(outCabin);
    const wGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 16); wGeo.rotateZ(Math.PI/2);
    const posW = [{x:1,z:1.2}, {x:-1,z:1.2}, {x:1,z:-1.2}, {x:-1,z:-1.2}];
    posW.forEach(p => { const w = new THREE.Mesh(wGeo, matWheel); w.position.set(p.x, 0.4, p.z); grp.add(w); });
    return grp;
}

function initThreeJS(seed) {
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
    bloomPass.threshold = 0.8; bloomPass.strength = 0.15; bloomPass.radius = 0.3;
    composer = new EffectComposer(renderer);
    composer.addPass(renderScene); composer.addPass(bloomPass);

    const amb = new THREE.AmbientLight(0x404040, 2.0); scene.add(amb);
    const sun = new THREE.DirectionalLight(0xffdf80, 2.5);
    sun.position.set(100, 300, 100); sun.castShadow = true;
    scene.add(sun);
    lightTarget = new THREE.Object3D(); scene.add(lightTarget); sun.target = lightTarget;

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({color:0x222222, roughness:0.8}));
    plane.rotation.x = -Math.PI/2; plane.receiveShadow = true; scene.add(plane);
    const grid = new THREE.GridHelper(20000, 200, 0x444444, 0x222222); scene.add(grid);
}

socket.on('gameState', (playersData) => {
    if (!state.gameStarted) return;
    playersData.forEach(pData => {
        let mesh = playersMeshes[pData.id];
        if (!mesh) {
            mesh = createCarMesh(pData.color);
            scene.add(mesh);
            playersMeshes[pData.id] = mesh;
            if (pData.id === socket.id) {
                myCarMesh = mesh;
                const light = new THREE.SpotLight(0xffffff, 400, 300, 0.6);
                light.position.set(0, 2, 0); light.target.position.set(0, 0, 20);
                mesh.add(light); mesh.add(light.target);
            }
        }
        mesh.position.set(pData.lat, 0.6, pData.dist);
        mesh.rotation.y = pData.heading;
    });

    const myData = playersData.find(p => p.id === socket.id);
    if(myData && myCarMesh) {
        document.getElementById('speed-val').innerText = Math.floor(myData.speed * 100);
        const camDist = 18 * state.cameraZoom;
        const camHeight = 8 * state.cameraZoom;
        const backX = -Math.sin(myData.heading) * camDist;
        const backZ = -Math.cos(myData.heading) * camDist;
        const targetCamPos = new THREE.Vector3(myCarMesh.position.x + backX, myCarMesh.position.y + camHeight, myCarMesh.position.z + backZ);
        camera.position.lerp(targetCamPos, 0.1);
        camera.lookAt(myCarMesh.position);
        lightTarget.position.copy(myCarMesh.position);
    }
});

function sendInput() {
    if(!state.gameStarted) return;
    let processedSteer = state.input.steer;
    if(state.steeringInverted) processedSteer *= -1;
    processedSteer *= (state.steerSensitivity / 100.0);
    socket.emit('playerInput', { steer: processedSteer, gas: state.input.gas, brake: state.input.brake });
}

const joystickZone = document.getElementById('joystick-zone');
const joystickKnob = document.getElementById('joystick-knob');
let joyId = null; const joyCenter={x:0,y:0};

function handleJoy(cx, cy, start) {
    if(start) { const r = joystickZone.getBoundingClientRect(); joyCenter.x = r.left + r.width/2; }
    let dx = cx - joyCenter.x;
    if(dx > 50) dx = 50; if(dx < -50) dx = -50;
    joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
    state.input.steer = dx / 50; sendInput();
}
joystickZone.addEventListener('touchstart', (e)=>{ e.preventDefault(); joyId=e.changedTouches[0].identifier; handleJoy(e.changedTouches[0].clientX, 0, true); });
joystickZone.addEventListener('touchmove', (e)=>{ e.preventDefault(); const t=[...e.changedTouches].find(k=>k.identifier===joyId); if(t) handleJoy(t.clientX, 0, false); });
joystickZone.addEventListener('touchend', (e)=>{ e.preventDefault(); joyId=null; state.input.steer=0; joystickKnob.style.transform=`translate(-50%,-50%)`; sendInput(); });
joystickZone.addEventListener('mousedown', (e)=>{ joyId='mouse'; handleJoy(e.clientX, 0, true); });
window.addEventListener('mousemove', (e)=>{ if(joyId==='mouse') handleJoy(e.clientX, 0, false); });
window.addEventListener('mouseup', (e)=>{ if(joyId==='mouse') { joyId=null; state.input.steer=0; joystickKnob.style.transform=`translate(-50%,-50%)`; sendInput(); } });

const btnGas = document.getElementById('gas-btn');
const btnBrake = document.getElementById('brake-btn');
const setPedal = (k,v) => { state.input[k]=v; sendInput(); };
btnGas.addEventListener('mousedown', ()=>setPedal('gas',true)); window.addEventListener('mouseup', ()=>setPedal('gas',false));
btnGas.addEventListener('touchstart', (e)=>{e.preventDefault();setPedal('gas',true)}); btnGas.addEventListener('touchend', (e)=>{e.preventDefault();setPedal('gas',false)});
btnBrake.addEventListener('mousedown', ()=>setPedal('brake',true)); btnBrake.addEventListener('mouseup', ()=>setPedal('brake',false));
btnBrake.addEventListener('touchstart', (e)=>{e.preventDefault();setPedal('brake',true)}); btnBrake.addEventListener('touchend', (e)=>{e.preventDefault();setPedal('brake',false)});

document.getElementById('chk-invert-steering').addEventListener('change', (e)=> state.steeringInverted = e.target.checked);
document.getElementById('chk-show-brake').addEventListener('change', (e)=> { state.showBrake = e.target.checked; document.getElementById('brake-btn').style.display = state.showBrake ? 'flex' : 'none'; });
document.getElementById('steer-sens').addEventListener('input', (e)=> { state.steerSensitivity = parseInt(e.target.value); document.getElementById('disp-sens').innerText = state.steerSensitivity+"%"; });

function animate() {
    requestAnimationFrame(animate);
    if(state.gameStarted) {
        composer.render();
        const now = performance.now(); frames++;
        if(now - lastTimeFPS >= 1000) { document.getElementById('fps-counter').innerText = "FPS: " + frames; frames=0; lastTimeFPS=now; }
    }
}
window.addEventListener('resize', () => { camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight); });