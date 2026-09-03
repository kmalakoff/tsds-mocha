import spawn from 'cross-spawn-cb';
import getopts from 'getopts-compat';
import { link, unlink } from 'link-unlink';
import Queue from 'queue-cb';
import resolveBin from 'resolve-bin-sync';
import type { CommandCallback, CommandOptions } from 'tsds-lib';
import { installPath } from 'tsds-lib';

// The aliases are a version-routing table: every slot is pinned except 'mocha', which floats.
// process.features.require_module goes unflagged at the same Node versions mocha 12's engines start (20.19 / 22.12).
export function selectMochaBin(major: number, hasRequireModule: boolean): string {
  if (major < 12) return 'mocha-compat';
  if (!hasRequireModule) return 'mocha-cjs';
  return 'mocha';
}

const major = +process.versions.node.split('.')[0];
const hasRequireModule = !!process.features?.require_module;

/** The mocha binary selected for the current Node version */
export const mochaBin = selectMochaBin(major, hasRequireModule);

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
    if (!restore) return callback(new Error('link did not return restore path'));

    try {
      const loader = resolveBin('ts-swc-loaders', 'ts-swc');
      const mocha = resolveBin(mochaBin, mochaBin === 'mocha-compat' ? 'mocha-compat' : 'mocha');

      const spawnArgs = [mocha, '--watch-extensions', 'ts,tsx'];
      Array.prototype.push.apply(spawnArgs, filteredArgs);
      if (opts._.length === 0) Array.prototype.push.apply(spawnArgs, ['test/**/*.test.*']);

      const queue = new Queue(1);
      queue.defer(spawn.bind(null, loader, spawnArgs, options));
      queue.await((err) => unlink(restore, callback.bind(null, err)));
    } catch (err) {
      console.log(err);
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
