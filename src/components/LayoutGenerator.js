import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme';
import { summarizeRoomRequest } from '../utils/layout';

const formatArea = (value) =>
  value.toLocaleString('en-US', {
    maximumFractionDigits: 1,
  });

export default function LayoutGenerator({
  landAreaSqFt,
  usableAreaSqFt,
  requirements,
  layoutResult,
  onGenerate,
}) {
  const summary = summarizeRoomRequest(requirements);
  const hasPlot = landAreaSqFt > 0;
  const hasRooms = summary.rooms.length > 0;
  const minimumFits = summary.minimumAreaSqFt <= usableAreaSqFt;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>LayoutGenerator</Text>
      <Text style={styles.subtitle}>
        The planner assumes a rectangular usable plot and slices rooms into sequential rows while
        keeping each room within its allowed area range.
      </Text>

      <View style={styles.summaryBlock}>
        <Text style={styles.summaryLabel}>Requested rooms</Text>
        <View style={styles.chipWrap}>
          {summary.rooms.length > 0 ? (
            summary.rooms.map((room) => (
              <View key={room.id} style={styles.chip}>
                <Text style={styles.chipText}>{room.name}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyState}>No rooms selected yet.</Text>
          )}
        </View>
      </View>

      <View style={styles.metricRow}>
        <MetricCard label="Minimum Needed" value={`${formatArea(summary.minimumAreaSqFt)} sq.ft`} />
        <MetricCard label="Preferred" value={`${formatArea(summary.preferredAreaSqFt)} sq.ft`} />
      </View>

      <View style={[styles.statusBox, minimumFits || !hasPlot ? styles.infoBox : styles.warningBox]}>
        <Text style={[styles.statusTitle, minimumFits || !hasPlot ? styles.infoTitle : styles.warningTitle]}>
          {hasPlot
            ? minimumFits
              ? 'Current request fits the usable area.'
              : 'Current request does not fit the usable area.'
            : 'Select a boundary to unlock layout generation.'}
        </Text>
        <Text style={styles.statusText}>
          {hasPlot
            ? `Usable area: ${formatArea(usableAreaSqFt)} sq.ft`
            : 'Choose at least three polygon points on the map first.'}
        </Text>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.generateButton,
          !hasPlot || !hasRooms ? styles.disabledButton : null,
          pressed && hasPlot && hasRooms ? styles.pressedButton : null,
        ]}
        disabled={!hasPlot || !hasRooms}
        onPress={onGenerate}
      >
        <Text style={styles.generateButtonText}>Generate Layout</Text>
      </Pressable>

      {layoutResult ? <ResultBanner layoutResult={layoutResult} /> : null}
    </View>
  );
}

function MetricCard({ label, value }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function ResultBanner({ layoutResult }) {
  const isSuccess = layoutResult.status === 'success';
  const boxStyle = isSuccess ? styles.successBox : styles.dangerBox;
  const titleStyle = isSuccess ? styles.successTitle : styles.dangerTitle;

  return (
    <View style={[styles.statusBox, boxStyle]}>
      <Text style={[styles.statusTitle, titleStyle]}>
        {isSuccess ? 'Layout ready' : 'Generation stopped'}
      </Text>
      <Text style={styles.statusText}>{layoutResult.message}</Text>
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
  summaryBlock: {
    gap: 10,
  },
  summaryLabel: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: COLORS.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyState: {
    color: COLORS.muted,
    fontSize: 14,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    backgroundColor: COLORS.cardMuted,
    borderRadius: 18,
    flex: 1,
    gap: 6,
    padding: 14,
  },
  metricLabel: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  metricValue: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: '800',
  },
  statusBox: {
    borderRadius: 18,
    gap: 4,
    padding: 14,
  },
  infoBox: {
    backgroundColor: COLORS.accentSoft,
  },
  warningBox: {
    backgroundColor: COLORS.warningSoft,
  },
  successBox: {
    backgroundColor: COLORS.successSoft,
  },
  dangerBox: {
    backgroundColor: COLORS.dangerSoft,
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  infoTitle: {
    color: COLORS.accent,
  },
  warningTitle: {
    color: COLORS.warning,
  },
  successTitle: {
    color: COLORS.success,
  },
  dangerTitle: {
    color: COLORS.danger,
  },
  statusText: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 20,
  },
  generateButton: {
    alignItems: 'center',
    backgroundColor: COLORS.accent,
    borderRadius: 18,
    justifyContent: 'center',
    minHeight: 52,
  },
  disabledButton: {
    opacity: 0.45,
  },
  pressedButton: {
    opacity: 0.85,
  },
  generateButtonText: {
    color: COLORS.card,
    fontSize: 16,
    fontWeight: '800',
  },
});
