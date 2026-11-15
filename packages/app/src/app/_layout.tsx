import { Stack } from 'expo-router';
import { colors } from '../table/theme.ts';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      {/* No swiping out of a game or back into a finished one: leaving is explicit. */}
      <Stack.Screen name="solo/table" options={{ gestureEnabled: false }} />
      <Stack.Screen name="solo/results" options={{ gestureEnabled: false }} />
      <Stack.Screen name="online" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
