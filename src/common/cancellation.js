import { Emitter, Event } from './event';

const shortcutEvent = Object.freeze((callback, context) => {
  const handle = setTimeout(callback.bind(context), 0);
  return {
    dispose() {
      clearTimeout(handle);
    },
  };
});

export const CancellationToken = {
  isCancellationToken(thing) {
    if (thing === CancellationToken.None || thing === CancellationToken.Cancelled) {
      return true;
    }
    if (!thing || typeof thing !== 'object') {
      return false;
    }
    return (
      typeof thing.isCancellationRequested === 'boolean' &&
      typeof thing.onCancellationRequested === 'function'
    );
  },

  None: Object.freeze({
    isCancellationRequested: false,
    onCancellationRequested: Event.None,
  }),

  Cancelled: Object.freeze({
    isCancellationRequested: true,
    onCancellationRequested: shortcutEvent,
  }),
};

class MutableToken {
  constructor() {
    this._isCancelled = false;
    this._emitter = null;
  }
  cancel() {
    if (!this._isCancelled) {
      this._isCancelled = true;
      if (this._emitter) {
        this._emitter.fire(undefined);
        this.dispose();
      }
    }
  }
  get isCancellationRequested() {
    return this._isCancelled;
  }
  get onCancellationRequested() {
    if (this._isCancelled) {
      return shortcutEvent;
    }
    if (!this._emitter) {
      this._emitter = new Emitter();
    }
    return this._emitter.event;
  }
  dispose() {
    if (this._emitter) {
      this._emitter.dispose();
      this._emitter = null;
    }
  }
}

class CancellationTokenSource {
  constructor(parent) {
    this._token = undefined;
    this._parentListener = undefined;
    this._parentListener = parent && parent.onCancellationRequested(this.cancel, this);
  }
  get token() {
    if (!this._token) {
      this._token = new MutableToken();
    }
    return this._token;
  }
  cancel() {
    if (!this._token) {
      this._token = CancellationToken.Cancelled;
    } else if (this._token instanceof MutableToken) {
      this._token.cancel();
    }
  }
  dispose(cancel = false) {
    if (cancel) {
      this.cancel();
    }
    this._parentListener?.dispose();
    if (!this._token) {
      this._token = CancellationToken.None;
    } else if (this._token instanceof MutableToken) {
      this._token.dispose();
    }
  }
}

export class CancellationError extends Error {
  constructor() {
    super('Canceled');
    this.name = this.message;
  }
}

export function createCancelablePromise(callback) {
  const source = new CancellationTokenSource();
  const thenable = callback(source.token);
  const promise = new Promise((resolve, reject) => {
    const subscription = source.token.onCancellationRequested(() => {
      subscription.dispose();
      reject(new CancellationError());
    });
    Promise.resolve(thenable).then(
      value => {
        subscription.dispose();
        source.dispose();
        resolve(value);
      },
      error => {
        subscription.dispose();
        source.dispose();
        reject(error);
      }
    );
  });

  return {
    cancel() {
      source.cancel();
      source.dispose();
    },
    then(resolve, reject) {
      return promise.then(resolve, reject);
    },
    catch(reject) {
      return this.then(undefined, reject);
    },
    finally(onfinally) {
      return promise.finally(onfinally);
    },
  };
}
