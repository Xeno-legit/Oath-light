# Oath Light Installation Policy and End User Terms

Version 1.0.0 — Open Source Protection Software

Please read this Installation Policy and Disclosure Document carefully before completing setup installation. By proceeding with the installation of Oath Light or downloading `OathLight_Setup.exe` from the official [GitHub Releases Page](https://github.com/Xeno-legit/Oath-light/releases), you acknowledge and agree to the system modifications, security protections, and operational terms described below.

---

## 1. Open Source License and Guarantees

Oath Light is distributed as free, open-source software under the GNU General Public License v3.0 (GPLv3).

* **100% Free Forever**: Oath Light contains zero paid features, premium tiers, or subscription charges. Every artificial intelligence model, network filter, and security control is completely free.
* **Zero Telemetry and Complete Privacy**: Oath Light operates entirely locally on your computer. The software collects no personal information, transmits no usage metrics, logs no browsed web addresses, and uploads no visual screenshots to remote systems.
* **Open Source Auditability**: All source code is publicly accessible on GitHub for audit, compilation, and security verification.

---

## 2. Early Release Status and Call for Red Team Testing

This installation package represents an early Version 1.0.0 release of Oath Light. While the software has undergone extensive local verification and functional testing by its creator, it has not yet been subjected to a formal, independent Red Team security audit.

Single-developer testing, regardless of rigor, is insufficient to guarantee complete defense against all potential real-world edge cases. We actively seek security researchers, red teams, and quality assurance engineers to stress-test the application, push its anti-bypass controls to their absolute limits, and contribute to its ongoing hardening.

---

## 3. Disclosed System Modifications Matrix

To provide reliable protection against explicit content and tamper attempts, the setup installer and runtime application execute specific system-level configurations. The table below details these modifications and their corresponding teardown actions.

| Disclosed System Modification | Target OS Subsystem | Purpose & Operational Behavior | Teardown & Recovery Action |
| :--- | :--- | :--- | :--- |
| **Local DNS Loopback Proxy** | Windows Network Adapters | Binds `127.0.0.1:53` proxy to filter explicit domains and block DoH bypasses. | Original DNS adapter settings are backed up in `dns.json` and restored on teardown. |
| **Browser Policy Integration** | Enterprise Management Keys | Forces extension policy subkeys across Chrome, Edge, Brave, Firefox, and Opera. | Policy keys are cleaned up upon authorized uninstallation. |
| **Dual Watchdog Background Execution** | Windows Mutex & Process Subsystem | Spawns windowless `oathlightguard.exe` to cross-monitor main process mutexes. | Processes terminate gracefully when uninstallation cool-off completes. |
| **Task Scheduler Autostart** | Task Scheduler COM Interface | Registers `Register-ScheduledTask` autostart entries for background protection. | Scheduled tasks are removed via uninstallation hooks (`hooks.nsh`). |
| **Uninstallation Gate Protocol** | Windows Apps & Features (`uninstall.exe`) | Invokes CLI check (`--uninstall-check`) to require cool-off delay or master password. | Uninstallation proceeds once cool-off or master password verification is met. |

---

## 4. Detailed Operational Clauses

### Section A: Network Adapter and DNS Management
Oath Light installs a local DNS forwarding proxy (`oathlight-dns`) listening on loopback address `127.0.0.1:53`. Active network adapters are configured to route DNS queries through this proxy. An isolated RFC 6761 health probe (`health-probe.oathlight.invalid`) continually verifies listener health. Network adapter parameters are preserved in `%APPDATA%\OathLight\dns.json` to ensure clean restoration when the application is removed through the authorized uninstallation flow.

### Section B: Browser Integration and Enterprise Policies
Oath Light manages extension policies across supported web browsers (Google Chrome, Microsoft Edge, Brave, Mozilla Firefox, and Opera). The installer writes policy registry keys under enterprise management paths to ensure browser extension integrity across user profiles.

### Section C: Background Watchdog Services
Oath Light deploys a dual-process protection system consisting of the main desktop application (`OathLight.exe`) and a windowless background guardian process (`oathlightguard.exe`). The setup installer configures autostart entries using the Windows Task Scheduler COM interface to guarantee persistent background execution across system reboots.

### Section D: Uninstallation Gate
Uninstallation requests initiated via Windows Apps & Features or setup uninstallers (`uninstall.exe`) invoke the application CLI verification gate (`--uninstall-check`). Uninstallation proceeds only after completing the mandatory cool-off period or authenticating with the master password or recovery phrase.

---

## 5. End User Privacy Rights Matrix

| User Privacy Sphere | Operational Policy | Standard Affirmation |
| :--- | :--- | :--- |
| **Screen Inference Data** | 100% Local RAM / GPU Memory | Frame inspection runs locally via SigLIP2 and NudeNet ONNX; zero image uploads. |
| **Evaluation Logs** | Hash-Only Storage (`evallog.rs`) | Logs store only SHA-256 hashes; zero thumbnails, URLs, or window titles are recorded. |
| **Notification Emails** | Direct Local SMTP Transmission | Optional trusted contact emails use local user SMTP credentials via TLS (`lettre`). |
| **Telemetry & Metrics** | Completely Disabled | Zero analytics endpoints, tracking IDs, or telemetry servers exist in the codebase. |

---

## 6. Acceptance of Terms

By clicking Agree or proceeding with setup installation, you authorize Oath Light to perform the system modifications disclosed above and agree to the terms of the GNU General Public License v3.0.
