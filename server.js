require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

// <<< [수정] 핸들러 모듈 import
const registerRoomHandlers = require('./handlers/roomHandler');
const registerMessageHandlers = require('./handlers/messageHandler');

// --- 환경 변수 유효성 검사 ---
if (!process.env.CORS_ALLOWED_ORIGINS) {
  console.error("오류: .env 파일에 CORS_ALLOWED_ORIGINS가 정의되지 않았습니다.");
  process.exit(1);
}
if (!process.env.PORT) {
  console.error("오류: .env 파일에 PORT가 정의되지 않았습니다.");
  process.exit(1);
}
// --- 환경 변수 유효성 검사 종료 ---

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ALLOWED_ORIGINS.split(','),
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100 MB
});

const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

function validateTurnConfig() {
  const required = ['TURN_SERVER_URL', 'TURN_USERNAME', 'TURN_PASSWORD'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn(`⚠️ TURN 설정 누락: ${missing.join(', ')}`);
    console.warn('⚠️ NAT 환경에서 연결 문제가 발생할 수 있습니다.');
    return false;
  }
  
  console.log('✅ TURN 서버 설정 완료');
  console.log(`   - Server: ${process.env.TURN_SERVER_URL}`);
  console.log(`   - Username: ${process.env.TURN_USERNAME.substring(0, 3)}***`);
  return true;
}

async function startServer() {
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));

  // <<< [수정] connection 이벤트 로직을 핸들러 등록으로 변경
  const onConnection = (socket) => {
    console.log(`[CONNECT] 사용자 연결됨: ${socket.id}`);
    
    // 각 핸들러 모듈에 필요한 의존성(io, socket, pubClient) 주입
    registerRoomHandlers(io, socket, pubClient);
    registerMessageHandlers(io, socket, pubClient);
  };

  io.on('connection', onConnection);

  validateTurnConfig();

  const PORT = process.env.PORT;
  server.listen(PORT, () => {
    console.log(`시그널링 서버가 포트 ${PORT}에서 실행 중입니다.`);
  });
}

startServer().catch(err => {
  console.error("서버 시작 실패:", err);
  process.exit(1);
});
