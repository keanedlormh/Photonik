import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ==========================================
// ESTADO
// ==========================================
const BASE_SPEED = 0.45; 

const ROAD_WIDTH_HALF = 8.5; 
const WALL_WIDTH = 1.5; 
const WALL_HEIGHT = 1.2;
const CAR_WIDTH_HALF = 1.0;
const WALL_LIMIT = ROAD_WIDTH_HALF - CAR_WIDTH_HALF - 0.2;

const state = {
    isManual: false,
    fpsVisible: true,
    sliderVisible: true,
    menuOpen: false,
    gameStarted: false,
    
    speed: BASE_SPEED, 
    autoSpeedTarget: BASE_SPEED,
    
    maxKmhLimit: 500,       
    accelKmhPerSec: 40,     
    steeringInverted: false,
    showBrake: true,
    steerSensitivity: 60,   
    steerStiffness: 50,     
    
    manualSpeed: 0.0,
    worldHeading: 0.0,
    lateralOffset: 0.0,
    trackDist: 0.0,
    
    inputSteer: 0.0,
    inputGas: false,
    inputBrake: false,
    
    cameraZoom: 1.0,
};

// ==========================================
// UI HANDLERS
// ==========================================
const ui = {
    startScreen: document.getElementById('start-screen'),
    btnStart: document.getElementById('btn-start'),
    uiLayer: document.getElementById('ui-layer'),
    loading: document.getElementById('loading'),
    
    fps: document.getElementById('fps-counter'),
    menuBtn: document.getElementById('menu-btn'),
    menuModal: document.getElementById('menu-modal'),
    autoControls: document.getElementById('auto-controls'),
    manualControls: document.getElementById('manual-controls'),
    speedDisplay: document.getElementById('speed-display'),
    
    chkFps: document.getElementById('chk-fps'),
    chkSlider: document.getElementById('chk-slider'),
    chkMode: document.getElementById('chk-mode'),
    modeLabel: document.getElementById('mode-label'),
    
    sliderMaxSpeed: document.getElementById('manual-max-speed'),
    dispMaxSpeed: document.getElementById('disp-max-speed'),
    sliderAccel: document.getElementById('manual-accel'),
    dispAccel: document.getElementById('disp-accel'),
    chkInvertSteering: document.getElementById('chk-invert-steering'),
    chkShowBrake: document.getElementById('chk-show-brake'),
    sliderSens: document.getElementById('steer-sens'),
    dispSens: document.getElementById('disp-sens'),
    sliderStiff: document.getElementById('steer-stiff'),
    dispStiff: document.getElementById('disp-stiff'),

    joystickZone: document.getElementById('joystick-zone'),
    joystickKnob: document.getElementById('joystick-knob'),
    gasBtn: document.getElementById('gas-btn'),
    brakeBtn: document.getElementById('brake-btn'),
    slider: document.getElementById('speedSlider')
};

// START LOGIC
ui.btnStart.addEventListener('click', () => {
    ui.startScreen.style.opacity = '0';
    setTimeout(() => {
        ui.startScreen.style.display = 'none';
        ui.loading.style.display = 'flex';
        // Simulate loading
        setTimeout(() => {
            ui.loading.style.opacity = '0';
            setTimeout(() => {
                ui.loading.style.display = 'none';
                ui.uiLayer.style.display = 'block';
                state.gameStarted = true;
                animate(); // Start Loop
            }, 500);
        }, 1500);
    }, 500);
});

ui.menuBtn.addEventListener('click', () => { state.menuOpen = !state.menuOpen; ui.menuModal.style.display = state.menuOpen ? 'flex' : 'none'; });
ui.chkFps.addEventListener('change', (e) => { state.fpsVisible = e.target.checked; ui.fps.style.display = state.fpsVisible ? 'block' : 'none'; });
ui.chkSlider.addEventListener('change', (e) => { state.sliderVisible = e.target.checked; if (!state.isManual) ui.autoControls.style.display = state.sliderVisible ? 'flex' : 'none'; });

ui.sliderMaxSpeed.addEventListener('input', (e) => { 
    state.maxKmhLimit = parseInt(e.target.value); 
    ui.dispMaxSpeed.innerText = state.maxKmhLimit;
});
ui.sliderAccel.addEventListener('input', (e) => { 
    state.accelKmhPerSec = parseInt(e.target.value); 
    ui.dispAccel.innerText = "+" + state.accelKmhPerSec;
});

ui.chkInvertSteering.addEventListener('change', (e) => { state.steeringInverted = e.target.checked; });
ui.chkShowBrake.addEventListener('change', (e) => { 
    state.showBrake = e.target.checked;
    ui.brakeBtn.style.display = state.showBrake ? 'flex' : 'none';
});
ui.sliderSens.addEventListener('input', (e) => {
    state.steerSensitivity = parseInt(e.target.value);
    ui.dispSens.innerText = state.steerSensitivity + "%";
});
ui.sliderStiff.addEventListener('input', (e) => {
    state.steerStiffness = parseInt(e.target.value);
    ui.dispStiff.innerText = state.steerStiffness + "%";
});

