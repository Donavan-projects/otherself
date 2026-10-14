import { defineConfig } from 'wxt';

export default defineConfig({
  // Manifest V3 pour toutes les cibles (WXT utilise MV2 par défaut sur Firefox).
  manifestVersion: 3,
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'fr',
    // Règle 6 : activeTab + injection à la demande, jamais de host_permissions.
    permissions: ['activeTab'],
  },
});
