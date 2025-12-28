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

// Estado del Servidor
const rooms = {}; // { roomId: { players: {}, config: {}, trackSeed: 123 } }

function getTrackCurvePoint(dist, seed) {
    const curvature = Math.sin(dist * 0.01 + seed) * 0.5 + Math.sin(dist * 0.003 + seed) * 0.2;
    const angle = curvature; 
    const x = Math.sin(angle);
    const z = Math.cos(angle); 
    
    const tangent = new Vector3(x, 0, z).normalize();
    const up = new Vector3(0,1,0);
    const right = new Vector3().crossVectors(tangent, up).normalize();
    
    return { tangent, right };
}

io.on('connection', (socket) => {
    console.log('Jugador conectado:', socket.id);

    // Listar Salas
    socket.on('getRooms', () => {
        const roomList = [];
        for (const id in rooms) {
            const r = rooms[id];
            roomList.push({
                id: r.id,
                players: Object.keys(r.players).length,
                config: r.config
            });
        }
        socket.emit('roomList', roomList);
    });

    // Crear Sala
    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(7).toUpperCase(); // Códigos mayúsculas más cortos
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
        roomId = roomId.toUpperCase(); // Normalizar input
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

    socket.on('playerInput', (input) => {
        const player = getPlayer(socket.id);
        if (player) {
            player.input = input; 
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
        manualSpeed: 0.0,
        worldHeading: 0.0,
        lateralOffset: 0.0,
        trackDist: 0.0,
        input: { steer: 0, gas: false, brake: false }
    };
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
                delete rooms[rid]; 
            }
            break;
        }
    }
}

// GAME LOOP (60 FPS)
setInterval(() => {
    for (const rid in rooms) {
        const room = rooms[rid];
        const stateUpdate = [];

        for (const pid in room.players) {
            const p = room.players[pid];
            
            const internalMaxSpeed = BASE_SPEED * (room.config.maxKmhLimit / 100.0);
            const accelDelta = (BASE_SPEED * (room.config.accelKmhPerSec / 100.0)) / 60.0;

            if (p.input.gas) {
                if (p.manualSpeed < internalMaxSpeed) p.manualSpeed += accelDelta;
            } else if (p.input.brake) {
                p.manualSpeed -= accelDelta * 2.0;
            } else {
                p.manualSpeed *= 0.99;
            }
            if (p.manualSpeed < 0) p.manualSpeed = 0;

            let turnSens = 0.04; 
            const kmh = p.manualSpeed * 100;
            if(kmh < 60) turnSens = 0.06;
            else if(kmh > 320) turnSens = 0.012;
            else turnSens = 0.035;

            p.worldHeading += p.input.steer * turnSens;

            const trackData = getTrackCurvePoint(p.trackDist, room.trackSeed);
            
            if (trackData) {
                const moveX = Math.sin(p.worldHeading) * p.manualSpeed;
                const moveZ = Math.cos(p.worldHeading) * p.manualSpeed;
                const moveVec = new Vector3(moveX, 0, moveZ);

                const fwd = moveVec.dot(trackData.tangent);
                const lat = moveVec.dot(trackData.right);

                p.trackDist += fwd;
                p.lateralOffset += lat;

                if (Math.abs(p.lateralOffset) > WALL_LIMIT) {
                    const roadAngle = Math.atan2(trackData.tangent.x, trackData.tangent.z);
                    // Rebote simplificado server-side
                    p.lateralOffset = Math.sign(p.lateralOffset) * (WALL_LIMIT - 0.1);
                    p.manualSpeed *= 0.8;
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
        io.to(rid).emit('gameState', stateUpdate);
    }
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});