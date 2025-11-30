const { ipcRenderer } = require('electron');

// 서버 주소 (localStorage에서 불러오거나 기본값 사용)
let SERVER_URL = localStorage.getItem('serverUrl') || 'https://localhost:3000';

let socket;
let currentRoomId = 'general';
let currentRoomType = 'chat';
let userId = ''; // 사용자 아이디 (필수)
let selectedEmoji = null; // 선택한 이모티콘 (선택사항)
let typingTimeout;
let isTyping = false;
let currentNoticeData = null;
let liveContentUpdateTimeout;
let selectedSectionId = null;
let sections = [];

// 사용자별 색상 생성 함수
function generateUserColor(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  // 서버 주소 모달 표시 (저장된 주소가 없거나 연결 실패 시)
  const savedServerUrl = localStorage.getItem('serverUrl');
  if (savedServerUrl) {
    SERVER_URL = savedServerUrl;
    // 저장된 주소가 있으면 바로 닉네임 모달 표시
    showNicknameModal();
  } else {
    // 저장된 주소가 없으면 서버 주소 입력 모달 표시
    showServerUrlModal();
  }
  
  // 이벤트 리스너 설정
  setupEventListeners();
});

function setupEventListeners() {
  // 이모티콘 직접 입력
  const emojiInput = document.getElementById('emojiInput');
  if (emojiInput) {
    emojiInput.addEventListener('input', (e) => {
      const inputValue = e.target.value.trim();
      if (inputValue) {
        selectedEmoji = inputValue;
        document.getElementById('selectedEmojiPreview').textContent = inputValue;
        // 선택된 버튼 스타일 제거
        document.querySelectorAll('.emoji-btn').forEach(btn => btn.classList.remove('selected'));
      }
    });
  }

  // 서버 주소 확인
  document.getElementById('confirmServerUrlBtn').addEventListener('click', () => {
    const input = document.getElementById('serverUrlInput');
    const serverUrl = input.value.trim();
    
    if (!serverUrl) {
      alert('서버 주소를 입력해주세요.');
      return;
    }
    
    // URL 형식 검증
    try {
      new URL(serverUrl);
    } catch (e) {
      alert('올바른 서버 주소 형식을 입력해주세요.\n예: https://192.168.1.100:3000');
      return;
    }
    
    SERVER_URL = serverUrl;
    localStorage.setItem('serverUrl', SERVER_URL);
    document.getElementById('serverUrlModal').classList.remove('active');
    
    // 서버 주소 입력 후 닉네임 모달 표시
    showNicknameModal();
  });

  // 서버 주소 입력 필드에서 Enter 키
  document.getElementById('serverUrlInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('confirmServerUrlBtn').click();
    }
  });

  // 사용자 설정 확인
  document.getElementById('confirmNicknameBtn').addEventListener('click', () => {
    const userIdInput = document.getElementById('userIdInput');
    userId = userIdInput.value.trim();
    
    if (!userId) {
      alert('아이디를 입력해주세요.');
      userIdInput.focus();
      return;
    }
    
    // 이모티콘은 선택사항이므로 없어도 됨
    const emojiInput = document.getElementById('emojiInput');
    const directInput = emojiInput ? emojiInput.value.trim() : '';
    
    if (directInput) {
      selectedEmoji = directInput;
    }
    // selectedEmoji가 없어도 됨 (선택사항)
    
    document.getElementById('nicknameModal').classList.remove('active');
    connectToServer();
  });

  // 방 생성
  document.getElementById('createRoomBtn').addEventListener('click', () => {
    document.getElementById('createRoomModal').classList.add('active');
    document.getElementById('roomNameInput').focus();
  });

  document.getElementById('confirmCreateBtn').addEventListener('click', () => {
    const roomName = document.getElementById('roomNameInput').value.trim();
    const roomType = document.querySelector('input[name="roomType"]:checked').value;
    if (roomName) {
      socket.emit('createRoom', { roomName, roomType });
      document.getElementById('createRoomModal').classList.remove('active');
      document.getElementById('roomNameInput').value = '';
    }
  });

  document.getElementById('cancelCreateBtn').addEventListener('click', () => {
    document.getElementById('createRoomModal').classList.remove('active');
    document.getElementById('roomNameInput').value = '';
  });

  // 모달 외부 클릭 시 닫기
  document.getElementById('createRoomModal').addEventListener('click', (e) => {
    if (e.target.id === 'createRoomModal') {
      document.getElementById('createRoomModal').classList.remove('active');
      document.getElementById('roomNameInput').value = '';
    }
  });

  // 공지 등록
  document.getElementById('setNoticeBtn').addEventListener('click', () => {
    document.getElementById('noticeModal').classList.add('active');
    document.getElementById('noticeModal').dataset.mode = 'create';
    document.getElementById('noticeTextInput').value = '';
    document.getElementById('noticeTextInput').focus();
  });

  document.getElementById('confirmNoticeBtn').addEventListener('click', () => {
    const noticeText = document.getElementById('noticeTextInput').value.trim();
    if (noticeText && socket) {
      const modal = document.getElementById('noticeModal');
      const mode = modal.dataset.mode;
      
      if (mode === 'edit') {
        socket.emit('updateNotice', { text: noticeText });
      } else {
        socket.emit('setNotice', { text: noticeText });
      }
      
      modal.classList.remove('active');
      modal.dataset.mode = '';
      document.getElementById('noticeTextInput').value = '';
    }
  });

  document.getElementById('cancelNoticeBtn').addEventListener('click', () => {
    document.getElementById('noticeModal').classList.remove('active');
    document.getElementById('noticeTextInput').value = '';
  });

  // 모달 외부 클릭 시 닫기
  document.getElementById('noticeModal').addEventListener('click', (e) => {
    if (e.target.id === 'noticeModal') {
      document.getElementById('noticeModal').classList.remove('active');
      document.getElementById('noticeTextInput').value = '';
    }
  });

  // 답변 제출
  document.getElementById('submitAnswerBtn').addEventListener('click', () => {
    submitAnswer();
  });

  document.getElementById('answerText').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      submitAnswer();
    }
  });

  // 공지 수정
  document.getElementById('editNoticeBtn').addEventListener('click', () => {
    const currentNotice = currentNoticeData;
    if (currentNotice) {
      document.getElementById('noticeTextInput').value = currentNotice.text;
      document.getElementById('noticeModal').classList.add('active');
      document.getElementById('noticeModal').dataset.mode = 'edit';
    }
  });

  // 공지 삭제
  document.getElementById('deleteNoticeBtn').addEventListener('click', () => {
    if (confirm('공지를 삭제하시겠습니까?')) {
      socket.emit('deleteNotice');
    }
  });

  // 전체 메시지 삭제
  document.getElementById('clearAllMessagesBtn').addEventListener('click', () => {
    if (confirm('모든 메시지를 삭제하시겠습니까?')) {
      socket.emit('clearAllMessages');
    }
  });

  // 메시지 전송
  document.getElementById('sendBtn').addEventListener('click', () => {
    sendMessage();
  });

  document.getElementById('messageInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });

  // 타이핑 이벤트
  document.getElementById('messageInput').addEventListener('input', () => {
    handleTyping();
  });

  // 실시간 공유방 입력 이벤트
  const liveInput = document.getElementById('liveInput');
  if (liveInput) {
    liveInput.addEventListener('input', (e) => {
      if (currentRoomType === 'live' && socket && socket.connected) {
        handleLiveContentUpdate(e.target.value);
      }
    });
  }

  // 실시간 공유방 내용 지우기
  const clearLiveBtn = document.getElementById('clearLiveBtn');
  if (clearLiveBtn) {
    clearLiveBtn.addEventListener('click', () => {
      if (currentRoomType === 'live' && socket && socket.connected) {
        const liveInput = document.getElementById('liveInput');
        if (liveInput) {
          liveInput.value = '';
        }
        socket.emit('clearLiveContent');
      }
    });
  }
}

