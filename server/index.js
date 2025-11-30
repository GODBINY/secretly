const express = require('express');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();

// SSL 인증서 로드
const options = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

const server = https.createServer(options, app);

// CORS 설정
app.use(cors());
app.use(express.json());

// Socket.io 클라이언트 라이브러리 제공
app.use('/socket.io', express.static(path.join(__dirname, '../node_modules/socket.io/client-dist')));

// Socket.io 설정
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 데이터 저장소 (메모리 기반)
const rooms = new Map(); // roomId -> { name, type, messages, notice, answers, users, liveContent, sections }
const users = new Map(); // socketId -> { nickname, currentRoom, selectedSection }

// 기본 방 생성
const defaultRoomId = 'general';
rooms.set(defaultRoomId, {
  name: '일반',
  type: 'chat', // 'chat' 또는 'live'
  messages: [],
  notice: null,
  answers: [],
  users: new Set(),
  liveContent: new Map(), // live 타입일 때 사용자별 실시간 내용
  sections: new Map() // live 타입일 때 구역 정보 (sectionId -> { name, users, owner })
});

// Socket.io 연결 처리
io.on('connection', (socket) => {
  console.log('새 사용자 연결:', socket.id);

  // 사용자 접속 처리
  socket.on('join', (data) => {
    const { nickname, nicknameType, emoji, color } = data;
    const room = data.roomId || defaultRoomId;

    // 사용자 정보 저장
    users.set(socket.id, {
      nickname: nickname || `사용자${socket.id.substring(0, 6)}`,
      nicknameType: nicknameType || 'text', // 'emoji' 또는 'text'
      emoji: emoji || null,
      color: color || null,
      currentRoom: room
    });

    // 방에 참여
    if (!rooms.has(room)) {
      rooms.set(room, {
        name: room,
        messages: [],
        notice: null,
        answers: [],
        users: new Set()
      });
    }

    rooms.get(room).users.add(socket.id);
    socket.join(room);

    // 방 목록 전송
    socket.emit('rooms', Array.from(rooms.entries()).map(([id, data]) => ({
      id,
      name: data.name,
      type: data.type,
      userCount: data.users.size
    })));

    // 현재 방 정보 전송
    const currentRoom = rooms.get(room);
    socket.emit('roomData', {
      roomId: room,
      name: currentRoom.name,
      type: currentRoom.type,
      messages: currentRoom.messages,
      notice: currentRoom.notice,
      answers: currentRoom.answers,
      liveContent: currentRoom.type === 'live' ? Object.fromEntries(currentRoom.liveContent) : {},
      sections: currentRoom.type === 'live' ? Array.from(currentRoom.sections.entries()).map(([id, section]) => ({
        id,
        name: section.name,
        userCount: section.users.size,
        owner: section.owner
      })) : []
    });

    // 모든 클라이언트에 방 목록 업데이트 (참여자 수 갱신)
    io.emit('rooms', Array.from(rooms.entries()).map(([id, data]) => ({
      id,
      name: data.name,
      type: data.type,
      userCount: data.users.size
    })));

    // 다른 사용자에게 알림
    socket.to(room).emit('userJoined', {
      nickname: users.get(socket.id).nickname,
      userCount: rooms.get(room).users.size
    });
  });

  // 방 생성
  socket.on('createRoom', (data) => {
    const { roomName, roomType } = data;
    const roomId = roomName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        name: roomName,
        type: roomType || 'chat', // 'chat' 또는 'live'
        messages: [],
        notice: null,
        answers: [],
        users: new Set(),
        liveContent: new Map(), // live 타입일 때 사용자별 실시간 내용
        sections: new Map() // live 타입일 때 구역 정보
      });

      // 모든 클라이언트에 방 목록 업데이트
      io.emit('rooms', Array.from(rooms.entries()).map(([id, data]) => ({
        id,
        name: data.name,
        type: data.type,
        userCount: data.users.size
      })));
    }
  });

  // 방 변경
  socket.on('changeRoom', (data) => {
    const { roomId } = data;
    const user = users.get(socket.id);
    
    if (!user) return;

    // 이전 방에서 나가기
    const oldRoom = user.currentRoom;
    if (rooms.has(oldRoom)) {
      rooms.get(oldRoom).users.delete(socket.id);
      socket.leave(oldRoom);
      
      // 모든 클라이언트에 방 목록 업데이트 (참여자 수 갱신)
      io.emit('rooms', Array.from(rooms.entries()).map(([id, data]) => ({
        id,
        name: data.name,
        type: data.type,
        userCount: data.users.size
      })));
      
      socket.to(oldRoom).emit('userLeft', {
        nickname: user.nickname,
        userCount: rooms.get(oldRoom).users.size
      });
    }

    // 새 방에 참여
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        name: roomId,
        type: 'chat',
        messages: [],
        notice: null,
        answers: [],
        users: new Set(),
        liveContent: new Map(),
        sections: new Map()
      });
    }

    rooms.get(roomId).users.add(socket.id);
    user.currentRoom = roomId;
    socket.join(roomId);

    // 모든 클라이언트에 방 목록 업데이트 (참여자 수 갱신)
    io.emit('rooms', Array.from(rooms.entries()).map(([id, data]) => ({
      id,
      name: data.name,
      type: data.type,
      userCount: data.users.size
    })));

    // 새 방 데이터 전송
    const room = rooms.get(roomId);
    socket.emit('roomData', {
      roomId: roomId,
      name: room.name,
      type: room.type,
      messages: room.messages,
      notice: room.notice,
      answers: room.answers,
      liveContent: room.type === 'live' ? Object.fromEntries(room.liveContent) : {},
      sections: room.type === 'live' ? Array.from(room.sections.entries()).map(([id, section]) => ({
        id,
        name: section.name,
        userCount: section.users.size,
        owner: section.owner
      })) : []
    });

    // 다른 사용자에게 알림
    socket.to(roomId).emit('userJoined', {
      nickname: user.nickname,
      userCount: rooms.get(roomId).users.size
    });
  });

  // 메시지 전송
  socket.on('message', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    const message = {
      id: Date.now().toString(),
      nickname: user.nickname,
      nicknameType: user.nicknameType || 'text',
      emoji: user.emoji || null,
      color: user.color || null,
      authorSocketId: socket.id,
      text: data.text,
      timestamp: new Date().toISOString()
    };

    room.messages.push(message);
    
    // 메시지 히스토리 제한 (최근 100개만 유지)
    if (room.messages.length > 100) {
      room.messages.shift();
    }

    io.to(user.currentRoom).emit('message', message);
  });

  // 메시지 삭제
  socket.on('deleteMessage', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    const messageIndex = room.messages.findIndex(m => m.id === data.messageId);
    if (messageIndex === -1) return;

    const message = room.messages[messageIndex];

    // 작성자 확인
    if (message.authorSocketId !== socket.id) return;

    room.messages.splice(messageIndex, 1);

    io.to(user.currentRoom).emit('messageDeleted', { messageId: data.messageId });
  });

  // 전체 메시지 삭제
  socket.on('clearAllMessages', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    room.messages = [];

    io.to(user.currentRoom).emit('allMessagesCleared');
  });

  // 사용자별 구역 자동 생성/가져오기 (live 타입)
  function getOrCreateUserSection(user, room) {
    // 이미 구역이 있으면 반환
    if (user.selectedSection && room.sections.has(user.selectedSection)) {
      return user.selectedSection;
    }

    // 사용자별 구역 ID 생성 (닉네임 기반)
    const sectionId = `user-${user.nickname}`;
    
    // 구역이 없으면 생성
    if (!room.sections.has(sectionId)) {
      room.sections.set(sectionId, {
        name: `${user.nickname}`,
        users: new Set([user.nickname]),
        owner: user.nickname
      });
    } else {
      // 기존 구역에 사용자 추가
      room.sections.get(sectionId).users.add(user.nickname);
    }

    user.selectedSection = sectionId;
    return sectionId;
  }

  // 구역 삭제 (live 타입)
  socket.on('deleteSection', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room || room.type !== 'live') return;

    const { sectionId } = data;
    const section = room.sections.get(sectionId);

    // 구역 소유자만 삭제 가능
    if (!section || section.owner !== user.nickname) return;

    // 구역 삭제
    room.sections.delete(sectionId);
    
    // 해당 구역의 모든 사용자 내용 삭제
    room.liveContent.forEach((content, nickname) => {
      if (content.sectionId === sectionId) {
        room.liveContent.delete(nickname);
      }
    });

    // 모든 클라이언트에 구역 목록 업데이트
    const sectionsList = Array.from(room.sections.entries()).map(([id, sec]) => ({
      id,
      name: sec.name,
      userCount: sec.users.size,
      owner: sec.owner
    }));
    
    io.to(user.currentRoom).emit('sectionsUpdated', sectionsList);
    io.to(user.currentRoom).emit('sectionDeleted', { sectionId });
  });

  // 실시간 공유방 내용 업데이트 (live 타입)
  socket.on('updateLiveContent', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room || room.type !== 'live') return;

    // 사용자 구역 자동 생성/가져오기
    const sectionId = getOrCreateUserSection(user, room);

    // 사용자의 실시간 내용 저장 (구역 정보 포함)
    room.liveContent.set(user.nickname, {
      text: data.text,
      sectionId: sectionId,
      timestamp: new Date().toISOString()
    });

    // 구역 목록 업데이트 (새로 생성된 경우)
    const sectionsList = Array.from(room.sections.entries()).map(([id, section]) => ({
      id,
      name: section.name,
      userCount: section.users.size,
      owner: section.owner
    }));
    
    io.to(user.currentRoom).emit('sectionsUpdated', sectionsList);

    // 모든 클라이언트에 업데이트 전송
    io.to(user.currentRoom).emit('liveContentUpdated', {
      nickname: user.nickname,
      nicknameType: user.nicknameType || 'text',
      emoji: user.emoji || null,
      color: user.color || null,
      text: data.text,
      sectionId: sectionId,
      timestamp: new Date().toISOString()
    });
  });

  // 실시간 공유방 내용 삭제 (live 타입) - 구역은 유지
  socket.on('clearLiveContent', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room || room.type !== 'live') return;

    // 구역이 없으면 생성 (구역은 항상 유지)
    const sectionId = getOrCreateUserSection(user, room);

    // 사용자의 실시간 내용만 삭제 (구역은 유지)
    room.liveContent.set(user.nickname, {
      text: '',
      sectionId: sectionId,
      timestamp: new Date().toISOString()
    });

    // 모든 클라이언트에 업데이트 전송
    io.to(user.currentRoom).emit('liveContentUpdated', {
      nickname: user.nickname,
      nicknameType: user.nicknameType || 'text',
      emoji: user.emoji || null,
      color: user.color || null,
      text: '',
      sectionId: sectionId,
      timestamp: new Date().toISOString()
    });
  });

  // 구역 순서 변경
  socket.on('reorderSections', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room || room.type !== 'live') return;

    const { sectionOrder } = data;
    // 서버에서 구역 순서 저장 (선택사항, 현재는 클라이언트에서만 관리)
    // 필요시 room.sectionOrder = sectionOrder 저장 가능

    // 모든 클라이언트에 순서 업데이트 전송
    io.to(user.currentRoom).emit('sectionsReordered', { sectionOrder });
  });

  // 타이핑 시작
  socket.on('typingStart', () => {
    const user = users.get(socket.id);
    if (!user) return;

    socket.to(user.currentRoom).emit('typing', {
      nickname: user.nickname
    });
  });

  // 타이핑 중지
  socket.on('typingStop', () => {
    const user = users.get(socket.id);
    if (!user) return;

    socket.to(user.currentRoom).emit('typingStop', {
      nickname: user.nickname
    });
  });

  // 공지 등록
  socket.on('setNotice', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    room.notice = {
      id: Date.now().toString(),
      text: data.text,
      author: user.nickname,
      authorNicknameType: user.nicknameType || 'text',
      authorEmoji: user.emoji || null,
      authorColor: user.color || null,
      authorSocketId: socket.id,
      timestamp: new Date().toISOString()
    };
    room.answers = []; // 공지 변경 시 답변 초기화

    io.to(user.currentRoom).emit('notice', room.notice);
  });

  // 공지 수정
  socket.on('updateNotice', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room || !room.notice) return;

    // 작성자 확인
    if (room.notice.authorSocketId !== socket.id) return;

    room.notice.text = data.text;
    room.notice.timestamp = new Date().toISOString();

    io.to(user.currentRoom).emit('notice', room.notice);
  });

  // 공지 삭제
  socket.on('deleteNotice', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room || !room.notice) return;

    // 작성자 확인
    if (room.notice.authorSocketId !== socket.id) return;

    room.notice = null;
    room.answers = [];

    io.to(user.currentRoom).emit('noticeDeleted');
  });

  // 답변 추가 (1인당 1개만 가능)
  socket.on('addAnswer', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room || !room.notice) return;

    // 기존 답변 찾기
    const existingAnswerIndex = room.answers.findIndex(a => a.authorSocketId === socket.id);
    
    if (existingAnswerIndex !== -1) {
      // 기존 답변이 있으면 업데이트
      const existingAnswer = room.answers[existingAnswerIndex];
      existingAnswer.text = data.text;
      existingAnswer.timestamp = new Date().toISOString();
      
      io.to(user.currentRoom).emit('answerUpdated', existingAnswer);
    } else {
      // 새 답변 추가
    const answer = {
      id: Date.now().toString(),
      nickname: user.nickname,
      nicknameType: user.nicknameType || 'text',
      emoji: user.emoji || null,
      color: user.color || null,
      authorSocketId: socket.id,
      text: data.text,
      timestamp: new Date().toISOString()
    };

      room.answers.push(answer);
      io.to(user.currentRoom).emit('answer', answer);
    }
  });

  // 답변 수정
  socket.on('updateAnswer', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    const answer = room.answers.find(a => a.id === data.answerId);
    if (!answer) return;

    // 작성자 확인
    if (answer.authorSocketId !== socket.id) return;

    answer.text = data.text;
    answer.timestamp = new Date().toISOString();

    io.to(user.currentRoom).emit('answerUpdated', answer);
  });

  // 답변 삭제
  socket.on('deleteAnswer', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    const answerIndex = room.answers.findIndex(a => a.id === data.answerId);
    if (answerIndex === -1) return;

    const answer = room.answers[answerIndex];

    // 작성자 확인
    if (answer.authorSocketId !== socket.id) return;

    room.answers.splice(answerIndex, 1);

    io.to(user.currentRoom).emit('answerDeleted', { answerId: data.answerId });
  });

  // 연결 해제
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const room = rooms.get(user.currentRoom);
      if (room) {
        room.users.delete(socket.id);
        
        // 모든 클라이언트에 방 목록 업데이트 (참여자 수 갱신)
        io.emit('rooms', Array.from(rooms.entries()).map(([id, data]) => ({
          id,
          name: data.name,
          type: data.type,
          userCount: data.users.size
        })));
        
        socket.to(user.currentRoom).emit('userLeft', {
          nickname: user.nickname,
          userCount: room.users.size
        });
      }
      users.delete(socket.id);
    }
    console.log('사용자 연결 해제:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다. (HTTPS)`);
  console.log(`로컬 접속: https://localhost:${PORT}`);
  console.log(`네트워크 접속: https://${getLocalIP()}:${PORT}`);
  console.log(`\n⚠️  자체 서명 인증서를 사용 중입니다. 브라우저에서 보안 경고가 표시될 수 있습니다.`);
});

// 로컬 IP 주소 가져오기
function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

