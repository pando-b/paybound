# Contributing to Paybound

Thanks for your interest in contributing! Paybound is in pre-alpha and we welcome feedback, bug reports, and pull requests.

## Getting Started

```bash
# Clone the repo
git clone https://github.com/pando-b/paybound.git
cd paybound

# Install dependencies (requires pnpm)
pnpm install

# Build all packages
pnpm -r run build

# Run tests
pnpm -r run test
```

## Project Structure

```
packages/
  core/     — Policy engine (evaluation, schema, types)
  ledger/   — Transaction recording and querying (SQLite)
  proxy/    — HTTP proxy that intercepts x402 payments
  sdk/      — Client SDK for agents (@paybound/sdk)
```

## How to Contribute

### Bug Reports
Open an issue with:
- What you expected
- What happened
- Steps to reproduce

### Feature Requests
Open an issue describing the use case. We're especially interested in:
- Policy types you'd want (rate limiting, approval workflows, etc.)
- Facilitator integrations beyond Coinbase CDP
- Dashboard/analytics features

### Pull Requests
1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Write tests for your changes
4. Ensure all tests pass (`pnpm -r run test`)
5. Submit a PR with a clear description

## Code Style
- TypeScript strict mode
- Tests with Vitest
- Keep dependencies minimal

## Security
See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License
By contributing, you agree that your contributions will be licensed under the MIT License.
