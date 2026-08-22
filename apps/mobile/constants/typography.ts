// constants/typography.ts

export const Fonts = {
  /** Logo / wordmark */
  logo: 'Lato_900Black',
  /** Headings / emphasized text */
  heading: 'Lato_700Bold',
  /** Normal body text */
  body: 'Lato_400Regular',
  /** Emphasized body text */
  bodyMedium: 'Lato_700Bold',
} as const;

export const FontWeights = {
  light: 'Lato_100Thin',
  semiLight: 'Lato_300Light',
  regular: 'Lato_400Regular',
  semibold: 'Lato_700Bold',
  bold: 'Lato_700Bold',
} as const;

export const TextStyles = {
  displayTitle: {
    fontFamily: Fonts.logo,
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: 0.2,
  },
  title: {
    fontFamily: Fonts.logo,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: 0,
  },
  heading: {
    fontFamily: Fonts.heading,
    fontSize: 20,
    lineHeight: 28,
    letterSpacing: 0.1,
  },
  subheading: {
    fontFamily: Fonts.heading,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0.1,
  },
  bodyLarge: {
    fontFamily: Fonts.body,
    fontSize: 17,
    lineHeight: 26,
    letterSpacing: 0,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 15,
    lineHeight: 23,
    letterSpacing: 0,
  },
  bodyEmphasis: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 15,
    lineHeight: 23,
    letterSpacing: 0.1,
  },
  caption: {
    fontFamily: FontWeights.semiLight,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.3,
  },
  overline: {
    fontFamily: Fonts.heading,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 2,
  },
} as const;
