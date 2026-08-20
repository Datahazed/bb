/**
 * Fingerprint inputs for the `fingerprint` runtimeVersion policy (app.json).
 *
 * The fingerprint decides which binaries an `eas update` can reach: an update
 * is published for one runtime version and installs only on builds with the
 * same one. By default the fingerprint hashes the whole evaluated Expo config,
 * including `version`. That is wrong here, because
 * .github/workflows/mobile-ios-eas.yml rewrites `version` on every nightly
 * with the npm version. Each nightly would then fork the runtime version, and
 * an update would reach only the one build made from that exact version.
 *
 * `ExpoConfigVersions` drops `version`, `ios.buildNumber` and
 * `android.versionCode` from the hash. Those fields change no native code, so
 * a build differing only by version stays update-compatible.
 */
module.exports = {
  sourceSkips: ["ExpoConfigVersions"],
};
