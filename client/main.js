const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Allow self-signed certs (existing behavior).
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
      webSecurity: false,
      partition: 'persist:secretly-chat'
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Stop flashing once user focuses the app.
  mainWindow.on('focus', () => {
    if (mainWindow) {
      mainWindow.flashFrame(false);
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

// Preview-free activity indicator only.
ipcMain.on('show-notification', () => {
  if (!mainWindow) return;
  mainWindow.flashFrame(true);
});
