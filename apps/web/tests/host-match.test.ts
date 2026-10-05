import { describe, expect, it } from "vitest";
import { scoreHostMatch } from "../src/lib/host-match";

describe("autofill hostname validation", () => {
  it.each([
    "https://github.com.evil.example/login",
    "https://evil.example/?next=github.com",
    "https://github.com@evil.example/login",
    "https://notgithub.com/login",
  ])("rejects a deceptive URL: %s", (url) => {
    expect(scoreHostMatch({ hostname: new URL(url).hostname }, "https://github.com")).toBeLessThan(0);
  });
  it.each(["github.com", "login.github.com"])("allows %s", (hostname) => {
    expect(scoreHostMatch({ hostname }, "https://github.com")).toBe(3);
  });
  it("does not broaden a subdomain credential to its parent", () => {
    expect(scoreHostMatch({ hostname: "example.com" }, "https://private.example.com")).toBeLessThan(0);
  });
  it("rejects credentials without a usable site URL", () => {
    expect(scoreHostMatch({ hostname: "github.com" })).toBeLessThan(0);
    expect(scoreHostMatch(null, "https://github.com")).toBeLessThan(0);
  });
});


it("rejects downgrading an HTTPS login to HTTP", () => {
  expect(scoreHostMatch({ hostname: "github.com", protocol: "http:" }, "https://github.com")).toBeLessThan(0);
  expect(scoreHostMatch({ hostname: "github.com", protocol: "https:" }, "https://github.com")).toBe(3);
  expect(scoreHostMatch({ hostname: "localhost", protocol: "http:" }, "http://localhost")).toBe(3);
});
