import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.changyoub.cardgames',
  appName: 'Card Games',
  webDir: 'dist',
  android: {
    backgroundColor: '#070a0f',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#070a0f',
      showSpinner: false,
    },
  },
};

export default config;
