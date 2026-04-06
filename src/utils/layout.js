import { ROOM_RULES } from '../constants/roomRules';

const roundToSingleDecimal = (value) => Math.round(value * 10) / 10;

const parseWholeNumber = (value) => {
  const parsedValue = Number.parseInt(value ?? '0', 10);
  return Number.isFinite(parsedValue) ? Math.max(parsedValue, 0) : 0;
};

function createRooms(requirements) {
  const rooms = [];
  const bedroomCount = parseWholeNumber(requirements.bedrooms);
  const bathroomCount = parseWholeNumber(requirements.bathrooms);

  for (let index = 0; index < bedroomCount; index += 1) {
    rooms.push({
      id: `bedroom-${index + 1}`,
      name: `Bedroom ${index + 1}`,
      type: 'bedroom',
      ...ROOM_RULES.bedroom,
    });
  }

  for (let index = 0; index < bathroomCount; index += 1) {
    rooms.push({
      id: `bathroom-${index + 1}`,
      name: `Bathroom ${index + 1}`,
      type: 'bathroom',
      ...ROOM_RULES.bathroom,
    });
  }

  if (requirements.kitchen) {
    rooms.push({
      id: 'kitchen',
      name: 'Kitchen',
      type: 'kitchen',
      ...ROOM_RULES.kitchen,
    });
  }

  if (requirements.hall) {
    rooms.push({
      id: 'hall',
      name: 'Hall',
      type: 'hall',
      ...ROOM_RULES.hall,
    });
  }

  return rooms;
}

function summarizeRooms(rooms) {
  return rooms.reduce(
    (summary, room) => ({
      minimumAreaSqFt: summary.minimumAreaSqFt + room.minArea,
      preferredAreaSqFt: summary.preferredAreaSqFt + room.preferredArea,
      maximumAreaSqFt: summary.maximumAreaSqFt + room.maxArea,
    }),
    {
      minimumAreaSqFt: 0,
      preferredAreaSqFt: 0,
      maximumAreaSqFt: 0,
    }
  );
}

function allocateRoomAreas(rooms, usableAreaSqFt) {
  const workingRooms = rooms.map((room) => ({
    ...room,
    areaSqFt: room.minArea,
  }));

  let remainingArea = usableAreaSqFt - workingRooms.reduce((total, room) => total + room.areaSqFt, 0);

  // First push rooms toward their preferred size, then toward their max.
  [room => room.preferredArea, room => room.maxArea].forEach((targetGetter) => {
    workingRooms.forEach((room) => {
      const targetArea = targetGetter(room);
      if (remainingArea <= 0 || room.areaSqFt >= targetArea) {
        return;
      }

      const extraArea = Math.min(targetArea - room.areaSqFt, remainingArea);
      room.areaSqFt += extraArea;
      remainingArea -= extraArea;
    });
  });

  return {
    rooms: workingRooms,
    remainingAreaSqFt: remainingArea,
  };
}

function estimatePlotSize(usableAreaSqFt, plotAspectRatio) {
  const safeAspectRatio = Number.isFinite(plotAspectRatio) ? plotAspectRatio : 1;
  const plotWidthFt = Math.sqrt(usableAreaSqFt * safeAspectRatio);
  const plotHeightFt = usableAreaSqFt / plotWidthFt;

  return { plotWidthFt, plotHeightFt };
}

function scoreRoomShape(widthFt, heightFt) {
  const aspectRatio = Math.max(widthFt / heightFt, heightFt / widthFt);
  return Math.abs(aspectRatio - 1.4);
}

