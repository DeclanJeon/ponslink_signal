/**
 * @fileoverview TURN 자격 증명 서비스 (Static Auth 버전)
 * @module services/turnCredentials
 */
const TurnConfig = require('../config/turnConfig');

class TurnCredentialsService {
  constructor(redisClient) {
    this.redis = redisClient;
    this.config = TurnConfig.getConfig();
  }
  
  /**
   * Static 자격 증명 반환
   * @param {string} userId - 사용자 ID (로깅용)
   * @param {string} roomId - 방 ID (로깅용)
   * @returns {Object} TURN 자격 증명
   */
  generateCredentials(userId, roomId) {
    // Static Auth: 환경 변수에서 직접 가져옴
    const username = this.config.username;
    const password = this.config.password;
    
    // 로깅용 메타데이터
    const timestamp = Math.floor(Date.now() / 1000);
    
    console.log(`[TurnCredentials] Static credentials issued for ${userId} in room ${roomId}`);
    
    return {
      username,
      password,
      ttl: this.config.sessionTimeout, // 참고용 (실제로는 무제한)
      timestamp,
      realm: this.config.realm,
      authType: 'static' // 인증 타입 표시
    };
  }
  
  /**
   * 사용자 일일 Quota 확인
   */
  async checkUserQuota(userId) {
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
      return { used: 0, limit: Infinity, remaining: Infinity, percentage: 0, unlimited: true };
    }
  }
  
  /**
   * 사용자 동시 접속 수 제한 확인
   */
  async checkConnectionLimit(userId) {
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
   * 자격 증명 유효성 검증 (Static Auth에서는 단순 비교)
   * @param {string} username - 제공된 사용자명
   * @param {string} password - 제공된 비밀번호
   * @returns {boolean} 유효성 여부
   */
  validateCredentials(username, password) {
    try {
      // 단순 문자열 비교 (타이밍 공격 방지)
      const isUsernameValid = username === this.config.username;
      const isPasswordValid = password === this.config.password;
      
      return isUsernameValid && isPasswordValid;
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
      const newTotal = await this.redis.incrBy(quotaKey, bytesUsed);
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
