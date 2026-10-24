// Pistes locales de l'onglet (monde MAIN) : micro et caméra injectés, voix de l'avatar,
// partage d'écran, pistes produites par la page elle-même (Web Audio, captureStream).
// Elles ne doivent jamais être prises pour le son du recruteur : la capture de secours
// (éléments média, sources Web Audio) les écarte. Les copies (clone) restent locales.

const local = new WeakSet<MediaStreamTrack>();
let installed = false;

export function markLocal<T extends MediaStreamTrack>(track: T): T {
  local.add(track);
  return track;
}

function markStream(stream: MediaStream) {
  for (const track of stream.getTracks()) local.add(track);
  return stream;
}

export function isLocal(track: MediaStreamTrack): boolean {
  return local.has(track);
}

/** À installer avant que la plateforme ne demande caméra et micro. */
export function installLocalTrackHooks() {
  if (installed) return;
  installed = true;

  const trackProto = MediaStreamTrack.prototype;
  const cloneTrack = trackProto.clone;
  trackProto.clone = function (this: MediaStreamTrack) {
    const copy = cloneTrack.call(this);
    if (local.has(this)) local.add(copy);
    return copy;
  };

  const streamProto = MediaStream.prototype;
  const cloneStream = streamProto.clone;
  streamProto.clone = function (this: MediaStream) {
    const originals = this.getTracks();
    const copy = cloneStream.call(this);
    // Le clone garde l'ordre des pistes.
    copy.getTracks().forEach((track, index) => {
      if (originals[index] && local.has(originals[index])) local.add(track);
    });
    return copy;
  };

  // Son fabriqué par la page (traitement du micro, par exemple) : local.
  const createDestination = AudioContext.prototype.createMediaStreamDestination;
  AudioContext.prototype.createMediaStreamDestination = function (this: AudioContext) {
    const node = createDestination.call(this);
    markStream(node.stream);
    return node;
  };

  const mediaCapture = HTMLMediaElement.prototype as HTMLMediaElement & { captureStream?: () => MediaStream };
  const captureMedia = mediaCapture.captureStream;
  if (captureMedia) {
    mediaCapture.captureStream = function (this: HTMLMediaElement) {
      return markStream(captureMedia.call(this));
    };
  }

  const devices = MediaDevices.prototype;
  const getDisplayMedia = devices.getDisplayMedia;
  if (getDisplayMedia) {
    devices.getDisplayMedia = async function (this: MediaDevices, ...args: Parameters<typeof getDisplayMedia>) {
      return markStream(await getDisplayMedia.apply(this, args));
    };
  }
}
