require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

// 설정 모듈
const TurnConfig = require('./config/turnConfig');

// 핸들러 모듈
const registerRoomHandlers = require('./handlers/roomHandler');
const registerMessageHandlers = require('./handlers/messageHandler');
const registerTurnHandlers = require('./handlers/turnHandler');

// 미들웨어
const turnAuthMiddleware = require('./middleware/turnAuth');

// 라우트
const initializeTurnStatsRoutes = require('./routes/turnStats');

// 서비스
const TurnMonitor = require('./services/turnMonitor');

// --- 환경 변수 유효성 검사 ---
if (!process.env.CORS_ALLOWED_ORIGINS) {
  console.error("오류: .env 파일에 CORS_ALLOWED_ORIGINS가 정의되지 않았습니다.");
  process.exit(1);
}
if (!process.env.PORT) {
  console.error("오류: .env 파일에 PORT가 정의되지 않았습니다.");
  process.exit(1);
}

// TURN 설정 검증
try {
  TurnConfig.validate();
} catch (error) {
  console.error("오류: TURN 설정 검증 실패:", error.message);
  console.warn("⚠️ TURN 서버 없이 계속 진행합니다. P2P 연결만 가능합니다.");
}

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ALLOWED_ORIGINS.split(','),
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100 MB
});

const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

// TURN 모니터링 서비스 초기화
let turnMonitor;

async function startServer() {
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  
  // TURN 모니터링 초기화
  turnMonitor = new TurnMonitor(pubClient);
  
  // API 라우트 등록
  const turnStatsRouter = initializeTurnStatsRoutes(pubClient);
  app.use(turnStatsRouter);
  
  // 헬스체크 엔드포인트
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: Date.now(),
      turn: {
        configured: !!process.env.TURN_SERVER_URL,
        monitoring: true
      }
    });
  });
  
  // Socket.IO 연결 핸들러
  const onConnection = (socket) => {
    console.log(`[CONNECT] 사용자 연결됨: ${socket.id}`);
    
    // TURN 인증 미들웨어 적용
    turnAuthMiddleware(socket, () => {});
    
    // 각 핸들러 모듈에 필요한 의존성 주입
    registerRoomHandlers(io, socket, pubClient);
    registerMessageHandlers(io, socket, pubClient);
    registerTurnHandlers(io, socket, pubClient);
  };

  io.on('connection', onConnection);

  // TURN 설정 상태 출력
  const turnConfig = TurnConfig.getConfig();
  console.log('============================================');
  console.log('🔐 TURN Server Configuration:');
  console.log(`   - Server: ${turnConfig.serverUrl || 'Not configured'}`);
  console.log(`   - Realm: ${turnConfig.realm}`);
  console.log(`   - Session Timeout: ${turnConfig.sessionTimeout}s`);
  console.log(`   - Max Connections/User: ${turnConfig.maxConnectionsPerUser}`);
  console.log(`   - Daily Quota: ${(turnConfig.quotaPerDay / 1024 / 1024 / 1024).toFixed(2)}GB`);
  console.log(`   - Monitoring: ${turnConfig.enableMetrics ? 'Enabled' : 'Disabled'}`);
  console.log('============================================');

  const PORT = process.env.PORT;
  server.listen(PORT, () => {
    console.log(`✅ 시그널링 서버가 포트 ${PORT}에서 실행 중입니다.`);
  });
  
  // 정리 작업 스케줄러 (1시간마다)
  setInterval(async () => {
    if (turnMonitor) {
      await turnMonitor.cleanup();
      console.log('[Cleanup] TURN 모니터링 데이터 정리 완료');
    }
  }, 3600000);
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM 신호 수신. 서버를 정상 종료합니다...');
  
  io.close();
  await pubClient.quit();
  await subClient.quit();
  server.close();
  
  process.exit(0);
});

startServer().catch(err => {
  console.error("서버 시작 실패:", err);
  process.exit(1);
});