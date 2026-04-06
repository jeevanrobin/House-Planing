import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';
import { COLORS } from '../theme';

const formatArea = (value) =>
  value.toLocaleString('en-US', {
    maximumFractionDigits: 1,
  });

export default function LayoutView({ layout }) {
  const { width } = useWindowDimensions();

  if (!layout || layout.status !== 'success') {
    return null;
  }

  const drawingPadding = 18;
  const viewBoxWidth = layout.plotWidthFt + drawingPadding * 2;
  const viewBoxHeight = layout.plotHeightFt + drawingPadding * 2;
  const svgWidth = width - 36;
  const svgHeight = Math.max(
    280,
    Math.min(460, svgWidth * (viewBoxHeight / viewBoxWidth))
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title}>LayoutView</Text>
      <Text style={styles.subtitle}>
        Rectangles are scaled from the computed room areas and labeled with approximate dimensions.
      </Text>

      <View style={styles.planSummary}>
        <SummaryTile label="Plot Size" value={`${layout.plotWidthFt} ft x ${layout.plotHeightFt} ft`} />
        <SummaryTile label="Allocated Rooms" value={`${formatArea(layout.totalRoomAreaSqFt)} sq.ft`} />
        <SummaryTile label="Reserve Area" value={`${formatArea(layout.unusedAreaSqFt)} sq.ft`} />
      </View>

      <View style={styles.svgFrame}>
        <Svg width="100%" height={svgHeight} viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}>
          <Rect
            x={drawingPadding}
            y={drawingPadding}
            width={layout.plotWidthFt}
            height={layout.plotHeightFt}
            fill="#FBF7EE"
            rx={12}
            stroke={COLORS.text}
            strokeWidth={1.5}
          />

          {layout.rooms.map((room) => {
            const labelFontSize = Math.max(
              10,
              Math.min(16, Math.min(room.widthFt, room.heightFt) * 0.18)
            );
            const detailFontSize = Math.max(9, labelFontSize - 3);
            const centerX = drawingPadding + room.xFt + room.widthFt / 2;
            const centerY = drawingPadding + room.yFt + room.heightFt / 2;

            return (
              <G key={room.id}>
                <Rect
                  x={drawingPadding + room.xFt}
                  y={drawingPadding + room.yFt}
                  width={room.widthFt}
                  height={room.heightFt}
                  fill={room.color}
                  rx={10}
                  stroke={COLORS.text}
                  strokeWidth={1}
                />
                <SvgText
                  fill={COLORS.text}
                  fontSize={labelFontSize}
                  fontWeight="700"
                  textAnchor="middle"
                  x={centerX}
                  y={centerY - 4}
                >
                  {room.name}
                </SvgText>
                <SvgText
                  fill={COLORS.text}
                  fontSize={detailFontSize}
                  textAnchor="middle"
                  x={centerX}
                  y={centerY + labelFontSize}
                >
                  {room.displayDimensions}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>

      <View style={styles.roomList}>
        {layout.rooms.map((room) => (
          <View key={room.id} style={styles.roomRow}>
            <View>
              <Text style={styles.roomName}>{room.name}</Text>
              <Text style={styles.roomMeta}>{room.areaSqFt} sq.ft</Text>
            </View>
            <Text style={styles.roomDimensions}>{room.displayDimensions}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function SummaryTile({ label, value }) {
  return (
    <View style={styles.summaryTile}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
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
  planSummary: {
    gap: 10,
  },
  summaryTile: {
    backgroundColor: COLORS.cardMuted,
    borderRadius: 18,
    gap: 6,
    padding: 14,
  },
  summaryLabel: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  summaryValue: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
  },
  svgFrame: {
    backgroundColor: '#F4EBDC',
    borderRadius: 20,
    overflow: 'hidden',
    padding: 12,
  },
  roomList: {
    gap: 10,
  },
  roomRow: {
    alignItems: 'center',
    backgroundColor: COLORS.cardMuted,
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  roomName: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
  },
  roomMeta: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: 2,
  },
  roomDimensions: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
});
