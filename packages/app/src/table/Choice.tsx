import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme.ts';

/** One of a few options, picked on a row of buttons, for the forms that set up a game. */
export function Choice<T extends string | number>(props: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  show?: (value: T) => string;
}) {
  const { label, options, value, onChange, show = String } = props;
  return (
    <View style={styles.choice}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.options}>
        {options.map((option) => (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityState={{ selected: option === value }}
            style={[styles.option, option === value && styles.optionSelected]}
          >
            <Text style={[styles.optionText, option === value && styles.optionSelectedText]}>{show(option)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  choice: { gap: 8 },
  label: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  options: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  optionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionText: { color: colors.ink, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  optionSelectedText: { color: '#fff' },
});
