import assert from 'assert';
import fs from 'fs';
import * as resolve from 'resolve';

import { mochaBin, selectMochaBin } from '../../src/command.ts';

const resolveSync = (resolve.default ?? resolve).sync;

describe('selectMochaBin', () => {
  describe('Node version selection', () => {
    it('returns mocha-compat for Node < 12', () => {
      assert.equal(selectMochaBin(10, false), 'mocha-compat');
      assert.equal(selectMochaBin(11, false), 'mocha-compat');
      assert.equal(selectMochaBin(0, false), 'mocha-compat');
    });

    it('returns mocha-cjs for Node 12+ without require_module', () => {
      assert.equal(selectMochaBin(12, false), 'mocha-cjs');
      assert.equal(selectMochaBin(14, false), 'mocha-cjs');
      assert.equal(selectMochaBin(16, false), 'mocha-cjs');
      assert.equal(selectMochaBin(18, false), 'mocha-cjs');
      assert.equal(selectMochaBin(20, false), 'mocha-cjs');
    });

    it('returns mocha for Node with require_module', () => {
      assert.equal(selectMochaBin(20, true), 'mocha');
      assert.equal(selectMochaBin(22, true), 'mocha');
      assert.equal(selectMochaBin(24, true), 'mocha');
    });
  });
});

describe('mochaBin (runtime export)', () => {
  it('exports a string', () => {
    assert.equal(typeof mochaBin, 'string');
  });

  it('is one of the valid mocha binaries', () => {
    const validBinaries = ['mocha-compat', 'mocha-cjs', 'mocha'];
    assert.ok(validBinaries.indexOf(mochaBin) >= 0, `mochaBin "${mochaBin}" should be one of ${validBinaries.join(', ')}`);
  });

  it('matches selectMochaBin with current runtime values', () => {
    const major = +process.versions.node.split('.')[0];
    const hasRequireModule = !!process.features?.require_module;

    const expected = selectMochaBin(major, hasRequireModule);
    assert.equal(mochaBin, expected, `Runtime mochaBin should match selectMochaBin(${major}, ${hasRequireModule})`);
  });
});

describe('selected mocha packages', () => {
  // The alias set is a version-routing table: every slot is pinned except 'mocha', which floats to
  // latest. A pinned slot that ships ESM-only is unparseable on the Nodes routed to it.
  it('routes Node without require_module to a CommonJS mocha', () => {
    const cases = [
      { major: 12, hasRequireModule: false },
      { major: 14, hasRequireModule: false },
      { major: 16, hasRequireModule: false },
      { major: 18, hasRequireModule: false },
      { major: 20, hasRequireModule: false },
    ];

    for (let i = 0; i < cases.length; i++) {
      const { major, hasRequireModule } = cases[i];
      const bin = selectMochaBin(major, hasRequireModule);
      const pkg = JSON.parse(fs.readFileSync(resolveSync(`${bin}/package.json`), 'utf8'));
      assert.notEqual(pkg.type, 'module', `Node ${major} routes to ${bin}@${pkg.version}, which is ESM-only and cannot be parsed there`);
    }
  });

  it('resolves the floating mocha slot to a package with an engines.node string', () => {
    const bin = selectMochaBin(22, true);
    const pkg = JSON.parse(fs.readFileSync(resolveSync(`${bin}/package.json`), 'utf8'));
    assert.equal(typeof pkg.engines.node, 'string');
  });
});
