function buildFeatureFlags(isWayland, isNvidia) {
  return [
    ...(!isNvidia ? ['VaapiVideoDecoder'] : []),
    'SharedArrayBuffer',
    'CrossOriginOpenerPolicy',
    ...(isWayland ? ['WebRTCPipeWireCapturer'] : []),
  ].join(',');
}

module.exports = { buildFeatureFlags };
