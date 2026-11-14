import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { soloNames, soloView } from '../../solo/solo.ts';
import { useSolo } from '../../solo/store.ts';
import { Button } from '../../table/parts.tsx';
import { Results } from '../../table/Results.tsx';

export default function SoloResults() {
  const game = useSolo((solo) => solo.game);
  if (!game) return <Redirect href="/" />;
  return (
    <SafeAreaView style={styles.screen}>
      <Results view={soloView(game)} names={soloNames(game)} />
      <View style={styles.bar}>
        <Button label="Home" onPress={() => router.replace('/')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { padding: 16 },
});
