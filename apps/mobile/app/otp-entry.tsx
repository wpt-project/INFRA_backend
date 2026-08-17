// app/otp-entry.tsx
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
  KeyboardAvoidingView,
  Animated,
  Easing,
} from 'react-native';
import { onboardingApi } from '@/api/onboardingApi';
import { useSession } from '@/hooks/useSession';

const C = {
  bg: '#0B0F14',
  bg2: '#15171C',
  ink: '#3FC6B8',
  inkDim: '#9AA0AC',
  accent: '#3FC6B8',
  ring: 'rgba(63,198,184,0.445)',
  ringSoft: 'rgba(63,198,184,0.12)',
  borderSoft: '#2E323C',
  text: '#F3F3F4',
  fail: '#E5484D',
  success: '#6bcf7f',
};

export default function OTPEntryScreen() {
  const params = useLocalSearchParams<{ phoneNumber: string }>();
  const { createSession } = useSession();
  
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [otpExpired, setOtpExpired] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const lockoutInterval = useRef<NodeJS.Timeout | null>(null);
  const resendInterval = useRef<NodeJS.Timeout | null>(null);
  const shakeAnimation = useRef(new Animated.Value(0)).current;
  const isVerifying = useRef(false);

  const OTP_EXPIRY_SECONDS = 300;
  const [otpExpiryTime, setOtpExpiryTime] = useState(Date.now() + OTP_EXPIRY_SECONDS * 1000);
  const [timeRemaining, setTimeRemaining] = useState(OTP_EXPIRY_SECONDS);

  // Countdown for OTP expiry
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((otpExpiryTime - Date.now()) / 1000));
      setTimeRemaining(remaining);
      
      if (remaining === 0) {
        setOtpExpired(true);
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [otpExpiryTime]);

  // Handle lockout countdown
  useEffect(() => {
    if (isLocked && lockoutSeconds > 0) {
      lockoutInterval.current = setInterval(() => {
        setLockoutSeconds((prev) => {
          if (prev <= 1) {
            setIsLocked(false);
            clearInterval(lockoutInterval.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (lockoutInterval.current) {
        clearInterval(lockoutInterval.current);
      }
    };
  }, [isLocked]);

  // Handle resend cooldown
  useEffect(() => {
    if (resendCooldown > 0) {
      resendInterval.current = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(resendInterval.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (resendInterval.current) {
        clearInterval(resendInterval.current);
      }
    };
  }, [resendCooldown]);

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnimation, {
        toValue: 1,
        duration: 100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnimation, {
        toValue: -1,
        duration: 100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnimation, {
        toValue: 0.5,
        duration: 100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnimation, {
        toValue: -0.5,
        duration: 100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnimation, {
        toValue: 0,
        duration: 100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start();
  }, [shakeAnimation]);

  const verifyOTP = useCallback(async (code: string) => {
    // Prevent multiple verification calls
    if (isVerifying.current) return;
    
    if (code.length !== 6) {
      setError('Please enter all 6 digits');
      shake();
      return;
    }

    if (otpExpired) {
      setError('This code has expired. Request a new one.');
      shake();
      return;
    }

    if (isLocked) {
      setError(`Too many attempts. Try again in ${lockoutSeconds}s`);
      return;
    }

    isVerifying.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const result = await onboardingApi.verifyOtp({
        phoneNumber: params.phoneNumber || '',
        code: code,
      });
      
      if (result.status === 'success') {
        const { exists, userId } = await onboardingApi.checkExistingUser({
          phoneNumber: params.phoneNumber || '',
        });
        
        if (exists && userId) {
          console.log('🔄 ONB-1.7: Existing user - processing login handoff');
          const message = await createSession(userId, params.phoneNumber || '');
          setConfirmationMessage(message);
          console.log('✅ ONB-1.7: Confirmation message shown on new device');
          setTimeout(() => {
            router.replace('/(tabs)');
          }, 1500);
        } else {
          console.log('🆕 New user - routing to profile setup');
          router.push({
            pathname: '/profile-setup',
            params: { phoneNumber: params.phoneNumber },
          });
        }
      } else if (result.status === 'wrong_code') {
        setError(`Incorrect code. ${result.attemptsRemaining} attempts left`);
        setAttemptsRemaining(result.attemptsRemaining);
        shake();
        setOtp(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      } else if (result.status === 'attempts_exhausted') {
        setIsLocked(true);
        setLockoutSeconds(30);
        setError('Too many attempts. Please wait 30 seconds.');
        setOtp(['', '', '', '', '', '']);
      } else if (result.status === 'locked_out') {
        setError(`Too many attempts. Try again in ${result.secondsRemaining}s`);
        setIsLocked(true);
        setLockoutSeconds(result.secondsRemaining);
      }
    } catch (err) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
      setTimeout(() => {
        isVerifying.current = false;
      }, 500);
    }
  }, [otpExpired, isLocked, lockoutSeconds, params.phoneNumber, createSession, shake]);

  const handleOtpChange = (text: string, index: number) => {
    const newOtp = [...otp];
    newOtp[index] = text.slice(-1);
    setOtp(newOtp);
    setError(null);
    setAttemptsRemaining(null);

    // Move to next input if text is entered
    if (text && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-verify when all digits are filled
    if (text) {
      const allFilled = newOtp.every(digit => digit !== '');
      if (allFilled && !isLoading && !isLocked && !otpExpired && !isVerifying.current) {
        // Get the code directly from the newOtp array
        const code = newOtp.join('');
        if (code.length === 6) {
          // Small delay to ensure UI updates before verification
          setTimeout(() => {
            verifyOTP(code);
          }, 100);
        }
      }
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyPress = () => {
    const code = otp.join('');
    verifyOTP(code);
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isResending) return;
    
    isVerifying.current = false;
    setIsResending(true);
    setError(null);
    setOtpExpired(false);
    setOtp(['', '', '', '', '', '']);
    setAttemptsRemaining(null);
    setIsLocked(false);
    setLockoutSeconds(0);
    setOtpExpiryTime(Date.now() + OTP_EXPIRY_SECONDS * 1000);
    setTimeRemaining(OTP_EXPIRY_SECONDS);

    try {
      await onboardingApi.sendOtp({
        phoneNumber: params.phoneNumber || '',
      });
      
      setResendCooldown(30);
      Alert.alert('Code Sent', 'A new verification code has been sent to your phone.');
      inputRefs.current[0]?.focus();
    } catch (err) {
      Alert.alert('Error', 'Failed to resend code. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isSubmitDisabled = isLoading || isLocked || otpExpired || otp.some(digit => digit === '');

  return (
    <LinearGradient
      colors={[C.bg2, C.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 0.45 }}
      style={styles.root}
    >
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.topLabel}>ONB</Text>
        <View style={styles.topSpacer} />
        <Text style={[styles.topLabel, { color: C.inkDim }]}>Version 1.0</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.center}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Enter verification code</Text>
          <Text style={styles.sub}>
            We sent a 6-digit code to {params.phoneNumber || 'your phone'}
          </Text>

          {confirmationMessage && (
            <View style={styles.confirmationBanner}>
              <Text style={styles.confirmationText}>✅ {confirmationMessage}</Text>
            </View>
          )}

          {otpExpired && (
            <View style={styles.expiryWarning}>
              <Text style={styles.expiryWarningText}>⚠️ Code expired. Request a new one.</Text>
            </View>
          )}

          <Animated.View 
            style={[
              styles.otpContainer,
              {
                transform: [{
                  translateX: shakeAnimation.interpolate({
                    inputRange: [-1, 0, 1],
                    outputRange: [-20, 0, 20],
                  })
                }]
              }
            ]}
          >
            {otp.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => inputRefs.current[index] = ref}
                style={[
                  styles.otpInput,
                  error && styles.otpInputError,
                  isLocked && styles.otpInputDisabled,
                  otpExpired && styles.otpInputDisabled,
                ]}
                value={digit}
                onChangeText={(text) => handleOtpChange(text, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
                keyboardType="number-pad"
                maxLength={1}
                editable={!isLoading && !isLocked && !otpExpired}
                autoFocus={index === 0}
                selectTextOnFocus
              />
            ))}
          </Animated.View>

          {error && (
            <Text style={[styles.errorText, isLocked && styles.errorLocked]}>
              {error}
            </Text>
          )}

          {!isLocked && !otpExpired && timeRemaining > 0 && (
            <Text style={styles.expiryTimer}>
              Code expires in {formatTime(timeRemaining)}
            </Text>
          )}

          {isLocked && (
            <View style={styles.lockoutContainer}>
              <Text style={styles.lockoutText}>
                Locked for {lockoutSeconds}s
              </Text>
              <View style={styles.lockoutBar}>
                <View 
                  style={[
                    styles.lockoutFill,
                    { width: `${((30 - lockoutSeconds) / 30) * 100}%` }
                  ]} 
                />
              </View>
            </View>
          )}

          <Pressable
            style={[styles.btn, isSubmitDisabled && styles.btnDisabled]}
            disabled={isSubmitDisabled}
            onPress={handleVerifyPress}
          >
            <Text style={styles.btnText}>
              {isLoading ? 'Verifying…' : 'Verify'}
            </Text>
          </Pressable>

          <View style={styles.resendContainer}>
            <Text style={styles.resendLabel}>Didn't receive a code?</Text>
            <Pressable
              onPress={handleResend}
              disabled={resendCooldown > 0 || isResending || isLoading}
            >
              <Text style={[
                styles.resendBtn,
                (resendCooldown > 0 || isResending) && styles.resendBtnDisabled
              ]}>
                {isResending ? 'Sending…' : 
                 resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 
                 'Resend code'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: 28,
  },
  backBtn: {
    padding: 4,
  },
  backText: {
    color: C.ink,
    fontSize: 18,
    fontWeight: '500',
  },
  topSpacer: {
    flex: 1,
  },
  topLabel: {
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: C.ink,
    fontFamily: 'SpaceGrotesk-Medium',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 20,
    padding: 28,
  },
  title: {
    color: C.ink,
    fontSize: 28,
    lineHeight: 32,
    marginBottom: 12,
    fontFamily: 'Fraunces-Black',
  },
  sub: {
    color: C.inkDim,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 28,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  confirmationBanner: {
    backgroundColor: C.success + '20',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.success + '40',
  },
  confirmationText: {
    color: C.success,
    fontSize: 14,
    fontFamily: 'SpaceGrotesk-Medium',
    textAlign: 'center',
  },
  expiryWarning: {
    backgroundColor: C.fail + '20',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.fail + '40',
  },
  expiryWarningText: {
    color: C.fail,
    fontSize: 13,
    fontFamily: 'SpaceGrotesk-Medium',
    textAlign: 'center',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 16,
  },
  otpInput: {
    flex: 1,
    backgroundColor: C.bg,
    borderWidth: 1.5,
    borderColor: C.borderSoft,
    borderRadius: 12,
    paddingVertical: 14,
    textAlign: 'center',
    color: C.text,
    fontSize: 24,
    fontFamily: 'SpaceGrotesk-Medium',
    minHeight: 56,
  },
  otpInputError: {
    borderColor: C.fail,
  },
  otpInputDisabled: {
    opacity: 0.4,
    borderColor: C.borderSoft,
  },
  errorText: {
    color: C.fail,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  errorLocked: {
    color: C.ring,
  },
  expiryTimer: {
    color: C.inkDim,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 16,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  lockoutContainer: {
    marginBottom: 16,
    alignItems: 'center',
  },
  lockoutText: {
    color: C.ring,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk-Medium',
    marginBottom: 6,
  },
  lockoutBar: {
    width: '100%',
    height: 4,
    backgroundColor: C.borderSoft,
    borderRadius: 2,
    overflow: 'hidden',
  },
  lockoutFill: {
    height: '100%',
    backgroundColor: C.ring,
    borderRadius: 2,
  },
  btn: {
    backgroundColor: C.ink,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  btnDisabled: {
    opacity: 0.35,
  },
  btnText: {
    color: C.bg,
    fontWeight: '600',
    fontSize: 14,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontFamily: 'SpaceGrotesk-Medium',
  },
  resendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  resendLabel: {
    color: C.inkDim,
    fontSize: 13,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  resendBtn: {
    color: C.ink,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk-Medium',
    paddingVertical: 4,
  },
  resendBtnDisabled: {
    color: C.inkDim,
    opacity: 0.5,
  },
});
