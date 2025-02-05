export class DisposableStore {
  constructor() {
    this._isDisposed = false;
    this._toDispose = new Set();
  }
  dispose() {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    this.clear();
  }
  clear() {
    if (this._toDispose.size === 0) {
      return;
    }
    try {
      dispose(this._toDispose);
    } finally {
      this._toDispose.clear();
    }
  }
  add(o) {
    if (!o) {
      return o;
    }
    if (o === this) {
      throw new Error('Cannot register a disposable on itself!');
    }
    if (this._isDisposed) {
      // eslint-disable-next-line no-console
      console.warn(
        new Error(
          'Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!'
        ).stack
      );
    } else {
      this._toDispose.add(o);
    }
    return o;
  }
}

export class Disposable {
  constructor() {
    this._store = new DisposableStore();
  }
  static {
    this.None = Object.freeze({ dispose() {} });
  }
  dispose() {
    this._store.dispose();
  }
  _register(o) {
    if (o === this) {
      throw new Error('Cannot register a disposable on itself!');
    }
    return this._store.add(o);
  }
}

export function dispose(arg) {
  if (arg && Symbol.iterator in arg) {
    const errors = [];
    for (const d of arg) {
      if (d) {
        try {
          d.dispose();
        } catch (e) {
          errors.push(e);
        }
      }
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new Error('Encountered errors while disposing of store');
    }
    return Array.isArray(arg) ? [] : arg;
  } else if (arg && 'dispose' in arg) {
    arg.dispose();
    return arg;
  }
}

export const toDisposable = fn => ({ dispose: fn });

export const combinedDisposable = (...disposables) => toDisposable(() => dispose(disposables));