ui.chkMode.addEventListener('change', (e) => {
    state.isManual = e.target.checked;
    if (state.isManual) {
        ui.modeLabel.innerText = "MANUAL";
        ui.modeLabel.style.color = "#00ccff";
        ui.autoControls.style.display = 'none';
        ui.manualControls.style.display = 'block';
        ui.brakeBtn.style.display = state.showBrake ? 'flex' : 'none'; 
        ui.fps.style.top = "20px"; ui.fps.style.bottom = "auto";
        controls.enabled = false; 
        const data = getTrackData(state.trackDist);
        if (data) state.worldHeading = Math.atan2(data.tangent.x, data.tangent.z); 
        state.manualSpeed = 0;
    } else {
        ui.modeLabel.innerText = "AUTOMÁTICO";
        ui.modeLabel.style.color = "#ffaa00";
        ui.autoControls.style.display = state.sliderVisible ? 'flex' : 'none';
        ui.manualControls.style.display = 'none';
        ui.fps.style.bottom = "10px"; ui.fps.style.top = "auto";
        state.autoSpeedTarget = BASE_SPEED; 
        state.speed = BASE_SPEED;
        ui.slider.value = 100;
        state.lateralOffset = 0;
        controls.enabled = true; 
        controls.enableDamping = false;
        controls.maxDistance = 100; 
    }
});

ui.slider.addEventListener('input', (e) => {
    const pct = e.target.value;
    state.autoSpeedTarget = BASE_SPEED * (pct / 100);
    if(!state.isManual) state.speed = state.autoSpeedTarget;
});

// JOYSTICK
let joyTouchId = null; const joyCenter = { x: 0, y: 0 }; const maxJoyDist = 50;
function handleJoyStart(e) { e.preventDefault(); const t = e.changedTouches ? e.changedTouches[0] : e; joyTouchId = t.identifier!==undefined?t.identifier:'mouse'; const r = ui.joystickZone.getBoundingClientRect(); joyCenter.x = r.left+r.width/2; joyCenter.y = r.top+r.height/2; updateJoyPos(t.clientX, t.clientY); }
function handleJoyMove(e) { e.preventDefault(); if (joyTouchId===null) return; const t = e.changedTouches ? [...e.changedTouches].find(k => k.identifier === joyTouchId) : e; if (!t) return; updateJoyPos(t.clientX, t.clientY); }
function handleJoyEnd(e) { e.preventDefault(); joyTouchId = null; state.inputSteer = 0; ui.joystickKnob.style.transform = `translate(-50%, -50%)`; }
function updateJoyPos(cx, cy) {
    let dx = cx - joyCenter.x; 
    if (dx > maxJoyDist) dx = maxJoyDist; if (dx < -maxJoyDist) dx = -maxJoyDist;
    ui.joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
    state.inputSteer = dx / maxJoyDist;
}
ui.joystickZone.addEventListener('mousedown', handleJoyStart); window.addEventListener('mousemove', (e) => { if(joyTouchId === 'mouse') handleJoyMove(e); }); window.addEventListener('mouseup', (e) => { if(joyTouchId === 'mouse') handleJoyEnd(e); });
ui.joystickZone.addEventListener('touchstart', handleJoyStart); ui.joystickZone.addEventListener('touchmove', handleJoyMove); ui.joystickZone.addEventListener('touchend', handleJoyEnd);

const addBtnEvents = (el, k) => { const s=(e)=>{e.preventDefault();state[k]=true;}; const n=(e)=>{e.preventDefault();state[k]=false;}; el.addEventListener('mousedown',s); el.addEventListener('mouseup',n); el.addEventListener('mouseleave',n); el.addEventListener('touchstart',s); el.addEventListener('touchend',n); };
addBtnEvents(ui.gasBtn, 'inputGas'); addBtnEvents(ui.brakeBtn, 'inputBrake');

// ZOOM
let iniP=0; let iniZ=1.0;
window.addEventListener('wheel', (e) => { state.cameraZoom += e.deltaY * 0.001; state.cameraZoom = THREE.MathUtils.clamp(state.cameraZoom, 0.5, 2.0); }, {passive: false});
window.addEventListener('touchstart', (e) => { if(e.touches.length === 2) { const dx = e.touches[0].clientX - e.touches[1].clientX; const dy = e.touches[0].clientY - e.touches[1].clientY; iniP = Math.sqrt(dx*dx + dy*dy); iniZ = state.cameraZoom; } }, {passive: false});
window.addEventListener('touchmove', (e) => { if(e.touches.length === 2) { const dx = e.touches[0].clientX - e.touches[1].clientX; const dy = e.touches[0].clientY - e.touches[1].clientY; const dist = Math.sqrt(dx*dx + dy*dy); state.cameraZoom = THREE.MathUtils.clamp(iniZ * (iniP / dist), 0.5, 2.0); } }, {passive: false});

