const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

// ==========================================
// MOTOR DE FÍSICA (SERVER SIDE)
// ==========================================
class Vector3 {
    constructor(x=0,y=0,z=0) { this.x=x; this.y=y; this.z=z; }
    add(v) { this.x+=v.x; this.y+=v.y; this.z+=v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    multiplyScalar(s) { this.x*=s; this.y*=s; this.z*=s; return this; }
    dot(v) { return this.x*v.x + this.y*v.y + this.z*v.z; }
    normalize() {
        const l = Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z);
        if(l>0) this.multiplyScalar(1/l);
        return this;
    }
    crossVectors(a, b) {
        this.x = a.y * b.z - a.z * b.y;
        this.y = a.z * b.x - a.x * b.z;
        this.z = a.x * b.y - a.y * b.x;
        return this;
    }
}

// Configuración Global
const BASE_SPEED = 0.45;
const ROAD_WIDTH_HALF = 8.5;
const CAR_WIDTH_HALF = 1.0;
const WALL_LIMIT = ROAD_WIDTH_HALF - CAR_WIDTH_HALF - 0.2;
const CHUNK_LENGTH = 100;

// Estado del Servidor
const rooms = {}; // { roomId: { players: {}, config: {}, trackSeed: 123 } }

// Generación de Pista (Simplificada para física)
// En un entorno real, usaríamos una librería de ruido compartida.
// Aquí usamos una pseudo-aleatoriedad basada en seed para sincronizar curvas.
function getTrackCurvePoint(dist, seed) {
    // Simulación simple de la curva basada en seno/coseno y seed
    // para que el servidor sepa dónde está la carretera.
    // NOTA: Para producción, portar el SimplexNoise completo.
    // Aquí usamos una aproximación matemática determinista.
    const curvature = Math.sin(dist * 0.01 + seed) * 0.5 + Math.sin(dist * 0.003 + seed) * 0.2;
    // Tangente aproximada
    const angle = curvature; 
    const x = Math.sin(angle);
    const z = Math.cos(angle); // Avanzamos mayormente en Z
    
    // Devolvemos vectores normalizados de la pista en ese punto
    const tangent = new Vector3(x, 0, z).normalize();
    const up = new Vector3(0,1,0);
    const right = new Vector3().crossVectors(tangent, up).normalize();
    
    // Posición aproximada (no exacta sin integrar todo el spline, pero sirve para validación local)
    // En este modelo "semi-autoritativo", calculamos la física localmente en base a los vectores.
    return { tangent, right };
}

io.on('connection', (socket) => {
    console.log('Jugador conectado:', socket.id);

    // Crear Sala
    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(7);
        rooms[roomId] = {
            id: roomId,
            host: socket.id,
            players: {},
            config: {
                maxKmhLimit: data.maxKmh || 500,
                accelKmhPerSec: data.accel || 40
            },
            trackSeed: Math.random() * 1000
        };
        socket.emit('roomCreated', { roomId, seed: rooms[roomId].trackSeed });
        joinPlayerToRoom(socket, roomId);
    });

    // Unirse a Sala
    socket.on('joinRoom', (roomId) => {
        if (rooms[roomId]) {
            socket.emit('roomJoined', { 
                roomId, 
                config: rooms[roomId].config, 
                seed: rooms[roomId].trackSeed 
            });
            joinPlayerToRoom(socket, roomId);
        } else {
            socket.emit('error', 'Sala no encontrada');
        }
    });

    // Input del Jugador
    socket.on('playerInput', (input) => {
        const player = getPlayer(socket.id);
        if (player) {
            player.input = input; // { steer, gas, brake }
        }
    });

    socket.on('disconnect', () => {
        removePlayer(socket.id);
    });
});

function joinPlayerToRoom(socket, roomId) {
    const color = '#' + Math.floor(Math.random()*16777215).toString(16);
    rooms[roomId].players[socket.id] = {
        id: socket.id,
        color: color,
        // Física Estado
        manualSpeed: 0.0,
        worldHeading: 0.0,
        lateralOffset: 0.0,
        trackDist: 0.0,
        // Inputs
        input: { steer: 0, gas: false, brake: false }
    };
    // Notificar a todos en la sala
    io.to(roomId).emit('updatePlayerList', Object.values(rooms[roomId].players));
    socket.join(roomId);
}

