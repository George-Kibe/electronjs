# Security Policy

## Supported versions

Only the latest released minor version of each project receives security fixes.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through
[GitHub Security Advisories](https://github.com/George-Kibe/electronjs/security/advisories/new).

Include the affected project and version, the OS, reproduction steps and the impact. We aim to:

| Step | Target |
| --- | --- |
| Acknowledge report | 3 business days |
| Triage & severity (CVSS v4) | 7 days |
| Fix for Critical/High | 30 days |
| Public advisory | After a fixed release is available |

## Scope highlights

- **WhatsappClone:** auth/OTP bypass, account takeover, message confidentiality or integrity, E2EE
  implementation flaws, server-side injection, media access control, WebRTC IP leaks beyond what the design documents.
- **WinrarClone:** path traversal or symlink escape during extraction, code execution from crafted archives,
  Mark-of-the-Web bypass, privilege escalation through shell integration.
- **Both:** Electron renderer escapes, IPC abuse, auto-update tampering.

Threat models: [WhatsappClone](whatsapp-clone/docs/06-security.md) · [WinrarClone](winrar-clone/docs/06-security.md)
