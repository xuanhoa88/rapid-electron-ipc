export class Router {
  constructor(sender, onMessage) {
    this.sender = sender;
    this.onMessage = onMessage;
  }

  send(message) {
    this.sender.send('_ipc:message', message.buffer);
  }

  disconnect() {
    this.sender.send('_ipc:disconnect', null);
  }
}