function showServerUrlModal() {
  document.getElementById('serverUrlModal').classList.add('active');
  const input = document.getElementById('serverUrlInput');
  const savedUrl = localStorage.getItem('serverUrl');
  if (savedUrl) {
    input.value = savedUrl;
  }
  input.focus();
  input.select();

  // 모달 외부 클릭 시 닫지 않음 (서버 주소는 필수)
}

function showNicknameModal() {
  document.getElementById('nicknameModal').classList.add('active');
  
  // 이모티콘 선택기 초기화
  initializeEmojiPicker();
  
  // 아이디 입력 필드에 포커스
  document.getElementById('userIdInput').focus();

  // 모달 외부 클릭 시 닫지 않음 (아이디는 필수)
  document.getElementById('nicknameModal').addEventListener('click', (e) => {
    if (e.target.id === 'nicknameModal') {
      // 아이디는 필수이므로 외부 클릭으로 닫지 않음
    }
  });
}

function initializeEmojiPicker() {
  const emojiPicker = document.getElementById('emojiPicker');
  if (!emojiPicker) return;
  
  emojiPicker.innerHTML = '';
  
  // 인기 이모티콘 목록
  const popularEmojis = [
    '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
    '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
    '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔',
    '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
    '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮',
    '🤧', '🥵', '🥶', '😶‍🌫️', '😵', '🤯', '🤠', '🥳', '😎', '🤓',
    '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺',
    '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣',
    '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈',
    '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾',
    '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'
  ];
  
  popularEmojis.forEach(emoji => {
    const emojiBtn = document.createElement('button');
    emojiBtn.className = 'emoji-btn';
    emojiBtn.textContent = emoji;
    emojiBtn.addEventListener('click', () => {
      selectedEmoji = emoji;
      document.getElementById('selectedEmojiPreview').textContent = emoji;
      document.querySelectorAll('.emoji-btn').forEach(btn => btn.classList.remove('selected'));
      emojiBtn.classList.add('selected');
      // 직접 입력 필드도 업데이트
      const emojiInput = document.getElementById('emojiInput');
      if (emojiInput) {
        emojiInput.value = emoji;
      }
    });
    emojiPicker.appendChild(emojiBtn);
  });
}

function updateColorPreview(text) {
  const colorPreview = document.getElementById('colorPreview');
  if (!colorPreview) return;
  
  const color = generateUserColor(text);
  colorPreview.style.backgroundColor = color;
  colorPreview.textContent = text;
  colorPreview.style.display = 'block';
}

