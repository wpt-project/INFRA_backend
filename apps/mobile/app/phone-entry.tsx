// app/phone-entry.tsx
import { onboardingApi } from '@/api/onboardingApi';
import { COUNTRIES, type Country } from '@/constants/countries';
import { router } from 'expo-router';
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
  SafeAreaView,
} from 'react-native';

const C = {
  bg: '#000000',
  bg2: '#1C1C1E',
  ink: '#FFFFFF',
  inkDim: '#8E8E93',
  accent: '#34C759',
  ring: 'rgba(52,199,89,0.445)',
  ringSoft: 'rgba(52,199,89,0.12)',
  borderSoft: '#2C2C2E',
  text: '#FFFFFF',
  fail: '#FF3B30',
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
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={styles.content}>
          <Text style={styles.title}>What&apos;s your number?</Text>
          <Text style={styles.sub}>
            We&apos;ll send a one-time code to verify it&apos;s you.
          </Text>

          <View style={styles.inputSection}>
            <Text style={styles.label}>PHONE NUMBER</Text>
            <View style={styles.row}>
              <Pressable 
                style={styles.cc} 
                onPress={() => setOpen(true)} 
                accessibilityRole="button"
              >
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
              We&apos;ll send the code to {selected.dial} {phone.trim() || 'your number'}.
            </Text>
          </View>

          <Pressable
            style={[styles.btn, (!valid || isLoading) && styles.btnDisabled]}
            disabled={!valid || isLoading}
            onPress={handleContinue}
          >
            <Text style={styles.btnText}>
              {isLoading ? 'Sending…' : 'SEND CODE'}
            </Text>
          </Pressable>

          <Text style={styles.footerText}>
            Your number is safe with us.{'\n'}
            We never share it with others.
          </Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
    justifyContent: 'space-between',
  },
  title: {
    color: C.ink,
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  sub: {
    color: C.inkDim,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 40,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  inputSection: {
    flex: 1,
  },
  label: {
    color: C.inkDim,
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 8,
    fontWeight: '500',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  cc: {
    minWidth: 90,
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ccFlag: { 
    fontSize: 18,
  },
  ccCode: { 
    color: C.text, 
    fontSize: 16, 
    fontWeight: '500',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  num: {
    flex: 1,
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: C.text,
    fontSize: 16,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  error: {
    color: C.fail,
    fontSize: 13,
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  note: {
    color: C.inkDim,
    fontSize: 13,
    marginTop: 12,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  btn: {
    marginTop: 20,
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnDisabled: { 
    opacity: 0.5,
  },
  btnText: {
    color: C.bg,
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  footerText: {
    color: C.inkDim,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 32,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
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
    fontWeight: '600',
    paddingHorizontal: 20,
    paddingBottom: 12,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
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
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  list: { 
    paddingHorizontal: 8,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
  },
  rowItemActive: { 
    backgroundColor: C.ringSoft,
  },
  rowFlag: { 
    fontSize: 18,
  },
  rowName: {
    flex: 1,
    color: C.text,
    fontSize: 15,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  rowNameActive: { 
    color: C.accent,
  },
  rowCode: { 
    color: C.inkDim, 
    fontSize: 14, 
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  empty: {
    color: C.inkDim,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 28,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
});
