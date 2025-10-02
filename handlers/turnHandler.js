/**
 * @fileoverview TURN 자격 증명 핸들러 (연결 안정화 버전)
 * @module handlers/turnHandler
 */
const TurnCredentialsService = require('../services/turnCredentials');
const TurnConfig = require('../config/turnConfig');

module.exports = (io, socket, pubClient) => {
  const turnCredentials = new TurnCredentialsService(pubClient);
  
  /**
   * TURN 자격 증명 요청 처리
   */
  const getTurnCredentials = async () => {
    // ✅ 수정: userId가 없어도 일단 자격 증명 발급 (익명 사용자 지원)
    const userId = socket.data.userId || socket.id; // socket.id를 fallback으로 사용
    
    console.log(`[TURN] 자격 증명 요청: userId=${userId}, socketId=${socket.id}`);
    
    try {
      // 1. 사용자 연결 제한 확인
      const connectionLimit = await turnCredentials.checkConnectionLimit(userId);
      if (!connectionLimit.allowed) {
        console.warn(`[TURN] ${userId}의 연결 제한 초과`);
        socket.emit('turn-credentials', {
          error: '최대 연결 수를 초과했습니다.',
          code: 'CONNECTION_LIMIT_EXCEEDED'
        });
        return;
      }

      // 2. 사용자 Quota 확인
      const quota = await turnCredentials.checkUserQuota(userId);
      if (quota.remaining <= 0 && !quota.unlimited) {
        console.warn(`[TURN] ${userId}의 Quota 초과`);
        socket.emit('turn-credentials', {
          error: '일일 사용량을 초과했습니다.',
          code: 'QUOTA_EXCEEDED'
        });
        return;
      }
      
      // 3. 자격 증명 생성
      const credentials = turnCredentials.generateCredentials(
        userId, 
        socket.data.roomId || 'default' // roomId도 fallback 추가
      );
      
      // 4. ICE 서버 목록 생성
      const iceServers = TurnConfig.getIceServers(
        credentials.username,
        credentials.password
      );
      
      // 5. 클라이언트에 전송
      socket.emit('turn-credentials', {
        iceServers,
        ttl: credentials.ttl,
        timestamp: Date.now(),
        quota,
        stats: {
          connectionCount: connectionLimit.current,
          connectionLimit: connectionLimit.limit,
        }
      });
      
      console.log(`[TURN] ✅ ${userId}에게 자격 증명 발급 완료`);
      
      // 연결 수 증가
      await turnCredentials.updateConnectionCount(userId, true);

    } catch (error) {
      console.error('[TURN] 자격 증명 생성 실패:', error);
      
      // 오류 발생 시 최소한의 STUN 서버만 제공
      socket.emit('turn-credentials', {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ],
        fallback: true,
        error: '서버 내부 오류로 TURN 자격 증명을 발급할 수 없습니다.'
      });
    }
  };
  
  /**
   * TURN 서버 사용량 보고
   */
  const reportUsage = async (data) => {
    const userId = socket.data.userId || socket.id;
    const { bytesUsed } = data;

    if (userId && typeof bytesUsed === 'number' && bytesUsed > 0) {
      await turnCredentials.recordUsage(userId, bytesUsed);
    }
  };
  
  /**
   * 클라이언트 연결 해제 시 처리
   */
  const handleDisconnect = async () => {
    const userId = socket.data.userId || socket.id;
    if (userId) {
      await turnCredentials.updateConnectionCount(userId, false);
    }
  };
  
  // 이벤트 리스너 등록
  socket.on('request-turn-credentials', getTurnCredentials);
  socket.on('report-turn-usage', reportUsage);
  socket.on('disconnect', handleDisconnect);
};
