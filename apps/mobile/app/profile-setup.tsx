// app/profile-setup.tsx
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  ScrollView,
  Alert,
  Image,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { onboardingApi } from '@/api/onboardingApi';

const C = {
  bg: '#0a0a0b',
  bg2: '#111113',
  ink: '#c27b10',
  inkDim: 'rgba(243,241,236,0.5)',
  accent: '#c9b48b',
  ring: 'rgba(255,174,13,0.445)',
  ringSoft: 'rgba(201,180,139,0.12)',
  borderSoft: 'rgba(201,180,139,0.22)',
  text: '#f3f1ec',
  fail: '#e2684a',
  success: '#6bcf7f',
};

// Default values
const DEFAULT_ABOUT = 'Hey there! I\'m using ONB';

export default function ProfileSetupScreen() {
  const params = useLocalSearchParams<{ phoneNumber: string }>();
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [about, setAbout] = useState(DEFAULT_ABOUT);
  const [isLoading, setIsLoading] = useState(false);
  const [isPickingImage, setIsPickingImage] = useState(false);

  // Validation: check for actual visible characters
  const hasVisibleChars = (text: string): boolean => {
    return text.trim().length > 0;
  };

  const isNameValid = hasVisibleChars(name);
  const isFormValid = isNameValid;

  // About field handler - reverts to default if cleared
  const handleAboutChange = (text: string) => {
    // If text is empty or only whitespace, revert to default
    if (!text.trim()) {
      setAbout(DEFAULT_ABOUT);
    } else {
      setAbout(text);
    }
  };

  // Photo picker handlers
  const handlePickImage = async () => {
    try {
      setIsPickingImage(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        setPhoto(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    } finally {
      setIsPickingImage(false);
    }
  };

  const handleTakePhoto = async () => {
    try {
      setIsPickingImage(true);
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant camera permissions to take a photo.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        setPhoto(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    } finally {
      setIsPickingImage(false);
    }
  };

  const showPhotoOptions = () => {
    Alert.alert(
      'Profile Photo',
      'Choose a photo for your profile',
      [
        { text: 'Take Photo', onPress: handleTakePhoto },
        { text: 'Choose from Library', onPress: handlePickImage },
        { text: 'Remove Photo', onPress: () => setPhoto(null), style: 'destructive' },
        { text: 'Cancel', style: 'cancel' },
      ],
      { userInterfaceStyle: 'dark' }
    );
  };

  // Get initials for default avatar
  const getInitials = (): string => {
    if (!name.trim()) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  // Submit handler
  const handleContinue = async () => {
    // Validate name has visible characters
    if (!isFormValid) {
      Alert.alert('Name Required', 'Please enter your name to continue.');
      return;
    }

    setIsLoading(true);

    try {
      const result = await onboardingApi.createProfile({
        phoneNumber: params.phoneNumber || '',
        name: name.trim(),
        photo: photo || undefined,
        about: about.trim() || DEFAULT_ABOUT,
      });

      // Success - navigate to main app
      router.replace('/(tabs)'); // Adjust to your main app route
    } catch (error: any) {
      Alert.alert(
        'Error', 
        error.message || 'Failed to set up profile. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={[C.bg2, C.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 0.45 }}
      style={styles.root}
    >
      {/* Header */}
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
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Text style={styles.title}>Set up your profile</Text>
            <Text style={styles.sub}>
              Tell us about yourself. You can always change this later.
            </Text>

            {/* Profile Photo - Optional */}
            <View style={styles.photoSection}>
              <TouchableOpacity 
                style={styles.photoContainer} 
                onPress={showPhotoOptions}
                disabled={isLoading || isPickingImage}
              >
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.photo} />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Text style={styles.photoInitials}>{getInitials()}</Text>
                  </View>
                )}
                {(isPickingImage || isLoading) && (
                  <View style={styles.photoLoading}>
                    <ActivityIndicator size="small" color={C.ink} />
                  </View>
                )}
                <View style={styles.photoEditBadge}>
                  <Text style={styles.photoEditIcon}>📷</Text>
                </View>
              </TouchableOpacity>
              <Text style={styles.photoHint}>Tap to add a photo (optional)</Text>
            </View>

            {/* Name Field - Required */}
            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Full Name</Text>
                <Text style={styles.required}>required</Text>
              </View>
              <View style={[
                styles.inputWrap,
                !isNameValid && name.length > 0 && styles.inputError
              ]}>
                <TextInput
                  style={styles.input}
                  value={name}
                  placeholder="Enter your full name"
                  placeholderTextColor={C.inkDim}
                  autoCapitalize="words"
                  autoComplete="name"
                  returnKeyType="next"
                  editable={!isLoading}
                  onChangeText={setName}
                />
              </View>
              {name.length > 0 && !isNameValid && (
                <Text style={styles.errorText}>Name cannot be empty or only spaces</Text>
              )}
              {isNameValid && name.length > 0 && (
                <Text style={styles.successText}>✓ Looks good</Text>
              )}
            </View>

            {/* About/Status Field - Pre-filled, editable, can't be empty */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>About / Status</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={[styles.input, styles.aboutInput]}
                  value={about}
                  placeholder="What's on your mind?"
                  placeholderTextColor={C.inkDim}
                  autoCapitalize="sentences"
                  returnKeyType="done"
                  editable={!isLoading}
                  onChangeText={handleAboutChange}
                  multiline
                  numberOfLines={2}
                  maxLength={80}
                />
              </View>
              <Text style={styles.charCount}>{about.length}/80</Text>
              <Text style={styles.hint}>
                Can't be fully empty - it'll revert to default if you clear it
              </Text>
            </View>

            {/* Submit Button */}
            <Pressable
              style={[styles.btn, (!isFormValid || isLoading) && styles.btnDisabled]}
              disabled={!isFormValid || isLoading}
              onPress={handleContinue}
            >
              <Text style={styles.btnText}>
                {isLoading ? 'Setting up…' : 'Continue'}
              </Text>
            </Pressable>

            <Text style={styles.phoneNote}>
              Phone: {params.phoneNumber || 'your number'}
            </Text>
          </View>
        </ScrollView>
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
    paddingHorizontal: 24,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 12,
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
  photoSection: {
    alignItems: 'center',
    marginBottom: 28,
  },
  photoContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  photo: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: C.ring,
  },
  photoPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: C.bg,
    borderWidth: 2,
    borderColor: C.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitials: {
    fontSize: 32,
    color: C.ink,
    fontFamily: 'Fraunces-Black',
  },
  photoLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 50,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: C.ink,
    borderRadius: 14,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.bg2,
  },
  photoEditIcon: {
    fontSize: 14,
  },
  photoHint: {
    color: C.inkDim,
    fontSize: 12,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  fieldGroup: {
    marginBottom: 20,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    color: C.accent,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    fontFamily: 'SpaceGrotesk-Medium',
  },
  required: {
    color: C.ink,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: 'SpaceGrotesk-Regular',
  },
  inputWrap: {
    borderWidth: 1.5,
    borderColor: C.borderSoft,
    borderRadius: 12,
    backgroundColor: C.bg,
    overflow: 'hidden',
  },
  inputError: {
    borderColor: C.fail,
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: C.text,
    fontSize: 15,
    fontFamily: 'SpaceGrotesk-Regular',
    minHeight: 48,
  },
  aboutInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  errorText: {
    color: C.fail,
    fontSize: 11.5,
    marginTop: 4,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  successText: {
    color: C.success,
    fontSize: 11.5,
    marginTop: 4,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  charCount: {
    color: C.inkDim,
    fontSize: 10,
    textAlign: 'right',
    marginTop: 4,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  hint: {
    color: C.inkDim,
    fontSize: 11,
    marginTop: 4,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  btn: {
    backgroundColor: C.ink,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
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
  phoneNote: {
    color: C.inkDim,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 14,
    fontFamily: 'SpaceGrotesk-Regular',
  },
});