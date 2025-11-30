const { ipcRenderer } = require('electron');

// 서버 주소 (localStorage에서 불러오거나 기본값 사용)
let SERVER_URL = localStorage.getItem('serverUrl') || 'https://localhost:3000';

let socket;
let currentRoomId = 'general';
let currentRoomType = 'chat';
let nickname = '';
let nicknameType = 'emoji'; // 'emoji' 또는 'text'
let selectedEmoji = null;
let nicknameColor = null;
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
  // 닉네임 타입 변경
  document.querySelectorAll('input[name="nicknameType"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      nicknameType = e.target.value;
      const emojiSection = document.getElementById('emojiNicknameSection');
      const textSection = document.getElementById('textNicknameSection');
      if (e.target.value === 'emoji') {
        emojiSection.style.display = 'block';
        textSection.style.display = 'none';
      } else {
        emojiSection.style.display = 'none';
        textSection.style.display = 'block';
        const textInput = document.getElementById('nicknameInput');
        if (textInput.value) {
          updateColorPreview(textInput.value);
        }
      }
    });
  });

  // 텍스트 닉네임 입력 시 색상 미리보기
  document.getElementById('nicknameInput').addEventListener('input', (e) => {
    if (nicknameType === 'text' && e.target.value) {
      updateColorPreview(e.target.value);
    }
  });

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

  // 닉네임 확인
  document.getElementById('confirmNicknameBtn').addEventListener('click', () => {
    const nicknameTypeRadio = document.querySelector('input[name="nicknameType"]:checked');
    nicknameType = nicknameTypeRadio.value;
    
    if (nicknameType === 'emoji') {
      // 직접 입력 필드 확인
      const emojiInput = document.getElementById('emojiInput');
      const directInput = emojiInput ? emojiInput.value.trim() : '';
      
      if (directInput) {
        selectedEmoji = directInput;
        nickname = directInput;
      } else if (selectedEmoji) {
        nickname = selectedEmoji;
      } else {
        alert('이모티콘을 선택하거나 입력해주세요.');
        return;
      }
    } else {
      const input = document.getElementById('nicknameInput');
      nickname = input.value.trim() || `사용자${Math.random().toString(36).substr(2, 6)}`;
      nicknameColor = generateUserColor(nickname);
    }
    
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
  
  // 기본값 설정
  const nicknameTypeRadio = document.querySelector('input[name="nicknameType"]:checked');
  if (nicknameTypeRadio && nicknameTypeRadio.value === 'emoji') {
    document.getElementById('emojiNicknameSection').style.display = 'block';
    document.getElementById('textNicknameSection').style.display = 'none';
  } else {
    document.getElementById('emojiNicknameSection').style.display = 'none';
    document.getElementById('textNicknameSection').style.display = 'block';
    document.getElementById('nicknameInput').focus();
  }

  // 모달 외부 클릭 시 닫지 않음 (닉네임은 필수)
  document.getElementById('nicknameModal').addEventListener('click', (e) => {
    if (e.target.id === 'nicknameModal') {
      // 닉네임은 필수이므로 외부 클릭으로 닫지 않음
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
      nickname, 
      nicknameType,
      emoji: nicknameType === 'emoji' ? selectedEmoji : null,
      color: nicknameType === 'text' ? nicknameColor : null,
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
      if (liveInput && data.liveContent && data.liveContent[nickname]) {
        liveInput.value = data.liveContent[nickname].text || '';
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
    if (message.nickname === nickname) {
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
      if (message.nickname !== nickname) {
        showNotification('새 메시지', `${message.nickname}: ${message.text}`);
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
        nickname: data.nickname,
        nicknameType: data.nicknameType || 'text',
        emoji: data.emoji || null,
        color: data.color || null
      };
      updateLiveContentSection(data.nickname, data.text, data.sectionId, userInfo);
    }
  });

  // 구역 목록 업데이트
  socket.on('sectionsUpdated', (updatedSections) => {
    sections = updatedSections;
    // 현재 표시된 내용도 다시 정리
    if (currentRoomType === 'live') {
      const liveContent = {};
      document.querySelectorAll('.live-section').forEach(section => {
        const userNickname = section.dataset.liveUser;
        const contentDiv = section.querySelector('.live-section-content');
        let text = '';
        if (contentDiv) {
          const emptyContent = contentDiv.querySelector('.empty-content');
          if (!emptyContent) {
            text = contentDiv.textContent || contentDiv.innerText || '';
          }
        }
        const sectionId = section.dataset.sectionId;
        if (userNickname) {
          liveContent[userNickname] = { text, sectionId };
        }
      });
      
      // 기존 구역들의 헤더 정보 업데이트 (구역 이름 등)
      updatedSections.forEach(section => {
        const sectionGroup = document.querySelector(`[data-section-id="${section.id}"]`);
        if (sectionGroup) {
          const header = sectionGroup.querySelector('.section-group-header');
          if (header) {
            const isOwner = section.owner === nickname;
            const deleteButton = `<button class="btn-section-group-delete" data-section-id="${section.id}" title="구역 삭제" ${!isOwner ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>🗑️</button>`;
            header.innerHTML = `<span class="drag-handle">☰</span><h4>${escapeHtml(section.name)}</h4>${deleteButton}`;
            
            // 삭제 버튼 이벤트 다시 등록
            const deleteBtn = header.querySelector('.btn-section-group-delete');
            if (deleteBtn && isOwner) {
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
    if (currentRoomType === 'live') {
      const sectionGroup = document.querySelector(`[data-section-id="${data.sectionId}"]`);
      if (sectionGroup) {
        sectionGroup.remove();
      }
      // sections 배열에서도 제거
      sections = sections.filter(s => s.id !== data.sectionId);
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
    showTypingIndicator(data.nickname);
  });

  socket.on('typingStop', (data) => {
    hideTypingIndicator(data.nickname);
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

  const isAuthor = message.nickname === nickname;
  const deleteButtonHTML = isAuthor ? `<button class="btn-message-delete" data-message-id="${message.id}" title="삭제">🗑️</button>` : '';

  // 닉네임 표시 (이모티콘 또는 색상 적용)
  let nicknameDisplay = '';
  if (message.nicknameType === 'emoji' && message.emoji) {
    nicknameDisplay = `<span class="message-nickname emoji-nickname">${message.emoji}</span>`;
  } else {
    const color = message.color || generateUserColor(message.nickname);
    nicknameDisplay = `<span class="message-nickname text-nickname" style="color: ${color};">${escapeHtml(message.nickname)}</span>`;
  }

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
      nickname: nickname,
      nicknameType: nicknameType,
      emoji: selectedEmoji,
      color: nicknameColor,
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
    const isAuthor = notice.author === nickname;
    
    // 공지 작성자 닉네임 표시
    let authorDisplay = '';
    if (notice.authorNicknameType === 'emoji' && notice.authorEmoji) {
      authorDisplay = notice.authorEmoji;
    } else {
      const color = notice.authorColor || generateUserColor(notice.author);
      authorDisplay = `<span style="color: ${color};">${escapeHtml(notice.author)}</span>`;
    }
    
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
  const existingAnswer = document.querySelector(`[data-answer-author="${answer.nickname}"]`);
  if (existingAnswer) {
    existingAnswer.remove();
  }
  
  const answerDiv = document.createElement('div');
  answerDiv.className = 'sidebar-answer-item';
  answerDiv.dataset.answerId = answer.id;
  answerDiv.dataset.answerAuthor = answer.nickname;

  const time = new Date(answer.timestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const isAuthor = answer.nickname === nickname;
  const actionsHTML = isAuthor ? `
    <div class="answer-actions" style="margin-top: 3px; display: flex; gap: 3px;">
      <button class="btn-answer-edit" data-answer-id="${answer.id}" style="font-size: 9px; padding: 2px 5px;">수정</button>
      <button class="btn-answer-delete" data-answer-id="${answer.id}" style="font-size: 9px; padding: 2px 5px;">삭제</button>
    </div>
  ` : '';

  // 답변 작성자 닉네임 표시
  let answerAuthorDisplay = '';
  if (answer.nicknameType === 'emoji' && answer.emoji) {
    answerAuthorDisplay = `<span class="sidebar-answer-author emoji-nickname">${answer.emoji}</span>`;
  } else {
    const color = answer.color || generateUserColor(answer.nickname);
    answerAuthorDisplay = `<span class="sidebar-answer-author text-nickname" style="color: ${color};">${escapeHtml(answer.nickname)}</span>`;
  }

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
    const isMyAnswer = answerDiv.dataset.answerAuthor === nickname;
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
  // 창이 포커스되어 있지 않을 때만 알림 표시
  if (!document.hasFocus()) {
    ipcRenderer.send('show-notification', { 
      title: '', // 제목 없음
      body: '❤️' // 하트 이모티콘만 표시
    });
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
  const existingOrder = Array.from(liveSections.children).map(child => child.dataset.sectionId).filter(id => id);
  
  liveSections.innerHTML = '';

  // 구역별로 그룹화
  const contentBySection = {};
  Object.keys(liveContent).forEach(nickname => {
    const content = liveContent[nickname];
    // content가 객체인 경우와 문자열인 경우 모두 처리
    const sectionId = (typeof content === 'object' && content.sectionId) ? content.sectionId : '';
    const text = (typeof content === 'object' && content.text !== undefined) ? content.text : (typeof content === 'string' ? content : '');
    
    if (!contentBySection[sectionId]) {
      contentBySection[sectionId] = [];
    }
    const userInfo = {
      nickname,
      nicknameType: liveContent[nickname].nicknameType || 'text',
      emoji: liveContent[nickname].emoji || null,
      color: liveContent[nickname].color || null,
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
    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'section-group';
    sectionDiv.dataset.sectionId = section.id;
    sectionDiv.draggable = true;
    
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'section-group-header';
    const isOwner = section.owner === nickname;
    // 구역 소유자만 삭제 가능하지만 버튼은 항상 표시 (비활성화)
    const deleteButton = `<button class="btn-section-group-delete" data-section-id="${section.id}" title="구역 삭제" ${!isOwner ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>🗑️</button>`;
    sectionHeader.innerHTML = `<span class="drag-handle">☰</span><h4>${escapeHtml(section.name)}</h4>${deleteButton}`;
    sectionDiv.appendChild(sectionHeader);

    // 삭제 버튼 이벤트 (구역 소유자만 삭제 가능)
    const deleteBtn = sectionHeader.querySelector('.btn-section-group-delete');
    if (deleteBtn && isOwner) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sectionIdToDelete = e.target.dataset.sectionId;
        if (confirm('구역을 삭제하시겠습니까? 구역의 모든 내용이 삭제됩니다.')) {
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
      const { nickname: userNickname, text } = userInfo;
      const userSection = createUserSection(userNickname, text, section.id, section.owner === userNickname, userInfo);
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

function createUserSection(userNickname, text, sectionId, isOwner, userInfo = null) {
  const section = document.createElement('div');
  section.className = 'live-section';
  section.dataset.liveUser = userNickname;
  section.dataset.sectionId = sectionId;
  
  // 닉네임 표시 (이모티콘 또는 색상 적용)
  let nicknameDisplay = '';
  if (userInfo && userInfo.nicknameType === 'emoji' && userInfo.emoji) {
    nicknameDisplay = `<span class="live-section-nickname emoji-nickname">${userInfo.emoji}</span>`;
  } else {
    const color = (userInfo && userInfo.color) || generateUserColor(userNickname);
    nicknameDisplay = `<span class="live-section-nickname text-nickname" style="color: ${color};">${escapeHtml(userNickname)}</span>`;
  }
  
  section.innerHTML = `
    <div class="live-section-header">
      ${nicknameDisplay}
    </div>
    <div class="live-section-content">${text && text.trim() ? escapeHtml(text).replace(/\n/g, '<br>') : '<span class="empty-content">(비어있음)</span>'}</div>
  `;
  
  return section;
}

function updateLiveContentSection(userNickname, text, sectionId) {
  if (currentRoomType !== 'live') return;
  
  // 기존 섹션 찾기
  let userSection = document.querySelector(`[data-live-user="${userNickname}"]`);
  
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
      const isOwner = userNickname === nickname;
      const deleteButton = `<button class="btn-section-group-delete" data-section-id="${sectionId}" title="구역 삭제" ${!isOwner ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>🗑️</button>`;
      sectionHeader.innerHTML = `<span class="drag-handle">☰</span><h4>${escapeHtml(userNickname)}</h4>${deleteButton}`;
      sectionGroup.appendChild(sectionHeader);
      
      // 삭제 버튼 이벤트
      const deleteBtn = sectionHeader.querySelector('.btn-section-group-delete');
      if (deleteBtn && isOwner) {
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
          name: `${userNickname}`,
          owner: userNickname,
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
      const isOwner = section && section.owner === userNickname;
      userSection = createUserSection(userNickname, text, sectionId, isOwner, userInfo);
      sectionGroup.appendChild(userSection);
    }
  } else {
    // 기존 섹션 업데이트
    const contentDiv = userSection.querySelector('.live-section-content');
    if (contentDiv) {
      contentDiv.innerHTML = text && text.trim() ? escapeHtml(text).replace(/\n/g, '<br>') : '<span class="empty-content">(비어있음)</span>';
    }
    // 닉네임 표시 업데이트 (userInfo가 있는 경우)
    if (userInfo) {
      const nicknameSpan = userSection.querySelector('.live-section-nickname');
      if (nicknameSpan) {
        if (userInfo.nicknameType === 'emoji' && userInfo.emoji) {
          nicknameSpan.className = 'live-section-nickname emoji-nickname';
          nicknameSpan.textContent = userInfo.emoji;
        } else {
          const color = userInfo.color || generateUserColor(userNickname);
          nicknameSpan.className = 'live-section-nickname text-nickname';
          nicknameSpan.style.color = color;
          nicknameSpan.textContent = userNickname;
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
          const isOwner = section.owner === nickname;
          const deleteButton = isOwner ? `<button class="btn-section-group-delete" data-section-id="${sectionId}" title="구역 삭제">🗑️</button>` : '';
          newGroup.innerHTML = `<div class="section-group-header"><h4>${escapeHtml(section.name)}</h4>${deleteButton}</div>`;
          
          // 삭제 버튼 이벤트
          if (isOwner) {
            newGroup.querySelector('.btn-section-group-delete')?.addEventListener('click', (e) => {
              const sectionIdToDelete = e.target.dataset.sectionId;
              if (confirm('구역을 삭제하시겠습니까? 구역의 모든 내용이 삭제됩니다.')) {
                socket.emit('deleteSection', { sectionId: sectionIdToDelete });
              }
            });
          }
          
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

