const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

// Project root and monorepo root
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(__dirname);

// Configure SVG transformer
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};

// Force Metro to resolve React from mobile app's node_modules to avoid multiple instances
const mobileNodeModules = path.resolve(projectRoot, 'node_modules');

// Modules that should always resolve from mobile's node_modules
// This prevents duplicate React instances when bundling shared packages
const forcedModules = ['react', 'react-native', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

// Node.js built-in modules that don't exist in React Native.
// Some deps (e.g. expensify-common) import these for their CLI code paths,
// which never run in the RN runtime. We stub them to an empty module so Metro
// can bundle without "Unable to resolve module" errors.
const nodeBuiltinsStub = path.resolve(projectRoot, 'lib', 'empty-module.js');
const nodeBuiltins = [
  'readline',
  'fs',
  'path',
  'os',
  'child_process',
  'crypto',
  'stream',
  'http',
  'https',
  'net',
  'tls',
  'zlib',
  'url',
  'util',
  'querystring',
];

config.resolver = {
  ...config.resolver,
  assetExts: config.resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: [...config.resolver.sourceExts, 'svg'],
  // Watch additional paths in monorepo
  nodeModulesPaths: [mobileNodeModules, path.resolve(monorepoRoot, 'node_modules')],
  // Ensure packages/shared code is included
  watchFolders: [path.resolve(monorepoRoot, 'packages/shared')],
  // Force resolve React and react-native from mobile's node_modules
  extraNodeModules: {
    'react': path.resolve(mobileNodeModules, 'react'),
    'react-native': path.resolve(mobileNodeModules, 'react-native'),
    '@kortix/shared': path.resolve(monorepoRoot, 'packages/shared'),
    // Stub Node.js built-ins so deps that import them (for CLI paths) don't break bundling
    ...Object.fromEntries(nodeBuiltins.map((m) => [m, nodeBuiltinsStub])),
  },
  // Custom resolver to force React resolution from mobile's node_modules
  // This is critical for monorepo setups where shared packages use React hooks
  resolveRequest: (context, moduleName, platform) => {
    // Check if this module should be forced to resolve from mobile's node_modules
    if (forcedModules.includes(moduleName)) {
      return {
        filePath: require.resolve(moduleName, { paths: [mobileNodeModules] }),
        type: 'sourceFile',
      };
    }
    // Stub Node.js built-ins that don't exist in RN
    if (nodeBuiltins.includes(moduleName)) {
      return {
        filePath: nodeBuiltinsStub,
        type: 'sourceFile',
      };
    }
    // Fall back to default resolution
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
