# SolMail: Incentivized inbox for richer replies

<p align="center">
  <picture>
    <source srcset="Zero/apps/mail/public/solmail-logo-dark.png" media="(prefers-color-scheme: light)">
    <img src="Zero/apps/mail/public/solmail-logo.png" alt="SolMail Logo" width="64" style="background-color: #000; padding: 10px;"/>
  </picture>
</p>

<p align="center">
  <strong>An AI-powered email client built on Zero that sends micropayments upfront and refunds them if replies aren't meaningful, ensuring you pay solely for successful conversations.</strong>
</p>

## Table of Contents

- [Hackathon Submission (EasyA Consensus)](#hackathon-submission-easya-consensus)
- [About SolMail](#about-solmail)
  - [Problem](#problem)
  - [Solution](#solution)
  - [Key Features](#key-features)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Technology Stack](#technology-stack)
- [Contributing](#contributing)
- [License](#license)
- [Links](#links)
- [Support](#support)

## Hackathon Submission (EasyA Consensus)

- **Short summary (<150 chars)**: Gives Seeker users paid email on Solana, releasing escrowed SOL only when the recipient sends a real reply judged by an on-device agent.
- **Download APK**: [solmail-consensus-v1.apk](https://github.com/hrishabhayush/solmail-android/blob/main/solmail-consensus-v1.apk?raw=1)
- **Canva slides**: [view](https://www.canva.com/design/DAHI_FH735E/gESU0uzU_Jh14XliG4qeRQ/view?utm_content=DAHI_FH735E&utm_campaign=designshare&utm_medium=link2&utm_source=uniquelinks&utlId=habff5aefae)
- **Demo video (with audio)**: [YouTube](https://www.youtube.com/watch?v=1gRK_v7hIPk)
- **Screenshots**: see [section below](#screenshots)
- **Technical description (SDKs + sponsor tech)**: see [section below](#technical-description)
- **Blockchain interaction explanation**: see [section below](#blockchain-interaction)

### Screenshots

| Inbox | Thread | Compose | Reply check |
|---|---|---|---|
| <img src="solmail-android/screenshots/Screenshot%202026-05-07%20at%2011.38.23%20AM.png" width="200"> | <img src="solmail-android/screenshots/Screenshot%202026-05-07%20at%2011.38.38%20AM.png" width="200"> | <img src="solmail-android/screenshots/Screenshot%202026-05-07%20at%2011.39.46%20AM.png" width="200"> | <img src="solmail-android/screenshots/Screenshot%202026-05-07%20at%2011.40.13%20AM.png" width="200"> |

### Technical description

SolMail is a native Android Solana dApp built on three pieces of sponsor tech: an Anchor escrow program, Mobile Wallet Adapter with Seed Vault on Seeker, and solana-agent-kit for autonomous refunds. Backend on Cloudflare Workers, on top of the open-source Zero email framework.

**Anchor program.** `create_escrow`, `release`, `withhold` over a PDA seeded on `["escrow", msg_id]`, so every email thread has a deterministic escrow. The mobile client builds raw `TransactionInstruction`s using 8-byte Anchor discriminators baked into [compose.tsx](solmail-android/app/compose.tsx), so the APK ships without the Anchor TypeScript SDK on-device.

**MWA and Seed Vault.** Every send and claim is signed through `@solana-mobile/mobile-wallet-adapter-protocol-web3js`. `transact()` in [mwa.ts](solmail-android/src/wallet/mwa.ts) routes to Seed Vault on Seeker, where the key never leaves the secure element and the user gets a native biometric prompt, and falls back to Phantom or Solflare on any other Android device. One code path, two custody models, zero Seeker-specific code.

**Autonomous refund agent.** `SolanaAgentKit` boots with a `KeypairWallet` from env. `processEmailReply` runs score, decide, then `releaseEscrowAction` or `withholdEscrowAction`, which call `program.methods.release()` and `withhold()` via Anchor server-side. Required because no human would sign their own refund.

**Reply scoring.** LangChain `ChatOpenAI` returns 80 for genuine replies, 5 for empty, gibberish, spam, or prompt injection. `decide()` enforces `score >= 15`, server-side. Client sees only a boolean.

**Cloudflare stack.** tRPC on Workers with six Durable Objects, Hyperdrive Postgres, Workers AI, Vectorize, R2, Queues, KV. Escrow settlement runs in `ctx.executionCtx.waitUntil()`, never blocking send. Escrow metadata rides in `X-Solmail-Sender-Pubkey` and `X-Solmail-Thread-Id` headers, so messages stay valid SMTP.

**Uniquely enabled.** Seed Vault gives hardware key custody with no custom code. MWA ships one APK to Seeker and every other Android wallet. solana-agent-kit lets the server hold its own Solana wallet without ever touching user keys.

### Blockchain interaction

1. **Send.** The mobile app signs an `init_escrow` transaction via Mobile Wallet Adapter. On Seeker this routes to Seed Vault for biometric approval. The instruction creates an escrow PDA seeded by `["escrow", random_32_byte_thread_id]` and locks the sender's SOL on devnet.
2. **Carry.** The 32-byte thread ID and the sender pubkey are embedded in the outgoing email as `X-Solmail-Thread-Id` and `X-Solmail-Sender-Pubkey` headers, keeping the message valid SMTP so it reaches plain Gmail too.
3. **Reply.** The recipient opens the thread in the SolMail app. Hitting Send triggers a server-side reply-quality check. If the check passes, the app signs a `register_and_claim` instruction that closes the escrow PDA and transfers the lamports to the recipient's wallet.
4. **Refund.** After every reply, a Cloudflare Worker async job (`processEmailReply` in [escrow-agent.ts](Zero/apps/server/src/routes/agent/escrow-agent.ts)) re-runs scoring authoritatively. On a fail verdict, the server's solana-agent-kit keypair signs `withhold` to refund the sender. No user signature required.
5. **Settlement.** All four transactions (`init_escrow`, `register_and_claim`, `withhold`, plus account creation) are visible on the Solana devnet explorer and signed by hardware-backed keys on Seeker, or by Phantom/Solflare on other Android devices.

## About SolMail

SolMail is an innovative email client that revolutionizes cold emailing by implementing a pay-for-success model. Built on the Zero email framework, SolMail ensures you only pay for meaningful email conversations.

### Problem

Cold emailing is inefficient and costly. You pay for emails that don't get meaningful replies, wasting resources on unsuccessful outreach campaigns.

### Solution

SolMail sends micropayments upfront and refunds them if replies aren't meaningful, ensuring you pay solely for successful conversations that drive real business value.

### Key Features

- **Pay for Success** - Send micropayments upfront, get refunds if replies aren't meaningful
- **AI-Powered** - Leverage AI to enhance your email experience
- **Built on Zero** - Powered by the open-source Zero email framework
- **Privacy First** - Your emails, your data
- **Fast & Reliable** - Lightning-fast interface and reliable delivery

## Getting Started

SolMail has two parts that run side by side: the **Zero backend** (Cloudflare Workers + Postgres) and the **Android app** (Expo / React Native). You need both running for the mobile app to work end-to-end.

### Prerequisites

- Node.js + `pnpm` (v10+)
- Docker (for the local Postgres + Redis containers)
- Android Studio + Android SDK (only needed for the first build)
- A physical Android phone with **USB debugging enabled**, plugged in via USB

### 1. Backend — Zero

In one terminal:

```bash
cd Zero
pnpm install
cp .env.example .env       # then fill in real values
pnpm docker:db:up          # starts Postgres on :5432, Redis on :6379, Upstash proxy on :8079
pnpm dev                   # backend on http://localhost:8787, web app on :3000
```

Leave this terminal running. The backend hot-reloads on file changes.

### 2. Android app — solmail-android

In a second terminal:

```bash
cd solmail-android
pnpm install
cp .env.example .env       # uses EXPO_PUBLIC_BACKEND_URL=http://localhost:8787 (works via adb reverse)
pnpm android --device      # first time: builds APK, installs, launches; ~5–10 min
```

`pnpm android` builds the native APK and exits — Metro bundler runs separately. After the first build, day-to-day development looks like:

```bash
cd solmail-android
pnpm start                 # starts Metro + auto-runs adb reverse for ports 3000/8081/8787
```

Then save any `.tsx` file → Fast Refresh updates the app on your phone instantly. You only need to re-run `pnpm android` when you add a native dependency or change [solmail-android/app.json](solmail-android/app.json).

> The `start` and `android` scripts automatically run `adb reverse tcp:3000`, `tcp:8787`, and `tcp:8081`, so the phone reaches the Mac via USB tunnel — no Wi-Fi config needed. The phone must be plugged in.

## Project Structure

```
solmail-android/
├── Zero/                  # Zero email backend + web app (Cloudflare Workers, Postgres)
│   └── apps/
│       ├── mail/          # React web client (port 3000)
│       └── server/        # tRPC + Better Auth backend (port 8787)
├── solmail-android/       # Expo / React Native mobile app
│   ├── app/               # Expo Router screens (.tsx)
│   ├── src/               # Wallet, auth, tRPC client
│   └── android/           # Native Android project (generated by `expo prebuild`)
├── escrow/                # Solana escrow program (Anchor)
└── solidity-escrow/       # EVM-side escrow contracts
```

## Technology Stack

SolMail inherits the robust technology stack from Zero:

- **Frontend**: React, TypeScript, TailwindCSS, React Router
- **Backend**: Node.js, Drizzle ORM
- **Database**: PostgreSQL
- **Authentication**: Better Auth, Google OAuth
- **Deployment**: Cloudflare Workers

## License

This project is licensed under the same license as the Zero framework. See the [LICENSE](Zero/LICENSE) file for details.

---

<p align="center">
  Built with <a href="https://github.com/Mail-0/Zero">Zero</a>
</p>

