# 03 — UI/UX Design: WhatsappClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |
| Related | [Requirements](01-requirements.md) |

## 1. Design principles

1. **Familiar, not copied.** Use the proven two-pane messenger layout that users already know. Use our own
   brand colours, iconography and name, so we do not copy WhatsApp's trade dress (no WhatsApp green
   `#25D366`, no phone-handset logo).
2. **Local-first speed.** Every action gives feedback instantly from the local DB. Network state appears
   as subtle status, never as a blocking spinner.
3. **Keyboard-first desktop.** Every primary action has a shortcut. Focus order is predictable.
4. **Honest security UI.** Show encryption state accurately. Before M3 the UI must not claim E2EE.
5. **Accessible by default.** WCAG 2.2 AA is the bar for merging, not a later clean-up.

## 2. Brand & visual language

> Placeholder brand until a name is chosen. All values are **design tokens** (CSS variables, exposed through
> Tailwind v4 `@theme`), so a rebrand only changes the tokens file.

### 2.1 Colour tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-brand` | `#3B5BDB` | `#748FFC` | Primary buttons, links, active states, read ticks |
| `--color-brand-contrast` | `#FFFFFF` | `#0B1020` | Text on brand |
| `--color-bg-app` | `#F4F5F7` | `#0F1115` | Window background |
| `--color-bg-panel` | `#FFFFFF` | `#171A21` | Sidebar, headers |
| `--color-bg-chat` | `#EEF1F6` | `#12151B` | Conversation background (optional subtle pattern) |
| `--color-bubble-out` | `#DBE4FF` | `#27336B` | Outgoing bubble |
| `--color-bubble-in` | `#FFFFFF` | `#1F232C` | Incoming bubble |
| `--color-text` | `#1B1E24` | `#E6E8EE` | Primary text |
| `--color-text-muted` | `#5F6675` | `#9AA1B0` | Timestamps, secondary |
| `--color-danger` | `#C92A2A` | `#FF6B6B` | Destructive actions, errors |
| `--color-success` | `#2B8A3E` | `#69DB7C` | Online dot, call accept |
| `--color-focus` | `#1C7ED6` | `#74C0FC` | Focus ring (2 px, offset 2 px) |

All text/background pairs must reach a contrast ratio ≥ 4.5:1. A CI check (`pnpm test:a11y`, axe-core)
enforces this on the main screens.

### 2.2 Typography

- System font stack: `-apple-system, "Segoe UI Variable", "Segoe UI", Roboto, "Noto Sans", Ubuntu, sans-serif`.
  Emoji: `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`.
- Scale (medium setting): 12 / 13 / 14.5 (message body) / 16 / 19 / 24 px. The small/large settings scale this ±12 %.
- Line height 1.4 for messages. Use tabular numbers for timestamps.

### 2.3 Spacing, radius, elevation, motion

- 4-px spacing grid. Bubble radius 8 px with a 2-px "tail" corner on the first message of a group.
- Elevation: menus and popovers use a 1-level shadow. Modals use a 2-level shadow plus a 40 % scrim.
- Motion: 120–180 ms, `cubic-bezier(.2,.0,0,1)`. Honour `prefers-reduced-motion` (turn off non-essential animation).

### 2.4 Iconography

