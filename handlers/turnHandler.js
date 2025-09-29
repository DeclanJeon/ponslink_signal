/**
 * TURN 서버 자격증명 제공 핸들러
 * 정적 username/password 방식
 */
module.exports = (io, socket) => {
    const getTurnCredentials = async () => {
      // 환경변수에서 TURN 설정 읽기
      const turnUsername = process.env.TURN_USERNAME;
      const turnPassword = process.env.TURN_PASSWORD;
      const turnServerUrl = process.env.TURN_SERVER_URL;
      
      if (!turnUsername || !turnPassword || !turnServerUrl) {
        console.error('[TURN] TURN 서버 설정이 없습니다');
        socket.emit('turn-credentials', { 
          error: 'TURN server not configured' 
        });
        return;
      }
      
      // 사용자 인증 확인 (옵션)
      if (!socket.data.userId || !socket.data.roomId) {
        console.warn('[TURN] 인증되지 않은 사용자의 TURN 요청');
        socket.emit('turn-credentials', { 
          error: 'Unauthorized' 
        });
        return;
      }
      
      // ICE 서버 구성
      const iceServers = [
        // STUN 서버들 (공개)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        
        // TURN 서버 (TCP/UDP)
        {
          urls: `turn:${turnServerUrl}:3478?transport=udp`,
          username: turnUsername,
          credential: turnPassword,
        },
        {
          urls: `turn:${turnServerUrl}:3478?transport=tcp`,
          username: turnUsername,
          credential: turnPassword,
        },
        
        // TURNS (TLS) - 포트 5349 사용
        {
          urls: `turns:${turnServerUrl}:5349?transport=tcp`,
          username: turnUsername,
          credential: turnPassword,
        }
      ];
      
      console.log(`[TURN] ${socket.data.userId}에게 TURN 자격증명 제공`);
      
      // 클라이언트에 전송
      socket.emit('turn-credentials', { 
        iceServers,
        timestamp: Date.now()
      });
      
      // 로깅 (보안 감사용)
      logTurnAccess(socket.data.userId, socket.data.roomId);
    };
    
    // TURN 접근 로깅 (옵션)
    const logTurnAccess = (userId, roomId) => {
      const accessLog = {
        userId,
        roomId,
        timestamp: new Date().toISOString(),
        ip: socket.handshake.address
      };
      console.log('[TURN_AUDIT]', JSON.stringify(accessLog));
    };
    
    // 이벤트 리스너 등록
    socket.on('request-turn-credentials', getTurnCredentials);
  };
  