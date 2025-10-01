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

// ✅ 수정: Helmet CSP 설정 (개발/프로덕션 환경 분리)
const isDevelopment = process.env.NODE_ENV !== 'production';

// --- 보안 미들웨어 ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: [
        "'self'",
        // 프로덕션 도메인
        "https://ponslink.online",
        "wss://ponslink.online",
        // 개발 환경 허용
        ...(isDevelopment ? [
          "ws://localhost:*",
          "http://localhost:*",
          "ws://127.0.0.1:*",
          "http://127.0.0.1:*"
        ] : [])
      ],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"], // ✅ blob: 추가
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],

      // ✅ 추가: media-src 디렉티브 명시
      mediaSrc: ["'self'", "blob:", "data:"],

      upgradeInsecureRequests: isDevelopment ? [] : null // 개발 환경에서는 비활성화
    }
  },
  crossOriginEmbedderPolicy: false // SharedArrayBuffer 사용 시 필요
}));

app.use(cors({
  origin: process.env.CORS_ALLOWED_ORIGINS.split(','),
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());
app.use(expressRateLimiterMiddleware);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ALLOWED_ORIGINS.split(','),
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8
});

// --- Redis 설정 ---
initializeRedis(); // Rate Limiter용 Redis 클라이언트 초기화

// ✅ 수정: Redis 클라이언트를 별도로 생성 (Adapter용)
const pubClient = createClient({ 
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 500)
  }
});
const subClient = pubClient.duplicate();

// ✅ 추가: Redis 에러 핸들러
pubClient.on('error', (err) => console.error('[Redis Pub] 에러:', err));
subClient.on('error', (err) => console.error('[Redis Sub] 에러:', err));

// ✅ 추가: Graceful Shutdown 플래그
let isShuttingDown = false;

async function startServer() {
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  
  // 좀비 세션 정리 스케줄러 시작
  const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5분
  const cleanupTimer = setInterval(() => {
    if (!isShuttingDown) { // ✅ Shutdown 중에는 실행 안 함
      cleanupZombieSessions(pubClient, io);
    }
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

    // ✅ 수정: Redis 클라이언트 상태 체크 추가
    if (!pubClient.isOpen) {
      console.error('[CONNECT] Redis 연결이 끊어져 있습니다.');
      socket.emit('error', { message: '서버 연결 오류' });
      socket.disconnect(true);
      return;
    }

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

  // ✅ 추가: Cleanup Timer 반환 (Shutdown 시 정리용)
  return cleanupTimer;
}

// --- ✅ 개선된 Graceful Shutdown ---
const shutdown = async (signal, cleanupTimer) => {
  if (isShuttingDown) return; // 중복 호출 방지
  isShuttingDown = true;
  
  console.log(`${signal} 수신. 서버를 종료합니다...`);
  
  // 1. 새 연결 차단
  io.close();
  
  // 2. Cleanup Timer 정리
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  
  // 3. 모든 소켓 강제 종료 (Redis 사용 전에)
  const sockets = await io.fetchSockets();
  console.log(`[SHUTDOWN] ${sockets.length}개의 활성 소켓 종료 중...`);
  
  sockets.forEach(socket => {
    socket.disconnect(true);
  });
  
  // 4. Redis 연결 종료
  try {
    await pubClient.quit();
    await subClient.quit();
    console.log('[SHUTDOWN] Redis 클라이언트 종료 완료');
  } catch (error) {
    console.error('[SHUTDOWN] Redis 클라이언트 종료 중 에러:', error);
  }
  
  // 5. HTTP 서버 종료
  server.close(() => {
    console.log('[SHUTDOWN] 모든 연결이 종료되었습니다.');
    process.exit(0);
  });

  // 강제 종료 타이머
  setTimeout(() => {
    console.error('[SHUTDOWN] 강제 종료: 연결이 제 시간에 닫히지 않았습니다.');
    process.exit(1);
  }, 10000);
};

async function cleanupZombieSessions(pubClient, io) {
  // ✅ 추가: Shutdown 중이거나 Redis 연결이 끊어졌으면 스킵
  if (isShuttingDown || !pubClient.isOpen) {
    console.log('[CLEANUP] 스킵: 서버 종료 중 또는 Redis 연결 끊김');
    return;
  }

  console.log('[CLEANUP] 좀비 세션 검사 시작...');
  
  const HEARTBEAT_TIMEOUT = 2 * 60 * 1000; // 2분
  const now = Date.now();
  let cleanedCount = 0;

  try {
    const roomKeys = await pubClient.keys('*');
    
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
          
          if (now - lastHeartbeat > HEARTBEAT_TIMEOUT) {
            console.log(`[CLEANUP] 좀비 세션 발견: ${userId} (마지막 하트비트: ${new Date(lastHeartbeat).toISOString()})`);
            
            await pubClient.hDel(roomId, userId);
            
            const socketId = userData.socketId;
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.disconnect(true);
            }
            
            io.to(roomId).emit('user-left', userId);
            
            cleanedCount++;
          }
        } catch (parseError) {
          console.error(`[CLEANUP] 파싱 오류: ${userId}`, parseError);
        }
      }
      
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

let cleanupTimer;

startServer()
  .then(timer => {
    cleanupTimer = timer;
  })
  .catch(err => {
    console.error("서버 시작 중 치명적 에러 발생:", err);
    process.exit(1);
  });

// ✅ 수정: Shutdown 핸들러에 cleanupTimer 전달
process.on('SIGTERM', () => shutdown('SIGTERM', cleanupTimer));
process.on('SIGINT', () => shutdown('SIGINT', cleanupTimer));
