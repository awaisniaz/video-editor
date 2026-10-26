import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, Image as ImageIcon, Music, Play, Pause, Download, Sparkles,
  Film, Clock, CheckCircle, AlertCircle, Loader, Zap, Brain,
  Target, Link2, FileText
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
}

interface Caption {
  text: string;
  startTime: number;
  endTime: number;
}

type EffectType = 'kenburns' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'fade';

const EFFECTS: EffectType[] = ['kenburns', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'fade'];

type Stage = 'idle' | 'uploading' | 'ready';

export default function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [audios, setAudios] = useState<AudioItem[]>([]);
  const [syncedImages, setSyncedImages] = useState<SyncedImage[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [statusMsg, setStatusMsg] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [totalDuration, setTotalDuration] = useState(0);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [captionStyle, setCaptionStyle] = useState<'bottom' | 'top' | 'center'>('bottom');
  const [captionSize, setCaptionSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [captionColor, setCaptionColor] = useState<'white' | 'yellow' | 'cyan'>('white');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRefs = useRef<HTMLAudioElement[]>([]);
  const animFrameRef = useRef<number>(0);
  const currentAudioIndexRef = useRef<number>(0);

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

    // Match images with audios based on baseName
    const matched: SyncedImage[] = [];
    const usedAudios = new Set<string>();

    for (const img of images) {
      // Find matching audio
      const matchingAudio = audiosWithDuration.find(
        audio => audio.baseName === img.baseName && !usedAudios.has(audio.id)
      );

      if (matchingAudio) {
        usedAudios.add(matchingAudio.id);
        matched.push({
          image: img,
          audio: matchingAudio,
          startTime: 0, // Will calculate
          duration: matchingAudio.duration,
          effect: EFFECTS[matched.length % EFFECTS.length],
        });
      }
    }

    // Sort by baseName to maintain order
    matched.sort((a, b) => a.image.baseName.localeCompare(b.image.baseName));

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
    setStatusMsg(`✓ ${finalSynced.length} images synced! Total duration: ${formatTime(startTime)}`);
  };

  const drawFrame = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, progress: number, effect: EffectType, width: number, height: number, time?: number) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    if (!img || !img.naturalWidth) return;

    const imgAspect = img.naturalWidth / img.naturalHeight;
    const canvasAspect = width / height;
    let drawWidth: number, drawHeight: number;
    if (imgAspect > canvasAspect) {
      drawHeight = height;
      drawWidth = height * imgAspect;
    } else {
      drawWidth = width;
      drawHeight = width / imgAspect;
    }

    let scale = 1, offsetX = 0, offsetY = 0, alpha = 1;
    switch (effect) {
      case 'kenburns':
        scale = 1 + progress * 0.15;
        offsetX = -progress * width * 0.03;
        offsetY = -progress * height * 0.03;
        break;
      case 'zoom-in': scale = 1 + progress * 0.25; break;
      case 'zoom-out': scale = 1.25 - progress * 0.25; break;
      case 'pan-left': offsetX = progress * width * 0.12; scale = 1.15; break;
      case 'pan-right': offsetX = -progress * width * 0.12; scale = 1.15; break;
      case 'fade':
        alpha = progress < 0.15 ? progress / 0.15 : progress > 0.85 ? (1 - progress) / 0.15 : 1;
        alpha = Math.max(0, Math.min(1, alpha));
        scale = 1.05;
        break;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
    ctx.scale(scale, scale);
    ctx.translate(-width / 2, -height / 2);
    const x = (width - drawWidth) / 2;
    const y = (height - drawHeight) / 2;
    ctx.drawImage(img, x, y, drawWidth, drawHeight);
    ctx.restore();

    const gradient = ctx.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, height * 0.85);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Draw captions if time is provided
    if (time !== undefined && captions.length > 0) {
      drawCaptions(ctx, time, width, height);
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

  const getCurrentImageAtTime = (time: number): { img: SyncedImage; progress: number } | null => {
    if (syncedImages.length === 0) return null;
    for (const item of syncedImages) {
      if (time >= item.startTime && time < item.startTime + item.duration) {
        const progress = (time - item.startTime) / item.duration;
        return { img: item, progress: Math.min(Math.max(progress, 0), 1) };
      }
    }
    if (time < syncedImages[0].startTime) return { img: syncedImages[0], progress: 0 };
    return { img: syncedImages[syncedImages.length - 1], progress: 1 };
  };

  const renderCurrentFrame = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = resolution === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const result = getCurrentImageAtTime(time);
    if (result && result.img.image.loaded) {
      drawFrame(ctx, result.img.image.img, result.progress, result.img.effect, width, height, time);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, width, height);
    }
  }, [syncedImages, resolution, captions, captionStyle, captionSize, captionColor]);

  const startPreview = async () => {
    if (syncedImages.length === 0) {
      setStatusMsg('Pehle sync complete karein!');
      return;
    }

    cancelAnimationFrame(animFrameRef.current);
    currentAudioIndexRef.current = 0;

    // Create audio elements for all synced audios
    audioRefs.current = syncedImages.map(item => {
      const audio = new Audio(item.audio.url);
      return audio;
    });

    setIsPlaying(true);
    const startTime = performance.now();

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      setCurrentTime(elapsed);
      renderCurrentFrame(elapsed);

      // Play current audio
      const currentIdx = currentAudioIndexRef.current;
      if (currentIdx < syncedImages.length) {
        const currentSynced = syncedImages[currentIdx];
        const audioTime = elapsed - currentSynced.startTime;
        
        if (audioTime >= 0 && audioTime < currentSynced.duration) {
          const audio = audioRefs.current[currentIdx];
          if (audio.paused) {
            audio.currentTime = audioTime;
            audio.play().catch(() => {});
          }
        }

        // Check if we need to move to next audio
        if (elapsed >= currentSynced.startTime + currentSynced.duration) {
          audioRefs.current[currentIdx].pause();
          currentAudioIndexRef.current++;
          if (currentAudioIndexRef.current < syncedImages.length) {
            audioRefs.current[currentAudioIndexRef.current].currentTime = 0;
            audioRefs.current[currentAudioIndexRef.current].play().catch(() => {});
          }
        }
      }

      if (elapsed >= totalDuration) {
        setIsPlaying(false);
        audioRefs.current.forEach(a => a.pause());
        return;
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    // Start first audio
    if (audioRefs.current.length > 0) {
      audioRefs.current[0].play().catch(() => {});
    }

    animate();
  };

  const stopPreview = () => {
    setIsPlaying(false);
    cancelAnimationFrame(animFrameRef.current);
    audioRefs.current.forEach(a => {
      a.pause();
      a.currentTime = 0;
    });
    setCurrentTime(0);
    renderCurrentFrame(0);
  };

  const exportVideo = async () => {
    if (syncedImages.length === 0 || totalDuration === 0) return;
    setIsExporting(true);
    setExportProgress(0);
    setVideoUrl('');

    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = resolution === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
    canvas.width = width;
    canvas.height = height;

    const audioContext = new AudioContext();
    await audioContext.resume();

    // Decode all audio files and concatenate them
    const audioBuffers: AudioBuffer[] = [];
    for (const item of syncedImages) {
      const arrayBuffer = await item.audio.file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      audioBuffers.push(audioBuffer);
    }

    // Create combined audio buffer
    const totalSamples = audioBuffers.reduce((sum, buf) => sum + buf.length, 0);
    const combinedBuffer = audioContext.createBuffer(
      audioBuffers[0].numberOfChannels,
      totalSamples,
      audioBuffers[0].sampleRate
    );

    let offset = 0;
    for (const buffer of audioBuffers) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const combinedData = combinedBuffer.getChannelData(channel);
        const bufferData = buffer.getChannelData(channel);
        combinedData.set(bufferData, offset);
      }
      offset += buffer.length;
    }

    const source = audioContext.createBufferSource();
    source.buffer = combinedBuffer;
    const dest = audioContext.createMediaStreamDestination();
    source.connect(dest);

    const canvasStream = canvas.captureStream(30);
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);

    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
    }

    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: resolution === '1080p' ? 5000000 : 2500000
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const exportDone = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        setVideoUrl(URL.createObjectURL(blob));
        setIsExporting(false);
        setExportProgress(100);
        resolve();
      };
    });

    recorder.start(100);
    source.start(0);

    const totalMs = totalDuration * 1000;
    const startMs = performance.now();

    const renderInterval = setInterval(() => {
      const elapsed = performance.now() - startMs;
      const timeSec = elapsed / 1000;
      const progress = Math.min(elapsed / totalMs, 1);
      setExportProgress(Math.round(progress * 100));

      if (progress >= 1) {
        clearInterval(renderInterval);
        renderCurrentFrame(totalDuration);
        setTimeout(() => {
          try { source.stop(); } catch (e) { }
          try { if (recorder.state !== 'inactive') recorder.stop(); } catch (e) { }
          canvasStream.getTracks().forEach(t => t.stop());
          audioContext.close();
        }, 200);
        return;
      }
      renderCurrentFrame(timeSec);
    }, 1000 / 30);

    setTimeout(() => {
      clearInterval(renderInterval);
      try { source.stop(); } catch (e) { }
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch (e) { }
      canvasStream.getTracks().forEach(t => t.stop());
      audioContext.close();
      setIsExporting(false);
    }, totalMs + 5000);

    await exportDone;
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
    if (syncedImages.length > 0 && !isPlaying && stage === 'ready') {
      renderCurrentFrame(0);
    }
  }, [syncedImages.length, isPlaying, renderCurrentFrame, stage]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-950/30 to-gray-900 text-white">
      <header className="border-b border-white/10 backdrop-blur-xl bg-black/30 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Film className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                VideoForge AI
              </h1>
              <p className="text-xs text-gray-500">Bulk Upload → Auto Sync → Video Ready</p>
            </div>
          </div>
          {totalDuration > 0 && (
            <span className="text-sm text-gray-400 flex items-center gap-1.5 bg-white/5 px-3 py-1.5 rounded-full">
              <Clock className="w-3.5 h-3.5" />
              {formatTime(totalDuration)}
            </span>
          )}
        </div>
      </header>

      {statusMsg && (
        <div className="max-w-6xl mx-auto px-4 pt-4">
          <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-2.5 text-green-300 text-sm">
            <CheckCircle className="w-4 h-4" />
            <span>{statusMsg}</span>
            <button onClick={() => setStatusMsg('')} className="ml-auto text-green-500 hover:text-green-300">×</button>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Upload Section */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-pink-500/20 flex items-center justify-center">
                <ImageIcon className="w-4 h-4 text-pink-400" />
              </div>
              Images ({images.length})
            </h2>
            <label className="block border-2 border-dashed border-pink-500/30 rounded-xl p-6 text-center cursor-pointer hover:border-pink-500/60 hover:bg-pink-500/5 transition-all group">
              <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
              <div className="space-y-2">
                <ImageIcon className="w-10 h-10 mx-auto text-gray-500 group-hover:text-pink-400" />
                <p className="text-gray-300 font-medium">Images bulk upload karein</p>
                <p className="text-xs text-gray-500">001.png, 002.png, etc.</p>
              </div>
            </label>
            {images.length > 0 && (
              <div className="grid grid-cols-5 gap-1.5 mt-4">
                {images.map((img, idx) => (
                  <div key={img.id} className="relative aspect-video rounded overflow-hidden border border-white/10">
                    <img src={img.url} alt="" className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 left-0 text-[8px] bg-black/80 px-1 font-mono">{img.baseName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Music className="w-4 h-4 text-purple-400" />
              </div>
              Audio Files ({audios.length})
            </h2>
            <label className="block border-2 border-dashed border-purple-500/30 rounded-xl p-6 text-center cursor-pointer hover:border-purple-500/60 hover:bg-purple-500/5 transition-all group">
              <input type="file" accept="audio/*" multiple onChange={handleAudioUpload} className="hidden" />
              <div className="space-y-2">
                <Music className="w-10 h-10 mx-auto text-gray-500 group-hover:text-purple-400" />
                <p className="text-gray-300 font-medium">Audio files bulk upload karein</p>
                <p className="text-xs text-gray-500">001.mp3, 002.mp3, etc.</p>
              </div>
            </label>
            {audios.length > 0 && (
              <div className="mt-4 space-y-1">
                {audios.map((audio, idx) => (
                  <div key={audio.id} className="text-xs text-gray-400 flex items-center gap-2">
                    <Music className="w-3 h-3" />
                    {audio.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sync Button */}
        {images.length > 0 && audios.length > 0 && stage === 'uploading' && (
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10 text-center">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
              <p className="text-sm text-blue-300 mb-2">
                <strong>Auto-Match:</strong> System automatically match karega:
              </p>
              <p className="text-xs text-gray-400">
                001.png ↔ 001.mp3, 002.png ↔ 002.mp3, etc.
              </p>
            </div>
            <button
              onClick={syncMedia}
              className="inline-flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-semibold hover:opacity-90 transition-all shadow-lg shadow-purple-500/20"
            >
              <Zap className="w-5 h-5" />
              Auto Sync & Create Video
            </button>
          </div>
        )}

        {/* Captions Section - Optional */}
        {images.length > 0 && audios.length > 0 && (stage === 'uploading' || stage === 'ready') && (
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-cyan-400" />
              Captions / Subtitles (Optional)
            </h3>
            
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 mb-4">
              <p className="text-sm text-cyan-300 mb-2">
                <strong>Captions add karein:</strong> SRT file ya simple text file upload karein
              </p>
              <p className="text-xs text-gray-400">
                SRT format: <code className="bg-black/30 px-1 rounded">00:00:01,000 --&gt; 00:00:03,000</code><br/>
                Simple text: Har line ek caption (timing automatically divide hogi)
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <label className="block border-2 border-dashed border-cyan-500/30 rounded-xl p-4 text-center cursor-pointer hover:border-cyan-500/60 hover:bg-cyan-500/5 transition-all group">
                <input type="file" accept=".srt,.txt" onChange={handleCaptionUpload} className="hidden" />
                <div className="space-y-2">
                  <FileText className="w-8 h-8 mx-auto text-gray-500 group-hover:text-cyan-400" />
                  <p className="text-gray-300 font-medium text-sm">Upload Captions File</p>
                  <p className="text-xs text-gray-500">.srt or .txt</p>
                </div>
              </label>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Position</label>
                  <div className="flex gap-2">
                    {(['top', 'center', 'bottom'] as const).map(pos => (
                      <button
                        key={pos}
                        onClick={() => setCaptionStyle(pos)}
                        className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          captionStyle === pos 
                            ? 'bg-cyan-500/30 border border-cyan-500 text-cyan-300' 
                            : 'bg-gray-800 border border-gray-700 text-gray-400'
                        }`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Size</label>
                  <div className="flex gap-2">
                    {(['small', 'medium', 'large'] as const).map(size => (
                      <button
                        key={size}
                        onClick={() => setCaptionSize(size)}
                        className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          captionSize === size 
                            ? 'bg-cyan-500/30 border border-cyan-500 text-cyan-300' 
                            : 'bg-gray-800 border border-gray-700 text-gray-400'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Color</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCaptionColor('white')}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        captionColor === 'white' 
                          ? 'bg-white/20 border border-white text-white' 
                          : 'bg-gray-800 border border-gray-700 text-gray-400'
                      }`}
                    >
                      White
                    </button>
                    <button
                      onClick={() => setCaptionColor('yellow')}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        captionColor === 'yellow' 
                          ? 'bg-yellow-500/20 border border-yellow-500 text-yellow-300' 
                          : 'bg-gray-800 border border-gray-700 text-gray-400'
                      }`}
                    >
                      Yellow
                    </button>
                    <button
                      onClick={() => setCaptionColor('cyan')}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        captionColor === 'cyan' 
                          ? 'bg-cyan-500/20 border border-cyan-500 text-cyan-300' 
                          : 'bg-gray-800 border border-gray-700 text-gray-400'
                      }`}
                    >
                      Cyan
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {captions.length > 0 && (
              <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <p className="text-sm text-green-300 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  {captions.length} captions loaded successfully!
                </p>
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {stage === 'ready' && syncedImages.length > 0 && (
          <>
            <div className="bg-green-500/10 rounded-xl p-4 border border-green-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-5 h-5 text-green-400" />
                <h3 className="font-semibold text-green-300">✓ {syncedImages.length} Images Synced!</h3>
              </div>
              <p className="text-xs text-gray-400">
                Har image ko uski audio ki duration ke mutabiq time mila • Total: {formatTime(totalDuration)}
                {captions.length > 0 && ` • ${captions.length} captions active`}
              </p>
            </div>

            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Link2 className="w-5 h-5 text-yellow-400" />
                Matched Pairs
              </h3>
              <div className="space-y-2">
                {syncedImages.map((item, idx) => {
                  const durationPercent = (item.duration / totalDuration) * 100;
                  return (
                    <div key={item.image.id} className="flex items-center gap-3 bg-gray-800/40 rounded-lg p-3 border border-white/5">
                      <span className="text-xs font-mono text-gray-500 w-6">#{idx+1}</span>
                      <img src={item.image.url} alt="" className="w-16 h-10 object-cover rounded" />
                      <div className="flex-1">
                        <p className="text-sm text-gray-300">{item.image.baseName}</p>
                        <p className="text-xs text-gray-500">
                          {item.image.name} ↔ {item.audio.name}
                        </p>
                        <p className="text-xs text-green-400 mt-1">
                          ⏱ {formatTimePrecise(item.startTime)} → {formatTimePrecise(item.startTime + item.duration)} • {item.duration.toFixed(1)}s
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-300 rounded">{item.effect}</span>
                        <p className="text-xs text-gray-500 mt-1">{durationPercent.toFixed(0)}%</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Play className="w-5 h-5 text-purple-400" />
                Preview
              </h3>
              <div className="bg-black rounded-xl overflow-hidden border border-white/10 relative">
                <canvas
                  ref={canvasRef}
                  className="w-full bg-black"
                  style={{ aspectRatio: '16/9', maxHeight: '500px' }}
                />
                {!isPlaying && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <button
                      onClick={startPreview}
                      className="w-16 h-16 rounded-full bg-purple-500/90 hover:bg-purple-500 flex items-center justify-center transition-all hover:scale-110 shadow-xl shadow-purple-500/30"
                    >
                      <Play className="w-7 h-7 ml-1" />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 mt-4">
                <button
                  onClick={isPlaying ? stopPreview : startPreview}
                  className="w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center hover:opacity-90 transition-all"
                >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                </button>
                <div className="flex-1">
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-100"
                      style={{ width: `${totalDuration ? (currentTime / totalDuration) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <span className="text-sm text-gray-400 font-mono">
                  {formatTime(currentTime)} / {formatTime(totalDuration)}
                </span>
              </div>
            </div>

            {/* Export */}
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Download className="w-5 h-5 text-pink-400" />
                Export Video
              </h3>
              
              {isExporting ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Loader className="w-5 h-5 animate-spin text-purple-400" />
                    <span className="text-purple-300">Exporting... {exportProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all" style={{ width: `${exportProgress}%` }} />
                  </div>
                </div>
              ) : videoUrl ? (
                <div className="space-y-4">
                  <a href={videoUrl} download="videoforge-synced.webm" className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-semibold hover:opacity-90 transition-all shadow-lg shadow-purple-500/20">
                    <Download className="w-5 h-5" />
                    Download Video
                  </a>
                  <video src={videoUrl} controls className="w-full rounded-xl border border-white/10" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-3">
                    {(['720p', '1080p'] as const).map(res => (
                      <button
                        key={res}
                        onClick={() => setResolution(res)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${resolution === res ? 'bg-purple-500/30 border border-purple-500 text-purple-300' : 'bg-gray-800 border border-gray-700 text-gray-400'}`}
                      >
                        {res}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={exportVideo}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-semibold hover:opacity-90 transition-all shadow-lg shadow-purple-500/20"
                  >
                    <Film className="w-5 h-5" />
                    Generate Video
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {stage === 'idle' && (
          <div className="bg-white/5 rounded-2xl p-12 border border-white/10 text-center">
            <Brain className="w-16 h-16 mx-auto mb-4 text-purple-400/50" />
            <h3 className="text-xl font-bold mb-2">Bulk Upload → Auto Sync → Video Ready</h3>
            <p className="text-gray-400 mb-6">Bas images aur audio files upload karein, baaki sab automatic</p>
            <div className="grid sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
              <div className="p-4 bg-gray-800/30 rounded-xl">
                <div className="w-8 h-8 mx-auto rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold mb-2">1</div>
                <p className="text-sm font-medium">Bulk Upload</p>
                <p className="text-xs text-gray-500 mt-1">Images + Audio</p>
              </div>
              <div className="p-4 bg-gray-800/30 rounded-xl">
                <div className="w-8 h-8 mx-auto rounded-full bg-pink-500/20 flex items-center justify-center text-pink-400 font-bold mb-2">2</div>
                <p className="text-sm font-medium">Auto Match</p>
                <p className="text-xs text-gray-500 mt-1">001.png ↔ 001.mp3</p>
              </div>
              <div className="p-4 bg-gray-800/30 rounded-xl">
                <div className="w-8 h-8 mx-auto rounded-full bg-green-500/20 flex items-center justify-center text-green-400 font-bold mb-2">3</div>
                <p className="text-sm font-medium">Video Ready</p>
                <p className="text-xs text-gray-500 mt-1">Download karein</p>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-white/10 mt-16 py-6">
        <p className="text-center text-gray-600 text-sm">VideoForge AI — Bulk Upload, Auto Sync, Perfect Video</p>
      </footer>
    </div>
  );
}
