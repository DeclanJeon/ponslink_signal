/**
 * TURN 서버 모니터링 서비스
 * 연결 상태, 사용량, 성능 추적
 */
class TurnMonitor {
    constructor(redisClient) {
      this.redis = redisClient;
      this.metrics = new Map();
      this.startTime = Date.now();
    }
    
    /**
     * 연결 추적
     */
    async trackConnection(userId, roomId, connectionType) {
      const timestamp = Date.now();
      
      // 방별 통계
      const roomKey = `turn:stats:room:${roomId}`;
      await this.redis.hIncrBy(roomKey, connectionType, 1);
      await this.redis.expire(roomKey, 86400); // 24시간 후 삭제
      
      // 사용자별 통계
      const userKey = `turn:stats:user:${userId}`;
      await this.redis.hSet(userKey, 'lastAccess', timestamp);
      await this.redis.hSet(userKey, 'lastRoom', roomId);
      await this.redis.hIncrBy(userKey, `${connectionType}Count`, 1);
      await this.redis.expire(userKey, 86400);
      
      // 메모리 메트릭
      this.metrics.set(`${userId}:${roomId}`, {
        connectionType,
        timestamp,
        roomId,
        userId
      });
      
      // 전체 통계
      await this.updateGlobalStats(connectionType);
      
      console.log(`[TurnMonitor] Connection tracked: ${userId} in ${roomId} via ${connectionType}`);
    }
    
    /**
     * 대역폭 사용량 추적
     */
    async trackBandwidth(userId, bytes, direction = 'both') {
      const dateKey = new Date().toISOString().split('T')[0];
      const quotaKey = `turn:quota:${userId}:${dateKey}`;
      
      try {
        await this.redis.incrBy(quotaKey, bytes);
        await this.redis.expire(quotaKey, 86400 * 2); // 2일 후 삭제
        
        // 방향별 통계
        if (direction === 'upload' || direction === 'both') {
          await this.redis.incrBy(`turn:bandwidth:upload:${dateKey}`, bytes);
        }
        if (direction === 'download' || direction === 'both') {
          await this.redis.incrBy(`turn:bandwidth:download:${dateKey}`, bytes);
        }
      } catch (error) {
        console.error('[TurnMonitor] Failed to track bandwidth:', error);
      }
    }
    
    /**
     * 연결 실패 추적
     */
    async trackFailure(userId, roomId, reason) {
      const key = `turn:failures:${new Date().toISOString().split('T')[0]}`;
      
      const failureData = {
        userId,
        roomId,
        reason,
        timestamp: Date.now()
      };
      
      try {
        await this.redis.lPush(key, JSON.stringify(failureData));
        await this.redis.lTrim(key, 0, 999); // 최근 1000개만 유지
        await this.redis.expire(key, 86400 * 7); // 7일 후 삭제
        
        // 실패 카운트 증가
        await this.redis.hIncrBy('turn:stats:global', 'failureCount', 1);
      } catch (error) {
        console.error('[TurnMonitor] Failed to track failure:', error);
      }
    }
    
    /**
     * 방별 통계 조회
     */
    async getRoomStats(roomId) {
      const key = `turn:stats:room:${roomId}`;
      
      try {
        const stats = await this.redis.hGetAll(key);
        return {
          relay: parseInt(stats.relay || '0'),
          direct: parseInt(stats.direct || '0'),
          srflx: parseInt(stats.srflx || '0'),
          host: parseInt(stats.host || '0'),
          failed: parseInt(stats.failed || '0'),
          total: Object.values(stats).reduce((sum, val) => sum + parseInt(val || '0'), 0)
        };
      } catch (error) {
        console.error('[TurnMonitor] Failed to get room stats:', error);
        return { relay: 0, direct: 0, srflx: 0, host: 0, failed: 0, total: 0 };
      }
    }
    
    /**
     * 사용자별 통계 조회
     */
    async getUserStats(userId) {
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
            limit: 10737418240, // 10GB
            percentage: (parseInt(quotaUsed) / 10737418240) * 100
          }
        };
      } catch (error) {
        console.error('[TurnMonitor] Failed to get user stats:', error);
        return null;
      }
    }
    
    /**
     * 전체 통계 업데이트
     */
    async updateGlobalStats(type) {
      const key = 'turn:stats:global';
      
      try {
        await this.redis.hIncrBy(key, `${type}Count`, 1);
        await this.redis.hIncrBy(key, 'totalConnections', 1);
        await this.redis.hSet(key, 'lastUpdate', Date.now());
      } catch (error) {
        console.error('[TurnMonitor] Failed to update global stats:', error);
      }
    }
    
    /**
     * 실시간 메트릭 조회
     */
    getRealtimeMetrics() {
      const now = Date.now();
      const activeConnections = Array.from(this.metrics.values()).filter(
        m => now - m.timestamp < 300000 // 5분 이내
      );
      
      return {
        activeConnections: activeConnections.length,
        connectionTypes: activeConnections.reduce((acc, m) => {
          acc[m.connectionType] = (acc[m.connectionType] || 0) + 1;
          return acc;
        }, {}),
        uptime: now - this.startTime,
        memoryUsage: process.memoryUsage()
      };
    }
    
    /**
     * 정리 작업
     */
    async cleanup() {
      // 오래된 메트릭 제거
      const now = Date.now();
      for (const [key, value] of this.metrics.entries()) {
        if (now - value.timestamp > 3600000) { // 1시간 이상
          this.metrics.delete(key);
        }
      }
    }
  }
  
  module.exports = TurnMonitor;