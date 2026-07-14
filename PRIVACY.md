Privacy Policy

Last updated: December 13, 2025

## Data Collection

We collect **zero durable data** — nothing is ever written to a database, disk, or log.

- No database / disk persistence
- No analytics
- No tracking
- No cookies
- No accounts (only a local cryptographic identity you generate on your device)

**Honest nuance:** to relay messages between people in a room, the server keeps a
small amount of state **in memory only** (wiped on restart): who is currently
connected, and — for legacy rooms — a short buffer of *encrypted* messages for
replay. It never holds any key or plaintext, and forward-secret (v2) rooms are not
buffered at all. The server does observe **metadata**: which routing id you connect
to, your public-key fingerprint, and message timing/sizes.

## What Happens to Your Messages

Your messages are:
- Encrypted on your device before they leave your browser
- Never sent to our servers in readable form (the server cannot derive your keys)
- Automatically deleted after expiration (24 hours, or 7 days if you opt in)

**On-device history:** so you don't have to re-enter room codes and so past chats
survive a reload, your **conversation list, room keys, and direct-message history** are
kept in the **PIN-sealed store** (encrypted at rest under your PIN). Room message
bodies are cached in local storage per the retention window. Anyone with your unlocked
device and PIN can read this history — forward secrecy still protects data on the
network, not data at rest on your own device ("FS ≠ local deletion"). Use **Reset
identity** in Profile to wipe everything.

See [SECURITY.md](SECURITY.md) and [THREAT-MODEL.md](THREAT-MODEL.md) for the full model.

## Third Parties

We don't share anything because we don't have anything to share.

## Your Rights

- Delete all data: Clear your browser storage
- Export data: Use browser dev tools
- Stop service: Close the tab

## Changes

If we update this, you'll see the date change above.

## Contact

Check the GitHub repo for issues.