function connectToServer() {
  // Socket.io 클라이언트 연결
  socket = io(SERVER_URL, {
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 10000
  });

  socket.on('connect', () => {
    console.log('서버에 연결되었습니다.');
    socket.emit('join', { 
      userId,
      emoji: selectedEmoji || null,
      roomId: currentRoomId 
    });
  });

  socket.on('connect_error', (error) => {
    console.error('서버 연결 실패:', error);
    alert(`서버에 연결할 수 없습니다.\n\n서버 주소: ${SERVER_URL}\n\n서버가 실행 중인지 확인하고, 서버 주소를 다시 입력해주세요.`);
    
    // 연결 실패 시 서버 주소 모달 다시 표시
    document.getElementById('nicknameModal').classList.remove('active');
    showServerUrlModal();
  });

  socket.on('disconnect', () => {
    console.log('서버 연결이 끊어졌습니다.');
  });

  // 방 목록 수신
  socket.on('rooms', (rooms) => {
    updateRoomsList(rooms);
  });

  // 방 데이터 수신
  socket.on('roomData', (data) => {
    currentRoomId = data.roomId;
    currentRoomType = data.type || 'chat';
    document.getElementById('currentRoomName').textContent = data.name;
    document.getElementById('liveRoomName').textContent = data.name;
    
    // 방 타입에 따라 UI 전환
    if (currentRoomType === 'live') {
      document.getElementById('chatContainer').style.display = 'none';
      document.getElementById('liveContainer').style.display = 'flex';
      sections = data.sections || [];
      displayLiveContentBySections(data.liveContent || {}, sections);
      
      // 현재 사용자의 입력 필드 초기화
      const liveInput = document.getElementById('liveInput');
      if (liveInput && data.liveContent && data.liveContent[userId]) {
        liveInput.value = data.liveContent[userId].text || '';
      } else if (liveInput) {
        liveInput.value = '';
      }
    } else {
      document.getElementById('chatContainer').style.display = 'flex';
      document.getElementById('liveContainer').style.display = 'none';
      document.getElementById('clearAllMessagesBtn').style.display = 'block';
      displayMessages(data.messages);
      currentNoticeData = data.notice;
      updateNotice(data.notice);
      updateAnswers(data.answers);
    }
  });

  // 새 메시지 수신
  socket.on('message', (message) => {
    // 자신이 보낸 메시지인 경우, 임시 메시지를 찾아서 제거
    if (message.userId === userId) {
      // pendingMessages에서 찾기
      if (pendingMessages.has(message.text)) {
        const tempId = pendingMessages.get(message.text);
        const tempMessage = document.querySelector(`[data-message-id="${tempId}"]`);
        if (tempMessage) {
          tempMessage.remove();
        }
        pendingMessages.delete(message.text);
      } else {
        // pendingMessages에 없으면 텍스트로 직접 찾기 (백업 방법)
        const allTempMessages = document.querySelectorAll('[data-message-id^="temp-"]');
        allTempMessages.forEach(tempMsg => {
          const tempText = tempMsg.querySelector('.message-text')?.textContent;
          if (tempText === message.text) {
            tempMsg.remove();
          }
        });
      }
    }
    
    // 중복 체크: 같은 ID의 메시지가 이미 있으면 추가하지 않음
    const existingMessage = document.querySelector(`[data-message-id="${message.id}"]`);
    if (!existingMessage) {
      addMessage(message);
      // 자신의 메시지가 아닐 때만 알림 표시
      if (message.userId !== userId) {
        const displayName = message.displayName || message.emoji || message.userId;
        showNotification('새 메시지', `${displayName}: ${message.text}`);
      }
    }
  });

  // 메시지 삭제됨
  socket.on('messageDeleted', (data) => {
    removeMessageFromList(data.messageId);
  });

  // 전체 메시지 삭제됨
  socket.on('allMessagesCleared', () => {
    document.getElementById('messages').innerHTML = '';
  });

  // 실시간 공유방 내용 업데이트
  socket.on('liveContentUpdated', (data) => {
    if (currentRoomType === 'live') {
      const userInfo = {
        userId: data.userId,
        emoji: data.emoji || null,
        displayName: data.displayName || data.userId
      };
      updateLiveContentSection(data.userId, data.text, data.sectionId, userInfo);
    }
  });

  // 구역 목록 업데이트
  socket.on('sectionsUpdated', (updatedSections) => {
    sections = updatedSections;
    // 현재 표시된 내용도 다시 정리
    if (currentRoomType === 'live') {
      const liveContent = {};
      document.querySelectorAll('.live-section').forEach(section => {
        const contentUserId = section.dataset.liveUser;
        const contentDiv = section.querySelector('.live-section-content');
        let text = '';
        if (contentDiv) {
          const emptyContent = contentDiv.querySelector('.empty-content');
          if (!emptyContent) {
            text = contentDiv.textContent || contentDiv.innerText || '';
          }
        }
        const sectionId = section.dataset.sectionId;
        // 이모티콘 정보도 함께 저장
        const nicknameSpan = section.querySelector('.live-section-nickname');
        const emoji = nicknameSpan && nicknameSpan.classList.contains('emoji-nickname') ? nicknameSpan.textContent : null;
        if (contentUserId) {
          liveContent[contentUserId] = { text, sectionId, emoji, displayName: emoji || contentUserId };
        }
      });
      
      // 기존 구역들의 헤더 정보 업데이트 (구역 이름 등)
      updatedSections.forEach(section => {
        const sectionGroup = document.querySelector(`[data-section-id="${section.id}"]`);
        if (sectionGroup) {
          const header = sectionGroup.querySelector('.section-group-header');
          if (header) {
            const deleteButton = `<button class="btn-section-group-delete" data-section-id="${section.id}" title="구역 삭제">🗑️</button>`;
            header.innerHTML = `<span class="drag-handle">☰</span><h4>${escapeHtml(section.name)}</h4>${deleteButton}`;
            
            // 삭제 버튼 이벤트 다시 등록 (모든 사용자가 삭제 가능)
            const deleteBtn = header.querySelector('.btn-section-group-delete');
            if (deleteBtn) {
              deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sectionIdToDelete = e.target.dataset.sectionId;
                if (confirm('구역을 삭제하시겠습니까? 구역의 모든 내용이 삭제됩니다.')) {
                  socket.emit('deleteSection', { sectionId: sectionIdToDelete });
                }
              });
            }
          }
        }
      });
      
      displayLiveContentBySections(liveContent, sections);
    }
  });

  // 구역 삭제됨
  socket.on('sectionDeleted', (data) => {
    console.log('구역 삭제 이벤트 수신:', data.sectionId);
    if (currentRoomType === 'live') {
      const sectionGroup = document.querySelector(`[data-section-id="${data.sectionId}"]`);
      if (sectionGroup) {
        console.log('구역 DOM 요소 찾음, 제거 중:', data.sectionId);
        // 애니메이션 효과와 함께 제거
        sectionGroup.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => {
          sectionGroup.remove();
          console.log('구역 DOM 요소 제거 완료:', data.sectionId);
        }, 300);
      } else {
        console.log('구역 DOM 요소를 찾을 수 없음:', data.sectionId);
      }
      // sections 배열에서도 제거
      sections = sections.filter(s => s.id !== data.sectionId);
      console.log('구역 배열에서 제거 완료, 남은 구역 수:', sections.length);
    }
  });

  // 구역 순서 변경됨
  socket.on('sectionsReordered', (data) => {
    if (currentRoomType === 'live') {
      const liveSections = document.getElementById('liveSections');
      if (!liveSections) return;
      
      const { sectionOrder } = data;
      const currentSections = Array.from(liveSections.children);
      
      // 순서대로 재배치
      sectionOrder.forEach(sectionId => {
        const sectionDiv = currentSections.find(el => el.dataset.sectionId === sectionId);
        if (sectionDiv) {
          liveSections.appendChild(sectionDiv);
        }
      });
    }
  });

  // 타이핑 인디케이터
  socket.on('typing', (data) => {
    showTypingIndicator(data.displayName || data.userId);
  });

  socket.on('typingStop', (data) => {
    hideTypingIndicator(data.userId);
  });

  // 공지 업데이트
  socket.on('notice', (notice) => {
    currentNoticeData = notice;
    updateNotice(notice);
  });

  // 공지 삭제됨
  socket.on('noticeDeleted', () => {
    currentNoticeData = null;
    updateNotice(null);
  });

  // 답변 추가
  socket.on('answer', (answer) => {
    addAnswer(answer);
  });

  // 답변 업데이트됨
  socket.on('answerUpdated', (answer) => {
    updateAnswerInList(answer);
  });

  // 답변 삭제됨
  socket.on('answerDeleted', (data) => {
    removeAnswerFromList(data.answerId);
  });

  // 사용자 입장/퇴장
  socket.on('userJoined', (data) => {
    console.log(`${data.nickname}님이 입장했습니다.`);
    // 방 목록이 업데이트되면 자동으로 참여자 수가 갱신됨
  });

  socket.on('userLeft', (data) => {
    console.log(`${data.nickname}님이 퇴장했습니다.`);
    // 방 목록이 업데이트되면 자동으로 참여자 수가 갱신됨
  });
}

