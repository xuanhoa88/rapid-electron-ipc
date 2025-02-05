/* eslint-disable no-param-reassign */
const hasBuffer = typeof Buffer !== 'undefined';

export class ELBuffer {
  constructor(buffer) {
    this.buffer = buffer;
    this.byteLength = this.buffer.byteLength;
  }
  static wrap(actual) {
    if (hasBuffer && !Buffer.isBuffer(actual)) {
      // https://nodejs.org/dist/latest-v10.x/docs/api/buffer.html#buffer_class_method_buffer_from_arraybuffer_byteoffset_length
      // Create a zero-copy Buffer wrapper around the ArrayBuffer pointed to by the Uint8Array
      // eslint-disable-next-line no-param-reassign
      actual = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength);
    }
    return new ELBuffer(actual);
  }
  writeUInt8(value, offset) {
    writeUInt8(this.buffer, value, offset);
  }
  readUInt8(offset) {
    return readUInt8(this.buffer, offset);
  }
  static alloc(byteLength) {
    if (hasBuffer) {
      return new ELBuffer(Buffer.allocUnsafe(byteLength));
    }
    return new ELBuffer(new Uint8Array(byteLength));
  }
  static concat(buffers, totalLength) {
    if (typeof totalLength === 'undefined') {
      totalLength = 0;
      for (let i = 0, len = buffers.length; i < len; i++) {
        totalLength += buffers[i].byteLength;
      }
    }
    const ret = ELBuffer.alloc(totalLength);
    let offset = 0;
    for (let i = 0, len = buffers.length; i < len; i++) {
      const element = buffers[i];
      ret.set(element, offset);
      offset += element.byteLength;
    }
    return ret;
  }
  set(array, offset) {
    if (array instanceof ELBuffer) {
      this.buffer.set(array.buffer, offset);
    } else if (array instanceof Uint8Array) {
      this.buffer.set(array, offset);
    } else if (array instanceof ArrayBuffer) {
      this.buffer.set(new Uint8Array(array), offset);
    } else if (ArrayBuffer.isView(array)) {
      this.buffer.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset);
    } else {
      throw new TypeError(`Unknown argument 'array'`);
    }
  }
  slice(start, end) {
    // IMPORTANT: use subarray instead of slice because TypedArray#slice
    // creates shallow copy and NodeBuffer#slice doesn't. The use of subarray
    // ensures the same, performance, behaviour.
    return new ELBuffer(this.buffer.subarray(start, end));
  }
  static fromString(source, options) {
    const dontUseNodeBuffer = options?.dontUseNodeBuffer || false;
    if (!dontUseNodeBuffer && hasBuffer) {
      return new ELBuffer(Buffer.from(source));
    }
    const textEncoder = new TextEncoder();
    return new ELBuffer(textEncoder.encode(source));
  }
  toString() {
    if (hasBuffer) {
      return this.buffer.toString();
    }
    const textDecoder = new TextDecoder();
    return textDecoder.decode(this.buffer);
  }
}

// Enum replacement using an object
const DataType = {
  Undefined: 0,
  String: 1,
  Buffer: 2,
  ELBuffer: 3,
  Array: 4,
  Object: 5,
  Int: 6,
};

const BufferPresets = {
  Undefined: createOneByteBuffer(DataType.Undefined),
  String: createOneByteBuffer(DataType.String),
  Buffer: createOneByteBuffer(DataType.Buffer),
  ELBuffer: createOneByteBuffer(DataType.ELBuffer),
  Array: createOneByteBuffer(DataType.Array),
  Object: createOneByteBuffer(DataType.Object),
  Uint: createOneByteBuffer(DataType.Int),
};

function createOneByteBuffer(value) {
  const result = ELBuffer.alloc(1);
  result.writeUInt8(value, 0);
  return result;
}

const vqlZero = createOneByteBuffer(0);

function writeInt32VQL(writer, value) {
  if (value === 0) {
    writer.write(vqlZero);
    return;
  }
  let len = 0;
  for (let v2 = value; v2 !== 0; v2 = v2 >>> 7) {
    len++;
  }
  const scratch = ELBuffer.alloc(len);
  for (let i = 0; value !== 0; i++) {
    scratch.buffer[i] = value & 0b01111111;
    value = value >>> 7;
    if (value > 0) {
      scratch.buffer[i] |= 0b10000000;
    }
  }
  writer.write(scratch);
}

function readIntVQL(reader) {
  let value = 0;
  for (let n = 0; ; n += 7) {
    const next = reader.read(1);
    value |= (next.buffer[0] & 0b01111111) << n;
    if (!(next.buffer[0] & 0b10000000)) {
      return value;
    }
  }
}

function writeUInt8(destination, value, offset) {
  destination[offset] = value;
}

function readUInt8(source, offset) {
  return source[offset];
}

export class BufferReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.pos = 0;
  }
  read(bytes) {
    const result = this.buffer.slice(this.pos, this.pos + bytes);
    this.pos += result.byteLength;
    return result;
  }
}

export class BufferWriter {
  constructor() {
    this.buffers = [];
  }
  get buffer() {
    return ELBuffer.concat(this.buffers);
  }
  write(buffer) {
    this.buffers.push(buffer);
  }
}

export function serialize(writer, data) {
  if (typeof data === 'undefined') {
    writer.write(BufferPresets.Undefined);
  } else if (typeof data === 'string') {
    const buffer = ELBuffer.fromString(data);
    writer.write(BufferPresets.String);
    writeInt32VQL(writer, buffer.byteLength);
    writer.write(buffer);
  } else if (hasBuffer && Buffer.isBuffer(data)) {
    const buffer = ELBuffer.wrap(data);
    writer.write(BufferPresets.Buffer);
    writeInt32VQL(writer, buffer.byteLength);
    writer.write(buffer);
  } else if (data instanceof ELBuffer) {
    writer.write(BufferPresets.ELBuffer);
    writeInt32VQL(writer, data.byteLength);
    writer.write(data);
  } else if (Array.isArray(data)) {
    writer.write(BufferPresets.Array);
    writeInt32VQL(writer, data.length);
    for (const el of data) {
      serialize(writer, el);
    }
  } else if (typeof data === 'number' && (data | 0) === data) {
    // write a vql if it's a number that we can do bitwise operations on
    writer.write(BufferPresets.Uint);
    writeInt32VQL(writer, data);
  } else {
    const buffer = ELBuffer.fromString(JSON.stringify(data));
    writer.write(BufferPresets.Object);
    writeInt32VQL(writer, buffer.byteLength);
    writer.write(buffer);
  }
}

export function deserialize(reader) {
  const type = reader.read(1).readUInt8(0);
  switch (type) {
    case DataType.Undefined: {
      return undefined;
    }
    case DataType.String: {
      return reader.read(readIntVQL(reader)).toString();
    }
    case DataType.Buffer: {
      return reader.read(readIntVQL(reader)).buffer;
    }
    case DataType.ELBuffer: {
      return reader.read(readIntVQL(reader));
    }
    case DataType.Array: {
      const length = readIntVQL(reader);
      const result = [];
      for (let i = 0; i < length; i++) {
        result.push(deserialize(reader));
      }
      return result;
    }
    case DataType.Object: {
      return JSON.parse(reader.read(readIntVQL(reader)).toString());
    }
    case DataType.Int: {
      return readIntVQL(reader);
    }
  }
}
