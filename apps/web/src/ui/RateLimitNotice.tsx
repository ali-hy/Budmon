// F-214: the rate-limit gate and its notice (J-3).
import { createSignal, onCleanup, type Accessor, type JSX } from "solid-js";
import { messages } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";

export function createRateLimitGate(now: () => number = Date.now): {
  blockedFor: Accessor<number>;
  block(retryAfterSeconds: number): void;
} {
  const [expiresAt, setExpiresAt] = createSignal(0);
  const [tick, setTick] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };
  onCleanup(stop);

  const blockedFor = () => {
    tick();
    return Math.max(0, Math.ceil((expiresAt() - now()) / 1000));
  };

  return {
    blockedFor,
    block(retryAfterSeconds) {
      setExpiresAt(now() + retryAfterSeconds * 1000);
      stop();
      timer = setInterval(() => {
        setTick((n) => n + 1);
        if (blockedFor() === 0) stop();
      }, 1000);
    },
  };
}

export function RateLimitNotice(props: { secondsLeft: number }): JSX.Element {
  const { t } = useI18n();
  return (
    <p role="status">
      {t(messages.errorRateLimited, { minutes: Math.ceil(props.secondsLeft / 60) })}
    </p>
  );
}
