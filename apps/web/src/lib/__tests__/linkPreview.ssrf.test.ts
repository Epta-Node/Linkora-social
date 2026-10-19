/**
 * Tests for linkPreview.ts — covers the SSRF blocklist (issue #1581).
 */
import { shouldFetchPreview } from '../linkPreview';

describe('shouldFetchPreview — SSRF blocklist', () => {
  // ---------- should allow ----------
  it('allows a normal public URL', () => {
    expect(shouldFetchPreview('https://example.com/page')).toBe(true);
  });

  it('allows HTTPS with a path and query string', () => {
    expect(shouldFetchPreview('https://open.spotify.com/track/abc?si=123')).toBe(true);
  });

  // ---------- scheme filtering ----------
  it('rejects file:// URLs', () => {
    expect(shouldFetchPreview('file:///etc/passwd')).toBe(false);
  });

  it('rejects ftp:// URLs', () => {
    expect(shouldFetchPreview('ftp://example.com/data')).toBe(false);
  });

  // ---------- IPv4 loopback ----------
  it('rejects 127.0.0.1', () => {
    expect(shouldFetchPreview('http://127.0.0.1/')).toBe(false);
  });

  it('rejects decimal-encoded loopback (2130706433 = 127.0.0.1)', () => {
    expect(shouldFetchPreview('http://2130706433/')).toBe(false);
  });

  it('rejects octal-encoded loopback (0177.0.0.1)', () => {
    expect(shouldFetchPreview('http://0177.0.0.1/')).toBe(false);
  });

  it('rejects hex-encoded loopback (0x7f.0.0.1)', () => {
    expect(shouldFetchPreview('http://0x7f.0.0.1/')).toBe(false);
  });

  it('rejects packed hex loopback (0x7f000001)', () => {
    expect(shouldFetchPreview('http://0x7f000001/')).toBe(false);
  });

  // ---------- localhost ----------
  it('rejects localhost', () => {
    expect(shouldFetchPreview('http://localhost/')).toBe(false);
  });

  // ---------- IMDS / link-local ----------
  it('rejects 169.254.169.254 (AWS IMDS)', () => {
    expect(shouldFetchPreview('http://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('rejects link-local range 169.254.0.1', () => {
    expect(shouldFetchPreview('http://169.254.0.1/')).toBe(false);
  });

  // ---------- RFC 1918 private ranges ----------
  it('rejects 10.0.0.1', () => {
    expect(shouldFetchPreview('http://10.0.0.1/')).toBe(false);
  });

  it('rejects 192.168.1.1', () => {
    expect(shouldFetchPreview('http://192.168.1.1/')).toBe(false);
  });

  it('rejects 172.16.0.1', () => {
    expect(shouldFetchPreview('http://172.16.0.1/')).toBe(false);
  });

  it('rejects 172.31.255.255', () => {
    expect(shouldFetchPreview('http://172.31.255.255/')).toBe(false);
  });

  // ---------- IPv6 ----------
  it('rejects [::1] (IPv6 loopback)', () => {
    expect(shouldFetchPreview('http://[::1]/')).toBe(false);
  });

  it('rejects [fc00::1] (unique-local)', () => {
    expect(shouldFetchPreview('http://[fc00::1]/')).toBe(false);
  });

  it('rejects [fd00::1] (unique-local)', () => {
    expect(shouldFetchPreview('http://[fd00::1]/')).toBe(false);
  });

  it('rejects [fe80::1] (link-local)', () => {
    expect(shouldFetchPreview('http://[fe80::1]/')).toBe(false);
  });

  // ---------- 0.0.0.0 ----------
  it('rejects 0.0.0.0', () => {
    expect(shouldFetchPreview('http://0.0.0.0/')).toBe(false);
  });
});
