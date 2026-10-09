// Renders build/icon.html to build/icon.png (1024x1024) with Electron: `npm run icon`.
// electron-builder derives the .icns/.ico/Linux sizes from it, and the app window uses it on Linux.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true,
    webPreferences: { offscreen: true, zoomFactor: 1 } });
  await win.loadFile(path.join(__dirname, 'icon.html'));
  await new Promise((r) => setTimeout(r, 500));
  let img = await win.webContents.capturePage();
  if (img.getSize().width !== 1024) img = img.resize({ width: 1024, height: 1024, quality: 'best' });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), img.toPNG());
  fs.copyFileSync(path.join(__dirname, 'icon.png'), path.join(__dirname, '..', 'app', 'icon.png'));
  console.log('build/icon.png', img.getSize());
  app.quit();
});
