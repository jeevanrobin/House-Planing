import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon, Polyline } from 'react-native-maps';
import { COLORS } from '../theme';

const DEFAULT_REGION = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function MapScreen({ points, onAddPoint, onUndoPoint, onClearPoints }) {
  const polylinePoints = points.length > 2 ? [...points, points[0]] : points;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>MapScreen</Text>
          <Text style={styles.subtitle}>
            Tap multiple points on the map to draw the land boundary polygon.
          </Text>
        </View>
        <View style={styles.pointBadge}>
          <Text style={styles.pointBadgeText}>{points.length} pts</Text>
        </View>
      </View>

      <MapView
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        onPress={(event) => onAddPoint(event.nativeEvent.coordinate)}
      >
        {points.map((point, index) => (
          <Marker
            key={`${point.latitude}-${point.longitude}-${index}`}
            coordinate={point}
            title={`Point ${index + 1}`}
            pinColor={COLORS.accent}
          />
        ))}

        {points.length >= 2 ? (
          <Polyline coordinates={polylinePoints} strokeColor={COLORS.accent} strokeWidth={3} />
        ) : null}

        {points.length >= 3 ? (
          <Polygon
            coordinates={points}
            fillColor="rgba(14, 124, 134, 0.18)"
            strokeColor={COLORS.accent}
            strokeWidth={2}
          />
        ) : null}
      </MapView>

      <View style={styles.footer}>
        <Text style={styles.helperText}>
          Use at least 3 points. The app calculates the polygon area and treats the usable plot as
          a rectangle for layout generation.
        </Text>

        <View style={styles.actionRow}>
          <ActionButton
            label="Undo Point"
            onPress={onUndoPoint}
            disabled={points.length === 0}
          />
          <ActionButton
            label="Clear Plot"
            onPress={onClearPoints}
            disabled={points.length === 0}
            tone="secondary"
          />
        </View>
      </View>
    </View>
  );
}

function ActionButton({ label, onPress, disabled, tone = 'primary' }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionButton,
        tone === 'secondary' ? styles.secondaryButton : styles.primaryButton,
        disabled ? styles.disabledButton : null,
        pressed && !disabled ? styles.pressedButton : null,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text
        style={[
          styles.actionButtonText,
          tone === 'secondary' ? styles.secondaryButtonText : styles.primaryButtonText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    overflow: 'hidden',
    padding: 16,
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  headerCopy: {
    flex: 1,
    gap: 4,
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
  pointBadge: {
    backgroundColor: COLORS.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pointBadgeText: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  map: {
    borderRadius: 18,
    height: 320,
    overflow: 'hidden',
  },
  footer: {
    gap: 14,
  },
  helperText: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 12,
  },
  primaryButton: {
    backgroundColor: COLORS.accent,
  },
  secondaryButton: {
    backgroundColor: COLORS.cardMuted,
    borderColor: COLORS.border,
    borderWidth: 1,
  },
  disabledButton: {
    opacity: 0.45,
  },
  pressedButton: {
    opacity: 0.8,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButtonText: {
    color: COLORS.card,
  },
  secondaryButtonText: {
    color: COLORS.text,
  },
});
