import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { privacyPolicyUrl } from '../account/config.ts';
import { useTranslation } from '../i18n/locale.tsx';
import { Button, Panel, shared } from '../table/parts.tsx';
import { colors } from '../table/theme.ts';

export default function AccountScreen() {
  const t = useTranslation();
  const [policyError, setPolicyError] = useState(false);
  const policy = safePolicyUrl(privacyPolicyUrl);
  const openPolicy = async () => {
    if (!policy) return;
    setPolicyError(false);
    try { await Linking.openURL(policy); } catch { setPolicyError(true); }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.title}>{t('account.title')}</Text>
        <Panel>
          <Text style={shared.name}>{t('account.guest')}</Text>
          <Text style={shared.small}>{t('account.signInUnavailable')}</Text>
        </Panel>
        <Panel>
          {policy ? <Button quiet label={t('account.privacy')} onPress={openPolicy} /> :
            <Text style={shared.small}>{t('account.privacyUnavailable')}</Text>}
          {policyError && <Text accessibilityRole="alert" style={shared.small}>{t('account.privacyError')}</Text>}
        </Panel>
        <Button quiet label={t('common.back')} onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

function safePolicyUrl(value: string | undefined): string | undefined {
  if (!value || !/^https:\/\//i.test(value) || /[\s\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Invalid build configuration: leave the link unavailable. */ }
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screen: { padding: 24, gap: 16 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
});