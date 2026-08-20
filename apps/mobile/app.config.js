/**
 * Expo reads app.json first and passes it here as `config`, so app.json stays
 * the single description of the app and this file only applies build-time
 * overrides.
 *
 * `BB_DISABLE_UPDATES=1` turns the expo-updates client off in the built
 * binary. The Mobile E2E workflow builds the app in Release, and a Release
 * binary with updates enabled asks the production channel for a new bundle at
 * launch. That bundle would replace the embedded E2E bundle in the middle of a
 * Maestro flow, and the failures would look random. The E2E build is never
 * distributed, so it needs no update client.
 */
module.exports = ({ config }) => {
  if (process.env.BB_DISABLE_UPDATES !== "1") {
    return config;
  }

  return {
    ...config,
    updates: { ...config.updates, enabled: false },
  };
};
