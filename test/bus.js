const bus = require('../lib/bus');
const assert = require('assert');

describe('given a bus', function() {
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
