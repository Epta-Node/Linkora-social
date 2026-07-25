// Jest setup for React Native testing
import "react-native-gesture-handler/jestSetup";

// react-native-reanimated v4's own mock.js pulls in react-native-worklets' real
// native-module bootstrap, which throws outside a device/simulator. Stub both
// packages with plain JS so no native binding is ever touched in tests.
jest.mock("react-native-worklets", () => ({
  __esModule: true,
  runOnJS: (fn: unknown) => fn,
  runOnUI: (fn: unknown) => fn,
}));

jest.mock("react-native-reanimated", () => {
  const RN = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: {
      View: RN.View,
      Text: RN.Text,
      Image: RN.Image,
      ScrollView: RN.ScrollView,
      createAnimatedComponent: (c: unknown) => c,
    },
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    withRepeat: (v: unknown) => v,
    withSequence: (...args: unknown[]) => args[0],
    Easing: { linear: (t: unknown) => t, inOut: (fn: unknown) => fn, ease: 0 },
    cancelAnimation: jest.fn(),
    interpolate: (_v: unknown, _in: unknown, out: unknown[]) => out[0],
    Extrapolation: { CLAMP: "clamp" },
    runOnJS: (fn: unknown) => fn,
    createAnimatedComponent: (c: unknown) => c,
  };
});

// Mock react-native-svg — prevents TurboModuleRegistry.getEnforcing crash in Jest.
// lucide-react-native renders via react-native-svg; stubbing it here covers both.
jest.mock("react-native-svg", () => {
  const stub = () => null;
  return {
    __esModule: true,
    default: stub,
    Svg: stub,
    Circle: stub,
    Ellipse: stub,
    G: stub,
    Text: stub,
    TSpan: stub,
    TextPath: stub,
    Path: stub,
    Polygon: stub,
    Polyline: stub,
    Line: stub,
    Rect: stub,
    Use: stub,
    Image: stub,
    Symbol: stub,
    Defs: stub,
    LinearGradient: stub,
    RadialGradient: stub,
    Stop: stub,
    ClipPath: stub,
    Pattern: stub,
    Mask: stub,
    ForeignObject: stub,
  };
});

// Mock lucide-react-native — each named icon export becomes a no-op component.
// Using a Proxy avoids listing every icon individually.
jest.mock(
  "lucide-react-native",
  () =>
    new Proxy(
      { __esModule: true },
      {
        get: (_target: Record<string, unknown>, name: string) => {
          if (name === "__esModule") return true;
          return () => null;
        },
      }
    )
);

// Global test timeout
jest.setTimeout(10000);

// Suppress console warnings during tests
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("Warning: ReactDOM.render is deprecated")) {
    return;
  }
  originalWarn.call(console, ...args);
};

// Mock expo-secure-store
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// Mock expo-notifications
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: "granted" })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: "ExponentPushToken[dummy]" })),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  removeNotificationSubscription: jest.fn(),
  AndroidImportance: {
    MAX: 4,
  },
}));

jest.mock(
  "expo-haptics",
  () => ({
    impactAsync: jest.fn(() => Promise.resolve()),
    ImpactFeedbackStyle: {
      Light: "light",
    },
  }),
  { virtual: true }
);
