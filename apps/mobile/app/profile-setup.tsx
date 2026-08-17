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
  Modal,
  SafeAreaView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { onboardingApi } from '@/api/onboardingApi';
import { Ionicons } from '@expo/vector-icons';

const C = {
  bg: '#0B0F14',
  bg2: '#15171C',
  bg3: '#1A1D24',
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

const DEFAULT_ABOUT = "Hey there! I'm using ONB";

export default function ProfileSetupScreen() {
  const params = useLocalSearchParams<{ phoneNumber: string }>();
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [about, setAbout] = useState(DEFAULT_ABOUT);
  const [isLoading, setIsLoading] = useState(false);
  const [isPickingImage, setIsPickingImage] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);

  const hasVisibleChars = (text: string): boolean => {
    return text.trim().length > 0;
  };

  const isNameValid = hasVisibleChars(name);
  const isFormValid = isNameValid;

  const handleAboutChange = (text: string) => {
    setAbout(text);
  };

  const handleAboutBlur = () => {
    // Only set default if the field is completely empty
    if (!about.trim()) {
      setAbout(DEFAULT_ABOUT);
    }
  };

  const handlePickImage = async () => {
    try {
      setIsPickingImage(true);
      setShowPhotoModal(false);
      
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
      setShowPhotoModal(false);
      
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

  const handleRemovePhoto = () => {
    setPhoto(null);
    setShowPhotoModal(false);
  };

  const getInitials = (): string => {
    if (!name.trim()) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  const handleContinue = async () => {
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

      router.replace('/(tabs)');
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
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={C.ink} />
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

            {/* Profile Photo */}
            <View style={styles.photoSection}>
              <TouchableOpacity 
                style={styles.photoContainer} 
                onPress={() => setShowPhotoModal(true)}
                disabled={isLoading || isPickingImage}
                activeOpacity={0.7}
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
                    <ActivityIndicator size="large" color={C.ink} />
                  </View>
                )}
                <View style={styles.photoEditBadge}>
                  <Ionicons name="camera" size={14} color={C.bg} />
                </View>
              </TouchableOpacity>
              <Text style={styles.photoHint}>Tap to add or change photo</Text>
            </View>

            {/* Name Field */}
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
                <View style={styles.successContainer}>
                  <Ionicons name="checkmark-circle" size={14} color={C.success} />
                  <Text style={styles.successText}>Looks good</Text>
                </View>
              )}
            </View>

            {/* About Field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>About</Text>
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
                  onBlur={handleAboutBlur}
                  multiline
                  numberOfLines={2}
                  maxLength={80}
                />
              </View>
              <Text style={styles.charCount}>{about.length}/80</Text>
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

      {/* Photo Options Modal */}
      <Modal
        visible={showPhotoModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPhotoModal(false)}
      >
        <SafeAreaView style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            
            <Text style={styles.modalTitle}>Profile Photo</Text>
            <Text style={styles.modalSubtitle}>
              Choose a photo for your profile
            </Text>

            <View style={styles.modalOptions}>
              <TouchableOpacity 
                style={styles.modalOption} 
                onPress={handleTakePhoto}
                activeOpacity={0.6}
              >
                <View style={[styles.modalIconContainer, styles.cameraIcon]}>
                  <Ionicons name="camera" size={28} color={C.ink} />
                </View>
                <View style={styles.modalOptionText}>
                  <Text style={styles.modalOptionTitle}>Take Photo</Text>
                  <Text style={styles.modalOptionDesc}>Capture using camera</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={C.inkDim} />
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.modalOption} 
                onPress={handlePickImage}
                activeOpacity={0.6}
              >
                <View style={[styles.modalIconContainer, styles.galleryIcon]}>
                  <Ionicons name="images" size={28} color={C.ink} />
                </View>
                <View style={styles.modalOptionText}>
                  <Text style={styles.modalOptionTitle}>Choose from Gallery</Text>
                  <Text style={styles.modalOptionDesc}>Select from photos</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={C.inkDim} />
              </TouchableOpacity>

              {photo && (
                <TouchableOpacity 
                  style={[styles.modalOption, styles.removeOption]} 
                  onPress={handleRemovePhoto}
                  activeOpacity={0.6}
                >
                  <View style={[styles.modalIconContainer, styles.removeIcon]}>
                    <Ionicons name="trash-outline" size={24} color={C.fail} />
                  </View>
                  <View style={styles.modalOptionText}>
                    <Text style={[styles.modalOptionTitle, styles.removeText]}>
                      Remove Photo
                    </Text>
                    <Text style={styles.modalOptionDesc}>Delete current photo</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity 
              style={styles.modalCancel}
              onPress={() => setShowPhotoModal(false)}
              activeOpacity={0.6}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
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
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: C.ink,
    borderRadius: 16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.bg2,
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
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  successText: {
    color: C.success,
    fontSize: 11.5,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  charCount: {
    color: C.inkDim,
    fontSize: 10,
    textAlign: 'right',
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
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: C.bg2,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: C.borderSoft,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: C.text,
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: 'Fraunces-Black',
    marginBottom: 4,
  },
  modalSubtitle: {
    color: C.inkDim,
    fontSize: 14,
    textAlign: 'center',
    fontFamily: 'SpaceGrotesk-Regular',
    marginBottom: 24,
  },
  modalOptions: {
    gap: 12,
    marginBottom: 20,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: C.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  modalIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cameraIcon: {
    backgroundColor: 'rgba(63, 198, 184, 0.15)',
  },
  galleryIcon: {
    backgroundColor: 'rgba(107, 207, 127, 0.15)',
  },
  removeIcon: {
    backgroundColor: 'rgba(229, 72, 77, 0.15)',
  },
  modalOptionText: {
    flex: 1,
  },
  modalOptionTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: 'SpaceGrotesk-Medium',
  },
  modalOptionDesc: {
    color: C.inkDim,
    fontSize: 12,
    fontFamily: 'SpaceGrotesk-Regular',
    marginTop: 1,
  },
  removeOption: {
    borderColor: 'rgba(229, 72, 77, 0.3)',
  },
  removeText: {
    color: C.fail,
  },
  modalCancel: {
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  modalCancelText: {
    color: C.inkDim,
    fontSize: 16,
    fontWeight: '500',
    fontFamily: 'SpaceGrotesk-Medium',
  },
});
