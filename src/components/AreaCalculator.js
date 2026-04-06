import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme';

const formatArea = (value) =>
  value.toLocaleString('en-US', {
    maximumFractionDigits: 1,
  });

export default function AreaCalculator({ pointCount, landAreaSqFt, usableAreaSqFt }) {
  const hasPolygon = pointCount >= 3;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>AreaCalculator</Text>
      <Text style={styles.subtitle}>
        20% of the polygon area is reserved for walls and circulation, leaving 80% as usable space.
      </Text>

      {hasPolygon ? (
        <View style={styles.metricsRow}>
          <MetricTile label="Land Area" value={`${formatArea(landAreaSqFt)} sq.ft`} />
          <MetricTile label="Usable Area" value={`${formatArea(usableAreaSqFt)} sq.ft`} highlight />
          <MetricTile
            label="Deduction"
            value={`${formatArea(landAreaSqFt - usableAreaSqFt)} sq.ft`}
          />
        </View>
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderTitle}>Boundary not complete</Text>
          <Text style={styles.placeholderText}>
            Add at least three map points to calculate the land area.
          </Text>
        </View>
      )}
    </View>
  );
}

function MetricTile({ label, value, highlight = false }) {
  return (
    <View style={[styles.metricTile, highlight ? styles.highlightTile : null]}>
      <Text style={[styles.metricLabel, highlight ? styles.highlightLabel : null]}>{label}</Text>
      <Text style={[styles.metricValue, highlight ? styles.highlightValue : null]}>{value}</Text>
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
  metricsRow: {
    gap: 10,
  },
  metricTile: {
    backgroundColor: COLORS.cardMuted,
    borderRadius: 18,
    gap: 6,
    padding: 14,
  },
  highlightTile: {
    backgroundColor: COLORS.accentSoft,
  },
  metricLabel: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: COLORS.text,
    fontSize: 21,
    fontWeight: '800',
  },
  highlightLabel: {
    color: COLORS.accent,
  },
  highlightValue: {
    color: COLORS.accent,
  },
  placeholder: {
    backgroundColor: COLORS.cardMuted,
    borderRadius: 18,
    gap: 6,
    padding: 16,
  },
  placeholderTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
  placeholderText: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
