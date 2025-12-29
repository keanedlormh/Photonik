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

const rooms = {};

io.on('connection', (socket) => {
    
    // Crear Sala
    socket.on('createRoom', () => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            players: {},
            host: socket.id, // El creador manda en la configuración
            config: { maxSpeed: 500, accel: 40 }, // Config por defecto
            seed: Math.floor(Math.random() * 999999) + 1 
        };
        socket.emit('roomCreated', { 
            roomId, 
            seed: rooms[roomId].seed,
            isHost: true,
            config: rooms[roomId].config
        });
        joinPlayer(socket, roomId);
    });

    // Unirse
    socket.on('joinRoom', (roomId) => {
        if(!roomId) return;
        roomId = roomId.toUpperCase();
        if (rooms[roomId]) {
            socket.emit('roomJoined', { 
                roomId, 
                seed: rooms[roomId].seed,
                isHost: false,
                config: rooms[roomId].config
            });
            joinPlayer(socket, roomId);
        } else {
            socket.emit('errorMsg', 'Sala no encontrada');
        }
    });

    // Listado
    socket.on('getRooms', () => {
        const list = [];
        for (const rid in rooms) {
            const r = rooms[rid];
            const pCount = Object.keys(r.players).length;
            if (pCount > 0) list.push({ id: r.id, players: pCount });
            else delete rooms[rid];
        }
        socket.emit('roomList', list);
    });

    // Actualizar Configuración (Solo Host)
    socket.on('updateRoomConfig', (newConfig) => {
        const rid = socket.data.room;
        if(rid && rooms[rid] && rooms[rid].host === socket.id) {
            rooms[rid].config = { ...rooms[rid].config, ...newConfig };
            // Emitir a todos en la sala la nueva config
            io.to(rid).emit('configUpdated', rooms[rid].config);
        }
    });

    // Recepción de estado físico del cliente (Cliente Autoridad)
    socket.on('myState', (state) => {
        const rid = socket.data.room;
        if (rid && rooms[rid] && rooms[rid].players[socket.id]) {
            // Guardamos el estado que el cliente calculó
            rooms[rid].players[socket.id].state = state;
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
    const hue = Math.floor(Math.random() * 360);
    rooms[roomId].players[socket.id] = {
        id: socket.id,
        color: `hsl(${hue}, 100%, 50%)`,
        state: { d: 0, l: 0, s: 0, h: 0 } // dist, lat, speed, heading
    };
}

// Bucle de Broadcast (60Hz)
setInterval(() => {
    for (const rid in rooms) {
        const r = rooms[rid];
        const pack = [];
        for (const pid in r.players) {
            const p = r.players[pid];
            if(p.state) {
                pack.push({
                    i: p.id,
                    d: p.state.d, // Distancia
                    l: p.state.l, // Lateral
                    s: p.state.s, // Velocidad
                    h: p.state.h, // Heading (Rotación real del coche)
                    c: p.color
                });
            }
        }
        if (pack.length > 0) io.to(rid).volatile.emit('u', pack);
    }
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`SERVIDOR OK ${PORT}`); });