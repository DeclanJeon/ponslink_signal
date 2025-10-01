require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

// 보안 및 설정
const TurnConfig = require('./config/turnConfig');
const { initializeRedis, socketRateLimiterMiddleware, expressRateLimiterMiddleware } = require('./middleware/rateLimiter');

// 핸들러
const registerRoomHandlers = require('./handlers/roomHandler');
const registerMessageHandlers = require('./handlers/messageHandler');
const registerTurnHandlers = require('./handlers/turnHandler');

// 라우트
const initializeTurnStatsRoutes = require('./routes/turnStats');

// --- 서버 시작 전 유효성 검사 ---
try {
  TurnConfig.validate();
} catch (error) {
  console.error('서버 시작 실패: 설정 오류', error.message);
  process.exit(1);
}

if (!process.env.CORS_ALLOWED_ORIGINS) {
  console.error("치명적 에러: .env 파일에 CORS_ALLOWED_ORIGINS를 설정해주세요.");
  process.exit(1);
}
if (!process.env.PORT) {
  console.error("치명적 에러: .env 파일에 PORT를 설정해주세요.");
  process.exit(1);
}

const app = express();

// --- 보안 미들웨어 ---
app.use(helmet()); // 기본 보안 헤더 설정
app.use(cors({
  origin: process.env.CORS_ALLOWED_ORIGINS.split(','),
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());
app.use(expressRateLimiterMiddleware); // API Rate Limiting

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ALLOWED_ORIGINS.split(','),
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100 MB
});

// --- Redis 설정 ---
initializeRedis(); // Rate Limiter용 Redis 클라이언트 초기화
const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

async function startServer() {
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  
  // 좀비 세션 정리 스케줄러 시작
  const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5분
  setInterval(() => {
    cleanupZombieSessions(pubClient, io);
  }, CLEANUP_INTERVAL);
  
  console.log(`[SCHEDULER] 좀비 세션 정리 스케줄러 시작 (${CLEANUP_INTERVAL / 1000}초 간격)`);
  
  // API 라우트
  const turnStatsRouter = initializeTurnStatsRoutes(pubClient);
  app.use(turnStatsRouter);

  // Socket.IO 미들웨어
  io.use(socketRateLimiterMiddleware);
  
  // Socket.IO 연결 핸들러
  const onConnection = (socket) => {
    console.log(`[CONNECT] 클라이언트 연결: ${socket.id}`);

    // 핸들러 등록
    registerRoomHandlers(io, socket, pubClient);
    registerMessageHandlers(io, socket, pubClient);
    registerTurnHandlers(io, socket, pubClient);
  };

  io.on('connection', onConnection);

  // --- 서버 설정 로깅 ---
  const turnConfig = TurnConfig.getConfig();
  console.log('============================================');
  console.log('✅ TURN 서버 설정:');
  console.log(`   - 서버 URL: ${turnConfig.serverUrl}`);
  console.log(`   - Realm: ${turnConfig.realm}`);
  console.log(`   - 세션 만료: ${turnConfig.sessionTimeout / 3600} 시간`);
  console.log(`   - Quota 활성화: ${turnConfig.enableQuota}`);
  if (turnConfig.enableQuota) {
    console.log(`   - 일일 Quota: ${(turnConfig.quotaPerDay / 1024 / 1024 / 1024).toFixed(2)}GB`);
  }
  console.log(`   - 연결 제한 활성화: ${turnConfig.enableConnectionLimit}`);
  if (turnConfig.enableConnectionLimit) {
    console.log(`   - 사용자당 최대 연결: ${turnConfig.maxConnectionsPerUser}`);
  }
  console.log('============================================');

  const PORT = process.env.PORT;
  server.listen(PORT, () => {
    console.log(`🚀 서버가 ${PORT} 포트에서 실행 중입니다.`);
  });
}

// --- Graceful Shutdown ---
const shutdown = async (signal) => {
  console.log(`${signal} 수신. 서버를 종료합니다...`);
  
  io.close();
  
  try {
    await pubClient.quit();
    await subClient.quit();
  } catch (error) {
    console.error('Redis 클라이언트 종료 중 에러:', error);
  }
  
  server.close(() => {
    console.log('모든 연결이 종료되었습니다.');
    process.exit(0);
  });

  // 강제 종료 타이머
  setTimeout(() => {
/**
 * @fileoverview 좀비 세션 정리 스케줄러
 * - 5분마다 실행
 * - 하트비트가 2분 이상 없는 세션 제거
 */
async function cleanupZombieSessions(pubClient, io) {
  console.log('[CLEANUP] 좀비 세션 검사 시작...');
  
  const HEARTBEAT_TIMEOUT = 2 * 60 * 1000; // 2분
  const now = Date.now();
  let cleanedCount = 0;

  try {
    // 모든 방 키 조회
    const roomKeys = await pubClient.keys('*');
    
    // 메타데이터 키 제외
    const actualRoomKeys = roomKeys.filter(key => 
      !key.includes(':metadata') && 
      !key.includes(':quota') && 
      !key.includes(':connections') &&
      !key.includes('rate_limit')
    );

    for (const roomId of actualRoomKeys) {
      const usersData = await pubClient.hGetAll(roomId);
      
      for (const [userId, dataString] of Object.entries(usersData)) {
        try {
          const userData = JSON.parse(dataString);
          const lastHeartbeat = userData.lastHeartbeat || userData.joinedAt || 0;
          
          // 하트비트 타임아웃 체크
          if (now - lastHeartbeat > HEARTBEAT_TIMEOUT) {
            console.log(`[CLEANUP] 좀비 세션 발견: ${userId} (마지막 하트비트: ${new Date(lastHeartbeat).toISOString()})`);
            
            // Redis에서 삭제
            await pubClient.hDel(roomId, userId);
            
            // 소켓 강제 종료 (연결되어 있다면)
            const socketId = userData.socketId;
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.disconnect(true);
            }
            
            // 다른 사용자들에게 알림
            io.to(roomId).emit('user-left', userId);
            
            cleanedCount++;
          }
        } catch (parseError) {
          console.error(`[CLEANUP] 파싱 오류: ${userId}`, parseError);
        }
      }
      
      // 방이 비었으면 삭제
      const remainingUsers = await pubClient.hLen(roomId);
      if (remainingUsers === 0) {
        await pubClient.del(roomId);
        console.log(`[CLEANUP] 빈 방 삭제: ${roomId}`);
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[CLEANUP] ✅ ${cleanedCount}개의 좀비 세션 정리 완료`);
    } else {
      console.log(`[CLEANUP] ✅ 정리할 세션 없음`);
    }
    
  } catch (error) {
    console.error('[CLEANUP] ❌ 오류 발생:', error);
  }
}
    console.error('강제 종료: 연결이 제 시간에 닫히지 않았습니다.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer().catch(err => {
  console.error("서버 시작 중 치명적 에러 발생:", err);
  process.exit(1);
});
