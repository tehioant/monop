import { CARDS, RULES } from '@atlas/engine';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '../i18n/locale.tsx';
import { Button } from '../table/parts.tsx';
import { colors } from '../table/theme.ts';

export function RulesButton() {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button quiet label={t('rules.title')} onPress={() => setOpen(true)} />
      {open && <RulesModal onClose={() => setOpen(false)} />}
    </>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  const t = useTranslation();
  const sections = [
    ['rules.turn', [
      t('rules.start', { hand: RULES.startingHand, draws: RULES.drawsPerTurn, empty: RULES.drawsOnEmptyHand }),
      t('rules.piles', { market: RULES.marketSize }),
      t('rules.plays', { plays: RULES.playsPerTurn, limit: RULES.handLimit }),
    ]],
    ['rules.cards', [t('rules.deck', { count: CARDS.length }), t('rules.cities'), t('rules.actions')]],
    ['rules.pay', [t('rules.payment')]],
    ['rules.veto', [t('rules.response')]],
    ['rules.perks', [t('rules.active'), t('perk.extraDrawText', { count: RULES.drawsWithPerk }),
      t('perk.extraPlayText', { count: RULES.playsWithPerk }), t('perk.vetoReturnText')]],
    ['rules.win', [t('rules.goal', { short: Math.min(...RULES.countriesToWin), long: Math.max(...RULES.countriesToWin) })]],
  ] as const;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <Text accessibilityRole="header" style={styles.title}>{t('rules.title')}</Text>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
          {sections.map(([title, paragraphs]) => (
            <View key={title} style={styles.section}>
              <Text accessibilityRole="header" style={styles.heading}>{t(title)}</Text>
              {paragraphs.map((text) => <Text key={text} style={styles.text}>{text}</Text>)}
            </View>
          ))}
        </ScrollView>
        <Button quiet label={t('common.close')} onPress={onClose} />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.background },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  scroll: { flex: 1 },
  body: { gap: 12 },
  section: { gap: 6, padding: 12, borderRadius: 8, backgroundColor: colors.surface },
  heading: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  text: { color: colors.ink, fontSize: 15 },
});
