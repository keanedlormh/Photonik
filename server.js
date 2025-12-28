const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");

// Configuración CORS permisiva para evitar bloqueos en la nube
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static('public'));

// --- CONFIGURACIÓN FÍSICA ---
const BASE_SPEED = 0.45;
const WALL_LIMIT = 7.3; // Ancho pista 8.5 - Ancho coche 1.2

const rooms = {}; 

io.on('connection', (socket) => {
    console.log(`[CONEXIÓN] Nuevo cliente: ${socket.id}`);

    socket.on('getRooms', () => {
        // Limpieza de salas vacías o zombies antes de enviar
        const list = [];
        for (const rid in rooms) {
            const r = rooms[rid];
            const pCount = Object.keys(r.players).length;
            if (pCount > 0) {
                list.push({ id: r.id, players: pCount, config: r.config });
            } else {
                delete rooms[rid]; // Auto-limpieza
            }
        }
        socket.emit('roomList', list);
    });

    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substr(2, 5).toUpperCase();
        console.log(`[SALA] Creada ${roomId} por ${socket.id}`);
        
        rooms[roomId] = {
            id: roomId,
            players: {},
            config: { 
                maxKmh: data.maxKmh || 500, 
                accel: data.accel || 40 
            },
            trackSeed: Math.floor(Math.random() * 5000),
            lastUpdate: Date.now()
        };
        
        socket.emit('roomCreated', { roomId, seed: rooms[roomId].trackSeed });
        joinPlayer(socket, roomId);
    });

    socket.on('joinRoom', (roomId) => {
        roomId = roomId ? roomId.toUpperCase() : "";
        if (rooms[roomId]) {
            console.log(`[SALA] ${socket.id} entró a ${roomId}`);
            socket.emit('roomJoined', { 
                roomId, 
                config: rooms[roomId].config, 
                seed: rooms[roomId].trackSeed 
            });
            joinPlayer(socket, roomId);
        } else {
            socket.emit('error', 'Sala no encontrada o cerrada');
        }
    });

    socket.on('playerInput', (input) => {
        // Búsqueda inversa optimizada: socket.data.room (feature de socket.io)
        const roomId = socket.data.currentRoom;
        if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
            rooms[roomId].players[socket.id].input = input;
        }
    });

    socket.on('disconnect', () => {
        const roomId = socket.data.currentRoom;
        if (roomId && rooms[roomId]) {
            console.log(`[DESCONEXIÓN] ${socket.id} de sala ${roomId}`);
            delete rooms[roomId].players[socket.id];
            io.to(roomId).emit('playerLeft', socket.id);
            
            // Si la sala queda vacía, se elimina
            if (Object.keys(rooms[roomId].players).length === 0) {
                delete rooms[roomId];
                console.log(`[SALA] ${roomId} eliminada (vacía)`);
            }
        }
    });
});

function joinPlayer(socket, roomId) {
    // Guardar referencia en el socket para acceso rápido
    socket.data.currentRoom = roomId;
    
    // Asignar color aleatorio brillante
    const hue = Math.floor(Math.random() * 360);
    const color = `hsl(${hue}, 100%, 50%)`;

    rooms[roomId].players[socket.id] = {
        id: socket.id,
        color: color, // Usamos string HSL que Three.js entiende
        speed: 0.0,
        heading: 0.0,
        lat: 0.0,
        dist: 0.0,
        input: { steer: 0, gas: false, brake: false }
    };
    socket.join(roomId);
}

// --- BUCLE FÍSICO SERVIDOR (60 FPS) ---
setInterval(() => {
    for (const rid in rooms) {
        const r = rooms[rid];
        const updatePack = [];
        
        // Configuración de la sala
        const maxSpd = BASE_SPEED * (r.config.maxKmh / 100);
        const accBase = (BASE_SPEED * (r.config.accel / 100)) / 60;

        for (const pid in r.players) {
            const p = r.players[pid];
            
            // 1. Aceleración / Frenado
            if (p.input.gas) {
                if (p.speed < maxSpd) p.speed += accBase;
            } else if (p.input.brake) {
                p.speed -= accBase * 2;
            } else {
                p.speed *= 0.99; // Fricción
            }
            if (p.speed < 0) p.speed = 0;

            // 2. Dirección (Sensibilidad variable por velocidad)
            const kmh = p.speed * 100;
            let sens = 0.04;
            if(kmh < 60) sens = 0.06;
            else if(kmh > 300) sens = 0.015;
            
            p.heading += p.input.steer * sens;

            // 3. Movimiento en Pista (Simplificado sin Three.js)
            // Curva matemática determinista
            const curve = Math.sin(p.dist * 0.01 + r.trackSeed) * 0.5 + Math.sin(p.dist * 0.003 + r.trackSeed) * 0.2;
            
            // Vectores locales 2D (X, Z)
            const tx = Math.sin(curve); 
            const tz = Math.cos(curve);
            const rx = tz;              
            const rz = -tx;             

            const mx = Math.sin(p.heading) * p.speed;
            const mz = Math.cos(p.heading) * p.speed;

            // Proyección
            const fwd = mx * tx + mz * tz;
            const lat = mx * rx + mz * rz;

            p.dist += fwd;
            p.lat += lat;

            // 4. Colisiones Muros
            if (Math.abs(p.lat) > WALL_LIMIT) {
                p.lat = Math.sign(p.lat) * (WALL_LIMIT - 0.1);
                p.speed *= 0.8;
                // Rebote de ángulo
                const roadHeading = curve; 
                const rel = p.heading - roadHeading;
                p.heading = roadHeading - (rel * 0.5); 
            }

            // Datos mínimos para enviar por red (optimización ancho de banda)
            updatePack.push({
                id: p.id,
                d: parseFloat(p.dist.toFixed(2)),    // Distancia (2 decimales)
                l: parseFloat(p.lat.toFixed(2)),     // Lateral
                h: parseFloat(p.heading.toFixed(3)), // Ángulo
                s: parseFloat(p.speed.toFixed(3)),   // Velocidad
                c: p.color
            });
        }
        
        // Enviar estado comprimido a la sala
        io.to(rid).emit('u', updatePack);
    }
}, 1000 / 60);

// Puerto dinámico para Render/Heroku
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SERVIDOR ONLINE en puerto ${PORT}`);
});