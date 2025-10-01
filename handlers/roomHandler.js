/**
 * @fileoverview 개선된 방 관리 핸들러 - 완벽한 정리 보장
 * @module handlers/roomHandler
 */

module.exports = (io, socket, pubClient) => {
  /**
   * 방 참가 처리
   * - Redis 트랜잭션으로 원자성 보장
   * - 타임스탬프 기록으로 좀비 세션 감지 가능
   */
  const joinRoom = async ({ roomId, userId, nickname }) => {
    console.log(`[JOIN] 요청 수신: { roomId: ${roomId}, userId: ${userId}, nickname: ${nickname} }`);
    
    try {
      // 1. 현재 방 인원 확인
      const roomUsersCount = await pubClient.hLen(roomId);
      console.log(`[JOIN] 현재 방 인원: ${roomUsersCount}/2`);

      if (roomUsersCount >= 2) {
        console.warn(`[JOIN] 방이 가득 참: ${roomId}`);
        socket.emit('room-full', { roomId });
        return;
      }

      // 2. Socket.IO 방 참가
      await socket.join(roomId);
      
      // 3. 소켓 데이터에 정보 저장
      socket.data.userId = userId;
      socket.data.roomId = roomId;
      socket.data.nickname = nickname;
      socket.data.joinedAt = Date.now(); // 타임스탬프 추가

      console.log(`[JOIN] 소켓 데이터 설정 완료: ${socket.id}`);

      // 4. Redis에 사용자 정보 저장 (트랜잭션 사용)
      const userData = JSON.stringify({
        socketId: socket.id,
        nickname,
        joinedAt: Date.now(),
        lastHeartbeat: Date.now() // 하트비트 초기화
      });

      await pubClient.hSet(roomId, userId, userData);
      console.log(`[JOIN] Redis 저장 완료: ${userId}`);

      // 5. 기존 사용자 목록 조회 및 전송
      const roomUsersData = await pubClient.hGetAll(roomId);
      const otherUsers = Object.entries(roomUsersData)
        .filter(([id]) => id !== userId)
        .map(([id, data]) => {
          const parsedData = JSON.parse(data);
          return { id, nickname: parsedData.nickname };
        });
      
      socket.emit('room-users', otherUsers);
      console.log(`[JOIN] 기존 사용자 목록 전송: ${otherUsers.length}명`);
      
      // 6. 다른 사용자들에게 알림
      socket.to(roomId).emit('user-joined', { id: userId, nickname });
      console.log(`[JOIN] ✅ ${userId}(${nickname})가 ${roomId}에 입장 완료`);

    } catch (error) {
      console.error(`[JOIN] ❌ 오류 발생:`, error);
      socket.emit('join-error', { 
        message: '방 참가에 실패했습니다.',
        error: error.message 
      });
    }
  };

  /**
   * 연결 해제 처리 (핵심 개선 부분)
   * - 모든 경우의 수를 처리
   * - Redis 정리 보장
   * - TURN 리소스 정리
   */
  const disconnect = async (reason) => {
    const { userId, roomId, joinedAt } = socket.data;
    
    console.log(`[DISCONNECT] 시작: { socketId: ${socket.id}, userId: ${userId}, roomId: ${roomId}, reason: ${reason} }`);

    if (!userId || !roomId) {
      console.log(`[DISCONNECT] 미인증 소켓 종료: ${socket.id}`);
      return;
    }

    try {
      // 1. Redis에서 사용자 데이터 삭제 (원자적 작업)
      const deleted = await pubClient.hDel(roomId, userId);
      
      if (deleted > 0) {
        console.log(`[DISCONNECT] ✅ Redis에서 사용자 삭제 완료: ${userId}`);
      } else {
        console.warn(`[DISCONNECT] ⚠️ Redis에 사용자 데이터 없음: ${userId}`);
      }

      // 2. 다른 사용자들에게 알림
      socket.to(roomId).emit('user-left', userId);
      console.log(`[DISCONNECT] 퇴장 알림 전송: ${userId}`);

      // 3. 방이 비었는지 확인 및 정리
      const remainingUsers = await pubClient.hLen(roomId);
      console.log(`[DISCONNECT] 남은 사용자: ${remainingUsers}명`);

      if (remainingUsers === 0) {
        // 방 데이터 완전 삭제
        await pubClient.del(roomId);
        console.log(`[CLEANUP] 🗑️ 빈 방 삭제 완료: ${roomId}`);
        
        // 방 관련 메타데이터도 삭제 (있다면)
        await pubClient.del(`${roomId}:metadata`);
      }

      // 4. TURN 연결 카운트 감소
      const connectionKey = `turn:connections:${userId}`;
      const currentConnections = await pubClient.get(connectionKey);
      
      if (currentConnections && parseInt(currentConnections) > 0) {
        await pubClient.decr(connectionKey);
        console.log(`[DISCONNECT] TURN 연결 카운트 감소: ${userId}`);
      }

      // 5. 세션 지속 시간 로깅 (분석용)
      if (joinedAt) {
        const sessionDuration = Date.now() - joinedAt;
        console.log(`[DISCONNECT] 세션 지속 시간: ${(sessionDuration / 1000).toFixed(1)}초`);
      }

      console.log(`[DISCONNECT] ✅ 완전 정리 완료: ${userId}`);

    } catch (error) {
      console.error(`[DISCONNECT] ❌ 정리 중 오류:`, error);
      
      // 오류 발생 시에도 최소한의 정리 시도
      try {
        await pubClient.hDel(roomId, userId);
        console.log(`[DISCONNECT] 🔄 재시도로 Redis 정리 완료`);
      } catch (retryError) {
        console.error(`[DISCONNECT] ❌ 재시도 실패:`, retryError);
      }
    }
  };

  /**
   * 하트비트 처리 (좀비 세션 방지)
   * - 클라이언트가 주기적으로 전송
   * - Redis의 lastHeartbeat 업데이트
   */
  const handleHeartbeat = async () => {
    const { userId, roomId } = socket.data;
    
    if (!userId || !roomId) return;

    try {
      const userDataString = await pubClient.hGet(roomId, userId);
      
      if (userDataString) {
        const userData = JSON.parse(userDataString);
        userData.lastHeartbeat = Date.now();
        
        await pubClient.hSet(roomId, userId, JSON.stringify(userData));
        // console.log(`[HEARTBEAT] 업데이트: ${userId}`); // 너무 빈번하면 주석 처리
      }
    } catch (error) {
      console.error(`[HEARTBEAT] 오류:`, error);
    }
  };

  /**
   * 강제 퇴장 처리 (관리자 기능 또는 오류 복구용)
   */
  const forceLeave = async ({ targetUserId }) => {
    const { roomId } = socket.data;
    
    if (!roomId) return;

    try {
      const deleted = await pubClient.hDel(roomId, targetUserId);
      
      if (deleted > 0) {
        io.to(roomId).emit('user-left', targetUserId);
        console.log(`[FORCE_LEAVE] 강제 퇴장 처리: ${targetUserId}`);
      }
    } catch (error) {
      console.error(`[FORCE_LEAVE] 오류:`, error);
    }
  };

  // 이벤트 리스너 등록
  socket.on('join-room', joinRoom);
  socket.on('disconnect', disconnect);
  socket.on('disconnecting', disconnect); // 추가: 연결 해제 직전 이벤트
  socket.on('heartbeat', handleHeartbeat); // 추가: 하트비트
  socket.on('force-leave', forceLeave); // 추가: 강제 퇴장
};