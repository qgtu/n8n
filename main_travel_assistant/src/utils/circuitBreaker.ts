/**
 * In-memory circuit breaker for external API services.
 * Used by: here.ts, weather.ts, directions.ts, llm.ts
 *
 * States: CLOSED (normal) → OPEN (tripped) → HALF_OPEN (probe)
 */

interface CircuitState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half_open';
}

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 30_000; // 30 seconds

const circuits = new Map<string, CircuitState>();

function getOrCreate(name: string): CircuitState {
  let circuit = circuits.get(name);
  if (!circuit) {
    circuit = { failures: 0, lastFailureTime: 0, state: 'closed' };
    circuits.set(name, circuit);
  }
  return circuit;
}

/**
 * Returns true if the circuit allows requests (CLOSED or HALF_OPEN probe).
 */
export function isCircuitClosed(name: string): boolean {
  const c = getOrCreate(name);

  if (c.state === 'closed') return true;

  if (c.state === 'open') {
    if (Date.now() - c.lastFailureTime >= COOLDOWN_MS) {
      c.state = 'half_open';
      return true; // allow one probe request
    }
    return false;
  }

  // half_open — already allowing probe
  return true;
}

/**
 * Record a successful API call. Resets the circuit to CLOSED.
 */
export function recordSuccess(name: string): void {
  const c = getOrCreate(name);
  c.failures = 0;
  c.state = 'closed';
}

/**
 * Record a failed API call. Opens circuit after threshold.
 */
export function recordFailure(name: string): void {
  const c = getOrCreate(name);
  c.failures += 1;
  c.lastFailureTime = Date.now();
  if (c.failures >= FAILURE_THRESHOLD) {
    c.state = 'open';
  }
}
