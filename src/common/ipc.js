import { CancellationError, CancellationToken, createCancelablePromise } from './cancellation';
import { Emitter, Event, EventMultiplexer, Relay } from './event';
import { BufferReader, BufferWriter, deserialize, serialize } from './utils/buffer';
import { DisposableStore, combinedDisposable, dispose, toDisposable } from './utils/Disposable';

// State enum
const State = {
  Uninitialized: 0,
  Idle: 1,
};

// RequestType enum
const RequestType = {
  Promise: 100,
  PromiseCancel: 101,
  EventListen: 102,
  EventDispose: 103,
};

const ResponseType = {
  Initialize: 200,
  PromiseSuccess: 201,
  PromiseError: 202,
  PromiseErrorObj: 203,
  EventFire: 204,
};

const getRandomElement = arr => arr[Math.floor(Math.random() * arr.length)];

const getDelayedChannel = promise => ({
  call(command, arg, cancellationToken) {
    return promise.then(c => c.call(command, arg, cancellationToken));
  },
  listen(event, arg) {
    const relay = new Relay();
    promise.then(c => (relay.input = c.listen(event, arg)));
    return relay.event;
  },
});

class ChannelClient {
  constructor(router) {
    this._state = State.Uninitialized;
    this._activeRequests = new Set();
    this._lastRequestId = 0;
    this._handlers = new Map();
    this._onDidInitialize = new Emitter();
    this._isDisposed = false;
    this._router = router;
    this._routerListener = this._router.onMessage(msg => this.onBuffer(msg));
  }

  get onDidInitialize() {
    return this._onDidInitialize.event;
  }

  getChannel(channelName) {
    return {
      call: (command, arg, cancellationToken) => {
        if (this._isDisposed) {
          return Promise.reject(new CancellationError());
        }
        return this.requestPromise(channelName, command, arg, cancellationToken);
      },
      listen: (event, arg) => {
        if (this._isDisposed) {
          return Event.None;
        }
        return this.requestEvent(channelName, event, arg);
      },
    };
  }

  requestEvent(channelName, name, arg) {
    const id = this._lastRequestId++;
    const type = RequestType.EventListen;
    const request = { id, type, channelName, name, arg };

    let uninitializedPromise = null;

    const emitter = new Emitter({
      onWillAddFirstListener: () => {
        uninitializedPromise = createCancelablePromise(() => this.whenInitialized());
        uninitializedPromise.then(() => {
          uninitializedPromise = null;
          this._activeRequests.add(emitter);
          this.sendRequest(request);
        });
      },
      onDidRemoveLastListener: () => {
        if (uninitializedPromise) {
          uninitializedPromise.cancel();
          uninitializedPromise = null;
        } else {
          this._activeRequests.delete(emitter);
          this.sendRequest({ id, type: RequestType.EventDispose });
        }
      },
    });

    const handler = res => emitter.fire(res.data);
    this._handlers.set(id, handler);

    return emitter.event;
  }

  get onDidInitializePromise() {
    return Event.toPromise(this.onDidInitialize);
  }

  whenInitialized() {
    if (this._state === State.Idle) {
      return Promise.resolve();
    }
    return this.onDidInitializePromise;
  }

