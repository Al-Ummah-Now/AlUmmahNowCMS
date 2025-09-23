# Contributing to AlUmmahNowCMS

Thank you for your interest in contributing to AlUmmahNowCMS! This document provides guidelines and information for contributors.

## Code of Conduct

By participating in this project, you agree to abide by our code of conduct:
- Be respectful and inclusive
- Use welcoming and inclusive language
- Be collaborative and constructive
- Focus on what is best for the community
- Show empathy towards other community members

## Getting Started

### Development Environment Setup

1. **Prerequisites**
   - Node.js 18+ installed
   - Git installed
   - Cloudflare account (for testing with actual services)
   - Code editor with TypeScript support (VS Code recommended)

2. **Fork and Clone**
   ```bash
   # Fork the repository on GitHub
   # Clone your fork
   git clone https://github.com/YOUR_USERNAME/AlUmmahNowCMS.git
   cd AlUmmahNowCMS
   
   # Add upstream remote
   git remote add upstream https://github.com/meywd/AlUmmahNowCMS.git
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Setup Development Environment**
   ```bash
   # Copy configuration template
   cp wrangler.json.example wrangler.json
   
   # Start development server
   npm run dev
   ```

### Project Structure

Understanding the project structure will help you contribute effectively:

```
AlUmmahNowCMS/
├── src/                  # Source code
│   ├── index.ts         # Main entry point
│   ├── api/             # API route handlers
│   ├── middleware/      # Express-style middleware
│   ├── models/          # Data models and schemas
│   ├── services/        # Business logic services
│   └── utils/           # Utility functions
├── docs/                # Documentation
├── tests/               # Test files
├── .github/             # GitHub templates and workflows
└── migrations/          # Database migration files
```

## How to Contribute

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates.

When filing a bug report, include:
- Clear, descriptive title
- Steps to reproduce the issue
- Expected vs. actual behavior
- Environment details (OS, Node.js version, etc.)
- Screenshots or error logs if applicable

Use our [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).

### Suggesting Features

We welcome feature suggestions! Please:
- Check existing feature requests first
- Provide clear use cases and benefits
- Consider implementation complexity
- Discuss larger features in issues before implementing

Use our [feature request template](.github/ISSUE_TEMPLATE/feature_request.md).

### Improving Documentation

Documentation improvements are always welcome:
- Fix typos or grammatical errors
- Improve clarity and examples
- Add missing documentation
- Update outdated information

Use our [documentation template](.github/ISSUE_TEMPLATE/documentation.md).

## Development Workflow

### Branch Naming

Use descriptive branch names following this pattern:
- `feature/description-of-feature`
- `fix/description-of-fix`
- `docs/description-of-change`
- `refactor/description-of-refactor`

### Commit Messages

Follow conventional commit format:
```
type(scope): brief description

Optional longer description

Fixes #123
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or modifying tests
- `chore`: Maintenance tasks

### Pull Request Process

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   - Write clean, well-documented code
   - Follow existing code style and conventions
   - Add tests for new functionality
   - Update documentation as needed

3. **Test Your Changes**
   ```bash
   # Run all tests
   npm test
   
   # Run linting
   npm run lint
   
   # Test locally
   npm run dev
   ```

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

5. **Push and Create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then create a pull request on GitHub.

### Pull Request Guidelines

- Fill out the PR template completely
- Link related issues using keywords (Fixes #123)
- Ensure all tests pass
- Keep changes focused and atomic
- Write clear commit messages
- Update documentation if needed

## Code Style and Standards

### TypeScript Guidelines

- Use TypeScript strict mode
- Provide explicit type annotations where helpful
- Prefer interfaces over type aliases for object shapes
- Use meaningful variable and function names
- Follow existing naming conventions

### Code Formatting

We use Prettier for code formatting:
```bash
# Format code
npm run format

# Check formatting
npm run format:check
```

### Linting

We use ESLint for code quality:
```bash
# Run linter
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```

### Testing

- Write tests for new features and bug fixes
- Maintain good test coverage
- Use descriptive test names
- Test both success and error cases

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Working with Cloudflare Services

### Local Development

For local development, we use Wrangler's local mode:
- D1 database runs in local SQLite
- R2 storage uses local filesystem
- Workers runtime simulated locally

### Testing with Real Services

For integration testing:
1. Create test Cloudflare resources
2. Update `wrangler.json` with test resource IDs
3. Use separate environment for testing

### Database Migrations

When adding database changes:
1. Create migration file in `migrations/`
2. Test migration locally
3. Include migration in PR
4. Document any breaking changes

```bash
# Create new migration
npx wrangler d1 migrations create add-new-table

# Apply migrations locally
npx wrangler d1 migrations apply al-ummah-now-cms --local
```

## Release Process

### Versioning

We follow Semantic Versioning (SemVer):
- MAJOR: Breaking changes
- MINOR: New features (backwards compatible)
- PATCH: Bug fixes (backwards compatible)

### Release Checklist

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create release PR
4. Tag release after merge
5. Deploy to production
6. Update documentation

## Getting Help

### Documentation

- [Architecture Documentation](./ARCHITECTURE.md)
- [Project Roadmap](./ROADMAP.md)
- [API Documentation](./API.md)

### Communication

- **GitHub Issues**: For bugs, features, and questions
- **GitHub Discussions**: For general discussions
- **Pull Requests**: For code reviews and collaboration

### Maintainer Response Times

We aim to respond to:
- Critical bugs: Within 24 hours
- Feature requests: Within 1 week
- Pull requests: Within 1 week
- Documentation issues: Within 3 days

## Recognition

Contributors are recognized in:
- README.md contributors section
- Release notes
- Special mentions for significant contributions

Thank you for contributing to AlUmmahNowCMS! 🎉

---

*For questions about contributing, please create an issue with the "question" label.*