module.exports = (io, socket, pubClient) => {
  const joinRoom = async ({ roomId, userId, nickname }) => {
    console.log(`[DEBUG] 📥 'join-room' 이벤트 수신: { roomId: ${roomId}, userId: ${userId}, nickname: ${nickname} }`);
    try {
      const roomUsersCount = await pubClient.hLen(roomId);
      console.log(`[DEBUG] 🧐 Redis에서 방(${roomId}) 인원 확인: ${roomUsersCount}명`);

      if (roomUsersCount >= 2) {
        console.warn(`[WARN] 🚫 방(${roomId})이 꽉 참. 사용자(${userId}) 입장 거부.`);
        socket.emit('room-full');
        return;
      }

      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.nickname = nickname;
      console.log(`[DEBUG] 🔗 사용자(${userId})의 소켓(${socket.id})이 방(${roomId})에 성공적으로 연결되었습니다.`);
      console.log(`[DEBUG] ✅ 소켓(${socket.id})을 방(${roomId})에 조인시키고 데이터 저장 완료.`);

      await pubClient.hSet(roomId, userId, JSON.stringify({ socketId: socket.id, nickname }));
      console.log(`[DEBUG] 💾 Redis에 사용자(${userId}) 정보 저장 완료.`);

      const roomUsersData = await pubClient.hGetAll(roomId);
      const otherUsers = Object.entries(roomUsersData)
        .filter(([id, _]) => id !== userId)
        .map(([id, data]) => {
          const parsedData = JSON.parse(data);
          return { id, nickname: parsedData.nickname };
        });
      
      console.log(`[DEBUG] 📤 사용자(${userId})에게 'room-users' 이벤트 전송:`, otherUsers);
      socket.emit('room-users', otherUsers);
      
      console.log(`[DEBUG] 📡 방(${roomId})의 다른 사용자에게 'user-joined' 이벤트 브로드캐스트.`);
      socket.to(roomId).emit('user-joined', { id: userId, nickname });

      console.log(`[JOIN] ✅ 사용자 ${userId} (${nickname})가 방 ${roomId}에 참여 완료.`);
    } catch (error) {
      console.error(`[ERROR] ❌ 'join-room' 처리 중 심각한 오류 발생:`, error);
    }
  };

  const disconnect = async () => {
    const { userId, roomId } = socket.data;
    console.log(`[DEBUG] 🔌 'disconnect' 이벤트 수신: { socketId: ${socket.id}, userId: ${userId}, roomId: ${roomId} }`);

    if (userId && roomId) {
      try {
        await pubClient.hDel(roomId, userId);
        console.log(`[DEBUG] 💾 Redis에서 사용자(${userId}) 정보 삭제 완료.`);

        socket.to(roomId).emit('user-left', userId);
        console.log(`[DEBUG] 📡 방(${roomId})의 다른 사용자에게 'user-left' 이벤트 브로드캐스트.`);
        console.log(`[DISCONNECT] 🚶 사용자 ${userId}가 방 ${roomId}를 정상적으로 떠났습니다.`);

        const remainingUsers = await pubClient.hLen(roomId);
        console.log(`[DEBUG] 🧐 방(${roomId})에 남은 인원 확인: ${remainingUsers}명`);
        if (remainingUsers === 0) {
          await pubClient.del(roomId);
          console.log(`[CLEANUP] 🧹 방(${roomId})이 비어 삭제되었습니다.`);
        }
      } catch (error) {
        console.error(`[ERROR] ❌ 'disconnect' 처리 중 심각한 오류 발생:`, error);
      }
    } else {
      console.log(`[DISCONNECT] 🔌 사용자(${socket.id}) 연결 끊김 (방 참여 전).`);
    }
  };

  socket.on('join-room', joinRoom);
  socket.on('disconnect', disconnect);
};