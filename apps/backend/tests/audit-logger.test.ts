/**
 * LOGIN-3.12 — Platform detection & audit logger tests.
 *
 * Verifies:
 *   - detectPlatform returns "android_sim" for Android + SIM capability, else "ios_otp"
 *   - getVerificationPath maps platform -> path
 *   - logOtpRequest never throws (a failure must not block the OTP flow)
 *
 * The client-response invisibility requirement is covered by the route wiring
 * (the OTP send handler returns `{ success: true }` for every platform).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  detectPlatform,
  getVerificationPath,
  logOtpRequest,
} from "../src/audit/audit-logger.js";

describe("detectPlatform", () => {
  it("returns android_sim for an Android UA with SIM available", () => {
    expect(
      detectPlatform({
        userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
        androidSimAvailable: "true",
      }),
    ).toBe("android_sim");
  });

  it("returns ios_otp for an Android UA WITHOUT SIM available", () => {
    expect(
      detectPlatform({
        userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
        androidSimAvailable: "false",
      }),
    ).toBe("ios_otp");
  });

  it("returns ios_otp for an iOS UA", () => {
    expect(
      detectPlatform({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
      }),
    ).toBe("ios_otp");
  });

  it("returns ios_otp for an unknown/web UA", () => {
    expect(detectPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe(
      "ios_otp",
    );
  });

  it("returns ios_otp when no headers are present (default)", () => {
    expect(detectPlatform({})).toBe("ios_otp");
  });

  it("accepts a boolean androidSimAvailable flag", () => {
    expect(
      detectPlatform({ userAgent: "Android", androidSimAvailable: true }),
    ).toBe("android_sim");
  });
});

describe("getVerificationPath", () => {
  it("maps android_sim -> sim_check", () => {
    expect(getVerificationPath("android_sim")).toBe("sim_check");
  });

  it("maps ios_otp -> otp_sms", () => {
    expect(getVerificationPath("ios_otp")).toBe("otp_sms");
  });
});

describe("logOtpRequest", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not throw when the database write fails (non-blocking)", async () => {
    // Mock getDb to throw so the insert fails; logOtpRequest must swallow it.
    vi.doMock("../src/db/index.js", () => ({
      getDb: () => {
        throw new Error("DB unavailable");
      },
    }));

    const { logOtpRequest: log } = await import("../src/audit/audit-logger.js");
    await expect(
      log({
        phoneNumber: "+911234567890",
        platform: "android_sim",
        verificationPath: "sim_check",
        timestamp: new Date(),
      }),
    ).resolves.toBeUndefined();
  });
});
