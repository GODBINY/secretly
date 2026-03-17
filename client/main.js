const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Allow self-signed certs (existing behavior).
app.commandLine.appendSwitch('ignore-certificate-errors');

let mainWindow;
let hasPendingMention = false;
let isMiniMode = false;
const BASE_TITLE = '🤔';
const NORMAL_SIZE = { width: 900, height: 700 };
const MINI_SIZE = { width: 360, height: 520 };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: NORMAL_SIZE.width,
    height: NORMAL_SIZE.height,
    minWidth: 400,
    minHeight: 300,
    transparent: true,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      partition: 'persist:secretly-chat'
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.focus();
  });

  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 포커스 시: 플래시 중지, 태그 인디케이터 제거
  mainWindow.on('focus', () => {
    if (!mainWindow) return;
    mainWindow.flashFrame(false);
    if (hasPendingMention) {
      hasPendingMention = false;
      mainWindow.setTitle(BASE_TITLE);
    }
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

// 커스텀 윈도우 컨트롤
ipcMain.on('window-close', () => { mainWindow?.close(); });
ipcMain.on('window-minimize', () => { mainWindow?.minimize(); });
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

// 투명 미니 모드
ipcMain.on('set-mini-mode', (_, mini) => {
  if (!mainWindow) return;
  isMiniMode = mini;
  if (mini) {
    mainWindow.setSize(MINI_SIZE.width, MINI_SIZE.height);
  } else {
    mainWindow.setSize(NORMAL_SIZE.width, NORMAL_SIZE.height);
  }
});

// 일반 메시지 알림 (주황색 깜빡임)
ipcMain.on('show-notification', () => {
  if (!mainWindow || mainWindow.isFocused()) return;
  mainWindow.flashFrame(true);
});

// 태그 알림 (파란색 제목 표시 + 깜빡임, 포커스 전까지 유지)
ipcMain.on('show-mention', () => {
  if (!mainWindow) return;
  hasPendingMention = true;
  mainWindow.setTitle('🔵 ' + BASE_TITLE);
  if (!mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
});
