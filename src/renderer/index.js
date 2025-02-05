import { ProxyChannel } from '../common';
import { Client } from './ipc';

let client = null;

/**
 * Initializes the IPC client if not already created.
 * @param {Function} sender - The IPC sender function.
 * @param {Function} webContentsId - A function that returns the webContents ID.
 * @returns {Promise<void>}
 * @throws {Error} If webContentsId is not a function or returns an invalid ID.
 */
export async function createClient(sender, webContentsId) {
  if (client) return;

  const _id = await (webContentsId?.() || sender.invoke('_ipc:get-context'));
  if (!_id) {
    throw new Error('Failed to retrieve the window ID. Ensure webContentsId() returns a valid ID.');
  }

  client = new Client(sender, _id);
}

/**
 * Retrieves a service channel from the IPC client.
 * @param {string} channelName - The name of the IPC channel.
 * @returns {ProxyChannel} The proxied service channel.
 * @throws {Error} If the client is not initialized.
 */
export function useService(channelName) {
  return ProxyChannel.toService(client?.getChannel(channelName));
}

/**
 * Resets the IPC client. Useful for reinitialization.
 */
export function resetClient() {
  client = null;
}