  requestPromise(channelName, name, arg, cancellationToken = CancellationToken.None) {
    const id = this._lastRequestId++;
    const type = RequestType.Promise;
    const request = { id, type, channelName, name, arg };

    if (cancellationToken.isCancellationRequested) {
      return Promise.reject(new CancellationError());
    }

    let disposable;

    const result = new Promise((resolve, reject) => {
      if (cancellationToken.isCancellationRequested) {
        return reject(new CancellationError());
      }

      const doRequest = () => {
        const handler = response => {
          switch (response.type) {
            case ResponseType.PromiseSuccess: {
              this._handlers.delete(id);
              resolve(response.data);
              break;
            }
            case ResponseType.PromiseError: {
              this._handlers.delete(id);
              const error = new Error(response.data.message);
              error.stack = Array.isArray(response.data.stack)
                ? response.data.stack.join('\n')
                : response.data.stack;
              error.name = response.data.name;
              reject(error);
              break;
            }
            case ResponseType.PromiseErrorObj: {
              this._handlers.delete(id);
              reject(response.data);
              break;
            }
          }
        };

        this._handlers.set(id, handler);
        this.sendRequest(request);
      };

      let uninitializedPromise = null;
      if (this._state === State.Idle) {
        doRequest();
      } else {
        uninitializedPromise = createCancelablePromise(() => this.whenInitialized());
        uninitializedPromise.then(() => {
          uninitializedPromise = null;
          doRequest();
        });
      }

      const cancel = () => {
        if (uninitializedPromise) {
          uninitializedPromise.cancel();
          uninitializedPromise = null;
        } else {
          this.sendRequest({ id, type: RequestType.PromiseCancel });
        }

        reject(new CancellationError());
      };

      const cancellationTokenListener = cancellationToken.onCancellationRequested(cancel);
      disposable = combinedDisposable(toDisposable(cancel), cancellationTokenListener);
      this._activeRequests.add(disposable);
    });

    return result.finally(() => {
      disposable.dispose();
      this._activeRequests.delete(disposable);
    });
  }

  sendRequest(request) {
    switch (request.type) {
      case RequestType.Promise:
      case RequestType.EventListen: {
        return this.send(
          [request.type, request.id, request.channelName, request.name],
          request.arg
        );
      }
      case RequestType.PromiseCancel:
      case RequestType.EventDispose: {
        return this.send([request.type, request.id]);
      }
    }
  }

  send(header, body = undefined) {
    const writer = new BufferWriter();
    serialize(writer, header);
    serialize(writer, body);
    return this.sendBuffer(writer.buffer);
  }

  sendBuffer(message) {
    try {
      this._router.send(message);
      return message.byteLength;
    } catch {
      return 0;
    }
  }

  onBuffer(msg) {
    const reader = new BufferReader(msg);
    const header = deserialize(reader);
    const body = deserialize(reader);
    const type = header[0];

    switch (type) {
      case ResponseType.Initialize: {
        return this.onResponse({ type });
      }
      case ResponseType.PromiseSuccess:
      case ResponseType.PromiseError:
      case ResponseType.EventFire:
      case ResponseType.PromiseErrorObj: {
        return this.onResponse({ type, id: header[1], data: body });
      }
    }
  }

  onResponse(response) {
    if (response.type === ResponseType.Initialize) {
      this._state = State.Idle;
      this._onDidInitialize.fire();
      return;
    }

    const handler = this._handlers.get(response.id);
    handler?.(response);
  }

  dispose() {
    this._isDisposed = true;
    if (this._routerListener) {
      this._routerListener.dispose();
      this._routerListener = null;
    }
    dispose(this._activeRequests.values());
    this._activeRequests.clear();
  }
}

class ChannelServer {
  constructor(router, _id) {
    this.router = router;
    this._id = _id;
    this.channels = new Map();
    this.protocolListener = this.router.onMessage(msg => this.onRawMessage(msg));
    this.sendResponse({ type: ResponseType.Initialize });
    this.activeRequests = new Map();
    this.pendingRequests = new Map();
  }

  onRawMessage(msg) {
    const reader = new BufferReader(msg);
    const header = deserialize(reader);
    const body = deserialize(reader);
    const type = header[0];

    switch (type) {
      case RequestType.Promise: {
        return this.onPromise({
          type: RequestType.Promise,
          id: header[1],
          channelName: header[2],
          name: header[3],
          arg: body,
        });
      }
      case RequestType.EventListen: {
        return this.onEventListen({
          type,
          id: header[1],
          channelName: header[2],
          name: header[3],
          arg: body,
        });
      }
    }
  }

