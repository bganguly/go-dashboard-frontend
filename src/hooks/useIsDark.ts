
import { useEffect, useState } from "react";

/**
 * Tracks whether the `dark` class is currently set on <html>, so non-Tailwind
 * surfaces (e.g. recharts SVG, which can't use `dark:` utilities) can pick
 * appropriate colors. Updates live via a MutationObserver on the class attr.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export default useIsDark;
