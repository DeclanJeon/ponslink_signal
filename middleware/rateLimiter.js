/**
 * @fileoverview Redis 기반 분산 Rate Limiting 미들웨어
 * @module middleware/rateLimiter
 */

const { RateLimiterRedis } = require('rate-limiter-flexible');
const { createClient } = require('redis');

let redisClient;
let rateLimiter;
let ipRateLimiter;

/**
 * Redis 클라이언트 초기화
 */
const initializeRedis = () => {
  if (redisClient) return;

  redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    enable_offline_queue: false // 연결 실패 시 즉시 에러 반환
  });

  redisClient.on('error', (err) => {
    console.error('[RateLimiter] Redis 연결 에러:', err);
    // Redis 연결 실패 시 Rate Limiting 비활성화 (Fail-open)
    rateLimiter = null;
    ipRateLimiter = null;
  });

  redisClient.connect().catch(console.error);

  // 사용자 ID 기반 Rate Limiter (1분당 30회)
  rateLimiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'rate_limit_user',
    points: 30,
    duration: 60,
    blockDuration: 60 * 5 // 5분간 차단
  });

  // IP 주소 기반 Rate Limiter (1분당 100회)
  ipRateLimiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'rate_limit_ip',
    points: 100,
    duration: 60,
    blockDuration: 60 * 10 // 10분간 차단
  });
};

/**
 * Socket.IO Rate Limiting 미들웨어
 */
const socketRateLimiterMiddleware = async (socket, next) => {
  // Rate Limiter가 초기화되지 않은 경우 통과 (Fail-open)
  if (!rateLimiter || !ipRateLimiter) {
    return next();
  }

  const userId = socket.data.userId || socket.id;
  const ip = socket.handshake.address;

  try {
    // 1. IP 주소 기반 검사
    await ipRateLimiter.consume(ip);

    // 2. 사용자 ID 기반 검사
    await rateLimiter.consume(userId);

    next();
  } catch (rejRes) {
    if (rejRes instanceof Error) {
      // Redis 에러 등 내부 문제
      console.error('[RateLimiter] 내부 에러:', rejRes);
      return next(); // Fail-open
    }

    // Rate Limit 초과
    const isIpLimit = rejRes.keyPrefix.includes('ip');
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

    // 연결을 끊지 않고 에러만 전달
    // next(new Error('Rate limit exceeded'));
  }
};

/**
 * Express Rate Limiting 미들웨어 (API용)
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
      return next(); // Fail-open
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
