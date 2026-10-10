# Changelog

All notable changes to tsds-mocha are documented here.

## [1.24.0] - 2026-10-09

### Fixed

- Restore the linked package when test setup throws after linking.
- Report restoration failures, preserving both operation and cleanup errors when both fail.

## [1.23.12] - 2026-09-09

### Fixed

- TypeScript tests using syntax that Node can parse as JavaScript now run through the TypeScript
  loader on Node 20 and early Node 22 releases.
