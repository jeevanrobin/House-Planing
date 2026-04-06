import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ROOM_RULE_LIST } from '../constants/roomRules';
import { COLORS } from '../theme';

const sanitizeCount = (value) => value.replace(/[^0-9]/g, '').slice(0, 2);

export default function InputForm({ requirements, onChange }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>InputForm</Text>
      <Text style={styles.subtitle}>
        Set the room count and optional spaces. The generator keeps each room within its allowed
        area range.
      </Text>

      <View style={styles.formGrid}>
        <CountField
          label="Bedrooms"
          value={requirements.bedrooms}
          onChangeText={(value) => onChange('bedrooms', sanitizeCount(value))}
        />
        <CountField
          label="Bathrooms"
          value={requirements.bathrooms}
          onChangeText={(value) => onChange('bathrooms', sanitizeCount(value))}
        />
      </View>

      <ToggleRow
        label="Kitchen"
        value={requirements.kitchen}
        onValueChange={(value) => onChange('kitchen', value)}
      />
      <ToggleRow
        label="Hall"
        value={requirements.hall}
        onValueChange={(value) => onChange('hall', value)}
      />

      <View style={styles.ruleBlock}>
        <Text style={styles.ruleTitle}>Room size rules</Text>
        {ROOM_RULE_LIST.map((rule) => (
          <View key={rule.label} style={styles.ruleRow}>
            <Text style={styles.ruleLabel}>{rule.label}</Text>
            <Text style={styles.ruleValue}>
              {rule.minArea} - {rule.maxArea} sq.ft
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CountField({ label, value, onChangeText }) {
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        onChangeText={onChangeText}
        placeholder="0"
        placeholderTextColor={COLORS.muted}
        value={value}
      />
    </View>
  );
}

function ToggleRow({ label, value, onValueChange }) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHint}>
          {value ? `${label} will be included in the plan.` : `${label} is excluded.`}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#C8C1B8', true: COLORS.accent }}
        thumbColor={COLORS.card}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  title: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  formGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  inputWrap: {
    flex: 1,
    gap: 8,
  },
  inputLabel: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    backgroundColor: COLORS.cardMuted,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
    minHeight: 52,
    paddingHorizontal: 14,
  },
  toggleRow: {
    alignItems: 'center',
    backgroundColor: COLORS.cardMuted,
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toggleCopy: {
    flex: 1,
    gap: 2,
    paddingRight: 12,
  },
  toggleLabel: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
  },
  toggleHint: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  ruleBlock: {
    backgroundColor: COLORS.cardMuted,
    borderRadius: 18,
    gap: 10,
    padding: 14,
  },
  ruleTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },
  ruleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ruleLabel: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  ruleValue: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '600',
  },
});
