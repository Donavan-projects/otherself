// Banc d'essai de l'injection : simule l'activation de l'extension sur la page rehearsal
// (ouverte avec ?inject) avant que la page n'appelle getUserMedia. Avatar 3D si avatarRenderer vaut vrm dans
// config.local.json, ou avec ?inject&vrm.

import { mapAssets } from '@/lib/avatar';
import { buildAvatarAssets, renderMarkingText } from '@/lib/avatar-assets';
import { loadDemoConfig, localUrl } from '@/lib/config';
import { installFakeGetUserMedia } from '@/lib/inject';
import { pauseText } from '@/lib/injection-sources';
import { createLogger } from '@/lib/log';
import { createTestAudioTrack } from '@/lib/test-audio';
import { buildVrmAssets } from '@/lib/vrm-assets';

const log = createLogger('inject');

async function loadTestAudio(): Promise<ArrayBuffer | null> {
  const { testAudio } = await loadDemoConfig();
  if (!testAudio) return null;
  const response = await fetch(localUrl(testAudio));
  if (!response.ok) throw new Error(`son introuvable : ${testAudio} (${response.status})`);
  log(`son préenregistré chargé : ${testAudio}`);
  return response.arrayBuffer();
}

export async function setupInjectionTest() {
  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const config = await loadDemoConfig();
  const { assets } = await buildAvatarAssets(config);
  const avatar = await mapAssets(assets, (blob) => createImageBitmap(blob));
  const wantsVrm = config.avatarRenderer === 'vrm' || new URLSearchParams(location.search).has('vrm');
  const vrmAssets = wantsVrm ? await buildVrmAssets(config) : undefined;
  const vrm = vrmAssets && {
    model: await vrmAssets.model.arrayBuffer(),
    background: await createImageBitmap(vrmAssets.background),
    camera: vrmAssets.camera,
  };
  const audio = await loadTestAudio().catch((error: unknown) => {
    log(`son indisponible : ${describe(error)}`);
    return null;
  });
  installFakeGetUserMedia({
    avatar,
    vrm,
    marking: await createImageBitmap(await renderMarkingText(config.badgeText)),
    pauseText: pauseText(config.language),
    // Pas de pipeline ici : la bouche suit directement le son de test.
    initialState: 'parole',
    createAudioTrack: () => createTestAudioTrack(audio),
  });
}
