// app/_layout.tsx
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useFonts } from 'expo-font';
import {
  Lato_100Thin,
  Lato_300Light,
  Lato_400Regular,
  Lato_700Bold,
  Lato_900Black,
} from '@/constants/fonts';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePreventBackExit } from '@/hooks/use-prevent-back-exit';
import { SessionProvider } from '@/providers/SessionProvider';

export const unstable_settings = {
  anchor: 'OnboardingScreen',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  usePreventBackExit();

  const [fontsLoaded, fontError] = useFonts({
    Lato_100Thin,
    Lato_300Light,
    Lato_400Regular,
    Lato_700Bold,
    Lato_900Black,
  });

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SessionProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          {/* Onboarding screens */}
          <Stack.Screen name="OnboardingScreen" options={{ headerShown: false }} />
          <Stack.Screen name="phone-entry" options={{ headerShown: false }} />
          <Stack.Screen name="legal-acceptance" options={{ headerShown: false }} />
          <Stack.Screen name="otp-entry" options={{ headerShown: false }} />
          <Stack.Screen name="profile-setup" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="auto" />
      </SessionProvider>
    </ThemeProvider>
  );
}