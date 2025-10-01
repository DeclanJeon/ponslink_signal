/**
 * @fileoverview TURN 자격 증명 서비스 (보안 강화 버전)
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
   * HMAC 기반 자격 증명 생성
   */
  generateCredentials(userId, roomId) {
    // TTL 단축 (7일 → 1일)
    const ttl = this.config.sessionTimeout; // 86400초 (1일)
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    
    // Username 형식: timestamp:userId:roomId
    const username = `${timestamp}:${userId}:${roomId}`;
    
    // HMAC-SHA256 암호화
    const hmac = crypto.createHmac('sha256', this.config.secret);
    hmac.update(username);
    const password = hmac.digest('base64');
    
    // 생성된 자격 증명 캐싱 (선택적)
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
   * 사용자 일일 Quota 확인
   */
  async checkUserQuota(userId) {
    // Quota 기능 비활성화 시 무제한 반환
    if (!this.config.enableQuota) {
      return {
        used: 0,
        limit: Infinity,
        remaining: Infinity,
        percentage: 0,
        unlimited: true
      };
    }

    const dateKey = new Date().toISOString().split('T')[0];
    const quotaKey = `turn:quota:${userId}:${dateKey}`;
    
    try {
      const usedBytes = await this.redis.get(quotaKey);
      const used = usedBytes ? parseInt(usedBytes, 10) : 0;
      const limit = this.config.quotaPerDay;
      const remaining = Math.max(0, limit - used);
      const percentage = limit > 0 ? (used / limit) * 100 : 0;

      return {
        used,
        limit,
        remaining,
        percentage: Math.round(percentage),
        unlimited: false
      };
    } catch (error) {
      console.error('[TurnCredentials] Quota 확인 실패:', error);
      // Redis 에러 시 안전하게 무제한으로 처리
      return { used: 0, limit: Infinity, remaining: Infinity, percentage: 0, unlimited: true };
    }
  }
  
  /**
   * 사용자 동시 접속 수 제한 확인
   */
  async checkConnectionLimit(userId) {
    // 연결 제한 기능 비활성화 시 무제한 반환
    if (!this.config.enableConnectionLimit) {
      return {
        allowed: true,
        current: 0,
        limit: Infinity,
        unlimited: true
      };
    }

    const connectionKey = `turn:connections:${userId}`;
    
    try {
      const currentConnections = await this.redis.get(connectionKey);
      const current = currentConnections ? parseInt(currentConnections, 10) : 0;
      const limit = this.config.maxConnectionsPerUser;

      return {
        allowed: current < limit,
        current,
        limit,
        unlimited: false
      };
    } catch (error) {
      console.error('[TurnCredentials] 연결 제한 확인 실패:', error);
      return { allowed: true, current: 0, limit: Infinity, unlimited: true };
    }
  }
  
  /**
   * 자격 증명 유효성 검증 (coturn에서 사용)
   */
  validateCredentials(username, password) {
    try {
      const parts = username.split(':');
      if (parts.length < 3) return false;
      
      const timestamp = parseInt(parts[0], 10);
      const now = Math.floor(Date.now() / 1000);
      
      // 만료 시간 확인
      if (timestamp < now) {
        return false;
      }
      
      // HMAC 검증 (SHA256)
      const hmac = crypto.createHmac('sha256', this.config.secret);
      hmac.update(username);
      const expectedPassword = hmac.digest('base64');
      
      // 타이밍 공격 방지를 위해 timingSafeEqual 사용
      return crypto.timingSafeEqual(
        Buffer.from(password),
        Buffer.from(expectedPassword)
      );
    } catch (error) {
      console.error('[TurnCredentials] 자격 증명 검증 오류:', error);
      return false;
    }
  }

  /**
   * TURN 서버 사용량 기록
   */
  async recordUsage(userId, bytesUsed) {
    if (!this.config.enableQuota) return;

    const dateKey = new Date().toISOString().split('T')[0];
    const quotaKey = `turn:quota:${userId}:${dateKey}`;
    
    try {
      // 원자적 증가
      const newTotal = await this.redis.incrBy(quotaKey, bytesUsed);
      
      // TTL 설정 (2일)
      await this.redis.expire(quotaKey, 86400 * 2);

      return newTotal;
    } catch (error) {
      console.error('[TurnCredentials] 사용량 기록 실패:', error);
    }
  }

  /**
   * 연결 수 업데이트
   */
  async updateConnectionCount(userId, increment = true) {
    if (!this.config.enableConnectionLimit) return;
    
    const connectionKey = `turn:connections:${userId}`;
    
    try {
      if (increment) {
        await this.redis.incr(connectionKey);
      } else {
        await this.redis.decr(connectionKey);
      }
    } catch (error) {
      console.error('[TurnCredentials] 연결 수 업데이트 실패:', error);
    }
  }
}

module.exports = TurnCredentialsService;
