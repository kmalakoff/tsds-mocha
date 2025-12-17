import spawn from 'cross-spawn-cb';
import getopts from 'getopts-compat';
import { link, unlink } from 'link-unlink';
import Module from 'module';
import Queue from 'queue-cb';
import resolveBin from 'resolve-bin-sync';
import type { CommandCallback, CommandOptions } from 'tsds-lib';
import { installPath } from 'tsds-lib';

/**
 * Select the appropriate mocha binary based on Node version and available features.
 * Exported for testing - allows unit tests to verify the selection logic.
 */
export function selectMochaBin(major: number, hasRequireModule: boolean, hasRegisterHooks: boolean): string {
  if (major < 12) return 'mocha-compat';
  if (major < 14) return 'mocha-no-node-protocol';
  // Node 20.17+ has require(esm) but no registerHooks - needs patched mocha
  // Node 22.15+ has registerHooks which properly supports require() with hooks
  if (hasRequireModule && !hasRegisterHooks) return 'mocha-no-register-hooks';
  return 'mocha';
}

const major = +process.versions.node.split('.')[0];
const hasRequireModule = !!process.features?.require_module;
const hasRegisterHooks = typeof (Module as { registerHooks?: unknown }).registerHooks === 'function';

/** The mocha binary selected for the current Node version */
export const mochaBin = selectMochaBin(major, hasRequireModule, hasRegisterHooks);

export default function command(args: string[], options: CommandOptions, callback: CommandCallback) {
  const cwd: string = (options.cwd as string) || process.cwd();
  const opts = getopts(args, { stopEarly: true, alias: { 'dry-run': 'd' }, boolean: ['dry-run'] });
  const filteredArgs = args.filter((arg) => arg !== '--dry-run' && arg !== '-d');

  if (opts['dry-run']) {
    console.log('Dry-run: would run tests with mocha');
    return callback();
  }

  link(cwd, installPath(options), (err, restore) => {
    if (err) return callback(err);

    try {
      const loader = resolveBin('ts-swc-loaders', 'ts-swc');
      const mocha = resolveBin(mochaBin, mochaBin === 'mocha-compat' ? 'mocha-compat' : 'mocha');

      const spawnArgs = major === 12 ? ['node'] : []; // TODO: troubleshoot node 12 and mocha
      Array.prototype.push.apply(spawnArgs, [mocha, '--watch-extensions', 'ts,tsx']);
      Array.prototype.push.apply(spawnArgs, filteredArgs);
      if (opts._.length === 0) Array.prototype.push.apply(spawnArgs, ['test/**/*.test.*']);

      const queue = new Queue(1);
      queue.defer(spawn.bind(null, loader, spawnArgs, options));
      queue.await((err) => unlink(restore, callback.bind(null, err)));
    } catch (err) {
      console.log(err);
      callback(err);
    }
  });
}
