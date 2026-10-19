import { getClientIP, isIpInCidr, normalizeIp } from "../ip.js";

describe("analytics-oracle getClientIP & Trusted Proxy", () => {
  it("normalizes IPv4 and IPv6-mapped addresses", () => {
    expect(normalizeIp("::ffff:192.168.1.1")).toBe("192.168.1.1");
    expect(normalizeIp("10.0.0.1")).toBe("10.0.0.1");
  });

  it("checks CIDR subnets correctly", () => {
    expect(isIpInCidr("10.0.0.5", "10.0.0.0/8")).toBe(true);
    expect(isIpInCidr("172.16.5.5", "172.16.0.0/12")).toBe(true);
    expect(isIpInCidr("192.168.1.1", "192.168.0.0/16")).toBe(true);
    expect(isIpInCidr("8.8.8.8", "10.0.0.0/8")).toBe(false);
  });

  it("ignores spoofed X-Forwarded-For header on direct untrusted connection", () => {
    const req = {
      headers: { "x-forwarded-for": "1.1.1.1" },
      socket: { remoteAddress: "198.51.100.1" },
    };
    expect(getClientIP(req, ["10.0.0.0/8", "127.0.0.1"])).toBe("198.51.100.1");
  });

  it("extracts client IP when request passes through trusted proxy", () => {
    const req = {
      headers: { "x-forwarded-for": "203.0.113.10" },
      socket: { remoteAddress: "10.0.0.1" },
    };
    expect(getClientIP(req, ["10.0.0.0/8"])).toBe("203.0.113.10");
  });

  it("extracts leftmost untrusted IP from multi-hop X-Forwarded-For chain", () => {
    const req = {
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.2" },
      socket: { remoteAddress: "10.0.0.1" },
    };
    expect(getClientIP(req, ["10.0.0.0/8"])).toBe("203.0.113.10");
  });
});
