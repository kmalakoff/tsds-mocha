declare module 'resolve' {
  interface ResolveNamespace {
    sync(id: string, opts?: Record<string, unknown>): string;
    default?: ResolveNamespace;
    [key: string]: unknown;
  }
  const resolve: ResolveNamespace;
  export = resolve;
}
