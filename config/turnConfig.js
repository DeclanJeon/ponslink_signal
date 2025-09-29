/**
 * TURN 서버 설정 관리
 * HMAC 기반 보안 자격증명 구성
 */
const crypto = require('crypto');

class TurnConfig {
  /**
   * 환경변수 검증
   */
  static validate() {
    const required = [
      'TURN_SERVER_URL',
      'TURN_SECRET'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing TURN configuration: ${missing.join(', ')}`);
    }
    
    // Secret 길이 검증 (최소 32자)
    if (!process.env.TURN_SECRET || process.env.TURN_SECRET.length < 32) {
      console.warn('⚠️ TURN_SECRET is too short or missing. Generating new one...');
      process.env.TURN_SECRET = crypto.randomBytes(32).toString('base64');
      console.log('📝 Generated TURN_SECRET:', process.env.TURN_SECRET);
      console.log('⚠️ Please save this secret in your .env file!');
    }
    
    // TURN 서버 URL 형식 검증
    const urlPattern = /^([a-zA-Z0-9.-]+\.)+[a-zA-Z]{2,}$/;
    if (!urlPattern.test(process.env.TURN_SERVER_URL)) {
      console.warn('⚠️ TURN_SERVER_URL format may be invalid:', process.env.TURN_SERVER_URL);
    }
    
    console.log('✅ TURN configuration validated successfully');
    return true;
  }
  
  /**
   * TURN 설정 반환
   */
  static getConfig() {
    return {
      serverUrl: process.env.TURN_SERVER_URL,
      secret: process.env.TURN_SECRET,
      realm: process.env.TURN_REALM || 'ponslink.com',
      maxBandwidth: parseInt(process.env.TURN_MAX_BANDWIDTH || '10485760'), // 10MB/s
      sessionTimeout: parseInt(process.env.TURN_SESSION_TIMEOUT || '86400'), // 24시간
      enableMetrics: process.env.TURN_ENABLE_METRICS === 'true',
      maxConnectionsPerUser: parseInt(process.env.TURN_MAX_CONNECTIONS || '10'),
      quotaPerDay: parseInt(process.env.TURN_QUOTA_PER_DAY || '10737418240') // 10GB
    };
  }
  
  /**
   * ICE 서버 목록 생성
   */
  static getIceServers(username, credential) {
    const config = this.getConfig();
    const servers = [];
    
    // STUN 서버
    servers.push(
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    );
    
    // TURN 서버
    if (config.serverUrl && username && credential) {
      servers.push(
        {
          urls: `turn:${config.serverUrl}:3478?transport=udp`,
          username: username,
          credential: credential,
          credentialType: 'password'
        },
        {
          urls: `turn:${config.serverUrl}:3478?transport=tcp`,
          username: username,
          credential: credential,
          credentialType: 'password'
        }
      );
      
      // TURNS (TLS)
      if (process.env.TURN_ENABLE_TLS === 'true') {
        servers.push({
          urls: `turns:${config.serverUrl}:5349?transport=tcp`,
          username: username,
          credential: credential,
          credentialType: 'password'
        });
      }
    }
    
    return servers;
  }
}

module.exports = TurnConfig;