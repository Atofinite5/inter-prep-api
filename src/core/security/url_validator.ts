import { URL } from 'url';

export interface UrlValidationResult {
  isValid: boolean;
  sanitizedUrl?: string;
  error?: string;
}

export interface UrlValidatorOptions {
  allowLocalHosts?: boolean;
}

const PRIVATE_IP_PATTERNS = [
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,                // Loopback (127.0.0.0/8)
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,                 // Class A private (10.0.0.0/8)
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,   // Class B private (172.16.0.0/12)
  /^192\.168\.\d{1,3}\.\d{1,3}$/,                   // Class C private (192.168.0.0/16)
  /^169\.254\.\d{1,3}\.\d{1,3}$/,                   // Link-local / Cloud Metadata (169.254.0.0/16)
  /^0\.0\.0\.0$/,                                   // Any local address
  /^::1$/,                                          // IPv6 loopback
  /^fe80:/i,                                        // IPv6 link-local
  /^fc00:/i,                                        // IPv6 unique local
];

/**
 * Validates and sanitizes a company URL to defend against SSRF (Server-Side Request Forgery).
 */
export function validateCompanyUrl(
  inputUrl: string,
  options: UrlValidatorOptions = {}
): UrlValidationResult {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { isValid: false, error: 'URL must be a non-empty string' };
  }

  const trimmed = inputUrl.trim();
  let parsed: URL;

  try {
    // If protocol is present (e.g. ftp://, file://, javascript:) do not prepend https://
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
    const withProtocol = hasScheme ? trimmed : `https://${trimmed}`;
    parsed = new URL(withProtocol);
  } catch {
    return { isValid: false, error: `Malformed URL: "${inputUrl}"` };
  }

  // Only allow HTTP and HTTPS protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { isValid: false, error: `Unsupported protocol: "${parsed.protocol}". Only HTTP and HTTPS are allowed.` };
  }

  const rawHostname = parsed.hostname.toLowerCase();
  // Strip brackets from IPv6 hostnames like "[::1]"
  const hostname = rawHostname.replace(/^\[/, '').replace(/\]$/, '');
  const allowLocal = options.allowLocalHosts !== undefined
    ? options.allowLocalHosts
    : (process.env.ALLOW_LOCAL_HOSTS === 'true');

  // Check for localhost / loopback
  const isLocalHost = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1';

  if (!allowLocal) {
    if (isLocalHost) {
      return { isValid: false, error: `Localhost and loopback addresses are prohibited: "${hostname}"` };
    }

    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { isValid: false, error: `Private network / internal IP addresses are prohibited: "${hostname}"` };
      }
    }
  }

  return {
    isValid: true,
    sanitizedUrl: parsed.toString(),
  };
}

/**
 * Resolves a relative URL safely against a base URL.
 */
export function resolveSafeUrl(relativeOrAbsolute: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(relativeOrAbsolute, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}
