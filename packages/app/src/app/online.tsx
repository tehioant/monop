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
  const { session, setName, resume, createRoom, joinRoom, addBot, removePlayer, startGame, play, leave, leaveRoom } = useOnline();
  const { room, game } = session;
  const reconnecting = session.lost !== null;

  // A player with a game in progress comes straight back to it. However the screen is left, the connection
  // goes with it.
  useEffect(() => {
    resume();
    return leave;
  }, [resume, leave]);
  useEffect(() => { if (session.left) home(); }, [session.left]);

  const leaveProps = { onLeave: leaveRoom, leaving: !!session.leaving, leaveFailed: session.error === 'leave_failed' };

  if (session.error === 'unsupported_version') return <UpdateNeeded />;
  if (!room) return <Entry session={session} onName={setName} onCreate={createRoom} onJoin={joinRoom} />;
  if (!game) {
    return (
      <Lobby room={room} reconnecting={reconnecting} onAddBot={addBot} onRemove={removePlayer} onStart={startGame} {...leaveProps} />
    );
  }

  return <Playing game={game} room={room} reconnecting={reconnecting || !session.synced} onAction={play} {...leaveProps} />;
}

type LeaveProps = { onLeave: () => void; leaving: boolean; leaveFailed: boolean };

function Playing({ game, room, reconnecting, onAction, onLeave, leaving, leaveFailed }: LeaveProps & { game: Game; room: Room; reconnecting: boolean; onAction: (action: Action) => void }) {
  const names = room.players.map((player) => player.name);
  const paused = game.paused === true;
  const localExit = reconnecting || paused;
  // The server's states can come in a burst (a bot's whole turn): the table shows them one at a time.
  const { view, legal, settled } = usePaced(game.view, game.legalActions, paused || game.deadline?.kind === 'response');
  const over = view.phase.kind === 'over' && settled;
  return (
    <SafeAreaView style={styles.game}>
      {!over && (
        <View style={styles.quit}>
          {reconnecting && <Reconnecting />}
          <Presence room={room} />
          <Button quiet label="Settings" onPress={() => router.push('/settings')} />
          {localExit && <Button quiet label="Back" onPress={home} />}
          {!reconnecting && <Button quiet label={leaving ? 'Leaving…' : 'Leave game'} disabled={leaving} onPress={onLeave} />}
        </View>
      )}
      {!localExit && game.deadline && <Countdown deadline={game.deadline} />}
      {paused && <Text style={styles.error}>This game is paused.</Text>}
      {localExit && leaving && <Text style={styles.error}>Your leave request may still complete. Going back does not cancel it.</Text>}
      {leaveFailed && <Text style={styles.error}>Could not leave the room. Try again.</Text>}
      {over ? <Results view={view} names={names} /> : <Table view={view} legal={localExit || leaving ? [] : legal} names={names} onAction={onAction} />}
      {over && (
        <View style={styles.home}>
          <Button label="Home" onPress={home} />
        </View>
      )}
    </SafeAreaView>
  );
}

function Countdown({ deadline }: { deadline: NonNullable<Game['deadline']> }) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const tick = setInterval(() => refresh(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);
  // Use the shared epoch clock, assuming normally synchronized device time. Packet transit never moves the deadline.
  const seconds = Math.max(0, Math.ceil((deadline.at - Date.now()) / 1000));
  return <Text style={shared.small}>{`${deadline.kind === 'response' ? 'Response' : 'Turn'}: ${seconds}s`}</Text>;
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
    case 'replaced':
      return 'You are now playing this game on another device.';
    case 'ended':
      return 'The game you were in is over.';
    case 'seat_unavailable':
      return 'There is no seat to return to.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/** The app is too old for the server: nothing online works until it is updated. */
function UpdateNeeded() {
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Update needed</Text>
      <Text style={styles.label}>
        This version of the app can no longer play online. Update it to play with your friends again.
      </Text>
      <Button label="Back" onPress={home} />
    </SafeAreaView>
  );
}

/** The connection is lost and being opened again. */
function Reconnecting() {
  return <Text style={styles.reconnecting}>Reconnecting…</Text>;
}

/** Who is connected, in seat order. */
function Presence({ room }: { room: Room }) {
  return (
    <View style={styles.presence}>
      {room.players.map((player, seat) =>
        player.status === 'connected' ? (
          <Text key={seat} style={shared.small}>
            <Text style={styles.here}>●</Text> {player.name}{player.bot ? ' (Bot)' : ''}
          </Text>
        ) : (
          <Text key={seat} style={[shared.small, styles.away]}>
            ○ {player.name} {player.status === 'bot-replaced' ? '(Bot covering)' : '(offline)'}
          </Text>
        ),
      )}
    </View>
  );
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

function Lobby(props: LeaveProps & {
  room: Room;
  reconnecting: boolean;
  onAddBot: () => void;
  onRemove: (seat: number) => void;
  onStart: () => void;
}) {
  const { room, reconnecting, onAddBot, onRemove, onStart, onLeave, leaving, leaveFailed } = props;
  const host = room.you === 0;
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Room</Text>
      {reconnecting && <Reconnecting />}
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
                {player.status === 'disconnected' ? '  offline' : '  connected'}
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
      {leaveFailed && <Text style={styles.error}>Could not leave the room. Try again.</Text>}
      {reconnecting
        ? <Button quiet label="Back" onPress={home} />
        : <Button quiet label={leaving ? 'Leaving…' : 'Leave'} disabled={leaving} onPress={onLeave} />}
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
  presence: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 },
  here: { color: '#15803d' },
  away: { color: '#b91c1c', fontWeight: '600' },
  reconnecting: { color: '#b91c1c', fontSize: 15, fontWeight: '600' },
  home: { padding: 16 },
});