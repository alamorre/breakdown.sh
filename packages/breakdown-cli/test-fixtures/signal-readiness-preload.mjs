import { closeSync, writeSync } from 'node:fs';

const readinessFileDescriptor = 3;
const requestedSignal = process.env.BREAKDOWN_TEST_WINDOWS_SIGNAL;
delete process.env.BREAKDOWN_TEST_WINDOWS_SIGNAL;
if (
  requestedSignal !== undefined &&
  requestedSignal !== 'SIGINT' &&
  requestedSignal !== 'SIGTERM'
) {
  throw new Error('BREAKDOWN_TEST_WINDOWS_SIGNAL must be SIGINT or SIGTERM.');
}

function signalReadinessWhenHandlersAreActive() {
  if (process.listenerCount('SIGINT') > 0 && process.listenerCount('SIGTERM') > 0) {
    // The CLI registers both handlers synchronously before its first await.
    // Observing them from this event-loop turn therefore also proves that the
    // valid `operate` invocation has yielded while reading the still-open stdin.
    writeSync(readinessFileDescriptor, 'ready\n');
    closeSync(readinessFileDescriptor);
    if (requestedSignal !== undefined) {
      // Windows subprocess.kill() always terminates abruptly instead of
      // delivering either signal to Node's installed listeners.
      process.emit(requestedSignal);
    }
    return;
  }
  setImmediate(signalReadinessWhenHandlersAreActive);
}

setImmediate(signalReadinessWhenHandlersAreActive);
