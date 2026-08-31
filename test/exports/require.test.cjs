const assert = require('assert');
const mocha = require('tsds-mocha');

describe('exports .cjs', () => {
  it('defaults', () => {
    assert.equal(typeof mocha, 'function');
  });
});
