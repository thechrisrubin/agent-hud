// The only bridge between the renderer and the rest of the app.
//
// contextIsolation is on and nodeIntegration is off, so the page cannot touch
// the filesystem, the network, or the state engine. It can call exactly the
// six things below and nothing else.

import { contextBridge, ipcRenderer } from 'electron';
import type { HudSnapshot } from '../shared/types.js';

contextBridge.exposeInMainWorld('hud', {
  onSnapshot: (cb: (snap: HudSnapshot) => void) => {
    ipcRenderer.on('hud:snapshot', (_e, snap: HudSnapshot) => cb(snap));
  },
  onFocusTile: (cb: (threadId: string) => void) => {
    ipcRenderer.on('hud:focus-tile', (_e, id: string) => cb(id));
  },
  acknowledge: (threadId: string): Promise<boolean> =>
    ipcRenderer.invoke('hud:acknowledge', threadId),
  jump: (threadId: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('hud:jump', threadId),
  toggleQuiet: (): Promise<boolean> => ipcRenderer.invoke('hud:toggle-quiet'),
  toggleOnTop: (): Promise<boolean> => ipcRenderer.invoke('hud:toggle-on-top'),
  close: (): Promise<void> => ipcRenderer.invoke('hud:close'),
  minimize: (): Promise<void> => ipcRenderer.invoke('hud:minimize'),
});
