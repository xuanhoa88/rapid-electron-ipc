import { ELBuffer } from './utils/buffer';
import { Event } from './event';

const MarshalledId = {
  Uri: 1,
  Regexp: 2,
  ScmResource: 3,
  ScmResourceGroup: 4,
  ScmProvider: 5,
  CommentController: 6,
  CommentThread: 7,
  CommentThreadInstance: 8,
  CommentThreadReply: 9,
  CommentNode: 10,
  CommentThreadNode: 11,
  TimelineActionContext: 12,
  NotebookCellActionContext: 13,
  NotebookActionContext: 14,
  TerminalContext: 15,
  TestItemContext: 16,
  Date: 17,
  TestMessageMenuArgs: 18,
};

const isUpperAsciiLetter = code => code >= 65 && code <= 90;

const propertyIsDynamicEvent = name =>
  // Assume a property is a dynamic event (a method that returns an event) if it has a form of "onDynamicSomething"
  name.startsWith('onDynamic') && isUpperAsciiLetter(name.charCodeAt(9));

const propertyIsEvent = name =>
  // Assume a property is an event if it has a form of "onSomething"
  name[0] === 'o' && name[1] === 'n' && isUpperAsciiLetter(name.charCodeAt(2));

function revive(obj, depth = 0) {
  if (!obj || depth > 200) {
    return obj;
  }

  if (typeof obj === 'object') {
    switch (obj.$mid) {
      case MarshalledId.Regexp: {
        return new RegExp(obj.source, obj.flags);
      }
      case MarshalledId.Date: {
        return new Date(obj.source);
      }
    }

    if (obj instanceof ELBuffer || obj instanceof Uint8Array) {
      return obj;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; ++i) {
        obj[i] = revive(obj[i], depth + 1);
      }
    } else {
      for (const key in obj) {
        if (Object.hasOwnProperty.call(obj, key)) {
          obj[key] = revive(obj[key], depth + 1);
        }
      }
    }
  }

  return obj;
}

export const ProxyChannel = {
  fromService(service, disposables, options = {}) {
    const handler = service;
    const disableMarshalling = options.disableMarshalling;

    // Buffer any event that should be supported by
    // iterating over all property keys and finding them
    // However, this will not work for services that
    // are lazy and use a Proxy within. For that we
    // still need to check later (see below).
    const mapEventNameToEvent = new Map();
    for (const key in handler) {
      if (propertyIsEvent(key)) {
        mapEventNameToEvent.set(key, Event.buffer(handler[key], true, undefined, disposables));
      }
    }

    return {
      listen(_, event, arg) {
        const eventImpl = mapEventNameToEvent.get(event);
        if (eventImpl) {
          return eventImpl;
        }

        const target = handler[event];
        if (typeof target === 'function') {
          if (propertyIsDynamicEvent(event)) {
            return target.call(handler, arg);
          }

          if (propertyIsEvent(event)) {
            mapEventNameToEvent.set(
              event,
              Event.buffer(handler[event], true, undefined, disposables)
            );

            return mapEventNameToEvent.get(event);
          }
        }

        throw new Error(`Event not found: ${event}`);
      },

      call(_, command, args = []) {
        const target = handler[command];
        if (typeof target === 'function') {
          // Revive unless marshalling disabled
          if (!disableMarshalling && Array.isArray(args)) {
            for (let i = 0; i < args.length; i++) {
              args[i] = revive(args[i]);
            }
          }

          let res = target.apply(handler, args);
          if (!(res instanceof Promise)) {
            res = Promise.resolve(res);
          }
          return res;
        }

        throw new Error(`Method not found: ${command}`);
      },
    };
  },

  toService(channel, options = {}) {
    return new Proxy(
      {},
      {
        get(_target, propKey) {
          if (typeof propKey === 'string') {
            if (options.properties?.has(propKey)) {
              return options.properties.get(propKey);
            }

            // Event
            if (propertyIsEvent(propKey)) {
              return channel.listen(propKey);
            }

            return async (...args) => await channel.call(propKey, args);
          }
          throw new Error(`Property not found: ${String(propKey)}`);
        },
      }
    );
  },
};