// ==========================================
// THREE.JS SETUP
// ==========================================
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x87CEEB, 0.002);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 5, -10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.8; bloomPass.strength = 0.15; bloomPass.radius = 0.3;
const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false; controls.minDistance = 5; controls.maxDistance = 100; controls.enablePan = false; controls.enabled = true;

// LUCES Y ASTROS
const ambientLight = new THREE.AmbientLight(0x404040, 2.0); scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffdf80, 2.5);
sunLight.castShadow = true; sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -300; sunLight.shadow.camera.right = 300; sunLight.shadow.camera.top = 300; sunLight.shadow.camera.bottom = -300; sunLight.shadow.camera.far = 600;
scene.add(sunLight);
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffaa00, fog: false })); scene.add(sunMesh);
const moonLight = new THREE.DirectionalLight(0x88ccff, 3.0); scene.add(moonLight);
const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })); scene.add(moonMesh);

// MATERIALES
const matRoad = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide }); 
const matWall = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
const matLine = new THREE.MeshBasicMaterial({ color: 0xffff00 }); 
const matLineWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
const matCarBody = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.1, metalness: 0.5, emissive: 0x220000, emissiveIntensity: 0.2 }); 
const matCarBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.8 }); 
const matWheel = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
const matRim = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 });
const matWater = new THREE.MeshStandardMaterial({ color: 0x2196f3, roughness: 0.4, metalness: 0.1, flatShading: true });
const matPillar = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.9 });
const matCloud = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdddddd, emissiveIntensity: 0.2, flatShading: true });
const matLeaves = new THREE.MeshStandardMaterial({color: 0x2e7d32});
const matWood = new THREE.MeshStandardMaterial({ color: 0x3e2723 });
const sharedParticleMat = new THREE.PointsMaterial({ size: 0.8, color: 0xffffff, transparent: true, opacity: 0.6, sizeAttenuation: true });
const starsMat = new THREE.PointsMaterial({color: 0xffffff, size: 0.8, transparent: true, opacity: 0});
const smokeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, transparent: true, opacity: 0.5, flatShading: true });
const smokeGeo = new THREE.DodecahedronGeometry(0.3, 0);
const matOutline = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });

const starCount = 2000; const starPos = new Float32Array(starCount * 3);
for(let i=0; i<starCount*3; i++) starPos[i] = (Math.random() - 0.5) * 1000; 
const starsGeo = new THREE.BufferGeometry(); starsGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starField = new THREE.Points(starsGeo, starsMat); scene.add(starField);

// ==========================================
// GENERACIÓN PROCEDURAL
// ==========================================
const CHUNK_LENGTH = 100; const VISIBLE_CHUNKS = 14; const chunks = []; 
let genPoint = new THREE.Vector3(0, 4, 0); let genAngle = 0; let totalGenDist = 0;
const ROAD_Y_OFFSET = 0.2; const LINE_Y_OFFSET = ROAD_Y_OFFSET + 0.05;

const perm = new Uint8Array(512); const p = new Uint8Array(256);
for(let i=0; i<256; i++) p[i] = Math.floor(Math.random()*256);
for(let i=0; i<512; i++) perm[i] = p[i & 255];
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t, a, b) => a + t * (b - a);
const grad = (hash, x, y, z) => { const h = hash & 15; const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v); };
const noise = (x, y) => { const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y); const u = fade(x), v = fade(y); const A = perm[X] + Y, B = perm[X + 1] + Y; return lerp(v, lerp(u, grad(perm[A], x, y, 0), grad(perm[B], x - 1, y, 0)), lerp(u, grad(perm[A + 1], x, y - 1, 0), grad(perm[B + 1], x - 1, y - 1, 0)), lerp(u, grad(perm[A + 1], x, y - 1, 0), grad(perm[B + 1], x - 1, y - 1, 0))); };
function getTerrainHeight(x, z) { return noise(x*0.012, z*0.012)*30 + noise(x*0.04, z*0.04)*6; }

