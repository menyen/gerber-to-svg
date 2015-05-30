(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.gerberToSvg = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff
var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined' && object.buffer instanceof ArrayBuffer) {
    return fromTypedArray(that, object)
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = String(string)

  if (string.length === 0) return 0

  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      return string.length
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return string.length * 2
    case 'hex':
      return string.length >>> 1
    case 'utf8':
    case 'utf-8':
      return utf8ToBytes(string).length
    case 'base64':
      return base64ToBytes(string).length
    default:
      return string.length
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function toString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []
  var i = 0

  for (; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (leadSurrogate) {
        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        } else {
          // valid surrogate pair
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      } else {
        // no lead yet

        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else {
          // valid lead
          leadSurrogate = codePoint
          continue
        }
      }
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":3,"ieee754":4,"is-array":5}],3:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],4:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],5:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],6:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],7:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],8:[function(require,module,exports){
module.exports = Array.isArray || function (arr) {
  return Object.prototype.toString.call(arr) == '[object Array]';
};

},{}],9:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            currentQueue[queueIndex].run();
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],10:[function(require,module,exports){
module.exports = require("./lib/_stream_duplex.js")

},{"./lib/_stream_duplex.js":11}],11:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

module.exports = Duplex;

/*<replacement>*/
var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}
/*</replacement>*/


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

forEach(objectKeys(Writable.prototype), function(method) {
  if (!Duplex.prototype[method])
    Duplex.prototype[method] = Writable.prototype[method];
});

function Duplex(options) {
  if (!(this instanceof Duplex))
    return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false)
    this.readable = false;

  if (options && options.writable === false)
    this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false)
    this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended)
    return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  process.nextTick(this.end.bind(this));
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

}).call(this,require('_process'))
},{"./_stream_readable":13,"./_stream_writable":15,"_process":9,"core-util-is":16,"inherits":7}],12:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

module.exports = PassThrough;

var Transform = require('./_stream_transform');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough))
    return new PassThrough(options);

  Transform.call(this, options);
}

PassThrough.prototype._transform = function(chunk, encoding, cb) {
  cb(null, chunk);
};

},{"./_stream_transform":14,"core-util-is":16,"inherits":7}],13:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Readable;

/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/


/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Readable.ReadableState = ReadableState;

var EE = require('events').EventEmitter;

/*<replacement>*/
if (!EE.listenerCount) EE.listenerCount = function(emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/

var Stream = require('stream');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var StringDecoder;


/*<replacement>*/
var debug = require('util');
if (debug && debug.debuglog) {
  debug = debug.debuglog('stream');
} else {
  debug = function () {};
}
/*</replacement>*/


util.inherits(Readable, Stream);

function ReadableState(options, stream) {
  var Duplex = require('./_stream_duplex');

  options = options || {};

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  var defaultHwm = options.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.buffer = [];
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;


  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex)
    this.objectMode = this.objectMode || !!options.readableObjectMode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder)
      StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

function Readable(options) {
  var Duplex = require('./_stream_duplex');

  if (!(this instanceof Readable))
    return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  Stream.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function(chunk, encoding) {
  var state = this._readableState;

  if (util.isString(chunk) && !state.objectMode) {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = new Buffer(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function(chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (util.isNullOrUndefined(chunk)) {
    state.reading = false;
    if (!state.ended)
      onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var e = new Error('stream.unshift() after end event');
      stream.emit('error', e);
    } else {
      if (state.decoder && !addToFront && !encoding)
        chunk = state.decoder.write(chunk);

      if (!addToFront)
        state.reading = false;

      // if we want the data now, just emit it.
      if (state.flowing && state.length === 0 && !state.sync) {
        stream.emit('data', chunk);
        stream.read(0);
      } else {
        // update the buffer info.
        state.length += state.objectMode ? 1 : chunk.length;
        if (addToFront)
          state.buffer.unshift(chunk);
        else
          state.buffer.push(chunk);

        if (state.needReadable)
          emitReadable(stream);
      }

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}



// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended &&
         (state.needReadable ||
          state.length < state.highWaterMark ||
          state.length === 0);
}

// backwards compatibility.
Readable.prototype.setEncoding = function(enc) {
  if (!StringDecoder)
    StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
  return this;
};

// Don't raise the hwm > 128MB
var MAX_HWM = 0x800000;
function roundUpToNextPowerOf2(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2
    n--;
    for (var p = 1; p < 32; p <<= 1) n |= n >> p;
    n++;
  }
  return n;
}

function howMuchToRead(n, state) {
  if (state.length === 0 && state.ended)
    return 0;

  if (state.objectMode)
    return n === 0 ? 0 : 1;

  if (isNaN(n) || util.isNull(n)) {
    // only flow one buffer at a time
    if (state.flowing && state.buffer.length)
      return state.buffer[0].length;
    else
      return state.length;
  }

  if (n <= 0)
    return 0;

  // If we're asking for more than the target buffer level,
  // then raise the water mark.  Bump up to the next highest
  // power of 2, to prevent increasing it excessively in tiny
  // amounts.
  if (n > state.highWaterMark)
    state.highWaterMark = roundUpToNextPowerOf2(n);

  // don't have that much.  return null, unless we've ended.
  if (n > state.length) {
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    } else
      return state.length;
  }

  return n;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function(n) {
  debug('read', n);
  var state = this._readableState;
  var nOrig = n;

  if (!util.isNumber(n) || n > 0)
    state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 &&
      state.needReadable &&
      (state.length >= state.highWaterMark || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended)
      endReadable(this);
    else
      emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    if (state.length === 0)
      endReadable(this);
    return null;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;
  debug('need readable', doRead);

  // if we currently have less than the highWaterMark, then also read some
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  }

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  }

  if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0)
      state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
  }

  // If _read pushed data synchronously, then `reading` will be false,
  // and we need to re-evaluate how much data we can return to the user.
  if (doRead && !state.reading)
    n = howMuchToRead(nOrig, state);

  var ret;
  if (n > 0)
    ret = fromList(n, state);
  else
    ret = null;

  if (util.isNull(ret)) {
    state.needReadable = true;
    n = 0;
  }

  state.length -= n;

  // If we have nothing in the buffer, then we want to know
  // as soon as we *do* get something into the buffer.
  if (state.length === 0 && !state.ended)
    state.needReadable = true;

  // If we tried to read() past the EOF, then emit end on the next tick.
  if (nOrig !== n && state.ended && state.length === 0)
    endReadable(this);

  if (!util.isNull(ret))
    this.emit('data', ret);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!util.isBuffer(chunk) &&
      !util.isString(chunk) &&
      !util.isNullOrUndefined(chunk) &&
      !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}


function onEofChunk(stream, state) {
  if (state.decoder && !state.ended) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // emit 'readable' now to make sure it gets picked up.
  emitReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    if (state.sync)
      process.nextTick(function() {
        emitReadable_(stream);
      });
    else
      emitReadable_(stream);
  }
}

function emitReadable_(stream) {
  debug('emit readable');
  stream.emit('readable');
  flow(stream);
}


// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    process.nextTick(function() {
      maybeReadMore_(stream, state);
    });
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended &&
         state.length < state.highWaterMark) {
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;
    else
      len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function(n) {
  this.emit('error', new Error('not implemented'));
};

Readable.prototype.pipe = function(dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

  var doEnd = (!pipeOpts || pipeOpts.end !== false) &&
              dest !== process.stdout &&
              dest !== process.stderr;

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted)
    process.nextTick(endFn);
  else
    src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    debug('onunpipe');
    if (readable === src) {
      cleanup();
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  function cleanup() {
    debug('cleanup');
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);
    src.removeListener('data', ondata);

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (state.awaitDrain &&
        (!dest._writableState || dest._writableState.needDrain))
      ondrain();
  }

  src.on('data', ondata);
  function ondata(chunk) {
    debug('ondata');
    var ret = dest.write(chunk);
    if (false === ret) {
      debug('false write response, pause',
            src._readableState.awaitDrain);
      src._readableState.awaitDrain++;
      src.pause();
    }
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (EE.listenerCount(dest, 'error') === 0)
      dest.emit('error', er);
  }
  // This is a brutally ugly hack to make sure that our error handler
  // is attached before any userland ones.  NEVER DO THIS.
  if (!dest._events || !dest._events.error)
    dest.on('error', onerror);
  else if (isArray(dest._events.error))
    dest._events.error.unshift(onerror);
  else
    dest._events.error = [onerror, dest._events.error];



  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function() {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain)
      state.awaitDrain--;
    if (state.awaitDrain === 0 && EE.listenerCount(src, 'data')) {
      state.flowing = true;
      flow(src);
    }
  };
}


Readable.prototype.unpipe = function(dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0)
    return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes)
      return this;

    if (!dest)
      dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest)
      dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var i = 0; i < len; i++)
      dests[i].emit('unpipe', this);
    return this;
  }

  // try to find the right one.
  var i = indexOf(state.pipes, dest);
  if (i === -1)
    return this;

  state.pipes.splice(i, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1)
    state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function(ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  // If listening to data, and it has not explicitly been paused,
  // then call resume to start the flow of data on the next tick.
  if (ev === 'data' && false !== this._readableState.flowing) {
    this.resume();
  }

  if (ev === 'readable' && this.readable) {
    var state = this._readableState;
    if (!state.readableListening) {
      state.readableListening = true;
      state.emittedReadable = false;
      state.needReadable = true;
      if (!state.reading) {
        var self = this;
        process.nextTick(function() {
          debug('readable nexttick read 0');
          self.read(0);
        });
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function() {
  var state = this._readableState;
  if (!state.flowing) {
    debug('resume');
    state.flowing = true;
    if (!state.reading) {
      debug('resume read 0');
      this.read(0);
    }
    resume(this, state);
  }
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    process.nextTick(function() {
      resume_(stream, state);
    });
  }
}

function resume_(stream, state) {
  state.resumeScheduled = false;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading)
    stream.read(0);
}

Readable.prototype.pause = function() {
  debug('call pause flowing=%j', this._readableState.flowing);
  if (false !== this._readableState.flowing) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);
  if (state.flowing) {
    do {
      var chunk = stream.read();
    } while (null !== chunk && state.flowing);
  }
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function(stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function() {
    debug('wrapped end');
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length)
        self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function(chunk) {
    debug('wrapped data');
    if (state.decoder)
      chunk = state.decoder.write(chunk);
    if (!chunk || !state.objectMode && !chunk.length)
      return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (util.isFunction(stream[i]) && util.isUndefined(this[i])) {
      this[i] = function(method) { return function() {
        return stream[method].apply(stream, arguments);
      }}(i);
    }
  }

  // proxy certain important events.
  var events = ['error', 'close', 'destroy', 'pause', 'resume'];
  forEach(events, function(ev) {
    stream.on(ev, self.emit.bind(self, ev));
  });

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function(n) {
    debug('wrapped _read', n);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};



// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
function fromList(n, state) {
  var list = state.buffer;
  var length = state.length;
  var stringMode = !!state.decoder;
  var objectMode = !!state.objectMode;
  var ret;

  // nothing in the list, definitely empty.
  if (list.length === 0)
    return null;

  if (length === 0)
    ret = null;
  else if (objectMode)
    ret = list.shift();
  else if (!n || n >= length) {
    // read it all, truncate the array.
    if (stringMode)
      ret = list.join('');
    else
      ret = Buffer.concat(list, length);
    list.length = 0;
  } else {
    // read just some of it.
    if (n < list[0].length) {
      // just take a part of the first list item.
      // slice is the same for buffers and strings.
      var buf = list[0];
      ret = buf.slice(0, n);
      list[0] = buf.slice(n);
    } else if (n === list[0].length) {
      // first list is a perfect match
      ret = list.shift();
    } else {
      // complex case.
      // we have enough to cover it, but it spans past the first buffer.
      if (stringMode)
        ret = '';
      else
        ret = new Buffer(n);

      var c = 0;
      for (var i = 0, l = list.length; i < l && c < n; i++) {
        var buf = list[0];
        var cpy = Math.min(n - c, buf.length);

        if (stringMode)
          ret += buf.slice(0, cpy);
        else
          buf.copy(ret, c, 0, cpy);

        if (cpy < buf.length)
          list[0] = buf.slice(cpy);
        else
          list.shift();

        c += cpy;
      }
    }
  }

  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0)
    throw new Error('endReadable called on non-empty stream');

  if (!state.endEmitted) {
    state.ended = true;
    process.nextTick(function() {
      // Check that we didn't get one last unshift.
      if (!state.endEmitted && state.length === 0) {
        state.endEmitted = true;
        stream.readable = false;
        stream.emit('end');
      }
    });
  }
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf (xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}

}).call(this,require('_process'))
},{"./_stream_duplex":11,"_process":9,"buffer":2,"core-util-is":16,"events":6,"inherits":7,"isarray":8,"stream":21,"string_decoder/":22,"util":1}],14:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.


// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);


function TransformState(options, stream) {
  this.afterTransform = function(er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb)
    return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (!util.isNullOrUndefined(data))
    stream.push(data);

  if (cb)
    cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}


function Transform(options) {
  if (!(this instanceof Transform))
    return new Transform(options);

  Duplex.call(this, options);

  this._transformState = new TransformState(options, this);

  // when the writable side finishes, then flush out anything remaining.
  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  this.once('prefinish', function() {
    if (util.isFunction(this._flush))
      this._flush(function(er) {
        done(stream, er);
      });
    else
      done(stream);
  });
}

Transform.prototype.push = function(chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function(chunk, encoding, cb) {
  throw new Error('not implemented');
};

Transform.prototype._write = function(chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform ||
        rs.needReadable ||
        rs.length < rs.highWaterMark)
      this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function(n) {
  var ts = this._transformState;

  if (!util.isNull(ts.writechunk) && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};


function done(stream, er) {
  if (er)
    return stream.emit('error', er);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var ts = stream._transformState;

  if (ws.length)
    throw new Error('calling transform done when ws.length != 0');

  if (ts.transforming)
    throw new Error('calling transform done when still transforming');

  return stream.push(null);
}

},{"./_stream_duplex":11,"core-util-is":16,"inherits":7}],15:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// A bit simpler than readable streams.
// Implement an async ._write(chunk, cb), and it'll handle all
// the drain event emission and buffering.

module.exports = Writable;

/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Writable.WritableState = WritableState;


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Stream = require('stream');

util.inherits(Writable, Stream);

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
}

function WritableState(options, stream) {
  var Duplex = require('./_stream_duplex');

  options = options || {};

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  var defaultHwm = options.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : defaultHwm;

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex)
    this.objectMode = this.objectMode || !!options.writableObjectMode;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // when true all writes will be buffered until .uncork() call
  this.corked = 0;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function(er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.buffer = [];

  // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted
  this.pendingcb = 0;

  // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams
  this.prefinished = false;

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;
}

function Writable(options) {
  var Duplex = require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, though they're not
  // instanceof Writable, they're instanceof Readable.
  if (!(this instanceof Writable) && !(this instanceof Duplex))
    return new Writable(options);

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function() {
  this.emit('error', new Error('Cannot pipe. Not readable.'));
};


function writeAfterEnd(stream, state, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  process.nextTick(function() {
    cb(er);
  });
}

// If we get something that is not a buffer, string, null, or undefined,
// and we're not in objectMode, then that's an error.
// Otherwise stream chunks are all considered to be of length=1, and the
// watermarks determine how many objects to keep in the buffer, rather than
// how many bytes or characters.
function validChunk(stream, state, chunk, cb) {
  var valid = true;
  if (!util.isBuffer(chunk) &&
      !util.isString(chunk) &&
      !util.isNullOrUndefined(chunk) &&
      !state.objectMode) {
    var er = new TypeError('Invalid non-string/buffer chunk');
    stream.emit('error', er);
    process.nextTick(function() {
      cb(er);
    });
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function(chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  if (util.isFunction(encoding)) {
    cb = encoding;
    encoding = null;
  }

  if (util.isBuffer(chunk))
    encoding = 'buffer';
  else if (!encoding)
    encoding = state.defaultEncoding;

  if (!util.isFunction(cb))
    cb = function() {};

  if (state.ended)
    writeAfterEnd(this, state, cb);
  else if (validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, chunk, encoding, cb);
  }

  return ret;
};

Writable.prototype.cork = function() {
  var state = this._writableState;

  state.corked++;
};

Writable.prototype.uncork = function() {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.writing &&
        !state.corked &&
        !state.finished &&
        !state.bufferProcessing &&
        state.buffer.length)
      clearBuffer(this, state);
  }
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode &&
      state.decodeStrings !== false &&
      util.isString(chunk)) {
    chunk = new Buffer(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, chunk, encoding, cb) {
  chunk = decodeChunk(state, chunk, encoding);
  if (util.isBuffer(chunk))
    encoding = 'buffer';
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret)
    state.needDrain = true;

  if (state.writing || state.corked)
    state.buffer.push(new WriteReq(chunk, encoding, cb));
  else
    doWrite(stream, state, false, len, chunk, encoding, cb);

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (writev)
    stream._writev(chunk, state.onwrite);
  else
    stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  if (sync)
    process.nextTick(function() {
      state.pendingcb--;
      cb(er);
    });
  else {
    state.pendingcb--;
    cb(er);
  }

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er)
    onwriteError(stream, state, sync, er, cb);
  else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(stream, state);

    if (!finished &&
        !state.corked &&
        !state.bufferProcessing &&
        state.buffer.length) {
      clearBuffer(stream, state);
    }

    if (sync) {
      process.nextTick(function() {
        afterWrite(stream, state, finished, cb);
      });
    } else {
      afterWrite(stream, state, finished, cb);
    }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished)
    onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}


// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;

  if (stream._writev && state.buffer.length > 1) {
    // Fast case, write everything using _writev()
    var cbs = [];
    for (var c = 0; c < state.buffer.length; c++)
      cbs.push(state.buffer[c].callback);

    // count the one we are adding, as well.
    // TODO(isaacs) clean this up
    state.pendingcb++;
    doWrite(stream, state, true, state.length, state.buffer, '', function(err) {
      for (var i = 0; i < cbs.length; i++) {
        state.pendingcb--;
        cbs[i](err);
      }
    });

    // Clear buffer
    state.buffer = [];
  } else {
    // Slow case, write chunks one-by-one
    for (var c = 0; c < state.buffer.length; c++) {
      var entry = state.buffer[c];
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;

      doWrite(stream, state, false, len, chunk, encoding, cb);

      // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.
      if (state.writing) {
        c++;
        break;
      }
    }

    if (c < state.buffer.length)
      state.buffer = state.buffer.slice(c);
    else
      state.buffer.length = 0;
  }

  state.bufferProcessing = false;
}

Writable.prototype._write = function(chunk, encoding, cb) {
  cb(new Error('not implemented'));

};

Writable.prototype._writev = null;

Writable.prototype.end = function(chunk, encoding, cb) {
  var state = this._writableState;

  if (util.isFunction(chunk)) {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (util.isFunction(encoding)) {
    cb = encoding;
    encoding = null;
  }

  if (!util.isNullOrUndefined(chunk))
    this.write(chunk, encoding);

  // .end() fully uncorks
  if (state.corked) {
    state.corked = 1;
    this.uncork();
  }

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished)
    endWritable(this, state, cb);
};


function needFinish(stream, state) {
  return (state.ending &&
          state.length === 0 &&
          !state.finished &&
          !state.writing);
}

function prefinish(stream, state) {
  if (!state.prefinished) {
    state.prefinished = true;
    stream.emit('prefinish');
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(stream, state);
  if (need) {
    if (state.pendingcb === 0) {
      prefinish(stream, state);
      state.finished = true;
      stream.emit('finish');
    } else
      prefinish(stream, state);
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished)
      process.nextTick(cb);
    else
      stream.once('finish', cb);
  }
  state.ended = true;
}

}).call(this,require('_process'))
},{"./_stream_duplex":11,"_process":9,"buffer":2,"core-util-is":16,"inherits":7,"stream":21}],16:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

function isBuffer(arg) {
  return Buffer.isBuffer(arg);
}
exports.isBuffer = isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}
}).call(this,require("buffer").Buffer)
},{"buffer":2}],17:[function(require,module,exports){
module.exports = require("./lib/_stream_passthrough.js")

},{"./lib/_stream_passthrough.js":12}],18:[function(require,module,exports){
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = require('stream');
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');

},{"./lib/_stream_duplex.js":11,"./lib/_stream_passthrough.js":12,"./lib/_stream_readable.js":13,"./lib/_stream_transform.js":14,"./lib/_stream_writable.js":15,"stream":21}],19:[function(require,module,exports){
module.exports = require("./lib/_stream_transform.js")

},{"./lib/_stream_transform.js":14}],20:[function(require,module,exports){
module.exports = require("./lib/_stream_writable.js")

},{"./lib/_stream_writable.js":15}],21:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Stream;

var EE = require('events').EventEmitter;
var inherits = require('inherits');

inherits(Stream, EE);
Stream.Readable = require('readable-stream/readable.js');
Stream.Writable = require('readable-stream/writable.js');
Stream.Duplex = require('readable-stream/duplex.js');
Stream.Transform = require('readable-stream/transform.js');
Stream.PassThrough = require('readable-stream/passthrough.js');

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;



// old-style streams.  Note that the pipe method (the only relevant
// part of this class) is overridden in the Readable class.

function Stream() {
  EE.call(this);
}

