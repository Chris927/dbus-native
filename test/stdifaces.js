const stdifaces = require('../lib/stdifaces');
const assert = require('assert');

// Introspection test cases
const testCases = [
  {
    desc: 'Basic Example',
    exportedObjects: {
      '/some-path': {
        'my.interface': [
          {
            name: 'MyInterface',
            methods: {
              MyMethod: {
                in: 's',
                out: 's'
              }
            }
          }
        ]
      }
    }
  }
];

describe('given an exported interface', function() {
  for (const testCase of testCases) {
    it('should correctly process ' + testCase.desc, function() {
      const msg = {
        interface: 'org.freedesktop.DBus.Introspectable',
        member: 'Introspect',
        path: '/some-path'
      };
      const exportedObjects = testCase.exportedObjects;
      let reply;
      const connection = {
        message: arg1 => (reply = arg1)
      };
      const result = stdifaces(msg, { connection, exportedObjects });
      assert.strictEqual(result, 1);
      assert.strictEqual(reply.type, 2);
      assert.strictEqual(reply.signature, 's');
      const content = reply.body[0];
      assert.match(content, /<node name="\/some-path">/);
      assert.match(content, /DOCTYPE/);
    });
  }

  describe('given a call to org.freedesktop.DBus.Properties', function() {
    describe('happy path', function() {
      it('returns "1" and sends a message', function() {
        let messageSent = null;
        const result = stdifaces(
          // msg
          {
            interface: 'org.freedesktop.DBus.Properties',
            member: 'Get',
            path: '/some-path',
            body: ['my.interface', 'MyProperty']
          },
          // bus
          {
            exportedObjects: {
              '/some-path': {
                'my.interface': [
                  {
                    name: 'MyInterface',
                    properties: {
                      MyProperty: {
                        type: 's'
                        // value: 'Hello'
                      }
                    }
                  },
                  {
                    MyProperty: 'hello, property'
                  }
                ]
              }
            },
            connection: {
              message: arg1 => {
                assert.strictEqual(arg1.type, 2);
                assert.strictEqual(arg1.signature, 'v');
                assert.deepStrictEqual(arg1.body, [
                  [{ type: 's' }, 'hello, property']
                ]);
                messageSent = arg1;
              }
            }
          }
        );
        assert.strictEqual(result, 1);
        assert.ok(messageSent, 'Expected a message to be sent');
      });
    });
    describe('when the path does not exist', function() {
      it('returns "1" and sends an error message', function() {
        let messageSent = null;
        let errorNameSent = null;
        let errorMessageSent = null;
        const message = {
          interface: 'org.freedesktop.DBus.Properties',
          member: 'Get',
          path: '/some-invalid-path',
          body: ['my.interface', 'MyProperty']
        };
        const result = stdifaces(
          // msg
          message,
          // bus
          {
            exportedObjects: {
              '/some-path': {
                'my.interface': [
                  {
                    name: 'MyInterface',
                    properties: {
                      MyProperty: {
                        type: 's'
                        // value: 'Hello'
                      }
                    }
                  },
                  {
                    MyProperty: 'hello, property'
                  }
                ]
              }
            },
            connection: null,
            sendError: (msg, errorName, errorMessage) => {
              messageSent = msg;
              errorNameSent = errorName;
              errorMessageSent = errorMessage;
            }
          }
        );
        assert.strictEqual(result, 1);
        assert.ok(messageSent, 'Expected an error message to be sent');
        assert.strictEqual(
          message,
          messageSent,
          'Expected the error message to be sent in response to the original message'
        );
        assert.strictEqual(
          errorNameSent,
          'org.freedesktop.DBus.Error.UnknownObject'
        );
        assert.strictEqual(errorMessageSent, 'No such object, check path.');
      });
    });
    describe('when the interface does not exist', function() {
      it('returns "1" and sends an error message', function() {
        let messageSent = null;
        let errorNameSent = null;
        let errorMessageSent = null;
        const message = {
          interface: 'org.freedesktop.DBus.Properties',
          member: 'Get',
          path: '/some-path',
          body: ['my.invalid-interface', 'MyProperty']
        };
        const result = stdifaces(
          // msg
          message,
          // bus
          {
            exportedObjects: {
              '/some-path': {
                'my.interface': [
                  {
                    name: 'MyInterface',
                    properties: {
                      MyProperty: {
                        type: 's'
                        // value: 'Hello'
                      }
                    }
                  },
                  {
                    MyProperty: 'hello, property'
                  }
                ]
              }
            },
            connection: null,
            sendError: (msg, errorName, errorMessage) => {
              messageSent = msg;
              errorNameSent = errorName;
              errorMessageSent = errorMessage;
            }
          }
        );
        assert.strictEqual(result, 1);
        assert.ok(messageSent, 'Expected an error message to be sent');
        assert.strictEqual(
          message,
          messageSent,
          'Expected the error message to be sent in response to the original message'
        );
        assert.strictEqual(
          errorNameSent,
          'org.freedesktop.DBus.Error.UnknownInterface'
        );
        assert.strictEqual(
          errorMessageSent,
          'No such interface, check body[0].'
        );
      });
    });
  });
});
