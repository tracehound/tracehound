# Contributing to Tracehound

Thank you for your interest in contributing to Tracehound. As a security-focused project, we maintain high standards for code quality, correctness, and deterministic behavior.

## Our Philosophy

1. **Security-First**: Every change must be reviewed through the lens of the [Threat Model](./security/threat-model.md).
2. **Deterministic Correctness**: We value O(1) complexity and predictable execution over "smart" heuristics.
3. **Resilience**: All core paths must follow the [Fail-Open Specification](./docs/FAIL-OPEN-SPEC.md).
4. **Transparency**: All logic must be auditable, and forensic integrity is paramount.

## Getting Started

### Reporting Bugs

- For general bugs, please open a [GitHub Issue](https://github.com/tracehound/tracehound/issues).
- **CRITICAL**: For security vulnerabilities, do **NOT** open a public issue. Follow our [Security Policy](./SECURITY.md) and email **me@erdem.work**.

### Feature Requests

Please open an issue to discuss new features before starting implementation. For significant OSS architectural changes, we may request an RFC from the [public OSS RFC set](./docs/rfc/README.md).

### Pull Request Process

1. Fork the repository and create your branch from `main`.
2. Ensure your code follows the existing style and is fully typed.
3. Add tests for all new functionality. We aim for 100% test coverage in core modules.
4. Run `npm run test` and `npm run build` to ensure everything is correct.
5. Update documentation if your change affects public APIs or behavior.
6. Submit your PR with a clear description of the problem and your solution.

## Contribution Standards

- **Zero Unsafe**: Rust core paths (if applicable) must be 100% `unsafe`-free.
- **Bounded execution**: No unbounded loops or recursion in the hot path.
- **Audit Consistency**: Ensure `AuditChain` integrity is maintained.

---

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](./LICENSE).
