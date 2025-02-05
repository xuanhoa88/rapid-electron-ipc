// Validate IPC channel names before allowing communication.
const validateIPC = channelName => {
  if (!channelName || typeof channelName !== 'string' || !channelName.startsWith('_ipc:')) {
    throw new Error(
      `Invalid IPC channel: "${channelName}". Expected a non-empty string starting with "_ipc:".`
    );
  }
};

// Determine the Electron major version to check for deprecated features.
const electronMajorVer = parseInt(process.versions.electron.split('.')[0], 10);
const isElectron28OrNewer = electronMajorVer >= 28;

// Track active listeners to allow proper cleanup and avoid memory leaks.
const activeListeners = new Map();

/**
 * Creates a secure preload script API and exposes it in the renderer process.
 */
export function registerAPI(ipcRenderer) {
  // Define the API that will be exposed to the renderer process.
  return {
    ipcRenderer: {
      /**
       * Sends an asynchronous message to the main process.
       */
      send(channelName, ...args) {
        validateIPC(channelName);
        ipcRenderer.send(channelName, ...args);
      },

      /**
       * Sends a synchronous message to the main process and waits for a response.
       * ⚠️ This can block execution, so use it cautiously.
       */
      sendSync(channelName, ...args) {
        validateIPC(channelName);
        return ipcRenderer.sendSync(channelName, ...args);
      },

      /**
       * Sends a message to a specific webContents (used for communication between windows).
       * ❌ Removed in Electron 28+, so an error is thrown if used in newer versions.
       */
      sendTo(webContentsId, channelName, ...args) {
        validateIPC(channelName);
        if (isElectron28OrNewer) {
          throw new Error('"sendTo" method has been removed since Electron 28.');
        }
        ipcRenderer.sendTo(webContentsId, channelName, ...args);
      },

      /**
       * Sends a message to the host page in a webview.
       */
      sendToHost(channelName, ...args) {
        validateIPC(channelName);
        ipcRenderer.sendToHost(channelName, ...args);
      },

      /**
       * Posts a message to the main process with optional transferable objects.
       */
      postMessage(channelName, message, transfer) {
        validateIPC(channelName);
        ipcRenderer.postMessage(channelName, message, transfer);
      },

      /**
       * Sends a message to the main process and waits for a promise-based response.
       */
      invoke(channelName, ...args) {
        validateIPC(channelName);
        return ipcRenderer.invoke(channelName, ...args);
      },

      /**
       * Listens for messages from the main process.
       * Returns a cleanup function to remove the listener when no longer needed.
       */
      on(channelName, listener) {
        validateIPC(channelName);
        ipcRenderer.on(channelName, listener);

        // Track active listeners to facilitate cleanup.
        if (!activeListeners.has(channelName)) {
          activeListeners.set(channelName, new Set());
        }
        activeListeners.get(channelName).add(listener);

        return () => ipcRenderer.removeListener(channelName, listener);
      },

      /**
       * Listens for a single message from the main process, then removes the listener.
       * Returns a cleanup function for explicit removal.
       */
      once(channelName, listener) {
        validateIPC(channelName);
        ipcRenderer.once(channelName, listener);
        return () => ipcRenderer.removeListener(channelName, listener);
      },

      /**
       * Removes a specific listener from an IPC channel.
       */
      removeListener(channelName, listener) {
        validateIPC(channelName);
        ipcRenderer.removeListener(channelName, listener);
        activeListeners.get(channelName)?.delete(listener);
      },

      /**
       * Removes all listeners from a specific IPC channel.
       */
      removeAllListeners(channelName) {
        validateIPC(channelName);

        // Ensure tracked listeners are also removed.
        if (activeListeners.has(channelName)) {
          activeListeners
            .get(channelName)
            .forEach(listener => ipcRenderer.removeListener(channelName, listener));
          activeListeners.delete(channelName);
        }

        ipcRenderer.removeAllListeners(channelName);
      },
    },
  };
}
