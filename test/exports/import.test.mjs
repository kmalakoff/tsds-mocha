import assert from 'assert';
import mocha from 'tsds-mocha';

describe('exports .mjs', () => {
  it('defaults', () => {
    assert.equal(typeof mocha, 'function');
  });
});
