import { createContext, useContext, useMemo, useState } from "react";

const BG_IMAGES = 6; // bg1 .. bg6

function randomBgIndex(): number {
  return 1 + Math.floor(Math.random() * BG_IMAGES);
}

type BackgroundContextValue = {
  bgIndex: number;
};

const BackgroundContext = createContext<BackgroundContextValue | null>(null);

export function BackgroundProvider({ children }: { children: React.ReactNode }) {
  const [bgIndex] = useState(() => randomBgIndex());
  const value = useMemo(() => ({ bgIndex }), [bgIndex]);
  return (
    <BackgroundContext.Provider value={value}>
      {children}
    </BackgroundContext.Provider>
  );
}

export function useBackground() {
  const ctx = useContext(BackgroundContext);
  return ctx;
}
