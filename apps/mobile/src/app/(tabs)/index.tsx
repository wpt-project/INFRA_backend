// app/(tabs)/index.tsx
import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { SafeAreaView as SafeAreaViewContext } from 'react-native-safe-area-context';

export default function ChatListScreen() {
  return (
    <SafeAreaViewContext style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Chats</Text>
        <Text style={styles.subtitle}>You're logged in!</Text>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Chat list will appear here</Text>
          <Text style={styles.placeholderSub}>This is the main app entry point</Text>
        </View>
      </View>
    </SafeAreaViewContext>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F2F4',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  title: {
    fontWeight: '700',
    fontSize: 24,
    color: '#15171C',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 24,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 14,
    color: '#6B7280',
  },
  placeholderSub: {
    fontSize: 12,
    color: '#9AA0AC',
    marginTop: 4,
  },
});