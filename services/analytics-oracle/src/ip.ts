export const DEFAULT_TRUSTED_PROXIES = [
  "127.0.0.1/32",
  "127.0.0.1",
  "::1/128",
  "::1",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
];

export function normalizeIp(ip: string): string {
  if (!ip) return "unknown";
  let cleaned = ip.trim();
  if (cleaned.startsWith("::ffff:")) {
    cleaned = cleaned.substring(7);
  }
  return cleaned;
}

function ipv4ToLong(ip: string): number | null {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  const normalizedIp = normalizeIp(ip);
  const normalizedCidr = normalizeIp(cidr);

  if (!normalizedCidr.includes("/")) {
    return normalizedIp === normalizedCidr;
  }

  const [range, bitsStr] = normalizedCidr.split("/");
  const bits = parseInt(bitsStr, 10);

  const ipLong = ipv4ToLong(normalizedIp);
  const rangeLong = ipv4ToLong(range);
  if (ipLong !== null && rangeLong !== null && !isNaN(bits) && bits >= 0 && bits <= 32) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipLong & mask) === (rangeLong & mask);
  }

  if (normalizedIp === range) {
    return true;
  }

  return false;
}

export function getClientIP(
  req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string }; ip?: string },
  customTrustedProxies?: string[]
): string {
  const trustedList =
    customTrustedProxies ??
    (process.env["TRUSTED_PROXIES"]
      ? process.env["TRUSTED_PROXIES"]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : DEFAULT_TRUSTED_PROXIES);

  const socketIp = normalizeIp(req.socket?.remoteAddress || req.ip || "unknown");

  const isDirectConnectionTrusted = trustedList.some((cidr) => isIpInCidr(socketIp, cidr));

  if (!isDirectConnectionTrusted) {
    return socketIp;
  }

  const rawXff = req.headers["x-forwarded-for"];
  if (!rawXff) {
    return socketIp;
  }

  const xffHeader = Array.isArray(rawXff) ? rawXff.join(",") : String(rawXff);
  const ips = xffHeader
    .split(",")
    .map((ip) => normalizeIp(ip))
    .filter(Boolean);

  if (ips.length === 0) {
    return socketIp;
  }

  for (let i = ips.length - 1; i >= 0; i--) {
    const candidateIp = ips[i];
    const isTrusted = trustedList.some((cidr) => isIpInCidr(candidateIp, cidr));
    if (!isTrusted) {
      return candidateIp;
    }
  }

  return ips[0];
}
