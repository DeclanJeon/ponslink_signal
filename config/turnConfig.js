/**
 * @fileoverview TURN 서버 설정 (보안 강화 버전)
 * @module config/turnConfig
 */
const crypto = require('crypto');

class TurnConfig {
  /**
   * 설정 유효성 검증
   */
  static validate() {
    const required = ['TURN_SERVER_URL', 'TURN_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error(`치명적 에러: 누락된 TURN 설정: ${missing.join(', ')}`);
      throw new Error(`Missing TURN configuration: ${missing.join(', ')}`);
    }
    
    // Secret 길이 검증 (최소 32자)
    if (!process.env.TURN_SECRET || process.env.TURN_SECRET.length < 32) {
      process.env.TURN_SECRET = crypto.randomBytes(64).toString('base64');
      console.warn('주의: TURN_SECRET이 안전하지 않아 새로 생성했습니다. .env 파일에 저장하세요.');
      console.log('Generated TURN_SECRET:', process.env.TURN_SECRET);
    }
    
    console.log('✅ TURN 설정이 유효합니다.');
    return true;
  }
  
  /**
   * TURN 설정 객체 반환
   */
  static getConfig() {
    return {
      serverUrl: process.env.TURN_SERVER_URL,
      secret: process.env.TURN_SECRET,
      realm: process.env.TURN_REALM || 'ponslink.com',
      
      // 자격 증명 만료 시간 (1일)
      sessionTimeout: parseInt(process.env.TURN_SESSION_TIMEOUT || '86400'),
      
      // 보안 및 리소스 제한
      enableQuota: process.env.TURN_ENABLE_QUOTA === 'true',
      enableConnectionLimit: process.env.TURN_ENABLE_CONNECTION_LIMIT === 'true',
      quotaPerDay: parseInt(process.env.TURN_QUOTA_GB || '1') * 1024 * 1024 * 1024, // GB 단위
      maxConnectionsPerUser: parseInt(process.env.TURN_MAX_CONNECTIONS || '5'),
      
      // 모니터링
      enableMetrics: process.env.TURN_ENABLE_METRICS === 'true',
      
      // 프로토콜 설정
      enableTLS: process.env.TURN_ENABLE_TLS === 'true',
      enableTCP: process.env.TURN_ENABLE_TCP !== 'false',
      enableUDP: process.env.TURN_ENABLE_UDP !== 'false',
      
      // 포트 설정
      ports: {
        udp: parseInt(process.env.TURN_PORT_UDP || '3478'),
        tcp: parseInt(process.env.TURN_PORT_TCP || '3478'),
        tls: parseInt(process.env.TURN_PORT_TLS || '5349')
      },
      
      // 성능 관련 설정 (고급)
      performance: {
        maxPacketSize: 65535,
        channelLifetime: 600,
        permissionLifetime: 300,
        minPort: parseInt(process.env.TURN_MIN_PORT || '49152'),
        maxPort: parseInt(process.env.TURN_MAX_PORT || '65535'),
      }
    };
  }
  
  /**
   * ICE 서버 목록 생성
   */
  static getIceServers(username, credential) {
    const config = this.getConfig();
    const servers = [];
    
    // 기본 STUN 서버 추가
    servers.push(
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    );
    
    // TURN 서버 추가
    if (config.serverUrl && username && credential) {
      // UDP TURN
      if (config.enableUDP) {
        servers.push({
          urls: `turn:${config.serverUrl}:${config.ports.udp}?transport=udp`,
          username: username,
          credential: credential
        });
      }
      
      // TCP TURN
      if (config.enableTCP) {
        servers.push({
          urls: `turn:${config.serverUrl}:${config.ports.tcp}?transport=tcp`,
          username: username,
          credential: credential
        });
      }
      
      // TLS TURN (TURNS)
      if (config.enableTLS) {
        servers.push({
          urls: `turns:${config.serverUrl}:${config.ports.tls}?transport=tcp`,
          username: username,
          credential: credential
        });
      }
    }
    
    return servers;
  }
}

module.exports = TurnConfig;
