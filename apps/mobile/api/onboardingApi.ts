// api/onboardingApi.ts
//
// ONB — API layer for onboarding.
//
// This is an in-memory MOCK implementation of the backend contract. All state
// lives in memory and resets on app restart. It stands in for the real
// Supabase-backed Express backend so the app can run without a network /
// backend process. The exported types and the `onboardingApi` object shape
// match the live fetch-based contract exactly, so callers need no changes.
//is this changed
// ── Mock-internal state & constants ──

const MOCK_OTP_CODE = '123456';
const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 30_000;
const OTP_EXPIRY_MS = 5 * 60_000;
const RESEND_COOLDOWN_MS = 30_000;

// Pre-registered numbers → logged-in users route straight to Chats after OTP.
const REGISTERED_NUMBERS = new Set<string>([
  '+911234567890',
  '+919876543210',
  '+14155552671',
]);

// Legal acceptance is durable app-lifetime state (separate from an OTP session).
const acceptedLegalNumbers = new Set<string>();

type OtpSession = {
  phoneNumber: string;
  sentAt: number;
  attemptsUsed: number;
  lockedUntil: number | null;
  code: string;
  legalAccepted: boolean;
};

let activeOtpSession: OtpSession | null = null;

type MockProfile = {
  id: string;
  name: string;
  photo?: string;
  about: string;
  phoneNumber: string;
  createdAt: string;
  updatedAt: string;
};

const registeredProfiles = new Map<string, MockProfile>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function now(): number {
  return Date.now();
}