class Chunk {
    constructor(index, startPoint, startAngle, startDistGlobal) {
        this.index = index; this.startDistGlobal = startDistGlobal; this.group = new THREE.Group(); scene.add(this.group);
        const angleChange = (Math.random() - 0.5) * 0.5; const endAngle = startAngle + angleChange;
        const p0 = startPoint;
        const endX = Math.cos(endAngle) * CHUNK_LENGTH + p0.x; const endZ = Math.sin(endAngle) * CHUNK_LENGTH + p0.z;
        const terrainH = getTerrainHeight(endX, endZ);
        let targetY = (terrainH < 1) ? Math.max(p0.y, 3) : terrainH + 2.0; targetY = THREE.MathUtils.clamp(targetY, p0.y - 6.0, p0.y + 6.0);
        const p3 = new THREE.Vector3(endX, targetY, endZ);
        const cp1 = new THREE.Vector3(Math.cos(startAngle)*CHUNK_LENGTH*0.5, 0, Math.sin(startAngle)*CHUNK_LENGTH*0.5).add(p0);
        const cp2 = new THREE.Vector3(Math.cos(endAngle)*-CHUNK_LENGTH*0.5, 0, Math.sin(endAngle)*-CHUNK_LENGTH*0.5).add(p3);
        this.curve = new THREE.CubicBezierCurve3(p0, cp1, cp2, p3);
        this.length = this.curve.getLength(); this.endDistGlobal = startDistGlobal + this.length;
        this.endPoint = p3; this.endAngle = endAngle;
        this.buildRoadAndWalls(); this.buildTerrain(); this.buildProps(); this.buildClouds(); this.buildAtmosphere();
    }
    buildRoadAndWalls() {
        const div = 40; const pts = this.curve.getSpacedPoints(div); const frames = this.curve.computeFrenetFrames(div, false);
        const rV = [], rN = [], rI = []; const wV = [], wN = [], wI = []; const lV = [], lN = [], lI = [];
        for(let i=0; i<=div; i++) {
            const p = pts[i]; const n = frames.binormals[i]; const up = frames.normals[i];
            rV.push(p.x + n.x * ROAD_WIDTH_HALF, p.y + ROAD_Y_OFFSET, p.z + n.z * ROAD_WIDTH_HALF, p.x - n.x * ROAD_WIDTH_HALF, p.y + ROAD_Y_OFFSET, p.z - n.z * ROAD_WIDTH_HALF);
            rN.push(up.x, up.y, up.z, up.x, up.y, up.z);
            const LI = new THREE.Vector3().copy(p).add(n.clone().multiplyScalar(ROAD_WIDTH_HALF));
            const LO = new THREE.Vector3().copy(p).add(n.clone().multiplyScalar(ROAD_WIDTH_HALF + WALL_WIDTH));
            const RI = new THREE.Vector3().copy(p).add(n.clone().multiplyScalar(-ROAD_WIDTH_HALF));
            const RO = new THREE.Vector3().copy(p).add(n.clone().multiplyScalar(-(ROAD_WIDTH_HALF + WALL_WIDTH)));
            const yTop = p.y + ROAD_Y_OFFSET + WALL_HEIGHT;
            const yLow = p.y + ROAD_Y_OFFSET - 1.0;
            wV.push(LI.x, yTop, LI.z, LI.x, yLow, LI.z, LO.x, yTop, LO.z, LO.x, yLow, LO.z);
            wN.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
            wV.push(RI.x, yTop, RI.z, RI.x, yLow, RI.z, RO.x, yTop, RO.z, RO.x, yLow, RO.z);
            wN.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
            lV.push(p.x + n.x * 0.15, p.y + ROAD_Y_OFFSET + 0.08, p.z + n.z * 0.15, p.x - n.x * 0.15, p.y + ROAD_Y_OFFSET + 0.08, p.z - n.z * 0.15);
            lN.push(0,1,0, 0,1,0);
        }
        for(let i=0; i<div; i++) {
            const rBase = i * 2; rI.push(rBase, rBase+2, rBase+1, rBase+1, rBase+2, rBase+3);
            const wBase = i * 8;
            wI.push(wBase+0, wBase+8, wBase+1); wI.push(wBase+1, wBase+8, wBase+9);
            wI.push(wBase+0, wBase+2, wBase+8); wI.push(wBase+2, wBase+10, wBase+8);
            wI.push(wBase+2, wBase+3, wBase+10); wI.push(wBase+3, wBase+11, wBase+10);
            wI.push(wBase+4, wBase+5, wBase+12); wI.push(wBase+5, wBase+13, wBase+12);
            wI.push(wBase+6, wBase+4, wBase+14); wI.push(wBase+4, wBase+12, wBase+14);
            wI.push(wBase+7, wBase+6, wBase+15); wI.push(wBase+6, wBase+14, wBase+15);
            if (i % 2 === 0) { const lBase = i * 2; lI.push(lBase, lBase+2, lBase+1, lBase+1, lBase+2, lBase+3); }
        }
        const rG=new THREE.BufferGeometry(); rG.setAttribute('position', new THREE.Float32BufferAttribute(rV,3)); rG.setAttribute('normal', new THREE.Float32BufferAttribute(rN,3)); rG.setIndex(rI);
        const rM=new THREE.Mesh(rG, matRoad); rM.receiveShadow=true; rM.castShadow=true; this.group.add(rM);
        const wG=new THREE.BufferGeometry(); wG.setAttribute('position', new THREE.Float32BufferAttribute(wV,3)); wG.setAttribute('normal', new THREE.Float32BufferAttribute(wN,3)); wG.setIndex(wI); wG.computeVertexNormals();
        const wM=new THREE.Mesh(wG, matWall); wM.castShadow=true; wM.receiveShadow=true; this.group.add(wM);
        const lG=new THREE.BufferGeometry(); lG.setAttribute('position', new THREE.Float32BufferAttribute(lV,3)); lG.setAttribute('normal', new THREE.Float32BufferAttribute(lN,3)); lG.setIndex(lI);
        const lM=new THREE.Mesh(lG, matLineWhite); lM.receiveShadow=true; this.group.add(lM);
    }
    buildTerrain() {
        const divL=30; const divW=60; const w=800; const vs=[], cs=[], is=[]; const cObj=new THREE.Color();
        const pts=this.curve.getSpacedPoints(divL); const frames=this.curve.computeFrenetFrames(divL, false);
        for(let i=0; i<=divL; i++) {
            const P=pts[i]; const N=frames.binormals[i];
            for(let j=0; j<=divW; j++) {
                const u=(j/divW)-0.5; const xOff=u*w; const px=P.x+N.x*xOff; const pz=P.z+N.z*xOff; let py=getTerrainHeight(px, pz); const dist=Math.abs(xOff);
                if(dist<ROAD_WIDTH_HALF+2) { if(py>P.y-2) py=P.y-2; } else if(dist<ROAD_WIDTH_HALF+15) { const bl=(dist-(ROAD_WIDTH_HALF+2))/13; let t=py; if(py>P.y-2) t=P.y-2; py=lerp(1-bl, py, t); }
                vs.push(px, py, pz);
                if(py<-1) cObj.setHex(0xe6c288); else if(py<5) cObj.setHex(0x558b2f); else if(py<22) cObj.setHex(0x4e342e); else if(py<35) cObj.setHex(0x5d4037); else cObj.setHex(0xffffff);
                cs.push(cObj.r, cObj.g, cObj.b);
            }
        }
        for(let i=0; i<divL; i++) for(let j=0; j<divW; j++) { const a=i*(divW+1)+j, b=(i+1)*(divW+1)+j, c=(i+1)*(divW+1)+(j+1), d=i*(divW+1)+(j+1); is.push(a,b,d, b,c,d); }
        const g=new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vs,3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cs,3)); g.setIndex(is); g.computeVertexNormals();
        const m=new THREE.Mesh(g, new THREE.MeshStandardMaterial({vertexColors:true, flatShading:true})); m.receiveShadow=true; this.group.add(m);
        const wg=new THREE.PlaneGeometry(w, CHUNK_LENGTH*1.1); wg.rotateX(-Math.PI/2); const wm=new THREE.Mesh(wg, matWater); wm.receiveShadow=true; 
        const mid=this.curve.getPointAt(0.5); wm.position.set(mid.x,-2,mid.z); this.group.add(wm);
    }
    buildProps() {
        const offs=[-4.0, 4.0]; 
        for(let i=0; i<40; i+=2) {
            const t=i/40; const p=this.curve.getPointAt(t); const tan=this.curve.getTangentAt(t); const bin=new THREE.Vector3(-tan.z,0,tan.x).normalize();
            offs.forEach(o => { const s=new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 1.5), matLine); const pos=new THREE.Vector3().copy(p).add(bin.clone().multiplyScalar(o)); s.position.copy(pos); s.position.y+=ROAD_Y_OFFSET+0.05; s.lookAt(pos.clone().add(tan)); this.group.add(s); });
            const nY=getTerrainHeight(p.x, p.z); const pY=p.y-0.8; const pH=pY-Math.max(nY,-3);
            if(pH>1.0 && i%5===0) { const pil=new THREE.Mesh(new THREE.BoxGeometry(16.0, pH, 3.0), matPillar); pil.position.set(p.x, Math.max(nY,-3)+pH/2, p.z); pil.castShadow=true; this.group.add(pil); }
        }
        for(let i=0; i<80; i++) {
            const t=Math.random(); const d=ROAD_WIDTH_HALF+8+Math.random()*250; const s=Math.random()>0.5?1:-1;
            const p=this.curve.getPointAt(t); const tan=this.curve.getTangentAt(t); const bin=new THREE.Vector3(-tan.z,0,tan.x).normalize();
            const tp=new THREE.Vector3().copy(p).add(bin.multiplyScalar(s*d)); let ty=getTerrainHeight(tp.x, tp.z);
            if(ty>-1 && ty<28) {
                const gr=new THREE.Group(); const tr=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.6,7,5), matWood); tr.position.y=1; tr.castShadow=true;
                const lv=new THREE.Mesh(new THREE.ConeGeometry(2.2,6,5), matLeaves); lv.position.y=5.5; lv.castShadow=true;
                gr.add(tr); gr.add(lv); gr.position.set(tp.x, ty-0.5, tp.z); gr.scale.setScalar(0.7+Math.random()); gr.rotation.y=Math.random()*Math.PI; gr.rotation.z=(Math.random()-0.5)*0.15; gr.rotation.x=(Math.random()-0.5)*0.15; this.group.add(gr);
            }
        }
    }
    buildClouds() {
        for(let i=0; i<8; i++) {
            const c=new THREE.Group(); const x=this.endPoint.x+(Math.random()-0.5)*500; const z=this.endPoint.z+(Math.random()-0.5)*500;
            for(let j=0; j<5; j++) { const sz=4+Math.random()*5; const m=new THREE.Mesh(new THREE.DodecahedronGeometry(sz,0), matCloud); m.position.set((Math.random()-0.5)*sz*1.5,(Math.random()-0.5)*sz*0.5,(Math.random()-0.5)*sz*1.5); m.castShadow=true; m.receiveShadow=true; c.add(m); }
            c.position.set(x, 40+Math.random()*30, z); const sc=1.2+Math.random(); c.scale.set(sc,sc*0.6,sc); this.group.add(c);
        }
    }
    buildAtmosphere() {
        const pos=[]; for(let i=0; i<400; i++) { const t=Math.random(); const pt=this.curve.getPointAt(t); pos.push(pt.x+(Math.random()-0.5)*400, pt.y+Math.random()*60, pt.z+(Math.random()-0.5)*400); }
        const g=new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
        const p=new THREE.Points(g, sharedParticleMat); p.frustumCulled=false; this.group.add(p);
    }
    dispose() { scene.remove(this.group); this.group.traverse(o=>{if(o.geometry)o.geometry.dispose();}); }
}

