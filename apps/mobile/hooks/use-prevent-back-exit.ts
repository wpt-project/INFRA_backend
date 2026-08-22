import { useEffect } from 'react';
import { BackHandler } from 'react-native';

export function usePreventBackExit() {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);
}
