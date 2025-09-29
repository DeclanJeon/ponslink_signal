/**
 * TURN 서버 모니터링 서비스 (개선 버전)
 * @module services/turnMonitor
 */
const TurnConfig = require('../config/turnConfig');

class TurnMonitor {
  constructor(redisClient) {
    this.redis = redisClient;
    this.config = TurnConfig.getConfig(); // 설정 활용
    this.metrics = new Map();
    this.startTime = Date.now();
    
    // 메트릭 수집 활성화 여부 체크
    if (!this.config.enableMetrics) {
      console.warn('[TurnMonitor] Metrics collection disabled');
    }
  }
  
  /**
   * 사용자별 통계 조회 (개선)
   * @param {string} userId 
   * @returns {Object}
   */
  async getUserStats(userId) {
    if (!this.config.enableMetrics) return null;
    
    const userKey = `turn:stats:user:${userId}`;
    const dateKey = new Date().toISOString().split('T')[0];
    const quotaKey = `turn:quota:${userId}:${dateKey}`;
    
    try {
      const stats = await this.redis.hGetAll(userKey);
      const quotaUsed = await this.redis.get(quotaKey) || '0';
      
      return {
        lastAccess: parseInt(stats.lastAccess || '0'),
        lastRoom: stats.lastRoom || null,
        connections: {
          relay: parseInt(stats.relayCount || '0'),
          direct: parseInt(stats.directCount || '0'),
          failed: parseInt(stats.failedCount || '0')
        },
        bandwidth: {
          used: parseInt(quotaUsed),
          limit: this.config.quotaPerDay, // ✅ config 활용!
          percentage: (parseInt(quotaUsed) / this.config.quotaPerDay) * 100,
          maxBandwidth: this.config.maxBandwidth // ✅ 추가 정보
        }
      };
    } catch (error) {
      console.error('[TurnMonitor] Failed to get user stats:', error);
      return null;
    }
  }
  
  /**
   * 대역폭 제한 체크
   * @param {string} userId
   * @param {number} currentBandwidth 
   * @returns {boolean}
   */
  async checkBandwidthLimit(userId, currentBandwidth) {
    if (!this.config.maxBandwidth) return true;
    
    if (currentBandwidth > this.config.maxBandwidth) {
      console.warn(`[TurnMonitor] Bandwidth limit exceeded for ${userId}: ${currentBandwidth} > ${this.config.maxBandwidth}`);
      await this.trackFailure(userId, null, 'bandwidth_exceeded');
      return false;
    }
    return true;
  }
}

module.exports = TurnMonitor;