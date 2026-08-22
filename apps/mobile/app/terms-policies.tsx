// app/terms-policies.tsx
import { Fonts } from '@/constants/typography';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
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
  borderSoft: '#2E323C',
  text: '#F3F3F4',
};

const TERMS_URL = 'https://example.com/terms';
const PRIVACY_URL = 'https://example.com/privacy';

export default function TermsPoliciesScreen() {
  const [accepted, setAccepted] = useState(false);

  const handleContinue = () => {
    if (!accepted) return;
    router.push('/phone-entry');
  };

  return (
    <LinearGradient
      colors={[C.bg2, C.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 0.45 }}
      style={styles.root}
    >
      <View style={styles.top}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={26} color={C.ink} />
        </Pressable>
      </View>

      <View style={styles.body}>
        <View style={styles.header}>
          <Text style={styles.title}>Before we continue</Text>
          <Text style={styles.sub}>
            Please review and accept our policies to proceed.
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.panel}>
            <View style={styles.panelRow}>
              <Ionicons name="document-text-outline" size={20} color={C.ink} style={styles.panelIcon} />
              <Text style={styles.panelText}>
                By using this app, you agree to our{' '}
                <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>
                  Terms of Service
                </Text>{' '}
                and{' '}
                <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>
                  Privacy Policy
                </Text>
              </Text>
            </View>

            <View style={styles.panelDivider} />

            <View style={styles.panelRow}>
              <Ionicons name="shield-checkmark-outline" size={20} color={C.ink} style={styles.panelIcon} />
              <Text style={styles.panelText}>
                You confirm that you are 16 years of age or older.
              </Text>
            </View>
          </View>

          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL(TERMS_URL)}
            hitSlop={8}
          >
            <Text style={styles.linkRowText}>Terms of Service</Text>
            <Ionicons name="chevron-forward" size={18} color={C.ink} />
          </Pressable>

          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL(PRIVACY_URL)}
            hitSlop={8}
          >
            <Text style={styles.linkRowText}>Privacy Policy</Text>
            <Ionicons name="chevron-forward" size={18} color={C.ink} />
          </Pressable>

          <Pressable
            style={styles.checkboxRow}
            onPress={() => setAccepted(!accepted)}
            hitSlop={8}
          >
            <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
              {accepted && <Ionicons name="checkmark" size={14} color={C.bg} />}
            </View>
            <Text style={styles.checkboxText}>
              I accept the{' '}
              <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>
                Privacy Policy
              </Text>
            </Text>
          </Pressable>
        </ScrollView>

        <View style={styles.bottomSection}>
          <Pressable
            style={[styles.btn, !accepted && styles.btnDisabled]}
            disabled={!accepted}
            onPress={handleContinue}
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
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: 8,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    paddingHorizontal: 28,
  },
  header: {
    marginTop: 24,
  },
  title: {
    color: C.text,
    fontSize: 28,
    lineHeight: 34,
    marginBottom: 8,
    fontFamily: Fonts.heading,
    fontWeight: '700',
  },
  sub: {
    color: C.inkDim,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: Fonts.body,
  },
  scroll: {
    paddingTop: 24,
  },
  panel: {
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  panelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  panelIcon: {
    marginTop: 1,
  },
  panelText: {
    flex: 1,
    color: C.inkDim,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: Fonts.body,
  },
  panelDivider: {
    height: 1,
    backgroundColor: C.borderSoft,
    marginVertical: 16,
  },
  link: {
    color: C.accent,
    fontFamily: Fonts.bodyMedium,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
  },
  linkRowText: {
    color: C.accent,
    fontSize: 15,
    fontFamily: Fonts.bodyMedium,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 28,
    marginBottom: 24,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: C.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  checkboxText: {
    flex: 1,
    color: C.inkDim,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.body,
  },
  bottomSection: {
    paddingBottom: Platform.OS === 'ios' ? 48 : 32,
  },
  btn: {
    backgroundColor: C.ink,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
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
    fontFamily: Fonts.bodyMedium,
  },
});
