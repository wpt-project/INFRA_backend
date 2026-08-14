/**
 * OnboardingScreen.tsx
 *
 * React Native conversion of the "ONB — Tap to Proceed" HTML screen.
 *
 * Dependencies to install:
 *   expo install expo-linear-gradient expo-font
 *
 * Fonts (optional but matches the original design):
 *   Fraunces (italic + 300/400/800 weights) — https://fonts.google.com/specimen/Fraunces
 *   Space Grotesk (400/500/600) — https://fonts.google.com/specimen/Space+Grotesk
 *   Load them with expo-font (see loadFontsAsync below) or drop the .ttf files into
 *   your assets folder and load via useFonts(). Falls back to system serif/sans if
 *   not loaded.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
  Dimensions,
  GestureResponderEvent,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { useRouter } from 'expo-router';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const COLORS = {
  bg: '#0a0a0b',
  bg2: '#111113',
  ink: '#c27b10',
  inkDim: 'rgba(243,241,236,0.5)',
  inkFaint: '#c27b10',
  accent: '#c9b48b',
  ring: 'rgba(255, 174, 13, 0.445)',
  ringSoft: 'rgba(201,180,139,0.12)',
};

interface RippleData {
  id: number;
  x: number;
  y: number;
  size: number;
  progress: Animated.Value;
}

const Chevron = ({ style }: { style?: any }) => (
  <Animated.View style={style}>
    <Svg width={16} height={9} viewBox="0 0 16 9" fill="none">
      <Path
        d="M1 8L8 1L15 8"
        stroke={COLORS.inkDim}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  </Animated.View>
);

export default function OnboardingScreen() {
  const router = useRouter();
  const [ripples, setRipples] = useState<RippleData[]>([]);
  const rippleId = useRef(0);

  // breathing halo/ring animation
  const breathe = useRef(new Animated.Value(0)).current;
  // chevron rise animation (two staggered chevrons)
  const rise1 = useRef(new Animated.Value(0)).current;
  const rise2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 2250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 2250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  useEffect(() => {
    const makeRiseLoop = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: 0,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );

    const loop1 = makeRiseLoop(rise1, 0);
    const loop2 = makeRiseLoop(rise2, 180);
    loop1.start();
    loop2.start();
    return () => {
      loop1.stop();
      loop2.stop();
    };
  }, [rise1, rise2]);

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      const { locationX, locationY } = e.nativeEvent;
      const size = Math.max(SCREEN_W, SCREEN_H) * 1.4;
      const progress = new Animated.Value(0);
      const id = rippleId.current++;

      setRipples((prev) => [...prev, { id, x: locationX, y: locationY, size, progress }]);

      Animated.timing(progress, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      });

      setTimeout(() => {
        router.replace('/phone-entry');
      }, 250);
    },
    [router]
  );

  const haloScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] });
  const haloOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const ringScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const ringOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] });

  const rise1TranslateY = rise1.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const rise1Opacity = rise1.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.35] });
  const rise2TranslateY = rise2.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const rise2Opacity = rise2.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.18] }); // base 0.5 * rise opacity

  return (
    <Pressable style={styles.screenWrap} onPress={handlePress}>
      <LinearGradient
        colors={[COLORS.bg2, COLORS.bg]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.45 }}
        style={StyleSheet.absoluteFill}
      />

      {/* top bar */}
      <View style={styles.top}>
        <Text style={styles.topLabel}>ONB</Text>
        <Text style={[styles.topLabel, { color: COLORS.inkDim }]}>Version 1.0</Text>
      </View>

      {/* center wordmark */}
      <View style={styles.center} pointerEvents="none">
        <Animated.View
          style={[
            styles.halo,
            { transform: [{ scale: haloScale }], opacity: haloOpacity },
          ]}
        />
        <Animated.View
          style={[
            styles.ring,
            { transform: [{ scale: ringScale }], opacity: ringOpacity },
          ]}
        />
        <View style={styles.wordmarkWrap}>
          <Text style={styles.wordmark}>ONB</Text>
          <Text style={styles.tagline}>Begin quietly</Text>
        </View>
      </View>

      {/* bottom CTA */}
      <View style={styles.bottom} pointerEvents="none">
        <View style={styles.chevrons}>
          <Chevron
            style={{
              transform: [{ translateY: rise1TranslateY }],
              opacity: rise1Opacity,
            }}
          />
          <Chevron
            style={{
              transform: [{ translateY: rise2TranslateY }],
              opacity: rise2Opacity,
            }}
          />
        </View>
        <Text style={styles.ctaLabel}>Tap to proceed</Text>
        <View style={styles.ctaLine} />
      </View>

      {/* ripples */}
      {ripples.map((r) => {
        const scale = r.progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
        const opacity = r.progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
        return (
          <Animated.View
            key={r.id}
            pointerEvents="none"
            style={[
              styles.ripple,
              {
                width: r.size,
                height: r.size,
                borderRadius: r.size / 2,
                left: r.x - r.size / 2,
                top: r.y - r.size / 2,
                opacity,
                transform: [{ scale }],
              },
            ]}
          />
        );
      })}

    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenWrap: {
    flex: 1,
    backgroundColor: COLORS.bg,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: 28,
  },
  topLabel: {
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: COLORS.inkFaint,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: COLORS.ringSoft,
  },
  ring: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 1,
    borderColor: COLORS.ring,
  },
  wordmarkWrap: {
    alignItems: 'center',
  },
  wordmark: {
    fontFamily: 'Fraunces-Black',
    fontWeight: '800',
    fontSize: 64,
    letterSpacing: 9, // approximates 0.14em at 64px
    color: COLORS.ink,
  },
  tagline: {
    marginTop: 6,
    fontFamily: 'Fraunces-Italic',
    fontStyle: 'italic',
    opacity: 0.6,
    fontSize: 9,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: COLORS.inkDim,
  },
  bottom: {
    alignItems: 'center',
    gap: 14,
    paddingBottom: 56,
  },
  chevrons: {
    alignItems: 'center',
    gap: 2,
  },
  ctaLabel: {
    fontSize: 12,
    letterSpacing: 5,
    textTransform: 'uppercase',
    color: COLORS.inkDim,
    fontWeight: '500',
    fontFamily: 'SpaceGrotesk-Medium',
  },
  ctaLine: {
    width: 34,
    height: 1,
    backgroundColor: COLORS.inkFaint,
    marginTop: 2,
  },
  ripple: {
    position: 'absolute',
    backgroundColor: COLORS.ringSoft,
    borderWidth: 1,
    borderColor: COLORS.ring,
  },
});