declare module "expo-haptics" {
  export enum ImpactFeedbackStyle {
    Light = "light",
    Medium = "medium",
    Heavy = "heavy",
  }

  export function impactAsync(style?: ImpactFeedbackStyle): Promise<void>;
}
