import type { Action } from '@atlas/engine';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '../i18n/locale.tsx';
import { Button } from '../table/parts.tsx';
import { Results } from '../table/Results.tsx';
import { Table } from '../table/Table.tsx';
import { colors } from '../table/theme.ts';
import { usePaced } from '../table/usePaced.ts';
import { advanceTutorial, startTutorial, tutorialPosition, type Position } from '../tutorial/tutorial.ts';
import { warnOnce } from '../warnOnce.ts';

type Actor = 'human' | 'bot';
const NO_ACTIONS: readonly Action[] = [];
const BOT_DELAY_MS = 250;

export default function TutorialScreen() {
  const t = useTranslation();
  const [session, setSession] = useState(startTutorial);
  const current = useRef(session);
  const position = useMemo(() => tutorialPosition(session), [session]);
  const unavailable = position.kind === 'unavailable';
  useEffect(() => {
    if (unavailable) warnOnce('tutorial', 'Practice game could not continue.');
  }, [unavailable]);

  const goHome = () => {
    current.current = null;
    router.dismissTo('/');
  };
  if (unavailable) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.recovery}>
          <Text accessibilityRole="header" style={styles.title}>{t('tutorial.title')}</Text>
          <Text style={styles.hint}>{t('tutorial.unavailable')}</Text>
          <Button label={t('tutorial.restart')} onPress={() => {
            current.current = startTutorial();
            setSession(current.current);
          }} />
          <Button quiet label={t('common.home')} onPress={goHome} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const move = (actor: Actor, action: Action) => {
    // A queued tap or callback from a previous render must not advance a later lesson.
    if (!session || current.current !== session) return false;
    const next = advanceTutorial(session, actor, action);
    if (next === session) return false;
    current.current = next;
    setSession(next);
    return next !== null;
  };

  return <PracticeTable position={position} move={move} goHome={goHome} />;
}

function PracticeTable({ position, move, goHome }: {
  position: Exclude<Position, { kind: 'unavailable' }>;
  move: (actor: Actor, action: Action) => boolean;
  goHome: () => void;
}) {
  const t = useTranslation();
  const { view, legal, settled } = usePaced(position.view, position.kind === 'human' ? [position.action] : NO_ACTIONS);
  const names = [t('common.you'), t('tutorial.opponent')];
  useEffect(() => {
    if (position.kind !== 'bot' || !settled) return;
    const timer = setTimeout(() => move('bot', position.action), BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [position, settled, move]);

  if (position.kind === 'won' && settled) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text accessibilityRole="header" style={[styles.title, styles.banner]}>{t('tutorial.complete')}</Text>
        <Results view={view} names={names} />
        <View style={styles.banner}><Button label={t('common.home')} onPress={goHome} /></View>
      </SafeAreaView>
    );
  }

  const hint = position.kind === 'human' && view === position.view ? t(position.hint) : t('tutorial.wait');
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.banner}>
        <View style={styles.bar}>
          <Text accessibilityRole="header" style={styles.title}>{t('tutorial.title')}</Text>
          <Button quiet label={t('tutorial.exit')} onPress={goHome} />
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.hint}>{hint}</Text>
      </View>
      <Table view={view} legal={legal} names={names} onAction={(action) => legal.length > 0 && move('human', action)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  banner: { paddingHorizontal: 12, paddingVertical: 6, gap: 4, backgroundColor: colors.surface },
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  title: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  hint: { color: colors.ink, fontSize: 15 },
  recovery: { padding: 16, gap: 12 },
});