function updateRoomsList(rooms) {
  const roomsList = document.getElementById('roomsList');
  roomsList.innerHTML = '';

  rooms.forEach(room => {
    const roomItem = document.createElement('div');
    roomItem.className = 'room-item';
    if (room.id === currentRoomId) {
      roomItem.classList.add('active');
    }

    const roomIcon = room.type === 'live' ? '⚡' : '💬';
    roomItem.innerHTML = `
      <span class="room-name">${roomIcon} ${room.name}</span>
      <span class="room-count">${room.userCount}</span>
    `;

    roomItem.addEventListener('click', () => {
      if (room.id !== currentRoomId) {
        socket.emit('changeRoom', { roomId: room.id });
      }
    });

    roomsList.appendChild(roomItem);
  });
}

function displayMessages(messages) {
  const messagesContainer = document.getElementById('messages');
  messagesContainer.innerHTML = '';

  messages.forEach(message => {
    addMessage(message);
  });

  scrollToBottom();
}


function addMessage(message) {
  const messagesContainer = document.getElementById('messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  messageDiv.dataset.messageId = message.id;

  const time = new Date(message.timestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const isAuthor = message.userId === userId;
  const deleteButtonHTML = isAuthor ? `<button class="btn-message-delete" data-message-id="${message.id}" title="삭제">🗑️</button>` : '';

  // 표시 이름 (이모티콘이 있으면 이모티콘만, 없으면 userId)
  const displayName = message.displayName || message.emoji || message.userId;
  const nicknameDisplay = message.emoji 
    ? `<span class="message-nickname emoji-nickname">${message.emoji}</span>`
    : `<span class="message-nickname text-nickname" style="color: ${generateUserColor(message.userId)};">${escapeHtml(message.userId)}</span>`;

  messageDiv.innerHTML = `
    <div class="message-header">
      ${nicknameDisplay}
      <span class="message-time">${time}</span>
      ${deleteButtonHTML}
    </div>
    <div class="message-text">${escapeHtml(message.text)}</div>
  `;

  // 삭제 버튼 이벤트 (작성자인 경우만)
  if (isAuthor) {
    messageDiv.querySelector('.btn-message-delete').addEventListener('click', (e) => {
      const messageId = e.target.dataset.messageId;
      if (confirm('메시지를 삭제하시겠습니까?')) {
        socket.emit('deleteMessage', { messageId });
      }
    });
  }

  messagesContainer.appendChild(messageDiv);
  scrollToBottom();
}

function removeMessageFromList(messageId) {
  const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
  if (messageDiv) {
    messageDiv.style.animation = 'fadeOut 0.3s ease-out';
    setTimeout(() => {
      messageDiv.remove();
    }, 300);
  }
}

let pendingMessages = new Map(); // 전송 중인 메시지 추적 (텍스트 -> 임시 ID)

function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();

  if (text && socket) {
    // 서버에 메시지 전송
    socket.emit('message', { text });
    
    // 즉시 자신의 메시지를 표시 (낙관적 업데이트)
    const tempId = 'temp-' + Date.now();
    const tempMessage = {
      id: tempId,
      userId: userId,
      emoji: selectedEmoji,
      displayName: selectedEmoji || userId,
      text: text,
      timestamp: new Date().toISOString()
    };
    
    // 전송 중인 메시지로 등록
    pendingMessages.set(text, tempId);
    
    addMessage(tempMessage);
    
    input.value = '';
    stopTyping();
  }
}

function handleTyping() {
  if (!isTyping) {
    isTyping = true;
    socket.emit('typingStart');
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    stopTyping();
  }, 1000);
}

function stopTyping() {
  if (isTyping) {
    isTyping = false;
    socket.emit('typingStop');
  }
  clearTimeout(typingTimeout);
}

const typingUsers = new Set();

function showTypingIndicator(nickname) {
  typingUsers.add(nickname);
  updateTypingIndicator();
}

function hideTypingIndicator(nickname) {
  typingUsers.delete(nickname);
  updateTypingIndicator();
}

function updateTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (typingUsers.size > 0) {
    const users = Array.from(typingUsers);
    indicator.innerHTML = `<span class="typing-user">${users.join(', ')}${users.length > 1 ? '이' : '가'} 입력 중</span><span class="typing-dots"><span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>`;
    indicator.classList.add('typing-active');
  } else {
    indicator.textContent = '';
    indicator.classList.remove('typing-active');
  }
}

