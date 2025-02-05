import { DisposableStore, ProxyChannel } from '../common';
import { Server } from './ipc';

function createServer(ipcMain, webContentsId) {
  ipcMain.handle('_ipc:get-context', event => webContentsId?.(event) || event.sender.id);
  return new Server(ipcMain);
}

export { DisposableStore, ProxyChannel, createServer };
