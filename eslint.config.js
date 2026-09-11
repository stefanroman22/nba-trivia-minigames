import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  // Only lint the frontend; the Python backend (incl. its venv) and the separate
  // multiplayer_server Node package are not part of this app's lint scope.
  globalIgnores(['dist', 'dist-server', '.next', 'next-env.d.ts', 'backend', 'multiplayer_server']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'react/prop-types': 'off', // Disable PropTypes checking
      // Next route files export their metadata/config next to the page component.
      'react-refresh/only-export-components': ['error', {
        allowConstantExport: true,
        allowExportNames: ['metadata', 'generateMetadata', 'generateStaticParams', 'dynamicParams', 'dynamic', 'revalidate', 'viewport', 'generateViewport'],
      }],
    },
  },
])