function updateNotice(notice) {
  const noticeContent = document.getElementById('noticeContent');
  const answersSection = document.getElementById('answersSection');
  const answerInput = document.getElementById('answerInput');
  const noticeActions = document.getElementById('noticeActions');
  const answerTextInput = document.getElementById('answerText');

  if (notice) {
    const time = new Date(notice.timestamp).toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const isAuthor = notice.author === userId;
    
    // 공지 작성자 표시 (이모티콘이 있으면 이모티콘만, 없으면 userId)
    const authorDisplay = notice.authorDisplayName || notice.authorEmoji || notice.author;
    
    noticeContent.innerHTML = `
      <div class="notice-text" data-notice-id="${notice.id}">
        <strong style="font-size: 11px;">${escapeHtml(notice.text)}</strong>
        <div style="margin-top: 3px; font-size: 9px; color: rgba(255,255,255,0.6);">
          ${authorDisplay} | ${time}
        </div>
      </div>
    `;
    answerInput.style.display = 'flex';
    noticeActions.style.display = isAuthor ? 'flex' : 'none';
    answersSection.innerHTML = '';
    
    // 답변 입력 필드 초기화
    if (answerTextInput) {
      answerTextInput.value = '';
      answerTextInput.placeholder = '답변을 입력하세요...';
    }
  } else {
    noticeContent.innerHTML = '<p class="no-notice">공지가 없습니다.</p>';
    answerInput.style.display = 'none';
    noticeActions.style.display = 'none';
    answersSection.innerHTML = '';
    
    // 답변 입력 필드 초기화
    if (answerTextInput) {
      answerTextInput.value = '';
      answerTextInput.placeholder = '답변을 입력하세요...';
    }
  }
}

function updateAnswers(answers) {
  const answersSection = document.getElementById('answersSection');
  answersSection.innerHTML = '';

  answers.forEach(answer => {
    addAnswer(answer);
  });
  
  // 현재 사용자의 답변이 있는지 확인하여 입력 필드 업데이트
  const myAnswer = answers.find(a => a.nickname === nickname);
  const answerInput = document.getElementById('answerText');
  if (myAnswer && answerInput) {
    answerInput.value = myAnswer.text;
    answerInput.placeholder = '답변을 수정하세요...';
  } else if (answerInput) {
    answerInput.value = '';
    answerInput.placeholder = '답변을 입력하세요...';
  }
}

function addAnswer(answer) {
  const answersSection = document.getElementById('answersSection');
  
  // 기존 답변 제거 (같은 사용자의 답변이 이미 있으면)
  const existingAnswer = document.querySelector(`[data-answer-author="${answer.userId}"]`);
  if (existingAnswer) {
    existingAnswer.remove();
  }
  
  const answerDiv = document.createElement('div');
  answerDiv.className = 'sidebar-answer-item';
  answerDiv.dataset.answerId = answer.id;
  answerDiv.dataset.answerAuthor = answer.userId;

  const time = new Date(answer.timestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const isAuthor = answer.userId === userId;
  const actionsHTML = isAuthor ? `
    <div class="answer-actions" style="margin-top: 3px; display: flex; gap: 3px;">
      <button class="btn-answer-edit" data-answer-id="${answer.id}" style="font-size: 9px; padding: 2px 5px;">수정</button>
      <button class="btn-answer-delete" data-answer-id="${answer.id}" style="font-size: 9px; padding: 2px 5px;">삭제</button>
    </div>
  ` : '';

  // 답변 작성자 표시 (이모티콘이 있으면 이모티콘만, 없으면 userId)
  const displayName = answer.displayName || answer.emoji || answer.userId;
  const answerAuthorDisplay = answer.emoji 
    ? `<span class="sidebar-answer-author emoji-nickname">${answer.emoji}</span>`
    : `<span class="sidebar-answer-author text-nickname" style="color: ${generateUserColor(answer.userId)};">${escapeHtml(answer.userId)}</span>`;

  answerDiv.innerHTML = `
    <div class="answer-content">
      ${answerAuthorDisplay}:
      <span class="answer-text" style="font-size: 10px;">${escapeHtml(answer.text)}</span>
      <span style="margin-left: 5px; font-size: 9px; color: rgba(255,255,255,0.5);">${time}</span>
    </div>
    ${actionsHTML}
  `;

  // 수정/삭제 버튼 이벤트 (작성자인 경우만)
  if (isAuthor) {
    answerDiv.querySelector('.btn-answer-edit').addEventListener('click', (e) => {
      const answerId = e.target.dataset.answerId;
      const answerText = answerDiv.querySelector('.answer-text').textContent;
      const newText = prompt('답변을 수정하세요:', answerText);
      if (newText && newText.trim()) {
        socket.emit('updateAnswer', { answerId, text: newText.trim() });
      }
    });

    answerDiv.querySelector('.btn-answer-delete').addEventListener('click', (e) => {
      const answerId = e.target.dataset.answerId;
      if (confirm('답변을 삭제하시겠습니까?')) {
        socket.emit('deleteAnswer', { answerId });
      }
    });
  }

  answersSection.appendChild(answerDiv);
  answersSection.scrollTop = answersSection.scrollHeight;
}

function updateAnswerInList(answer) {
  const answerDiv = document.querySelector(`[data-answer-id="${answer.id}"]`);
  if (answerDiv) {
    const time = new Date(answer.timestamp).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit'
    });
    const answerText = answerDiv.querySelector('.answer-text');
    if (answerText) {
      answerText.textContent = answer.text;
    }
    const timeSpan = answerDiv.querySelector('.answer-content span:last-child');
    if (timeSpan) {
      timeSpan.textContent = time;
    }
    
    // 현재 사용자의 답변이면 입력 필드도 업데이트
    if (answer.nickname === nickname) {
      const answerInput = document.getElementById('answerText');
      if (answerInput) {
        answerInput.value = answer.text;
        answerInput.placeholder = '답변을 수정하세요...';
      }
    }
  }
}