const carHeadLight = new THREE.SpotLight(0xffffff, 400, 300, 0.6, 0.5, 1);
carHeadLight.castShadow = true; carHeadLight.shadow.bias = -0.0001;
const lightTarget = new THREE.Object3D(); scene.add(lightTarget); carHeadLight.target = lightTarget;

function createOutline(geo, scale) {
    const outlineMat = matOutline.clone();
    const outlineMesh = new THREE.Mesh(geo, outlineMat);
    outlineMesh.scale.multiplyScalar(scale);
    return outlineMesh;
}

function createSportCar() {
    const car = new THREE.Group();
    const chassisGeo = new THREE.BoxGeometry(2.0, 0.7, 4.2);
    const chassis = new THREE.Mesh(chassisGeo, matCarBody); chassis.position.y = 0.6; chassis.castShadow = true; car.add(chassis);
    car.add(createOutline(chassisGeo, 1.03).translateY(0.6)); 

    const cabinGeo = new THREE.BoxGeometry(1.6, 0.5, 2.0);
    const p = cabinGeo.attributes.position; for(let i=0; i<p.count; i++) if(p.getY(i)>0) p.setZ(i, p.getZ(i)*0.7); cabinGeo.computeVertexNormals();
    const cabin = new THREE.Mesh(cabinGeo, matCarBlack);
    cabin.position.set(0, 1.2, -0.2); car.add(cabin);
    const outCabin = createOutline(cabinGeo, 1.03); outCabin.position.set(0, 1.2, -0.2); car.add(outCabin); 

    const spoilerGeo = new THREE.BoxGeometry(2.2, 0.1, 0.6);
    const spoiler = new THREE.Mesh(spoilerGeo, matCarBlack); spoiler.position.set(0, 1.3, -2.0); car.add(spoiler);
    
    const sL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), matCarBlack); sL.position.set(0.8, 1.1, -2.0); car.add(sL);
    const sR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), matCarBlack); sR.position.set(-0.8, 1.1, -2.0); car.add(sR);
    
    const wGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 16); wGeo.rotateZ(Math.PI/2);
    const posW = [{x:1.0,z:1.2}, {x:-1.0,z:1.2}, {x:1.0,z:-1.2}, {x:-1.0,z:-1.2}];
    posW.forEach(pw => {
        const w = new THREE.Mesh(wGeo, matWheel); w.position.set(pw.x, 0.4, pw.z); car.add(w);
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 8).rotateZ(Math.PI/2), matRim); r.position.set(pw.x, 0.4, pw.z); car.add(r);
        const outW = createOutline(wGeo, 1.05); outW.position.set(pw.x, 0.4, pw.z); car.add(outW);
    });
    
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), new THREE.MeshStandardMaterial({color: 0xffffaa, emissive: 0xffffaa, emissiveIntensity: 2.0}));
    const hlL=hl.clone(); hlL.position.set(0.6, 0.6, 2.1); car.add(hlL); const hlR=hl.clone(); hlR.position.set(-0.6, 0.6, 2.1); car.add(hlR);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), new THREE.MeshStandardMaterial({color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1.0}));
    const tlL=tl.clone(); tlL.position.set(0.6, 0.7, -2.1); car.add(tlL); const tlR=tl.clone(); tlR.position.set(-0.6, 0.7, -2.1); car.add(tlR);
    carHeadLight.position.set(0, 1.0, 1.5); car.add(carHeadLight);
    return car;
}
const mainCar = createSportCar(); scene.add(mainCar);
const smokeParticles = []; const smokeGroup = new THREE.Group(); scene.add(smokeGroup);

