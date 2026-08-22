// app/typography-demo.tsx

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Fonts, FontWeights, TextStyles } from '@/constants/typography';

const C = {
  bg: '#0a0a0b',
  bg2: '#111113',
  ink: '#F3F1EC',
  accent: '#c27b10',
  dim: 'rgba(243,241,236,0.45)',
};

const ROWS = [
  { label: 'Display Title', spec: 'Lato Black · 34', style: TextStyles.displayTitle },
  { label: 'Title', spec: 'Lato Black · 28', style: TextStyles.title },
  { label: 'Heading', spec: 'Lato Bold · 20', style: TextStyles.heading },
  { label: 'Subheading', spec: 'Lato Bold · 16', style: TextStyles.subheading },
  { label: 'Body Large', spec: 'Lato Regular · 17', style: TextStyles.bodyLarge },
  { label: 'Body', spec: 'Lato Regular · 15', style: TextStyles.body },
  { label: 'Body Emphasis', spec: 'Lato Bold · 15', style: TextStyles.bodyEmphasis },
  { label: 'Caption', spec: 'Lato Light · 12', style: TextStyles.caption },
  { label: 'Overline', spec: 'Lato Bold · 11 · tracked', style: TextStyles.overline },
];

export default function TypographyDemo() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={[TextStyles.overline, styles.overlineAccent]}>SEALINE TYPE SCALE</Text>
      <Text style={TextStyles.displayTitle}>Lato</Text>
      <Text style={[TextStyles.body, styles.intro]}>
        One family, five weights. Every level below uses only size and weight for hierarchy.
      </Text>

      {ROWS.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={styles.spec}>{`${row.label.toUpperCase()} — ${row.spec}`}</Text>
          <Text style={[row.style, styles.sample]} numberOfLines={2}>
            The quiet sea meets the shore.
          </Text>
        </View>
      ))}

      <View style={styles.weights}>
        {(Object.keys(FontWeights) as Array<keyof typeof FontWeights>).map((w) => (
          <Text key={w} style={[styles.sample, { fontFamily: FontWeights[w] }]}>
            {`Aa — ${w}`}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  content: {
    padding: 24,
    paddingBottom: 64,
    gap: 8,
  },
  intro: {
    color: C.dim,
    marginBottom: 24,
  },
  overlineAccent: {
    color: C.accent,
    marginBottom: 4,
  },
  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.bg2,
  },
  spec: {
    fontFamily: Fonts.heading,
    fontSize: 10,
    letterSpacing: 1.5,
    color: C.dim,
    marginBottom: 6,
  },
  sample: {
    color: C.ink,
  },
  weights: {
    marginTop: 32,
    gap: 10,
  },
});