Stream.prototype.pipe = function(dest, options) {
  var source = this;

  function ondata(chunk) {
    if (dest.writable) {
      if (false === dest.write(chunk) && source.pause) {
        source.pause();
      }
    }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once.
  if (!dest._isStdio && (!options || options.end !== false)) {
    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest.end();
  }


  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    if (typeof dest.destroy === 'function') dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (EE.listenerCount(this, 'error') === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

},{"events":6,"inherits":7,"readable-stream/duplex.js":10,"readable-stream/passthrough.js":17,"readable-stream/readable.js":18,"readable-stream/transform.js":19,"readable-stream/writable.js":20}],22:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var Buffer = require('buffer').Buffer;

var isBufferEncoding = Buffer.isEncoding
  || function(encoding) {
       switch (encoding && encoding.toLowerCase()) {
         case 'hex': case 'utf8': case 'utf-8': case 'ascii': case 'binary': case 'base64': case 'ucs2': case 'ucs-2': case 'utf16le': case 'utf-16le': case 'raw': return true;
         default: return false;
       }
     }


function assertEncoding(encoding) {
  if (encoding && !isBufferEncoding(encoding)) {
    throw new Error('Unknown encoding: ' + encoding);
  }
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters. CESU-8 is handled as part of the UTF-8 encoding.
//
// @TODO Handling all encodings inside a single object makes it very difficult
// to reason about this code, so it should be split up in the future.
// @TODO There should be a utf8-strict encoding that rejects invalid UTF-8 code
// points as used by CESU-8.
var StringDecoder = exports.StringDecoder = function(encoding) {
  this.encoding = (encoding || 'utf8').toLowerCase().replace(/[-_]/, '');
  assertEncoding(encoding);
  switch (this.encoding) {
    case 'utf8':
      // CESU-8 represents each of Surrogate Pair by 3-bytes
      this.surrogateSize = 3;
      break;
    case 'ucs2':
    case 'utf16le':
      // UTF-16 represents each of Surrogate Pair by 2-bytes
      this.surrogateSize = 2;
      this.detectIncompleteChar = utf16DetectIncompleteChar;
      break;
    case 'base64':
      // Base-64 stores 3 bytes in 4 chars, and pads the remainder.
      this.surrogateSize = 3;
      this.detectIncompleteChar = base64DetectIncompleteChar;
      break;
    default:
      this.write = passThroughWrite;
      return;
  }

  // Enough space to store all bytes of a single character. UTF-8 needs 4
  // bytes, but CESU-8 may require up to 6 (3 bytes per surrogate).
  this.charBuffer = new Buffer(6);
  // Number of bytes received for the current incomplete multi-byte character.
  this.charReceived = 0;
  // Number of bytes expected for the current incomplete multi-byte character.
  this.charLength = 0;
};


// write decodes the given buffer and returns it as JS string that is
// guaranteed to not contain any partial multi-byte characters. Any partial
// character found at the end of the buffer is buffered up, and will be
// returned when calling write again with the remaining bytes.
//
// Note: Converting a Buffer containing an orphan surrogate to a String
// currently works, but converting a String to a Buffer (via `new Buffer`, or
// Buffer#write) will replace incomplete surrogates with the unicode
// replacement character. See https://codereview.chromium.org/121173009/ .
StringDecoder.prototype.write = function(buffer) {
  var charStr = '';
  // if our last write ended with an incomplete multibyte character
  while (this.charLength) {
    // determine how many remaining bytes this buffer has to offer for this char
    var available = (buffer.length >= this.charLength - this.charReceived) ?
        this.charLength - this.charReceived :
        buffer.length;

    // add the new bytes to the char buffer
    buffer.copy(this.charBuffer, this.charReceived, 0, available);
    this.charReceived += available;

    if (this.charReceived < this.charLength) {
      // still not enough chars in this buffer? wait for more ...
      return '';
    }

    // remove bytes belonging to the current character from the buffer
    buffer = buffer.slice(available, buffer.length);

    // get the character that was split
    charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);

    // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
    var charCode = charStr.charCodeAt(charStr.length - 1);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      this.charLength += this.surrogateSize;
      charStr = '';
      continue;
    }
    this.charReceived = this.charLength = 0;

    // if there are no more bytes in this buffer, just emit our char
    if (buffer.length === 0) {
      return charStr;
    }
    break;
  }

  // determine and set charLength / charReceived
  this.detectIncompleteChar(buffer);

  var end = buffer.length;
  if (this.charLength) {
    // buffer the incomplete character bytes we got
    buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
    end -= this.charReceived;
  }

  charStr += buffer.toString(this.encoding, 0, end);

  var end = charStr.length - 1;
  var charCode = charStr.charCodeAt(end);
  // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
  if (charCode >= 0xD800 && charCode <= 0xDBFF) {
    var size = this.surrogateSize;
    this.charLength += size;
    this.charReceived += size;
    this.charBuffer.copy(this.charBuffer, size, 0, size);
    buffer.copy(this.charBuffer, 0, 0, size);
    return charStr.substring(0, end);
  }

  // or just emit the charStr
  return charStr;
};

// detectIncompleteChar determines if there is an incomplete UTF-8 character at
// the end of the given buffer. If so, it sets this.charLength to the byte
// length that character, and sets this.charReceived to the number of bytes
// that are available for this character.
StringDecoder.prototype.detectIncompleteChar = function(buffer) {
  // determine how many bytes we have to check at the end of this buffer
  var i = (buffer.length >= 3) ? 3 : buffer.length;

  // Figure out if one of the last i bytes of our buffer announces an
  // incomplete char.
  for (; i > 0; i--) {
    var c = buffer[buffer.length - i];

    // See http://en.wikipedia.org/wiki/UTF-8#Description

    // 110XXXXX
    if (i == 1 && c >> 5 == 0x06) {
      this.charLength = 2;
      break;
    }

    // 1110XXXX
    if (i <= 2 && c >> 4 == 0x0E) {
      this.charLength = 3;
      break;
    }

    // 11110XXX
    if (i <= 3 && c >> 3 == 0x1E) {
      this.charLength = 4;
      break;
    }
  }
  this.charReceived = i;
};

StringDecoder.prototype.end = function(buffer) {
  var res = '';
  if (buffer && buffer.length)
    res = this.write(buffer);

  if (this.charReceived) {
    var cr = this.charReceived;
    var buf = this.charBuffer;
    var enc = this.encoding;
    res += buf.slice(0, cr).toString(enc);
  }

  return res;
};

function passThroughWrite(buffer) {
  return buffer.toString(this.encoding);
}

function utf16DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 2;
  this.charLength = this.charReceived ? 2 : 0;
}

