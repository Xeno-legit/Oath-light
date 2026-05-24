# Pure Path

Pure Path is a comprehensive content filtering system designed to block NSFW content and promote personal productivity. It consists of a browser extension for real-time traffic monitoring and a desktop application for persistent protection and system-level enforcement.

![Pure Path Demonstration](Demogif.gif)


## Core Philosophy

Pure Path is built on the principle of accessible protection. This application is free and open-source. It will never feature paid subscriptions, premium tiers, or locked features. The goal is to provide a robust tool for anyone seeking to improve their digital environment without financial barriers.

## Features

### Multi-Layer Protection
- **Domain Filtering**: Blocks a curated list of over 1,100 known NSFW domains.
- **Keyword Detection**: Scans URLs, page titles, and meta-tags for explicit keywords using word-boundary-aware regex.
- **Search Engine Enforcement**: Automatically forces SafeSearch on major engines (Google, Bing, DuckDuckgo, Yahoo) and blocks explicit search queries.
- **Leet Speak Normalization**: Detects and normalizes character substitutions (e.g., "p0rn" to "porn") to prevent simple bypasses.
- **Content Analysis**: Real-time scanning of page headings and descriptions to identify NSFW content even on unknown domains.

### Desktop Integration
- **Tauri-Based Desktop App**: A lightweight companion application built with Rust and Tauri for system-level persistence.
- **Dual-Process Watchdog**: Prevents unauthorized termination of the protection service.
- **Native Messaging**: Secure communication bridge between the browser extension and the desktop app.
- **Uninstall Friction**: Implements a configurable waiting period for uninstallation to prevent impulsive disabling.

### User Experience
- **Electric Ether Theme**: A modern, fluid UI design system for the desktop dashboard.
- **Progress Tracking**: Monitors statistics such as total blocked attempts and days of protection.
- **Mentor Dashboard**: (Phase 2) A dedicated interface for goal setting and productivity prompts.
- **Themes & Customization**: Extensible theme system and configurable blocklists.

### Feature Comparison

The following table compares the protection layers of Pure Path against typical industry standards:

| Capability | Standard Filters | Pure Path |
| :--- | :---: | :---: |
| Domain & Keyword Blocking | Yes | Yes |
| Browser Password Protection | Partial | Yes |
| 100% Free / No Subscriptions | No | Yes |
| Search Engine SafeSearch Enforcement | No | Yes |
| Leet Speak Normalization | No | Yes |
| Desktop-Level Process Watchdog | No | Yes |
| High-Friction Uninstall Protection | No | Yes |
| Native Messaging Bridge | No | Yes |


## Development Status

### Phase 1: Browser Extension (Completed)
- Implementation of core smart blocking logic.
- Password protection for extension settings.
- Manifest V3 compliance.
- Basic statistics tracking.

### Phase 2: Desktop Integration (In Progress)
- Tauri migration for cross-platform performance.
- Native Messaging implementation.
- Dual-process watchdog for process persistence.
- High-friction uninstall system with waiting periods.
- Redesigned UI with fluid transitions and modern aesthetics.

## How the Application Blocks

The following table explains the different layers of the blocking mechanism:

| Method | Description | Target |
| :--- | :--- | :--- |
| Blacklist | Exact and wildcard domain matching against 1,100+ entries. | NSFW Domains |
| Graylist | Monitoring of specific paths on mixed-content platforms (e.g., Reddit, Twitter). | Specific NSFW sub-paths |
| Regex Matching | Word-boundary-aware keyword detection in URLs and metadata. | Explicit Keywords |
| Search Filter | Passive forcing of SafeSearch parameters via URL modification. | Search Engines |
| Content Scan | Evaluation of DOM elements (h1-h6, meta description) for NSFW density. | Unknown Domains |
| Host Blocking | (Planned) System-level blocks via the hosts file managed by the desktop app. | System-wide |

## Installation

| Step | Instruction | Details |
| :--- | :--- | :--- |
| 1 | Clone Repository | git clone https://github.com/Xeno-legit/Pure-Path-NSFW-blocker.git |
| 2 | Install Extension | Load the `extension` folder as an unpacked extension in Developer Mode. |
| 3 | Setup Desktop App | Navigate to the desktop-app directory and follow the README there for building. |
| 4 | Configuration | Follow the initial setup wizard to set a master password and goals. |

(This is if you want to install it early as its currently in beta. And very early stages of development)

## Contribution

| Action | Process |
| :--- | :--- |
| Bug Reports | Open an issue on GitHub with reproduction steps and environment details. |
| Feature Requests | Submit an issue describing the feature and its alignment with core goals. |
| Code Changes | Fork the repository, create a feature branch, and submit a pull request. |
| Blocklist Updates | Edit domains.json or keywords.json and submit as a pull request. |

## Security and Privacy

- **Local Processing**: All blocking logic and content analysis happen locally on your machine.
- **Zero Telemetry**: No browsing data, statistics, or personal information is transmitted to external servers.
- **Open Source**: The entire codebase is available for audit to ensure transparency and security.

## License

This project is licensed under the GNU General Public License v3.0. See the LICENSE file for more information.

---

Pure Path is founded and maintained by [Xeno-legit](https://github.com/Xeno-legit).
