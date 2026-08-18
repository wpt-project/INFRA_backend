// app/legal-acceptance.tsx
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  SafeAreaView,
} from 'react-native';

const COLORS = {
  bg: '#000000',
  cardBg: '#1C1C1E',
  border: '#2C2C2E',
  text: '#FFFFFF',
  textDim: '#8E8E93',
  accent: '#34C759',
  accentDim: 'rgba(52,199,89,0.12)',
};

export default function LegalAcceptanceScreen() {
  const params = useLocalSearchParams<{ phoneNumber: string }>();
  const [accepted, setAccepted] = useState(false);

  const handleAccept = () => {
    router.push({
      pathname: '/otp-entry',
      params: { phoneNumber: params.phoneNumber },
    });
  };

  const openTerms = () => {
    Linking.openURL('https://example.com/terms');
  };

  const openPrivacy = () => {
    Linking.openURL('https://example.com/privacy');
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Back arrow at top-left */}
      <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={16}>
        <Text style={styles.backText}>‹</Text>
      </Pressable>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          {/* Header outside card */}
          <View style={styles.header}>
            <Text style={styles.title}>Before we continue</Text>
            <Text style={styles.sub}>
              Please review and accept our policies to proceed.
            </Text>
          </View>

          {/* Card with all content */}
          <View style={styles.card}>
            {/* Bullet list */}
            <View style={styles.bulletList}>
              <Text style={styles.bulletItem}>
                • By using this app, you agree to our Terms of Service and Privacy Policy.
              </Text>
              <Text style={styles.bulletItem}>
                • You confirm that you are 16 years of age or older.
              </Text>
            </View>

            {/* Divider */}
            <View style={styles.divider} />

            {/* Links with arrows */}
            <Pressable onPress={openTerms} style={styles.linkRow}>
              <Text style={styles.linkText}>Terms of Service</Text>
              <Text style={styles.linkArrow}>›</Text>
            </Pressable>

            <View style={styles.divider} />

            <Pressable onPress={openPrivacy} style={styles.linkRow}>
              <Text style={styles.linkText}>Privacy Policy</Text>
              <Text style={styles.linkArrow}>›</Text>
            </Pressable>

            <View style={styles.divider} />

            {/* Checkbox */}
            <Pressable
              style={styles.checkboxRow}
              onPress={() => setAccepted(!accepted)}
              hitSlop={8}
            >
              <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
                {accepted && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>
                I accept the Terms of Service and Privacy Policy
              </Text>
            </Pressable>

            {/* Button */}
            <Pressable
              style={[styles.btn, !accepted && styles.btnDisabled]}
              disabled={!accepted}
              onPress={handleAccept}
            >
              <Text style={styles.btnText}>CONTINUE</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
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
  backText: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '300',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 40,
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  header: {
    marginBottom: 24,
  },
  title: {
    color: COLORS.text,
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 6,
  },
  sub: {
    color: COLORS.textDim,
    fontSize: 16,
    lineHeight: 22,
  },
  card: {
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 24,
  },
  bulletList: {
    marginBottom: 16,
  },
  bulletItem: {
    color: COLORS.text,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 10,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 12,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  linkText: {
    color: COLORS.accent,
    fontSize: 16,
    fontWeight: '500',
  },
  linkArrow: {
    color: COLORS.textDim,
    fontSize: 18,
    fontWeight: '300',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  checkmark: {
    color: COLORS.bg,
    fontSize: 16,
    fontWeight: '700',
  },
  checkboxLabel: {
    flex: 1,
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 22,
  },
  btn: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
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
});
