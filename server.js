// server.js
import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';

// =======================
// Khởi tạo Express + Socket.IO
// =======================
const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      process.env.CORS_ORIGIN
    ].filter(Boolean),
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// Health check cho Render
app.get('/health', (req, res) => res.send('ok'));
app.get('/', (req, res) => res.send('Realtime game server is running'));

// =======================
// State quản lý các phòng
// =======================
const rooms = {}; 
// Key: roomCode -> { hostId, players[], questions[], gameState, progress[] }

// Hàm tạo roomCode ngẫu nhiên
function generateRoomCode(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// =======================
// Socket.IO events
// =======================
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Tạo phòng
  socket.on('createRoom', ({ playerName, questions }) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      roomCode,
      hostId: socket.id,
      players: [
        { id: socket.id, name: playerName, isHost: true }
      ],
      questions: questions || [],
      gameState: 'LOBBY',
      progress: [],
    };

    socket.join(roomCode);

    socket.emit('room-created', rooms[roomCode]);
    console.log(`📌 Room created: ${roomCode}`);
  });

  // Tham gia phòng
  socket.on('joinRoom', ({ playerName, roomCode }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('error', 'Room does not exist');
      return;
    }
    if (room.gameState !== 'LOBBY') {
      socket.emit('error', 'Game already started');
      return;
    }

    // Check duplicate name
    if (room.players.some(p => p.name === playerName)) {
      socket.emit('error', 'Player name already taken');
      return;
    }

    room.players.push({ id: socket.id, name: playerName, isHost: false });
    socket.join(roomCode);

    // Cập nhật danh sách players cho tất cả
    io.to(roomCode).emit('update-player-list', room.players);

    // Gửi câu hỏi riêng cho player vừa vào
    socket.emit('questions', room.questions);

    console.log(`👥 ${playerName} joined room ${roomCode}`);
  });

  // Bắt đầu game
  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    if (room.hostId !== socket.id) {
      socket.emit('error', 'Only host can start the game');
      return;
    }

    room.gameState = 'PLAYING';
    room.progress = room.players.map(p => ({
      playerId: p.id,
      name: p.name,
      finishTime: null,
    }));

    io.to(roomCode).emit('game-started', { questions: room.questions });
    console.log(`🎮 Game started in room ${roomCode}`);
  });

  // Người chơi hoàn thành
  socket.on('playerFinished', ({ roomCode, finishTime }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const playerProgress = room.progress.find(p => p.playerId === socket.id);
    if (playerProgress) {
      playerProgress.finishTime = finishTime;
    }

    io.to(roomCode).emit('update-progress', room.progress);

    // Kiểm tra tất cả đã xong chưa
    if (room.progress.every(p => p.finishTime !== null)) {
      room.gameState = 'FINISHED';
      // Xếp hạng theo thời gian hoàn thành
      const leaderboard = [...room.progress].sort((a, b) => a.finishTime - b.finishTime);
      io.to(roomCode).emit('game-finished', leaderboard);
      console.log(`🏁 Game finished in room ${roomCode}`);
    }
  });

  // Ngắt kết nối
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    // Xoá player khỏi phòng
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const [removed] = room.players.splice(idx, 1);
        io.to(roomCode).emit('update-player-list', room.players);
        console.log(`👋 ${removed.name} left room ${roomCode}`);
        // Nếu host rời phòng thì giải tán phòng
        if (removed.isHost) {
          io.to(roomCode).emit('error', 'Host has left. Room closed.');
          delete rooms[roomCode];
          console.log(`💥 Room ${roomCode} closed because host left`);
        }
      }
    }
  });
});

// =======================
// Khởi chạy server
// =======================
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