function removeAnswerFromList(answerId) {
  const answerDiv = document.querySelector(`[data-answer-id="${answerId}"]`);
  if (answerDiv) {
    const isMyAnswer = answerDiv.dataset.answerAuthor === userId;
    answerDiv.remove();
    
    // 현재 사용자의 답변이 삭제되었으면 입력 필드 초기화
    if (isMyAnswer) {
      const answerInput = document.getElementById('answerText');
      if (answerInput) {
        answerInput.value = '';
        answerInput.placeholder = '답변을 입력하세요...';
      }
    }
  }
}

function submitAnswer() {
  const input = document.getElementById('answerText');
  const text = input.value.trim();

  if (text && socket) {
    socket.emit('addAnswer', { text });
    // 답변 제출 후 입력 필드 초기화
    input.value = '';
    input.placeholder = '답변을 수정하세요...';
  }
}

function scrollToBottom() {
  const messagesContainer = document.getElementById('messages');
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showNotification(title, body) {
  // Electron 메인 프로세스에 알림 요청 (작고 귀여운 알림)
  console.log('알림 요청:', title, body, '포커스 상태:', document.hasFocus());
  
  // ipcRenderer가 있는지 확인
  if (typeof ipcRenderer === 'undefined') {
    console.error('ipcRenderer가 정의되지 않음');
    return;
  }
  
  // 창이 포커스되어 있지 않을 때만 알림 표시
  if (!document.hasFocus()) {
    console.log('알림 전송 중...');
    try {
      ipcRenderer.send('show-notification', { 
        title: title || '💬 새 메시지',
        body: body || '❤️'
      });
      console.log('알림 전송 완료');
    } catch (error) {
      console.error('알림 전송 실패:', error);
    }
  } else {
    console.log('창이 포커스되어 있어 알림을 표시하지 않음');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 실시간 공유방 관련 함수들
function handleLiveContentUpdate(text) {
  if (!socket || currentRoomType !== 'live') {
    return;
  }
  
  clearTimeout(liveContentUpdateTimeout);
  liveContentUpdateTimeout = setTimeout(() => {
    if (socket && socket.connected) {
      socket.emit('updateLiveContent', { text });
    }
  }, 300); // 300ms 디바운싱
}

function displayLiveContentBySections(liveContent, sectionsList) {
  const liveSections = document.getElementById('liveSections');
  if (!liveSections) return;
  
  // 기존 순서 저장 (드래그 앤 드롭 순서 유지)
  const existingOrder = Array.from(liveSections.children)
    .map(child => child.dataset.sectionId)
    .filter(id => id && sectionsList.some(s => s.id === id)); // 삭제된 구역 제외
  
  // 삭제된 구역 제거 (sectionsList에 없는 구역)
  Array.from(liveSections.children).forEach(child => {
    const sectionId = child.dataset.sectionId;
    if (sectionId && !sectionsList.some(s => s.id === sectionId)) {
      child.remove();
    }
  });
  
  // 기존 구역 ID 수집 (삭제되지 않은 것만)
  const existingSectionIds = new Set(
    Array.from(liveSections.children)
      .map(child => child.dataset.sectionId)
      .filter(id => id && sectionsList.some(s => s.id === id))
  );

  // 구역별로 그룹화
  const contentBySection = {};
  Object.keys(liveContent).forEach(userId => {
    const content = liveContent[userId];
    // content가 객체인 경우와 문자열인 경우 모두 처리
    const sectionId = (typeof content === 'object' && content.sectionId) ? content.sectionId : '';
    const text = (typeof content === 'object' && content.text !== undefined) ? content.text : (typeof content === 'string' ? content : '');
    
    if (!contentBySection[sectionId]) {
      contentBySection[sectionId] = [];
    }
    // 서버에서 받은 데이터에서 userInfo 추출 (없으면 기본값)
    const userInfo = {
      userId,
      emoji: (typeof content === 'object' && content.emoji) ? content.emoji : null,
      displayName: (typeof content === 'object' && content.displayName) ? content.displayName : (content.emoji || userId),
      text
    };
    contentBySection[sectionId].push(userInfo);
  });

  // 구역 목록이 없으면 빈 배열로 처리
  if (!sectionsList || sectionsList.length === 0) {
    return;
  }

  // 기존 순서를 유지하면서 구역 표시
  const orderedSections = existingOrder.length > 0 
    ? existingOrder.map(id => sectionsList.find(s => s.id === id)).filter(Boolean)
        .concat(sectionsList.filter(s => !existingOrder.includes(s.id)))
    : sectionsList;

  orderedSections.forEach(section => {
    // 이미 존재하는 구역은 건너뛰기 (내용만 업데이트)
    if (existingSectionIds.has(section.id)) {
      const existingSection = document.querySelector(`[data-section-id="${section.id}"]`);
      if (existingSection) {
        // 삭제 버튼 이벤트 리스너 확인 및 재등록
        const deleteBtn = existingSection.querySelector('.btn-section-group-delete');
        if (deleteBtn) {
          // 기존 이벤트 리스너 제거 후 재등록
          const newDeleteBtn = deleteBtn.cloneNode(true);
          deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
          newDeleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const sectionIdToDelete = e.target.dataset.sectionId || section.id;
            console.log('구역 삭제 버튼 클릭:', sectionIdToDelete, '현재 구역 ID:', section.id);
            if (confirm('구역을 삭제하시겠습니까? 구역의 모든 내용이 삭제됩니다.')) {
              console.log('구역 삭제 요청 전송:', sectionIdToDelete);
              socket.emit('deleteSection', { sectionId: sectionIdToDelete });
            }
          });
        }
        
        // 기존 구역의 내용만 업데이트
        const usersInSection = contentBySection[section.id] || [];
        const existingUserSections = existingSection.querySelectorAll('.live-section');
        const existingUserNicknames = new Set(Array.from(existingUserSections).map(s => s.dataset.liveUser));
        
        // 새로운 사용자 섹션 추가
        usersInSection.forEach((userInfo) => {
          const { userId: contentUserId, text } = userInfo;
          if (!existingUserNicknames.has(contentUserId)) {
            const userSection = createUserSection(contentUserId, text, section.id, section.owner === contentUserId, userInfo);
            existingSection.appendChild(userSection);
          } else {
            // 기존 사용자 섹션 내용 업데이트
            const userSection = existingSection.querySelector(`[data-live-user="${contentUserId}"]`);
            if (userSection) {
              const contentDiv = userSection.querySelector('.live-section-content');
              if (contentDiv) {
                contentDiv.innerHTML = text && text.trim() ? escapeHtml(text).replace(/\n/g, '<br>') : '<span class="empty-content">(비어있음)</span>';
              }
              // 표시 이름 업데이트
              if (userInfo) {
                const nicknameSpan = userSection.querySelector('.live-section-nickname');
                if (nicknameSpan) {
                  if (userInfo.emoji) {
                    nicknameSpan.className = 'live-section-nickname emoji-nickname';
                    nicknameSpan.textContent = userInfo.emoji;
                  } else {
                    const color = generateUserColor(contentUserId);
                    nicknameSpan.className = 'live-section-nickname text-nickname';
                    nicknameSpan.style.color = color;
                    nicknameSpan.textContent = contentUserId;
                  }
                }
              }
            }
          }
        });
        
        // 빈 구역 표시
        if (usersInSection.length === 0) {
          const emptySection = existingSection.querySelector('.section-empty');
          if (!emptySection) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'section-empty';
            emptyDiv.textContent = '아직 내용이 없습니다';
            existingSection.appendChild(emptyDiv);
          }
        } else {
          const emptySection = existingSection.querySelector('.section-empty');
          if (emptySection) {
            emptySection.remove();
          }
        }
      }
      return; // 기존 구역은 건너뛰기
    }
    
    // 새 구역 생성
    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'section-group';
    sectionDiv.dataset.sectionId = section.id;
    sectionDiv.draggable = true;
    
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'section-group-header';
    // 모든 사용자가 삭제 가능
    const deleteButton = `<button class="btn-section-group-delete" data-section-id="${section.id}" title="구역 삭제">🗑️</button>`;
    sectionHeader.innerHTML = `<span class="drag-handle">☰</span><h4>${escapeHtml(section.name)}</h4>${deleteButton}`;
    sectionDiv.appendChild(sectionHeader);

    // 삭제 버튼 이벤트 (모든 사용자가 삭제 가능)
    const deleteBtn = sectionHeader.querySelector('.btn-section-group-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 버튼의 data-section-id 또는 부모 요소의 data-section-id 사용
        let sectionIdToDelete = e.target.dataset.sectionId || 
                                e.target.closest('.section-group')?.dataset.sectionId || 
                                section.id;
        
        // sectionDiv의 data-section-id도 확인
        if (!sectionIdToDelete || sectionIdToDelete === 'undefined') {
          const sectionGroup = e.target.closest('.section-group');
          if (sectionGroup) {
            sectionIdToDelete = sectionGroup.dataset.sectionId || section.id;
          }
        }
        
        console.log('구역 삭제 버튼 클릭:', sectionIdToDelete, '현재 구역 ID:', section.id);
        console.log('버튼의 data-section-id:', e.target.dataset.sectionId);
        console.log('부모 요소의 data-section-id:', e.target.closest('.section-group')?.dataset.sectionId);
        
        if (confirm('구역을 삭제하시겠습니까? 구역의 모든 내용이 삭제됩니다.')) {
          console.log('구역 삭제 요청 전송:', sectionIdToDelete, '타입:', typeof sectionIdToDelete);
          socket.emit('deleteSection', { sectionId: sectionIdToDelete });
        }
      });
    }

    // 드래그 이벤트
    sectionDiv.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', sectionDiv.outerHTML);
      e.dataTransfer.setData('text/plain', section.id);
      sectionDiv.classList.add('dragging');
    });

    sectionDiv.addEventListener('dragend', () => {
      sectionDiv.classList.remove('dragging');
    });

    sectionDiv.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const afterElement = getDragAfterElement(liveSections, e.clientY);
      if (afterElement == null) {
        liveSections.appendChild(sectionDiv);
      } else {
        liveSections.insertBefore(sectionDiv, afterElement);
      }
    });

    sectionDiv.addEventListener('drop', (e) => {
      e.preventDefault();
      updateSectionOrder();
    });

    const usersInSection = contentBySection[section.id] || [];
    usersInSection.forEach((userInfo) => {
      const { userId: contentUserId, text } = userInfo;
      const userSection = createUserSection(contentUserId, text, section.id, section.owner === contentUserId, userInfo);
      sectionDiv.appendChild(userSection);
    });

    // 구역에 사용자가 없어도 구역은 표시 (내용이 비어있어도 유지)
    if (usersInSection.length === 0) {
      const emptySection = document.createElement('div');
      emptySection.className = 'section-empty';
      emptySection.textContent = '아직 내용이 없습니다';
      sectionDiv.appendChild(emptySection);
    }

    liveSections.appendChild(sectionDiv);
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.section-group:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updateSectionOrder() {
  const liveSections = document.getElementById('liveSections');
  if (!liveSections) return;
  
  const sectionOrder = Array.from(liveSections.children)
    .map(child => child.dataset.sectionId)
    .filter(id => id);
  
  if (socket && socket.connected) {
    socket.emit('reorderSections', { sectionOrder });
  }
}

