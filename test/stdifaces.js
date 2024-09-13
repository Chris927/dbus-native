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
});
