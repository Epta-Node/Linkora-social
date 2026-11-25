# Mobile Developer Guide

## Local Expo setup

1. Install Node.js 20+, pnpm, and the Expo CLI.
2. From the repository root, run `pnpm install`.
3. Start the mobile app with `pnpm --filter @linkora/mobile dev`.
4. Press `a` for Android or `i` for iOS when a simulator is installed.

Copy the mobile environment template before starting the app and keep secrets in local environment files only.

## EAS Build setup

Install and authenticate the EAS CLI:

```bash
pnpm add --global eas-cli
eas login
eas project:init
```

Set app identifiers and build-time variables in `eas.json` and the Expo project configuration. Use EAS environment variables for values that differ by environment; do not commit private keys or production secrets.

```bash
eas build --platform android --profile preview
eas build --platform ios --profile preview
eas build --platform all --profile production
```

Android preview builds produce installable tester artifacts. iOS preview builds require a registered device or an appropriate Apple signing profile. Production builds require the store credentials configured in the EAS project.

### Environment variables

Create variables in the EAS project and select the matching environment:

```bash
eas env:create --name EXPO_PUBLIC_SOROBAN_RPC_URL --value https://rpc.example --environment preview
eas env:create --name EXPO_PUBLIC_LINKORA_CONTRACT_ID --value C... --environment preview
```

Only variables prefixed with `EXPO_PUBLIC_` are safe to expose to the mobile bundle. Keep signing credentials, API tokens, and private keys in EAS-managed secrets.

## Troubleshooting

- **`eas: command not found`** — install `eas-cli` globally or invoke it with `pnpm dlx eas-cli`.
- **Project is not configured** — run `eas project:init` from the mobile app directory and commit the generated project identifiers.
- **Environment variable is missing** — confirm it exists in the selected EAS environment and rebuild; changing EAS variables does not update an existing binary.
- **Android signing failure** — verify the package name and Android credentials in the EAS project.
- **iOS provisioning failure** — register the device for preview builds or use a distribution profile for production builds.
- **Build queue or service failure** — run `eas build:list`, inspect the failed job logs, and retry after correcting the reported configuration.
