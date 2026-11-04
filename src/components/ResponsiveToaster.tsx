"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { AlertCircle, AlertTriangle, Check, Info } from "lucide-react";

/**
 * Desktop toast breakpoint: the canonical lg boundary shared with
 * globals.css ([data-sonner-toaster] mobile header offset) and
 * usePosterSave.saveSuccessToastPosition. Below lg the global top-center
 * mobile contract holds; at/above lg every toast goes bottom-right.
 */
const MOBILE_TOAST_QUERY = "(max-width: 1023.5px)";

function useIsDesktopToastViewport(): boolean {
  // SSR-safe default: top-center (mobile contract) until the client
  // media query resolves on mount — before any user-fired toast can exist.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_TOAST_QUERY);
    const sync = () => setIsDesktop(!mq.matches);
    sync();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", sync);
      return () => mq.removeEventListener("change", sync);
    }
  }, []);
  return isDesktop;
}

export function ResponsiveToaster() {
  const isDesktop = useIsDesktopToastViewport();
  return (
    <Toaster
      // ALL desktop toasts bottom-right (every producer inherits this);
      // below lg the global top-center section is unchanged, so mobile
      // keeps its header-clearing offset from globals.css untouched.
      position={isDesktop ? "bottom-right" : "top-center"}
      duration={3000}
      // Gap canonico della pillola (sonner lo scrive come inline `--gap`:
      // passarlo qui è l'unico punto che vince sulla stylesheet).
      gap={12}
      // Burst di click ripetuti: mostra l'intero stack (sonner default 3
      // nasconderebbe i toast oltre il terzo finché i primi non scadono).
      visibleToasts={5}
      closeButton={false}
      richColors={false}
      icons={{
        success: <Check className="w-3.5 h-3.5 stroke-[2.5]" />,
        info: <Info className="w-3.5 h-3.5 stroke-[2.5]" />,
        warning: <AlertTriangle className="w-3.5 h-3.5 stroke-[2.5]" />,
        error: <AlertCircle className="w-3.5 h-3.5 stroke-[2.5]" />,
      }}
    />
  );
}
