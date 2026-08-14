// hooks/useSession.ts
import { useState, useEffect, useRef } from 'react';
import { onboardingApi } from '@/api/onboardingApi';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Generate a unique device ID
const getDeviceId = (): string => {
  // In production, use a more robust method like expo-device
  return `device_${Date.now()}_${Math.random().toString(36).substring(7)}`;
};

const getDeviceName = (): string => {
  // In production, use expo-device to get actual device name
  const platform = Platform.OS === 'ios' ? 'iPhone' : 'Android';
  return `${platform} ${Platform.OS === 'ios' ? '' : 'Device'}`;
};

export const useSession = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [sessionValid, setSessionValid] = useState(true);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  
  const checkInterval = useRef<NodeJS.Timeout | null>(null);

  // Initialize session on mount
  useEffect(() => {
    initializeSession();
    
    // Check session validity every 30 seconds
    checkInterval.current = setInterval(checkSession, 30000);
    
    return () => {
      if (checkInterval.current) {
        clearInterval(checkInterval.current);
      }
    };
  }, []);

  const initializeSession = async () => {
    try {
      // Check if we have a stored session
      const storedUserId = await SecureStore.getItemAsync('userId');
      const storedDeviceId = await SecureStore.getItemAsync('deviceId');
      
      if (storedUserId && storedDeviceId) {
        setUserId(storedUserId);
        setDeviceId(storedDeviceId);
        await checkSession();
      }
    } catch (error) {
      console.error('Failed to initialize session:', error);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * ONB-1.7: Check if the current session is still valid
   * This is called periodically to detect if we've been silently logged out
   */
  const checkSession = async () => {
    if (!userId || !deviceId) return;

    try {
      const result = await onboardingApi.checkSessionValidity({
        userId,
        deviceId,
      });

      if (!result.isValid) {
        // Silent logout - we've been logged out on another device
        console.log('🔒 Session invalidated - logged in on another device');
        setSessionValid(false);
        setSessionMessage(result.message || 'Logged in on another device');
        
        // Clear local session
        await SecureStore.deleteItemAsync('userId');
        await SecureStore.deleteItemAsync('deviceId');
        setIsAuthenticated(false);
        setUserId(null);
        
        // Redirect to login
        router.replace('/phone-entry');
      } else {
        setSessionValid(true);
        setSessionMessage(null);
      }
    } catch (error) {
      console.error('Failed to check session:', error);
    }
  };

  /**
   * ONB-1.7: Create a new session for the current device
   * This handles the "new-device login handoff"
   */
  const createSession = async (userId: string, phoneNumber: string) => {
    try {
      const deviceId = getDeviceId();
      const deviceName = getDeviceName();
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';

      const result = await onboardingApi.handleLoginHandoff({
        phoneNumber,
        userId,
        deviceInfo: {
          deviceId,
          deviceName,
          platform,
        },
      });

      // Store session locally
      await SecureStore.setItemAsync('userId', userId);
      await SecureStore.setItemAsync('deviceId', deviceId);
      
      setUserId(userId);
      setDeviceId(deviceId);
      setIsAuthenticated(true);
      setSessionValid(true);
      setSessionMessage(result.message);

      // Return the confirmation message for the new device
      return result.message;
    } catch (error) {
      console.error('Failed to create session:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await SecureStore.deleteItemAsync('userId');
      await SecureStore.deleteItemAsync('deviceId');
      setIsAuthenticated(false);
      setUserId(null);
      setSessionValid(false);
      router.replace('/phone-entry');
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  return {
    isLoading,
    isAuthenticated,
    userId,
    deviceId,
    sessionValid,
    sessionMessage,
    createSession,
    checkSession,
    logout,
  };
};