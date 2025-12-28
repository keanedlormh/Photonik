import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ==========================================
// LOGGER VISUAL
// ==========================================
const consoleEl = document.getElementById('debug-console');
function logToScreen(msg, type='info') {
    const line = document.createElement('div');
    const time = new Date().toLocaleTimeString().split(' ')[0];
    line.innerText = `[${time}] ${msg}`;
    if(type === 'error') line.style.color = '#ff3333';
    if(type === 'success') line.style.color = '#33ff33';
    if(type === 'warn') line.style.color = '#ffff33';
    
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
    console.log(msg); // Tambien a consola navegador
}

// ==========================================
// SOCKET.IO & STATE
// ==========================================
// IMPORTANTE: Asegúrate de que el servidor (server.js) esté corriendo.
const socket = io(); // Conexión automática al host que sirve la página

const state = {
    gameStarted: false,
    isConnected: false,
    myId: null,
    
    // Client config
    steeringInverted: false,
    steerSensitivity: 60,
    steerStiffness: 50,
    
    // Inputs actuales
    input: { steer: 0, gas: false, brake: false }
};

// Listeners Socket
socket.on('connect', () => {
    state.isConnected = true;
    state.myId = socket.id;
    document.getElementById('server-status').innerText = "Conectado. ID: " + socket.id;
    document.getElementById('server-status').style.color = "#00ff00";
    logToScreen(`Conectado al servidor. Socket ID: ${socket.id}`, 'success');
});

socket.on('disconnect', () => {
    state.isConnected = false;
    logToScreen("Desconectado del servidor.", 'error');
});

socket.on('roomCreated', (data) => {
    logToScreen(`Sala creada: ${data.roomId} (Seed: ${data.seed.toFixed(2)})`, 'success');
    alert(`Sala Creada! Código: ${data.roomId}`);
    startGame(data.seed);
});

socket.on('roomJoined', (data) => {
    logToScreen(`Unido a sala: ${data.roomId}`, 'success');
    startGame(data.seed);
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

// UI Functions Globales
window.enterLobby = () => {
    if(!state.isConnected) {
        logToScreen("Intentando conectar...", 'warn');
        return; 
    }
    document.getElementById('intro-panel').style.display = 'none';
    document.getElementById('lobby-ui').style.display = 'flex';
    logToScreen("Entrando al Lobby...");
};

window.createGameRoom = () => {
    const maxKmh = parseInt(document.getElementById('manual-max-speed').value);
    const accel = parseInt(document.getElementById('manual-accel').value);
    logToScreen(`Solicitando crear sala (Max: ${maxKmh}, Acc: ${acc})...`);
    socket.emit('createRoom', { maxKmh, accel });
};

window.joinGameRoom = () => {
    const code = document.getElementById('room-code-input').value;
    if(!code) {
        logToScreen("Error: Código de sala vacío", 'error');
        return;
    }
    logToScreen(`Intentando unirse a sala: ${code}...`);
    socket.emit('joinRoom', code);
};

// ==========================================
// GAME ENGINE
// ==========================================
let scene, camera, renderer, composer;
let playersMeshes = {}; // { socketId: Group }
let myCarMesh = null;
let lightTarget;
let lastTimeFPS = 0;
let frames = 0;

function startGame(seed) {
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('loading').style.display = 'flex';
    
    // Init ThreeJS
    initThreeJS(seed);
    
    setTimeout(() => {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('ui-layer').style.display = 'block';
        state.gameStarted = true;
        logToScreen("Motor Gráfico Iniciado.");
        animate();
    }, 1000);
}

// Materiales Compartidos
const matCarBody = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.5 });
const matOutline = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
const matWheel = new THREE.MeshStandardMaterial({ color: 0x222222 });

