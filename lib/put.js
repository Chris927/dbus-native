'use strict';

// Minimal safe replacement for the 'put' npm package (GHSA-v6gv-fg46-h89j).
// The original package used Buffer.allocUnsafe which can expose uninitialized
// memory. This implementation uses only safe Buffer APIs.

function PutStream() {
  this._chunks = [];
}

PutStream.prototype.word8 = function(val) {
  var buf = Buffer.alloc(1);
  buf.writeUInt8(val & 0xff, 0);
  this._chunks.push(buf);
  return this;
};

PutStream.prototype.word16le = function(val) {
  var buf = Buffer.alloc(2);
  buf.writeUInt16LE(val & 0xffff, 0);
  this._chunks.push(buf);
  return this;
};

PutStream.prototype.word32le = function(val) {
  var buf = Buffer.alloc(4);
  buf.writeUInt32LE(val >>> 0, 0);
  this._chunks.push(buf);
  return this;
};

PutStream.prototype.put = function(buf) {
  this._chunks.push(buf);
  return this;
};

PutStream.prototype.buffer = function() {
  return Buffer.concat(this._chunks);
};

module.exports = function put() {
  return new PutStream();
};
