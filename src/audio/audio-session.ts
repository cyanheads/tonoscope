/**
 * @fileoverview The audio session the page plays under, through the Audio Session API (Safari
 * 16.4+; elsewhere a no-op). iOS gives Web Audio the ambient session by default, which the
 * ring/silent switch mutes; 'playback' plays through it. A live microphone track is ended under any
 * type but 'auto' or 'play-and-record', so Sing switches to 'play-and-record' before opening one.
 * @module audio/audio-session
 */

export type AudioSessionType = 'playback' | 'play-and-record';

/** The part of `navigator.audioSession` used here; TypeScript's DOM library does not declare it. */
interface AudioSession {
  type: AudioSessionType;
}

export function setAudioSession(type: AudioSessionType): void {
  const { audioSession } = navigator as Navigator & { readonly audioSession?: AudioSession };
  if (audioSession) audioSession.type = type;
}
