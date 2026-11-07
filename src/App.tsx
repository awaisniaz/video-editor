import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Mp3Encoder } from '@breezystack/lamejs';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import {
  AudioBufferSource,
  BufferTarget,
  Mp4OutputFormat,
  Output,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from 'mediabunny';

let ffmpegReady: Promise<FFmpeg> | null = null;

const loadFfmpeg = () => {
  if (!ffmpegReady) {
    ffmpegReady = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript'),
        wasmURL: await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
      });
      return ffmpeg;
    })().catch((error) => {
      ffmpegReady = null;
      throw error;
    });
  }
  return ffmpegReady;
};

const audioBufferToWav = (buffer: AudioBuffer) => {
  const channels = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const samples = buffer.length;
  const dataSize = samples * channels * 2;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataSize, true);
  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][sampleIndex] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Uint8Array(out);
};
import {
  Upload, Image as ImageIcon, Music, Play, Pause, Download,
  Film, Clock, CheckCircle, Loader, Zap, Link2, FileText,
  RectangleHorizontal, RectangleVertical, AlertCircle,
  Trash2, ChevronUp, ChevronDown
} from 'lucide-react';

interface ImageItem {
  id: string;
  file: File;
  url: string;
  name: string;
  baseName: string; // filename without extension
  img: HTMLImageElement;
  loaded: boolean;
}

interface AudioItem {
  id: string;
  file: File;
  url: string;
  name: string;
  baseName: string; // filename without extension
  duration: number;
}

interface SyncedImage {
  image: ImageItem;
  audio: AudioItem;
  startTime: number;
  duration: number;
  effect: EffectType;
  caption?: string;
  audioOffset?: number;
}

interface SpeechPart {
  start: number;
  end: number;
}

interface VoicePartFile {
  name: string;
  url: string;
  duration: number;
}

interface Caption {
  text: string;
  startTime: number;
  endTime: number;
}

type EffectType = 'kenburns' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'fade';

const EFFECTS: EffectType[] = ['kenburns', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'fade'];

type Stage = 'idle' | 'uploading' | 'ready';
type VideoFormat = 'long' | 'reel';
type FitMode = 'cover' | 'contain';

interface ManualLink {
  imageId: string;
  audioId: string;
}

const getFrameSize = (format: VideoFormat, resolution: '720p' | '1080p') => {
  if (format === 'reel') {
    return resolution === '1080p' ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
  }
  return resolution === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
};

function pairByBaseName(images: ImageItem[], audios: AudioItem[], manualLinks: ManualLink[] = []) {
  const usedAudioIds = new Set<string>();
  const usedImageIds = new Set<string>();
  const pairs: { image: ImageItem; audio: AudioItem }[] = [];

  for (const link of manualLinks) {
    const image = images.find((item) => item.id === link.imageId);
    const audio = audios.find((item) => item.id === link.audioId);
    if (!image || !audio || usedImageIds.has(image.id) || usedAudioIds.has(audio.id)) continue;
    usedImageIds.add(image.id);
    usedAudioIds.add(audio.id);
    pairs.push({ image, audio });
  }

  for (const image of images) {
    if (usedImageIds.has(image.id)) continue;
    const audio = audios.find(
      (item) => item.baseName === image.baseName && !usedAudioIds.has(item.id)
    );
    if (audio) {
      usedImageIds.add(image.id);
      usedAudioIds.add(audio.id);
      pairs.push({ image, audio });
    }
  }

  return {
    pairs,
    imagesWithoutNarration: images.filter((image) => !usedImageIds.has(image.id)),
    narrationsWithoutImage: audios.filter((audio) => !usedAudioIds.has(audio.id)),
  };
}

function findSpeechParts(buffer: AudioBuffer, minSilenceSec: number): SpeechPart[] {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.02));
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  const rms: number[] = [];
  for (let index = 0; index < length; index += windowSize) {
    const end = Math.min(length, index + windowSize);
    let sum = 0;
    for (let sample = index; sample < end; sample++) {
      let mixed = 0;
      for (let channel = 0; channel < channels; channel++) mixed += data[channel][sample];
      mixed /= channels;
      sum += mixed * mixed;
    }
    rms.push(Math.sqrt(sum / (end - index)));
  }

  let peak = 0;
  for (const value of rms) if (value > peak) peak = value;
  if (peak < 0.001) return [];
  const threshold = Math.max(0.004, peak * 0.07);
  const minSilenceWindows = Math.max(1, Math.round(minSilenceSec / 0.02));
  const minSpeechWindows = Math.max(1, Math.round(0.25 / 0.02));
  const voiced = rms.map((value) => value >= threshold);

  let gapStart = -1;
  for (let index = 0; index <= voiced.length; index++) {
    const isGap = index < voiced.length && !voiced[index];
    if (isGap && gapStart < 0) gapStart = index;
    if (!isGap && gapStart >= 0) {
      const insideSpeech = gapStart > 0 && index < voiced.length;
      if (insideSpeech && index - gapStart < minSilenceWindows) {
        for (let fill = gapStart; fill < index; fill++) voiced[fill] = true;
      }
      gapStart = -1;
    }
  }

  const parts: SpeechPart[] = [];
  let speechStart = -1;
  for (let index = 0; index <= voiced.length; index++) {
    const speaking = index < voiced.length && voiced[index];
    if (speaking && speechStart < 0) speechStart = index;
    if (!speaking && speechStart >= 0) {
      if (index - speechStart >= minSpeechWindows) {
        parts.push({ start: speechStart * 0.02, end: Math.min(buffer.duration, index * 0.02) });
      }
      speechStart = -1;
    }
  }

  const tail = 0.45;
  return parts.map((part, index) => {
    const nextStart = parts[index + 1]?.start ?? buffer.duration;
    return {
      start: part.start,
      end: Math.max(part.end, Math.min(part.end + tail, nextStart - 0.02, buffer.duration)),
    };
  });
}

function sliceAudioBuffer(context: AudioContext, buffer: AudioBuffer, startSec: number, durationSec: number) {
  const rate = buffer.sampleRate;
  const start = Math.max(0, Math.min(buffer.length - 1, Math.floor(startSec * rate)));
  const length = Math.max(1, Math.min(buffer.length - start, Math.floor(durationSec * rate)));
  const sliced = context.createBuffer(buffer.numberOfChannels, length, rate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    sliced.getChannelData(channel).set(buffer.getChannelData(channel).subarray(start, start + length));
  }
  return sliced;
}

const MPEG_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index++) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files: { name: string; data: Uint8Array }[]) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const entry = new Uint8Array(46 + nameBytes.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(4, 20, true);
    entryView.setUint16(6, 20, true);
    entryView.setUint32(16, crc, true);
    entryView.setUint32(20, file.data.length, true);
    entryView.setUint32(24, file.data.length, true);
    entryView.setUint16(28, nameBytes.length, true);
    entryView.setUint32(42, offset, true);
    entry.set(nameBytes, 46);

    locals.push(local, file.data);
    central.push(entry);
    offset += local.length + file.data.length;
  }

  const centralSize = central.reduce((total, entry) => total + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const parts = [...locals, ...central, end].map((part) => {
    const copy = new ArrayBuffer(part.byteLength);
    new Uint8Array(copy).set(part);
    return copy;
  });
  return new Blob(parts, { type: 'application/zip' });
}

function encodeSliceToMp3(buffer: AudioBuffer, startSec: number, durationSec: number) {
  const srcRate = buffer.sampleRate;
  const dstRate = MPEG_RATES.has(srcRate) ? srcRate : 44100;
  const channels = Math.min(2, buffer.numberOfChannels);
  const srcStart = Math.max(0, Math.floor(startSec * srcRate));
  const srcLength = Math.max(1, Math.min(buffer.length - srcStart, Math.floor(durationSec * srcRate)));
  const dstLength = dstRate === srcRate ? srcLength : Math.max(1, Math.round((srcLength * dstRate) / srcRate));
  const encoder = new Mp3Encoder(channels, dstRate, 128);
  const block = 1152;
  const left = new Int16Array(block);
  const right = channels > 1 ? new Int16Array(block) : null;
  const chunks: Uint8Array[] = [];
  const channel0 = buffer.getChannelData(0);
  const channel1 = channels > 1 ? buffer.getChannelData(1) : channel0;

  const sampleAt = (data: Float32Array, index: number) => {
    if (dstRate === srcRate) {
      const position = srcStart + index;
      return position >= 0 && position < data.length ? data[position] : 0;
    }
    const srcPos = srcStart + (index * srcRate) / dstRate;
    const leftIndex = Math.floor(srcPos);
    const rightIndex = Math.min(data.length - 1, leftIndex + 1);
    const fraction = srcPos - leftIndex;
    const leftSample = leftIndex >= 0 && leftIndex < data.length ? data[leftIndex] : 0;
    const rightSample = rightIndex >= 0 && rightIndex < data.length ? data[rightIndex] : leftSample;
    return leftSample + (rightSample - leftSample) * fraction;
  };

  const toInt16 = (value: number) => {
    const clamped = Math.max(-1, Math.min(1, value));
    return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  };

  for (let index = 0; index < dstLength; index += block) {
    const count = Math.min(block, dstLength - index);
    for (let sample = 0; sample < count; sample++) {
      left[sample] = toInt16(sampleAt(channel0, index + sample));
      if (right) right[sample] = toInt16(sampleAt(channel1, index + sample));
    }
    const encoded = right
      ? encoder.encodeBuffer(left.subarray(0, count), right.subarray(0, count))
      : encoder.encodeBuffer(left.subarray(0, count));
    if (encoded.length > 0) chunks.push(Uint8Array.from(encoded));
  }

  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(Uint8Array.from(tail));
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let writeAt = 0;
  for (const chunk of chunks) {
    output.set(chunk, writeAt);
    writeAt += chunk.length;
  }
  return output;
}