function getPlayer(socketId) {
    for (const rid in rooms) {
        if (rooms[rid].players[socketId]) return rooms[rid].players[socketId];
    }
    return null;
}

function removePlayer(socketId) {
    for (const rid in rooms) {
        if (rooms[rid].players[socketId]) {
            delete rooms[rid].players[socketId];
            io.to(rid).emit('playerLeft', socketId);
            if (Object.keys(rooms[rid].players).length === 0) {
                delete rooms[rid]; // Eliminar sala vacía
            }
            break;
        }
    }
}

// ==========================================
// GAME LOOP (60 FPS)
// ==========================================
setInterval(() => {
    for (const rid in rooms) {
        const room = rooms[rid];
        const stateUpdate = [];

        for (const pid in room.players) {
            const p = room.players[pid];
            
            // --- FÍSICA V19 (Server Side) ---
            
            // 1. Config
            const internalMaxSpeed = BASE_SPEED * (room.config.maxKmhLimit / 100.0);
            const accelDelta = (BASE_SPEED * (room.config.accelKmhPerSec / 100.0)) / 60.0;

            // 2. Velocidad
            if (p.input.gas) {
                if (p.manualSpeed < internalMaxSpeed) p.manualSpeed += accelDelta;
            } else if (p.input.brake) {
                p.manualSpeed -= accelDelta * 2.0;
            } else {
                p.manualSpeed *= 0.99;
            }
            if (p.manualSpeed < 0) p.manualSpeed = 0;

            // 3. Dirección
            // Simplificación: sensibilidad fija en servidor para rendimiento, 
            // o replicamos la curva completa V11. Usaremos una media.
            let turnSens = 0.04; 
            // Si queremos ser precisos:
            const kmh = p.manualSpeed * 100;
            if(kmh < 60) turnSens = 0.06;
            else if(kmh > 320) turnSens = 0.012;
            else turnSens = 0.035;

            p.worldHeading += p.input.steer * turnSens;

            // 4. Movimiento
            // Usamos la misma lógica de proyección de vectores
            // Como no tenemos la malla 3D completa, usamos la función matemática getTrackCurvePoint
            const trackData = getTrackCurvePoint(p.trackDist, room.trackSeed);
            
            if (trackData) {
                const moveX = Math.sin(p.worldHeading) * p.manualSpeed;
                const moveZ = Math.cos(p.worldHeading) * p.manualSpeed;
                const moveVec = new Vector3(moveX, 0, moveZ);

                const fwd = moveVec.dot(trackData.tangent);
                const lat = moveVec.dot(trackData.right);

                p.trackDist += fwd;
                p.lateralOffset += lat;

                // Rebote
                if (Math.abs(p.lateralOffset) > WALL_LIMIT) {
                    const roadAngle = Math.atan2(trackData.tangent.x, trackData.tangent.z);
                    let relAngle = p.worldHeading - roadAngle;
                    // Normalizar ángulos es complejo sin librería math completa, 
                    // asumimos rebote simple invirtiendo heading relativo a la tangente
                    // Simplificación rebote servidor:
                    p.lateralOffset = Math.sign(p.lateralOffset) * (WALL_LIMIT - 0.1);
                    p.manualSpeed *= 0.8;
                    // Ajuste simple de heading para rebotar
                    p.worldHeading = roadAngle - (p.worldHeading - roadAngle) * 0.3;
                }
            }

            stateUpdate.push({
                id: p.id,
                dist: p.trackDist,
                lat: p.lateralOffset,
                heading: p.worldHeading,
                speed: p.manualSpeed,
                color: p.color
            });
        }

        // Enviar estado a todos los clientes de la sala
        io.to(rid).emit('gameState', stateUpdate);
    }
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
