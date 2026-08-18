import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { PRESET_CHARACTERS } from './data/characters';
import { PlayerIntention, RoomState } from '@ai-trpg/shared';
import { moduleService } from './services/ModuleService';
import { GameEngineService } from './services/GameEngineService';
import { questService } from './services/QuestService';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // 开发阶段允许跨域
    methods: ['GET', 'POST']
  }
});

const gameEngine = new GameEngineService(io);

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// 简单的内存房间状态字典 (MVP阶段)
export const memoryRooms: Record<string, RoomState> = {};

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 模组列表 API
app.get('/api/modules', (req, res) => {
  const modules = moduleService.getAllModules().map(m => ({
    module_id: m.module_id,
    title: m.title,
    recommended_party_size: m.recommended_party_size,
    difficulty: m.difficulty,
    content_warnings: m.content_warnings
  }));
  res.json(modules);
});

// 基础的房间 API (迭代二: 房间创建)
app.post('/api/rooms', (req, res) => {
  const { module_id, campaign_mode, combat_mode } = req.body;
  const room_id = `r_${Math.random().toString(36).substr(2, 6)}`;
  
  memoryRooms[room_id] = {
    room_id,
    module_id,
    campaign_mode,
    combat_mode,
    characters: {},
    current_scene: '登船甲板', // 沉船的低语起始场景
    quests: questService.loadQuests(room_id)
  };

  res.json({ room_id, state: memoryRooms[room_id] });
});

app.get('/api/rooms/:room_id', (req, res) => {
  const room = memoryRooms[req.params.room_id];
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json(room);
});

// 获取预设角色模板
app.get('/api/templates/characters', (req, res) => {
  res.json(PRESET_CHARACTERS);
});

// 加入房间并选择角色
app.post('/api/rooms/:room_id/join', (req, res) => {
  const room = memoryRooms[req.params.room_id];
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  
  const { character_template_id } = req.body;
  const template = PRESET_CHARACTERS.find(c => c.character_id === character_template_id);
  
  if (!template) {
    res.status(400).json({ error: 'Invalid character template' });
    return;
  }

  // 检查是否已被选中
  const alreadyChosen = Object.values(room.characters).some(c => c.character_id === character_template_id);
  if (alreadyChosen) {
    res.status(400).json({ error: 'Character already chosen by another player' });
    return;
  }

  // 在房间中注册该角色
  room.characters[template.character_id] = { ...template };
  
  // 通过 WebSocket 通知房间内的其他人状态更新
  io.to(room.room_id).emit('room_state_sync', room);

  res.json({ success: true, character: template });
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join_room', (roomId: string) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room ${roomId}`);
    
    // 发送当前房间状态给刚加入的玩家
    if (memoryRooms[roomId]) {
      socket.emit('room_state_sync', memoryRooms[roomId]);
    }
  });

  socket.on('player_intention', (intention: PlayerIntention) => {
    console.log('Received intention:', intention);
    
    gameEngine.pushIntention(intention);
    
    // 广播给房间里的所有人 (充当基础聊天功能)
    io.to(intention.room_id).emit('chat_broadcast', intention);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
