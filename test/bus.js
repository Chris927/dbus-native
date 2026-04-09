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
        messagesReceived: [],
        messagesReceivedWithoutCallback: [],
        messagesWithoutCallbackHandlers: [],
        write: (msg, cb) => {
          if (msg.member === 'Hello') {
            return; // we ignore the 'Hello' message
          }
          messageSent = msg;
          process.nextTick(() => {
            if (cb) {
              console.warn(
                `Stream write called with msg= ${JSON.stringify(msg)}`
              );
              stream.messagesReceived.push(msg);
              cb(null); // simulate successful write
            } else {
              console.warn(
                'No callback provided to stream.write, msg= ' +
                  JSON.stringify(msg)
              );
              stream.messagesReceivedWithoutCallback.push(msg);
              for (const handler of stream.messagesWithoutCallbackHandlers) {
                handler(msg);
              }
            }
          });
        }
      };

      // instantiate a bus with the fake stream
      const connection = new EventEmitter();
      connection.stream = stream;
      connection.messagesReceived = [];
      connection.message = (msg, cb) => {
        console.warn(`Bus message called with msg= ${JSON.stringify(msg)}`);
        connection.messagesReceived.push(msg);
        stream.write(msg, cb);
      };

      busInstance = bus(connection);

      // connection.stream.on('message', function(msg) {
      //   console.warn(`Stream received message: ${JSON.stringify(msg)}`);
      // });

      function invokeBus(msg) {
        return new Promise((resolve, reject) => {
          busInstance.invoke(msg, function(err) {
            if (err) {
              console.warn(
                `Bus invoke error: ${err.message}, msg=${JSON.stringify(msg)}`
              );
            } else {
              console.warn(`Bus invoke successful, msg=${JSON.stringify(msg)}`);
            }
          });
          // note that we resolve *before* the callback is called. Callback does not seem to be called, unless there is an error.
          resolve();
        });
      }

      // invoke the bus to send a message
      await invokeBus({ bla: 42 });
      // await new Promise(resolve => {
      //   busInstance.invoke(
      //     {
      //       bla: 42
      //     },
      //     function(err) {
      //       assert.ifError(err);
      //     }
      //   );
      //   resolve();
      // });

      // assert that the message was sent to the stream
      assert(messageSent);
      assert.strictEqual(messageSent.bla, 42);

      // TODO: strange that we get the message synchronously.
      assert.strictEqual(stream.messagesReceived.length, 1);
      assert.deepStrictEqual(stream.messagesReceived[0], {
        bla: 42,
        serial: 2,
        type: 1
      });

      // TODO: waiting here makes no observeable difference
      await new Promise(resolve => setTimeout(resolve, 100)); // wait for the message to be processed

      // TODO: I expect the error message to be in 'messagesReceived', but
      // it only arrives once we emit a message on the connection further down. Why??

      assert.strictEqual(connection.messagesReceived.length, 2);
      assert.deepStrictEqual(connection.messagesReceived[1], {
        bla: 42,
        serial: 2,
        type: 1
      });
      // assert.deepStrictEqual(connection.messagesReceived[2], { type: 3, serial: 3, errorName: 'org.freedesktop.DBus.Error.UnknownObject', });

      // simulate an incoming response
      busInstance.connection.emit('message', { response: 'ok' });

      // assert that the bus emits the response message
      // TODO: the callback is not being called.
      busInstance.connection.on('message', function(msg) {
        console.warn(`Received message: ${JSON.stringify(msg)}`);
        assert.deepStrictEqual(msg, { response: 'ok' });
      });

      // TODO: why is it 3 messages now??
      assert.strictEqual(connection.messagesReceived.length, 3);
      assert.deepStrictEqual(connection.messagesReceived[2], {
        type: 3,
        serial: 3,
        errorName: 'org.freedesktop.DBus.Error.UnknownObject',
        destination: undefined,
        replySerial: undefined,
        signature: 's',
        body: [
          'Unable to handle method call for path=undefined, interface=undefined, member=undefined'
        ]
      });

      // assert.strictEqual(busInstance.state, 'connected');
      console.warn(`Done?`);

      busInstance.exportedObjects.object1 = {
        method1: function(arg, cb) {
          console.warn(`method1 called with arg= ${JSON.stringify(arg)}`);
          cb(null, 'result1');
        }
      };
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
