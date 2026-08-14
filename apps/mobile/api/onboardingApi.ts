// api/onboardingApi.ts
//
// ONB — Frontend-only API contract for onboarding.
//
// The real backend is being built separately by the backend team and will be
// merged in here. This file is the single allocation point: replace each stub
// below with a real HTTP call, keeping the exact signatures and types so the
// screens do not need to change.

export type SendOtpParams = { phoneNumber: string };
export type SendOtpResult = { success: true };

export type VerifyOtpParams = { phoneNumber: string; code: string };
export type VerifyOtpResult =
  | { status: 'success' }
  | { status: 'wrong_code'; attemptsRemaining: number }
  | { status: 'locked_out'; secondsRemaining: number }
  | { status: 'attempts_exhausted' };

// Profile setup types
export type CheckExistingUserParams = { phoneNumber: string };
export type CheckExistingUserResult = { exists: boolean; userId?: string };

export type CreateProfileParams = {
  phoneNumber: string;
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

export type GetProfileParams = { userId: string };
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
  userId: string;
  name?: string;
  photo?: string;
  about?: string;
};

export type UpdateProfileResult = {
  success: true;
  profile: GetProfileResult;
};

// ONB-1.7: New-device login handoff types
export type DeviceInfo = {
  deviceId: string;
  deviceName: string;
  platform: 'ios' | 'android' | 'web';
  lastActive: string;
  isActive: boolean;
};

export type SessionInfo = {
  sessionId: string;
  userId: string;
  phoneNumber: string;
  devices: DeviceInfo[];
  activeDeviceId: string;
};

export type LoginHandoffParams = {
  phoneNumber: string;
  userId: string;
  deviceInfo: {
    deviceId: string;
    deviceName: string;
    platform: 'ios' | 'android' | 'web';
  };
};

export type LoginHandoffResult = {
  success: true;
  sessionId: string;
  message: string; // "you're now logged in here" confirmation
  previousDevicesLoggedOut: number;
};

const VALID_OTP = '123456';
const MAX_ATTEMPTS = 3;
let attemptsLeft = MAX_ATTEMPTS;

// Mock database for profiles
const mockProfiles: Map<string, GetProfileResult> = new Map();

// ONB-1.7: Mock session store
// This tracks all active sessions per user
const mockSessions: Map<string, SessionInfo> = new Map();

