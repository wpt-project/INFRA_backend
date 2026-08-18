// app/otp-entry.tsx
import { router, useLocalSearchParams } from 'expo-router';
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
  SafeAreaView,
} from 'react-native';
import { onboardingApi } from '@/api/onboardingApi';
import { useSession } from '@/hooks/useSession';

const COLORS = {
  bg: '#000000',
  inputBg: '#1C1C1E',
  border: '#2C2C2E',
  text: '#FFFFFF',
  textDim: '#8E8E93',
  accent: '#34C759',
  error: '#FF3B30',
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
  const isVerifying = useRef(false);

  const OTP_EXPIRY_SECONDS = 300;
  const [otpExpiryTime, setOtpExpiryTime] = useState(Date.now() + OTP_EXPIRY_SECONDS * 1000);
  const [timeRemaining, setTimeRemaining] = useState(OTP_EXPIRY_SECONDS);

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
      if (lockoutInterval.current) clearInterval(lockoutInterval.current);
    };
  }, [isLocked]);

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
      if (resendInterval.current) clearInterval(resendInterval.current);
    };
  }, [resendCooldown]);

  const verifyOTP = useCallback(
    async (code: string) => {
      if (isVerifying.current) return;
      if (code.length !== 6) {
        setError('Please enter all 6 digits');
        return;
      }
      if (otpExpired) {
        setError('This code has expired. Request a new one.');
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
            const message = await createSession(userId, params.phoneNumber || '');
            setConfirmationMessage(message);
            setTimeout(() => router.replace('/(tabs)'), 1500);
          } else {
            router.push({
              pathname: '/profile-setup',
              params: { phoneNumber: params.phoneNumber },
            });
          }
        } else if (result.status === 'wrong_code') {
          setError(`Incorrect code. ${result.attemptsRemaining} attempts left`);
          setAttemptsRemaining(result.attemptsRemaining);
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
      } catch {
        Alert.alert('Error', 'Something went wrong. Please try again.');
      } finally {
        setIsLoading(false);
        setTimeout(() => {
          isVerifying.current = false;
        }, 500);
      }
    },
    [otpExpired, isLocked, lockoutSeconds, params.phoneNumber, createSession]
  );

  const handleOtpChange = (text: string, index: number) => {
    const newOtp = [...otp];
    newOtp[index] = text.slice(-1);
    setOtp(newOtp);
    setError(null);
    setAttemptsRemaining(null);

    if (text && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (text) {
      const allFilled = newOtp.every((digit) => digit !== '');
      if (allFilled && !isLoading && !isLocked && !otpExpired && !isVerifying.current) {
        const code = newOtp.join('');
        setTimeout(() => verifyOTP(code), 100);
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
      await onboardingApi.sendOtp({ phoneNumber: params.phoneNumber || '' });
      setResendCooldown(30);
      Alert.alert('Code Sent', 'A new verification code has been sent to your phone.');
      inputRefs.current[0]?.focus();
    } catch {
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

  const isSubmitDisabled = isLoading || isLocked || otpExpired || otp.some((d) => d === '');

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      {/* Back button */}
      <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={16}>
        <Text style={styles.backText}>‹</Text>
      </Pressable>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Enter verification code</Text>
            <Text style={styles.sub}>
              We sent a 6‑digit code to{' '}
              <Text style={styles.phoneNumber}>{params.phoneNumber || 'your phone'}</Text>
              <Text style={styles.editLink} onPress={() => router.back()}> Edit</Text>
            </Text>
          </View>

          {/* OTP Inputs */}
          <View style={styles.otpContainer}>
            {otp.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => (inputRefs.current[index] = ref)}
                style={[
                  styles.otpInput,
                  error && styles.otpInputError,
                  (isLocked || otpExpired) && styles.otpInputDisabled,
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
          </View>

          {error && (
            <Text style={[styles.errorText, isLocked && styles.errorLocked]}>
              {error}
            </Text>
          )}

          {!isLocked && !otpExpired && timeRemaining > 0 && (
            <Text style={styles.expiryTimer}>Code expires in {formatTime(timeRemaining)}</Text>
          )}

          {isLocked && (
            <View style={styles.lockoutContainer}>
              <Text style={styles.lockoutText}>Locked for {lockoutSeconds}s</Text>
              <View style={styles.lockoutBar}>
                <View
                  style={[
                    styles.lockoutFill,
                    { width: `${((30 - lockoutSeconds) / 30) * 100}%` },
                  ]}
                />
              </View>
            </View>
          )}

          {/* VERIFY Button */}
          <Pressable
            style={[styles.btn, isSubmitDisabled && styles.btnDisabled]}
            disabled={isSubmitDisabled}
            onPress={handleVerifyPress}
          >
            <Text style={styles.btnText}>
              {isLoading ? 'Verifying…' : 'VERIFY'}
            </Text>
          </Pressable>

          {/* Resend */}
          <View style={styles.resendContainer}>
            <Text style={styles.resendLabel}>Didn't receive a code?</Text>
            <Pressable
              onPress={handleResend}
              disabled={resendCooldown > 0 || isResending || isLoading}
            >
              <Text
                style={[
                  styles.resendBtn,
                  (resendCooldown > 0 || isResending) && styles.resendBtnDisabled,
                ]}
              >
                {isResending
                  ? 'Sending…'
                  : resendCooldown > 0
                  ? `Resend in ${resendCooldown}s`
                  : 'Resend code'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  backBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 16 : 20,
    left: 16,
    zIndex: 10,
    padding: 8,
  },
  backText: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '300',
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 80 : 60, // more top space
    paddingBottom: 60, // more bottom space
    justifyContent: 'center',
  },
  header: {
    marginBottom: 40, // more space after subtitle
  },
  title: {
    color: COLORS.text,
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 8,
  },
  sub: {
    color: COLORS.textDim,
    fontSize: 16,
    lineHeight: 22,
  },
  phoneNumber: {
    color: COLORS.text,
    fontWeight: '500',
  },
  editLink: {
    color: COLORS.accent,
    fontWeight: '500',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20, // more space after OTP fields
  },
  otpInput: {
    flex: 1,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 14,
    textAlign: 'center',
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '600',
    minHeight: 56,
    marginHorizontal: 4,
  },
  otpInputError: {
    borderColor: COLORS.error,
  },
  otpInputDisabled: {
    opacity: 0.4,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  errorLocked: {
    color: COLORS.accent,
  },
  expiryTimer: {
    color: COLORS.textDim,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32, // more space before verify button
  },
  lockoutContainer: {
    marginBottom: 32,
    alignItems: 'center',
  },
  lockoutText: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  lockoutBar: {
    width: '100%',
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  lockoutFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: 2,
  },
  btn: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 24, // more space after button
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: COLORS.bg,
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 1,
  },
  resendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  resendLabel: {
    color: COLORS.textDim,
    fontSize: 14,
  },
  resendBtn: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 4,
  },
  resendBtnDisabled: {
    color: COLORS.textDim,
    opacity: 0.5,
  },
});
