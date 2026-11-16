// The action log in full, over the table: what happened since the viewer's last turn, or the whole game.

import type { LogEntry, PlayerId } from '@atlas/engine';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { logLine } from './actions.ts';
import { Choice } from './Choice.tsx';
import { sinceLastTurn } from './log.ts';
import { Button, shared } from './parts.tsx';
import { colors } from './theme.ts';

const SPANS = ['Since your turn', 'Whole game'] as const;

export function LogSheet(props: { log: readonly LogEntry[]; viewer: PlayerId; names: readonly string[]; onClose: () => void }) {
  const { log, viewer, names, onClose } = props;
  const [span, setSpan] = useState<(typeof SPANS)[number]>(SPANS[0]);
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  const entries = span === SPANS[0] ? sinceLastTurn(log, viewer) : log;
  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close the log" />
      <View style={styles.sheet}>
        <Choice label="What happened" options={SPANS} value={span} onChange={setSpan} />
        {/* Oldest first, and opened on the latest: the end of the list follows the game. */}
        <ScrollView ref={list} style={styles.list} onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}>
          {entries.length === 0 && <Text style={shared.small}>Nothing yet.</Text>}
          {entries.map((entry, i) => (
            <Text key={i} style={styles.line}>
              {logLine(entry, names)}
            </Text>
          ))}
        </ScrollView>
        <Button quiet label="Close" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#1f293366' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 12,
  },
  list: { flexGrow: 0 },
  line: { color: colors.ink, fontSize: 14, paddingVertical: 3 },
});