function createUserSection(userId, text, sectionId, isOwner, userInfo = null) {
  const section = document.createElement('div');
  section.className = 'live-section';
  section.dataset.liveUser = userId;
  section.dataset.sectionId = sectionId;
  
  // 표시 이름 (이모티콘이 있으면 이모티콘만, 없으면 userId)
  const displayName = (userInfo && userInfo.displayName) || (userInfo && userInfo.emoji) || userId;
  const nicknameDisplay = (userInfo && userInfo.emoji)
    ? `<span class="live-section-nickname emoji-nickname">${userInfo.emoji}</span>`
    : `<span class="live-section-nickname text-nickname" style="color: ${generateUserColor(userId)};">${escapeHtml(userId)}</span>`;
  
  section.innerHTML = `
    <div class="live-section-header">
      ${nicknameDisplay}
    </div>
    <div class="live-section-content">${text && text.trim() ? escapeHtml(text).replace(/\n/g, '<br>') : '<span class="empty-content">(비어있음)</span>'}</div>
  `;
  
  return section;
}

function updateLiveContentSection(userId, text, sectionId, userInfo = null) {
  if (currentRoomType !== 'live') return;
  
  // 기존 섹션 찾기
  let userSection = document.querySelector(`[data-live-user="${userId}"]`);
  
  if (!userSection) {
    // 새 사용자 섹션 생성
    let sectionGroup = document.querySelector(`[data-section-id="${sectionId}"]`);
    
    if (!sectionGroup && sectionId) {
      // 구역이 없으면 임시로 생성 (서버에서 sectionsUpdated가 올 때까지)
      const liveSections = document.getElementById('liveSections');
      if (!liveSections) return;
      
      sectionGroup = document.createElement('div');
      sectionGroup.className = 'section-group';
      sectionGroup.dataset.sectionId = sectionId;
      sectionGroup.draggable = true;
      
      // 임시 구역 헤더 생성
      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'section-group-header';
      // 모든 사용자가 삭제 가능
      const displayName = (userInfo && userInfo.displayName) || userId;
      const deleteButton = `<button class="btn-section-group-delete" data-section-id="${sectionId}" title="구역 삭제">🗑️</button>`;
      sectionHeader.innerHTML = `<span class="drag-handle">☰</span><h4>${escapeHtml(displayName)}</h4>${deleteButton}`;
      sectionGroup.appendChild(sectionHeader);
      
      // 삭제 버튼 이벤트 (모든 사용자가 삭제 가능)
      const deleteBtn = sectionHeader.querySelector('.btn-section-group-delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sectionIdToDelete = e.target.dataset.sectionId;
          if (confirm('구역을 삭제하시겠습니까? 구역의 모든 내용이 삭제됩니다.')) {
            socket.emit('deleteSection', { sectionId: sectionIdToDelete });
          }
        });
      }
      
      // 드래그 이벤트 추가
      sectionGroup.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', sectionGroup.outerHTML);
        e.dataTransfer.setData('text/plain', sectionId);
        sectionGroup.classList.add('dragging');
      });
      
      sectionGroup.addEventListener('dragend', () => {
        sectionGroup.classList.remove('dragging');
      });
      
      sectionGroup.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const afterElement = getDragAfterElement(liveSections, e.clientY);
        if (afterElement == null) {
          liveSections.appendChild(sectionGroup);
        } else {
          liveSections.insertBefore(sectionGroup, afterElement);
        }
      });
      
      sectionGroup.addEventListener('drop', (e) => {
        e.preventDefault();
        updateSectionOrder();
      });
      
      liveSections.appendChild(sectionGroup);
      
      // sections 배열에도 임시로 추가 (나중에 sectionsUpdated로 업데이트됨)
      if (!sections.find(s => s.id === sectionId)) {
        sections.push({
          id: sectionId,
          name: displayName,
          owner: userId,
          userCount: 1
        });
      }
    }
    
    if (sectionGroup) {
      const emptySection = sectionGroup.querySelector('.section-empty');
      if (emptySection) {
        emptySection.remove();
      }
      
      const section = sections.find(s => s.id === sectionId);
      const isOwner = section && section.owner === userId;
      userSection = createUserSection(userId, text, sectionId, isOwner, userInfo);
      sectionGroup.appendChild(userSection);
    }
  } else {
    // 기존 섹션 업데이트
    const contentDiv = userSection.querySelector('.live-section-content');
    if (contentDiv) {
      contentDiv.innerHTML = text && text.trim() ? escapeHtml(text).replace(/\n/g, '<br>') : '<span class="empty-content">(비어있음)</span>';
    }
    // 표시 이름 업데이트 (userInfo가 있는 경우)
    if (userInfo) {
      const nicknameSpan = userSection.querySelector('.live-section-nickname');
      if (nicknameSpan) {
        if (userInfo.emoji) {
          nicknameSpan.className = 'live-section-nickname emoji-nickname';
          nicknameSpan.textContent = userInfo.emoji;
        } else {
          const color = generateUserColor(userId);
          nicknameSpan.className = 'live-section-nickname text-nickname';
          nicknameSpan.style.color = color;
          nicknameSpan.textContent = userId;
        }
      }
    }
    
    // 구역이 변경된 경우 이동
    if (userSection.dataset.sectionId !== sectionId) {
      const oldGroup = userSection.parentElement;
      userSection.remove();
      userSection.dataset.sectionId = sectionId;
      
      let newGroup = document.querySelector(`[data-section-id="${sectionId}"]`);
      if (!newGroup) {
        const section = sections.find(s => s.id === sectionId);
        if (section) {
          newGroup = document.createElement('div');
          newGroup.className = 'section-group';
          newGroup.dataset.sectionId = sectionId;
          // 모든 사용자가 삭제 가능
          const deleteButton = `<button class="btn-section-group-delete" data-section-id="${sectionId}" title="구역 삭제">🗑️</button>`;
          newGroup.innerHTML = `<div class="section-group-header"><h4>${escapeHtml(section.name)}</h4>${deleteButton}</div>`;
          
          // 삭제 버튼 이벤트 (모든 사용자가 삭제 가능)
          newGroup.querySelector('.btn-section-group-delete')?.addEventListener('click', (e) => {
            const sectionIdToDelete = e.target.dataset.sectionId;
            if (confirm('구역을 삭제하시겠습니까? 구역의 모든 내용이 삭제됩니다.')) {
              socket.emit('deleteSection', { sectionId: sectionIdToDelete });
            }
          });
          
          const liveSections = document.getElementById('liveSections');
          liveSections.appendChild(newGroup);
        }
      }
      if (newGroup) {
        const emptySection = newGroup.querySelector('.section-empty');
        if (emptySection) {
          emptySection.remove();
        }
        newGroup.appendChild(userSection);
      }
    }
  }
}

