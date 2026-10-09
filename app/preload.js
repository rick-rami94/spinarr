const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set(['queue', 'queue-idle', 'drives-changed']);
const invoke = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('spinarr', {
  getSettings: invoke('settings:get'),
  setSettings: invoke('settings:set'),
  drives: invoke('drives'),
  scan: invoke('scan'),
  probe: invoke('probe'),
  rip: invoke('rip'),
  cancel: invoke('cancel'),
  clearFinished: invoke('clear-finished'),
  reveal: invoke('reveal'),
  eject: invoke('eject'),
  pickSource: invoke('pick-source'),
  pickOutput: invoke('pick-output'),
  freeSpace: invoke('free-space'),
  pathForFile: (f) => webUtils.getPathForFile(f),
  on: (ch, fn) => {
    if (!EVENTS.has(ch)) throw new Error(`Unknown event ${ch}`);
    const h = (_e, d) => fn(d);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
});
