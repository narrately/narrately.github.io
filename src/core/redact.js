
export const MAX_DIFF_BYTES = 50 * 1024;

const PATTERNS = [
  { name: 'aws-access-key-id', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'google-api-key', regex: /AIza[0-9A-Za-z_\-]{35}/g },
  { name: 'github-token', regex: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: 'slack-token', regex: /xox[baprs]-[0-9A-Za-z-]{10,}/g },
  { name: 'jwt', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    name: 'private-key-block',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  { name: 'bearer-token', regex: /Bearer\s+[A-Za-z0-9\-_.]{10,}/g },
  {
    name: 'quoted-secret-assignment',
    regex: /(api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key)(\s*[:=]\s*)(['"])([^'"\s]{8,})\3/gi,
  },
  {
    name: 'env-style-assignment',
    regex: /^([+\- ]?)([A-Z][A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD)[A-Z0-9_]*)\s*=\s*(\S+)\r?$/gm,
  },
];

const PLACEHOLDER_VALUES = new Set([
  'changeme', 'change_me', 'your_key_here', 'your-key-here', 'xxx', 'xxxx',
  'placeholder', 'example', 'todo', 'fixme', 'redacted', '<key>', '<token>',
  '<secret>', '<password>', '',
]);

function isPlaceholder(value) {
  return PLACEHOLDER_VALUES.has(String(value).toLowerCase().replace(/^['"]|['"]$/g, ''));
}

export function redactSecrets(text) {
  if (!text) return { text: text ?? '', redacted: false };

  let redacted = false;
  let out = text;

  for (const { name, regex } of PATTERNS) {
    out = out.replace(regex, (match, ...rest) => {
      const groups = rest.slice(0, -2);
      const value = groups.length ? groups[groups.length - 1] : match;
      if (isPlaceholder(value)) return match;

      redacted = true;
      if (name === 'env-style-assignment') {
        const [marker, key] = groups;
        return `${marker}${key}=[REDACTED:${name}]`;
      }
      if (name === 'quoted-secret-assignment') {
        const [keyword, separator, quote] = groups;
        return `${keyword}${separator}${quote}[REDACTED:${name}]${quote}`;
      }
      return `[REDACTED:${name}]`;
    });
  }

  return { text: out, redacted };
}
