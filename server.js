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
            host: socket.id,
            config: { maxSpeed: 500, accel: 40 },
            seed: Math.floor(Math.random() * 999999) + 1,
            count: 0 // Contador para asignar letras A, B, C...
        };
        const pInfo = joinPlayer(socket, roomId);
        socket.emit('roomCreated', { 
            roomId, 
            seed: rooms[roomId].seed,
            isHost: true,
            config: rooms[roomId].config,
            label: pInfo.label // Enviamos su nombre al creador
        });
    });

    // Unirse
    socket.on('joinRoom', (roomId) => {
        if(!roomId) return;
        roomId = roomId.toUpperCase();
        if (rooms[roomId]) {
            const pInfo = joinPlayer(socket, roomId);
            socket.emit('roomJoined', { 
                roomId, 
                seed: rooms[roomId].seed,
                isHost: false,
                config: rooms[roomId].config,
                label: pInfo.label // Enviamos su nombre al unirse
            });
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

    // Configuración
    socket.on('updateRoomConfig', (newConfig) => {
        const rid = socket.data.room;
        if(rid && rooms[rid] && rooms[rid].host === socket.id) {
            rooms[rid].config = { ...rooms[rid].config, ...newConfig };
            io.to(rid).emit('configUpdated', rooms[rid].config);
        }
    });

    // Estado del Cliente
    socket.on('myState', (state) => {
        const rid = socket.data.room;
        if (rid && rooms[rid] && rooms[rid].players[socket.id]) {
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
    
    // Asignar Letra (A, B, C...)
    const index = rooms[roomId].count % 26;
    const letter = String.fromCharCode(65 + index);
    const label = `PLAYER ${letter}`;
    rooms[roomId].count++;

    const hue = Math.floor(Math.random() * 360);
    const pData = {
        id: socket.id,
        label: label,
        color: `hsl(${hue}, 100%, 50%)`,
        state: { d: 0, l: 0, s: 0, h: 0 }
    };
    
    rooms[roomId].players[socket.id] = pData;
    return pData;
}

// Bucle Broadcast
setInterval(() => {
    for (const rid in rooms) {
        const r = rooms[rid];
        const pack = [];
        for (const pid in r.players) {
            const p = r.players[pid];
            if(p.state) {
                pack.push({
                    i: p.id,
                    n: p.label, // Nombre (Player A)
                    d: p.state.d,
                    l: p.state.l,
                    s: p.state.s,
                    h: p.state.h,
                    c: p.color
                });
            }
        }
        if (pack.length > 0) io.to(rid).volatile.emit('u', pack);
    }
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`SERVIDOR OK ${PORT}`); });