function createCarMesh(colorHex) {
    const grp = new THREE.Group();
    
    // Chassis
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2), matCarBody.clone());
    body.material.color.set(colorHex);
    body.position.y = 0.6; body.castShadow = true;
    grp.add(body);
    
    // Outline Chassis
    const outBody = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2), matOutline);
    outBody.position.y = 0.6; outBody.scale.multiplyScalar(1.03);
    grp.add(outBody);

    // Cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.0), new THREE.MeshStandardMaterial({color:0x111}));
    cabin.position.set(0, 1.2, -0.2);
    grp.add(cabin);
    const outCabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.0), matOutline);
    outCabin.position.set(0, 1.2, -0.2); outCabin.scale.multiplyScalar(1.03);
    grp.add(outCabin);

    // Wheels (Simple visual)
    const wGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 16); wGeo.rotateZ(Math.PI/2);
    const posW = [{x:1,z:1.2}, {x:-1,z:1.2}, {x:1,z:-1.2}, {x:-1,z:-1.2}];
    posW.forEach(p => {
        const w = new THREE.Mesh(wGeo, matWheel);
        w.position.set(p.x, 0.4, p.z);
        grp.add(w);
    });

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
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    // Luces
    const amb = new THREE.AmbientLight(0x404040, 2.0); scene.add(amb);
    const sun = new THREE.DirectionalLight(0xffdf80, 2.5);
    sun.position.set(100, 300, 100); sun.castShadow = true;
    scene.add(sun);
    lightTarget = new THREE.Object3D(); scene.add(lightTarget); sun.target = lightTarget;

    // Generar Suelo Infinito (Visual simple para demo)
    // En versión final aquí se generaría el Spline basado en el seed compartido
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({color:0x222222, roughness:0.8}));
    plane.rotation.x = -Math.PI/2;
    plane.receiveShadow = true;
    scene.add(plane);
    
    // Grid Helper para referencia de movimiento
    const grid = new THREE.GridHelper(20000, 200, 0x444444, 0x222222);
    scene.add(grid);
}

// UPDATE FROM SERVER
// Recibimos estado autoritativo cada frame (aprox 60hz)
socket.on('gameState', (playersData) => {
    if (!state.gameStarted) return;

    playersData.forEach(pData => {
        let mesh = playersMeshes[pData.id];
        
        // Instanciar nuevo jugador
        if (!mesh) {
            mesh = createCarMesh(pData.color);
            scene.add(mesh);
            playersMeshes[pData.id] = mesh;
            logToScreen(`Jugador detectado: ${pData.id.substr(0,4)}`, 'info');
            
            if (pData.id === socket.id) {
                myCarMesh = mesh;
                // Adjuntar luz al coche propio
                const light = new THREE.SpotLight(0xffffff, 400, 300, 0.6);
                light.position.set(0, 2, 0);
                light.target.position.set(0, 0, 20);
                mesh.add(light);
                mesh.add(light.target);
            }
        }

        // Interpolación visual básica
        // Nota: En prod usaríamos buffer de interpolación para suavidad extrema.
        // Aquí aplicamos posición directa. 
        // HOTFIX: El servidor envía 'dist' (Z) y 'lat' (X) relativos a la curva.
        // Para visualización correcta en cliente, DEBEMOS calcular la curva.
        // Como simplificación visual para esta demo, trataremos el mundo como plano infinito donde:
        // Z = Progreso, X = Lateral.
        
        // Simular curva visualmente (client-side visual fix)
        // Usamos la misma formula que el server "getTrackCurvePoint" pero para dibujar
        // x = lateral, z = dist. 
        // Pero queremos ver el coche en coordenadas 3D mundiales.
        // Si el server calcula posición física proyectada, aquí la pintamos.
        // Como el server en V20 envía dist/lat, necesitamos convertir a WorldPos.
        // Usaremos una aproximación visual simple:
        
        // WorldX = pData.lat;
        // WorldZ = pData.dist;
        // (Esto hará una carretera recta infinita visualmente, funcional para test de física)
        
        mesh.position.set(pData.lat, 0.6, pData.dist);
        
        // Rotación: El servidor envía WorldHeading.
        mesh.rotation.y = pData.heading;
    });

    // Update HUD & Camara (Solo para mi coche)
    const myData = playersData.find(p => p.id === socket.id);
    if(myData && myCarMesh) {
        document.getElementById('speed-val').innerText = Math.floor(myData.speed * 100);
        
        // Cámara TPS
        const camDist = 18 * state.cameraZoom;
        const camHeight = 8 * state.cameraZoom;
        
        // Calcular posición detrás del coche basado en su heading
        const backX = -Math.sin(myData.heading) * camDist;
        const backZ = -Math.cos(myData.heading) * camDist;
        
        const targetCamPos = new THREE.Vector3(
            myCarMesh.position.x + backX,
            myCarMesh.position.y + camHeight,
            myCarMesh.position.z + backZ
        );
        
        camera.position.lerp(targetCamPos, 0.1);
        camera.lookAt(myCarMesh.position);
        
        lightTarget.position.copy(myCarMesh.position);
    }
});

