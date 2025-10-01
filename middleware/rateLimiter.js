/**
 * @fileoverview Redis 기반 분산 Rate Limiting 미들웨어 (안정성 강화)
 * @module middleware/rateLimiter
 */

const { RateLimiterRedis } = require('rate-limiter-flexible');
const { createClient } = require('redis');

let redisClient;
let rateLimiter;
let ipRateLimiter;

/**
 * ✅ 개선: Redis 클라이언트 초기화 (Lua 스크립트 로딩 포함)
 */
const initializeRedis = async () => {
  if (redisClient) return;

  redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 500)
    }
  });

  redisClient.on('error', (err) => {
    console.error('[RateLimiter] Redis 연결 에러:', err);
    rateLimiter = null;
    ipRateLimiter = null;
  });

  redisClient.on('connect', () => {
    console.log('[RateLimiter] Redis 연결 성공');
  });

  try {
    await redisClient.connect();

    // ✅ 추가: rate-limiter-flexible이 Lua 스크립트를 로딩할 시간 확보
    await new Promise(resolve => setTimeout(resolve, 100));

    // 사용자 ID 기반 Rate Limiter
    rateLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'rate_limit_user',
      points: 30,
      duration: 60,
      blockDuration: 60 * 5,
      insuranceLimiter: null // ✅ 추가: 메모리 백업 비활성화 (선택적)
    });

    // IP 주소 기반 Rate Limiter
    ipRateLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'rate_limit_ip',
      points: 100,
      duration: 60,
      blockDuration: 60 * 10,
      insuranceLimiter: null
    });

    console.log('[RateLimiter] ✅ Rate Limiter 초기화 완료');
  } catch (error) {
    console.error('[RateLimiter] 초기화 실패:', error);
  }
};

/**
 * Socket.IO Rate Limiting 미들웨어
 */
const socketRateLimiterMiddleware = async (socket, next) => {
  if (!rateLimiter || !ipRateLimiter) {
    return next();
  }

  const userId = socket.data.userId || socket.id;
  const ip = socket.handshake.address;

  try {
    await ipRateLimiter.consume(ip);
    await rateLimiter.consume(userId);

    next();
  } catch (rejRes) {
    if (rejRes instanceof Error) {
      console.error('[RateLimiter] 내부 에러:', rejRes);
      return next(); // Fail-open
    }

    const isIpLimit = rejRes.keyPrefix?.includes('ip');
    const key = isIpLimit ? ip : userId;
    const blockDuration = Math.ceil(rejRes.msBeforeNext / 1000);

    console.warn(`[RateLimiter] Rate limit 초과`, {
      key: key,
      isIpLimit: isIpLimit,
      blockDuration: `${blockDuration}s`
    });

    socket.emit('error', {
      type: 'rate_limit',
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
      retryAfter: blockDuration
    });
  }
};

/**
 * Express Rate Limiting 미들웨어
 */
const expressRateLimiterMiddleware = async (req, res, next) => {
  if (!ipRateLimiter) {
    return next();
  }

  const ip = req.ip;

  try {
    await ipRateLimiter.consume(ip);
    next();
  } catch (rejRes) {
    if (rejRes instanceof Error) {
      console.error('[RateLimiter] 내부 에러:', rejRes);
      return next();
    }

    const blockDuration = Math.ceil(rejRes.msBeforeNext / 1000);

    res.status(429).set('Retry-After', String(blockDuration)).json({
      success: false,
      error: 'Too Many Requests',
      message: `요청이 너무 많습니다. ${blockDuration}초 후에 다시 시도해주세요.`
    });
  }
};

module.exports = {
  initializeRedis,
  socketRateLimiterMiddleware,
  expressRateLimiterMiddleware
};