let carDistance = 0; const cDay = new THREE.Color(0x87CEEB); const cSunset = new THREE.Color(0xff8c00); const cNight = new THREE.Color(0x1a1a2e); 
const dayDur = 60000; let lastTimeFPS = performance.now(); let frames=0;

function getTrackData(dist) {
    for(let chunk of chunks) {
        if(dist >= chunk.startDistGlobal && dist < chunk.endDistGlobal) {
            const localDist = dist - chunk.startDistGlobal;
            const t = localDist / chunk.length;
            const pos = chunk.curve.getPointAt(t);
            const tangent = chunk.curve.getTangentAt(t).normalize();
            const up = new THREE.Vector3(0,1,0); 
            const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
            return { pos, tangent, right };
        }
    }
    return null;
}

function spawnChunk() {
    const idx = chunks.length>0 ? chunks[chunks.length-1].index+1 : 0;
    const c = new Chunk(idx, genPoint, genAngle, totalGenDist);
    chunks.push(c);
    genPoint = c.endPoint; genAngle = c.endAngle; totalGenDist += c.length;
}

for(let i=0; i<VISIBLE_CHUNKS; i++) spawnChunk();

let prevCarPos = new THREE.Vector3();

function animate() {
    requestAnimationFrame(animate);

    if (!state.gameStarted) return; // Wait for start

    const now = performance.now(); frames++;
    if(now - lastTimeFPS >= 1000) { document.getElementById('fps-counter').innerText = "FPS: " + frames; frames=0; lastTimeFPS=now; }

    let currentLateralDisplay = 0;

    if (state.isManual) {
        const internalMaxSpeed = state.maxKmhLimit / 100.0;
        const accelDelta = (state.accelKmhPerSec / 100.0) / 60.0;

        if (state.inputGas) {
            if (state.manualSpeed < internalMaxSpeed) state.manualSpeed += accelDelta;
        } else if (state.inputBrake) {
            state.manualSpeed -= accelDelta * 2.0; 
        } else {
            state.manualSpeed *= 0.99; 
        }
        if (state.manualSpeed < 0) state.manualSpeed = 0;

        const baseSens = 0.02 + (state.steerSensitivity / 100.0) * 0.13;
        const reductionFactor = (state.steerStiffness / 100.0) * 5.0;
        const turnSensitivity = baseSens / (1.0 + (state.manualSpeed * reductionFactor));

        let steerDirection = state.inputSteer;
        if (state.steeringInverted) steerDirection *= -1;
        state.worldHeading += steerDirection * turnSensitivity; 

        const trackData = getTrackData(state.trackDist);
        if (trackData) {
            const moveX = Math.sin(state.worldHeading) * state.manualSpeed;
            const moveZ = Math.cos(state.worldHeading) * state.manualSpeed;
            const moveVec = new THREE.Vector3(moveX, 0, moveZ);
            const forwardProgression = moveVec.dot(trackData.tangent);
            const lateralMove = moveVec.dot(trackData.right);

            state.trackDist += forwardProgression;
            state.lateralOffset += lateralMove;

            if (Math.abs(state.lateralOffset) > WALL_LIMIT) {
                const roadAngle = Math.atan2(trackData.tangent.x, trackData.tangent.z);
                let relativeAngle = state.worldHeading - roadAngle;
                while (relativeAngle > Math.PI) relativeAngle -= Math.PI*2;
                while (relativeAngle < -Math.PI) relativeAngle += Math.PI*2;
                relativeAngle = -relativeAngle * 0.3; 
                const pushOut = 0.1; 
                state.lateralOffset = Math.sign(state.lateralOffset) * (WALL_LIMIT - pushOut);
                state.worldHeading = roadAngle + relativeAngle;
                state.manualSpeed *= 0.8;
            }
        }
        
        carDistance = state.trackDist;
        currentLateralDisplay = state.lateralOffset;
        ui.speedDisplay.innerText = Math.floor(state.manualSpeed * 100);

    } else {
        if (Math.abs(state.speed - state.autoSpeedTarget) > 0.001) state.speed += (state.autoSpeedTarget - state.speed) * 0.05;
        state.lateralOffset *= 0.95; 
        carDistance += state.speed;
        state.trackDist = carDistance; 
        currentLateralDisplay = state.lateralOffset;
    }

    const data = getTrackData(carDistance);
    if(data) {
        const finalPos = new THREE.Vector3().copy(data.pos);
        finalPos.add(data.right.clone().multiplyScalar(currentLateralDisplay));
        finalPos.y += (ROAD_Y_OFFSET + 0.05); 
        
        mainCar.position.copy(finalPos);
        
        if (state.isManual) {
            mainCar.rotation.set(0, state.worldHeading, 0);
        } else {
            const lookTarget = new THREE.Vector3().copy(finalPos).add(data.tangent.clone().multiplyScalar(10));
            mainCar.lookAt(lookTarget);
        }

        lightTarget.position.copy(finalPos).add(data.tangent.clone().multiplyScalar(30)); 

        if (state.isManual) {
            const camDist = 18 * state.cameraZoom; 
            const camHeight = 8 * state.cameraZoom;
            const backVec = new THREE.Vector3(-Math.sin(state.worldHeading), 0, -Math.cos(state.worldHeading));
            const idealCamPos = new THREE.Vector3().copy(finalPos).add(backVec.multiplyScalar(camDist));
            idealCamPos.y += camHeight;
            camera.position.lerp(idealCamPos, 0.1);
            camera.lookAt(finalPos);
        } else {
            if (prevCarPos.lengthSq() > 0) {
                const delta = new THREE.Vector3().subVectors(finalPos, prevCarPos);
                camera.position.add(delta);
                controls.target.copy(finalPos); 
                controls.update(); 
            }
        }
        prevCarPos.copy(finalPos);

        const spd = state.isManual ? state.manualSpeed : state.speed;
        if(spd > 0.1 && Math.random() > 0.6) { 
            const smoke = new THREE.Mesh(smokeGeo, smokeMat.clone());
            const offset = new THREE.Vector3((Math.random()-0.5)*0.8, 0.3, -2.2).applyMatrix4(mainCar.matrixWorld);
            smoke.position.copy(offset);
            smoke.userData = { vel: new THREE.Vector3((Math.random()-0.5)*0.05, 0.05, -0.1).applyQuaternion(mainCar.quaternion), life: 1.0 };
            smoke.scale.setScalar(0.5); smokeGroup.add(smoke); smokeParticles.push(smoke);
        }
    }

    for(let i=smokeParticles.length-1; i>=0; i--) { const p=smokeParticles[i]; p.position.add(p.userData.vel); p.scale.addScalar(0.05); p.userData.life-=0.02; p.material.opacity=p.userData.life*0.4; if(p.userData.life<=0) { smokeGroup.remove(p); smokeParticles.splice(i,1); } }
    if(carDistance > chunks[chunks.length-1].startDistGlobal - 400) spawnChunk();
    if(chunks.length > 0 && carDistance > chunks[0].endDistGlobal + 400) chunks.shift().dispose();

    const t = (Date.now() % dayDur) / dayDur; const ang = t * Math.PI * 2; const sin = Math.sin(ang);
    const lx=mainCar.position.x; const lz=mainCar.position.z;
    const sunDist = 3000;
    sunLight.position.set(lx + Math.cos(ang) * sunDist, sin * sunDist, lz + Math.sin(ang) * 400); 
    sunLight.target.position.set(lx, 0, lz); 
    sunMesh.position.copy(sunLight.position); 

    moonLight.position.set(lx - Math.cos(ang) * sunDist, -sin * sunDist, lz - Math.sin(ang) * 400);
    moonMesh.position.copy(moonLight.position); 
    starField.position.set(lx,0,lz);
    
    carHeadLight.intensity = 400; const ambBase = 2.0; 
    if(sin > 0) {
        sunLight.intensity=sin*2.0; moonLight.intensity=0; ambientLight.intensity=ambBase+sin*0.8; 
        sharedParticleMat.opacity=0.4; starsMat.opacity=0;
        if(sin>0.2) { scene.background=cDay; scene.fog.color=cDay; } else { const m=cSunset.clone().lerp(cDay, sin/0.2); scene.background=m; scene.fog.color=m; }
    } else {
        sunLight.intensity=0; moonLight.intensity=Math.abs(sin)*3.0; ambientLight.intensity=ambBase; 
        sharedParticleMat.opacity=0.7; starsMat.opacity=Math.abs(sin);
        if(sin<-0.2) { scene.background=cNight; scene.fog.color=cNight; } else { const m=cSunset.clone().lerp(cNight, Math.abs(sin)/0.2); scene.background=m; scene.fog.color=m; }
    }

    composer.render();
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight);
});