  collectPendingRequest(request) {
    let pendingRequests = this.pendingRequests.get(request.channelName);

    if (!pendingRequests) {
      pendingRequests = [];
      this.pendingRequests.set(request.channelName, pendingRequests);
    }

    const timer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error(`Unknown channel: ${request.channelName}`);

      if (request.type === RequestType.Promise) {
        this.sendResponse({
          id: request.id,
          data: {
            name: 'Unknown channel',
            message: `Channel name "${request.channelName}" timed out after 200ms`,
            stack: undefined,
          },
          type: ResponseType.PromiseError,
        });
      }
    }, 200);

    pendingRequests.push({ request, timeoutTimer: timer });
  }

  onEventListen(request) {
    const channel = this.channels.get(request.channelName);
    if (!channel) {
      this.collectPendingRequest(request);
      return;
    }

    const { id } = request;
    const event = channel.listen(this._id, request.name, request.arg);
    const disposable = event(data => this.sendResponse({ id, data, type: ResponseType.EventFire }));
    this.activeRequests.set(id, disposable);
  }

  onPromise(request) {
    const channel = this.channels.get(request.channelName);
    if (!channel) {
      return;
    }

    let promise;
    try {
      promise = channel.call(this._id, request.name, request.arg);
    } catch (e) {
      promise = Promise.reject(e);
    }

    const { id } = request;

    promise
      .then(
        data => {
          this.sendResponse({
            id,
            data,
            type: ResponseType.PromiseSuccess,
          });
        },
        err => {
          if (err instanceof Error) {
            this.sendResponse({
              id,
              data: {
                message: err.message,
                name: err.name,
                stack: err.stack ? err.stack.split('\n') : undefined,
              },
              type: ResponseType.PromiseError,
            });
          } else {
            this.sendResponse({
              id,
              data: err,
              type: ResponseType.PromiseErrorObj,
            });
          }
        }
      )
      .finally(() => {
        this.activeRequests.delete(id);
      });
    const disposable = { dispose: () => {} };
    this.activeRequests.set(id, disposable);
  }

  sendResponse(response) {
    switch (response.type) {
      case ResponseType.Initialize: {
        return this.send([response.type]);
      }
      case ResponseType.PromiseSuccess:
      case ResponseType.PromiseError:
      case ResponseType.EventFire:
      case ResponseType.PromiseErrorObj: {
        return this.send([response.type, response.id], response.data);
      }
    }
  }

  send(header, body = undefined) {
    const writer = new BufferWriter();
    serialize(writer, header);
    serialize(writer, body);
    return this.sendBuffer(writer.buffer);
  }

  sendBuffer(message) {
    try {
      this.router.send(message);
      return message.byteLength;
    } catch {
      return 0;
    }
  }

  registerChannel(channelName, channel) {
    this.channels.set(channelName, channel);
  }

  dispose() {
    if (this.protocolListener) {
      this.protocolListener.dispose();
      this.protocolListener = null;
    }
    dispose(this.activeRequests.values());
    this.activeRequests.clear();
  }
}

export class IPCClient {
  constructor(router, _id) {
    const writer = new BufferWriter();
    serialize(writer, _id);
    router.send(writer.buffer);

    this.channelServer = new ChannelServer(router, _id);
    this.channelClient = new ChannelClient(router);
  }

  getChannel(channelName) {
    return this.channelClient.getChannel(channelName);
  }

  registerChannel(channelName, channel) {
    this.channelServer.registerChannel(channelName, channel);
  }

  dispose() {
    this.channelClient.dispose();
    this.channelServer.dispose();
  }
}

