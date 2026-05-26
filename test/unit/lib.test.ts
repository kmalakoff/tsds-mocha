// remove NODE_OPTIONS to not interfere with tests
delete process.env.NODE_OPTIONS;

import spawn from 'cross-spawn-cb';
import fs from 'fs';
import { linkModule, unlinkModule } from 'module-link-unlink';
import os from 'os';
import osShim from 'os-shim';
import path from 'path';
import Queue from 'queue-cb';
import * as resolve from 'resolve';
import shortHash from 'short-hash';
import { installGitRepo } from 'tsds-lib-test';
import url from 'url';

const tmpdir = os.tmpdir || osShim.tmpdir;
const resolveSync = (resolve.default ?? resolve).sync;

import mocha from 'tsds-mocha';

const __dirname = path.dirname(typeof __filename !== 'undefined' ? __filename : url.fileURLToPath(import.meta.url));

const GITS = ['https://github.com/kmalakoff/fetch-http-message.git'];

function addTests(repo: string) {
  const repoName = path.basename(repo, path.extname(repo));
  describe(repoName, () => {
    const dest = path.join(tmpdir(), 'tsds-mocha', shortHash(process.cwd()), repoName);
    const modulePath = fs.realpathSync(path.join(__dirname, '..', '..'));
    const modulePackage = JSON.parse(fs.readFileSync(path.join(modulePath, 'package.json'), 'utf8'));
    const nodeModules = path.join(dest, 'node_modules');
    const deps = { ...(modulePackage.dependencies || {}), ...(modulePackage.peerDependencies || {}) };

    before((cb) => {
      installGitRepo(repo, dest, (err?: Error | null): void => {
        if (err) return cb(err);

        const queue = new Queue(1);
        queue.defer((cb) => linkModule(modulePath, nodeModules, (err) => cb(err)));
        for (const dep in deps) queue.defer((cb) => linkModule(path.dirname(resolveSync(`${dep}/package.json`)), nodeModules, (err) => cb(err)));
        // Build the test repo
        queue.defer(spawn.bind(null, 'npm', ['run', 'build'], { cwd: dest, stdio: 'inherit' }));
        queue.await(cb);
      });
    });
    after((cb) => {
      const queue = new Queue();
      queue.defer((cb) => unlinkModule(modulePath, nodeModules, (err) => cb(err)));
      for (const dep in deps) queue.defer((cb) => unlinkModule(path.dirname(resolveSync(`${dep}/package.json`)), nodeModules, (err) => cb(err)));
      queue.await(cb);
    });

    describe('happy path', () => {
      it('test:node', (done) => {
        mocha([], { cwd: dest }, (err?: Error | null): void => {
          if (err) return done(err);

          done();
        });
      });
    });
  });
}
describe('lib', () => {
  for (let i = 0; i < GITS.length; i++) {
    addTests(GITS[i]);
  }
});