function issueToken(): string {
  return `mock_token_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function findProfileByPhone(phoneNumber: string): MockProfile | undefined {
  return registeredProfiles.get(phoneNumber);
}

// ── Types (mirror the live API contract) ──

export type SendOtpParams = { phoneNumber: string };
export type SendOtpResult = { success: true };

export type VerifyOtpParams = { phoneNumber: string; code: string };
export type VerifyOtpResult =
  | { status: 'success'; routing: 'chats' | 'profile_setup'; accessToken: string; refreshToken: string; userId: string; sessionId: string }
  | { status: 'wrong_code'; attemptsRemaining: number }
  | { status: 'locked_out'; secondsRemaining: number }
  | { status: 'attempts_exhausted' }
  | { status: 'expired' };

export type CheckExistingUserParams = { phoneNumber: string };
export type CheckExistingUserResult = { exists: boolean };

export type CreateProfileParams = {
  name: string;
  photo?: string;
  about: string;
};

export type CreateProfileResult = {
  success: true;
  userId: string;
  profile: {
    id: string;
    name: string;
    photo?: string;
    about: string;
    phoneNumber: string;
    createdAt: string;
  };
};

export type GetProfileResult = {
  id: string;
  name: string;
  photo?: string;
  about: string;
  phoneNumber: string;
  createdAt: string;
  updatedAt: string;
};

export type UpdateProfileParams = {
  name?: string;
  photo?: string;
  about?: string;
};

export type UpdateProfileResult = {
  success: true;
  profile: GetProfileResult;
};

export type LoginHandoffParams = {
  refreshToken: string;
  deviceInfo: {
    deviceId: string;
    deviceName: string;
    platform: 'ios' | 'android' | 'web';
  };
};

export type LoginHandoffResult = {
  success: true;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  message: string;
  previousDevicesLoggedOut: number;
};

// ── Mock API implementation ──

export const onboardingApi = {
  async sendOtp({ phoneNumber }: SendOtpParams): Promise<SendOtpResult> {
    await delay(400);

    if (!acceptedLegalNumbers.has(phoneNumber)) {
      throw Object.assign(new Error('LEGAL_NOT_ACCEPTED'), { status: 403 });
    }

    if (activeOtpSession?.phoneNumber === phoneNumber) {
      const elapsed = now() - activeOtpSession.sentAt;
      if (elapsed < RESEND_COOLDOWN_MS) {
        throw Object.assign(new Error('RESEND_COOLDOWN_ACTIVE'), { status: 429 });
      }
    }

    activeOtpSession = {
      phoneNumber,
      sentAt: now(),
      attemptsUsed: 0,
      lockedUntil: null,
      code: MOCK_OTP_CODE,
      legalAccepted: true,
    };

    return { success: true };
  },

  async verifyOtp({ phoneNumber, code }: VerifyOtpParams): Promise<VerifyOtpResult> {
    await delay(400);

    if (!activeOtpSession || activeOtpSession.phoneNumber !== phoneNumber) {
      throw Object.assign(new Error('NO_ACTIVE_SESSION'), { status: 404 });
    }

    const session = { ...activeOtpSession };

    if (!session.legalAccepted) {
      throw Object.assign(new Error('LEGAL_NOT_ACCEPTED'), { status: 403 });
    }

    if (session.lockedUntil && now() < session.lockedUntil) {
      return {
        status: 'locked_out',
        secondsRemaining: Math.ceil((session.lockedUntil - now()) / 1000),
      };
    }

    if (now() - session.sentAt > OTP_EXPIRY_MS) {
      activeOtpSession = null;
      return { status: 'expired' };
    }

    if (code === session.code) {
      activeOtpSession = null;

      const userId = `user_${Date.now()}`;
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const displayPhone = session.phoneNumber;
      const existing = findProfileByPhone(displayPhone);

      // Pre-registered users already have a profile → go straight to Chats.
      const routing: 'chats' | 'profile_setup' =
        existing || REGISTERED_NUMBERS.has(displayPhone) ? 'chats' : 'profile_setup';

      return {
        status: 'success',
        routing,
        accessToken: issueToken(),
        refreshToken: issueToken(),
        userId,
        sessionId,
      };
    }

    activeOtpSession!.attemptsUsed += 1;
    const attemptsRemaining = MAX_ATTEMPTS - activeOtpSession!.attemptsUsed;

    if (attemptsRemaining <= 0) {
      activeOtpSession!.lockedUntil = now() + LOCKOUT_MS;
      return {
        status: 'attempts_exhausted',
      };
    }

    return { status: 'wrong_code', attemptsRemaining };
  },

  async checkExistingUser({ phoneNumber }: CheckExistingUserParams): Promise<CheckExistingUserResult> {
    await delay(300);
    return { exists: REGISTERED_NUMBERS.has(phoneNumber) || registeredProfiles.has(phoneNumber) };
  },

  async handleLoginHandoff({
    refreshToken,
    deviceInfo,
  }: LoginHandoffParams): Promise<LoginHandoffResult> {
    await delay(300);

    if (!refreshToken) {
      throw Object.assign(new Error('INVALID_REFRESH_TOKEN'), { status: 401 });
    }

    return {
      success: true,
      sessionId: `session_${Date.now()}`,
      accessToken: issueToken(),
      refreshToken: issueToken(),
      message: 'Logged in on this device. Other devices were logged out.',
      previousDevicesLoggedOut: 1,
    };
  },

  async checkSessionValidity({
    deviceId,
  }: {
    deviceId: string;
  }): Promise<{ isValid: boolean; message?: string }> {
    await delay(250);

    // Mock always treats the local session as valid — no remote revocation exists.
    if (!deviceId) {
      return { isValid: false, message: 'Missing device id' };
    }
    return { isValid: true };
  },

  async createProfile({ name, photo, about }: CreateProfileParams): Promise<CreateProfileResult> {
    await delay(500);

    if (!name || name.trim().length === 0) {
      throw Object.assign(new Error('NAME_REQUIRED'), { status: 400 });
    }

    const id = `user_${Date.now()}`;
    const profile: MockProfile = {
      id,
      name: name.trim(),
      photo,
      about: about.trim() || "Hey there! I'm using ONB",
      phoneNumber: `+${Math.floor(1000000000 + Math.random() * 8999999999)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    registeredProfiles.set(profile.phoneNumber, profile);

    return {
      success: true,
      userId: id,
      profile: {
        id: profile.id,
        name: profile.name,
        photo: profile.photo,
        about: profile.about,
        phoneNumber: profile.phoneNumber,
        createdAt: profile.createdAt,
      },
    };
  },

  async getProfile(): Promise<GetProfileResult> {
    await delay(300);

    const profile = registeredProfiles.values().next().value as MockProfile | undefined;
    if (!profile) {
      throw Object.assign(new Error('PROFILE_NOT_FOUND'), { status: 404 });
    }

    return { ...profile };
  },

  async updateProfile({ name, photo, about }: UpdateProfileParams): Promise<UpdateProfileResult> {
    await delay(300);

    const profile = registeredProfiles.values().next().value as MockProfile | undefined;
    if (!profile) {
      throw Object.assign(new Error('PROFILE_NOT_FOUND'), { status: 404 });
    }

    if (name !== undefined && name.trim().length === 0) {
      throw Object.assign(new Error('NAME_REQUIRED'), { status: 400 });
    }

    if (name !== undefined) profile.name = name.trim();
    if (photo !== undefined) profile.photo = photo;
    if (about !== undefined) profile.about = about.trim();
    profile.updatedAt = new Date().toISOString();

    return { success: true, profile: { ...profile } };
  },

  async acceptLegal(phoneNumber: string): Promise<{ success: true }> {
    await delay(200);
    acceptedLegalNumbers.add(phoneNumber);
    if (activeOtpSession?.phoneNumber === phoneNumber) {
      activeOtpSession.legalAccepted = true;
    }
    return { success: true };
  },

  async refreshTokens(refreshToken: string): Promise<{ accessToken: string }> {
    await delay(200);
    if (!refreshToken) {
      throw Object.assign(new Error('INVALID_REFRESH_TOKEN'), { status: 401 });
    }
    return { accessToken: issueToken() };
  },
};

// ── Dev/test helpers (not used by screens) ──
export const mockState = {
  acceptedLegalNumbers,
  clearOtpSession() {
    activeOtpSession = null;
  },
  clearAll() {
    activeOtpSession = null;
    acceptedLegalNumbers.clear();
    registeredProfiles.clear();
  },
};
