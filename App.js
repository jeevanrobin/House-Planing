import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import AreaCalculator from './src/components/AreaCalculator';
import InputForm from './src/components/InputForm';
import LayoutGenerator from './src/components/LayoutGenerator';
import LayoutView from './src/components/LayoutView';
import MapScreen from './src/components/MapScreen';
import { COLORS } from './src/theme';
import { getPlotAspectRatio, getPolygonAreaSqFt } from './src/utils/geometry';
import { generateLayoutPlan } from './src/utils/layout';

const DEFAULT_REQUIREMENTS = {
  bedrooms: '2',
  bathrooms: '1',
  kitchen: true,
  hall: true,
};

export default function App() {
  const [plotPoints, setPlotPoints] = useState([]);
  const [requirements, setRequirements] = useState(DEFAULT_REQUIREMENTS);
  const [layoutResult, setLayoutResult] = useState(null);

  const landAreaSqFt = useMemo(() => getPolygonAreaSqFt(plotPoints), [plotPoints]);
  const usableAreaSqFt = useMemo(() => landAreaSqFt * 0.8, [landAreaSqFt]);
  const plotAspectRatio = useMemo(() => getPlotAspectRatio(plotPoints), [plotPoints]);

  useEffect(() => {
    setLayoutResult(null);
  }, [plotPoints, requirements]);

  const handleAddPoint = (coordinate) => {
    setPlotPoints((currentPoints) => [...currentPoints, coordinate]);
  };

  const handleUndoPoint = () => {
    setPlotPoints((currentPoints) => currentPoints.slice(0, -1));
  };

  const handleClearPlot = () => {
    setPlotPoints([]);
  };

  const handleRequirementChange = (field, value) => {
    setRequirements((currentValues) => ({
      ...currentValues,
      [field]: value,
    }));
  };

  const handleGenerateLayout = () => {
    setLayoutResult(
      generateLayoutPlan({
        usableAreaSqFt,
        plotAspectRatio,
        requirements,
      })
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.kicker}>2D House Planner</Text>
          <Text style={styles.title}>Generate a quick room layout from your plot.</Text>
          <Text style={styles.subtitle}>
            Mark the land boundary on the map, review the usable area after the 20% deduction,
            and generate a simple SVG-based floor plan for Android testing.
          </Text>
        </View>

        <MapScreen
          points={plotPoints}
          onAddPoint={handleAddPoint}
          onUndoPoint={handleUndoPoint}
          onClearPoints={handleClearPlot}
        />

        <AreaCalculator
          pointCount={plotPoints.length}
          landAreaSqFt={landAreaSqFt}
          usableAreaSqFt={usableAreaSqFt}
        />

        <InputForm requirements={requirements} onChange={handleRequirementChange} />

        <LayoutGenerator
          landAreaSqFt={landAreaSqFt}
          usableAreaSqFt={usableAreaSqFt}
          requirements={requirements}
          layoutResult={layoutResult}
          onGenerate={handleGenerateLayout}
        />

        <LayoutView layout={layoutResult} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 18,
    paddingBottom: 32,
    gap: 18,
  },
  header: {
    gap: 8,
  },
  kicker: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 22,
  },
});
