import { toDisposable, ELBuffer, Emitter, Event, IPCServer, Router } from '../common';

export class Server extends IPCServer {
  static Clients = new Map();

  static getOnDidClientConnect(ipcMain) {
    const createScopedOnMessageEvent = (senderId, eventName) => {
      return Event.map(
        Event.filter(
          Event.fromNodeEventEmitter(ipcMain, eventName, (event, message) => ({ event, message })),
          ({ event }) => event.sender.id === senderId
        ),
        ({ message }) => (message ? ELBuffer.wrap(message) : message)
      );
    };

    return Event.map(
      Event.fromNodeEventEmitter(ipcMain, '_ipc:connect', ({ sender }) => sender),
      sender => {
        const { id: _id } = sender;

        const client = Server.Clients.get(_id);
        client?.dispose();

        const onDidClientReconnect = new Emitter();

        Server.Clients.set(
          _id,
          toDisposable(() => onDidClientReconnect.fire())
        );

        const router = new Router(sender, createScopedOnMessageEvent(_id, '_ipc:message'));

        return {
          router,
          onDidClientDisconnect: Event.any(
            Event.signal(createScopedOnMessageEvent(_id, '_ipc:disconnect')),
            onDidClientReconnect.event
          ),
        };
      }
    );
  }

  constructor(ipcMain) {
    super(Server.getOnDidClientConnect(ipcMain));
  }
}
