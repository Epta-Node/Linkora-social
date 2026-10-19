declare module "expo-haptics" {
  export enum ImpactFeedbackStyle {
    Light = "light",
    Medium = "medium",
    Heavy = "heavy",
  }

  export function impactAsync(style?: ImpactFeedbackStyle): Promise<void>;
  export enum NotificationFeedbackType {
    Success = "success",
    Error = "error",
  }
  export function notificationAsync(type?: NotificationFeedbackType): Promise<void>;
}
