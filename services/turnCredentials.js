/**
 * TURN 자격증명 생성 서비스
 * HMAC-SHA1 기반 임시 자격증명 생성
 */
const crypto = require('crypto');
const TurnConfig = require('../config/turnConfig');

class TurnCredentialsService {
  constructor(redisClient) {
    this.redis = redisClient;
    this.config = TurnConfig.getConfig();
  }
  
  /**
   * HMAC 기반 임시 자격증명 생성
   * @param {string} userId - 사용자 ID
   * @param {string} roomId - 방 ID
   * @returns {Object} TURN 자격증명
   */
  generateCredentials(userId, roomId) {
    // TTL 설정 (기본 24시간)
    const ttl = this.config.sessionTimeout || 86400;
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    
    // Username 형식: timestamp:userId:roomId
    const username = `${timestamp}:${userId}:${roomId}`;
    
    // HMAC-SHA1으로 패스워드 생성
    const hmac = crypto.createHmac('sha1', this.config.secret);
    hmac.update(username);
    const password = hmac.digest('base64');
    
    // 자격증명 캐싱
    this.cacheCredentials(userId, roomId, username, timestamp);
    
    return {
      username,
      password,
      ttl,
      timestamp,
      realm: this.config.realm
    };
  }
  
  /**
   * 자격증명 캐싱 (모니터링용)
   */
  async cacheCredentials(userId, roomId, username, expiry) {
    const key = `turn:creds:${userId}`;
    const data = {
      roomId,
      username,
      expiry,
      createdAt: Date.now()
    };
    
    try {
      await this.redis.setEx(key, this.config.sessionTimeout, JSON.stringify(data));
    } catch (error) {
      console.error('[TurnCredentials] Failed to cache credentials:', error);
    }
  }
  
  /**
   * 사용자 할당량 확인
   */
  async checkUserQuota(userId) {
    const quotaKey = `turn:quota:${userId}:${new Date().toISOString().split('T')[0]}`;
    
    try {
      const used = await this.redis.get(quotaKey) || '0';
      const usedBytes = parseInt(used);
      
      return {
        used: usedBytes,
        limit: this.config.quotaPerDay,
        remaining: Math.max(0, this.config.quotaPerDay - usedBytes),
        percentage: (usedBytes / this.config.quotaPerDay) * 100
      };
    } catch (error) {
      console.error('[TurnCredentials] Failed to check quota:', error);
      return {
        used: 0,
        limit: this.config.quotaPerDay,
        remaining: this.config.quotaPerDay,
        percentage: 0
      };
    }
  }
  
  /**
   * 자격증명 검증
   */
  validateCredentials(username, password) {
    try {
      // Username 파싱
      const parts = username.split(':');
      if (parts.length < 3) return false;
      
      const timestamp = parseInt(parts[0]);
      const now = Math.floor(Date.now() / 1000);
      
      // 만료 확인
      if (timestamp < now) {
        console.log('[TurnCredentials] Credentials expired');
        return false;
      }
      
      // HMAC 재생성하여 비교
      const hmac = crypto.createHmac('sha1', this.config.secret);
      hmac.update(username);
      const expectedPassword = hmac.digest('base64');
      
      return password === expectedPassword;
    } catch (error) {
      console.error('[TurnCredentials] Validation error:', error);
      return false;
    }
  }
  
  /**
   * 연결 수 제한 확인
   */
  async checkConnectionLimit(userId) {
    const key = `turn:connections:${userId}`;
    
    try {
      const count = await this.redis.get(key) || '0';
      const currentCount = parseInt(count);
      
      if (currentCount >= this.config.maxConnectionsPerUser) {
        return {
          allowed: false,
          current: currentCount,
          limit: this.config.maxConnectionsPerUser
        };
      }
      
      // 연결 수 증가
      await this.redis.incr(key);
      await this.redis.expire(key, 3600); // 1시간 후 자동 삭제
      
      return {
        allowed: true,
        current: currentCount + 1,
        limit: this.config.maxConnectionsPerUser
      };
    } catch (error) {
      console.error('[TurnCredentials] Failed to check connection limit:', error);
      return { allowed: true, current: 0, limit: this.config.maxConnectionsPerUser };
    }
  }
}

module.exports = TurnCredentialsService;