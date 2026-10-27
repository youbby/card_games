import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

export const isNative = Capacitor.isNativePlatform();

/** Handlers registered by screens/modals; the most recent one gets the Android back button. */
const backHandlers: (() => void)[] = [];

export function pushBackHandler(handler: () => void): () => void {
  backHandlers.push(handler);
  return () => {
    const i = backHandlers.lastIndexOf(handler);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

export async function setUpNative(): Promise<void> {
  if (!isNative) return;
  await App.addListener('backButton', () => {
    const handler = backHandlers[backHandlers.length - 1];
    if (handler) handler();
    else void App.exitApp();
  });
  await Promise.allSettled([
    StatusBar.setStyle({ style: Style.Dark }),
    StatusBar.setBackgroundColor({ color: '#070a0f' }),
    ScreenOrientation.lock({ orientation: 'portrait' }),
  ]);
  await SplashScreen.hide();
}

export function exitApp(): void {
  if (isNative) void App.exitApp();
}

export function onAppPause(handler: () => void): () => void {
  if (!isNative) {
    const listener = () => document.visibilityState === 'hidden' && handler();
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }
  const sub = App.addListener('pause', handler);
  return () => void sub.then((s) => s.remove());
}

export function vibrate(enabled: boolean, strong = false): void {
  if (!enabled) return;
  if (isNative) void Haptics.impact({ style: strong ? ImpactStyle.Medium : ImpactStyle.Light });
  else navigator.vibrate?.(strong ? 40 : 15);
}
