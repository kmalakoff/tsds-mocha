import assert from 'assert';
import fs from 'fs';
import path from 'path';

describe('owned restoration fixture', () => {
  it('records the acquired link before completing the real test', () => {
    const root = fs.realpathSync(process.cwd());
    const plan = JSON.parse(fs.readFileSync(path.join(root, 'plan.json'), 'utf8'));
    const parent = path.join(root, 'owned-links');
    const retained = path.join(root, 'retained-links');
    const target = path.join(parent, 'fixture-target');
    const parentStat = fs.lstatSync(parent);
    assert.ok(parentStat.isDirectory() && !parentStat.isSymbolicLink(), 'link parent must be an owned directory');
    assert.strictEqual(parentStat.dev, plan.parentDevice);
    assert.strictEqual(parentStat.ino, plan.parentInode);
    const linkStat = fs.lstatSync(target);
    assert.ok(linkStat.isSymbolicLink(), 'public command must acquire its link');
    assert.strictEqual(fs.realpathSync(target), root, 'public command linked the wrong source');
    const backups = fs.readdirSync(parent).filter((name) => name.indexOf('fixture-target.') === 0);
    assert.deepEqual(fs.readdirSync(parent).sort(), ['fixture-target'].concat(backups).sort());
    assert.strictEqual(backups.length, plan.targetKind === 'absent' ? 0 : 1, 'unexpected backup count');
    let originalDevice: number | undefined;
    let originalInode: number | undefined;
    if (backups.length) {
      const backup = path.join(parent, backups[0]);
      const original = fs.lstatSync(backup);
      assert.ok(!original.isSymbolicLink(), 'backup must be the original target');
      assert.strictEqual(original.dev, plan.originalDevice);
      assert.strictEqual(original.ino, plan.originalInode);
      assert.strictEqual(original.isDirectory(), plan.targetKind === 'directory');
      if (plan.targetKind === 'directory') assert.deepEqual(fs.readdirSync(backup), ['survivor.txt']);
      assert.strictEqual(fs.readFileSync(plan.targetKind === 'directory' ? path.join(backup, 'survivor.txt') : backup, 'utf8'), 'owned survivor');
      originalDevice = original.dev;
      originalInode = original.ino;
    }
    if (plan.relocate) {
      assert.strictEqual(path.dirname(parent), root, 'relocation must stay in the owned root');
      assert.strictEqual(path.dirname(retained), root, 'retained parent must stay in the owned root');
      assert.strictEqual(fs.existsSync(retained), false, 'retained destination must be absent');
      fs.renameSync(parent, retained);
      const moved = fs.lstatSync(retained);
      assert.strictEqual(moved.dev, parentStat.dev);
      assert.strictEqual(moved.ino, parentStat.ino);
    }
    fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify({ childBodyCompleted: true, relocated: plan.relocate, backup: backups[0], originalDevice, originalInode, linkDevice: linkStat.dev, linkInode: linkStat.ino, linkDestination: fs.readlinkSync(plan.relocate ? path.join(retained, 'fixture-target') : target) }));
    process.stdout.write('RESTORATION_STDOUT\n');
    process.stderr.write('RESTORATION_STDERR\n');
    if (plan.fail) assert.strictEqual('actual owned failure', 'RESTORATION_FAILURE');
  });
});
