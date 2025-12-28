const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const path = require('path');

// Configuración ROBUSTA de Socket.IO
// Permite conexiones desde cualquier origen y varios métodos de transporte
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'] // Forzar compatibilidad máxima
});

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Ruta por defecto para asegurar que servimos el index
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- CONSTANTES DE JUEGO ---
const CONFIG = {
    FPS: 60,
    BASE_SPEED: 0.5,
    WALL_LIMIT: 7.2
};

const rooms = {}; 

io.on('connection', (socket) => {
    console.log(`[NET] Cliente conectado: ${socket.id}`);

    // --- GESTIÓN DE SALAS ---
    socket.on('getRooms', () => {
        const list = [];
        for (const rid in rooms) {
            const r = rooms[rid];
            // Limpieza automática: si no hay jugadores, la sala no se lista (y se borra)
            if (Object.keys(r.players).length === 0) {
                delete rooms[rid];
            } else {
                list.push({ 
                    id: r.id, 
                    players: Object.keys(r.players).length, 
                    config: r.config 
                });
            }
        }
        socket.emit('roomList', list);
    });

    socket.on('createRoom', (data) => {
        try {
            const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
            
            rooms[roomId] = {
                id: roomId,
                players: {},
                config: { 
                    maxKmh: data.maxKmh || 500, 
                    accel: data.accel || 40 
                },
                seed: Math.floor(Math.random() * 9999)
            };
            
            console.log(`[SALA] Creada sala ${roomId}`);
            socket.emit('roomCreated', { roomId, seed: rooms[roomId].seed });
            joinPlayer(socket, roomId);
        } catch (e) {
            console.error("Error creando sala:", e);
        }
    });

    socket.on('joinRoom', (roomId) => {
        if (!roomId) return;
        roomId = roomId.toUpperCase();
        
        if (rooms[roomId]) {
            socket.emit('roomJoined', { 
                roomId, 
                config: rooms[roomId].config, 
                seed: rooms[roomId].seed 
            });
            joinPlayer(socket, roomId);
        } else {
            socket.emit('errorMsg', 'Sala no encontrada');
        }
    });

    // --- GAMEPLAY ---
    socket.on('playerInput', (input) => {
        const rid = socket.data.room;
        if (rid && rooms[rid] && rooms[rid].players[socket.id]) {
            rooms[rid].players[socket.id].input = input;
        }
    });

    socket.on('disconnect', () => {
        const rid = socket.data.room;
        if (rid && rooms[rid] && rooms[rid].players[socket.id]) {
            delete rooms[rid].players[socket.id];
            io.to(rid).emit('playerLeft', socket.id);
            console.log(`[NET] ${socket.id} salió de ${rid}`);
            
            if(Object.keys(rooms[rid].players).length === 0) {
                delete rooms[rid];
            }
        }
    });
});

function joinPlayer(socket, roomId) {
    socket.data.room = roomId;
    socket.join(roomId);

    // Color aleatorio HSL
    const hue = Math.floor(Math.random() * 360);
    
    rooms[roomId].players[socket.id] = {
        id: socket.id,
        color: `hsl(${hue}, 100%, 50%)`,
        x: 0, z: 0, // Posición lógica (Lateral, Distancia)
        speed: 0,
        heading: 0,
        input: { steer: 0, gas: false, brake: false }
    };
}

// --- BUCLE FÍSICO (Server-side Authority light) ---
setInterval(() => {
    for (const rid in rooms) {
        const r = rooms[rid];
        const updateData = [];
        
        // Factores físicos basados en config de sala
        const MAX_SPEED = CONFIG.BASE_SPEED * (r.config.maxKmh / 100);
        const ACCEL = (CONFIG.BASE_SPEED * (r.config.accel / 100)) / 60;

        for (const pid in r.players) {
            const p = r.players[pid];
            
            // 1. Velocidad
            if (p.input.gas) p.speed = Math.min(p.speed + ACCEL, MAX_SPEED);
            else if (p.input.brake) p.speed = Math.max(p.speed - ACCEL*2, 0);
            else p.speed *= 0.98; // Fricción

            // 2. Dirección
            const speedFactor = Math.max(0.2, 1 - (p.speed / MAX_SPEED));
            p.heading += p.input.steer * 0.05 * speedFactor;

            // 3. Movimiento (Simplificado: Z avanza, X es lateral)
            p.z += p.speed;
            p.x += p.speed * Math.sin(p.heading);

            // 4. Colisión muros
            if (Math.abs(p.x) > CONFIG.WALL_LIMIT) {
                p.x = Math.sign(p.x) * CONFIG.WALL_LIMIT;
                p.speed *= 0.8;
                p.heading *= -0.5; // Rebote
            }

            // Datos mínimos para enviar
            updateData.push({
                i: p.id,
                x: parseFloat(p.x.toFixed(2)),
                z: parseFloat(p.z.toFixed(2)),
                h: parseFloat(p.heading.toFixed(2)),
                s: parseFloat(p.speed.toFixed(3)),
                c: p.color
            });
        }
        
        io.to(rid).volatile.emit('u', updateData);
    }
}, 1000 / CONFIG.FPS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`SERVIDOR LISTO EN PUERTO ${PORT}`);
});