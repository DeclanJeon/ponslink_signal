Copy/**
 * TURN 서버 설정 관리 - UNLIMITED POWER! ⚡
 * @module config/turnConfig
 */
const crypto = require('crypto');

class TurnConfig {
  static #instance = null;
  static #config = null;
  
  /**
   * 환경변수 검증 - 최소한의 검증만
   */
  static validate() {
    const required = ['TURN_SERVER_URL', 'TURN_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing TURN configuration: ${missing.join(', ')}`);
    }
    
    // Secret 자동 생성 (없을 경우)
    if (!process.env.TURN_SECRET || process.env.TURN_SECRET.length < 32) {
      process.env.TURN_SECRET = crypto.randomBytes(64).toString('base64'); // 더 강력한 키
      console.log('🔐 Generated TURN_SECRET:', process.env.TURN_SECRET);
    }
    
    console.log('✅ TURN configuration validated - UNLIMITED MODE');
    return true;
  }
  
  /**
   * TURN 설정 반환 - 모든 제한 해제
   */
  static getConfig() {
    return {
      serverUrl: process.env.TURN_SERVER_URL,
      secret: process.env.TURN_SECRET,
      realm: process.env.TURN_REALM || 'ponslink.com',
      
      // 🔥 성능 제한 완전 해제
      maxBandwidth: Infinity,              // 무제한 대역폭
      sessionTimeout: 604800,              // 7일 (최대값)
      enableMetrics: false,                // 메트릭 비활성화 (성능 향상)
      maxConnectionsPerUser: Infinity,     // 무제한 연결
      quotaPerDay: Infinity,               // 무제한 일일 할당량
      
      // 🚀 성능 최적화 설정
      enableTLS: process.env.TURN_ENABLE_TLS === 'true',
      enableTCP: true,
      enableUDP: true,
      
      // 포트 설정
      ports: {
        udp: parseInt(process.env.TURN_PORT_UDP || '3478'),
        tcp: parseInt(process.env.TURN_PORT_TCP || '3478'),
        tls: parseInt(process.env.TURN_PORT_TLS || '5349')
      },
      
      // 🎯 고급 성능 설정
      performance: {
        maxPacketSize: 65535,             // 최대 패킷 크기
        channelLifetime: 600,             // 채널 수명 (10분)
        permissionLifetime: 300,          // 권한 수명 (5분)
        maxAllocations: 100000,           // 최대 할당 수
        minPort: 49152,                   // 최소 포트 범위
        maxPort: 65535,                   // 최대 포트 범위
        threadPoolSize: 16,               // 스레드 풀 크기
        bufferSize: 1048576              // 1MB 버퍼
      }
    };
  }
  
  /**
   * ICE 서버 목록 생성 - 최대 성능 구성
   */
  static getIceServers(username, credential) {
    const config = this.getConfig();
    const servers = [];
    
    // 🌟 구글 STUN 서버 전체 활용
    servers.push(
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    );
    
    // 🔥 TURN 서버 - 모든 프로토콜 활성화
    if (config.serverUrl && username && credential) {
      // UDP TURN
      servers.push({
        urls: `turn:${config.serverUrl}:${config.ports.udp}?transport=udp`,
        username: username,
        credential: credential
      });
      
      // TCP TURN
      servers.push({
        urls: `turn:${config.serverUrl}:${config.ports.tcp}?transport=tcp`,
        username: username,
        credential: credential
      });
      
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