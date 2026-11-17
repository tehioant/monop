import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '../i18n/locale.tsx';
import { RulesButton } from '../rules/RulesButton.tsx';
import { inProgress } from '../solo/solo.ts';
import { useSolo } from '../solo/store.ts';
import { SaveStatus } from '../solo/SaveStatus.tsx';
import { Button } from '../table/parts.tsx';
import { colors } from '../table/theme.ts';
import { dismissTutorialOffer, shouldOfferTutorial } from '../tutorial/offer.ts';

export default function Home() {
  const t = useTranslation();
  // The solo game saved on the device, or left a moment ago. There is one at a time.
  const saved = useSolo(({ game }) => game !== null && inProgress(game));
  const abandon = useSolo((solo) => solo.abandon);
  const saveError = useSolo((solo) => solo.saveError);
  const retrySave = useSolo((solo) => solo.retrySave);
  const [offer, setOffer] = useState(shouldOfferTutorial);
  const dismiss = (decision: 'started' | 'skipped') => {
    dismissTutorialOffer(decision);
    setOffer(false);
  };
  const startTutorial = () => {
    if (offer) dismiss('started');
    router.push('/tutorial');
  };

  const confirmAbandon = () =>
    Alert.alert(t('home.abandonTitle'), t('home.abandonMessage'), [
      { text: t('home.keep'), style: 'cancel' },
      { text: t('home.abandon'), style: 'destructive', onPress: abandon },
    ]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.home}>
        <Text style={styles.title}>Atlas</Text>
        <Text style={styles.tagline}>{t('home.tagline')}</Text>
        {offer && (
          <View style={styles.offer}>
            <Text style={styles.offerText}>{t('tutorial.offer')}</Text>
            <Button label={t('tutorial.start')} onPress={startTutorial} />
            <Button quiet label={t('tutorial.skip')} onPress={() => dismiss('skipped')} />
          </View>
        )}
        <SaveStatus error={saveError} retry={retrySave} />
        {saved ? (
          <>
            <Button label={t('home.resume')} onPress={() => router.push('/solo/table')} />
            <Button quiet label={t('home.abandonSolo')} onPress={confirmAbandon} />
          </>
        ) : (
          <Button label={t('home.solo')} onPress={() => router.push('/solo/new')} />
        )}
        <Button label={t('home.online')} onPress={() => router.push('/online')} />
        {!offer && <Button quiet label={t('tutorial.replay')} onPress={startTutorial} />}
        <RulesButton />
        <Button quiet label={t('settings.title')} onPress={() => router.push('/settings')} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  home: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12 },
  offer: { padding: 12, gap: 8, borderRadius: 8, backgroundColor: colors.surface },
  offerText: { color: colors.ink, fontSize: 16 },
  title: { color: colors.ink, fontSize: 48, fontWeight: '800', textAlign: 'center' },
  tagline: { color: colors.muted, fontSize: 16, textAlign: 'center', marginBottom: 24 },
});
