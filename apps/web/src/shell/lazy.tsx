import { type ComponentType, lazy, type LazyExoticComponent, type ReactNode, Suspense } from "react";
import { useI18n } from "../i18n/i18n";

/**
 * Purpose: a component from a module that is downloaded only when the component is first shown, so big screens
 * and editors stay out of the first download.
 * Inputs: the module's dynamic import and the name of the component it exports.
 */
export function lazyNamed<M, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): LazyExoticComponent<ComponentType<PropsOf<M[K]>>> {
  return lazy(async () => ({ default: (await load())[name] as ComponentType<PropsOf<M[K]>> }));
}

type PropsOf<C> = C extends ComponentType<infer P> ? P : never;

/** Purpose: shows "Loading…" while a screen's code downloads. */
export function LoadingScreen({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6 text-slate-500">
          {t("common.loading")}
        </p>
      }
    >
      {children}
    </Suspense>
  );
}
