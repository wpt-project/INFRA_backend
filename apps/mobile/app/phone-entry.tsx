// app/phone-entry.tsx
import { onboardingApi } from '@/api/onboardingApi';
import { COUNTRIES, type Country } from '@/constants/countries';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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
};

const INDIA = COUNTRIES.find((c) => c.iso === 'IN') ?? COUNTRIES[0];

function formatDigits(digits: string, format: number[] | null): string {
  if (!format || !digits) return digits;
  const parts: string[] = [];
  let i = 0;
  for (const g of format) {
    if (i >= digits.length) break;
    parts.push(digits.slice(i, i + g));
    i += g;
  }
  if (i < digits.length) parts.push(digits.slice(i));
  return parts.join(' ');
}

function lengthLabel(lengths: number[]): string {
  if (lengths.length === 1) return `${lengths[0]} digits`;
  return `${lengths[0]}–${lengths[lengths.length - 1]} digits`;
}

export default function PhoneEntryScreen() {
  const [selected, setSelected] = useState<Country>(INDIA);
  const [phone, setPhone] = useState('');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.replace(/[^0-9]/g, '').includes(q.replace(/[^0-9]/g, '')) ||
        c.iso.toLowerCase() === q,
    );
  }, [query]);

  const digits = phone.replace(/\D/g, '');
  const maxLen = selected.lengths[selected.lengths.length - 1];
  const valid = digits.length > 0 && selected.lengths.includes(digits.length);
  const placeholder = selected.format
    ? selected.format.map((g) => 'X'.repeat(g)).join(' ')
    : 'Enter your number';

  const select = (c: Country) => {
    setSelected(c);
    setOpen(false);
    setQuery('');
    const d = phone.replace(/\D/g, '').slice(0, c.lengths[c.lengths.length - 1]);
    setPhone(formatDigits(d, c.format));
  };

  const handlePhoneChange = (text: string) => {
    let d = text.replace(/\D/g, '');
    if (d.length > maxLen) d = d.slice(0, maxLen);
    setPhone(formatDigits(d, selected.format));
  };

  const handleContinue = async () => {
    const fullNumber = selected.dial + digits;

    if (!valid) {
      return;
    }

    setIsLoading(true);

    try {
      console.log('📱 Sending OTP for:', fullNumber);
      await onboardingApi.sendOtp({ phoneNumber: fullNumber });
      
      router.push({
        pathname: '/legal-acceptance',
        params: { phoneNumber: fullNumber },
      });
    } catch {
      Alert.alert('Error', 'Failed to send verification code. Please try again.');
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
        <Text style={styles.topLabel}>ONB</Text>
        <View style={styles.topSpacer} />
        <Text style={[styles.topLabel, { color: C.inkDim }]}>Version 1.0</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.center}
      >
        <View style={styles.card}>
          <Text style={styles.title}>What&apos;s your number?</Text>
          <Text style={styles.sub}>We&apos;ll send a one-time code to verify it&apos;s you.</Text>

          <Text style={styles.label}>Phone number</Text>
          <View style={styles.row}>
            <Pressable style={styles.cc} onPress={() => setOpen(true)} accessibilityRole="button">
              <Text style={styles.ccFlag}>{selected.flag}</Text>
              <Text style={styles.ccCode}>{selected.dial}</Text>
            </Pressable>
            <TextInput
              style={styles.num}
              value={phone}
              keyboardType="phone-pad"
              placeholder={placeholder}
              placeholderTextColor={C.inkDim}
              editable={!isLoading}
              onChangeText={handlePhoneChange}
            />
          </View>
          {phone.length > 0 && !valid && (
            <Text style={styles.error}>
              Enter a valid {selected.name} number ({lengthLabel(selected.lengths)})
            </Text>
          )}
          <Text style={styles.note}>
            We&apos;ll send the code to {selected.flag} {selected.dial} {phone.trim() || 'your number'}.
          </Text>

          <Pressable
            style={[styles.btn, (!valid || isLoading) && styles.btnDisabled]}
            disabled={!valid || isLoading}
            onPress={handleContinue}
          >
            <Text style={styles.btnText}>{isLoading ? 'Sending…' : 'Send code'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <Pressable style={styles.overlayBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Select country</Text>
            <TextInput
              style={styles.search}
              value={query}
              placeholder="Search country or code…"
              placeholderTextColor={C.inkDim}
              autoFocus
              onChangeText={setQuery}
            />
            <FlatList
              style={styles.list}
              data={filtered}
              keyExtractor={(item) => item.iso}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.empty}>No countries match</Text>}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.rowItem, item.iso === selected.iso && styles.rowItemActive]}
                  onPress={() => select(item)}
                >
                  <Text style={styles.rowFlag}>{item.flag}</Text>
                  <Text
                    style={[styles.rowName, item.iso === selected.iso && styles.rowNameActive]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text style={styles.rowCode}>{item.dial}</Text>
                </Pressable>
              )}
            />
          </View>
        </View>
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
    fontSize: 32,
    lineHeight: 36,
    marginBottom: 12,
    fontFamily: 'Fraunces-Black',
  },
  sub: {
    color: C.inkDim,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 32,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  label: {
    color: C.accent,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
    fontFamily: 'SpaceGrotesk-Medium',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  cc: {
    minWidth: 104,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  ccFlag: { fontSize: 16 },
  ccCode: { color: C.text, fontSize: 14, fontFamily: 'SpaceGrotesk-Medium' },
  num: {
    flex: 1,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: C.text,
    fontSize: 16,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  error: {
    color: C.fail,
    fontSize: 11.5,
    marginTop: 8,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  note: {
    color: C.inkDim,
    fontSize: 11,
    marginTop: 10,
    lineHeight: 16,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  btn: {
    marginTop: 28,
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
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlayBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  sheet: {
    maxHeight: '78%',
    backgroundColor: C.bg2,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: C.borderSoft,
    paddingBottom: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.ring,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  sheetTitle: {
    color: C.ink,
    fontSize: 18,
    fontFamily: 'SpaceGrotesk-Medium',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  search: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 12,
    color: C.text,
    fontSize: 14,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  list: { paddingHorizontal: 8 },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
  },
  rowItemActive: { backgroundColor: C.ringSoft },
  rowFlag: { fontSize: 16 },
  rowName: {
    flex: 1,
    color: C.text,
    fontSize: 14.5,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  rowNameActive: { color: C.accent },
  rowCode: { color: C.inkDim, fontSize: 13, fontFamily: 'SpaceGrotesk-Regular' },
  empty: {
    color: C.inkDim,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 28,
    fontFamily: 'SpaceGrotesk-Regular',
  },
});
