module.exports = (io, socket, pubClient) => {
  const handleMessage = async (payload) => {
    const { type, to, data } = payload;
    const { userId, roomId } = socket.data;

    console.log(`[DEBUG] 📥 'message' 이벤트 수신: { type: '${type}', from: '${userId}', to: '${to || '모두'}' }`);

    if (!roomId) {
      console.warn(`[WARN] ⚠️ 방(${roomId}) 정보가 없는 사용자(${userId})로부터 메시지 수신. 무시합니다.`);
      return;
    }

    try {
      let targetSocketId = null;
      if (to) {
        const userDataString = await pubClient.hGet(roomId, to);
        if (userDataString) {
          targetSocketId = JSON.parse(userDataString).socketId;
          console.log(`[DEBUG] 🧐 수신자(${to})의 소켓 ID 조회 성공: ${targetSocketId}`);
        } else {
          console.warn(`[WARN] ❓ 수신자(${to})를 방(${roomId})에서 찾을 수 없음.`);
        }
      }

      switch (type) {
        case 'signal':
          if (targetSocketId) {
            console.log(`[DEBUG] 📡 [signal] 메시지를 ${userId}에서 ${to}(${targetSocketId})로 릴레이합니다.`);
            io.to(targetSocketId).emit('message', { type: 'signal', from: userId, data });
          }
          break;

        case 'media-state-update':
          console.log(`[DEBUG] 📡 [media-state-update] 메시지를 방(${roomId})의 모든 피어에게 브로드캐스트합니다.`);
          socket.to(roomId).emit('message', { type: 'peer-state-updated', from: userId, data });
          break;

        case 'chat':
          console.log(`[DEBUG] 📡 [chat] 폴백 메시지를 방(${roomId})의 모든 피어에게 브로드캐스트합니다.`);
          io.to(roomId).emit('message', { type: 'chat', from: userId, data });
          console.log(`[CHAT FALLBACK] 사용자 ${userId}가 방 ${roomId}로 메시지를 보냈습니다.`);
          break;

        case 'file-meta':
        case 'file-accept':
        case 'file-decline':
        case 'file-cancel':
        case 'file-chunk':
          if (targetSocketId) {
            console.log(`[DEBUG] 📡 [${type}] 메시지를 ${userId}에서 ${to}(${targetSocketId})로 릴레이합니다.`);
            io.to(targetSocketId).emit('message', { type, from: userId, data });
          }
          break;
          
        default:
          console.warn(`[WARN] ❓ 알 수 없는 메시지 타입 수신: ${type}`);
          break;
      }
    } catch (error) {
      console.error(`[ERROR] ❌ 'message' 타입 "${type}" 처리 중 심각한 오류 발생:`, error);
    }
  };

  socket.on('message', handleMessage);
};