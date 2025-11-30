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
      webSecurity: false // 자체 서명 인증서 사용을 위해 임시로 비활성화
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
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: data.title || '',
      body: data.body || '❤️',
      silent: false,
      urgency: 'normal'
    });

    // 알림 클릭 시 창 포커스
    notification.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    notification.show();
    
    // 3초 후 자동 닫기 (작고 귀여운 느낌)
    setTimeout(() => {
      notification.close();
    }, 3000);
  }
});