function retimeClips(items: SyncedImage[]) {
  let startTime = 0;
  const next = items.map((item) => {
    const clip = { ...item, startTime };
    startTime += item.duration;
    return clip;
  });
  return { items: next, total: startTime };
}

export default function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [audios, setAudios] = useState<AudioItem[]>([]);
  const [syncedImages, setSyncedImages] = useState<SyncedImage[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoExt, setVideoExt] = useState('webm');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [format, setFormat] = useState<VideoFormat>('long');
  const [statusMsg, setStatusMsg] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [totalDuration, setTotalDuration] = useState(0);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [captionStyle, setCaptionStyle] = useState<'bottom' | 'top' | 'center'>('bottom');
  const [captionSize, setCaptionSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [captionColor, setCaptionColor] = useState<'white' | 'yellow' | 'cyan'>('white');
  const [manualLinks, setManualLinks] = useState<ManualLink[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<FitMode>('cover');
  const [fullNarration, setFullNarration] = useState<AudioItem | null>(null);
  const [silenceGap, setSilenceGap] = useState(0.4);
  const [isSplitting, setIsSplitting] = useState(false);
  const [voiceParts, setVoiceParts] = useState<VoicePartFile[]>([]);
  const [voiceZipUrl, setVoiceZipUrl] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const exportProgressTextRef = useRef<HTMLSpanElement>(null);
  const exportProgressBarRef = useRef<HTMLDivElement>(null);
  const exportClipsRef = useRef<SyncedImage[] | null>(null);
  const audioRefs = useRef<HTMLAudioElement[]>([]);
  const animFrameRef = useRef<number>(0);
  const currentAudioIndexRef = useRef<number>(0);
  const playTokenRef = useRef(0);

  const loadImage = (file: File): Promise<{ img: HTMLImageElement; url: string }> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve({ img, url });
      img.onerror = () => resolve({ img, url });
      img.src = url;
    });
  };

  const getBaseName = (filename: string): string => {
    return filename.replace(/\.[^/.]+$/, ''); // Remove extension
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    const newImages: ImageItem[] = [];
    
    for (const file of fileArray) {
      const { img, url } = await loadImage(file);
      newImages.push({
        id: Math.random().toString(36).substr(2, 9),
        file, url, name: file.name,
        baseName: getBaseName(file.name),
        img, loaded: true,
      });
    }
    
    setImages(prev => [...prev, ...newImages]);
    setStage('uploading');
    setStatusMsg(`${newImages.length} images uploaded`);
    e.target.value = '';
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const fileArray = Array.from(files).filter(f => f.type.startsWith('audio/'));
    const newAudios: AudioItem[] = [];
    
    for (const file of fileArray) {
      const url = URL.createObjectURL(file);
      newAudios.push({
        id: Math.random().toString(36).substr(2, 9),
        file, url, name: file.name,
        baseName: getBaseName(file.name),
        duration: 0,
      });
    }
    
    setAudios(prev => [...prev, ...newAudios]);
    setStage('uploading');
    setStatusMsg(`${newAudios.length} audio files uploaded`);
    e.target.value = '';
  };

  // Get audio duration
  const getAudioDuration = (url: string): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.src = url;
      audio.onloadedmetadata = () => {
        resolve(audio.duration);
      };
      audio.onerror = () => resolve(0);
    });
  };

  // Handle caption file upload (SRT or TXT format)
  const handleCaptionUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const parsedCaptions: Caption[] = [];

    // Try SRT format first
    const srtRegex = /(\d+)\n(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})\n([\s\S]*?)(?=\n\n|\n*$)/g;
    let match;
    
    while ((match = srtRegex.exec(text)) !== null) {
      const startTime = parseSrtTime(match[2]);
      const endTime = parseSrtTime(match[3]);
      const captionText = match[4].replace(/\n/g, ' ').trim();
      
      if (captionText) {
        parsedCaptions.push({
          text: captionText,
          startTime,
          endTime
        });
      }
    }

    // If no SRT format found, treat as simple text (one caption per line)
    if (parsedCaptions.length === 0) {
      const lines = text.split('\n').filter(line => line.trim());
      const durationPerCaption = totalDuration / lines.length;
      
      lines.forEach((line, idx) => {
        parsedCaptions.push({
          text: line.trim(),
          startTime: idx * durationPerCaption,
          endTime: (idx + 1) * durationPerCaption
        });
      });
    }

    setCaptions(parsedCaptions);
    setStatusMsg(`✓ ${parsedCaptions.length} captions loaded!`);
  };

  // Parse SRT time format (HH:MM:SS,mmm) to seconds
  const parseSrtTime = (timeStr: string): number => {
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const secondsParts = parts[2].split(',');
    const seconds = parseInt(secondsParts[0]);
    const milliseconds = parseInt(secondsParts[1]);
    
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  };

  // Match images with audios and sync
  const syncMedia = async () => {
    if (images.length === 0 || audios.length === 0) {
      setStatusMsg('Images aur audio files dono upload karein!');
      return;
    }

    setStatusMsg('Matching images with audio files...');

    // Get durations for all audios
    const audiosWithDuration = await Promise.all(
      audios.map(async (audio) => ({
        ...audio,
        duration: await getAudioDuration(audio.url)
      }))
    );

    const { pairs, imagesWithoutNarration, narrationsWithoutImage } = pairByBaseName(images, audiosWithDuration, manualLinks);
    const previousEffects = new Map(syncedImages.map((clip) => [clip.image.id, clip.effect]));
    const keptKeys = new Set<string>();
    const kept: SyncedImage[] = [];

    for (const clip of syncedImages) {
      const pair = pairs.find((item) => item.image.id === clip.image.id && item.audio.id === clip.audio.id);
      if (!pair || !pair.audio.duration) continue;
      kept.push({
        ...clip,
        audio: pair.audio,
        duration: pair.audio.duration,
        effect: previousEffects.get(clip.image.id) ?? clip.effect,
      });
      keptKeys.add(`${pair.image.id}:${pair.audio.id}`);
    }

    const added: SyncedImage[] = pairs
      .filter((pair) => pair.audio.duration && !keptKeys.has(`${pair.image.id}:${pair.audio.id}`))
      .sort((a, b) => a.image.baseName.localeCompare(b.image.baseName, undefined, { numeric: true }))
      .map((pair, index) => ({
        image: pair.image,
        audio: pair.audio,
        startTime: 0,
        duration: pair.audio.duration,
        effect: previousEffects.get(pair.image.id) ?? EFFECTS[(kept.length + index) % EFFECTS.length],
      }));

    const matched = [...kept, ...added];

    // Calculate start times
    let startTime = 0;
    const finalSynced = matched.map(item => {
      const syncItem = { ...item, startTime };
      startTime += item.duration;
      return syncItem;
    });

    setSyncedImages(finalSynced);
    setTotalDuration(startTime);
    setStage('ready');
    const missed = imagesWithoutNarration.length + narrationsWithoutImage.length;
    setStatusMsg(
      missed === 0
        ? `✓ ${finalSynced.length} pairs synced. Total ${formatTime(startTime)}`
        : `✓ ${finalSynced.length} pairs synced. ${imagesWithoutNarration.length} images have no narration, ${narrationsWithoutImage.length} narrations have no image.`
    );
  };

  const handleFullNarration = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('audio/')) return;
    if (fullNarration) URL.revokeObjectURL(fullNarration.url);
    const url = URL.createObjectURL(file);
    const duration = await getAudioDuration(url);
    setFullNarration({
      id: Math.random().toString(36).slice(2, 11),
      file,
      url,
      name: file.name,
      baseName: getBaseName(file.name),
      duration,
    });
    setVoiceParts((current) => {
      current.forEach((part) => URL.revokeObjectURL(part.url));
      return [];
    });
    setVoiceZipUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
    setStatusMsg('Voiceover ready. Mute par split karke 001.mp3 se download karo.');
  };

  const downloadSplitVoice = async () => {
    if (!fullNarration) {
      setStatusMsg('Pehle ek voiceover upload karein.');
      return;
    }

    setIsSplitting(true);
    setStatusMsg('Mute gaps dhoondh raha hoon…');
    const audioContext = new AudioContext();
    try {
      const decoded = await audioContext.decodeAudioData((await fullNarration.file.arrayBuffer()).slice(0));
      const parts = findSpeechParts(decoded, silenceGap);
      if (parts.length === 0) {
        setStatusMsg('Is audio mein awaz nahi mili.');
        return;
      }

      const files: { name: string; data: Uint8Array }[] = [];
      const downloads: VoicePartFile[] = [];
      for (let index = 0; index < parts.length; index++) {
        const name = `${String(index + 1).padStart(3, '0')}.mp3`;
        setStatusMsg(`${name} bana raha hoon… ${index + 1}/${parts.length}`);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        const part = parts[index];
        const duration = Math.max(0.1, part.end - part.start);
        const data = encodeSliceToMp3(decoded, part.start, duration);
        files.push({ name, data });
        downloads.push({
          name,
          url: URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' })),
          duration,
        });
      }

      const zipUrl = URL.createObjectURL(makeZip(files));
      setVoiceParts((current) => {
        current.forEach((part) => URL.revokeObjectURL(part.url));
        return downloads;
      });
      setVoiceZipUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return zipUrl;
      });
      const lastName = downloads[downloads.length - 1].name;
      setStatusMsg(`${downloads.length} files ready: 001.mp3 se ${lastName}. Inhen neeche Audio box mein upload karke images ke naam se match karo.`);
    } catch (error) {
      setStatusMsg(error instanceof Error ? error.message : 'Audio split nahi ho saki.');
    } finally {
      setIsSplitting(false);
      audioContext.close().catch(() => {});
    }
  };

  const splitFullNarration = async () => {
    if (images.length === 0) {
      setStatusMsg('Pehle neeche Images box mein saari images upload karein.');
      return;
    }
    if (!fullNarration) {
      setStatusMsg('Ek poori audio upload karein.');
      return;
    }

    setIsSplitting(true);
    setStatusMsg('Mute gaps dhoondh raha hoon…');
    const audioContext = new AudioContext();
    try {
      const decoded = await audioContext.decodeAudioData((await fullNarration.file.arrayBuffer()).slice(0));
      const parts = findSpeechParts(decoded, silenceGap);
      if (parts.length === 0) {
        setStatusMsg('Is audio mein awaz nahi mili.');
        return;
      }

      const ordered = [...images].sort((a, b) => a.baseName.localeCompare(b.baseName, undefined, { numeric: true }));
      const used = Math.min(parts.length, ordered.length);
      const audioItem: AudioItem = { ...fullNarration, duration: decoded.duration };
      const clips: SyncedImage[] = parts.slice(0, used).map((part, index) => ({
        image: ordered[index],
        audio: audioItem,
        startTime: 0,
        duration: Math.max(0.1, part.end - part.start),
        audioOffset: part.start,
        effect: EFFECTS[index % EFFECTS.length],
      }));
      const timed = retimeClips(clips);
      if (isPlaying) pausePreview();
      setSyncedImages(timed.items);
      setTotalDuration(timed.total);
      setStage('ready');
      setVideoUrl('');
      setExportProgress(0);
      setCurrentTime(0);
      const extraParts = parts.length - used;
      const extraImages = ordered.length - used;
      const mismatch = extraParts > 0
        ? ` ${extraParts} awaz ke pieces ke liye image nahi thi.`
        : extraImages > 0
          ? ` ${extraImages} images ke liye awaz nahi mili.`
          : '';
      setStatusMsg(`${parts.length} speech pieces mute gaps se nikle. ${used} images par lage.${mismatch}`);
    } catch (error) {
      setStatusMsg(error instanceof Error ? error.message : 'Audio read nahi ho saki.');
    } finally {
      setIsSplitting(false);
      audioContext.close().catch(() => {});
    }
  };

  const drawFrame = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, progress: number, effect: EffectType, width: number, height: number, time?: number, fit: FitMode = 'cover', layer?: { opacity?: number; clear?: boolean; captions?: boolean }) => {
    const opacity = layer?.opacity ?? 1;
    if (layer?.clear !== false) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    }
    if (!img || !img.naturalWidth || opacity <= 0) return;

    const imgAspect = img.naturalWidth / img.naturalHeight;
    const canvasAspect = width / height;
    let drawWidth: number, drawHeight: number;
    const cover = fit === 'cover';
    if (cover ? imgAspect > canvasAspect : imgAspect <= canvasAspect) {
      drawHeight = height;
      drawWidth = height * imgAspect;
    } else {
      drawWidth = width;
      drawHeight = width / imgAspect;
    }

    const wave = Math.sin(Math.min(Math.max(progress, 0), 1) * Math.PI);
    let scale = 1, offsetX = 0, offsetY = 0, alpha = 1;
    switch (effect) {
      case 'kenburns':
        scale = 1 + wave * 0.1;
        offsetX = -wave * width * 0.03;
        offsetY = -wave * height * 0.02;
        break;
      case 'zoom-in':
        scale = 1 + wave * 0.16;
        break;
      case 'zoom-out':
        scale = 1 + wave * 0.14;
        break;
      case 'pan-left':
        offsetX = wave * width * 0.06;
        scale = 1 + wave * 0.05;
        break;
      case 'pan-right':
        offsetX = -wave * width * 0.06;
        scale = 1 + wave * 0.05;
        break;
      case 'fade':
        scale = 1 + wave * 0.06;
        break;
    }

    ctx.save();
    ctx.globalAlpha = alpha * opacity;
    ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
    ctx.scale(scale, scale);
    ctx.translate(-width / 2, -height / 2);
    const x = (width - drawWidth) / 2;
    const y = (height - drawHeight) / 2;
    ctx.drawImage(img, x, y, drawWidth, drawHeight);
    ctx.restore();

    if (layer?.clear !== false) {
      const gradient = ctx.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, height * 0.85);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      if (layer?.captions !== false && time !== undefined && captions.length > 0) {
        drawCaptions(ctx, time, width, height);
      }
    }
  };

  // Draw captions on canvas
  const drawCaptions = (ctx: CanvasRenderingContext2D, time: number, width: number, height: number) => {
    const currentCaption = captions.find(
      cap => time >= cap.startTime && time <= cap.endTime
    );

    if (!currentCaption) return;

    // Caption styling
    const fontSize = captionSize === 'small' ? height * 0.03 : 
                     captionSize === 'large' ? height * 0.06 : 
                     height * 0.045;
    
    const color = captionColor === 'yellow' ? '#FFD700' : 
                  captionColor === 'cyan' ? '#00FFFF' : 
                  '#FFFFFF';

    const yPos = captionStyle === 'top' ? height * 0.15 : 
                 captionStyle === 'center' ? height * 0.5 : 
                 height * 0.88;

    ctx.save();
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Word wrap
    const maxWidth = width * 0.85;
    const words = currentCaption.text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    // Draw background
    const lineHeight = fontSize * 1.3;
    const bgHeight = lines.length * lineHeight + 20;
    const bgY = yPos - (lines.length * lineHeight) / 2 - 10;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(width * 0.05, bgY, width * 0.9, bgHeight);

    // Draw text with shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = color;

    lines.forEach((line, idx) => {
      const y = yPos + (idx - (lines.length - 1) / 2) * lineHeight;
      ctx.fillText(line, width / 2, y);
    });

    ctx.restore();
  };

  const getCurrentImageAtTime = (time: number, clips: SyncedImage[]): { img: SyncedImage; progress: number } | null => {
    if (clips.length === 0) return null;
    for (const item of clips) {
      if (time >= item.startTime && time < item.startTime + item.duration) {
        const progress = (time - item.startTime) / item.duration;
        return { img: item, progress: Math.min(Math.max(progress, 0), 1) };
      }
    }
    if (time < clips[0].startTime) return { img: clips[0], progress: 0 };
    return { img: clips[clips.length - 1], progress: 1 };
  };

  const renderCurrentFrame = useCallback((time: number, target?: HTMLCanvasElement | OffscreenCanvas) => {
    const canvas = target ?? canvasRef.current;
    if (!canvas) return;
    const clips = exportClipsRef.current ?? syncedImages;
    const { width, height } = getFrameSize(format, resolution);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) return;
    const result = getCurrentImageAtTime(time, clips);
    if (result && result.img.image.loaded) {
      const clipIndex = clips.indexOf(result.img);
      const intoClip = time - result.img.startTime;
      const fadeFor = Math.min(0.45, result.img.duration * 0.35);
      const previous = clipIndex > 0 ? clips[clipIndex - 1] : null;
      if (previous && previous.image.loaded && intoClip >= 0 && intoClip < fadeFor) {
        const linear = intoClip / fadeFor;
        const mix = linear * linear * (3 - 2 * linear);
        drawFrame(ctx, previous.image.img, 1, previous.effect, width, height, time, fitMode, { opacity: 1 - mix, clear: true, captions: false });
        drawFrame(ctx, result.img.image.img, result.progress, result.img.effect, width, height, time, fitMode, { opacity: mix, clear: false, captions: false });
        if (captions.length > 0) drawCaptions(ctx, time, width, height);
      } else {
        drawFrame(ctx, result.img.image.img, result.progress, result.img.effect, width, height, time, fitMode);
      }
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, width, height);
    }
  }, [syncedImages, resolution, format, fitMode, captions, captionStyle, captionSize, captionColor]);

  const pausePreview = () => {
    playTokenRef.current += 1;
    setIsPlaying(false);
    cancelAnimationFrame(animFrameRef.current);
    audioRefs.current.forEach((audio) => audio.pause());
  };

  const resetPreview = () => {
    pausePreview();
    setCurrentTime(0);
    renderCurrentFrame(0);
  };

  const startPreview = (from?: number) => {
    if (syncedImages.length === 0 || totalDuration <= 0) {
      setStatusMsg('Pehle sync complete karein!');
      return;
    }

    cancelAnimationFrame(animFrameRef.current);
    audioRefs.current.forEach((audio) => audio.pause());

    const token = ++playTokenRef.current;
    const startAt = Math.min(
      Math.max(from ?? (currentTime >= totalDuration - 0.05 ? 0 : currentTime), 0),
      Math.max(totalDuration - 0.05, 0)
    );
    let index = syncedImages.findIndex(
      (item) => startAt >= item.startTime && startAt < item.startTime + item.duration
    );
    if (index < 0) index = startAt <= 0 ? 0 : syncedImages.length - 1;
    currentAudioIndexRef.current = index;

    audioRefs.current = syncedImages.map((item) => new Audio(item.audio.url));
    const started = new Set<number>();
    const playClip = (clipIndex: number, offset: number) => {
      const audio = audioRefs.current[clipIndex];
      if (!audio || started.has(clipIndex)) return;
      started.add(clipIndex);
      audio.currentTime = Math.max(0, (syncedImages[clipIndex].audioOffset ?? 0) + offset);
      audio.play().catch(() => {});
    };

    setIsPlaying(true);
    setCurrentTime(startAt);
    const origin = performance.now() - startAt * 1000;

    const animate = () => {
      if (playTokenRef.current !== token) return;
      const elapsed = (performance.now() - origin) / 1000;
      setCurrentTime(elapsed);
      renderCurrentFrame(elapsed);

      const currentIdx = currentAudioIndexRef.current;
      if (currentIdx < syncedImages.length) {
        const currentSynced = syncedImages[currentIdx];
        const audioTime = elapsed - currentSynced.startTime;
        if (audioTime >= 0 && audioTime < currentSynced.duration) {
          playClip(currentIdx, audioTime);
        }
        if (elapsed >= currentSynced.startTime + currentSynced.duration) {
          audioRefs.current[currentIdx]?.pause();
          currentAudioIndexRef.current++;
          if (currentAudioIndexRef.current < syncedImages.length) {
            playClip(currentAudioIndexRef.current, 0);
          }
        }
      }

      if (elapsed >= totalDuration) {
        setIsPlaying(false);
        setCurrentTime(totalDuration);
        audioRefs.current.forEach((audio) => audio.pause());
        return;
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    playClip(index, startAt - syncedImages[index].startTime);
    animate();
  };

  const seekPreview = (time: number) => {
    if (isPlaying) startPreview(time);
    else {
      const next = Math.min(Math.max(time, 0), totalDuration);
      setCurrentTime(next);
      renderCurrentFrame(next);
    }
  };

  const exportVideo = async () => {
    if (syncedImages.length === 0 || totalDuration === 0) return;
    setIsExporting(true);
    setExportProgress(0);
    setExportError('');
    setVideoUrl('');

    const canvas = canvasRef.current;
    if (!canvas) {
      setIsExporting(false);
      return;
    }
    const { width, height } = getFrameSize(format, resolution);
    canvas.width = width;
    canvas.height = height;

    const audioContext = new AudioContext();
    try {
    await audioContext.resume();

    const useSlices = syncedImages.some((item) => typeof item.audioOffset === 'number');
    const audioBuffers: AudioBuffer[] = [];
    if (useSlices) {
      const decoded = new Map<string, AudioBuffer>();
      for (const item of syncedImages) {
        let buffer = decoded.get(item.audio.id);
        if (!buffer) {
          const arrayBuffer = (await item.audio.file.arrayBuffer()).slice(0);
          buffer = await audioContext.decodeAudioData(arrayBuffer);
          decoded.set(item.audio.id, buffer);
        }
        audioBuffers.push(
          typeof item.audioOffset === 'number'
            ? sliceAudioBuffer(audioContext, buffer, item.audioOffset, item.duration)
            : buffer
        );
      }
    } else {
      for (const item of syncedImages) {
        const arrayBuffer = await item.audio.file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        audioBuffers.push(audioBuffer);
      }
    }

    const outRate = 48000;
    const outChannels = Math.min(2, Math.max(...audioBuffers.map((buffer) => buffer.numberOfChannels)));
    const clipFrames = audioBuffers.map((buffer) => (
      buffer.sampleRate === outRate ? buffer.length : Math.max(1, Math.round(buffer.duration * outRate))
    ));
    const totalSamples = clipFrames.reduce((sum, frames) => sum + frames, 0);
    const combinedBuffer = audioContext.createBuffer(outChannels, totalSamples, outRate);

    let writeAt = 0;
    audioBuffers.forEach((buffer, index) => {
      const frames = clipFrames[index];
      for (let channel = 0; channel < outChannels; channel++) {
        const dest = combinedBuffer.getChannelData(channel);
        const src = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
        if (buffer.sampleRate === outRate && frames === src.length) {
          dest.set(src, writeAt);
        } else {
          for (let sample = 0; sample < frames; sample++) {
            const srcPos = (sample * buffer.sampleRate) / outRate;
            const leftIndex = Math.floor(srcPos);
            const rightIndex = Math.min(src.length - 1, leftIndex + 1);
            const fraction = srcPos - leftIndex;
            const left = src[leftIndex] ?? 0;
            const right = src[rightIndex] ?? left;
            dest[writeAt + sample] = left + (right - left) * fraction;
          }
        }
      }
      writeAt += frames;
    });

    let clipStart = 0;
    exportClipsRef.current = syncedImages.map((clip, index) => {
      const duration = clipFrames[index] / outRate;
      const timed = { ...clip, startTime: clipStart, duration };
      clipStart += duration;
      return timed;
    });
    const mediaDuration = clipStart;

    const fps = 30;
    const frameDuration = 1 / fps;
    const totalFrames = Math.max(1, Math.round(mediaDuration * fps));
    const showProgress = (ratio: number) => {
      const shown = Math.min(99, Math.max(0, Math.round(ratio * 100)));
      if (exportProgressTextRef.current) exportProgressTextRef.current.textContent = `Rendering… ${shown}%`;
      if (exportProgressBarRef.current) exportProgressBarRef.current.style.width = `${shown}%`;
    };

    const formats = [
      new WebMOutputFormat(),
      new Mp4OutputFormat({ fastStart: 'in-memory' }),
    ];
    let selected: {
      format: WebMOutputFormat | Mp4OutputFormat;
      videoCodec: NonNullable<Awaited<ReturnType<typeof getFirstEncodableVideoCodec>>>;
      audioCodec: NonNullable<Awaited<ReturnType<typeof getFirstEncodableAudioCodec>>>;
    } | null = null;
    for (const format of formats) {
      const videoCodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width, height });
      let audioCodec = await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), {
        numberOfChannels: outChannels,
        sampleRate: outRate,
      });
      if (!audioCodec) {
        audioCodec = await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), {
          numberOfChannels: Math.min(2, Math.max(1, outChannels)),
        });
      }
      if (videoCodec && audioCodec) {
        selected = { format, videoCodec, audioCodec };
        break;
      }
    }

    const readFrame = (exportCanvas: HTMLCanvasElement, exportCtx: CanvasRenderingContext2D, timeSec: number) => {
      const shown = Math.min(timeSec, mediaDuration);
      renderCurrentFrame(shown, exportCanvas);
      renderCurrentFrame(shown);
      const pixels = exportCtx.getImageData(0, 0, width, height);
      return new Uint8Array(pixels.data);
    };

    const encodeTimedFrames = async () => {
      if (!selected) throw new Error('Timed encoder missing');
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = width;
      exportCanvas.height = height;
      const exportCtx = exportCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!exportCtx) throw new Error('Export canvas nahi bana.');
      const target = new BufferTarget();
      const output = new Output({ format: selected.format, target });
      const videoSource = new VideoSampleSource({
        codec: selected.videoCodec,
        bitrate: resolution === '1080p' ? 5_000_000 : 2_500_000,
      });
      const audioSource = new AudioBufferSource({ codec: selected.audioCodec, bitrate: 128_000 });
      output.addVideoTrack(videoSource);
      output.addAudioTrack(audioSource);
      await output.start();

      for (let frame = 0; frame < totalFrames; frame++) {
        const timeSec = frame / fps;
        const rgba = readFrame(exportCanvas, exportCtx, timeSec);
        const sample = new VideoSample(rgba, {
          format: 'RGBA',
          codedWidth: width,
          codedHeight: height,
          timestamp: timeSec,
          duration: frameDuration,
        });
        await videoSource.add(sample);
        sample.close();
        showProgress(frame / totalFrames);
        if (frame % 2 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0));
      }

      showProgress(0.96);
      await audioSource.add(combinedBuffer);
      await output.finalize();
      if (!target.buffer) throw new Error('Export file empty hai.');
      return new Blob([target.buffer], { type: selected.format.mimeType });
    };

    const encodeWithFfmpeg = async () => {
      if (exportProgressTextRef.current) exportProgressTextRef.current.textContent = 'Encoder load ho raha hai…';
      const ffmpeg = await loadFfmpeg();
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = width;
      exportCanvas.height = height;
      const names: string[] = [];
      const onProgress = ({ progress }: { progress: number }) => {
        showProgress(0.75 + Math.max(0, Math.min(1, progress)) * 0.24);
      };
      ffmpeg.on('progress', onProgress);
      try {
        await ffmpeg.writeFile('audio.wav', audioBufferToWav(combinedBuffer));
        for (let frame = 0; frame < totalFrames; frame++) {
          const shown = Math.min(frame * frameDuration, mediaDuration);
          renderCurrentFrame(shown, exportCanvas);
          renderCurrentFrame(shown);
          const blob = await new Promise<Blob>((resolve, reject) => {
            exportCanvas.toBlob((file) => file ? resolve(file) : reject(new Error('Frame save nahi hui.')), 'image/jpeg', 0.92);
          });
          const name = `f${String(frame).padStart(4, '0')}.jpg`;
          names.push(name);
          await ffmpeg.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
          showProgress((frame + 1) / totalFrames * 0.75);
        }
        const code = await ffmpeg.exec([
          '-framerate', String(fps),
          '-start_number', '0',
          '-i', 'f%04d.jpg',
          '-i', 'audio.wav',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-preset', 'ultrafast',
          '-crf', '20',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-shortest',
          '-movflags', '+faststart',
          'out.mp4',
        ]);
        if (code !== 0) throw new Error('Video encode nahi ho saki.');
        const raw = await ffmpeg.readFile('out.mp4');
        if (!(raw instanceof Uint8Array) || raw.byteLength === 0) throw new Error('Export file empty hai.');
        const copy = new Uint8Array(raw.byteLength);
        copy.set(raw);
        return new Blob([copy], { type: 'video/mp4' });
      } finally {
        ffmpeg.off('progress', onProgress);
        await Promise.all([
          ...names.map((name) => ffmpeg.deleteFile(name).catch(() => {})),
          ffmpeg.deleteFile('audio.wav').catch(() => {}),
          ffmpeg.deleteFile('out.mp4').catch(() => {}),
        ]);
      }
    };

      let videoBlob: Blob;
      let ext = 'webm';
      if (selected) {
        try {
          videoBlob = await encodeTimedFrames();
          ext = selected.format.mimeType.includes('mp4') ? 'mp4' : 'webm';
        } catch {
          videoBlob = await encodeWithFfmpeg();
          ext = 'mp4';
        }
      } else {
        videoBlob = await encodeWithFfmpeg();
        ext = 'mp4';
      }
      setVideoExt(ext);
      setVideoUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(videoBlob);
      });
      setExportProgress(100);
      setExportError('');
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'string' && error
          ? error
          : 'Video export nahi ho saki.';
      setExportError(message);
      setStatusMsg(message);
    } finally {
      exportClipsRef.current = null;
      setIsExporting(false);
      audioContext.close().catch(() => {});
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTimePrecise = (seconds: number) => {
    if (!seconds || !isFinite(seconds)) return '0:00.0';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
  };

  useEffect(() => {
    if (syncedImages.length > 0 && !isPlaying && !isExporting && stage === 'ready') {
      renderCurrentFrame(currentTime);
    }
  }, [syncedImages, isPlaying, isExporting, renderCurrentFrame, stage, currentTime]);

  const selectFormat = (next: VideoFormat) => {
    if (next === format || isExporting) return;
    if (isPlaying) resetPreview();
    setFormat(next);
    setVideoUrl('');
    setExportProgress(0);
  };

  const selectResolution = (next: '720p' | '1080p') => {
    if (next === resolution || isExporting) return;
    setResolution(next);
    setVideoUrl('');
    setExportProgress(0);
  };

  const frame = getFrameSize(format, resolution);
  const longSize = getFrameSize('long', resolution);
  const reelSize = getFrameSize('reel', resolution);
  const predictedPairs = useMemo(
    () => pairByBaseName(images, audios, manualLinks),
    [images, audios, manualLinks]
  );
  const matchReport = useMemo(() => {
    if (stage !== 'ready') return predictedPairs;
    const usedImages = new Set(syncedImages.map((clip) => clip.image.id));
    const usedAudios = new Set(syncedImages.map((clip) => clip.audio.id));
    return {
      pairs: syncedImages.map((clip) => ({ image: clip.image, audio: clip.audio })),
      imagesWithoutNarration: images.filter((image) => !usedImages.has(image.id)),
      narrationsWithoutImage: audios.filter((audio) => !usedAudios.has(audio.id)),
    };
  }, [stage, predictedPairs, syncedImages, images, audios]);

  useEffect(() => {
    if (selectedImageId && !matchReport.imagesWithoutNarration.some((image) => image.id === selectedImageId)) {
      setSelectedImageId(null);
    }
    if (selectedAudioId && !matchReport.narrationsWithoutImage.some((audio) => audio.id === selectedAudioId)) {
      setSelectedAudioId(null);
    }
  }, [matchReport, selectedImageId, selectedAudioId]);

  const replaceTimeline = (items: SyncedImage[]) => {
    if (isPlaying) pausePreview();
    const timed = retimeClips(items);
    setSyncedImages(timed.items);
    setTotalDuration(timed.total);
    setVideoUrl('');
    setExportProgress(0);
    if (timed.items.length === 0) setStage(images.length > 0 || audios.length > 0 ? 'uploading' : 'idle');
    return timed;
  };

  const linkSelection = async () => {
    if (!selectedImageId || !selectedAudioId) return;
    const image = images.find((item) => item.id === selectedImageId);
    const audio = audios.find((item) => item.id === selectedAudioId);
    if (!image || !audio) return;

    if (stage === 'ready') {
      const duration = audio.duration || await getAudioDuration(audio.url);
      if (!duration || !isFinite(duration)) {
        setStatusMsg(`Could not read duration for ${audio.name}`);
        return;
      }
      const clip: SyncedImage = {
        image,
        audio: { ...audio, duration },
        startTime: 0,
        duration,
        effect: EFFECTS[syncedImages.length % EFFECTS.length],
      };
      replaceTimeline([
        ...syncedImages.filter((item) => item.image.id !== image.id && item.audio.id !== audio.id),
        clip,
      ]);
      setStatusMsg(`Linked ${image.name} with ${audio.name}`);
    } else {
      setManualLinks((prev) => [
        ...prev.filter((link) => link.imageId !== image.id && link.audioId !== audio.id),
        { imageId: image.id, audioId: audio.id },
      ]);
      setStatusMsg(`Linked ${image.name} with ${audio.name}. It will be included on sync.`);
    }
    setSelectedImageId(null);
    setSelectedAudioId(null);
  };

  const moveClip = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= syncedImages.length) return;
    const copy = [...syncedImages];
    [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
    replaceTimeline(copy);
  };

  const removeClip = (index: number) => {
    const clip = syncedImages[index];
    if (!clip) return;
    setManualLinks((prev) => prev.filter((link) => link.imageId !== clip.image.id && link.audioId !== clip.audio.id));
    replaceTimeline(syncedImages.filter((_, itemIndex) => itemIndex !== index));
  };

  const setClipEffect = (index: number, effect: EffectType) => {
    setSyncedImages((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, effect } : item));
    setVideoUrl('');
  };

  const removeImage = (id: string) => {
    const image = images.find((item) => item.id === id);
    if (image) URL.revokeObjectURL(image.url);
    const nextImages = images.filter((item) => item.id !== id);
    setImages(nextImages);
    setManualLinks((prev) => prev.filter((link) => link.imageId !== id));
    if (selectedImageId === id) setSelectedImageId(null);
    if (stage === 'ready') {
      replaceTimeline(syncedImages.filter((clip) => clip.image.id !== id));
    }
    if (nextImages.length === 0 && audios.length === 0) setStage('idle');
  };

  const removeAudio = (id: string) => {
    const audio = audios.find((item) => item.id === id);
    if (audio) URL.revokeObjectURL(audio.url);
    const nextAudios = audios.filter((item) => item.id !== id);
    setAudios(nextAudios);
    setManualLinks((prev) => prev.filter((link) => link.audioId !== id));
    if (selectedAudioId === id) setSelectedAudioId(null);
    if (stage === 'ready') {
      replaceTimeline(syncedImages.filter((clip) => clip.audio.id !== id));
    }
    if (images.length === 0 && nextAudios.length === 0) setStage('idle');
  };

  const selectedImage = images.find((image) => image.id === selectedImageId);
  const selectedAudio = audios.find((audio) => audio.id === selectedAudioId);
  const step = stage === 'ready' ? 3 : images.length > 0 || audios.length > 0 ? 2 : 1;
  const chip = (active: boolean) =>
    `flex-1 px-3 py-2 rounded-lg text-xs font-medium capitalize transition-colors ${
      active
        ? 'bg-white text-zinc-950'
        : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-white/10'
    }`;

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(900px_420px_at_50%_-80px,rgba(168,85,247,0.28),transparent_70%)]" />

      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#09090b]/85 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Film className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-white">VideoForge</h1>
              <p className="text-xs text-zinc-500 truncate">Images match audio by filename, then export</p>
            </div>
          </div>
          {totalDuration > 0 && (
            <span className="shrink-0 text-sm text-zinc-200 flex items-center gap-1.5 bg-zinc-800 border border-white/10 px-3 py-1.5 rounded-full tabular-nums">
              <Clock className="w-3.5 h-3.5 text-violet-300" />
              {formatTime(totalDuration)}
            </span>
          )}
        </div>
      </header>

      <main className="relative max-w-6xl mx-auto px-4 py-8 space-y-6">
        <ol className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            { n: 1, title: 'Upload', hint: 'Images + audio' },
            { n: 2, title: 'Match', hint: '001.png ↔ 001.mp3' },
            { n: 3, title: 'Export', hint: 'Preview and download' },
          ].map((item) => (
            <li
              key={item.n}
              className={`rounded-xl border px-3 py-3 sm:px-4 ${
                step === item.n
                  ? 'border-violet-400/50 bg-violet-500/10'
                  : step > item.n
                    ? 'border-white/10 bg-zinc-900/80'
                    : 'border-white/5 bg-zinc-950/40'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center ${
                  step >= item.n ? 'bg-violet-500 text-white' : 'bg-zinc-800 text-zinc-500'
                }`}>
                  {step > item.n ? <CheckCircle className="w-3.5 h-3.5" /> : item.n}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-100">{item.title}</p>
                  <p className="text-[11px] text-zinc-500 truncate">{item.hint}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => selectFormat('long')}
            disabled={isExporting}
            className={`text-left rounded-2xl border p-4 transition-colors disabled:opacity-50 ${
              format === 'long'
                ? 'border-violet-400 bg-violet-500/15'
                : 'border-white/10 bg-zinc-900/70 hover:border-white/20'
            }`}
          >
            <span className="flex items-center gap-3">
              <span className={`w-11 h-8 rounded-md border-2 flex items-center justify-center ${format === 'long' ? 'border-violet-300 text-violet-200' : 'border-zinc-600 text-zinc-500'}`}>
                <RectangleHorizontal className="w-4 h-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-white">Long video</span>
                <span className="block text-xs text-zinc-400">Landscape 16:9 · {longSize.width}×{longSize.height}</span>
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => selectFormat('reel')}
            disabled={isExporting}
            className={`text-left rounded-2xl border p-4 transition-colors disabled:opacity-50 ${
              format === 'reel'
                ? 'border-fuchsia-400 bg-fuchsia-500/15'
                : 'border-white/10 bg-zinc-900/70 hover:border-white/20'
            }`}
          >
            <span className="flex items-center gap-3">
              <span className={`w-8 h-11 rounded-md border-2 flex items-center justify-center ${format === 'reel' ? 'border-fuchsia-300 text-fuchsia-200' : 'border-zinc-600 text-zinc-500'}`}>
                <RectangleVertical className="w-4 h-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-white">Reel</span>
                <span className="block text-xs text-zinc-400">Vertical 9:16 · {reelSize.width}×{reelSize.height}</span>
              </span>
            </span>
          </button>
        </div>

        <section className="rounded-2xl border border-amber-400/30 bg-amber-500/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Music className="w-4 h-4 text-amber-300" />
                Split on mute
              </h2>
              <p className="text-xs text-zinc-400 mt-1 max-w-2xl">
                Voiceover upload karo. Jahan mute ho wahan se kaat kar 001.mp3, 002.mp3 … download ho jati hain. Phir neeche Images aur Audio mein daal kar purane naam-match se video banao.
              </p>
            </div>
            <span className="text-[11px] text-zinc-500">Optional</span>
          </div>
          <label className="block rounded-xl border border-dashed border-amber-400/40 bg-zinc-950/50 p-4 cursor-pointer hover:bg-amber-500/5">
            <input type="file" accept="audio/*" onChange={handleFullNarration} className="hidden" />
            <span className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-amber-500/15 text-amber-200 flex items-center justify-center shrink-0">
                <Music className="w-4 h-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{fullNarration ? fullNarration.name : 'One complete audio file'}</span>
                <span className="block text-xs text-zinc-500 truncate">
                  {fullNarration ? formatTime(fullNarration.duration) : 'mp3, wav, m4a'}
                </span>
              </span>
            </span>
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="text-xs text-zinc-400 flex items-center gap-2">
              Mute gap
              <input
                type="range"
                min={0.2}
                max={1.5}
                step={0.1}
                value={silenceGap}
                onChange={(event) => setSilenceGap(Number(event.target.value))}
                className="w-28"
              />
              <span className="tabular-nums text-zinc-200">{silenceGap.toFixed(1)}s</span>
            </label>
            <button
              type="button"
              onClick={downloadSplitVoice}
              disabled={isSplitting || isExporting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-zinc-950 text-sm font-semibold disabled:opacity-50"
            >
              {isSplitting ? <Loader className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {isSplitting ? 'Splitting…' : 'Split into 001.mp3…'}
            </button>
            <button
              type="button"
              onClick={splitFullNarration}
              disabled={isSplitting || isExporting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/15 text-sm font-medium text-zinc-200 disabled:opacity-50"
            >
              <Zap className="w-4 h-4" />
              Split onto timeline
            </button>
          </div>
          {voiceParts.length > 0 && voiceZipUrl && (
            <div className="mt-4 rounded-xl border border-white/10 bg-zinc-950/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <p className="text-sm font-medium text-zinc-100">{voiceParts.length} files · 001.mp3 se {voiceParts[voiceParts.length - 1].name}</p>
                <a
                  href={voiceZipUrl}
                  download="voice-parts.zip"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-300 text-zinc-950 text-sm font-semibold"
                >
                  <Download className="w-4 h-4" />
                  Download all
                </a>
              </div>
              <ul className="max-h-48 overflow-auto space-y-1.5 pr-1">
                {voiceParts.map((part) => (
                  <li key={part.name} className="flex items-center gap-2 text-xs text-zinc-300 rounded-lg bg-zinc-900 border border-white/5 px-2.5 py-2">
                    <Music className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    <span className="font-medium text-zinc-100">{part.name}</span>
                    <span className="text-zinc-500 tabular-nums">{formatTime(part.duration)}</span>
                    <a href={part.url} download={part.name} className="ml-auto text-amber-200 hover:text-white">
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {statusMsg && (
          <div className="flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="min-w-0">{statusMsg}</span>
            <button onClick={() => setStatusMsg('')} className="ml-auto text-zinc-500 hover:text-white text-lg leading-none" aria-label="Dismiss">×</button>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <section className="rounded-2xl border border-white/10 bg-zinc-900/70 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-fuchsia-500/15 text-fuchsia-300 flex items-center justify-center">
                  <ImageIcon className="w-4 h-4" />
                </span>
                Images
              </h2>
              <span className="text-xs tabular-nums text-zinc-400 bg-zinc-950 border border-white/10 rounded-full px-2.5 py-1">{images.length}</span>
            </div>
            <label className="block rounded-xl border border-dashed border-zinc-600 bg-zinc-950/60 p-7 text-center cursor-pointer hover:border-fuchsia-400/70 hover:bg-fuchsia-500/5 transition-colors group">
              <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
              <span className="mx-auto mb-3 w-11 h-11 rounded-full bg-zinc-800 group-hover:bg-fuchsia-500/20 flex items-center justify-center">
                <Upload className="w-5 h-5 text-zinc-400 group-hover:text-fuchsia-300" />
              </span>
              <p className="text-sm font-medium text-zinc-100">Drop images, or click to browse</p>
              <p className="text-xs text-zinc-500 mt-1">Name them 001.png, 002.png…</p>
            </label>
            {images.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mt-4">
                {images.map((img) => (
                  <div key={img.id} className="relative aspect-video rounded-lg overflow-hidden border border-white/10 bg-black group/thumb">
                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 text-[10px] bg-black/75 px-1.5 py-0.5 font-medium truncate">{img.baseName}</span>
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/80 text-white flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 focus:opacity-100"
                      aria-label={`Remove ${img.name}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-zinc-900/70 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-violet-500/15 text-violet-300 flex items-center justify-center">
                  <Music className="w-4 h-4" />
                </span>
                Audio
              </h2>
              <span className="text-xs tabular-nums text-zinc-400 bg-zinc-950 border border-white/10 rounded-full px-2.5 py-1">{audios.length}</span>
            </div>
            <label className="block rounded-xl border border-dashed border-zinc-600 bg-zinc-950/60 p-7 text-center cursor-pointer hover:border-violet-400/70 hover:bg-violet-500/5 transition-colors group">
              <input type="file" accept="audio/*" multiple onChange={handleAudioUpload} className="hidden" />
              <span className="mx-auto mb-3 w-11 h-11 rounded-full bg-zinc-800 group-hover:bg-violet-500/20 flex items-center justify-center">
                <Upload className="w-5 h-5 text-zinc-400 group-hover:text-violet-300" />
              </span>
              <p className="text-sm font-medium text-zinc-100">Drop audio, or click to browse</p>
              <p className="text-xs text-zinc-500 mt-1">Match names: 001.mp3, 002.mp3…</p>
            </label>
            {audios.length > 0 && (
              <ul className="mt-4 space-y-1.5 max-h-40 overflow-auto pr-1">
                {audios.map((audio) => (
                  <li key={audio.id} className="text-xs text-zinc-300 flex items-center gap-2 rounded-lg bg-zinc-950 border border-white/5 px-2.5 py-2">
                    <Music className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                    <span className="truncate flex-1">{audio.name}</span>
                    <button type="button" onClick={() => removeAudio(audio.id)} className="text-zinc-500 hover:text-white" aria-label={`Remove ${audio.name}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {(images.length > 0 || audios.length > 0) && (
          <section className="rounded-2xl border border-white/10 bg-zinc-900/70 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Link2 className="w-4 h-4 text-amber-300" />
                Match check
              </h3>
              <span className="text-xs text-zinc-400">
                {matchReport.pairs.length} paired
                {matchReport.imagesWithoutNarration.length + matchReport.narrationsWithoutImage.length > 0
                  ? ` · ${matchReport.imagesWithoutNarration.length + matchReport.narrationsWithoutImage.length} missing`
                  : ''}
              </span>
            </div>
            <p className="text-xs text-zinc-500 mb-4">
              Same names pair automatically. If a name does not match, select one image and one narration, then link them.
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <div className={`rounded-xl border p-3 ${matchReport.imagesWithoutNarration.length > 0 ? 'border-amber-400/40 bg-amber-500/10' : 'border-white/10 bg-zinc-950'}`}>
                <p className="text-xs font-medium flex items-center gap-1.5 mb-2">
                  {matchReport.imagesWithoutNarration.length > 0
                    ? <AlertCircle className="w-3.5 h-3.5 text-amber-300" />
                    : <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
                  Images with no narration
                  <span className="ml-auto tabular-nums text-zinc-400">{matchReport.imagesWithoutNarration.length}</span>
                </p>
                {matchReport.imagesWithoutNarration.length === 0 ? (
                  <p className="text-xs text-zinc-500">{images.length === 0 ? 'No images uploaded yet.' : 'Every image has a narration.'}</p>
                ) : (
                  <ul className="space-y-1.5 max-h-52 overflow-auto pr-1">
                    {matchReport.imagesWithoutNarration.map((image) => (
                      <li key={image.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedImageId(image.id)}
                          className={`w-full flex items-center gap-2 rounded-lg bg-zinc-950/80 border px-2 py-1.5 text-left ${selectedImageId === image.id ? 'border-white' : 'border-white/5 hover:border-white/20'}`}
                        >
                          <img src={image.url} alt="" className="w-10 h-7 object-cover rounded bg-black shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-xs text-zinc-100 truncate">{image.name}</span>
                            <span className="block text-[11px] text-amber-200/80 truncate">Needs a file named {image.baseName}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className={`rounded-xl border p-3 ${matchReport.narrationsWithoutImage.length > 0 ? 'border-amber-400/40 bg-amber-500/10' : 'border-white/10 bg-zinc-950'}`}>
                <p className="text-xs font-medium flex items-center gap-1.5 mb-2">
                  {matchReport.narrationsWithoutImage.length > 0
                    ? <AlertCircle className="w-3.5 h-3.5 text-amber-300" />
                    : <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
                  Narrations with no image
                  <span className="ml-auto tabular-nums text-zinc-400">{matchReport.narrationsWithoutImage.length}</span>
                </p>
                {matchReport.narrationsWithoutImage.length === 0 ? (
                  <p className="text-xs text-zinc-500">{audios.length === 0 ? 'No narrations uploaded yet.' : 'Every narration has an image.'}</p>
                ) : (
                  <ul className="space-y-1.5 max-h-52 overflow-auto pr-1">
                    {matchReport.narrationsWithoutImage.map((audio) => (
                      <li key={audio.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedAudioId(audio.id)}
                          className={`w-full flex items-center gap-2 rounded-lg bg-zinc-950/80 border px-2 py-1.5 text-left ${selectedAudioId === audio.id ? 'border-white' : 'border-white/5 hover:border-white/20'}`}
                        >
                          <span className="w-7 h-7 rounded-md bg-violet-500/15 text-violet-300 flex items-center justify-center shrink-0">
                            <Music className="w-3.5 h-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs text-zinc-100 truncate">{audio.name}</span>
                            <span className="block text-[11px] text-amber-200/80 truncate">Needs an image named {audio.baseName}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <button
                type="button"
                onClick={linkSelection}
                disabled={!selectedImage || !selectedAudio}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white text-zinc-950 text-sm font-semibold disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                <Link2 className="w-4 h-4" />
                Link selected
              </button>
              <p className="text-xs text-zinc-400 truncate">
                {selectedImage ? selectedImage.name : 'No image selected'} ↔ {selectedAudio ? selectedAudio.name : 'No narration selected'}
              </p>
            </div>
          </section>
        )}

        {images.length > 0 && audios.length > 0 && (stage === 'uploading' || stage === 'ready') && (
          <div className="rounded-2xl border border-violet-400/30 bg-violet-500/10 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-white">{stage === 'ready' ? 'Timeline is ready' : 'Ready to match'}</p>
              <p className="text-xs text-zinc-400 mt-1">
                {stage === 'ready'
                  ? 'Rebuild keeps your clip order and effects, then adds any new pairs.'
                  : 'Same filename pairs together. Manual links are included too.'}
              </p>
            </div>
            <button
              onClick={syncMedia}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-zinc-950 rounded-xl text-sm font-semibold hover:bg-zinc-200 transition-colors"
            >
              <Zap className="w-4 h-4" />
              {stage === 'ready' ? 'Rebuild timeline' : 'Sync timeline'}
            </button>
          </div>
        )}

        {images.length > 0 && audios.length > 0 && (stage === 'uploading' || stage === 'ready') && (
          <section className="rounded-2xl border border-white/10 bg-zinc-900/70 p-5">
            <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4 text-cyan-300" />
                  Captions
                  <span className="text-[11px] font-normal text-zinc-500">optional</span>
                </h3>
                <p className="text-xs text-zinc-500 mt-1">SRT with timestamps, or a .txt file with one line per caption.</p>
              </div>
              {captions.length > 0 && (
                <span className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2.5 py-1">
                  {captions.length} loaded
                </span>
              )}
            </div>

            <div className="grid lg:grid-cols-[220px_1fr] gap-4">
              <label className="rounded-xl border border-dashed border-zinc-600 bg-zinc-950/60 p-4 text-center cursor-pointer hover:border-cyan-400/70 hover:bg-cyan-500/5 transition-colors group flex flex-col items-center justify-center">
                <input type="file" accept=".srt,.txt" onChange={handleCaptionUpload} className="hidden" />
                <FileText className="w-6 h-6 text-zinc-500 group-hover:text-cyan-300 mb-2" />
                <p className="text-sm font-medium">Upload .srt or .txt</p>
              </label>

              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1.5">Position</p>
                  <div className="flex gap-1.5">
                    {(['top', 'center', 'bottom'] as const).map(pos => (
                      <button key={pos} onClick={() => setCaptionStyle(pos)} className={chip(captionStyle === pos)}>{pos}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1.5">Size</p>
                  <div className="flex gap-1.5">
                    {(['small', 'medium', 'large'] as const).map(size => (
                      <button key={size} onClick={() => setCaptionSize(size)} className={chip(captionSize === size)}>{size}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1.5">Color</p>
                  <div className="flex gap-1.5">
                    <button onClick={() => setCaptionColor('white')} className={chip(captionColor === 'white')}>White</button>
                    <button onClick={() => setCaptionColor('yellow')} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${captionColor === 'yellow' ? 'bg-amber-300 text-zinc-950' : 'bg-zinc-900 text-zinc-400 border border-white/10'}`}>Yellow</button>
                    <button onClick={() => setCaptionColor('cyan')} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${captionColor === 'cyan' ? 'bg-cyan-300 text-zinc-950' : 'bg-zinc-900 text-zinc-400 border border-white/10'}`}>Cyan</button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {stage === 'ready' && syncedImages.length > 0 && (
          <>
            <section className="rounded-2xl border border-white/10 bg-black overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Play className="w-4 h-4 text-violet-300" />
                  Preview
                </h3>
                <p className="text-xs text-zinc-500">
                  {format === 'reel' ? 'Reel 9:16' : 'Long 16:9'} · {frame.width}×{frame.height} · {syncedImages.length} clips · {formatTime(totalDuration)}
                  {captions.length > 0 ? ` · ${captions.length} captions` : ''}
                </p>
              </div>
              <div className="relative bg-black flex justify-center py-4">
                <div
                  className="relative"
                  style={{ width: format === 'reel' ? 'min(360px, 100%)' : '100%' }}
                >
                  <canvas
                    ref={canvasRef}
                    className="w-full bg-black"
                    style={{ aspectRatio: format === 'reel' ? '9 / 16' : '16 / 9', maxHeight: format === 'reel' ? '640px' : '520px' }}
                  />
                  {!isPlaying && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                      <button
                        onClick={() => startPreview()}
                        className="w-16 h-16 rounded-full bg-white text-zinc-950 flex items-center justify-center hover:scale-105 transition-transform shadow-xl"
                        aria-label="Play preview"
                      >
                        <Play className="w-7 h-7 ml-1" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 py-3 bg-zinc-950">
                <button
                  onClick={isPlaying ? pausePreview : () => startPreview()}
                  className="w-9 h-9 rounded-full bg-white text-zinc-950 flex items-center justify-center hover:bg-zinc-200"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>
                <button
                  type="button"
                  className="flex-1 h-3 bg-zinc-800 rounded-full overflow-hidden"
                  aria-label="Seek preview"
                  onClick={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const ratio = (event.clientX - bounds.left) / bounds.width;
                    seekPreview(ratio * totalDuration);
                  }}
                >
                  <span
                    className="block h-full bg-violet-400"
                    style={{ width: `${totalDuration ? (currentTime / totalDuration) * 100 : 0}%` }}
                  />
                </button>
                <span className="text-xs text-zinc-400 tabular-nums">
                  {formatTime(currentTime)} / {formatTime(totalDuration)}
                </span>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-zinc-900/70 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-amber-300" />
                  Timeline
                </h3>
                <div className="inline-flex p-1 rounded-xl bg-zinc-950 border border-white/10">
                  {([
                    ['cover', 'Fill frame'],
                    ['contain', 'Show full image'],
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => { setFitMode(mode); setVideoUrl(''); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium ${fitMode === mode ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                {syncedImages.map((item, idx) => {
                  const durationPercent = (item.duration / totalDuration) * 100;
                  return (
                    <div key={`${item.image.id}-${item.audio.id}`} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl bg-zinc-950 border border-white/5 p-2.5">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-xs tabular-nums text-zinc-500 w-6 text-center">{idx + 1}</span>
                        <img src={item.image.url} alt="" className="w-16 h-10 object-cover rounded-md bg-black" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-zinc-100 truncate">{item.image.baseName}</p>
                          <p className="text-xs text-zinc-500 truncate">{item.image.name} ↔ {item.audio.name}</p>
                          {item.caption && <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{item.caption}</p>}
                          <p className="text-xs text-emerald-300/90 mt-0.5 tabular-nums">
                            {formatTimePrecise(item.startTime)} – {formatTimePrecise(item.startTime + item.duration)} · {item.duration.toFixed(1)}s · {durationPercent.toFixed(0)}%
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <select
                          value={item.effect}
                          onChange={(event) => setClipEffect(idx, event.target.value as EffectType)}
                          className="bg-zinc-900 border border-white/10 text-xs text-zinc-200 rounded-lg px-2 py-1.5"
                          aria-label={`Effect for clip ${idx + 1}`}
                        >
                          {EFFECTS.map((effect) => (
                            <option key={effect} value={effect}>{effect}</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => moveClip(idx, -1)} disabled={idx === 0} className="w-8 h-8 rounded-lg border border-white/10 text-zinc-300 disabled:opacity-30 flex items-center justify-center" aria-label="Move clip earlier">
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => moveClip(idx, 1)} disabled={idx === syncedImages.length - 1} className="w-8 h-8 rounded-lg border border-white/10 text-zinc-300 disabled:opacity-30 flex items-center justify-center" aria-label="Move clip later">
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => removeClip(idx)} className="w-8 h-8 rounded-lg border border-white/10 text-zinc-300 hover:text-white flex items-center justify-center" aria-label="Remove clip">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-zinc-900/70 p-5">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <Download className="w-4 h-4 text-fuchsia-300" />
                Export
              </h3>
              {exportError && (
                <p className="mb-3 text-sm text-rose-300">{exportError}</p>
              )}

              {isExporting ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <Loader className="w-4 h-4 animate-spin text-violet-300" />
                    <span ref={exportProgressTextRef}>Rendering… {exportProgress}%</span>
                  </div>
                  <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                    <div ref={exportProgressBarRef} className="h-full bg-violet-400 rounded-full transition-all" style={{ width: `${exportProgress}%` }} />
                  </div>
                </div>
              ) : videoUrl ? (
                <div className="space-y-4">
                  <a href={videoUrl} download={`videoforge-${format}-${resolution}.${videoExt}`} className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-zinc-950 rounded-xl text-sm font-semibold hover:bg-zinc-200">
                    <Download className="w-4 h-4" />
                    Download {format === 'reel' ? 'reel' : 'long video'}
                  </a>
                  <video
                    src={videoUrl}
                    controls
                    className={`rounded-xl border border-white/10 bg-black ${format === 'reel' ? 'mx-auto max-h-[640px] w-auto' : 'w-full'}`}
                  />
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="inline-flex p-1 rounded-xl bg-zinc-950 border border-white/10">
                    {(['720p', '1080p'] as const).map(res => (
                      <button
                        key={res}
                        onClick={() => selectResolution(res)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${resolution === res ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'}`}
                      >
                        {res}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={exportVideo}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-zinc-950 rounded-xl text-sm font-semibold hover:bg-zinc-200"
                  >
                    <Film className="w-4 h-4" />
                    Generate {format === 'reel' ? 'reel' : 'long video'} · {frame.width}×{frame.height}
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {stage === 'idle' && (
          <p className="text-center text-sm text-zinc-500 pt-2">
            Upload a set of images and audio files with matching names. The rest is automatic.
          </p>
        )}
      </main>
    </div>
  );
}
