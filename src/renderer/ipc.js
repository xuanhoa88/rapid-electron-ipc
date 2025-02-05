import { ELBuffer, Event, IPCClient, Router } from '../common';

const createRouter = sender => {
  if (!sender?.send) throw new Error(`Unsupported emitter IPC named "send"`);
  sender.send('_ipc:connect');

  return new Router(
    sender,
    Event.fromNodeEventEmitter(sender, '_ipc:message', (_, message) => ELBuffer.wrap(message))
  );
};

export class Client extends IPCClient {
  constructor(sender, _id) {
    const router = createRouter(sender);
    super(router, _id);
    this.router = router;
  }

  dispose() {
    this.router.disconnect();
    super.dispose();
  }
}