// INPUT LOOP
function sendInput() {
    if(!state.gameStarted) return;
    
    // Procesar inversión de dirección aquí antes de enviar
    let processedSteer = state.input.steer;
    if(state.steeringInverted) processedSteer *= -1;
    
    // Aplicar sensibilidad localmente? No, el servidor es autoritativo.
    // Enviamos el raw input (-1 a 1) y el servidor decide.
    // Pero si queremos que el slider de "Sensibilidad" del cliente funcione,
    // debemos escalar el input aquí.
    
    // Scaling input by sensitivity setting (10% to 150%)
    // Base 1.0 (100%). 
    processedSteer *= (state.steerSensitivity / 100.0);
    
    socket.emit('playerInput', { 
        steer: processedSteer, 
        gas: state.input.gas, 
        brake: state.input.brake 
    });
}

// Input Handlers
const joystickZone = document.getElementById('joystick-zone');
const joystickKnob = document.getElementById('joystick-knob');
let joyId = null; const joyCenter={x:0,y:0};

function handleJoy(cx, cy, start) {
    if(start) {
        const r = joystickZone.getBoundingClientRect();
        joyCenter.x = r.left + r.width/2;
    }
    let dx = cx - joyCenter.x;
    if(dx > 50) dx = 50; if(dx < -50) dx = -50;
    
    joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
    state.input.steer = dx / 50; // -1 a 1
    sendInput();
}

joystickZone.addEventListener('touchstart', (e)=>{ e.preventDefault(); joyId=e.changedTouches[0].identifier; handleJoy(e.changedTouches[0].clientX, 0, true); });
joystickZone.addEventListener('touchmove', (e)=>{ e.preventDefault(); const t=[...e.changedTouches].find(k=>k.identifier===joyId); if(t) handleJoy(t.clientX, 0, false); });
joystickZone.addEventListener('touchend', (e)=>{ e.preventDefault(); joyId=null; state.input.steer=0; joystickKnob.style.transform=`translate(-50%,-50%)`; sendInput(); });
// Mouse support for debug
joystickZone.addEventListener('mousedown', (e)=>{ joyId='mouse'; handleJoy(e.clientX, 0, true); });
window.addEventListener('mousemove', (e)=>{ if(joyId==='mouse') handleJoy(e.clientX, 0, false); });
window.addEventListener('mouseup', (e)=>{ if(joyId==='mouse') { joyId=null; state.input.steer=0; joystickKnob.style.transform=`translate(-50%,-50%)`; sendInput(); } });

// Pedales
const btnGas = document.getElementById('gas-btn');
const btnBrake = document.getElementById('brake-btn');
const setPedal = (k,v) => { state.input[k]=v; sendInput(); };

btnGas.addEventListener('mousedown', ()=>setPedal('gas',true)); window.addEventListener('mouseup', ()=>setPedal('gas',false));
btnGas.addEventListener('touchstart', (e)=>{e.preventDefault();setPedal('gas',true)}); btnGas.addEventListener('touchend', (e)=>{e.preventDefault();setPedal('gas',false)});

btnBrake.addEventListener('mousedown', ()=>setPedal('brake',true)); // Brake release handled by global mouseup above if needed, but safer individually
btnBrake.addEventListener('mouseup', ()=>setPedal('brake',false));
btnBrake.addEventListener('touchstart', (e)=>{e.preventDefault();setPedal('brake',true)}); btnBrake.addEventListener('touchend', (e)=>{e.preventDefault();setPedal('brake',false)});

// Config listeners
document.getElementById('chk-invert-steering').addEventListener('change', (e)=> state.steeringInverted = e.target.checked);
document.getElementById('chk-show-brake').addEventListener('change', (e)=> {
    state.showBrake = e.target.checked;
    document.getElementById('brake-btn').style.display = state.showBrake ? 'flex' : 'none';
});
document.getElementById('steer-sens').addEventListener('input', (e)=> { state.steerSensitivity = parseInt(e.target.value); document.getElementById('disp-sens').innerText = state.steerSensitivity+"%"; });

function animate() {
    requestAnimationFrame(animate);
    if(state.gameStarted) {
        // Enviar inputs continuamente? No, solo por evento. 
        // Pero podríamos enviar heartbeat aquí si fuera UDP.
        // En TCP/SocketIO mejor por eventos para no saturar.
        
        composer.render();
        
        // FPS Counter
        const now = performance.now();
        frames++;
        if(now - lastTimeFPS >= 1000) { 
            document.getElementById('fps-counter').innerText = "FPS: " + frames; 
            frames=0; lastTimeFPS=now; 
        }
    }
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight);
});