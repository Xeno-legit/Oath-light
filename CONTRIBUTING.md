# Contributing to Oath Light

Thank you for contributing to Oath Light. Oath Light is an open-source, privacy-first content protection system built to empower individuals. We welcome contributions from software developers, security researchers, graphic designers, and technical writers.

---

## Core Principles for Contributions

Every contribution accepted into the Oath Light codebase must strictly comply with three unalterable design principles:

* **100% Free and Open-Source**: All features, improvements, and fixes must remain freely available under the GNU General Public License v3.0 (GPLv3). Contributions introducing paywalls, feature gating, user tiers, or monetization mechanics will be rejected immediately.
* **Zero Telemetry and Local Processing**: All code must execute locally on host machine hardware. Contributions that introduce remote analytics, tracking scripts, server-side image processing, user reporting APIs, or telemetry will not be merged.
* **Uncompromising Code Quality**: Contributions must adhere to strict standards of memory safety, performance optimization, and comprehensive automated test coverage.

---

## Downloads and Release Releases

Users and contributors seeking to test published versions can obtain official compiled releases directly:

* **Official Setup Downloads**: [Oath Light GitHub Releases](https://github.com/Xeno-legit/Oath-light/releases)
* **Release Artifact**: `OathLight_Setup.exe` (Windows 64-bit installer)

---

## Subsystem Architecture Mapping

The table below outlines the codebase layout to help contributors navigate the project structure quickly.

| Repository Subdirectory | Subsystem Role | Core Technologies | Responsibility and Key Files |
| :--- | :--- | :--- | :--- |
| `core` | Shared Core Library | Rust (`oathlight-core`) | Houses blocklist tables, 41-language keyword parser, and SHA-256 event log. |
| `dns` | Local DNS Proxy | Rust (`oathlight-dns`) | Implements UDP forwarding proxy on `127.0.0.1:53` and health probe logic. |
| `desktop-app/src-tauri` | Desktop App Backend | Tauri v2, Rust | Manages IPC commands, ONNX machine learning models, Argon2id, and sidecars. |
| `desktop-app/src` | User Interface | React, Vite, CSS | Modern reactive UI frontend rendered within Tauri desktop webview. |
| `desktop-app/guardian` | Watchdog Process | Pure Rust (`oathlightguard`) | Dependency-free windowless executable holding `OathLight.Watchdog.Guardian.v1`. |
| `extension` | Browser Extension | Manifest V3 / WebExtension | Houses network interceptors (`graylist-sites.js`, `graylist-inject.js`), DOM scrubbers. |

---

## Contribution Workflow Stages

Contributors should follow the four-stage workflow detailed in the table below:

| Workflow Stage | Action Required | Details and Guidelines |
| :--- | :--- | :--- |
| **1. Issue & Proposal** | Open GitHub Issue | Discuss proposed changes, feature additions, or bug fixes with maintainers before coding. |
| **2. Local Development** | Create Feature Branch | Branch off `main` using standard naming conventions (e.g., `feat/dns-optimization`). |
| **3. Automated Verification** | Run Test Suites | Pass all Rust workspace tests, Clippy lint checks, and JavaScript extension suites locally. |
| **4. Code Review & Merge** | Submit Pull Request | Provide a clear technical summary in your PR description. Maintainers will review promptly. |

---

## Development Environment Setup

### Tools and Prerequisites
* [Rust Compiler](https://www.rust-lang.org/) (version 1.77.2 or later)
* [Node.js](https://nodejs.org/) (LTS version) and `npm`
* Microsoft Visual Studio C++ Build Tools (Windows development workload)

### Step-by-Step Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Xeno-legit/Oath-light.git
   cd Oath-light/"Oath Light Blocker"
   ```

2. Install desktop application dependencies:
   ```bash
   cd desktop-app
   npm install
   ```

---

## Testing and Verification Reference

All contributions must pass local validation before submission. The table below lists all verification commands used across the project.

| Verification Suite | Target Subsystem | Execution Command | Acceptance Standard |
| :--- | :--- | :--- | :--- |
| **Rust Unit Tests** | All Rust Crates | `cargo test --workspace` | 100% test pass rate across all 160+ unit tests. |
| **Clippy Static Linting** | All Rust Crates | `cargo clippy --workspace --all-targets -- -D warnings` | Zero compiler or linting warnings. |
| **Extension Network Interceptors** | Browser Extension | `node extension/tests/test-graylist-inject.cjs` | Validates API payload interceptor parsing against captures. |
| **Extension Platform Rules** | Browser Extension | `node extension/tests/test-graylist-platforms.cjs` | Validates rule matching across 44 supported platforms. |
| **Extension Content Script** | Browser Extension | `node extension/tests/test-content-script.cjs` | Validates DOM element scrubbing logic. |

---

## Code Style and Pull Request Guidelines

1. **Commit Message Format**: Write direct, descriptive commit titles (e.g., `feat(dns): optimize lookup trie performance`).
2. **Memory Safety**: Avoid `unsafe` Rust blocks unless strictly required for Win32 OS interop, and document all safety invariants clearly.
3. **Documentation**: Update inline doc comments and relevant Markdown files when adding or modifying public functions.

---

## Licensing Terms

By submitting contributions to Oath Light, you agree that your code will be licensed under the GNU General Public License v3.0 (GPLv3).
