# Node.js/Electron Migration Plan for Pure Path

The goal is to transition the desktop companion from Python to a robust Node.js/Electron application with TypeScript.

## 🛠️ Phase 1: Environment Setup
- [ ] **Fix Node.js Environment**: Add Node.js to the system PATH so `node` and `npm` are globally accessible.
- [ ] **Project Initialization**: Initialize a new Node.js project in the `desktop-app` directory.
- [ ] **Dependency Setup**: Install Electron, TypeScript, and necessary development tools.

## 🏗️ Phase 2: Project Structure
- [ ] **Convert Native Host**: Port `native_host.py` logic to a Node.js-based host for browser extension communication.
- [ ] **Setup Electron Main Process**: Implement the core application logic (persistence, watchdog, tray integration).
- [ ] **Initialize UI**: Create a simple Electron-based dashboard for stats and progress.
- [ ] **Watchdog Implementation**: Develop the dual-process watchdog system to prevent unauthorized termination.

## 🔒 Phase 3: Friction & Security
- [ ] **Friction Logic**: Implement the 48-hour uninstallation delay/friction as described in the roadmap.
- [ ] **Secure Communication**: Ensure all Native Messaging is secure and authenticated.

## 🚀 Phase 4: Build & Deployment
- [ ] **Configure Build System**: Use `electron-builder` to create installers for Windows/macOS.
- [ ] **Update Extension**: Modify `manifest.json` and `background.js` to communicate with the new Node-based host.
