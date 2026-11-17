// The player's settings. Opened from home and from a game, which goes on underneath.

import { router } from 'expo-router';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signal } from '../settings/feedback.ts';
import { useTranslation } from '../i18n/locale.tsx';
import { languageChoices } from '../i18n/strings.ts';
import { useSettings } from '../settings/store.ts';
import { Button, Panel, shared } from '../table/parts.tsx';
import { colors } from '../table/theme.ts';

const switches = ['sound', 'haptics'] as const;

export default function SettingsScreen() {
  const t = useTranslation();
  const { settings, change, saveError } = useSettings();
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.title}>{t('settings.title')}</Text>
        <Panel>
          {switches.map((name) => (
            <View key={name} style={styles.row}>
              <View style={styles.text}>
                <Text style={shared.name}>{t(`settings.${name}`)}</Text>
                <Text style={shared.small}>{t(`settings.${name}Detail`)}</Text>
              </View>
              <Switch
                accessibilityLabel={t(`settings.${name}`)}
                value={settings[name]}
                trackColor={{ true: colors.accent }}
                onValueChange={(on) => {
                  change({ [name]: on });
                  // What is now on is heard or felt at once.
                  signal('turn');
                }}
              />
            </View>
          ))}
        </Panel>
        <Panel>
          <Text style={shared.name}>{t('settings.language')}</Text>
          {languageChoices.map((language) => (
            <Button key={language} quiet={settings.language !== language} selected={settings.language === language}
              label={t(`settings.${language}`)} onPress={() => change({ language })} />
          ))}
        </Panel>
        {saveError && <Text style={shared.small}>{t('settings.saveError')}</Text>}
        <Button quiet label={t('common.back')} onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screen: { padding: 24, gap: 16 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  text: { flex: 1, gap: 2 },
});
