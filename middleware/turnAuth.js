/**
 * TURN 자격증명 요청 검증 미들웨어
 */
const turnAuthMiddleware = (socket, next) => {
    socket.use(([event, ...args], next) => {
      if (event === 'request-turn-credentials') {
        // 1. 인증 확인
        if (!socket.data.userId || !socket.data.roomId) {
          console.warn(`[TURN_AUTH] 미인증 요청: ${socket.id}`);
          return next(new Error('Authentication required'));
        }
        
        // 2. Rate Limiting (분당 5회)
        const key = `turn_${socket.data.userId}`;
        const now = Date.now();
        
        if (!socket.turnRequests) {
          socket.turnRequests = new Map();
        }
        
        const lastRequest = socket.turnRequests.get(key);
        if (lastRequest && now - lastRequest < 12000) { // 12초 쿨다운
          console.warn(`[TURN_AUTH] Rate limit: ${socket.data.userId}`);
          return next(new Error('Too many requests'));
        }
        
        socket.turnRequests.set(key, now);
      }
      next();
    });
    next();
  };
  
  module.exports = turnAuthMiddleware;