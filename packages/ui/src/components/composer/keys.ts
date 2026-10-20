/**
 * Whether a submitted message steers the running turn (adds to it) or queues behind it, given the
 * user's preferred default. When nothing is running the message just sends, so this is always false.
 */
export function resolveSteer(running: boolean, modPressed: boolean, steerByDefault: boolean): boolean {
  if (!running) {
    return false;
  }
  return modPressed !== steerByDefault;
}
