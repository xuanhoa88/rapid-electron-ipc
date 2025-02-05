import { Disposable, DisposableStore, combinedDisposable, toDisposable } from './utils/Disposable';

let id = 0;

class UniqueContainer {
  value;
  stack;
  id = id++;
  constructor(value) {
    this.value = value;
  }
}

class EventDeliveryQueuePrivate {
  i = -1;
  end = 0;
  current;
  value;
  enqueue(emitter, value, end) {
    this.i = 0;
    this.end = end;
    this.current = emitter;
    this.value = value;
  }
  reset() {
    this.i = this.end;
    this.current = undefined;
    this.value = undefined;
  }
}

function addAndReturnDisposable(d, store) {
  if (Array.isArray(store)) {
    store.push(d);
  } else if (store) {
    store.add(d);
  }
  return d;
}

function createSingleCallFunction(fn, fnDidRunCallback) {
  let didCall = false;
  let result;
  return () => {
    if (didCall) {
      return result;
    }
    didCall = true;
    if (fnDidRunCallback) {
      try {
        result = fn.apply(this, arguments);
      } finally {
        fnDidRunCallback();
      }
    } else {
      result = fn.apply(this, arguments);
    }
    return result;
  };
}

export class Emitter {
  constructor(options) {
    this._size = 0;
    this._options = options;
    this._deliveryQueue = options?.deliveryQueue;
  }
  _deliver(listener, value) {
    if (!listener) {
      return;
    }
    listener.value(value);
  }
  _deliverQueue(dq) {
    const listeners = dq.current._listeners;
    while (dq.i < dq.end) {
      // important: dq.i is incremented before calling deliver() because it might reenter deliverQueue()
      this._deliver(listeners[dq.i++], dq.value);
    }
    dq.reset();
  }
  fire(event) {
    if (this._deliveryQueue?.current) {
      this._deliverQueue(this._deliveryQueue);
    }
    if (!this._listeners) {
      // no-op
    } else if (this._listeners instanceof UniqueContainer) {
      this._deliver(this._listeners, event);
    } else {
      const dq = this._deliveryQueue;
      dq.enqueue(this, event, this._listeners.length);
      this._deliverQueue(dq);
    }
  }
  get event() {
    this._event = (callback, thisArgs, disposables) => {
      if (this._disposed) {
        return Disposable.None;
      }
      if (thisArgs) {
        // eslint-disable-next-line no-param-reassign
        callback = callback.bind(thisArgs);
      }
      const contained = new UniqueContainer(callback);
      if (!this._listeners) {
        this._options?.onWillAddFirstListener?.(this);
        this._listeners = contained;
        this._options?.onDidAddFirstListener?.(this);
      } else if (this._listeners instanceof UniqueContainer) {
        this._deliveryQueue = this._deliveryQueue ?? new EventDeliveryQueuePrivate();
        this._listeners = [this._listeners, contained];
      } else {
        this._listeners.push(contained);
      }
      this._size++;
      const result = toDisposable(() => {
        this._removeListener(contained);
      });
      if (disposables instanceof DisposableStore) {
        disposables.add(result);
      } else if (Array.isArray(disposables)) {
        disposables.push(result);
      }
      return result;
    };
    return this._event;
  }
  _removeListener(listener) {
    this._options?.onWillRemoveListener?.(this);
    if (!this._listeners) {
      return; // expected if a listener gets disposed
    }
    if (this._size === 1) {
      this._listeners = undefined;
      this._options?.onDidRemoveLastListener?.(this);
      this._size = 0;
      return;
    }
    const listeners = this._listeners;
    const index = listeners.indexOf(listener);
    if (index === -1) {
      throw new Error('Attempted to dispose unknown listener');
    }
    this._size--;
    listeners[index] = undefined;
    const adjustDeliveryQueue = this._deliveryQueue.current === this;
    let n = 0;
    for (let i = 0; i < listeners.length; i++) {
      if (listeners[i]) {
        listeners[n++] = listeners[i];
      } else if (adjustDeliveryQueue) {
        this._deliveryQueue.end--;
        if (n < this._deliveryQueue.i) {
          this._deliveryQueue.i--;
        }
      }
    }
    listeners.length = n;
  }
  dispose() {
    if (!this._disposed) {
      this._disposed = true;
      if (this._deliveryQueue?.current === this) {
        this._deliveryQueue.reset();
      }
      if (this._listeners) {
        this._listeners = undefined;
        this._size = 0;
      }
      this._options?.onDidRemoveLastListener?.();
    }
  }
}

