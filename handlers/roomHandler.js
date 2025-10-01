/**
 * @fileoverview 개선된 방 관리 핸들러 - Redis 연결 안정성 강화
 * @module handlers/roomHandler
 */

module.exports = (io, socket, pubClient) => {
  /**
   * ✅ 추가: Redis 연결 체크 헬퍼
   */
  const checkRedisConnection = () => {
    if (!pubClient.isOpen) {
      console.error('[Redis] 연결이 끊어져 있습니다.');
      socket.emit('error', { message: '서버 연결 오류' });
      return false;
    }
    return true;
  };

  /**
   * 방 참가 처리
   */
  const joinRoom = async ({ roomId, userId, nickname }) => {
    console.log(`[JOIN] 요청 수신: { roomId: ${roomId}, userId: ${userId}, nickname: ${nickname} }`);
    
    if (!checkRedisConnection()) return;

    try {
      const roomUsersCount = await pubClient.hLen(roomId);
      console.log(`[JOIN] 현재 방 인원: ${roomUsersCount}/2`);

      if (roomUsersCount >= 2) {
        console.warn(`[JOIN] 방이 가득 참: ${roomId}`);
        socket.emit('room-full', { roomId });
        return;
      }

      await socket.join(roomId);
      
      socket.data.userId = userId;
      socket.data.roomId = roomId;
      socket.data.nickname = nickname;
      socket.data.joinedAt = Date.now();

      console.log(`[JOIN] 소켓 데이터 설정 완료: ${socket.id}`);

      const userData = JSON.stringify({
        socketId: socket.id,
        nickname,
        joinedAt: Date.now(),
        lastHeartbeat: Date.now()
      });

      await pubClient.hSet(roomId, userId, userData);
      console.log(`[JOIN] Redis 저장 완료: ${userId}`);

      const roomUsersData = await pubClient.hGetAll(roomId);
      const otherUsers = Object.entries(roomUsersData)
        .filter(([id]) => id !== userId)
        .map(([id, data]) => {
          const parsedData = JSON.parse(data);
          return { id, nickname: parsedData.nickname };
        });
      
      socket.emit('room-users', otherUsers);
      console.log(`[JOIN] 기존 사용자 목록 전송: ${otherUsers.length}명`);
      
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
   * ✅ 개선된 연결 해제 처리
   */
  const disconnect = async (reason) => {
    const { userId, roomId, joinedAt } = socket.data;
    
    // ✅ 추가: 중복 호출 방지
    if (socket.data._disconnecting) {
      console.log(`[DISCONNECT] 중복 호출 방지: ${userId}`);
      return;
    }
    socket.data._disconnecting = true;
    
    console.log(`[DISCONNECT] 시작: { socketId: ${socket.id}, userId: ${userId}, roomId: ${roomId}, reason: ${reason} }`);

    if (!userId || !roomId) {
      console.log(`[DISCONNECT] 미인증 소켓 종료: ${socket.id}`);
      return;
    }

    // ✅ 추가: Redis 연결 체크
    if (!pubClient.isOpen) {
      console.warn(`[DISCONNECT] Redis 연결 끊김. 정리 스킵: ${userId}`);
      return;
    }

    try {
      // 1. Redis에서 사용자 데이터 삭제
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
        await pubClient.del(roomId);
        console.log(`[CLEANUP] 🗑️ 빈 방 삭제 완료: ${roomId}`);
        
        await pubClient.del(`${roomId}:metadata`);
      }

      // 4. TURN 연결 카운트 감소
      const connectionKey = `turn:connections:${userId}`;
      const currentConnections = await pubClient.get(connectionKey);
      
      if (currentConnections && parseInt(currentConnections) > 0) {
        await pubClient.decr(connectionKey);
        console.log(`[DISCONNECT] TURN 연결 카운트 감소: ${userId}`);
      }

      // 5. 세션 지속 시간 로깅
      if (joinedAt) {
        const sessionDuration = Date.now() - joinedAt;
        console.log(`[DISCONNECT] 세션 지속 시간: ${(sessionDuration / 1000).toFixed(1)}초`);
      }

      console.log(`[DISCONNECT] ✅ 완전 정리 완료: ${userId}`);

    } catch (error) {
      console.error(`[DISCONNECT] ❌ 정리 중 오류:`, error);
      
      // ✅ 수정: 재시도 시에도 Redis 연결 체크
      if (pubClient.isOpen) {
        try {
          await pubClient.hDel(roomId, userId);
          console.log(`[DISCONNECT] 🔄 재시도로 Redis 정리 완료`);
        } catch (retryError) {
          console.error(`[DISCONNECT] ❌ 재시도 실패:`, retryError);
        }
      }
    }
  };

  /**
   * 하트비트 처리
   */
  const handleHeartbeat = async () => {
    const { userId, roomId } = socket.data;
    
    if (!userId || !roomId || !checkRedisConnection()) return;

    try {
      const userDataString = await pubClient.hGet(roomId, userId);
      
      if (userDataString) {
        const userData = JSON.parse(userDataString);
        userData.lastHeartbeat = Date.now();
        
        await pubClient.hSet(roomId, userId, JSON.stringify(userData));
      }
    } catch (error) {
      console.error(`[HEARTBEAT] 오류:`, error);
    }
  };

  /**
   * 강제 퇴장 처리
   */
  const forceLeave = async ({ targetUserId }) => {
    const { roomId } = socket.data;
    
    if (!roomId || !checkRedisConnection()) return;

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

  // ✅ 수정: disconnect 이벤트만 등록 (disconnecting 제거)
  socket.on('join-room', joinRoom);
  socket.on('disconnect', disconnect);
  socket.on('heartbeat', handleHeartbeat);
  socket.on('force-leave', forceLeave);
};
