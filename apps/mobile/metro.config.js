const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

// Workspace TypeScript packages use Node ESM-style `.js` extensions in their
// source imports (e.g. `export * from "./errors.js"`). Metro resolves against
// the *source* tree (not the compiled output), so it looks for a literal
// `errors.js` file that doesn't exist — only `errors.ts` does.
//
// This custom resolver intercepts requests whose origin is inside the monorepo
// packages/src directories: when the requested `.js` file doesn't exist on
// disk it retries with `.ts` (and `.tsx`) so Metro finds the real source file.
const defaultResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Only redirect plain relative `.js` imports that come from workspace source.
  if (
    moduleName.startsWith(".") &&
    moduleName.endsWith(".js") &&
    context.originModulePath.includes(path.join(workspaceRoot, "packages"))
  ) {
    const candidateJs = path.resolve(path.dirname(context.originModulePath), moduleName);
    if (!fs.existsSync(candidateJs)) {
      const tsVariant = candidateJs.replace(/\.js$/, ".ts");
      const tsxVariant = candidateJs.replace(/\.js$/, ".tsx");
      if (fs.existsSync(tsVariant)) {
        return context.resolveRequest(context, moduleName.replace(/\.js$/, ".ts"), platform);
      }
      if (fs.existsSync(tsxVariant)) {
        return context.resolveRequest(context, moduleName.replace(/\.js$/, ".tsx"), platform);
      }
    }
  }
  // Fall back to Metro's default resolver.
  if (defaultResolver) {
    return defaultResolver(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
