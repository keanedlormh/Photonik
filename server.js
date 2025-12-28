const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const path = require('path');

// Configuración de Socket.IO con CORS permisivo para evitar bloqueos
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// --- CONFIGURACIÓN FÍSICA ---
const BASE_SPEED = 0.45;
const WALL_LIMIT = 7.3; // Ancho pista 8.5 - Ancho coche 1.2
const GAME_FPS = 60;

// Almacenamiento de salas
const rooms = {}; 

io.on('connection', (socket) => {
    console.log(`[CONEXIÓN] Nuevo cliente: ${socket.id}`);

    // 1. Listar Salas
    socket.on('getRooms', () => {
        const list = [];
        for (const rid in rooms) {
            const r = rooms[rid];
            // Limpieza automática si la sala no tiene jugadores reales conectados
            const pCount = Object.keys(r.players).length;
            if (pCount > 0) {
                list.push({ id: r.id, players: pCount, config: r.config });
            } else {
                console.log(`[LIMPIEZA] Eliminando sala vacía: ${rid}`);
                delete rooms[rid];
            }
        }
        socket.emit('roomList', list);
    });

    // 2. Crear Sala
    socket.on('createRoom', (data) => {
        // Generar ID corto de 5 letras
        const roomId = Math.random().toString(36).substr(2, 5).toUpperCase();
        console.log(`[SALA] Creada ${roomId} por ${socket.id}`);
        
        rooms[roomId] = {
            id: roomId,
            players: {},
            config: { 
                maxKmh: data.maxKmh || 500, 
                accel: data.accel || 40 
            },
            // Semilla para que la curva sea igual para todos
            trackSeed: Math.floor(Math.random() * 5000), 
            lastUpdate: Date.now()
        };
        
        socket.emit('roomCreated', { roomId, seed: rooms[roomId].trackSeed });
        joinPlayer(socket, roomId);
    });

    // 3. Unirse a Sala
    socket.on('joinRoom', (roomId) => {
        roomId = roomId ? roomId.toUpperCase() : "";
        if (rooms[roomId]) {
            console.log(`[SALA] ${socket.id} intentando entrar a ${roomId}`);
            socket.emit('roomJoined', { 
                roomId, 
                config: rooms[roomId].config, 
                seed: rooms[roomId].trackSeed 
            });
            joinPlayer(socket, roomId);
        } else {
            socket.emit('error', 'Sala no encontrada o ya no existe');
        }
    });

    // 4. Input del Jugador
    socket.on('playerInput', (input) => {
        const roomId = socket.data.currentRoom;
        if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
            rooms[roomId].players[socket.id].input = input;
            // Guardamos timestamp para desconectar AFK si fuera necesario
            rooms[roomId].players[socket.id].lastInput = Date.now();
        }
    });

    // 5. Desconexión
    socket.on('disconnect', () => {
        const roomId = socket.data.currentRoom;
        if (roomId && rooms[roomId]) {
            console.log(`[DESCONEXIÓN] ${socket.id} de sala ${roomId}`);
            if (rooms[roomId].players[socket.id]) {
                delete rooms[roomId].players[socket.id];
                // Avisar a los demás que este jugador se fue
                io.to(roomId).emit('playerLeft', socket.id);
            }
            
            // Si la sala queda vacía, se marca para borrar
            if (Object.keys(rooms[roomId].players).length === 0) {
                delete rooms[roomId];
                console.log(`[SALA] ${roomId} eliminada (vacía)`);
            }
        }
    });
});

function joinPlayer(socket, roomId) {
    // Guardar referencia en el socket para acceso rápido sin búsquedas
    socket.data.currentRoom = roomId;
    
    // Asignar color aleatorio brillante (HSL)
    const hue = Math.floor(Math.random() * 360);
    const color = `hsl(${hue}, 100%, 50%)`;

    if (!rooms[roomId].players) rooms[roomId].players = {};

    rooms[roomId].players[socket.id] = {
        id: socket.id,
        color: color, 
        speed: 0.0,
        heading: 0.0,
        lat: 0.0,
        dist: 0.0,
        input: { steer: 0, gas: false, brake: false }
    };
    
    socket.join(roomId);
}

// --- BUCLE FÍSICO SERVIDOR (60 FPS) ---
// Es vital que esto corra separado de los eventos de red
setInterval(() => {
    for (const rid in rooms) {
        const r = rooms[rid];
        const updatePack = [];
        
        // Calcular físicas basadas en la config de la sala
        const maxSpd = BASE_SPEED * (r.config.maxKmh / 100);
        const accBase = (BASE_SPEED * (r.config.accel / 100)) / 60; // Por frame

        for (const pid in r.players) {
            const p = r.players[pid];
            
            // Aceleración / Frenado
            if (p.input.gas) {
                if (p.speed < maxSpd) p.speed += accBase;
            } else if (p.input.brake) {
                p.speed -= accBase * 2;
            } else {
                p.speed *= 0.99; // Fricción natural
            }
            if (p.speed < 0) p.speed = 0;

            // Dirección (Sensibilidad dinámica)
            const kmh = p.speed * 100;
            let sens = 0.04;
            if(kmh < 60) sens = 0.06;
            else if(kmh > 300) sens = 0.015;
            
            p.heading += p.input.steer * sens;

            // Cálculo de posición en pista procedural
            // Curva matemática determinista (misma seed = misma pista)
            const curve = Math.sin(p.dist * 0.01 + r.trackSeed) * 0.5 + Math.sin(p.dist * 0.003 + r.trackSeed) * 0.2;
            
            // Vectores locales simplificados
            const tx = Math.sin(curve); 
            const tz = Math.cos(curve);
            const rx = tz;              
            const rz = -tx;             

            const mx = Math.sin(p.heading) * p.speed;
            const mz = Math.cos(p.heading) * p.speed;

            // Proyección de movimiento
            const fwd = mx * tx + mz * tz;
            const lat = mx * rx + mz * rz;

            p.dist += fwd;
            p.lat += lat;

            // Colisiones con Muros (Rebote elástico simple)
            if (Math.abs(p.lat) > WALL_LIMIT) {
                p.lat = Math.sign(p.lat) * (WALL_LIMIT - 0.1);
                p.speed *= 0.85; // Pérdida de velocidad por choque
                
                // Corregir ángulo hacia la pista
                const roadHeading = curve; 
                const rel = p.heading - roadHeading;
                p.heading = roadHeading - (rel * 0.6); 
            }

            // Empaquetado de datos (minificamos claves para ahorrar ancho de banda)
            updatePack.push({
                id: p.id,
                d: parseFloat(p.dist.toFixed(2)),    // Distancia
                l: parseFloat(p.lat.toFixed(2)),     // Lateral
                h: parseFloat(p.heading.toFixed(3)), // Ángulo
                s: parseFloat(p.speed.toFixed(3)),   // Velocidad
                c: p.color
            });
        }
        
        // Enviar estado comprimido a todos en la sala (Update volátil)
        io.to(rid).volatile.emit('u', updatePack);
    }
}, 1000 / GAME_FPS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SERVIDOR ONLINE en puerto ${PORT}`);
});