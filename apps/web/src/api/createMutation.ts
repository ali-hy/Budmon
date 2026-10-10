// F-205: a create mutation with an idempotency key that survives retries of the same input.
import { canonicalJson } from "@budmon/shared";
import {
  createMutation,
  useQueryClient,
  type CreateMutationResult,
  type QueryKey,
} from "@tanstack/solid-query";

type Created = { id: string; createdAt: string };

export function createCreateMutation<I>(opts: {
  mutationFn: (input: I, idempotencyKey: string) => Promise<Created>;
  invalidate: readonly QueryKey[];
}): CreateMutationResult<Created, unknown, I> {
  const queryClient = useQueryClient();
  let key = crypto.randomUUID();
  /** The canonical input of the last call, while it hasn't succeeded. */
  let failedInput: string | undefined;
  /** The key the current call (and its automatic retries) uses. */
  let callKey = key;

  return createMutation(() => ({
    meta: { idempotent: true },
    mutationFn: (input: I) => opts.mutationFn(input, callKey),
    onMutate: (input: I) => {
      const canonical = canonicalJson(input);
      // A manual retry with unchanged input after a failure reuses the key; anything else is new.
      if (failedInput !== canonical) key = crypto.randomUUID();
      failedInput = canonical;
      callKey = key;
    },
    onSuccess: async () => {
      failedInput = undefined;
      await Promise.all(
        opts.invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  }));
}
