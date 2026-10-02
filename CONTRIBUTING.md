# Contributing to Menditect Agent Workspace Template

Thank you for your interest in the Menditect Agent Workspace Template.

## Maintenance and Governance

This repository is maintained and published by Menditect B.V. as an official public template for Menditect Test Automation (MTA) customers.

To ensure consistency, security, and stability for all customers:
- Direct write access to repository branches is restricted to authorized Menditect B.V. employees and maintainers.
- All code, scripts, and documentation changes are subject to review by Menditect maintainers.

## Branching Model & Release Workflow

- **`development`**: The default active development branch. All feature development, enhancements, and bug fixes occur here.
- **`main`**: The official release branch. Commits are merged to `main` only when publishing a release.
- **Release Publications**: Merging to `main` and creating a release tag automatically triggers official GitHub Releases so subscribers receive notifications. Always return to `development` after release.

## Reporting Issues & Feedback

If you encounter an issue, bug, false positive, or have a feature suggestion for linters or skills:
- **Email Support:** Send detailed feedback, reproducible scenarios, and suggested fixes directly to **`support@menditect.com`**.
- **GitHub Pull Requests:** Open a pull request against the appropriate repository:
  - Tools, linters, workspace scripts: [agentic-test-workspace](https://github.com/Menditect/agentic-test-workspace)
  - MTA Agent Skills: [agentic-test-skills](https://github.com/Menditect/agentic-test-skills)
- **Support Portal:** Menditect customers may also submit tickets via the official Menditect Support Portal or at: https://menditect.com/contact

### Linter & Skill Customization Policy (PAT-113, ANTI-62)
Official skills and linters are managed upstream and will be overwritten during updates (`npm run update`). If you need local hotfixes or customized rules in your workspace:
- Copy `tools/mta-lint.mjs` to `tools/mta-lint.custom.mjs` and apply changes to the copy. The workspace runner (`tools/run-linter.mjs`) automatically prioritizes your custom linter without risking overwrite.
- Submit your changes upstream via PR or email to `support@menditect.com` so they can be reviewed and incorporated into the next official release.

## License

By interacting with this repository, you agree that your feedback or contributions may be incorporated under the Apache 2.0 license.
