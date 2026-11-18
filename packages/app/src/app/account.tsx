import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
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
  const token = useOnline(state => state.accountToken());
  const [observation, setObservation] = useState<{ token: string | null; status: AccountStatus } | null>(null);
  const latest = useRef(observation);
  const revision = useRef(0);
  const status = observation?.token === token ? observation.status : null;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'signInError' | 'deleteError' | 'deleted' | 'deletedLocalError' | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const online = useOnline.getState;
  const refresh = async (credential: string | null) => {
    const request = ++revision.current;
    const status = await client.status(credential);
    if (!mounted.current || revision.current !== request || online().accountToken() !== credential) return;
    latest.current = { token: credential, status };
    setObservation(latest.current);
  };
  useEffect(() => {
    mounted.current = true;
    void refresh(token).catch(() => {});
    return () => {
      mounted.current = false;
      latest.current = null;
      ++revision.current;
    };
  }, [token]);
  const signIn = async (provider: Provider, mode: Mode) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice(null);
    const token = online().accountToken();
    try {
      const result = await client.signIn(provider, mode, token);
      if (!result || !mounted.current || online().accountToken() !== token) return;
      if ('token' in result && !online().replaceAccount(token, result)) throw Error('Could not store restored account');
      if (online().accountToken() === token) await refresh(token);
    } catch { if (mounted.current && online().accountToken() === token) setNotice('signInError'); }
    finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const canRemove = () => mounted.current && !pending.current && !!status?.authenticated && !!token &&
    latest.current === observation && online().accountToken() === token;
  const remove = async (token: string) => {
    if (!canRemove()) return;
    pending.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await client.deleteAccount(token);
      if (online().accountToken() !== token) return;
      const cleared = online().clearAccount(token);
      if (mounted.current) {
        latest.current = null;
        ++revision.current;
        setObservation(null);
        setNotice(cleared ? 'deleted' : 'deletedLocalError');
      }
    } catch { if (mounted.current && online().accountToken() === token) setNotice('deleteError'); }
    finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const confirmRemoval = () => {
    if (!token || !canRemove()) return;
    Alert.alert(t('account.delete'), t('account.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('account.delete'), style: 'destructive', onPress: () => remove(token) },
    ]);
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
          {status?.authenticated && <Button quiet disabled={busy} label={t('account.delete')} onPress={confirmRemoval} />}
          {notice && <Text accessibilityRole="alert" style={shared.small}>{t(`account.${notice}`)}</Text>}
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
    if (url.protocol === 'https:' && url.host && !url.username && !url.password) return url.href;
  } catch { /* Invalid build configuration: leave the link unavailable. */ }
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screen: { padding: 24, gap: 16 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
});