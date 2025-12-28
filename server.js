const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const path = require('path');

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

// Configuración Física Básica (Servidor autoritativo ligero)
const CONFIG = {
    FPS: 60,
    BASE_ACCEL: 0.005,
    MAX_SPEED: 0.95, // Velocidad base alta para sensación de velocidad
    WALL_LIMIT: 7.0, // Límites de la carretera
    FRICTION: 0.98
};

const rooms = {};

io.on('connection', (socket) => {
    console.log(`[NET] Nuevo piloto: ${socket.id}`);

    // Enviar lista de salas
    socket.on('getRooms', () => {
        const list = [];
        for (const rid in rooms) {
            const r = rooms[rid];
            if (Object.keys(r.players).length > 0) {
                list.push({ id: r.id, players: Object.keys(r.players).length });
            } else {
                delete rooms[rid]; // Limpieza de salas vacías
            }
        }
        socket.emit('roomList', list);
    });

    // Crear Sala
    socket.on('createRoom', () => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            players: {},
            // LA SEMILLA MÁGICA: Esto asegura que todos vean el mismo mundo
            seed: Math.floor(Math.random() * 999999) + 1 
        };
        socket.emit('roomCreated', { roomId, seed: rooms[roomId].seed });
        joinPlayer(socket, roomId);
    });

    // Unirse a Sala
    socket.on('joinRoom', (roomId) => {
        if(!roomId) return;
        roomId = roomId.toUpperCase();
        if (rooms[roomId]) {
            socket.emit('roomJoined', { roomId, seed: rooms[roomId].seed });
            joinPlayer(socket, roomId);
        } else {
            socket.emit('errorMsg', 'Sala no encontrada');
        }
    });

    // Input del Jugador
    socket.on('playerInput', (input) => {
        const rid = socket.data.room;
        if (rid && rooms[rid] && rooms[rid].players[socket.id]) {
            rooms[rid].players[socket.id].input = input; // { steer, gas, brake }
        }
    });

    socket.on('disconnect', () => {
        const rid = socket.data.room;
        if (rid && rooms[rid]) {
            delete rooms[rid].players[socket.id];
            io.to(rid).emit('playerLeft', socket.id);
        }
    });
});

function joinPlayer(socket, roomId) {
    socket.data.room = roomId;
    socket.join(roomId);

    // Color aleatorio vibrante para el coche (HSL)
    const hue = Math.floor(Math.random() * 360);
    
    rooms[roomId].players[socket.id] = {
        id: socket.id,
        color: `hsl(${hue}, 100%, 50%)`,
        dist: 0,     // Distancia recorrida en la pista
        lat: 0,      // Posición lateral (-7 a 7)
        speed: 0,
        input: { steer: 0, gas: false, brake: false }
    };
}

// Bucle de Física del Servidor (60Hz)
setInterval(() => {
    for (const rid in rooms) {
        const r = rooms[rid];
        const pack = []; // Paquete de actualización
        
        for (const pid in r.players) {
            const p = r.players[pid];
            
            // 1. Calcular Velocidad
            if (p.input.gas) {
                if (p.speed < CONFIG.MAX_SPEED) p.speed += CONFIG.BASE_ACCEL;
            } else if (p.input.brake) {
                p.speed -= CONFIG.BASE_ACCEL * 2;
            } else {
                p.speed *= CONFIG.FRICTION; // Fricción natural
            }
            if (p.speed < 0) p.speed = 0;

            // 2. Calcular Giro (Basado en velocidad)
            // A mayor velocidad, menor giro para estabilidad
            const steerFactor = p.input.steer * (0.15 + (p.speed * 0.1)); 
            p.lat -= steerFactor; 
            
            // 3. Colisiones con Muros
            if (p.lat > CONFIG.WALL_LIMIT) {
                p.lat = CONFIG.WALL_LIMIT;
                p.speed *= 0.95; // Pequeña penalización por rozar
            } else if (p.lat < -CONFIG.WALL_LIMIT) {
                p.lat = -CONFIG.WALL_LIMIT;
                p.speed *= 0.95;
            }

            // 4. Avance
            p.dist += p.speed;

            // Datos mínimos para enviar por red
            pack.push({
                i: p.id,
                d: parseFloat(p.dist.toFixed(2)),
                l: parseFloat(p.lat.toFixed(2)),
                s: parseFloat(p.speed.toFixed(3)),
                c: p.color
            });
        }
        
        // Enviar estado del mundo a todos en la sala (volátil para rendimiento UDP-like)
        if (pack.length > 0) io.to(rid).volatile.emit('u', pack);
    }
}, 1000 / CONFIG.FPS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🏁 Servidor Photonik Corriendo en puerto ${PORT}`);
});