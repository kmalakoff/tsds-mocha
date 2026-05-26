declare module 'os-shim' {
  const osShim: {
    tmpdir(): string;
    [key: string]: unknown;
  };
  export = osShim;
}
