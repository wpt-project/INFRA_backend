// app/profile-setup.tsx
import { router, useLocalSearchParams } from 'expo-router';
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

const COLORS = {
  bg: '#000000',
  inputBg: '#1C1C1E',
  border: '#2C2C2E',
  text: '#FFFFFF',
  textDim: '#8E8E93',
  accent: '#34C759',
  accentDim: 'rgba(52,199,89,0.12)',
  error: '#FF3B30',
  success: '#34C759',
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
      await onboardingApi.createProfile({
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
    <SafeAreaView style={styles.root}>
      {/* Back button */}
      <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={16}>
        <Ionicons name="chevron-back" size={28} color={COLORS.text} />
      </Pressable>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Set up your profile</Text>
              <Text style={styles.sub}>
                Tell us about yourself. You can always change this later.
              </Text>
            </View>

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
                    <ActivityIndicator size="large" color={COLORS.accent} />
                  </View>
                )}
                <View style={styles.photoEditBadge}>
                  <Ionicons name="camera" size={14} color={COLORS.bg} />
                </View>
              </TouchableOpacity>
            </View>

            {/* Name Field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>FULL NAME</Text>
              <View style={[
                styles.inputWrap,
                !isNameValid && name.length > 0 && styles.inputError
              ]}>
                <TextInput
                  style={styles.input}
                  value={name}
                  placeholder="Enter your full name"
                  placeholderTextColor={COLORS.textDim}
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
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
                  <Text style={styles.successText}>Looks good</Text>
                </View>
              )}
            </View>

            {/* About Field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>ABOUT</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={[styles.input, styles.aboutInput]}
                  value={about}
                  placeholder="What's on your mind?"
                  placeholderTextColor={COLORS.textDim}
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
                {isLoading ? 'Setting up…' : 'CONTINUE'}
              </Text>
            </Pressable>

            <Text style={styles.phoneNote}>
              Phone: {params.phoneNumber || 'your number'}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Photo Options Modal (unchanged) */}
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
                  <Ionicons name="camera" size={28} color={COLORS.accent} />
                </View>
                <View style={styles.modalOptionText}>
                  <Text style={styles.modalOptionTitle}>Take Photo</Text>
                  <Text style={styles.modalOptionDesc}>Capture using camera</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textDim} />
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.modalOption} 
                onPress={handlePickImage}
                activeOpacity={0.6}
              >
                <View style={[styles.modalIconContainer, styles.galleryIcon]}>
                  <Ionicons name="images" size={28} color={COLORS.accent} />
                </View>
                <View style={styles.modalOptionText}>
                  <Text style={styles.modalOptionTitle}>Choose from Gallery</Text>
                  <Text style={styles.modalOptionDesc}>Select from photos</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textDim} />
              </TouchableOpacity>

              {photo && (
                <TouchableOpacity 
                  style={[styles.modalOption, styles.removeOption]} 
                  onPress={handleRemovePhoto}
                  activeOpacity={0.6}
                >
                  <View style={[styles.modalIconContainer, styles.removeIcon]}>
                    <Ionicons name="trash-outline" size={24} color={COLORS.error} />
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
    top: Platform.OS === 'ios' ? 12 : 16,
    left: 16,
    zIndex: 10,
    padding: 8,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 70 : 50,
    paddingBottom: 40,
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  header: {
    marginBottom: 32,
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
  photoSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  photoContainer: {
    position: 'relative',
    marginBottom: 4,
  },
  photo: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  photoPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.inputBg,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitials: {
    fontSize: 32,
    color: COLORS.text,
    fontWeight: '600',
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
    backgroundColor: COLORS.accent,
    borderRadius: 16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.bg,
  },
  fieldGroup: {
    marginBottom: 24,
  },
  label: {
    color: COLORS.textDim,
    fontSize: 12,
    letterSpacing: 1,
    fontWeight: '500',
    marginBottom: 8,
  },
  inputWrap: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    backgroundColor: COLORS.inputBg,
    overflow: 'hidden',
  },
  inputError: {
    borderColor: COLORS.error,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: COLORS.text,
    fontSize: 16,
    minHeight: 48,
  },
  aboutInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  errorText: {
    color: COLORS.error,
    fontSize: 12,
    marginTop: 4,
  },
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  successText: {
    color: COLORS.success,
    fontSize: 12,
    fontWeight: '500',
  },
  charCount: {
    color: COLORS.textDim,
    fontSize: 11,
    textAlign: 'right',
    marginTop: 4,
  },
  btn: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
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
  phoneNote: {
    color: COLORS.textDim,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  // Modal styles (unchanged, only updated colors)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.inputBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  modalSubtitle: {
    color: COLORS.textDim,
    fontSize: 14,
    textAlign: 'center',
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
    backgroundColor: COLORS.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    backgroundColor: COLORS.accentDim,
  },
  galleryIcon: {
    backgroundColor: COLORS.accentDim,
  },
  removeIcon: {
    backgroundColor: 'rgba(255,59,48,0.15)',
  },
  modalOptionText: {
    flex: 1,
  },
  modalOptionTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '500',
  },
  modalOptionDesc: {
    color: COLORS.textDim,
    fontSize: 12,
    marginTop: 1,
  },
  removeOption: {
    borderColor: 'rgba(255,59,48,0.3)',
  },
  removeText: {
    color: COLORS.error,
  },
  modalCancel: {
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalCancelText: {
    color: COLORS.textDim,
    fontSize: 16,
    fontWeight: '500',
  },
});
