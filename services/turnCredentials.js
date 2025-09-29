/**
 * TURN 자격증명 생성 서비스 - UNLIMITED VERSION 🚀
 * @module services/turnCredentials
 */
const crypto = require('crypto');
const TurnConfig = require('../config/turnConfig');

class TurnCredentialsService {
  constructor(redisClient) {
    this.redis = redisClient;
    this.config = TurnConfig.getConfig();
  }
  
  /**
   * HMAC 기반 임시 자격증명 생성 - 최대 수명
   */
  generateCredentials(userId, roomId) {
    // 🔥 최대 TTL 설정 (7일)
    const ttl = 604800; // 7 days in seconds
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    
    // Username 형식: timestamp:userId:roomId
    const username = `${timestamp}:${userId}:${roomId}`;
    
    // HMAC-SHA256으로 더 강력한 패스워드 생성
    const hmac = crypto.createHmac('sha256', this.config.secret);
    hmac.update(username);
    const password = hmac.digest('base64');
    
    // 자격증명 캐싱 (선택적 - 성능을 위해 스킵 가능)
    // this.cacheCredentials(userId, roomId, username, timestamp);
    
    return {
      username,
      password,
      ttl,
      timestamp,
      realm: this.config.realm
    };
  }
  
  /**
   * 사용자 할당량 확인 - 항상 무제한 반환
   */
  async checkUserQuota(userId) {
    // 🔥 무제한 할당량 반환
    return {
      used: 0,
      limit: Infinity,
      remaining: Infinity,
      percentage: 0,
      unlimited: true // 무제한 플래그
    };
  }
  
  /**
   * 연결 수 제한 확인 - 항상 허용
   */
  async checkConnectionLimit(userId) {
    // 🔥 무제한 연결 허용
    return {
      allowed: true,
      current: 0,
      limit: Infinity,
      unlimited: true
    };
  }
  
  /**
   * 자격증명 검증 - 성능 최적화
   */
  validateCredentials(username, password) {
    try {
      const parts = username.split(':');
      if (parts.length < 3) return false;
      
      const timestamp = parseInt(parts[0]);
      const now = Math.floor(Date.now() / 1000);
      
      // 만료 확인
      if (timestamp < now) {
        return false;
      }
      
      // HMAC 검증 (SHA256)
      const hmac = crypto.createHmac('sha256', this.config.secret);
      hmac.update(username);
      const expectedPassword = hmac.digest('base64');
      
      return crypto.timingSafeEqual(
        Buffer.from(password),
        Buffer.from(expectedPassword)
      );
    } catch (error) {
      console.error('[TurnCredentials] Validation error:', error);
      return false;
    }
  }
}

module.exports = TurnCredentialsService;