function base64DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 3;
  this.charLength = this.charReceived ? 3 : 0;
}

},{"buffer":2}],23:[function(require,module,exports){
/**
 * lodash 3.0.1 (Custom Build) <https://lodash.com/>
 * Build: `lodash modern modularize exports="npm" -o ./`
 * Copyright 2012-2015 The Dojo Foundation <http://dojofoundation.org/>
 * Based on Underscore.js 1.8.2 <http://underscorejs.org/LICENSE>
 * Copyright 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
 * Available under MIT license <https://lodash.com/license>
 */

/** `Object#toString` result references. */
var errorTag = '[object Error]';

/**
 * Checks if `value` is object-like.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
 */
function isObjectLike(value) {
  return !!value && typeof value == 'object';
}

/** Used for native method references. */
var objectProto = Object.prototype;

/**
 * Used to resolve the [`toStringTag`](https://people.mozilla.org/~jorendorff/es6-draft.html#sec-object.prototype.tostring)
 * of values.
 */
var objToString = objectProto.toString;

/**
 * Checks if `value` is an `Error`, `EvalError`, `RangeError`, `ReferenceError`,
 * `SyntaxError`, `TypeError`, or `URIError` object.
 *
 * @static
 * @memberOf _
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an error object, else `false`.
 * @example
 *
 * _.isError(new Error);
 * // => true
 *
 * _.isError(Error);
 * // => false
 */
function isError(value) {
  return isObjectLike(value) && typeof value.message == 'string' && objToString.call(value) == errorTag;
}

module.exports = isError;

},{}],24:[function(require,module,exports){
var getSvgCoord;

getSvgCoord = require('./svg-coord').get;

module.exports = function(coord, format) {
  var key, parse, ref, ref1, ref2, ref3, ref4, ref5, ref6, ref7, result, val;
  if (coord == null) {
    return {};
  }
  if (!((format.zero != null) && (format.places != null))) {
    throw new Error('format undefined');
  }
  parse = {};
  result = {};
  parse.x = (ref = coord.match(/X[+-]?[\d\.]+/)) != null ? (ref1 = ref[0]) != null ? ref1.slice(1) : void 0 : void 0;
  parse.y = (ref2 = coord.match(/Y[+-]?[\d\.]+/)) != null ? (ref3 = ref2[0]) != null ? ref3.slice(1) : void 0 : void 0;
  parse.i = (ref4 = coord.match(/I[+-]?[\d\.]+/)) != null ? (ref5 = ref4[0]) != null ? ref5.slice(1) : void 0 : void 0;
  parse.j = (ref6 = coord.match(/J[+-]?[\d\.]+/)) != null ? (ref7 = ref6[0]) != null ? ref7.slice(1) : void 0 : void 0;
  for (key in parse) {
    val = parse[key];
    if (val != null) {
      result[key] = getSvgCoord(val, format);
    }
  }
  return result;
};


},{"./svg-coord":36}],25:[function(require,module,exports){
var ABS_COMMAND, DrillParser, INCH_COMMAND, INC_COMMAND, METRIC_COMMAND, PLACES_BACKUP, Parser, ZERO_BACKUP, getSvgCoord, parseCoord, reCOORD,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Parser = require('./parser');

parseCoord = require('./coord-parser');

getSvgCoord = require('./svg-coord').get;

INCH_COMMAND = {
  'FMAT,1': 'M70',
  'FMAT,2': 'M72'
};

METRIC_COMMAND = 'M71';

ABS_COMMAND = 'G90';

INC_COMMAND = 'G91';

reCOORD = /[XY]{1,2}/;

ZERO_BACKUP = 'L';

PLACES_BACKUP = [2, 4];

DrillParser = (function(superClass) {
  extend(DrillParser, superClass);

  function DrillParser() {
    this.fmat = 'FMAT,2';
    DrillParser.__super__.constructor.call(this, arguments[0]);
  }

  DrillParser.prototype.parseCommand = function(block) {
    var base, base1, base2, base3, code, command, dia, k, ref, ref1, ref2, v;
    command = {};
    if (block[0] === ';') {
      return command;
    }
    if (block === 'FMAT,1') {
      this.fmat = block;
    } else if (block === 'M30' || block === 'M00') {
      command.set = {
        done: true
      };
    } else if (block === INCH_COMMAND[this.fmat] || block.match(/INCH/)) {
      if ((base = this.format).places == null) {
        base.places = [2, 4];
      }
      command.set = {
        units: 'in'
      };
    } else if (block === METRIC_COMMAND || block.match(/METRIC/)) {
      if ((base1 = this.format).places == null) {
        base1.places = [3, 3];
      }
      command.set = {
        units: 'mm'
      };
    } else if (block === ABS_COMMAND) {
      command.set = {
        notation: 'A'
      };
    } else if (block === INC_COMMAND) {
      command.set = {
        notation: 'I'
      };
    } else if ((code = (ref = block.match(/T\d+/)) != null ? ref[0] : void 0)) {
      while (code[1] === '0') {
        code = code[0] + code.slice(2);
      }
      if ((dia = (ref1 = block.match(/C[\d\.]+(?=.*$)/)) != null ? ref1[0] : void 0)) {
        dia = dia.slice(1);
        command.tool = {};
        command.tool[code] = {
          dia: getSvgCoord(dia, {
            places: this.format.places
          })
        };
      } else {
        command.set = {
          currentTool: code
        };
      }
    }
    if (block.match(/TZ/)) {
      if ((base2 = this.format).zero == null) {
        base2.zero = 'L';
      }
    } else if (block.match(/LZ/)) {
      if ((base3 = this.format).zero == null) {
        base3.zero = 'T';
      }
    }
    if (block.match(reCOORD)) {
      command.op = {
        "do": 'flash'
      };
      if (this.format.zero == null) {
        console.warn('no drill file zero suppression specified. assuming leading zero suppression (same as no zero suppression)');
        this.format.zero = ZERO_BACKUP;
      }
      if (this.format.places == null) {
        console.warn('no drill file units specified; assuming 2:4 inches format');
        this.format.places = PLACES_BACKUP;
      }
      ref2 = parseCoord(block, this.format);
      for (k in ref2) {
        v = ref2[k];
        command.op[k] = v;
      }
    }
    return command;
  };

  return DrillParser;

})(Parser);

module.exports = DrillParser;


},{"./coord-parser":24,"./parser":33,"./svg-coord":36}],26:[function(require,module,exports){
var DrillReader;

DrillReader = (function() {
  function DrillReader(drillFile) {
    this.line = 0;
    this.blocks = drillFile.split(/\r?\n/);
  }

  DrillReader.prototype.nextBlock = function() {
    if (this.line < this.blocks.length) {
      return this.blocks[++this.line - 1];
    } else {
      return false;
    }
  };

  return DrillReader;

})();

module.exports = DrillReader;


},{}],27:[function(require,module,exports){
var GerberParser, Parser, getSvgCoord, parseCoord, reCOORD, reINT, reOP, reTOOL,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Parser = require('./parser');

parseCoord = require('./coord-parser');

getSvgCoord = require('./svg-coord').get;

reCOORD = /([XYIJ][+-]?\d+){1,4}/g;

reTOOL = /(G54)?D0*[1-9]\d+/;

reINT = /G0*[123]/;

reOP = /D0*[123]$/;

GerberParser = (function(superClass) {
  extend(GerberParser, superClass);

  function GerberParser() {
    return GerberParser.__super__.constructor.apply(this, arguments);
  }

  GerberParser.prototype.parseBlock = function(block, line) {
    var axis, coord, coordMatch, intMode, mode, modeOp, op, opType, ref, ref1, val;
    if (/^G0*4/.test(block)) {
      return null;
    }
    if (block === 'M02') {
      return {
        set: {
          done: true
        }
      };
    }
    if (reTOOL.test(block)) {
      return this.parseToolChange(block, line);
    }
    if (block === 'G36') {
      return {
        set: {
          region: true
        }
      };
    }
    if (block === 'G37') {
      return {
        set: {
          region: false
        }
      };
    }
    if (block === 'G70') {
      return {
        set: {
          backupUnits: 'in'
        }
      };
    }
    if (block === 'G71') {
      return {
        set: {
          backupUnits: 'mm'
        }
      };
    }
    if (block === 'G74') {
      return {
        set: {
          quad: 's'
        }
      };
    }
    if (block === 'G75') {
      return {
        set: {
          quad: 'm'
        }
      };
    }
    modeOp = null;
    if (intMode = block.match(reINT)) {
      switch (intMode[0].slice(-1)) {
        case '1':
          mode = 'i';
          break;
        case '2':
          mode = 'cw';
          break;
        case '3':
          mode = 'ccw';
      }
      modeOp = {
        set: {
          mode: mode
        }
      };
    }
    coordMatch = (ref = block.match(reCOORD)) != null ? ref[0] : void 0;
    if ((opType = block.match(reOP)) || (coordMatch != null)) {
      op = {};
      coord = parseCoord(coordMatch, this.format);
      for (axis in coord) {
        val = coord[axis];
        op[axis] = val;
      }
      switch (opType != null ? (ref1 = opType[0]) != null ? ref1.slice(-1) : void 0 : void 0) {
        case '1':
          op["do"] = 'int';
          break;
        case '2':
          op["do"] = 'move';
          break;
        case '3':
          op["do"] = 'flash';
          break;
        default:
          op["do"] = 'last';
      }
      if (modeOp != null) {
        modeOp.op = op;
      } else {
        modeOp = {
          op: op
        };
      }
    }
    return modeOp;
  };

  GerberParser.prototype.parseParam = function(param, line) {
    var code, macro;
    if (param === false) {
      macro = {};
      macro[this.macroName] = this.macroBlocks;
      this.macroName = '';
      return {
        macro: macro
      };
    }
    code = param.slice(0, 2);
    if (code === 'FS') {
      return this.parseFormat(param, line);
    }
    if (code === 'MO') {
      return this.parseUnits(param, line);
    }
    if (code === 'AD') {
      return this.parseToolDef(param, line);
    }
    if (code === 'AM') {
      this.macroName = param.slice(2);
      this.macroBlocks = [];
      return null;
    }
    if (this.macroName) {
      this.macroBlocks.push(param);
      return null;
    }
    if (code === 'LP') {
      return this.parsePolarity(param, line);
    }
    if (code === 'SR') {
      return this.parseStepRepeat(param, line);
    }
  };

  GerberParser.prototype.parseFormat = function(p, l) {
    var base, base1, nota, x, y, zero;
    zero = p[2] === 'L' || p[2] === 'T' ? p[2] : null;
    nota = p[3] === 'A' || p[3] === 'I' ? p[3] : null;
    if (p[4] === 'X') {
      x = [Number(p[5]), Number(p[6])];
    }
    if (p[7] === 'Y') {
      y = [Number(p[8]), Number(p[9])];
    }
    if (nota == null) {
      return new Error("line " + l + " - notation format must be 'A' or 'I'");
    }
    if (zero == null) {
      return new Error("line " + l + " - zero suppression format must be 'L' or 'T'");
    }
    if ((x == null) || (y == null) || isNaN(x[0]) || isNaN(x[1]) || x[0] > 7 || x[1] > 7) {
      return new Error("line " + l + " - coordinate place format must be \"X[0-7][0-7]Y[0-7][0-7]\"");
    }
    if (x[0] !== y[0] || x[1] !== y[1]) {
      return new Error("line " + l + " - coordinate x and y place formats must match");
    }
    if ((base = this.format).zero == null) {
      base.zero = zero;
    }
    if ((base1 = this.format).places == null) {
      base1.places = x;
    }
    return {
      set: {
        notation: nota
      }
    };
  };

  GerberParser.prototype.parseUnits = function(p, l) {
    var mode, units;
    mode = p.slice(2);
    if (mode === 'IN') {
      units = 'in';
    } else if (mode === 'MM') {
      units = 'mm';
    } else {
      return new Error("line " + l + " - " + mode + " is an invalid units mode; mode must be \"IN\" or \"MM\"");
    }
    return {
      set: {
        units: units
      }
    };
  };

  GerberParser.prototype.parseToolDef = function(p, l) {
    var code, hole, m, mods, ref, ref1, shape, tool;
    tool = {};
    code = (ref = p.match(/^ADD\d{2,}/)) != null ? ref[0].slice(2) : void 0;
    ref1 = p.slice(2 + code.length).split(','), shape = ref1[0], mods = ref1[1];
    mods = mods != null ? mods.split('X') : void 0;
    while (code[1] === '0') {
      code = code[0] + code.slice(2);
    }
    tool[code] = {};
    switch (shape) {
      case 'C':
        if (mods.length > 2) {
          hole = {
            width: getSvgCoord(mods[1], {
              places: this.format.places
            }),
            height: getSvgCoord(mods[2], {
              places: this.format.places
            })
          };
        } else if (mods.length > 1) {
          hole = {
            dia: getSvgCoord(mods[1], {
              places: this.format.places
            })
          };
        }
        tool[code].dia = getSvgCoord(mods[0], {
          places: this.format.places
        });
        if (hole != null) {
          tool[code].hole = hole;
        }
        break;
      case 'R':
      case 'O':
        if (mods.length > 3) {
          hole = {
            width: getSvgCoord(mods[2], {
              places: this.format.places
            }),
            height: getSvgCoord(mods[3], {
              places: this.format.places
            })
          };
        } else if (mods.length > 2) {
          hole = {
            dia: getSvgCoord(mods[2], {
              places: this.format.places
            })
          };
        }
        tool[code].width = getSvgCoord(mods[0], {
          places: this.format.places
        });
        tool[code].height = getSvgCoord(mods[1], {
          places: this.format.places
        });
        if (shape === 'O') {
          tool[code].obround = true;
        }
        if (hole != null) {
          tool[code].hole = hole;
        }
        break;
      case 'P':
        if (mods.length > 4) {
          hole = {
            width: getSvgCoord(mods[3], {
              places: this.format.places
            }),
            height: getSvgCoord(mods[4], {
              places: this.format.places
            })
          };
        } else if (mods.length > 3) {
          hole = {
            dia: getSvgCoord(mods[3], {
              places: this.format.places
            })
          };
        }
        tool[code].dia = getSvgCoord(mods[0], {
          places: this.format.places
        });
        tool[code].vertices = Number(mods[1]);
        if (mods.length > 2) {
          tool[code].degrees = Number(mods[2]);
        }
        if (hole != null) {
          tool[code].hole = hole;
        }
        break;
      default:
        mods = (function() {
          var k, len, ref2, results;
          ref2 = mods != null ? mods : [];
          results = [];
          for (k = 0, len = ref2.length; k < len; k++) {
            m = ref2[k];
            results.push(Number(m));
          }
          return results;
        })();
        tool[code].macro = shape;
        tool[code].mods = mods;
    }
    return {
      tool: tool
    };
  };

  GerberParser.prototype.parsePolarity = function(p, l) {
    if (p[2] === 'D' || p[2] === 'C') {
      return {
        "new": {
          layer: p[2]
        }
      };
    } else {
      return new Error("line " + l + " - level polarity must be 'D' or 'C'");
    }
  };

  GerberParser.prototype.parseStepRepeat = function(p, l) {
    var i, j, ref, ref1, ref2, ref3, ref4, ref5, sr, x, y;
    x = (ref = (ref1 = p.match(/X[+-]?[\d\.]+/)) != null ? ref1[0].slice(1) : void 0) != null ? ref : 1;
    y = (ref2 = (ref3 = p.match(/Y[+-]?[\d\.]+/)) != null ? ref3[0].slice(1) : void 0) != null ? ref2 : 1;
    i = (ref4 = p.match(/I[+-]?[\d\.]+/)) != null ? ref4[0].slice(1) : void 0;
    j = (ref5 = p.match(/J[+-]?[\d\.]+/)) != null ? ref5[0].slice(1) : void 0;
    if (x < 1) {
      return new Error("line " + l + " - X must be a positive integer if in SR block");
    }
    if (y < 1) {
      return new Error("line " + l + " - Y must be a positive integer if in SR block");
    }
    if (i < 0 || (x > 1 && (i == null))) {
      return new Error("line " + l + " - I must be a positive number if X is present in SR block");
    }
    if (j < 0 || (y > 1 && (j == null))) {
      return new Error("line " + l + " - J must be a positive number if Y is present in SR block");
    }
    sr = {
      x: Number(x),
      y: Number(y)
    };
    if (i != null) {
      sr.i = getSvgCoord(i, {
        places: this.format.places
      });
    }
    if (j != null) {
      sr.j = getSvgCoord(j, {
        places: this.format.places
      });
    }
    return {
      "new": {
        sr: sr
      }
    };
  };

  GerberParser.prototype.parseToolChange = function(b, l) {
    var code;
    code = b.match(/D\d+/)[0];
    while (code[1] === '0') {
      code = code[0] + code.slice(2);
    }
    return {
      set: {
        currentTool: code
      }
    };
  };

  return GerberParser;

})(Parser);

module.exports = GerberParser;


},{"./coord-parser":24,"./parser":33,"./svg-coord":36}],28:[function(require,module,exports){
var GerberReader;

GerberReader = (function() {
  function GerberReader(gerberFile) {
    this.gerberFile = gerberFile != null ? gerberFile : '';
    this.line = 0;
    this.charIndex = 0;
    this.end = this.gerberFile.length;
  }

  GerberReader.prototype.nextBlock = function() {
    var char, current, parameter;
    if (this.index >= this.end) {
      return false;
    }
    current = '';
    parameter = false;
    if (this.line === 0) {
      this.line++;
    }
    while (!(this.charIndex >= this.end)) {
      char = this.gerberFile[this.charIndex++];
      if (char === '%') {
        if (!parameter) {
          parameter = [];
        } else {
          return {
            param: parameter
          };
        }
      } else if (char === '*') {
        if (parameter) {
          parameter.push(current);
          current = '';
        } else {
          return {
            block: current
          };
        }
      } else if (char === '\n') {
        this.line++;
      } else if ((' ' <= char && char <= '~')) {
        current += char;
      }
    }
    return false;
  };

  GerberReader.prototype.getLine = function() {
    return this.line;
  };

  return GerberReader;

})();

module.exports = GerberReader;


},{}],29:[function(require,module,exports){
var NUMBER, OPERATOR, TOKEN, isNumber, parse, tokenize;

OPERATOR = /[\+\-\/xX\(\)]/;

NUMBER = /[\$\d\.]+/;

TOKEN = new RegExp("(" + OPERATOR.source + ")|(" + NUMBER.source + ")", 'g');

tokenize = function(arith) {
  var results;
  return results = arith.match(TOKEN);
};

isNumber = function(token) {
  return NUMBER.test(token);
};

parse = function(arith) {
  var consume, index, parseExpression, parseMultiplication, parsePrimary, peek, tokens;
  tokens = tokenize(arith);
  index = 0;
  peek = function() {
    return tokens[index];
  };
  consume = function(t) {
    if (t === peek()) {
      return index++;
    }
  };
  parsePrimary = function() {
    var exp, t;
    t = peek();
    consume(t);
    if (isNumber(t)) {
      exp = {
        type: 'n',
        val: t
      };
    } else if (t === '(') {
      exp = parseExpression();
      if (peek() !== ')') {
        throw new Error("expected ')'");
      } else {
        consume(')');
      }
    } else {
      throw new Error(t + " is unexpected in an arithmetic string");
    }
    return exp;
  };
  parseMultiplication = function() {
    var exp, rhs, t;
    exp = parsePrimary();
    t = peek();
    while (t === 'x' || t === '/' || t === 'X') {
      consume(t);
      if (t === 'X') {
        console.warn("Warning: uppercase 'X' as multiplication symbol is incorrect; macros should use lowercase 'x' to multiply");
        t = 'x';
      }
      rhs = parsePrimary();
      exp = {
        type: t,
        left: exp,
        right: rhs
      };
      t = peek();
    }
    return exp;
  };
  parseExpression = function() {
    var exp, rhs, t;
    exp = parseMultiplication();
    t = peek();
    while (t === '+' || t === '-') {
      consume(t);
      rhs = parseMultiplication();
      exp = {
        type: t,
        left: exp,
        right: rhs
      };
      t = peek();
    }
    return exp;
  };
  return parseExpression();
};

module.exports = {
  tokenize: tokenize,
  isNumber: isNumber,
  parse: parse
};


},{}],30:[function(require,module,exports){
var MacroTool, calc, getSvgCoord, shapes, unique;

shapes = require('./pad-shapes');

calc = require('./macro-calc');

unique = require('./unique-id');

getSvgCoord = require('./svg-coord').get;

MacroTool = (function() {
  function MacroTool(blocks, numberFormat) {
    this.modifiers = {};
    this.name = blocks[0].slice(2);
    this.blocks = blocks.slice(1);
    this.shapes = [];
    this.masks = [];
    this.lastExposure = null;
    this.bbox = [null, null, null, null];
    this.format = {
      places: numberFormat
    };
  }

  MacroTool.prototype.run = function(tool, modifiers) {
    var b, group, i, j, k, l, len, len1, len2, len3, m, n, pad, padId, ref, ref1, ref2, s, shape;
    if (modifiers == null) {
      modifiers = [];
    }
    this.lastExposure = null;
    this.shapes = [];
    this.masks = [];
    this.bbox = [null, null, null, null];
    this.modifiers = {};
    for (i = j = 0, len = modifiers.length; j < len; i = ++j) {
      m = modifiers[i];
      this.modifiers["$" + (i + 1)] = m;
    }
    ref = this.blocks;
    for (k = 0, len1 = ref.length; k < len1; k++) {
      b = ref[k];
      this.runBlock(b);
    }
    padId = "tool-" + tool + "-pad-" + (unique());
    pad = [];
    ref1 = this.masks;
    for (l = 0, len2 = ref1.length; l < len2; l++) {
      m = ref1[l];
      pad.push(m);
    }
    if (this.shapes.length > 1) {
      group = {
        id: padId,
        _: []
      };
      ref2 = this.shapes;
      for (n = 0, len3 = ref2.length; n < len3; n++) {
        s = ref2[n];
        group._.push(s);
      }
      pad = [
        {
          g: group
        }
      ];
    } else if (this.shapes.length === 1) {
      shape = Object.keys(this.shapes[0])[0];
      this.shapes[0][shape].id = padId;
      pad.push(this.shapes[0]);
    }
    return {
      pad: pad,
      padId: padId,
      bbox: this.bbox,
      trace: false
    };
  };

  MacroTool.prototype.runBlock = function(block) {
    var a, args, i, j, len, mod, ref, val;
    switch (block[0]) {
      case '$':
        mod = (ref = block.match(/^\$\d+(?=\=)/)) != null ? ref[0] : void 0;
        val = block.slice(1 + mod.length);
        return this.modifiers[mod] = this.getNumber(val);
      case '1':
      case '2':
      case '20':
      case '21':
      case '22':
      case '4':
      case '5':
      case '6':
      case '7':
        args = block.split(',');
        for (i = j = 0, len = args.length; j < len; i = ++j) {
          a = args[i];
          args[i] = this.getNumber(a);
        }
        return this.primitive(args);
      default:
        if (block[0] !== '0') {
          throw new Error("'" + block + "' unrecognized tool macro block");
        }
    }
  };

  MacroTool.prototype.primitive = function(args) {
    var group, i, j, k, key, l, len, len1, len2, len3, len4, m, mask, maskId, n, o, points, q, ref, ref1, ref2, ref3, ref4, ref5, results, rot, rotation, s, shape;
    mask = false;
    rotation = false;
    shape = null;
    switch (args[0]) {
      case 1:
        shape = shapes.circle({
          dia: getSvgCoord(args[2], this.format),
          cx: getSvgCoord(args[3], this.format),
          cy: getSvgCoord(args[4], this.format)
        });
        if (args[1] === 0) {
          mask = true;
        } else {
          this.addBbox(shape.bbox);
        }
        break;
      case 2:
      case 20:
        shape = shapes.vector({
          width: getSvgCoord(args[2], this.format),
          x1: getSvgCoord(args[3], this.format),
          y1: getSvgCoord(args[4], this.format),
          x2: getSvgCoord(args[5], this.format),
          y2: getSvgCoord(args[6], this.format)
        });
        if (args[7]) {
          shape.shape.line.transform = "rotate(" + args[7] + ")";
        }
        if (args[1] === 0) {
          mask = true;
        } else {
          this.addBbox(shape.bbox, args[7]);
        }
        break;
      case 21:
        shape = shapes.rect({
          cx: getSvgCoord(args[4], this.format),
          cy: getSvgCoord(args[5], this.format),
          width: getSvgCoord(args[2], this.format),
          height: getSvgCoord(args[3], this.format)
        });
        if (args[6]) {
          shape.shape.rect.transform = "rotate(" + args[6] + ")";
        }
        if (args[1] === 0) {
          mask = true;
        } else {
          this.addBbox(shape.bbox, args[6]);
        }
        break;
      case 22:
        shape = shapes.lowerLeftRect({
          x: getSvgCoord(args[4], this.format),
          y: getSvgCoord(args[5], this.format),
          width: getSvgCoord(args[2], this.format),
          height: getSvgCoord(args[3], this.format)
        });
        if (args[6]) {
          shape.shape.rect.transform = "rotate(" + args[6] + ")";
        }
        if (args[1] === 0) {
          mask = true;
        } else {
          this.addBbox(shape.bbox, args[6]);
        }
        break;
      case 4:
        points = [];
        for (i = j = 3, ref = 3 + 2 * args[2]; j <= ref; i = j += 2) {
          points.push([getSvgCoord(args[i], this.format), getSvgCoord(args[i + 1], this.format)]);
        }
        shape = shapes.outline({
          points: points
        });
        if (rot = args[args.length - 1]) {
          shape.shape.polygon.transform = "rotate(" + rot + ")";
        }
        if (args[1] === 0) {
          mask = true;
        } else {
          this.addBbox(shape.bbox, args[args.length - 1]);
        }
        break;
      case 5:
        if (args[6] !== 0 && (args[3] !== 0 || args[4] !== 0)) {
          throw new RangeError('polygon center must be 0,0 if rotated in macro');
        }
        shape = shapes.polygon({
          cx: getSvgCoord(args[3], this.format),
          cy: getSvgCoord(args[4], this.format),
          dia: getSvgCoord(args[5], this.format),
          vertices: args[2],
          degrees: args[6]
        });
        if (args[1] === 0) {
          mask = true;
        } else {
          this.addBbox(shape.bbox);
        }
        break;
      case 6:
        if (args[9] !== 0 && (args[1] !== 0 || args[2] !== 0)) {
          throw new RangeError('moiré center must be 0,0 if rotated in macro');
        }
        shape = shapes.moire({
          cx: getSvgCoord(args[1], this.format),
          cy: getSvgCoord(args[2], this.format),
          outerDia: getSvgCoord(args[3], this.format),
          ringThx: getSvgCoord(args[4], this.format),
          ringGap: getSvgCoord(args[5], this.format),
          maxRings: args[6],
          crossThx: getSvgCoord(args[7], this.format),
          crossLength: getSvgCoord(args[8], this.format)
        });
        if (args[9]) {
          ref1 = shape.shape;
          for (k = 0, len = ref1.length; k < len; k++) {
            s = ref1[k];
            if (s.line != null) {
              s.line.transform = "rotate(" + args[9] + ")";
            }
          }
        }
        this.addBbox(shape.bbox, args[9]);
        break;
      case 7:
        if (args[9] !== 0 && (args[1] !== 0 || args[2] !== 0)) {
          throw new RangeError('thermal center must be 0,0 if rotated in macro');
        }
        shape = shapes.thermal({
          cx: getSvgCoord(args[1], this.format),
          cy: getSvgCoord(args[2], this.format),
          outerDia: getSvgCoord(args[3], this.format),
          innerDia: getSvgCoord(args[4], this.format),
          gap: getSvgCoord(args[5], this.format)
        });
        if (args[6]) {
          ref2 = shape.shape;
          for (l = 0, len1 = ref2.length; l < len1; l++) {
            s = ref2[l];
            if (s.mask != null) {
              ref3 = s.mask._;
              for (n = 0, len2 = ref3.length; n < len2; n++) {
                m = ref3[n];
                if (m.rect != null) {
                  m.rect.transform = "rotate(" + args[6] + ")";
                }
              }
            }
          }
        }
        this.addBbox(shape.bbox, args[6]);
        break;
      default:
        throw new Error(args[0] + " is not a valid primitive code");
    }
    if (mask) {
      for (key in shape.shape) {
        shape.shape[key].fill = '#000';
      }
      if (this.lastExposure !== 0) {
        this.lastExposure = 0;
        maskId = "macro-" + this.name + "-mask-" + (unique());
        m = {
          mask: {
            id: maskId
          }
        };
        m.mask._ = [
          {
            rect: {
              x: this.bbox[0],
              y: this.bbox[1],
              width: this.bbox[2] - this.bbox[0],
              height: this.bbox[3] - this.bbox[1],
              fill: '#fff'
            }
          }
        ];
        if (this.shapes.length === 1) {
          for (key in this.shapes[0]) {
            this.shapes[0][key].mask = "url(#" + maskId + ")";
          }
        } else if (this.shapes.length > 1) {
          group = {
            mask: "url(#" + maskId + ")",
            _: []
          };
          ref4 = this.shapes;
          for (o = 0, len3 = ref4.length; o < len3; o++) {
            s = ref4[o];
            group._.push(s);
          }
          this.shapes = [
            {
              g: group
            }
          ];
        }
        this.masks.push(m);
      }
      return this.masks[this.masks.length - 1].mask._.push(shape.shape);
    } else {
      this.lastExposure = 1;
      if (!Array.isArray(shape.shape)) {
        return this.shapes.push(shape.shape);
      } else {
        ref5 = shape.shape;
        results = [];
        for (q = 0, len4 = ref5.length; q < len4; q++) {
          s = ref5[q];
          if (s.mask != null) {
            results.push(this.masks.push(s));
          } else {
            results.push(this.shapes.push(s));
          }
        }
        return results;
      }
    }
  };

  MacroTool.prototype.addBbox = function(bbox, rotation) {
    var b, c, j, len, p, points, s, x, y;
    if (rotation == null) {
      rotation = 0;
    }
    if (!rotation) {
      if (this.bbox[0] === null || bbox[0] < this.bbox[0]) {
        this.bbox[0] = bbox[0];
      }
      if (this.bbox[1] === null || bbox[1] < this.bbox[1]) {
        this.bbox[1] = bbox[1];
      }
      if (this.bbox[2] === null || bbox[2] > this.bbox[2]) {
        this.bbox[2] = bbox[2];
      }
      if (this.bbox[3] === null || bbox[3] > this.bbox[3]) {
        return this.bbox[3] = bbox[3];
      }
    } else {
      s = Math.sin(rotation * Math.PI / 180);
      c = Math.cos(rotation * Math.PI / 180);
      if (Math.abs(s) < 0.000000001) {
        s = 0;
      }
      if (Math.abs(c) < 0.000000001) {
        c = 0;
      }
      points = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]]];
      for (j = 0, len = points.length; j < len; j++) {
        p = points[j];
        x = (p[0] * c) - (p[1] * s);
        y = (p[0] * s) + (p[1] * c);
        if (this.bbox[0] === null || x < this.bbox[0]) {
          this.bbox[0] = x;
        }
        if (this.bbox[1] === null || y < this.bbox[1]) {
          this.bbox[1] = y;
        }
        if (this.bbox[2] === null || x > this.bbox[2]) {
          this.bbox[2] = x;
        }
        if (this.bbox[3] === null || y > this.bbox[3]) {
          this.bbox[3] = y;
        }
      }
      return this.bbox = (function() {
        var k, len1, ref, results;
        ref = this.bbox;
        results = [];
        for (k = 0, len1 = ref.length; k < len1; k++) {
          b = ref[k];
          results.push(b === -0 ? 0 : b);
        }
        return results;
      }).call(this);
    }
  };

  MacroTool.prototype.getNumber = function(s) {
    if (s.match(/^[+-]?[\d.]+$/)) {
      return Number(s);
    } else if (s.match(/^\$\d+$/)) {
      return Number(this.modifiers[s]);
    } else {
      return this.evaluate(calc.parse(s));
    }
  };

  MacroTool.prototype.evaluate = function(op) {
    switch (op.type) {
      case 'n':
        return this.getNumber(op.val);
      case '+':
        return this.evaluate(op.left) + this.evaluate(op.right);
      case '-':
        return this.evaluate(op.left) - this.evaluate(op.right);
      case 'x':
        return this.evaluate(op.left) * this.evaluate(op.right);
      case '/':
        return this.evaluate(op.left) / this.evaluate(op.right);
    }
  };

  return MacroTool;

})();

