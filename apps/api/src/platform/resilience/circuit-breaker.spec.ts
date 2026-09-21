import { PlatformBus } from '../observability/platform-bus';
import { CircuitBreakerRegistry, CircuitOpenError } from './circuit-breaker';

/** Pure unit tests: the breaker's state machine, with a real bus so transitions are observable. */
describe('CircuitBreakerRegistry', () => {
  const failing = () => Promise.reject(new Error('503'));
  const ok = () => Promise.resolve('fine');

  function make(cooldownMs = 50) {
    const bus = new PlatformBus();
    const transitions: string[] = [];
    bus.subscribe((s) => {
      if (s.kind === 'breaker') transitions.push(s.state);
    });
    const registry = new CircuitBreakerRegistry(bus);
    registry.configure('books', { failureThreshold: 3, cooldownMs });
    return { registry, transitions };
  }

  it('opens after the threshold of transient failures and refuses calls while open', async () => {
    const { registry, transitions } = make();
    for (let i = 0; i < 3; i += 1) await expect(registry.execute('books', failing)).rejects.toThrow('503');
    expect(registry.stateOf('books')).toBe('open');
    await expect(registry.execute('books', ok)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(transitions).toEqual(['open']);
  });

  it('does not count failures the caller says are not transient', async () => {
    const { registry } = make();
    for (let i = 0; i < 5; i += 1) await expect(registry.execute('books', failing, () => false)).rejects.toThrow('503');
    expect(registry.stateOf('books')).toBe('closed');
  });

  it('goes half-open after the cooldown, closes on a successful probe, re-opens on a failed one', async () => {
    const { registry, transitions } = make(30);
    for (let i = 0; i < 3; i += 1) await expect(registry.execute('books', failing)).rejects.toThrow('503');
    await new Promise((r) => setTimeout(r, 40));
    expect(registry.stateOf('books')).toBe('half-open');
    await expect(registry.execute('books', failing)).rejects.toThrow('503');
    expect(registry.stateOf('books')).toBe('open');
    await new Promise((r) => setTimeout(r, 40));
    await expect(registry.execute('books', ok)).resolves.toBe('fine');
    expect(registry.stateOf('books')).toBe('closed');
    expect(transitions).toEqual(['open', 'half-open', 'open', 'half-open', 'closed']);
  });

  it('reset closes the circuit and clears the count', async () => {
    const { registry } = make();
    for (let i = 0; i < 3; i += 1) await expect(registry.execute('books', failing)).rejects.toThrow('503');
    registry.reset('books');
    expect(registry.stateOf('books')).toBe('closed');
    expect(registry.snapshot()['books']?.consecutiveFailures).toBe(0);
  });
});
