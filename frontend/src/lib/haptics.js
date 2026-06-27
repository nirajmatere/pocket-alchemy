export const haptic = (ms = 30) => {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (_) {}
};

export const hapticLight = () => haptic(20);
export const hapticMedium = () => haptic(50);
export const hapticHeavy = () => haptic([60, 30, 60]);
export const hapticSuccess = () => haptic([30, 20, 60]);
