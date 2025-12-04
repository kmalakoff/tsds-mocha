import assert from 'assert';
import Module from 'module';

import { mochaBin, selectMochaBin } from '../../src/command.ts';

describe('selectMochaBin', () => {
  describe('Node version selection', () => {
    it('returns mocha-compat for Node < 12', () => {
      assert.equal(selectMochaBin(10, false, false), 'mocha-compat');
      assert.equal(selectMochaBin(11, false, false), 'mocha-compat');
      assert.equal(selectMochaBin(0, false, false), 'mocha-compat');
    });

    it('returns mocha-no-node-protocol for Node 12-13', () => {
      assert.equal(selectMochaBin(12, false, false), 'mocha-no-node-protocol');
      assert.equal(selectMochaBin(13, false, false), 'mocha-no-node-protocol');
    });

    it('returns mocha for Node 14+ without require_module', () => {
      assert.equal(selectMochaBin(14, false, false), 'mocha');
      assert.equal(selectMochaBin(18, false, false), 'mocha');
      assert.equal(selectMochaBin(20, false, false), 'mocha');
    });
  });

  describe('require_module and registerHooks interaction', () => {
    it('returns mocha-no-register-hooks when require_module but no registerHooks', () => {
      // Node 20.17+ has require(esm) but no registerHooks
      assert.equal(selectMochaBin(20, true, false), 'mocha-no-register-hooks');
      // Node 22.0-22.14 has require(esm) but no registerHooks
      assert.equal(selectMochaBin(22, true, false), 'mocha-no-register-hooks');
    });

    it('returns mocha when both require_module and registerHooks available', () => {
      // Node 22.15+ has both
      assert.equal(selectMochaBin(22, true, true), 'mocha');
      assert.equal(selectMochaBin(24, true, true), 'mocha');
    });

    it('returns mocha when registerHooks available but no require_module (edge case)', () => {
      // This shouldn't happen in practice, but test the logic
      assert.equal(selectMochaBin(22, false, true), 'mocha');
    });
  });
});

describe('mochaBin (runtime export)', () => {
  it('exports a string', () => {
    assert.equal(typeof mochaBin, 'string');
  });

  it('is one of the valid mocha binaries', () => {
    const validBinaries = ['mocha-compat', 'mocha-no-node-protocol', 'mocha-no-register-hooks', 'mocha'];
    assert.ok(validBinaries.indexOf(mochaBin) >= 0, `mochaBin "${mochaBin}" should be one of ${validBinaries.join(', ')}`);
  });

  it('matches selectMochaBin with current runtime values', () => {
    const major = +process.versions.node.split('.')[0];
    const hasRequireModule = !!process.features?.require_module;
    const hasRegisterHooks = typeof (Module as { registerHooks?: unknown }).registerHooks === 'function';

    const expected = selectMochaBin(major, hasRequireModule, hasRegisterHooks);
    assert.equal(mochaBin, expected, `Runtime mochaBin should match selectMochaBin(${major}, ${hasRequireModule}, ${hasRegisterHooks})`);
  });
});
