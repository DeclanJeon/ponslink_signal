/**
 * TURN 통계 API 라우트
 */
const express = require('express');
const router = express.Router();
const TurnMonitor = require('../services/turnMonitor');
const TurnCredentialsService = require('../services/turnCredentials');

// Redis 클라이언트는 서버에서 주입
let turnMonitor;
let turnCredentials;

const initializeRoutes = (redisClient) => {
  turnMonitor = new TurnMonitor(redisClient);
  turnCredentials = new TurnCredentialsService(redisClient);
  
  /**
   * 방별 TURN 통계 조회
   */
  router.get('/api/turn/stats/room/:roomId', async (req, res) => {
    try {
      const { roomId } = req.params;
      const stats = await turnMonitor.getRoomStats(roomId);
      
      res.json({
        success: true,
        roomId,
        stats,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Failed to get room stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve statistics'
      });
    }
  });
  
  /**
   * 사용자별 TURN 통계 조회
   */
  router.get('/api/turn/stats/user/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const stats = await turnMonitor.getUserStats(userId);
      const quota = await turnCredentials.checkUserQuota(userId);
      
      res.json({
        success: true,
        userId,
        stats,
        quota,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Failed to get user stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve statistics'
      });
    }
  });
  
  /**
   * 실시간 메트릭 조회
   */
  router.get('/api/turn/metrics', async (req, res) => {
    try {
      const metrics = turnMonitor.getRealtimeMetrics();
      
      res.json({
        success: true,
        metrics,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Failed to get metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve metrics'
      });
    }
  });
  
  return router;
};

module.exports = initializeRoutes;