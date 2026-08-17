// app/legal-acceptance.tsx
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const C = {
  bg: '#0B0F14',
  bg2: '#15171C',
  ink: '#3FC6B8',
  inkDim: '#9AA0AC',
  accent: '#3FC6B8',
  ringSoft: 'rgba(63,198,184,0.12)',
  borderSoft: '#2E323C',
  text: '#F3F3F4',
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

      <View style={styles.center}>
        <View style={styles.card}>
          <Text style={styles.title}>Before we continue</Text>
          <Text style={styles.sub}>Please review and accept our policies to proceed.</Text>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.summary}>
              By using this app, you agree to our Terms of Service and Privacy Policy.
              {'\n\n'}
              You confirm that you are 16 years of age or older.
            </Text>

            <View style={styles.divider} />

            <Pressable onPress={openTerms} style={styles.linkRow}>
              <Text style={styles.linkText}>Read Full Terms of Service</Text>
              <Text style={styles.linkArrow}>→</Text>
            </Pressable>

            <Pressable onPress={openPrivacy} style={styles.linkRow}>
              <Text style={styles.linkText}>Read Privacy Policy</Text>
              <Text style={styles.linkArrow}>→</Text>
            </Pressable>

            <View style={styles.spacer} />
          </ScrollView>

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

          <Pressable
            style={[styles.btn, !accepted && styles.btnDisabled]}
            disabled={!accepted}
            onPress={handleAccept}
          >
            <Text style={styles.btnText}>Continue</Text>
          </Pressable>
        </View>
      </View>
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
  backText: {
    color: C.ink,
    fontSize: 18,
    fontWeight: '500',
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
    paddingVertical: 16,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '92%',
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
    marginBottom: 20,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  scroll: {
    flexGrow: 0,
  },
  summary: {
    color: C.text,
    fontSize: 15,
    lineHeight: 24,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  divider: {
    height: 1,
    backgroundColor: C.borderSoft,
    marginVertical: 18,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
  },
  linkText: {
    color: C.accent,
    fontSize: 15,
    fontFamily: 'SpaceGrotesk-Medium',
  },
  linkArrow: {
    color: C.ink,
    fontSize: 16,
  },
  spacer: {
    height: 20,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    marginTop: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: C.accent,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: C.ink,
    borderColor: C.ink,
  },
  checkmark: {
    color: C.bg,
    fontSize: 15,
    fontWeight: '700',
  },
  checkboxLabel: {
    fontSize: 15,
    color: C.text,
    flex: 1,
    lineHeight: 24,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  btn: {
    backgroundColor: C.ink,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.35 },
  btnText: {
    color: C.bg,
    fontWeight: '600',
    fontSize: 14,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontFamily: 'SpaceGrotesk-Medium',
  },
});
