import { Stack } from 'expo-router';
import { colors } from '../table/theme.ts';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="solo/new" options={{ title: 'Solo game' }} />
      {/* No way back into a game or out of one by accident: leaving is explicit. */}
      <Stack.Screen name="solo/table" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="solo/results" options={{ headerShown: false, gestureEnabled: false }} />
    </Stack>
  );
}