[Lucide](https://lucide.dev/) icons (ISC license), 20 px in UI and 16 px inline. Custom status ticks are SVG.

## 3. Information architecture

```
App
├── Onboarding
│   ├── Welcome → Phone number → OTP code → (2FA PIN) → Profile setup → Permissions (notifications)
├── Main (two-pane)
│   ├── Left rail (48 px): Chats · Calls · Settings · Profile avatar
│   ├── Sidebar (min 320 px, resizable to 480 px)
│   │   ├── Chats list  [Search] [New chat] [Filter: All · Unread · Groups]
│   │   ├── Archived
│   │   ├── Calls history
│   │   ├── New chat / New group flow
│   │   └── Settings (Account · Privacy · Chats · Notifications · Storage · Devices · Help · About)
│   └── Content pane
│       ├── Empty state (no chat selected)
│       ├── Conversation (header · message list · composer)
│       └── Right drawer (contact/group info · media gallery · search in chat · message info)
└── Call window (separate BrowserWindow, always-on-top option)
```

## 4. Key screens

### 4.1 Main window (≥ 1024 px)

```
┌──┬──────────────────────────┬───────────────────────────────────────────────┐
│💬│ Chats              ✎  ⋮  │ (A) Amina Otieno            🔍  📞  🎥  ⋮      │
│📞│ ┌──────────────────────┐ │ online                                         │
│⚙ │ │ 🔍 Search or start…  │ │───────────────────────────────────────────────│
│  │ └──────────────────────┘ │                ── Today ──                     │
│  │ [All] [Unread] [Groups]  │  ┌──────────────────────┐                      │
│  │ 📌 Team Alpha      10:42 │  │ Hi! Are we still on   │                      │
│  │    Brian: pushed the… (3)│  │ for 3pm?        10:40 │                      │
│  │ (A) Amina Otieno   10:41 │  └──────────────────────┘                      │
│  │    ✓✓ See you then       │                     ┌─────────────────────────┐│
│  │ (C) Carol W.   Yesterday │                     │ Yes, see you then 👍     ││
│  │    📷 Photo              │                     │               10:41 ✓✓  ││
│  │                          │                     └─────────────────────────┘│
│  │                          │───────────────────────────────────────────────│
│(me)                          │ 😊 📎 │ Type a message                  │ 🎤 │
└──┴──────────────────────────┴───────────────────────────────────────────────┘
```

- **Responsive:** 760–1023 px collapses the left rail into the sidebar header. Below 760 px it is
  single-pane (list ↔ chat with a back button).
- **Connection banner** at the top of the sidebar: "Connecting…" (amber) or "Offline — messages will send when
  you're back online" (grey). It never covers content.

### 4.2 Conversation

- **Message list:** virtualized (TanStack Virtual), reversed, anchored to the bottom. Loads 50 messages at a
  time on scroll-up. A "↓ N new messages" chip appears when scrolled up. An unread divider marks
  "N unread messages".
- **Grouping:** consecutive messages from the same sender within 5 min are grouped (tail on the first one).
  Day separators are sticky.
- **Bubble anatomy:** [reply quote] [forwarded label] [media] [text] [meta: edited · time · ticks]. Sender
  name (with a colour from 12 accessible hues, hashed from the userId) in groups.
- **Hover actions** (and the context menu, and `Shift+F10`/menu key): React · Reply · Forward · Copy · Star ·
  Edit (own, ≤ 15 min) · Delete · Info (own) · Report.
- **Status ticks:** ⏱ pending, ✓ sent, ✓✓ grey delivered, ✓✓ brand read, ⚠ failed (click to retry). Each
  has an aria-label, for example "Read".
- **Composer:** auto-growing (max 8 lines), Enter to send, Shift+Enter for a newline (configurable). Emoji
  picker (`emoji-mart`), attachment menu (Photos & videos · Document · Camera), drag-and-drop overlay
  "Drop files to send". The mic button becomes the send button when text is present.
- **Drafts** persist per chat (local DB).
- **Voice note recorder:** press-and-hold or click-to-lock. Shows timer, live waveform, cancel (Esc) and send.

### 4.3 Onboarding

1. **Welcome:** product name, one-line value proposition, "Get started".
2. **Phone number:** country picker (flag, dial code, search), with live formatting via `libphonenumber-js`.
   A "We'll send an SMS code" note. Errors: "This country isn't supported yet".
3. **Code:** 6 separate inputs (paste fills all), 60-s resend countdown, "Wrong number?" link.
   States: verifying spinner, wrong code (shake + message + attempts left), expired.
4. **Profile:** avatar picker with a circular crop, name (required), about (optional).
5. **Notifications permission** primer (macOS), then the OS prompt.

### 4.4 Group flows

- New group: select members (searchable, chips) → name + icon → create.
- Group info drawer: icon, name, description, member list with role badges, "Add members", "Invite via link",
  settings (admins only), "Exit group" (danger).

### 4.5 Calls

- **Incoming call:** OS notification plus an in-app full-width banner with Accept (green) and Decline (red).
  Ringtone loops for 45 s, then the call is marked missed.
- **Call window:** remote video full-bleed, self-view PiP (draggable), and bottom controls: mute · camera ·
  screen share · end. Shows a network-quality indicator and an "Encrypted" label (M3+ only).
- The window can stay on top and keeps working when the main window is minimized.

### 4.6 Encryption UI (M3)

- A system message at the start of each chat: "🔒 Messages and calls are end-to-end encrypted. Tap to learn more."
- Contact info → "Encryption" shows the safety number (12 groups of 5 digits) and a QR code, with
  "Mark as verified".
- Key change: a system message "Carol's security code changed. Tap to verify." Blocking warnings are not
  used by default (configurable).

### 4.7 Settings → Linked devices

A list of devices with platform icon, name, "This device", last active and location (city from IP,
optional). Each row has a "Log out" action. "Log out all other devices" (danger) needs confirmation.

## 5. States checklist (every screen must design these)

| State | Example treatment |
| --- | --- |
| Empty | Illustration + one sentence + primary action ("Start a new chat") |
| Loading | Skeleton rows (not spinners) for lists. Blur-up thumbnails for media. |
| Partial/offline | Cached data plus the connection banner |
| Error | Inline, specific, actionable ("Couldn't upload photo. Retry") |
| Permission denied | Explain and link to OS settings (mic/camera/notifications) |
| Long content | Truncate names with ellipsis. "Read more" for messages > 1,000 chars. |
| RTL text | `dir="auto"` on message text. Mirrored layout when the locale is RTL. |

## 6. Accessibility

- All interactive elements are reachable by Tab, in a logical order. Roving tabindex in the chat list and
  message list (↑/↓ to move, Enter to open).
- Screen readers: message list `role="log"` with `aria-live="polite"` for new incoming messages in the open
  chat. Each message has an accessible name such as "Amina, 10:40, Hi! Are we still on for 3pm?, read".
- The focus ring is always visible on keyboard focus (`:focus-visible`).
- Hit targets ≥ 32×32 px (desktop). Icon-only buttons have `aria-label` and a tooltip.
- Captions and a transcript slot are reserved in the voice-note UI (future on-device transcription).
- High-contrast mode: honour `forced-colors` on Windows.

## 7. Keyboard shortcuts

| Action | Windows/Linux | macOS |
| --- | --- | --- |
| Search chats | Ctrl+K | ⌘K |
| New chat | Ctrl+N | ⌘N |
| New group | Ctrl+Shift+N | ⌘⇧N |
| Search in chat | Ctrl+F | ⌘F |
| Next / previous chat | Ctrl+Tab / Ctrl+Shift+Tab | ⌃Tab / ⌃⇧Tab |
| Jump to chat 1–9 | Ctrl+1…9 | ⌘1…9 |
| Mark as read/unread | Ctrl+Shift+U | ⌘⇧U |
| Archive chat | Ctrl+Shift+E | ⌘⇧E |
| Mute chat | Ctrl+Shift+M | ⌘⇧M |
| Reply to focused message | R (in message list) | R |
| Edit last own message | ↑ in empty composer | ↑ |
| Settings | Ctrl+, | ⌘, |
| Zoom in/out/reset | Ctrl + = / - / 0 | ⌘ = / - / 0 |

## 8. Notifications

- Title: sender (or "Sender @ Group"). Body: message preview, or "New message" if previews are off.
  Includes the avatar and an inline reply (macOS/Windows).
- Grouped per chat (replace, don't stack, within 5 s). Muted chats send no notification except @mentions.
- Sounds: distinct message and call tones, with a per-chat custom tone (M5).
- Do Not Disturb follows the OS focus modes where Electron exposes them.

## 9. Design deliverables & process

| Deliverable | Tool | When |
| --- | --- | --- |
| Low-fi wireframes (this doc) | Markdown/ASCII | M0 ✅ |
| Hi-fi mockups + component library | Figma (tokens exported via Tokens Studio → `tokens.json`) | M0–M1 |
| Clickable prototype of onboarding + chat | Figma prototype | M1 |
| Storybook for the renderer design system | Storybook 9 + a11y addon | M1 onward |
| App icon set (1024 master → .icns/.ico/png) | Figma → `electron-icon-builder` | Before first release |
