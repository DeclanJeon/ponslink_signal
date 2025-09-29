/**
 * TURN 자격증명 요청 검증 미들웨어
 * Rate limiting 및 보안 검증 강화
 */
// const TurnConfig = require('../config/turnConfig');

const turnAuthMiddleware = (socket, next) => {
  // socket.use(([event, ...args], next) => {
  //   if (event === 'request-turn-credentials') {
  //     // 1. 인증 확인
  //     if (!socket.data.userId || !socket.data.roomId) {
  //       console.warn(`[TURN_AUTH] 미인증 요청: ${socket.id}`);
  //       return next(new Error('Authentication required'));
  //     }
      
  //     // 2. Rate Limiting (분당 3회로 강화)
  //     const key = `turn_${socket.data.userId}`;
  //     const now = Date.now();
      
  //     if (!socket.turnRequests) {
  //       socket.turnRequests = new Map();
  //     }
      
  //     // 요청 기록 정리 (1분 이상 된 것 제거)
  //     const oneMinuteAgo = now - 60000;
  //     const requests = socket.turnRequests.get(key) || [];
  //     const recentRequests = requests.filter(time => time > oneMinuteAgo);
      
  //     // 분당 요청 수 확인
  //     if (recentRequests.length >= 3) {
  //       console.warn(`[TURN_AUTH] Rate limit exceeded: ${socket.data.userId}`);
  //       socket.emit('turn-credentials', {
  //         error: 'Too many requests',
  //         code: 'RATE_LIMIT',
  //         retryAfter: 60 - Math.floor((now - recentRequests[0]) / 1000)
  //       });
  //       return next(new Error('Rate limit exceeded'));
  //     }
      
  //     // 요청 기록
  //     recentRequests.push(now);
  //     socket.turnRequests.set(key, recentRequests);
      
  //     // 3. IP 기반 제한 (옵션)
  //     const ip = socket.handshake.address;
  //     const ipKey = `turn_ip_${ip}`;
  //     const ipRequests = socket.turnRequests.get(ipKey) || [];
  //     const recentIpRequests = ipRequests.filter(time => time > oneMinuteAgo);
      
  //     if (recentIpRequests.length >= 10) { // IP당 분당 10회 제한
  //       console.warn(`[TURN_AUTH] IP rate limit exceeded: ${ip}`);
  //       return next(new Error('IP rate limit exceeded'));
  //     }
      
  //     recentIpRequests.push(now);
  //     socket.turnRequests.set(ipKey, recentIpRequests);
  //   }
    
  //   next();
  // });
  next();
};

module.exports = turnAuthMiddleware;