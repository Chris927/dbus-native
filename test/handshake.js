const assert = require('assert');
const net = require('net');
const os = require('os');
const path = require('path');
const Duplex = require('stream').Duplex;
const dbus = require('../index');
const handshake = require('../lib/handshake');

let socketCounter = 0;
let openHandles = [];

// Runs a fake bus on a unix socket. onLine gets each line the client sends
// (after the leading NUL byte) and a reply function. Resolves with a client
// socket connected to it.
function fakeServer(onLine, cb) {
  const socketPath = path.join(
    os.tmpdir(),
    `dbus-native-hs-${process.pid}-${socketCounter++}.sock`
  );
  const server = net.createServer(function(socket) {
    openHandles.push(socket);
    socket.on('error', function() {});
    let buffered = '';
    socket.on('data', function(data) {
      buffered += data.toString('ascii').replace(/^\0/, '');
      let end;
      while ((end = buffered.indexOf('\r\n')) !== -1) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        onLine(line, function(reply) {
          socket.write(reply + '\r\n');
        });
      }
    });
  });
  openHandles.push(server);
  server.listen(socketPath, function() {
    const client = net.createConnection(socketPath);
    openHandles.push(client);
    client.on('error', function() {});
    cb(client);
  });
}

// Runs the handshake against a fake server and calls done with the result
// once the server has seen BEGIN (or the handshake failed).
function runHandshake(onLine, opts, done) {
  const received = [];
  let result = null;
  function maybeDone() {
    if (!result) return;
    if (!result.err && received[received.length - 1] !== 'BEGIN') return;
    // outside the handshake's readLine callback, so a failing assertion fails the test
    setImmediate(function() {
      done(result.err, result.guid, received);
    });
  }
  fakeServer(
    function(line, reply) {
      received.push(line);
      onLine(line, reply);
      maybeDone();
    },
    function(client) {
      handshake(client, opts, function(err, guid) {
        result = { err: err, guid: guid };
        maybeDone();
      });
    }
  );
}

const withoutUid = function(methods) {
  return { authMethods: methods, externalAuthWithoutUid: true };
};