module.exports = MacroTool;


},{"./macro-calc":29,"./pad-shapes":32,"./svg-coord":36,"./unique-id":37}],31:[function(require,module,exports){
var CKEY, DTAB, objToXml, repeat;

repeat = function(pattern, count) {
  var result;
  result = '';
  if (count === 0) {
    return '';
  }
  while (count > 1) {
    if (count & 1) {
      result += pattern;
    }
    count >>= 1;
    pattern += pattern;
  }
  return result + pattern;
};

CKEY = '_';

DTAB = '  ';

objToXml = function(obj, op) {
  var children, dec, decimals, elem, i, ind, j, key, len, nl, o, pre, ref, ref1, ref2, tb, v, val, xml;
  if (op == null) {
    op = {};
  }
  pre = op.pretty;
  ind = (ref = op.indent) != null ? ref : 0;
  dec = (ref1 = op.maxDec) != null ? ref1 : false;
  decimals = function(n) {
    if (typeof n === 'number') {
      return Number(n.toFixed(dec));
    } else {
      return n;
    }
  };
  nl = pre ? '\n' : '';
  tb = nl ? (typeof pre === 'string' ? pre : DTAB) : '';
  tb = repeat(tb, ind);
  xml = '';
  if (typeof obj === 'function') {
    obj = obj();
  }
  if (Array.isArray(obj)) {
    for (i = j = 0, len = obj.length; j < len; i = ++j) {
      o = obj[i];
      xml += (i !== 0 ? nl : '') + (objToXml(o, op));
    }
  } else if (typeof obj === 'object') {
    children = false;
    elem = Object.keys(obj)[0];
    if (elem != null) {
      xml = tb + "<" + elem;
      if (typeof obj[elem] === 'function') {
        obj[elem] = obj[elem]();
      }
      ref2 = obj[elem];
      for (key in ref2) {
        val = ref2[key];
        if (typeof val === 'function') {
          val = val();
        }
        if (key === CKEY) {
          children = val;
        } else {
          if (Array.isArray(val)) {
            if (dec) {
              val = (function() {
                var k, len1, results;
                results = [];
                for (k = 0, len1 = val.length; k < len1; k++) {
                  v = val[k];
                  results.push(decimals(v));
                }
                return results;
              })();
            }
            val = val.join(' ');
          }
          if (dec) {
            val = decimals(val);
          }
          xml += " " + key + "=\"" + val + "\"";
        }
      }
      if (children) {
        xml += '>' + nl + objToXml(children, {
          pretty: pre,
          indent: ind + 1
        });
      }
      if (obj[elem]._ != null) {
        xml += "" + nl + tb + "</" + elem + ">";
      } else {
        xml += '/>';
      }
    }
  } else {
    xml += obj + " ";
  }
  return xml;
};

module.exports = objToXml;


},{}],32:[function(require,module,exports){
var circle, lowerLeftRect, moire, outline, polygon, rect, thermal, unique, vector;

unique = require('./unique-id');

circle = function(p) {
  var r;
  if (p.dia == null) {
    throw new Error('circle function requires diameter');
  }
  if (p.cx == null) {
    throw new Error('circle function requires x center');
  }
  if (p.cy == null) {
    throw new Error('circle function requires y center');
  }
  r = p.dia / 2;
  return {
    shape: {
      circle: {
        cx: p.cx,
        cy: p.cy,
        r: r
      }
    },
    bbox: [p.cx - r, p.cy - r, p.cx + r, p.cy + r]
  };
};

rect = function(p) {
  var radius, rectangle, x, y;
  if (p.width == null) {
    throw new Error('rectangle requires width');
  }
  if (p.height == null) {
    throw new Error('rectangle requires height');
  }
  if (p.cx == null) {
    throw new Error('rectangle function requires x center');
  }
  if (p.cy == null) {
    throw new Error('rectangle function requires y center');
  }
  x = p.cx - p.width / 2;
  y = p.cy - p.height / 2;
  rectangle = {
    shape: {
      rect: {
        x: x,
        y: y,
        width: p.width,
        height: p.height
      }
    },
    bbox: [x, y, x + p.width, y + p.height]
  };
  if (p.obround) {
    radius = 0.5 * Math.min(p.width, p.height);
    rectangle.shape.rect.rx = radius;
    rectangle.shape.rect.ry = radius;
  }
  return rectangle;
};

polygon = function(p) {
  var i, j, points, r, ref, rx, ry, start, step, theta, x, xMax, xMin, y, yMax, yMin;
  if (p.dia == null) {
    throw new Error('polygon requires diameter');
  }
  if (p.vertices == null) {
    throw new Error('polygon requires vertices');
  }
  if (p.cx == null) {
    throw new Error('polygon function requires x center');
  }
  if (p.cy == null) {
    throw new Error('polygon function requires y center');
  }
  start = p.degrees != null ? p.degrees * Math.PI / 180 : 0;
  step = 2 * Math.PI / p.vertices;
  r = p.dia / 2;
  points = '';
  xMin = null;
  yMin = null;
  xMax = null;
  yMax = null;
  for (i = j = 0, ref = p.vertices; 0 <= ref ? j < ref : j > ref; i = 0 <= ref ? ++j : --j) {
    theta = start + (i * step);
    rx = r * Math.cos(theta);
    ry = r * Math.sin(theta);
    if (Math.abs(rx) < 0.000000001) {
      rx = 0;
    }
    if (Math.abs(ry) < 0.000000001) {
      ry = 0;
    }
    x = p.cx + rx;
    y = p.cy + ry;
    if (x < xMin || xMin === null) {
      xMin = x;
    }
    if (x > xMax || xMax === null) {
      xMax = x;
    }
    if (y < yMin || yMin === null) {
      yMin = y;
    }
    if (y > yMax || yMax === null) {
      yMax = y;
    }
    points += " " + x + "," + y;
  }
  return {
    shape: {
      polygon: {
        points: points.slice(1)
      }
    },
    bbox: [xMin, yMin, xMax, yMax]
  };
};

vector = function(p) {
  var theta, xDelta, yDelta;
  if (p.x1 == null) {
    throw new Error('vector function requires start x');
  }
  if (p.y1 == null) {
    throw new Error('vector function requires start y');
  }
  if (p.x2 == null) {
    throw new Error('vector function requires end x');
  }
  if (p.y2 == null) {
    throw new Error('vector function requires end y');
  }
  if (p.width == null) {
    throw new Error('vector function requires width');
  }
  theta = Math.abs(Math.atan((p.y2 - p.y1) / (p.x2 - p.x1)));
  xDelta = p.width / 2 * Math.sin(theta);
  yDelta = p.width / 2 * Math.cos(theta);
  if (xDelta < 0.0000001) {
    xDelta = 0;
  }
  if (yDelta < 0.0000001) {
    yDelta = 0;
  }
  return {
    shape: {
      line: {
        x1: p.x1,
        x2: p.x2,
        y1: p.y1,
        y2: p.y2,
        'stroke-width': p.width,
        'stroke-linecap': 'butt'
      }
    },
    bbox: [(Math.min(p.x1, p.x2)) - xDelta, (Math.min(p.y1, p.y2)) - yDelta, (Math.max(p.x1, p.x2)) + xDelta, (Math.max(p.y1, p.y2)) + yDelta]
  };
};

lowerLeftRect = function(p) {
  if (p.width == null) {
    throw new Error('lower left rect requires width');
  }
  if (p.height == null) {
    throw new Error('lower left rect requires height');
  }
  if (p.x == null) {
    throw new Error('lower left rectangle requires x');
  }
  if (p.y == null) {
    throw new Error('lower left rectangle requires y');
  }
  return {
    shape: {
      rect: {
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height
      }
    },
    bbox: [p.x, p.y, p.x + p.width, p.y + p.height]
  };
};

outline = function(p) {
  var j, len, point, pointString, ref, x, xLast, xMax, xMin, y, yLast, yMax, yMin;
  if (!(Array.isArray(p.points) && p.points.length > 1)) {
    throw new Error('outline function requires points array');
  }
  xMin = null;
  yMin = null;
  xMax = null;
  yMax = null;
  pointString = '';
  ref = p.points;
  for (j = 0, len = ref.length; j < len; j++) {
    point = ref[j];
    if (!(Array.isArray(point) && point.length === 2)) {
      throw new Error('outline function requires points array');
    }
    x = point[0];
    y = point[1];
    if (x < xMin || xMin === null) {
      xMin = x;
    }
    if (x > xMax || xMax === null) {
      xMax = x;
    }
    if (y < yMin || yMin === null) {
      yMin = y;
    }
    if (y > yMax || yMax === null) {
      yMax = y;
    }
    pointString += " " + x + "," + y;
  }
  xLast = p.points[p.points.length - 1][0];
  yLast = p.points[p.points.length - 1][1];
  if (!(xLast === p.points[0][0] && yLast === p.points[0][1])) {
    throw new RangeError('last point must match first point of outline');
  }
  return {
    shape: {
      polygon: {
        points: pointString.slice(1)
      }
    },
    bbox: [xMin, yMin, xMax, yMax]
  };
};

moire = function(p) {
  var r, rings, shape;
  if (p.cx == null) {
    throw new Error('moiré requires x center');
  }
  if (p.cy == null) {
    throw new Error('moiré requires y center');
  }
  if (p.outerDia == null) {
    throw new Error('moiré requires outer diameter');
  }
  if (p.ringThx == null) {
    throw new Error('moiré requires ring thickness');
  }
  if (p.ringGap == null) {
    throw new Error('moiré requires ring gap');
  }
  if (p.maxRings == null) {
    throw new Error('moiré requires max rings');
  }
  if (p.crossLength == null) {
    throw new Error('moiré requires crosshair length');
  }
  if (p.crossThx == null) {
    throw new Error('moiré requires crosshair thickness');
  }
  shape = [
    {
      line: {
        x1: p.cx - p.crossLength / 2,
        y1: 0,
        x2: p.cx + p.crossLength / 2,
        y2: 0,
        'stroke-width': p.crossThx,
        'stroke-linecap': 'butt'
      }
    }, {
      line: {
        x1: 0,
        y1: p.cy - p.crossLength / 2,
        x2: 0,
        y2: p.cy + p.crossLength / 2,
        'stroke-width': p.crossThx,
        'stroke-linecap': 'butt'
      }
    }
  ];
  r = (p.outerDia - p.ringThx) / 2;
  rings = 0;
  while (r >= p.ringThx && rings < p.maxRings) {
    shape.push({
      circle: {
        cx: p.cx,
        cy: p.cy,
        r: r,
        fill: 'none',
        'stroke-width': p.ringThx
      }
    });
    rings++;
    r -= p.ringThx + p.ringGap;
  }
  r += 0.5 * p.ringThx;
  if (r > 0 && rings < p.maxRings) {
    shape.push({
      circle: {
        cx: p.cx,
        cy: p.cy,
        r: r
      }
    });
  }
  return {
    shape: shape,
    bbox: [Math.min(p.cx - p.crossLength / 2, p.cx - p.outerDia / 2), Math.min(p.cy - p.crossLength / 2, p.cy - p.outerDia / 2), Math.max(p.cx + p.crossLength / 2, p.cx + p.outerDia / 2), Math.max(p.cy + p.crossLength / 2, p.cy + p.outerDia / 2)]
  };
};

thermal = function(p) {
  var halfGap, maskId, outerR, r, thx, xMax, xMin, yMax, yMin;
  if (p.cx == null) {
    throw new Error('thermal requires x center');
  }
  if (p.cy == null) {
    throw new Error('thermal requires y center');
  }
  if (p.outerDia == null) {
    throw new Error('thermal requires outer diameter');
  }
  if (p.innerDia == null) {
    throw new Error('thermal requires inner diameter');
  }
  if (p.gap == null) {
    throw new Error('thermal requires gap');
  }
  maskId = "thermal-mask-" + (unique());
  thx = (p.outerDia - p.innerDia) / 2;
  outerR = p.outerDia / 2;
  r = outerR - thx / 2;
  xMin = p.cx - outerR;
  xMax = p.cx + outerR;
  yMin = p.cy - outerR;
  yMax = p.cy + outerR;
  halfGap = p.gap / 2;
  return {
    shape: [
      {
        mask: {
          id: maskId,
          _: [
            {
              circle: {
                cx: p.cx,
                cy: p.cy,
                r: outerR,
                fill: '#fff'
              }
            }, {
              rect: {
                x: xMin,
                y: -halfGap,
                width: p.outerDia,
                height: p.gap,
                fill: '#000'
              }
            }, {
              rect: {
                x: -halfGap,
                y: yMin,
                width: p.gap,
                height: p.outerDia,
                fill: '#000'
              }
            }
          ]
        }
      }, {
        circle: {
          cx: p.cx,
          cy: p.cy,
          r: r,
          fill: 'none',
          'stroke-width': thx,
          mask: "url(#" + maskId + ")"
        }
      }
    ],
    bbox: [xMin, yMin, xMax, yMax]
  };
};

module.exports = {
  circle: circle,
  rect: rect,
  polygon: polygon,
  vector: vector,
  lowerLeftRect: lowerLeftRect,
  outline: outline,
  moire: moire,
  thermal: thermal
};


},{"./unique-id":37}],33:[function(require,module,exports){
var Parser, Transform, isError,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Transform = require('stream').Transform;

isError = require('lodash.iserror');

Parser = (function(superClass) {
  extend(Parser, superClass);

  function Parser(formatOpts) {
    var ref, ref1;
    if (formatOpts == null) {
      formatOpts = {};
    }
    this.format = {
      zero: (ref = formatOpts.zero) != null ? ref : null,
      places: (ref1 = formatOpts.places) != null ? ref1 : null
    };
    if (this.format.places != null) {
      if (this.format.places.length !== 2 || typeof this.format.places[0] !== 'number' || typeof this.format.places[1] !== 'number') {
        throw new Error('parser places format must be an array of two numbers');
      }
    }
    if ((this.format.zero != null) && this.format.zero !== 'L' && this.format.zero !== 'T') {
      throw new Error("parser zero format must be either 'L' or 'T'");
    }
    Parser.__super__.constructor.call(this, {
      readableObjectMode: true,
      writableObjectMode: true
    });
  }

  Parser.prototype._transform = function(chunk, encoding, done) {
    var result;
    if (chunk.block != null) {
      result = this.parseBlock(chunk.block, chunk.line);
    } else if (chunk.param != null) {
      result = this.parseParam(chunk.param, chunk.line);
    }
    if (isError(result)) {
      done(result);
      return;
    }
    if (result != null) {
      result.line = chunk.line;
      this.push(result);
    }
    return done();
  };

  return Parser;

})(Transform);

module.exports = Parser;


},{"lodash.iserror":23,"stream":21}],34:[function(require,module,exports){
var ASSUMED_UNITS, HALF_PI, Macro, Plotter, THREEHALF_PI, TWO_PI, TransformStream, Warning, coordFactor, tool, unique,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

TransformStream = require('stream').Transform;

Warning = require('./warning');

unique = require('./unique-id');

Macro = require('./macro-tool');

tool = require('./standard-tool');

coordFactor = require('./svg-coord').factor;

HALF_PI = Math.PI / 2;

THREEHALF_PI = 3 * HALF_PI;

TWO_PI = 2 * Math.PI;

ASSUMED_UNITS = 'in';

Plotter = (function(superClass) {
  extend(Plotter, superClass);

  function Plotter(opts) {
    if (opts == null) {
      opts = {};
    }
    this.units = opts.units;
    this.notation = opts.notation;
    this.tools = {};
    Plotter.__super__.constructor.call(this, {
      objectMode: true
    });
  }

  Plotter.prototype._transform = function(chunk, encoding, done) {
    var ref, state, val;
    ref = chunk.set;
    for (state in ref) {
      val = ref[state];
      if (state === 'currentTool') {
        if (this.tools[val] == null) {
          this.emit('warning', new Warning("tool " + val + " is undefined", chunk.line));
        }
        if (this.region) {
          done(new Error("line " + chunk.line + " - cannot change tool while region mode is on"));
          return;
        }
      }
      if (state === 'units' || state === 'backupUnits' || state === 'notation') {
        if (this[state] == null) {
          this[state] = val;
        }
      } else {
        this[state] = val;
      }
    }
    return done();
  };

  return Plotter;

})(TransformStream);

module.exports = Plotter;


},{"./macro-tool":30,"./standard-tool":35,"./svg-coord":36,"./unique-id":37,"./warning":38,"stream":21}],35:[function(require,module,exports){
var shapes, standardTool, unique;

unique = require('./unique-id');

shapes = require('./pad-shapes');

standardTool = function(tool, p) {
  var hole, id, mask, maskId, pad, result, shape;
  result = {
    pad: [],
    trace: false
  };
  p.cx = 0;
  p.cy = 0;
  id = "tool-" + tool + "-pad-" + (unique());
  shape = '';
  if ((p.dia != null) && (p.vertices == null)) {
    if ((p.obround != null) || (p.width != null) || (p.height != null) || (p.degrees != null)) {
      throw new Error("incompatible parameters for tool " + tool);
    }
    if (p.dia < 0) {
      throw new RangeError(tool + " circle diameter out of range (" + p.dia + "<0)");
    }
    shape = 'circle';
    if (p.hole == null) {
      result.trace = {
        'stroke-width': p.dia,
        fill: 'none'
      };
    }
  } else if ((p.width != null) && (p.height != null)) {
    if ((p.dia != null) || (p.vertices != null) || (p.degrees != null)) {
      throw new Error("incompatible parameters for tool " + tool);
    }
    if (p.width < 0) {
      throw new RangeError(tool + " rect width out of range (" + p.width + "<0)");
    }
    if (p.height < 0) {
      throw new RangeError(tool + " rect height out of range (" + p.height + "<0)");
    }
    shape = 'rect';
    if ((p.width === 0 || p.height === 0) && !p.obround) {
      console.warn("zero-size rectangle tools are not allowed; converting " + tool + " to a zero-size circle");
      shape = 'circle';
      p.dia = 0;
    }
    if (!((p.hole != null) || p.obround)) {
      result.trace = {};
    }
  } else if ((p.dia != null) && (p.vertices != null)) {
    if ((p.obround != null) || (p.width != null) || (p.height != null)) {
      throw new Error("incompatible parameters for tool " + tool);
    }
    if (p.vertices < 3 || p.vertices > 12) {
      throw new RangeError(tool + " polygon points out of range (" + p.vertices + "<3 or >12)]");
    }
    shape = 'polygon';
  } else {
    throw new Error('unidentified standard tool shape');
  }
  pad = shapes[shape](p);
  if (p.hole != null) {
    hole = null;
    if ((p.hole.dia != null) && (p.hole.width == null) && (p.hole.height == null)) {
      if (!(p.hole.dia >= 0)) {
        throw new RangeError(tool + " hole diameter out of range (" + p.hole.dia + "<0)");
      }
      hole = shapes.circle({
        cx: p.cx,
        cy: p.cy,
        dia: p.hole.dia
      });
      hole = hole.shape;
      hole.circle.fill = '#000';
    } else if ((p.hole.width != null) && (p.hole.height != null)) {
      if (!(p.hole.width >= 0)) {
        throw new RangeError(tool + " hole width out of range (" + p.hole.width + "<0)");
      }
      if (!(p.hole.height >= 0)) {
        throw new RangeError(tool + " hole height out of range (" + p.hole.height + "<0)");
      }
      hole = shapes.rect({
        cx: p.cx,
        cy: p.cy,
        width: p.hole.width,
        height: p.hole.height
      });
      hole = hole.shape;
      hole.rect.fill = '#000';
    } else {
      throw new Error(tool + " has invalid hole parameters");
    }
    maskId = id + '-mask';
    mask = {
      mask: {
        id: id + '-mask',
        _: [
          {
            rect: {
              x: pad.bbox[0],
              y: pad.bbox[1],
              width: pad.bbox[2] - pad.bbox[0],
              height: pad.bbox[3] - pad.bbox[1],
              fill: '#fff'
            }
          }, hole
        ]
      }
    };
    pad.shape[shape].mask = "url(#" + maskId + ")";
    result.pad.push(mask);
  }
  if (id) {
    pad.shape[shape].id = id;
  }
  result.pad.push(pad.shape);
  result.bbox = pad.bbox;
  result.padId = id;
  return result;
};

module.exports = standardTool;


},{"./pad-shapes":32,"./unique-id":37}],36:[function(require,module,exports){
var SVG_COORD_E, getSvgCoord,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

SVG_COORD_E = 3;

getSvgCoord = function(numberString, format) {
  var after, before, c, i, j, k, len, len1, ref, ref1, ref2, ref3, sign, subNumbers;
  if (numberString != null) {
    numberString = "" + numberString;
  } else {
    return NaN;
  }
  before = '';
  after = '';
  sign = '+';
  if (numberString[0] === '-' || numberString[0] === '+') {
    sign = numberString[0];
    numberString = numberString.slice(1);
  }
  if ((indexOf.call(numberString, '.') >= 0) || (format.zero == null)) {
    subNumbers = numberString.split('.');
    if (subNumbers.length > 2) {
      return NaN;
    }
    ref1 = [subNumbers[0], (ref = subNumbers[1]) != null ? ref : ''], before = ref1[0], after = ref1[1];
  } else {
    if (typeof (format != null ? (ref2 = format.places) != null ? ref2[0] : void 0 : void 0) !== 'number' || typeof (format != null ? (ref3 = format.places) != null ? ref3[1] : void 0 : void 0) !== 'number') {
      return NaN;
    }
    if (format.zero === 'T') {
      for (i = j = 0, len = numberString.length; j < len; i = ++j) {
        c = numberString[i];
        if (i < format.places[0]) {
          before += c;
        } else {
          after += c;
        }
      }
      while (before.length < format.places[0]) {
        before += '0';
      }
    } else if (format.zero === 'L') {
      for (i = k = 0, len1 = numberString.length; k < len1; i = ++k) {
        c = numberString[i];
        if (numberString.length - i <= format.places[1]) {
          after += c;
        } else {
          before += c;
        }
      }
      while (after.length < format.places[1]) {
        after = '0' + after;
      }
    }
  }
  while (after.length < SVG_COORD_E) {
    after += '0';
  }
  before = before + after.slice(0, SVG_COORD_E);
  after = after.length > SVG_COORD_E ? "." + after.slice(SVG_COORD_E) : '';
  return Number(sign + before + after);
};

module.exports = {
  get: getSvgCoord,
  factor: Math.pow(10, SVG_COORD_E)
};


},{}],37:[function(require,module,exports){
var generateUniqueId, id;

id = 1000;

generateUniqueId = function() {
  return id++;
};

module.exports = generateUniqueId;


},{}],38:[function(require,module,exports){
var Warning;

Warning = (function() {
  function Warning(message, line) {
    this.message = message;
    this.line = line;
  }

  return Warning;

})();

module.exports = Warning;


},{}],39:[function(require,module,exports){
(function (global){
var DEFAULT_OPTS, DrillParser, DrillReader, GerberParser, GerberReader, Plotter, builder, coordFactor;

builder = require('./obj-to-xml');

Plotter = require('./plotter');

DrillReader = require('./drill-reader');

DrillParser = require('./drill-parser');

GerberReader = require('./gerber-reader');

GerberParser = require('./gerber-parser');

coordFactor = require('./svg-coord').factor;

DEFAULT_OPTS = {
  drill: false,
  pretty: false,
  object: false,
  warnArr: null,
  places: null,
  zero: null,
  notation: null,
  units: null
};

module.exports = function(file, options) {
  var a, error, height, key, oldWarn, opts, p, parser, parserOpts, plotterOpts, reader, ref, root, val, width, xml, xmlObject;
  if (options == null) {
    options = {};
  }
  opts = {};
  for (key in DEFAULT_OPTS) {
    val = DEFAULT_OPTS[key];
    opts[key] = val;
  }
  for (key in options) {
    val = options[key];
    opts[key] = val;
  }
  if (typeof file === 'object') {
    if (file.svg != null) {
      return builder(file, {
        pretty: opts.pretty
      });
    } else {
      throw new Error('non SVG object cannot be converted to an SVG string');
    }
  }
  parserOpts = null;
  if ((opts.places != null) || (opts.zero != null)) {
    parserOpts = {
      places: opts.places,
      zero: opts.zero
    };
  }
  if (opts.drill) {
    reader = new DrillReader(file);
    parser = new DrillParser(parserOpts);
  } else {
    reader = new GerberReader(file);
    parser = new GerberParser(parserOpts);
  }
  plotterOpts = null;
  if ((opts.notation != null) || (opts.units != null)) {
    plotterOpts = {
      notation: opts.notation,
      units: opts.units
    };
  }
  p = new Plotter(reader, parser, plotterOpts);
  oldWarn = null;
  root = null;
  if (Array.isArray(opts.warnArr)) {
    root = typeof window !== "undefined" && window !== null ? window : global;
    if (root.console == null) {
      root.console = {};
    }
    oldWarn = root.console.warn;
    root.console.warn = function(chunk) {
      return opts.warnArr.push(chunk.toString());
    };
  }
  try {
    xmlObject = p.plot();
  } catch (_error) {
    error = _error;
    throw new Error("Error at line " + p.reader.line + " - " + error.message);
  } finally {
    if ((oldWarn != null) && (root != null)) {
      root.console.warn = oldWarn;
    }
  }
  if (!(p.bbox.xMin >= p.bbox.xMax)) {
    width = p.bbox.xMax - p.bbox.xMin;
  } else {
    p.bbox.xMin = 0;
    p.bbox.xMax = 0;
    width = 0;
  }
  if (!(p.bbox.yMin >= p.bbox.yMax)) {
    height = p.bbox.yMax - p.bbox.yMin;
  } else {
    p.bbox.yMin = 0;
    p.bbox.yMax = 0;
    height = 0;
  }
  xml = {
    svg: {
      xmlns: 'http://www.w3.org/2000/svg',
      version: '1.1',
      'xmlns:xlink': 'http://www.w3.org/1999/xlink',
      width: "" + (width / coordFactor) + p.units,
      height: "" + (height / coordFactor) + p.units,
      viewBox: [p.bbox.xMin, p.bbox.yMin, width, height],
      _: []
    }
  };
  ref = p.attr;
  for (a in ref) {
    val = ref[a];
    xml.svg[a] = val;
  }
  if (p.defs.length) {
    xml.svg._.push({
      defs: {
        _: p.defs
      }
    });
  }
  if (p.group.g._.length) {
    xml.svg._.push(p.group);
  }
  if (!opts.object) {
    return builder(xml, {
      pretty: opts.pretty
    });
  } else {
    return xml;
  }
};


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./drill-parser":25,"./drill-reader":26,"./gerber-parser":27,"./gerber-reader":28,"./obj-to-xml":31,"./plotter":34,"./svg-coord":36}]},{},[39])(39)
});