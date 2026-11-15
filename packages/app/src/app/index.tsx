import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../table/parts.tsx';
import { colors } from '../table/theme.ts';

export default function Home() {
  return (
    <View style={styles.home}>
      <Text style={styles.title}>Atlas</Text>
      <Text style={styles.tagline}>Collect countries, city by city.</Text>
      <Button label="Solo game" onPress={() => router.push('/solo/new')} />
      <Button label="Play online" onPress={() => router.push('/online')} />
    </View>
  );
}

const styles = StyleSheet.create({
  home: { flex: 1, justifyContent: 'center', padding: 32, gap: 16 },
  title: { color: colors.ink, fontSize: 48, fontWeight: '800', textAlign: 'center' },
  tagline: { color: colors.muted, fontSize: 16, textAlign: 'center', marginBottom: 24 },
});
