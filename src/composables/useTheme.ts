import { ref, watchEffect } from 'vue';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'kulkuri-theme';

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage unavailable (private browsing, blocked storage) - fall through.
  }
  // Dark is the app's intentional default, not a system-preference guess.
  return 'dark';
}

// Module-level so every component importing this shares one reactive theme.
const theme = ref<Theme>(readStoredTheme());

watchEffect(() => {
  document.documentElement.dataset.theme = theme.value;
  try {
    localStorage.setItem(STORAGE_KEY, theme.value);
  } catch {
    // Best effort - the toggle still works for the rest of the session.
  }
});

export function useTheme() {
  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  }

  return { theme, toggleTheme };
}
