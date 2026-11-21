import { createContext, useContext } from 'react';

// App.tsx owns APP_RULES and renders the kit's RulesOverlay; any screen's
// header opens it through this context.
export const RulesContext = createContext<{ open: () => void }>({ open: () => {} });

export function useOpenRules(): () => void {
  return useContext(RulesContext).open;
}
