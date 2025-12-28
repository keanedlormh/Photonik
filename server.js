const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const path = require('path');

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const CONFIG = {
    FPS: 60,
    BASE_SPEED: 0.8, // Velocidad base ajustada
    WALL_LIMIT: 6.8  // Un poco menos que el cliente para evitar glitch visual
};

const rooms = {}; 

io.on('connection', (socket) => {
    console.log(`[NET] Cliente: ${socket.id}`);

    socket.on('getRooms', () => {
        const list = [];
        for (const rid in rooms) {
            const r = rooms[rid];
            if (Object.keys(r.players).length > 0) {
                list.push({ id: r.id, players: Object.keys(r.players).length });
            } else {
                delete rooms[rid];
            }
        }
        socket.emit('roomList', list);
    });

    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            players: {},
            // Semilla vital para que todos generen la misma pista
            seed: Math.floor(Math.random() * 100000) + 1 
        };
        console.log(`[SALA] Creada ${roomId} Seed: ${rooms[roomId].seed}`);
        socket.emit('roomCreated', { roomId, seed: rooms[roomId].seed });
        joinPlayer(socket, roomId);
    });

    socket.on('joinRoom', (roomId) => {
        if(!roomId) return;
        roomId = roomId.toUpperCase();
        if (rooms[roomId]) {
            socket.emit('roomJoined', { 
                roomId, 
                seed: rooms[roomId].seed 
            });
            joinPlayer(socket, roomId);
        } else {
            socket.emit('errorMsg', 'Sala no encontrada');
        }
    });

    socket.on('playerInput', (input) => {
        const rid = socket.data.room;
        if (rid && rooms[rid] && rooms[rid].players[socket.id]) {
            rooms[rid].players[socket.id].input = input;
        }
    });

    socket.on('disconnect', () => {
        const rid = socket.data.room;
        if (rid && rooms[rid]) {
            delete rooms[rid].players[socket.id];
            io.to(rid).emit('playerLeft', socket.id);
            if(Object.keys(rooms[rid].players).length === 0) delete rooms[rid];
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
        dist: 0,   // Distancia recorrida en la pista
        lat: 0,    // Desplazamiento lateral (centro = 0)
        speed: 0,
        input: { steer: 0, gas: false, brake: false }
    };
}

// --- BUCLE FÍSICO (Lógica Lineal Abstracta) ---
setInterval(() => {
    for (const rid in rooms) {
        const r = rooms[rid];
        const updateData = [];
        
        for (const pid in r.players) {
            const p = r.players[pid];
            
            // 1. Velocidad (Simulación simple)
            const targetSpeed = p.input.gas ? CONFIG.BASE_SPEED : (p.input.brake ? 0 : p.speed * 0.98);
            
            // Aceleración suave
            if(p.speed < targetSpeed) p.speed += 0.01;
            else p.speed -= 0.02;
            
            if(p.speed < 0) p.speed = 0;

            // 2. Movimiento Lateral (Basado en input steer)
            // Cuanto más rápido, más sensible
            const steerForce = p.input.steer * p.speed * 0.15;
            p.lat -= steerForce; // Invertido para coincidir visualmente

            // 3. Avance
            p.dist += p.speed;

            // 4. Colisión Muros
            if (Math.abs(p.lat) > CONFIG.WALL_LIMIT) {
                p.lat = Math.sign(p.lat) * CONFIG.WALL_LIMIT;
                p.speed *= 0.9; // Fricción contra muro
            }

            updateData.push({
                i: p.id,
                d: parseFloat(p.dist.toFixed(2)),
                l: parseFloat(p.lat.toFixed(2)),
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