export const ROOM_RULES = {
  bedroom: {
    label: 'Bedroom',
    minArea: 120,
    maxArea: 180,
    preferredArea: 150,
    color: '#F6D5A8',
  },
  bathroom: {
    label: 'Bathroom',
    minArea: 40,
    maxArea: 60,
    preferredArea: 50,
    color: '#BFDFF5',
  },
  kitchen: {
    label: 'Kitchen',
    minArea: 80,
    maxArea: 120,
    preferredArea: 100,
    color: '#CFE2B3',
  },
  hall: {
    label: 'Hall',
    minArea: 150,
    maxArea: 300,
    preferredArea: 225,
    color: '#F3B6A6',
  },
};

export const ROOM_RULE_LIST = Object.values(ROOM_RULES);
