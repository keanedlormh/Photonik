const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Servir archivos estáticos de la carpeta 'public'
app.use(express.static('public'));

// CONFIGURACIÓN FÍSICA
const BASE_SPEED = 0.45;
const ROAD_WIDTH_HALF = 8.5;
const CAR_WIDTH_HALF = 1.0;
const WALL_LIMIT = ROAD_WIDTH_HALF - CAR_WIDTH_HALF - 0.2;

const rooms = {}; 

function getTrackCurvePoint(dist, seed) {
    const curvature = Math.sin(dist * 0.01 + seed) * 0.5 + Math.sin(dist * 0.003 + seed) * 0.2;
    const angle = curvature; 
    const x = Math.sin(angle);
    const z = Math.cos(angle); 
    return { 
        tangent: { x: x, y: 0, z: z }, // Simplificado para JS vainilla
        right: { x: z, y: 0, z: -x }   // Cross product simplificado (UP es 0,1,0)
    };
}

io.on('connection', (socket) => {
    console.log('Nuevo jugador:', socket.id);

    socket.on('getRooms', () => {
        const list = Object.values(rooms).map(r => ({
            id: r.id,
            players: Object.keys(r.players).length,
            config: r.config
        }));
        socket.emit('roomList', list);
    });

    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substr(2, 4).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            players: {},
            config: { maxKmhLimit: data.maxKmh, accelKmhPerSec: data.accel },
            trackSeed: Math.random() * 1000
        };
        socket.emit('roomCreated', { roomId, seed: rooms[roomId].trackSeed });
        joinPlayer(socket, roomId);
    });

    socket.on('joinRoom', (roomId) => {
        roomId = roomId.toUpperCase();
        if (rooms[roomId]) {
            socket.emit('roomJoined', { roomId, config: rooms[roomId].config, seed: rooms[roomId].trackSeed });
            joinPlayer(socket, roomId);
        } else {
            socket.emit('error', 'Sala no encontrada');
        }
    });

    socket.on('playerInput', (input) => {
        // Buscar en qué sala está el jugador
        for (const rid in rooms) {
            if (rooms[rid].players[socket.id]) {
                rooms[rid].players[socket.id].input = input;
                break;
            }
        }
    });

    socket.on('disconnect', () => {
        for (const rid in rooms) {
            if (rooms[rid].players[socket.id]) {
                delete rooms[rid].players[socket.id];
                io.to(rid).emit('playerLeft', socket.id);
                if (Object.keys(rooms[rid].players).length === 0) delete rooms[rid];
                break;
            }
        }
    });
});

function joinPlayer(socket, roomId) {
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

// BUCLE DE FÍSICA (60 Hz)
setInterval(() => {
    for (const rid in rooms) {
        const r = rooms[rid];
        const pack = [];
        
        for (const pid in r.players) {
            const p = r.players[pid];
            
            // FÍSICA SIMPLIFICADA EN SERVIDOR
            const maxSpeed = BASE_SPEED * (r.config.maxKmhLimit / 100);
            const accel = (BASE_SPEED * (r.config.accelKmhPerSec / 100)) / 60;

            if (p.input.gas) {
                if (p.manualSpeed < maxSpeed) p.manualSpeed += accel;
            } else if (p.input.brake) {
                p.manualSpeed -= accel * 2;
            } else {
                p.manualSpeed *= 0.99;
            }
            if (p.manualSpeed < 0) p.manualSpeed = 0;

            let sens = 0.04; 
            // Lógica simple de giro server-side
            p.worldHeading += p.input.steer * sens;

            const curve = getTrackCurvePoint(p.trackDist, r.trackSeed);
            
            // Proyección de movimiento
            // Movemos según heading del coche
            const mx = Math.sin(p.worldHeading) * p.manualSpeed;
            const mz = Math.cos(p.worldHeading) * p.manualSpeed;
            
            // Proyectar sobre vectores de la pista
            // Dot Product manual
            const fwd = mx * curve.tangent.x + mz * curve.tangent.z;
            const lat = mx * curve.right.x + mz * curve.right.z;

            p.trackDist += fwd;
            p.lateralOffset += lat;

            // Colisión Pared
            if (Math.abs(p.lateralOffset) > WALL_LIMIT) {
                p.lateralOffset = Math.sign(p.lateralOffset) * (WALL_LIMIT - 0.1);
                p.manualSpeed *= 0.8;
                // Rebote simple de ángulo
                const roadAngle = Math.atan2(curve.tangent.x, curve.tangent.z);
                p.worldHeading = roadAngle - (p.worldHeading - roadAngle) * 0.5;
            }

            pack.push({
                id: p.id,
                dist: p.trackDist,
                lat: p.lateralOffset,
                heading: p.worldHeading,
                speed: p.manualSpeed,
                color: p.color
            });
        }
        io.to(rid).emit('gameState', pack);
    }
}, 1000/60);

server.listen(3000, () => {
    console.log('✅ SERVIDOR LISTO: Abre http://localhost:3000 en tu navegador');
});