export class IPCServer {
  constructor(onDidClientConnect) {
    this.channels = new Map();
    this._connections = new Set();

    this._onDidAddConnection = new Emitter();
    this.onDidAddConnection = this._onDidAddConnection.event;

    this._onDidRemoveConnection = new Emitter();
    this.onDidRemoveConnection = this._onDidRemoveConnection.event;

    this.disposables = new DisposableStore();

    this.disposables.add(
      onDidClientConnect(({ router, onDidClientDisconnect }) =>
        this.disposables.add(
          Event.once(router.onMessage)(msg => {
            const reader = new BufferReader(msg);
            const _id = deserialize(reader);

            const channelServer = new ChannelServer(router, _id);
            const channelClient = new ChannelClient(router);

            this.channels.forEach((channel, name) => channelServer.registerChannel(name, channel));

            const connection = { channelServer, channelClient, _id };

            this._connections.add(connection);
            this._onDidAddConnection.fire(connection);

            this.disposables.add(
              onDidClientDisconnect(() => {
                channelServer.dispose();
                channelClient.dispose();
                this._connections.delete(connection);
                this._onDidRemoveConnection.fire(connection);
              })
            );
          })
        )
      )
    );
  }

  getChannel(channelName, routerOrClientFilter) {
    return {
      call: (command, arg, cancellationToken) => {
        let connectionPromise;

        if (typeof routerOrClientFilter === 'function') {
          const connection = getRandomElement(this.connections.filter(routerOrClientFilter));
          connectionPromise = connection
            ? Promise.resolve(connection)
            : Event.toPromise(Event.filter(this.onDidAddConnection, routerOrClientFilter));
        } else {
          connectionPromise = routerOrClientFilter.routeCall(this, command, arg);
        }

        const channelPromise = connectionPromise.then(connection =>
          connection.channelClient.getChannel(channelName)
        );

        return getDelayedChannel(channelPromise).call(command, arg, cancellationToken);
      },
      listen: (event, arg) => {
        if (typeof routerOrClientFilter === 'function') {
          return this.getMulticastEvent(channelName, routerOrClientFilter, event, arg);
        }

        const channelPromise = routerOrClientFilter
          .routeEvent(this, event, arg)
          .then(connection => connection.channelClient.getChannel(channelName));

        return getDelayedChannel(channelPromise).listen(event, arg);
      },
    };
  }

  getMulticastEvent(channelName, clientFilter, eventName, arg) {
    let disposables;

    const emitter = new Emitter({
      onWillAddFirstListener: () => {
        disposables = new DisposableStore();

        const eventMultiplexer = new EventMultiplexer();
        const map = new Map();

        const onDidAddConnection = connection => {
          const channel = connection.channelClient.getChannel(channelName);
          const event = channel.listen(eventName, arg);
          const disposable = eventMultiplexer.add(event);

          map.set(connection, disposable);
        };

        const onDidRemoveConnection = connection => {
          const disposable = map.get(connection);

          if (!disposable) {
            return;
          }

          disposable.dispose();
          map.delete(connection);
        };

        this.connections.filter(clientFilter).forEach(onDidAddConnection);
        Event.filter(this.onDidAddConnection, clientFilter)(
          onDidAddConnection,
          undefined,
          disposables
        );
        this.onDidRemoveConnection(onDidRemoveConnection, undefined, disposables);
        eventMultiplexer.event(emitter.fire, emitter, disposables);

        disposables.add(eventMultiplexer);
      },
      onDidRemoveLastListener: () => {
        disposables?.dispose();
        disposables = undefined;
      },
    });

    return emitter.event;
  }

  registerChannel(channelName, channel) {
    this.channels.set(channelName, channel);

    for (const connection of this._connections) {
      connection.channelServer.registerChannel(channelName, channel);
    }
  }

  dispose() {
    this.disposables.dispose();

    for (const connection of this._connections) {
      connection.channelClient.dispose();
      connection.channelServer.dispose();
    }

    this._connections.clear();
    this.channels.clear();
    this._onDidAddConnection.dispose();
    this._onDidRemoveConnection.dispose();
  }
}
