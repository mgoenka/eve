import { createContext, useContext } from 'react';

// App.tsx owns APP_RULES and renders the kit's RulesOverlay and the Settings
// sheet; any screen's header opens them through this context.
export const RulesContext = createContext<{ open: () => void; openSettings: () => void }>({
  open: () => {},
  openSettings: () => {},
});

export function useOpenRules(): () => void {
  return useContext(RulesContext).open;
}

export function useOpenSettings(): () => void {
  return useContext(RulesContext).openSettings;
}
