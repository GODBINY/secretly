const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');

// 자체 서명 인증서 허용 (HTTPS 사용 시)
app.commandLine.appendSwitch('ignore-certificate-errors');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false, // 자체 서명 인증서 사용을 위해 임시로 비활성화
      partition: 'persist:secretly-chat' // localStorage 영구 저장을 위한 세션 파티션
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 개발자 도구 (개발 중에만)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 알림 표시 함수 (작고 귀여운 알림)
ipcMain.on('show-notification', (event, data) => {
  console.log('알림 수신:', data);
  if (Notification.isSupported()) {
    console.log('알림 지원됨, 알림 생성 중...');
    const notification = new Notification({
      title: data.title || '💬 새 메시지',
      body: data.body || '❤️',
      silent: false,
      urgency: 'normal'
    });

    // 알림 클릭 시 창 포커스
    notification.on('click', () => {
      console.log('알림 클릭됨');
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    notification.on('show', () => {
      console.log('알림 표시됨');
    });

    notification.on('error', (error) => {
      console.error('알림 오류:', error);
    });

    notification.show();
    console.log('알림 show() 호출 완료');
    
    // 3초 후 자동 닫기 (작고 귀여운 느낌)
    setTimeout(() => {
      notification.close();
    }, 3000);
  } else {
    console.log('알림이 지원되지 않음');
  }
});