export class Relay {
  constructor() {
    this.listening = false;
    this.inputEvent = Event.None;
    this.inputEventListener = Disposable.None;
    this.emitter = new Emitter({
      onDidAddFirstListener: () => {
        this.listening = true;
        this.inputEventListener = this.inputEvent(this.emitter.fire, this.emitter);
      },
      onDidRemoveLastListener: () => {
        this.listening = false;
        this.inputEventListener.dispose();
      },
    });
    this.event = this.emitter.event;
  }
  set input(event) {
    this.inputEvent = event;
    if (this.listening) {
      this.inputEventListener.dispose();
      this.inputEventListener = event(this.emitter.fire, this.emitter);
    }
  }
  dispose() {
    this.inputEventListener.dispose();
    this.emitter.dispose();
  }
}

export class EventMultiplexer {
  constructor() {
    this.emitter = new Emitter({
      onWillAddFirstListener: () => this.onFirstListenerAdd(),
      onDidRemoveLastListener: () => this.onLastListenerRemove(),
    });
    this.hasListener = false;
    this.events = [];
  }
  get event() {
    return this.emitter.event;
  }
  add(event) {
    const e = { event, listener: null };
    this.events.push(e);
    if (this.hasListener) {
      this.hook(e);
    }
    const dispose = () => {
      if (this.hasListener) {
        this.unhook(e);
      }
      const idx = this.events.indexOf(e);
      this.events.splice(idx, 1);
    };
    return toDisposable(createSingleCallFunction(dispose));
  }
  onFirstListenerAdd() {
    this.hasListener = true;
    this.events.forEach(e => this.hook(e));
  }
  onLastListenerRemove() {
    this.hasListener = false;
    this.events.forEach(e => this.unhook(e));
  }
  hook(e) {
    e.listener = e.event(r => this.emitter.fire(r));
  }
  unhook(e) {
    e.listener?.dispose();
    e.listener = null;
  }
  dispose() {
    this.emitter.dispose();
    for (const e of this.events) {
      e.listener?.dispose();
    }
    this.events = [];
  }
}

export const Event = {
  buffer(event, flushAfterTimeout = false, _buffer = [], disposable) {
    let buffer = _buffer.slice();

    let listener = event(e => {
      if (buffer) {
        buffer.push(e);
      } else {
        emitter.fire(e);
      }
    });

    disposable?.add(listener);

    const flush = () => {
      buffer?.forEach(e => emitter.fire(e));
      buffer = null;
    };

    const emitter = new Emitter({
      onWillAddFirstListener() {
        if (!listener) {
          listener = event(e => emitter.fire(e));
          disposable?.add(listener);
        }
      },
      onDidAddFirstListener() {
        if (buffer) {
          if (flushAfterTimeout) {
            setTimeout(flush);
          } else {
            flush();
          }
        }
      },
      onDidRemoveLastListener() {
        if (listener) {
          listener.dispose();
        }
        listener = null;
      },
    });

    disposable?.add(emitter);

    return emitter.event;
  },

  None: () => Disposable.None,

  snapshot(event, disposable) {
    let listener;

    const emitter = new Emitter({
      onWillAddFirstListener() {
        listener = event(emitter.fire, emitter);
      },
      onDidRemoveLastListener() {
        listener?.dispose();
      },
    });

    disposable?.add(emitter);

    return emitter.event;
  },

  signal(event) {
    return event;
  },

  filter(event, filter, disposable) {
    return this.snapshot(
      (listener, thisArgs = null, disposables) =>
        event(e => filter(e) && listener.call(thisArgs, e), null, disposables),
      disposable
    );
  },

  any(...events) {
    return (listener, thisArgs = null, disposables) => {
      const disposable = combinedDisposable(
        ...events.map(event => event(e => listener.call(thisArgs, e)))
      );
      return addAndReturnDisposable(disposable, disposables);
    };
  },

  map(event, map, disposable) {
    return this.snapshot(
      (listener, thisArgs = null, disposables) =>
        event(i => listener.call(thisArgs, map(i)), null, disposables),
      disposable
    );
  },

  once(event) {
    return (listener, thisArgs = null, disposables) => {
      let didFire = false;
      const result = event(
        e => {
          if (didFire) return;
          if (result) result.dispose();
          else didFire = true;

          return listener.call(thisArgs, e);
        },
        null,
        disposables
      );

      if (didFire) {
        result.dispose();
      }

      return result;
    };
  },

  toPromise(event) {
    return new Promise(resolve => this.once(event)(resolve));
  },

  fromNodeEventEmitter(emitter, eventName, map = _id => _id) {
    let result;
    const fn = (...args) => result.fire(map(...args));
    const onWillAddFirstListener = () => emitter.on(eventName, fn);
    const onDidRemoveLastListener = () => emitter.removeListener(eventName, fn);
    result = new Emitter({ onWillAddFirstListener, onDidRemoveLastListener });
    return result.event;
  },
};
