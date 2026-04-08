const EventEmitter = require('events');
const bus = require('../lib/bus');
const assert = require('assert');

describe('given a bus', function() {
  describe('when sending a message', function() {
    it('should send the message to the stream', async function() {
      /* TODO: This is not a useful test yet. It does trigger
       * an UnknownService error, though, which we ultimately
       * want to fix.
       */

      let messageSent = null;
      let busInstance = null;

      // fake stream implementation, it captures the message sent to it
      const stream = {
        write: (msg, cb) => {
          if (msg.member === 'Hello') {
            return; // we ignore the 'Hello' message
          }
          messageSent = msg;
          process.nextTick(() => {
            if (cb) {
              cb(null); // simulate successful write
            } else {
              console.warn(
                'No callback provided to stream.write, msg= ' +
                  JSON.stringify(msg)
              );
            }
          });
        }
      };

      // instantiate a bus with the fake stream
      const connection = new EventEmitter();
      connection.stream = stream;
      connection.message = (msg, cb) => stream.write(msg, cb);

      busInstance = bus(connection);

      // invoke the bus to send a message
      await new Promise(resolve => {
        busInstance.invoke(
          {
            bla: 42
          },
          function(err) {
            assert.ifError(err);
          }
        );
        resolve();
      });

      // assert that the message was sent to the stream
      assert(messageSent);
      assert.strictEqual(messageSent.bla, 42);

      // simulate an incoming response
      busInstance.connection.emit('message', { response: 'ok' });

      // assert that the bus emits the response message
      busInstance.connection.on('message', function(msg) {
        assert.deepStrictEqual(msg, { response: 'ok' });
      });

      // assert.strictEqual(busInstance.state, 'connected');
    });
  });

  it('sending a message fails if writing to the stream fails', async function() {
    // fake stream implementation, it fails on write
    const stream = {
      write: (msg, cb) => {
        if (msg.member === 'Hello') {
          return; // we ignore the 'Hello' message
        }
        process.nextTick(() => {
          // Simulate an error in the stream write
          cb(new Error('Stream write error, msg= ' + JSON.stringify(msg)));
        });
      }
    };

    // instantiate a bus with the fake stream
    const busInstance = bus({
      stream,
      message: (msg, cb) => stream.write(msg, cb),
      on: () => {}
    });

    // invoke the bus, expect an error
    await new Promise(resolve => {
      busInstance.invoke(
        {
          bla: 42
        },
        function(err) {
          assert(err);
          assert.match(err.message, /Stream write error/);
          resolve();
        }
      );
    });
  });
});
