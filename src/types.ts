export interface Fx { brightness: number; contrast: number; saturate: number; grayscale: number; sepia: number; hue: number; blur: number }
export interface Crop { l: number; t: number; r: number; b: number }   // fractions of the source cut from each side

export type Kind = 'video' | 'text' | 'audio';
export type Aspect = '16:9' | '9:16' | '1:1';

/** A timeline row. Tracks are listed top to bottom; higher rows draw in front of lower ones. */
export interface TrackDef {
  id: string; kind: Kind; name: string;
  main?: boolean;   // the main video track is sequential: clips sit end to end with no gaps
  off?: boolean;    // hidden (video/text) or muted (audio)
}

export interface Kf { t: number; v: number }   // t is seconds from the start of the clip
export type TransType = 'none' | 'fade' | 'dip' | 'wipe' | 'slide' | 'push' | 'zoom';
interface Base {
  id: string; kind: Kind; track: string; start: number;
  kf?: Record<string, Kf[]>;   // keyframes per animated property; a property without an entry uses its plain value
}
export interface VideoClip extends Base {
  kind: 'video'; mediaId: string; in: number; out: number; speed: number;
  volume: number; mute: boolean; fit: 'contain' | 'cover'; fadeIn: number; fadeOut: number; f: Fx;
  x: number; y: number; scale: number; rot: number; opacity: number; crop: Crop;   // x,y are the centre, as fractions of the frame
  trans?: { type: TransType; dur: number };   // main track only: how this clip arrives from the one before it
}
export interface TextClip extends Base {
  kind: 'text'; text: string; dur: number; x: number; y: number; size: number; rot: number;
  font: string; bold: boolean; color: string; bg: boolean; bgColor: string; anim: 'none' | 'fade' | 'slide' | 'pop';
  cap?: boolean;   // generated from a transcript; replaced when captions are updated
}
export interface AudioClip extends Base { kind: 'audio'; mediaId: string; in: number; out: number; volume: number; fadeIn: number; fadeOut: number }
export type Clip = VideoClip | TextClip | AudioClip;

/** One recognised word, timed in seconds from the start of its source file. */
export interface Word { s: number; e: number; w: string }

export interface Project { v: 2; aspect: Aspect; tracks: TrackDef[]; clips: Clip[] }

export interface Media {
  id: string; name: string; kind: 'video' | 'audio' | 'image' | 'gen';
  duration: number;            // Infinity for stills and generated clips
  size?: number; file?: Blob; url?: string; img?: HTMLImageElement; gen?: string; thumb?: string;
  strip?: string; stripN?: number;   // filmstrip sprite: stripN frames of 64x36 side by side
  wave?: string;                     // waveform image covering the whole file
  words?: Word[];                    // transcript, once the file has been transcribed
  missing?: boolean;                 // referenced by the project but the file is not stored on this device
}

/** Where a visual clip landed on the canvas, for hit testing and the transform handles. */
export interface Box { id: string; cx: number; cy: number; w: number; h: number; rot: number }
