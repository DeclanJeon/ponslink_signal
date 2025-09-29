/**
 * TURN 서버 자격증명 제공 핸들러
 * HMAC 기반 동적 자격증명 생성
 */
const TurnCredentialsService = require('../services/turnCredentials');
const TurnMonitor = require('../services/turnMonitor');
const TurnConfig = require('../config/turnConfig');

module.exports = (io, socket, pubClient) => {
  const turnCredentials = new TurnCredentialsService(pubClient);
  const turnMonitor = new TurnMonitor(pubClient);
  
  const getTurnCredentials = async () => {
    console.log(`[TURN] Credentials requested by ${socket.data.userId}`);
    
    // 사용자 인증 확인
    if (!socket.data.userId || !socket.data.roomId) {
      console.warn('[TURN] Unauthorized request from', socket.id);
      socket.emit('turn-credentials', { 
        error: 'Unauthorized',
        code: 'AUTH_REQUIRED'
      });
      return;
    }
    
    try {
      const { userId, roomId } = socket.data;
      
      // 연결 수 제한 확인
      const connectionLimit = await turnCredentials.checkConnectionLimit(userId);
      if (!connectionLimit.allowed) {
        console.warn(`[TURN] Connection limit exceeded for ${userId}`);
        socket.emit('turn-credentials', {
          error: 'Connection limit exceeded',
          code: 'LIMIT_EXCEEDED',
          limit: connectionLimit.limit,
          current: connectionLimit.current
        });
        return;
      }
      
      // 사용량 할당량 확인
      const quota = await turnCredentials.checkUserQuota(userId);
      if (quota.remaining <= 0) {
        console.warn(`[TURN] Quota exceeded for ${userId}`);
        socket.emit('turn-credentials', {
          error: 'Daily quota exceeded',
          code: 'QUOTA_EXCEEDED',
          quota: {
            used: quota.used,
            limit: quota.limit,
            resetAt: new Date().setHours(24, 0, 0, 0)
          }
        });
        return;
      }
      
      // HMAC 자격증명 생성
      const credentials = turnCredentials.generateCredentials(userId, roomId);
      
      // ICE 서버 구성
      const iceServers = TurnConfig.getIceServers(
        credentials.username,
        credentials.password
      );
      
      // 연결 추적
      await turnMonitor.trackConnection(userId, roomId, 'requested');
      
      console.log(`[TURN] Credentials generated for ${userId}`);
      console.log(`[TURN] - Username: ${credentials.username}`);
      console.log(`[TURN] - TTL: ${credentials.ttl}s`);
      console.log(`[TURN] - Quota: ${(quota.remaining / 1024 / 1024 / 1024).toFixed(2)}GB remaining`);
      
      // 클라이언트에 전송
      socket.emit('turn-credentials', {
        iceServers,
        ttl: credentials.ttl,
        timestamp: Date.now(),
        quota: {
          used: quota.used,
          limit: quota.limit,
          remaining: quota.remaining,
          percentage: quota.percentage
        },
        stats: {
          connectionCount: connectionLimit.current,
          connectionLimit: connectionLimit.limit
        }
      });
      
      // 감사 로깅
      logTurnAccess(userId, roomId, 'granted');
      
    } catch (error) {
      console.error('[TURN] Failed to generate credentials:', error);
      
      // 실패 추적
      await turnMonitor.trackFailure(
        socket.data.userId,
        socket.data.roomId,
        error.message
      );
      
      socket.emit('turn-credentials', {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  };
  
  /**
   * TURN 사용량 보고
   */
  const reportUsage = async (data) => {
    const { userId, roomId } = socket.data;
    const { bytes, direction, connectionType } = data;
    
    if (!userId || !bytes) return;
    
    try {
      // 대역폭 추적
      await turnMonitor.trackBandwidth(userId, bytes, direction);
      
      // 연결 타입 추적
      if (connectionType) {
        await turnMonitor.trackConnection(userId, roomId, connectionType);
      }
      
      console.log(`[TURN] Usage reported: ${userId} - ${bytes} bytes (${direction})`);
    } catch (error) {
      console.error('[TURN] Failed to report usage:', error);
    }
  };
  
  /**
   * 연결 상태 보고
   */
  const reportConnectionState = async (data) => {
    const { userId, roomId } = socket.data;
    const { state, candidateType } = data;
    
    if (!userId) return;
    
    try {
      if (state === 'connected' && candidateType) {
        await turnMonitor.trackConnection(userId, roomId, candidateType);
        console.log(`[TURN] Connection established: ${userId} via ${candidateType}`);
      } else if (state === 'failed') {
        await turnMonitor.trackFailure(userId, roomId, 'connection_failed');
        console.log(`[TURN] Connection failed: ${userId}`);
      }
    } catch (error) {
      console.error('[TURN] Failed to report connection state:', error);
    }
  };
  
  /**
   * TURN 접근 로깅 (감사용)
   */
  const logTurnAccess = (userId, roomId, status) => {
    const accessLog = {
      userId,
      roomId,
      status,
      timestamp: new Date().toISOString(),
      ip: socket.handshake.address,
      socketId: socket.id
    };
    console.log('[TURN_AUDIT]', JSON.stringify(accessLog));
  };
  
  // 이벤트 리스너 등록
  socket.on('request-turn-credentials', getTurnCredentials);
  socket.on('report-turn-usage', reportUsage);
  socket.on('report-connection-state', reportConnectionState);
  
  // 연결 해제 시 정리
  socket.on('disconnect', async () => {
    if (socket.data.userId) {
      const key = `turn:connections:${socket.data.userId}`;
      try {
        await pubClient.decr(key);
        console.log(`[TURN] Connection count decreased for ${socket.data.userId}`);
      } catch (error) {
        console.error('[TURN] Failed to decrease connection count:', error);
      }
    }
  });
};