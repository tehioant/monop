// Online play, one screen that follows the server: create or join a room, its lobby, the table, the results.

import { RULES, type Action } from '@atlas/engine';
import { MAX_NAME_LENGTH } from '@atlas/server/protocol';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Game, Room, Session } from '../online/session.ts';
import { useOnline } from '../online/store.ts';
import { Choice } from '../table/Choice.tsx';
import { Button, Panel, shared } from '../table/parts.tsx';
import { Results } from '../table/Results.tsx';
import { Table } from '../table/Table.tsx';
import { colors } from '../table/theme.ts';
import { usePaced } from '../table/usePaced.ts';

const DEFAULT_COUNTRIES = Math.min(...RULES.countriesToWin);
const MIN_PLAYERS = Math.min(...RULES.playerCounts);
const MAX_PLAYERS = Math.max(...RULES.playerCounts);

const home = () => router.dismissTo('/');

export default function Online() {
  const { session, setName, createRoom, joinRoom, addBot, removePlayer, startGame, play, leave } = useOnline();
  const { room, game } = session;

  // However the screen is left, the connection goes with it.
  useEffect(() => leave, [leave]);

  if (!room) return <Entry session={session} onName={setName} onCreate={createRoom} onJoin={joinRoom} />;
  if (!game) return <Lobby room={room} onAddBot={addBot} onRemove={removePlayer} onStart={startGame} />;

  return <Playing game={game} names={room.players.map((player) => player.name)} onAction={play} />;
}

function Playing({ game, names, onAction }: { game: Game; names: string[]; onAction: (action: Action) => void }) {
  // The server's states can come in a burst (a bot's whole turn): the table shows them one at a time.
  const { view, legal, settled } = usePaced(game.view, game.legalActions);
  const over = view.phase.kind === 'over' && settled;
  return (
    <SafeAreaView style={styles.game}>
      {!over && (
        <View style={styles.quit}>
          <Button quiet label="Settings" onPress={() => router.push('/settings')} />
          <Button quiet label="Quit" onPress={home} />
        </View>
      )}
      {over ? <Results view={view} names={names} /> : <Table view={view} legal={legal} names={names} onAction={onAction} />}
      {over && (
        <View style={styles.home}>
          <Button label="Home" onPress={home} />
        </View>
      )}
    </SafeAreaView>
  );
}

/** Why the player is back on the form, in words. */
function explain(error: NonNullable<Session['error']>): string {
  switch (error) {
    case 'disconnected':
      return 'Could not reach the server.';
    case 'room_not_found':
      return 'No room has this code. Check it with your host.';
    case 'room_full':
      return 'This room is full.';
    case 'game_started':
      return 'This game has already started.';
    case 'removed':
      return 'The host removed you from the room.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

function Entry(props: {
  session: Session;
  onName: (name: string) => void;
  onCreate: (countriesToWin: number) => void;
  onJoin: (code: string) => void;
}) {
  const { session, onName, onCreate, onJoin } = props;
  const [countriesToWin, setCountriesToWin] = useState(DEFAULT_COUNTRIES);
  const [code, setCode] = useState('');
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Play online</Text>
      {session.request ? (
        <Text style={styles.label}>Connecting…</Text>
      ) : (
        <>
          <Text style={styles.label}>Your name, as the other players see it</Text>
          <TextInput
            style={[styles.input, styles.name]}
            value={session.name}
            onChangeText={onName}
            placeholder="Your name"
            placeholderTextColor={colors.muted}
            maxLength={MAX_NAME_LENGTH}
            autoCorrect={false}
          />
          <Choice
            label="Countries to win"
            options={RULES.countriesToWin}
            value={countriesToWin}
            onChange={setCountriesToWin}
          />
          <Button label="Create a room" onPress={() => onCreate(countriesToWin)} />
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
      {session.error && <Text style={styles.error}>{explain(session.error)}</Text>}
      <Button quiet label="Back" onPress={home} />
    </SafeAreaView>
  );
}

function Lobby(props: { room: Room; onAddBot: () => void; onRemove: (seat: number) => void; onStart: () => void }) {
  const { room, onAddBot, onRemove, onStart } = props;
  const host = room.you === 0;
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Room</Text>
      <Text style={styles.label}>Share this code with your friends</Text>
      <Text style={styles.code} selectable>
        {room.code}
      </Text>
      <Text style={styles.label}>The first player with {room.countriesToWin} complete countries wins</Text>
      <Panel>
        {room.players.map((player, seat) => (
          <View key={seat} style={styles.seat}>
            <Text style={shared.name}>
              {player.name}
              <Text style={shared.small}>
                {seat === 0 ? '  host' : ''}
                {seat === room.you ? '  you' : ''}
                {player.bot ? '  bot' : ''}
              </Text>
            </Text>
            {host && seat !== room.you && <Button quiet label="Remove" onPress={() => onRemove(seat)} />}
          </View>
        ))}
      </Panel>
      {host && room.players.length < MAX_PLAYERS && <Button quiet label="Add a bot" onPress={onAddBot} />}
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
  name: { letterSpacing: 0 },
  error: { color: '#b91c1c', fontSize: 15, fontWeight: '600' },
  code: { color: colors.ink, fontSize: 44, fontWeight: '800', letterSpacing: 6, textAlign: 'center' },
  seat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
  game: { flex: 1 },
  quit: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 12 },
  home: { padding: 16 },
});
