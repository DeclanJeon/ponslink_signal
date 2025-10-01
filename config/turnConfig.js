/**
 * @fileoverview TURN 서버 설정 (Static Auth 버전)
 * @module config/turnConfig
 */
const crypto = require('crypto');

class TurnConfig {
  /**
   * 설정 유효성 검증
   */
  static validate() {
    const required = ['TURN_SERVER_URL', 'TURN_USERNAME', 'TURN_PASSWORD'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error(`치명적 에러: 누락된 TURN 설정: ${missing.join(', ')}`);
      throw new Error(`Missing TURN configuration: ${missing.join(', ')}`);
    }
    
    // Username/Password 길이 검증
    if (process.env.TURN_USERNAME.length < 4) {
      throw new Error('TURN_USERNAME은 최소 4자 이상이어야 합니다.');
    }
    
    if (process.env.TURN_PASSWORD.length < 8) {
      throw new Error('TURN_PASSWORD는 최소 8자 이상이어야 합니다.');
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
      username: process.env.TURN_USERNAME,
      password: process.env.TURN_PASSWORD,
      realm: process.env.TURN_REALM || 'ponslink.com',
      
      // 자격 증명 만료 시간 (Static Auth에서는 사용 안 함)
      sessionTimeout: parseInt(process.env.TURN_SESSION_TIMEOUT || '86400'),
      
      // 보안 및 리소스 제한
      enableQuota: process.env.TURN_ENABLE_QUOTA === 'true',
      enableConnectionLimit: process.env.TURN_ENABLE_CONNECTION_LIMIT === 'true',
      quotaPerDay: parseInt(process.env.TURN_QUOTA_GB || '1') * 1024 * 1024 * 1024,
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
      
      // 성능 관련 설정
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
   * ICE 서버 목록 생성 (Static Auth 버전)
   * @param {string} username - TURN 사용자명 (선택적, 기본값 사용)
   * @param {string} credential - TURN 비밀번호 (선택적, 기본값 사용)
   * @returns {Array} ICE 서버 설정 배열
   */
  static getIceServers(username = null, credential = null) {
    const config = this.getConfig();
    const servers = [];
    
    // 기본 STUN 서버 추가
    servers.push(
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    );
    
    // TURN 서버 자격 증명 (환경 변수 또는 파라미터)
    const turnUsername = username || config.username;
    const turnPassword = credential || config.password;
    
    // TURN 서버 추가
    if (config.serverUrl && turnUsername && turnPassword) {
      // UDP TURN
      if (config.enableUDP) {
        servers.push({
          urls: `turn:${config.serverUrl}:${config.ports.udp}?transport=udp`,
          username: turnUsername,
          credential: turnPassword
        });
      }
      
      // TCP TURN
      if (config.enableTCP) {
        servers.push({
          urls: `turn:${config.serverUrl}:${config.ports.tcp}?transport=tcp`,
          username: turnUsername,
          credential: turnPassword
        });
      }
      
      // TLS TURN (TURNS)
      if (config.enableTLS) {
        servers.push({
          urls: `turns:${config.serverUrl}:${config.ports.tls}?transport=tcp`,
          username: turnUsername,
          credential: turnPassword
        });
      }
    }
    
    return servers;
  }
}

module.exports = TurnConfig;