function buildCandidateLayout(rooms, plotWidthFt, columnCount) {
  const placedRooms = [];
  let cursorY = 0;
  let shapePenalty = 0;

  for (let startIndex = 0; startIndex < rooms.length; startIndex += columnCount) {
    const rowRooms = rooms.slice(startIndex, startIndex + columnCount);
    const rowAreaSqFt = rowRooms.reduce((total, room) => total + room.areaSqFt, 0);
    const rowHeightFt = rowAreaSqFt / plotWidthFt;
    let cursorX = 0;

    rowRooms.forEach((room) => {
      const roomWidthFt = room.areaSqFt / rowHeightFt;
      shapePenalty += scoreRoomShape(roomWidthFt, rowHeightFt);
      placedRooms.push({
        ...room,
        xFt: cursorX,
        yFt: cursorY,
        widthFt: roomWidthFt,
        heightFt: rowHeightFt,
        displayLengthFt: roundToSingleDecimal(Math.max(roomWidthFt, rowHeightFt)),
        displayWidthFt: roundToSingleDecimal(Math.min(roomWidthFt, rowHeightFt)),
      });
      cursorX += roomWidthFt;
    });

    cursorY += rowHeightFt;
  }

  return {
    placedRooms,
    usedHeightFt: cursorY,
    penalty: shapePenalty,
  };
}

function chooseBestLayout(rooms, usableAreaSqFt, plotAspectRatio) {
  const { plotWidthFt, plotHeightFt } = estimatePlotSize(usableAreaSqFt, plotAspectRatio);
  let bestCandidate = null;

  for (let columnCount = 1; columnCount <= rooms.length; columnCount += 1) {
    const candidate = buildCandidateLayout(rooms, plotWidthFt, columnCount);

    if (candidate.usedHeightFt > plotHeightFt + 0.01) {
      continue;
    }

    if (!bestCandidate || candidate.penalty < bestCandidate.penalty) {
      bestCandidate = candidate;
    }
  }

  return {
    plotWidthFt: roundToSingleDecimal(plotWidthFt),
    plotHeightFt: roundToSingleDecimal(plotHeightFt),
    usedHeightFt: roundToSingleDecimal(bestCandidate.usedHeightFt),
    rooms: bestCandidate.placedRooms.map((room) => ({
      ...room,
      xFt: roundToSingleDecimal(room.xFt),
      yFt: roundToSingleDecimal(room.yFt),
      widthFt: roundToSingleDecimal(room.widthFt),
      heightFt: roundToSingleDecimal(room.heightFt),
      areaSqFt: roundToSingleDecimal(room.areaSqFt),
      displayDimensions: `${room.displayLengthFt} ft x ${room.displayWidthFt} ft`,
    })),
  };
}

export function summarizeRoomRequest(requirements) {
  const rooms = createRooms(requirements);
  return {
    rooms,
    ...summarizeRooms(rooms),
  };
}

export function generateLayoutPlan({ usableAreaSqFt, plotAspectRatio, requirements }) {
  const normalizedUsableArea = Number.isFinite(usableAreaSqFt) ? usableAreaSqFt : 0;
  const summary = summarizeRoomRequest(requirements);

  if (normalizedUsableArea <= 0) {
    return {
      status: 'error',
      message: 'Select at least three map points so the land area can be calculated.',
    };
  }

  if (summary.rooms.length === 0) {
    return {
      status: 'error',
      message: 'Add at least one room before generating a layout.',
    };
  }

  if (summary.minimumAreaSqFt > normalizedUsableArea) {
    return {
      status: 'not_feasible',
      message: `Not feasible: minimum room area ${roundToSingleDecimal(
        summary.minimumAreaSqFt
      )} sq.ft exceeds usable area ${roundToSingleDecimal(normalizedUsableArea)} sq.ft.`,
      minimumAreaSqFt: roundToSingleDecimal(summary.minimumAreaSqFt),
      usableAreaSqFt: roundToSingleDecimal(normalizedUsableArea),
    };
  }

  const allocatedPlan = allocateRoomAreas(summary.rooms, normalizedUsableArea);
  const layout = chooseBestLayout(
    allocatedPlan.rooms,
    normalizedUsableArea,
    plotAspectRatio
  );
  const totalRoomAreaSqFt = layout.rooms.reduce((total, room) => total + room.areaSqFt, 0);

  return {
    status: 'success',
    message: 'Layout generated successfully.',
    plotWidthFt: layout.plotWidthFt,
    plotHeightFt: layout.plotHeightFt,
    usedHeightFt: layout.usedHeightFt,
    rooms: layout.rooms,
    totalRoomAreaSqFt: roundToSingleDecimal(totalRoomAreaSqFt),
    unusedAreaSqFt: roundToSingleDecimal(normalizedUsableArea - totalRoomAreaSqFt),
  };
}
