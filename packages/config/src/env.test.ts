import { describe, expect, it } from "bun:test";

// A fresh process exercises createEnv without module caching or mutating the
// environment used by other tests. CI normally skips validation, so omit it.
function readOrigins(value?: string) {
  return Bun.spawnSync({
    cmd: [
      process.execPath,
      "--no-env-file",
      "--eval",
      `import { env } from ${JSON.stringify(`${import.meta.dir}/env.ts`)};
       console.log(JSON.stringify(env.AUTH_TRUSTED_ORIGINS ?? null));`,
    ],
    env: {
      NODE_ENV: "test",
      ...(value !== undefined && { AUTH_TRUSTED_ORIGINS: value }),
    },
  });
}

describe("AUTH_TRUSTED_ORIGINS", () => {
  it("keeps an unset value optional and ignores empty list entries", () => {
    expect(readOrigins().stdout.toString().trim()).toBe("null");
    expect(readOrigins(" , , ").stdout.toString().trim()).toBe('""');
  });

  it("normalizes HTTP(S) URLs while preserving the comma-separated contract", () => {
    const result = readOrigins(
      " HTTPS://SYNORO.RU:443/ , , http://LOCALHOST:80/path?next=/p#top, https://example.com:8443/p ",
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toBe(
      "https://synoro.ru,http://localhost,https://example.com:8443",
    );
  });

  it.each([
    "https://*.example.com",
    "http://*.example.com:3000",
    "*.example.com",
    "https://preview-*.example.com",
    "https://app?.example.com",
    "http://localhost:*",
  ])("preserves supported wildcard patterns: %s", (pattern) => {
    const result = readOrigins(` https://SYNORO.RU/ , ${pattern} `);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toBe(
      `https://synoro.ru,${pattern}`,
    );
  });

  it.each([
    ["HTTPS://*.EXAMPLE.COM:443", "https://*.example.com"],
    ["HTTP://APP?.EXAMPLE.COM:80", "http://app?.example.com"],
    ["https://*.Example.com:00443", "https://*.example.com"],
    ["http://*.Example.com:00080", "http://*.example.com"],
    [
      "HTTPS://PREVIEW-*.EXAMPLE.COM:8443",
      "https://preview-*.example.com:8443",
    ],
    ["http://*.EXAMPLE.COM:443", "http://*.example.com:443"],
    ["https://*.EXAMPLE.COM:80", "https://*.example.com:80"],
    ["HTTPS://APP?.EXAMPLE.COM:4*?", "https://app?.example.com:4*?"],
    ["*.EXAMPLE.COM", "*.example.com"],
    ["APP?.EXAMPLE.COM:443", "app?.example.com:443"],
  ])("normalizes wildcard pattern %s to %s", (pattern, expected) => {
    const result = readOrigins(pattern);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toBe(expected);
  });

  it.each([
    "not-a-url",
    "example.com",
    "ftp://example.com",
    "javascript:alert(1)",
    "https://",
    "https://example.com:99999",
    "ftp://*.example.com",
    "https://*.example.com:99999",
    "https://user@*.example.com",
    "https://*.example.com/path",
    "https://*.example.com?key=value",
  ])("rejects an invalid entry in the list: %s", (invalid) => {
    const result = readOrigins(`https://synoro.ru,${invalid}`);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("AUTH_TRUSTED_ORIGINS");
  });
});
