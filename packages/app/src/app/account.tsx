import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accountClient, type AccountStatus, type Mode, type Provider } from '../account/client.ts';
import { useOnline } from '../online/store.ts';
import { privacyPolicyUrl } from '../account/config.ts';
import { useTranslation } from '../i18n/locale.tsx';
import { Button, Panel, shared } from '../table/parts.tsx';
import { colors } from '../table/theme.ts';

const client = accountClient();

export default function AccountScreen() {
  const t = useTranslation();
  const [policyError, setPolicyError] = useState(false);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [signInError, setSignInError] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const online = useOnline.getState;
  const refresh = async () => {
    const token = online().accountToken();
    const next = await client.status(token);
    if (mounted.current && online().accountToken() === token) setStatus(next);
  };
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => {});
    return () => { mounted.current = false; };
  }, []);
  const signIn = async (provider: Provider, mode: Mode) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setSignInError(false);
    const token = online().accountToken();
    try {
      const result = await client.signIn(provider, mode, token);
      if (!result || !mounted.current) return;
      if ('token' in result && !online().replaceAccount(token, result)) throw Error('Could not store restored account');
      await refresh();
    } catch { if (mounted.current) setSignInError(true); }
    finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
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
          {status?.linked.length ? status.linked.map(provider => (
            <Text key={provider} style={shared.name}>{t('account.linked', { provider: t(`account.${provider}`) })}</Text>
          )) : <Text style={shared.name}>{t('account.guest')}</Text>}
          {!status?.providers.length && <Text style={shared.small}>{t('account.signInUnavailable')}</Text>}
          {!!status?.providers.length && !status.authenticated && <Text style={shared.small}>{t('account.guestFirst')}</Text>}
          {status?.providers.map(provider => (
            <Panel key={provider}>
              {status.authenticated && !status.linked.includes(provider) && (
                <Button disabled={busy} label={t('account.link', { provider: t(`account.${provider}`) })} onPress={() => signIn(provider, 'link')} />
              )}
              <Button quiet disabled={busy} label={t('account.restore', { provider: t(`account.${provider}`) })} onPress={() => signIn(provider, 'restore')} />
            </Panel>
          ))}
          {signInError && <Text accessibilityRole="alert" style={shared.small}>{t('account.signInError')}</Text>}
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