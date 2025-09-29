/**
 * TURN 서버 자격증명 제공 핸들러 - PERFORMANCE MODE 🏎️
 * @module handlers/turnHandler
 */
const TurnCredentialsService = require('../services/turnCredentials');
const TurnConfig = require('../config/turnConfig');

module.exports = (io, socket, pubClient) => {
  const turnCredentials = new TurnCredentialsService(pubClient);
  
  /**
   * TURN 자격증명 즉시 제공 - 검증 최소화
   */
  const getTurnCredentials = async () => {
    console.log(`[TURN] ⚡ Fast credentials for ${socket.data.userId}`);
    
    // 🔥 기본 검증만 수행
    if (!socket.data.userId) {
      socket.emit('turn-credentials', { 
        error: 'User ID required',
        code: 'NO_USER_ID'
      });
      return;
    }
    
    try {
      const { userId, roomId } = socket.data;
      
      // 🚀 즉시 자격증명 생성 (제한 없음)
      const credentials = turnCredentials.generateCredentials(
        userId, 
        roomId || 'default'
      );
      
      // ICE 서버 구성
      const iceServers = TurnConfig.getIceServers(
        credentials.username,
        credentials.password
      );
      
      // 🎯 최적화된 응답
      socket.emit('turn-credentials', {
        iceServers,
        ttl: credentials.ttl,
        timestamp: Date.now(),
        performance: {
          unlimited: true,
          maxBandwidth: 'unlimited',
          maxConnections: 'unlimited',
          quota: 'unlimited'
        },
        config: {
          iceTransportPolicy: 'all',        // 모든 후보 사용
          bundlePolicy: 'max-bundle',       // 최대 번들링
          rtcpMuxPolicy: 'require',         // RTCP 멀티플렉싱
          iceCandidatePoolSize: 10          // ICE 후보 풀 크기
        }
      });
      
      console.log(`[TURN] ✅ Unlimited credentials issued to ${userId}`);
      
    } catch (error) {
      console.error('[TURN] Failed to generate credentials:', error);
      
      // 에러 시에도 기본 STUN 서버 제공
      socket.emit('turn-credentials', {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ],
        fallback: true
      });
    }
  };
  
  /**
   * 사용량 보고 - 무시 (성능 최적화)
   */
  const reportUsage = async (data) => {
    // 🔥 메트릭 수집 스킵 (성능 우선)
    return;
  };
  
  /**
   * 연결 상태 보고 - 최소 로깅만
   */
  const reportConnectionState = async (data) => {
    const { state, candidateType } = data;
    
    if (state === 'connected') {
      console.log(`[TURN] ✅ ${socket.data.userId} connected via ${candidateType}`);
    }
    // 실패는 무시 (성능 우선)
  };
  
  // 이벤트 리스너 등록
  socket.on('request-turn-credentials', getTurnCredentials);
  socket.on('report-turn-usage', reportUsage);
  socket.on('report-connection-state', reportConnectionState);
};