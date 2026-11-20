import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "./format";

/** Runs a change, shows its error as a toast, then reloads the page's data. */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function run<T>(work: () => Promise<T>, success?: string): Promise<T | undefined> {
    setPending(true);
    try {
      const result = await work();
      if (success) toast.success(success);
      await router.invalidate();
      return result;
    } catch (error) {
      toast.error(errorMessage(error));
      return undefined;
    } finally {
      setPending(false);
    }
  }
  return { run, pending };
}
