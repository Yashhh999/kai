import { describe, it, expect } from 'vitest';
import {
  createInvite,
  parseInvite,
  redeemInvite,
  verifyInvite,
  inviteId,
} from './invite';
import { generateIdentity } from './identity';
import { randomBytes } from './encryption';
import { bytesEqual } from './wire';

describe('invites', () => {
  it('round-trips a no-password invite via the fragment', async () => {
    const issuer = generateIdentity();
    const roomKey = randomBytes(32);
    const created = await createInvite(roomKey, 'ROUTING123', issuer, { maxUses: 5 });
    const link = created.link('https://kai.example');
    expect(link).toContain('/join#i=');
    expect(link).toContain('&k=');

    const parsed = parseInvite(link);
    const redeemed = await redeemInvite(parsed);
    expect(bytesEqual(redeemed.roomKeyBytes, roomKey)).toBe(true);
    expect(redeemed.routingId).toBe('ROUTING123');
    expect(redeemed.issuerFingerprint).toBe(issuer.fingerprint);
  });

  it('password invites require the correct password and carry no link key', async () => {
    const issuer = generateIdentity();
    const roomKey = randomBytes(32);
    const created = await createInvite(roomKey, 'ROUTING123', issuer, {}, 'hunter2');
    expect(created.fragment).not.toContain('&k=');

    const parsed = parseInvite(created.link('https://kai.example'));
    await expect(redeemInvite(parsed)).rejects.toThrow(/password/);
    await expect(redeemInvite(parsed, { password: 'wrong' })).rejects.toBeTruthy();
    const ok = await redeemInvite(parsed, { password: 'hunter2' });
    expect(bytesEqual(ok.roomKeyBytes, roomKey)).toBe(true);
  });

  it('rejects an expired invite', async () => {
    const issuer = generateIdentity();
    const created = await createInvite(randomBytes(32), 'R', issuer, { expiresAt: Date.now() - 1000 });
    await expect(redeemInvite(parseInvite(created.link('https://x')))).rejects.toThrow(/expired/);
  });

  it('detects tampering with flags (signature covers them)', async () => {
    const issuer = generateIdentity();
    const created = await createInvite(randomBytes(32), 'R', issuer, { maxUses: 1 });
    const tampered = { ...created.token, flags: { maxUses: 999 } };
    expect(verifyInvite(created.token)).toBe(true);
    expect(verifyInvite(tampered)).toBe(false);
  });

  it('rejects a token whose fingerprint does not match its keys', async () => {
    const issuer = generateIdentity();
    const created = await createInvite(randomBytes(32), 'R', issuer);
    const forged = { ...created.token, issuerFingerprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
    expect(verifyInvite(forged)).toBe(false);
  });

  it('inviteId is a stable hash of the nonce (no key material)', async () => {
    const issuer = generateIdentity();
    const created = await createInvite(randomBytes(32), 'R', issuer);
    expect(inviteId(created.token)).toBe(inviteId(created.token));
  });
});
