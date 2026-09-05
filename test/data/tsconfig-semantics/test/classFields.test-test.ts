import assert from 'assert';

class Base {
  _v = 0;
  set value(v: number) {
    this._v = v * 10;
  }
  get value(): number {
    return this._v;
  }
}
class Derived extends Base {
  value = 42;
}

// A target below ES2022 leaves useDefineForClassFields false, so this field assigns and runs the
// inherited setter. Node's stripper ignores the target, defines it instead, and silently gives 42.
it('honours the consumer tsconfig target for class field semantics', () => {
  assert.equal(new Derived().value, 420, `class field used define semantics instead of the tsconfig target, got ${new Derived().value}`);
});
