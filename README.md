# rapid-electron-ipc

### Introduction
An inter-process communication (IPC) solution for **Electron**, built on Electron's native IPC implementation. It is easy to use and is largely inspired by the **VSCode source code**.

### Installation
You can install with **yarn**, **npm**, or **pnpm**:

```bash
yarn add rapid-electron-ipc
npm i rapid-electron-ipc
pnpm add rapid-electron-ipc
```

---

## Usage

### **Main Process**

```ts
// main.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { createServer, DisposableStore, ProxyChannel } from 'rapid-electron-ipc/main';
import { FileSystemService } from './services/FileSystemService';

app.whenReady().then(() => {
  // Initialize the server IPC connection
  const server = createServer(ipcMain);

  // Register the file system service channel
  server.registerChannel('fileSystem', ProxyChannel.fromService(new FileSystemService(), new DisposableStore()));
});
```

---

### **Preload Script**

```ts
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import { registerAPI } from 'rapid-electron-ipc/preload';

contextBridge.exposeInMainWorld('$reactron', registerAPI(ipcRenderer));
```

---

### **Renderer Process**

```ts
// main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createClient } from 'rapid-electron-ipc/renderer';
import App from './App.tsx';

async function main() {
  // Initialize the client IPC connection
  await createClient(window.$reactron.ipcRenderer);

  const container = document.getElementById('root');
  if (!container) {
    // eslint-disable-next-line no-console
    console.error('Root container not found!');
    return;
  }

  const root = createRoot(container);
  root.render(<React.StrictMode><App /></React.StrictMode>);
}

document.addEventListener('DOMContentLoaded', main);
```

---

### **Using the Service in React**

```ts
// App.tsx
import { useEffect } from 'react';
import { useService } from 'rapid-electron-ipc/renderer';
import type { IFileSystemService } from './services/IFileSystemService';

// Retrieve the file system service
const fileSystemService = useService<IFileSystemService>('fileSystem');

useEffect(() => {
  // Fetch and log file system stats
  fileSystemService?.stat('C:\\Users').then(console.log);
}, [fileSystemService]);
```

---

### **Service Implementation**

#### **File System Service**

```ts
// services/FileSystemService.ts
import fs from 'fs/promises';
import type { IFileSystemService } from './IFileSystemService';

export class FileSystemService implements IFileSystemService {
  stat(source: string) {
    return fs.stat(source);
  }
}
```

#### **File System Service Interface**

```ts
// services/IFileSystemService.ts
export interface IFileSystemService {
  stat: (source: string) => Promise<any>;
}
```

## Contributing

Feel free to dive in! [Open an issue](https://github.com/xuanhoa88/rapid-electron-ipc/issues/new) or submit PRs.


## License

Licensed under [MIT](LICENSE) © 2024 xuanguyen