// Pre-populate with existing users for testing
mockProfiles.set('+11234567890', {
  id: 'user_123',
  name: 'John Doe',
  photo: undefined,
  about: 'Hey there! I\'m using ONB',
  phoneNumber: '+11234567890',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

mockProfiles.set('+19876543210', {
  id: 'user_456',
  name: 'Jane Smith',
  photo: undefined,
  about: 'Loving this app!',
  phoneNumber: '+19876543210',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

mockProfiles.set('+14155550100', {
  id: 'user_789',
  name: 'Test User',
  photo: undefined,
  about: 'Testing the app',
  phoneNumber: '+14155550100',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// Pre-populate some sessions for testing ONB-1.7
// This simulates an existing user already logged in on another device
mockSessions.set('user_123', {
  sessionId: 'session_old_123',
  userId: 'user_123',
  phoneNumber: '+11234567890',
  devices: [
    {
      deviceId: 'old_iphone_123',
      deviceName: 'iPhone 14 Pro',
      platform: 'ios',
      lastActive: new Date().toISOString(),
      isActive: true,
    },
    {
      deviceId: 'web_chrome_123',
      deviceName: 'Chrome on Mac',
      platform: 'web',
      lastActive: new Date().toISOString(),
      isActive: true,
    },
  ],
  activeDeviceId: 'old_iphone_123',
});

mockSessions.set('user_456', {
  sessionId: 'session_old_456',
  userId: 'user_456',
  phoneNumber: '+19876543210',
  devices: [
    {
      deviceId: 'old_android_456',
      deviceName: 'Samsung Galaxy S23',
      platform: 'android',
      lastActive: new Date().toISOString(),
      isActive: true,
    },
  ],
  activeDeviceId: 'old_android_456',
});

export const onboardingApi = {
  async sendOtp({ phoneNumber }: SendOtpParams): Promise<SendOtpResult> {
    // TODO(backend): POST /onboarding/otp/send { phoneNumber }
    attemptsLeft = MAX_ATTEMPTS;
    await delay(400);
    console.log('📤 OTP sent to:', phoneNumber);
    return { success: true };
  },

  async verifyOtp({ phoneNumber, code }: VerifyOtpParams): Promise<VerifyOtpResult> {
    // TODO(backend): POST /onboarding/otp/verify { phoneNumber, code }
    await delay(400);

    console.log('🔐 Verifying OTP for:', phoneNumber, 'Code:', code);

    if (code === VALID_OTP) {
      attemptsLeft = MAX_ATTEMPTS;
      console.log('✅ OTP verified successfully for:', phoneNumber);
      return { status: 'success' };
    }

    attemptsLeft -= 1;
    console.log('❌ Wrong OTP. Attempts left:', attemptsLeft);
    
    if (attemptsLeft <= 0) {
      return { status: 'attempts_exhausted' };
    }
    return { status: 'wrong_code', attemptsRemaining: attemptsLeft };
  },

  async checkExistingUser({ phoneNumber }: CheckExistingUserParams): Promise<CheckExistingUserResult> {
    await delay(300);
    
    console.log('🔍 Checking if user exists for:', phoneNumber);
    
    const profile = mockProfiles.get(phoneNumber);
    if (profile) {
      console.log('✅ User found. UserId:', profile.id);
      return { exists: true, userId: profile.id };
    }
    
    if (phoneNumber.startsWith('1')) {
      const mockUserId = `user_${phoneNumber.slice(-6)}`;
      console.log('✅ User recognized as existing (starts with 1). UserId:', mockUserId);
      return { exists: true, userId: mockUserId };
    }
    
    console.log('🆕 User not found - new user');
    return { exists: false };
  },

  /**
   * ONB-1.7: New-device login handoff
   * 
   * This function handles the "silent logout" of old devices when
   * a user logs in on a new device.
   * 
   * BEHAVIOR:
   * 1. Finds the user's existing session (if any)
   * 2. Logs out ALL other devices (old phone, web sessions)
   * 3. Creates a new session for the current device
   * 4. Returns a confirmation message for the new device only
   * 5. Old devices lose access silently (no notification)
   */
  async handleLoginHandoff({ 
    phoneNumber, 
    userId, 
    deviceInfo 
  }: LoginHandoffParams): Promise<LoginHandoffResult> {
    // TODO(backend): POST /onboarding/login/handoff { phoneNumber, userId, deviceInfo }
    await delay(500);

    console.log('🔄 ONB-1.7: New-device login handoff for:', phoneNumber);
    console.log('📱 New device:', deviceInfo.deviceName, `(${deviceInfo.platform})`);

    let previousDevicesCount = 0;
    let existingSession = mockSessions.get(userId);

    if (existingSession) {
      // Count how many devices were active before
      previousDevicesCount = existingSession.devices.filter(d => d.isActive).length;
      
      // Log out ALL existing devices (old phone and web sessions)
      // This is the "silent logout" - no notification to old devices
      existingSession.devices = existingSession.devices.map(device => ({
        ...device,
        isActive: false, // All devices become inactive
      }));
      
      console.log(`🔒 Silently logged out ${previousDevicesCount} existing devices`);
      console.log('📱 Old devices:', existingSession.devices.map(d => d.deviceName).join(', '));
    } else {
      // First time login - create new session
      existingSession = {
        sessionId: `session_${Date.now()}`,
        userId,
        phoneNumber,
        devices: [],
        activeDeviceId: '',
      };
      console.log('🆕 First-time login - creating new session');
    }

    // Add the new device as the ONLY active device
    const newDevice: DeviceInfo = {
      deviceId: deviceInfo.deviceId,
      deviceName: deviceInfo.deviceName,
      platform: deviceInfo.platform,
      lastActive: new Date().toISOString(),
      isActive: true,
    };

    existingSession.devices.push(newDevice);
    existingSession.activeDeviceId = deviceInfo.deviceId;
    existingSession.sessionId = `session_${Date.now()}`;

    // Save the updated session
    mockSessions.set(userId, existingSession);

    console.log('✅ New device activated:', deviceInfo.deviceName);
    console.log('🔑 New session ID:', existingSession.sessionId);

    // Return confirmation message for the new device ONLY
    // This message appears ONLY on the new device
    return {
      success: true,
      sessionId: existingSession.sessionId,
      message: `You're now logged in here on ${deviceInfo.deviceName}`,
      previousDevicesLoggedOut: previousDevicesCount,
    };
  },

  /**
   * ONB-1.7: Check if the current session is still valid
   * This is called periodically by the app to check if it's been
   * silently logged out due to a new device login
   */
  async checkSessionValidity({ 
    userId, 
    deviceId 
  }: { 
    userId: string; 
    deviceId: string; 
  }): Promise<{ isValid: boolean; message?: string }> {
    await delay(200);

    const session = mockSessions.get(userId);
    if (!session) {
      return { isValid: false, message: 'Session not found' };
    }

    const device = session.devices.find(d => d.deviceId === deviceId);
    if (!device) {
      return { isValid: false, message: 'Device not found in session' };
    }

    // If the device is not active, it's been logged out
    if (!device.isActive) {
      return { 
        isValid: false, 
        message: 'Session expired - logged in on another device' 
      };
    }

    return { isValid: true };
  },

  async createProfile({ phoneNumber, name, photo, about }: CreateProfileParams): Promise<CreateProfileResult> {
    await delay(600);
    
    console.log('📝 Creating profile for:', phoneNumber);
    
    if (!name || !name.trim()) {
      throw new Error('Name is required and cannot be empty');
    }
    
    const existing = mockProfiles.get(phoneNumber);
    if (existing) {
      throw new Error('User already exists with this phone number');
    }
    
    const userId = `user_${Date.now()}`;
    const profile: GetProfileResult = {
      id: userId,
      name: name.trim(),
      photo: photo || undefined,
      about: about || 'Hey there! I\'m using ONB',
      phoneNumber,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    mockProfiles.set(phoneNumber, profile);
    console.log('✅ Profile created successfully. UserId:', userId);
    
    return {
      success: true,
      userId,
      profile,
    };
  },

  async getProfile({ userId }: GetProfileParams): Promise<GetProfileResult> {
    await delay(300);
    
    for (const [phoneNumber, profile] of mockProfiles) {
      if (profile.id === userId) {
        return { ...profile };
      }
    }
    
    throw new Error('User not found');
  },

  async updateProfile({ userId, name, photo, about }: UpdateProfileParams): Promise<UpdateProfileResult> {
    await delay(500);
    
    for (const [phoneNumber, profile] of mockProfiles) {
      if (profile.id === userId) {
        const updated: GetProfileResult = {
          ...profile,
          name: name !== undefined ? name.trim() || profile.name : profile.name,
          photo: photo !== undefined ? photo : profile.photo,
          about: about !== undefined ? about.trim() || profile.about : profile.about,
          updatedAt: new Date().toISOString(),
        };
        mockProfiles.set(phoneNumber, updated);
        
        return {
          success: true,
          profile: updated,
        };
      }
    }
    
    throw new Error('User not found');
  },

  // Utility function to get session info (for testing)
  _getSession(userId: string): SessionInfo | undefined {
    return mockSessions.get(userId);
  },

  // Utility function to reset sessions (for testing)
  _resetSessions(): void {
    mockSessions.clear();
  },
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}