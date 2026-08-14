"use client";

import { useEffect } from "react";

let bodyLockCount = 0;
let previousBodyOverflow = "";
let previousBodyPaddingRight = "";
let previousBodyOverscrollBehavior = "";

export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    const body = document.body;
    if (bodyLockCount === 0) {
      previousBodyOverflow = body.style.overflow;
      previousBodyPaddingRight = body.style.paddingRight;
      previousBodyOverscrollBehavior = body.style.overscrollBehavior;
      const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "none";
      if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    }
    bodyLockCount += 1;

    return () => {
      bodyLockCount = Math.max(0, bodyLockCount - 1);
      if (bodyLockCount > 0) return;
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
      body.style.overscrollBehavior = previousBodyOverscrollBehavior;
    };
  }, [locked]);
}
