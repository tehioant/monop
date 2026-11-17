import { Stack } from 'expo-router';
import { LocaleProvider } from '../i18n/locale.tsx';
import { colors } from '../table/theme.ts';

export default function RootLayout() {
  return (
    <LocaleProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        {/* No swiping out of a game or back into a finished one: leaving is explicit. */}
        <Stack.Screen name="solo/table" options={{ gestureEnabled: false }} />
        <Stack.Screen name="solo/results" options={{ gestureEnabled: false }} />
        <Stack.Screen name="tutorial" options={{ gestureEnabled: false }} />
        {/* A warm invite targets the existing screen, not a second owner of its connection. */}
        <Stack.Screen name="online" dangerouslySingular activityEnabled={false} options={{ gestureEnabled: false }} />
      </Stack>
    </LocaleProvider>
  );
}
