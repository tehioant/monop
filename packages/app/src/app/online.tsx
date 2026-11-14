// Online play, one screen that follows the server: create or join a room, its lobby, the table, the results.

import { RULES } from '@atlas/engine';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Room, Session } from '../online/session.ts';
import { useOnline } from '../online/store.ts';
import { Button, Panel, shared } from '../table/parts.tsx';
import { Results } from '../table/Results.tsx';
import { Table } from '../table/Table.tsx';
import { colors } from '../table/theme.ts';

const COUNTRIES_TO_WIN = Math.min(...RULES.countriesToWin);
const MIN_PLAYERS = Math.min(...RULES.playerCounts);

const home = () => router.dismissTo('/');

export default function Online() {
  const { session, createRoom, joinRoom, startGame, play, leave } = useOnline();
  const { room, game } = session;

  // However the screen is left, the connection goes with it.
  useEffect(() => leave, [leave]);

  if (!room) {
    return <Entry session={session} onCreate={() => createRoom(COUNTRIES_TO_WIN)} onJoin={joinRoom} />;
  }
  if (!game) return <Lobby room={room} onStart={startGame} />;

  const names = room.players.map((player) => player.name);
  const over = game.view.phase.kind === 'over';
  return (
    <SafeAreaView style={styles.game}>
      {!over && (
        <View style={styles.quit}>
          <Button quiet label="Quit" onPress={home} />
        </View>
      )}
      {over ? (
        <Results view={game.view} names={names} />
      ) : (
        <Table view={game.view} legal={game.legalActions} names={names} onAction={play} />
      )}
      {over && (
        <View style={styles.home}>
          <Button label="Home" onPress={home} />
        </View>
      )}
    </SafeAreaView>
  );
}

function Entry(props: { session: Session; onCreate: () => void; onJoin: (code: string) => void }) {
  const { session, onCreate, onJoin } = props;
  const [code, setCode] = useState('');
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Play online</Text>
      {session.request ? (
        <Text style={styles.label}>Connecting…</Text>
      ) : (
        <>
          <Button label="Create a room" onPress={onCreate} />
          <Text style={styles.label}>Or join a friend's room</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="Room code"
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Button label="Join" onPress={() => onJoin(code)} />
        </>
      )}
      {session.error && (
        <Text style={styles.error}>
          {session.error === 'disconnected' ? 'Could not reach the server.' : 'Could not join this room.'}
        </Text>
      )}
      <Button quiet label="Back" onPress={home} />
    </SafeAreaView>
  );
}

function Lobby({ room, onStart }: { room: Room; onStart: () => void }) {
  const host = room.you === 0;
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Room</Text>
      <Text style={styles.label}>Share this code with your friends</Text>
      <Text style={styles.code} selectable>
        {room.code}
      </Text>
      <Panel>
        {room.players.map((player, seat) => (
          <Text key={seat} style={shared.name}>
            {player.name}
            <Text style={shared.small}>
              {seat === 0 ? '  host' : ''}
              {seat === room.you ? '  you' : ''}
            </Text>
          </Text>
        ))}
      </Panel>
      {host && room.players.length >= MIN_PLAYERS ? (
        <Button label="Start the game" onPress={onStart} />
      ) : (
        <Text style={styles.label}>
          {host ? 'Waiting for another player to join…' : 'Waiting for the host to start the game…'}
        </Text>
      )}
      <Button quiet label="Leave" onPress={home} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  label: { color: colors.muted, fontSize: 16 },
  input: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
  },
  error: { color: '#b91c1c', fontSize: 15, fontWeight: '600' },
  code: { color: colors.ink, fontSize: 44, fontWeight: '800', letterSpacing: 6, textAlign: 'center' },
  game: { flex: 1 },
  quit: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12 },
  home: { padding: 16 },
});