describe('handshake', function() {
  afterEach(function() {
    openHandles.forEach(function(handle) {
      if (handle.destroy) handle.destroy();
      else handle.close();
    });
    openHandles = [];
  });

  it('sends the process uid with EXTERNAL by default', function(done) {
    const uid = process.hasOwnProperty('getuid') ? process.getuid() : 0;
    const uidHex = Buffer.from(String(uid), 'ascii').toString('hex');
    runHandshake(
      function(line, reply) {
        if (line.indexOf('AUTH EXTERNAL') === 0) reply('OK 0123abcd');
      },
      { authMethods: ['EXTERNAL'] },
      function(err, guid, received) {
        assert.ifError(err);
        assert.deepStrictEqual(received, [`AUTH EXTERNAL ${uidHex}`, 'BEGIN']);
        assert.strictEqual(guid, '0123abcd');
        done();
      }
    );
  });

  describe('with externalAuthWithoutUid', function() {
    it('lets the server use the socket credentials', function(done) {
      runHandshake(
        function(line, reply) {
          if (line === 'AUTH EXTERNAL') reply('DATA');
          else if (line === 'DATA') reply('OK 0123abcd');
        },
        withoutUid(['EXTERNAL']),
        function(err, guid, received) {
          assert.ifError(err);
          assert.deepStrictEqual(received, ['AUTH EXTERNAL', 'DATA', 'BEGIN']);
          assert.strictEqual(guid, '0123abcd');
          done();
        }
      );
    });

    it('moves on to the next method when rejected after the empty DATA', function(done) {
      runHandshake(
        function(line, reply) {
          if (line === 'AUTH EXTERNAL') reply('DATA');
          else if (line === 'DATA') reply('REJECTED EXTERNAL ANONYMOUS');
          else if (line.indexOf('AUTH ANONYMOUS') === 0) reply('OK 0123abcd');
        },
        withoutUid(['EXTERNAL', 'ANONYMOUS']),
        function(err, guid, received) {
          assert.ifError(err);
          assert.deepStrictEqual(
            received.map(function(l) {
              return l.trim();
            }),
            ['AUTH EXTERNAL', 'DATA', 'AUTH ANONYMOUS', 'BEGIN']
          );
          assert.strictEqual(guid, '0123abcd');
          done();
        }
      );
    });

    it('moves on to the next method when rejected straight away', function(done) {
      runHandshake(
        function(line, reply) {
          if (line === 'AUTH EXTERNAL') reply('REJECTED ANONYMOUS');
          else if (line.indexOf('AUTH ANONYMOUS') === 0) reply('OK 0123abcd');
        },
        withoutUid(['EXTERNAL', 'ANONYMOUS']),
        function(err, guid, received) {
          assert.ifError(err);
          assert.strictEqual(received[0], 'AUTH EXTERNAL');
          assert.strictEqual(received[1].trim(), 'AUTH ANONYMOUS');
          assert.strictEqual(guid, '0123abcd');
          done();
        }
      );
    });

    // A strict server refuses a new AUTH until the exchange in progress is cancelled
    function strictServer(firstReply, afterData) {
      let cancelled = false;
      return function(line, reply) {
        if (line === 'AUTH EXTERNAL') reply(firstReply);
        else if (line === 'DATA') reply(afterData);
        else if (line === 'CANCEL') {
          cancelled = true;
          reply('REJECTED ANONYMOUS');
        } else if (line.indexOf('AUTH ANONYMOUS') === 0) {
          reply(cancelled ? 'OK 0123abcd' : 'ERROR "AUTH while in progress"');
        }
      };
    }

    it('cancels before the next method when the server answers ERROR', function(done) {
      runHandshake(
        strictServer('ERROR', null),
        withoutUid(['EXTERNAL', 'ANONYMOUS']),
        function(err, guid, received) {
          assert.ifError(err);
          assert.deepStrictEqual(
            received.map(function(l) {
              return l.trim();
            }),
            ['AUTH EXTERNAL', 'CANCEL', 'AUTH ANONYMOUS', 'BEGIN']
          );
          done();
        }
      );
    });

    it('cancels before the next method when the server sends another DATA', function(done) {
      runHandshake(
        strictServer('DATA', 'DATA 61'),
        withoutUid(['EXTERNAL', 'ANONYMOUS']),
        function(err, guid, received) {
          assert.ifError(err);
          assert.deepStrictEqual(
            received.map(function(l) {
              return l.trim();
            }),
            ['AUTH EXTERNAL', 'DATA', 'CANCEL', 'AUTH ANONYMOUS', 'BEGIN']
          );
          done();
        }
      );
    });

    it('cancels before the next method when the server answers ERROR after the empty DATA', function(done) {
      runHandshake(
        strictServer('DATA', 'ERROR'),
        withoutUid(['EXTERNAL', 'ANONYMOUS']),
        function(err, guid, received) {
          assert.ifError(err);
          assert.deepStrictEqual(
            received.map(function(l) {
              return l.trim();
            }),
            ['AUTH EXTERNAL', 'DATA', 'CANCEL', 'AUTH ANONYMOUS', 'BEGIN']
          );
          done();
        }
      );
    });

    it('answers an unknown command with ERROR and keeps waiting', function(done) {
      runHandshake(
        function(line, reply) {
          if (line === 'AUTH EXTERNAL') reply('SOMETHING_NEW');
          else if (line === 'ERROR') reply('DATA');
          else if (line === 'DATA') reply('OK 0123abcd');
        },
        withoutUid(['EXTERNAL']),
        function(err, guid, received) {
          assert.ifError(err);
          assert.deepStrictEqual(received, [
            'AUTH EXTERNAL',
            'ERROR',
            'DATA',
            'BEGIN'
          ]);
          assert.strictEqual(guid, '0123abcd');
          done();
        }
      );
    });

    it('fails when CANCEL is not answered with REJECTED', function(done) {
      runHandshake(
        function(line, reply) {
          if (line === 'AUTH EXTERNAL') reply('ERROR');
          else if (line === 'CANCEL') reply('OK 0123abcd');
        },
        withoutUid(['EXTERNAL', 'ANONYMOUS']),
        function(err) {
          assert.ok(err instanceof Error);
          assert.ok(
            /Unexpected reply to CANCEL: OK 0123abcd/.test(err.message)
          );
          done();
        }
      );
    });

    it("reports the server's rejection when no methods are left", function(done) {
      runHandshake(
        function(line, reply) {
          if (line === 'AUTH EXTERNAL') reply('DATA');
          else if (line === 'DATA') reply('REJECTED ANONYMOUS');
        },
        withoutUid(['EXTERNAL']),
        function(err) {
          assert.ok(err instanceof Error);
          assert.ok(/REJECTED ANONYMOUS/.test(err.message), err.message);
          done();
        }
      );
    });

    it("reports the server's error without a CANCEL when no methods are left", function(done) {
      runHandshake(
        function(line, reply) {
          if (line === 'AUTH EXTERNAL')
            reply('ERROR "peer credentials unavailable"');
        },
        withoutUid(['EXTERNAL']),
        function(err, guid, received) {
          assert.ok(err instanceof Error);
          assert.ok(
            /peer credentials unavailable/.test(err.message),
            err.message
          );
          assert.deepStrictEqual(received, ['AUTH EXTERNAL']);
          done();
        }
      );
    });
  });
});

describe('createConnection with a custom stream', function() {
  it('starts the handshake on a duplex stream that has no setNoDelay', function(done) {
    const written = [];
    const stream = new Duplex({
      read: function() {},
      write: function(chunk, encoding, cb) {
        written.push(chunk.toString('ascii'));
        cb();
      }
    });
    dbus.createConnection({ stream: stream, authMethods: ['ANONYMOUS'] });
    setImmediate(function() {
      assert.strictEqual(written.join(''), '\0AUTH ANONYMOUS \r\n');
      stream.destroy();
      done();
    });
  });
});
