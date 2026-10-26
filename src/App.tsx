import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, Image as ImageIcon, Music, Play, Pause, Download, Sparkles,
  Film, Clock, Layers, ZoomIn, Move, Settings, Wand2, Trash2, GripVertical,
  CheckCircle, AlertCircle, Loader
} from 'lucide-react';

interface ImageItem {
  id: string;
  file: File;
  url: string;
  name: string;
  duration: number;
  effect: EffectType;
  img: HTMLImageElement;
  loaded: boolean;
}

type EffectType = 'kenburns' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'fade' | 'none';

const EFFECTS: { id: EffectType; name: string }[] = [
  { id: 'kenburns', name: 'Ken Burns' },
  { id: 'zoom-in', name: 'Zoom In' },
  { id: 'zoom-out', name: 'Zoom Out' },
  { id: 'pan-left', name: 'Pan Left' },
  { id: 'pan-right', name: 'Pan Right' },
  { id: 'fade', name: 'Fade' },
  { id: 'none', name: 'No Effect' },
];

export default function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedEffect, setSelectedEffect] = useState<EffectType>('kenburns');
  const [activeTab, setActiveTab] = useState<'upload' | 'storyboard' | 'preview' | 'export'>('upload');
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [statusMsg, setStatusMsg] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animFrameRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getRes = useCallback(() => {
    return resolution === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  }, [resolution]);

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setVideoUrl('');
    }
  };

  const loadImage = (file: File): Promise<{ img: HTMLImageElement; url: string }> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve({ img, url });
      img.onerror = () => resolve({ img, url }); // still add even if error
      img.src = url;
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    
    for (const file of fileArray) {
      const { img, url } = await loadImage(file);
      setImages(prev => {
        const newImages = [...prev, {
          id: Math.random().toString(36).substr(2, 9),
          file,
          url,
          name: file.name,
          duration: 0,
          effect: selectedEffect,
          img,
          loaded: true,
        }];
        // Recalculate durations
        if (audioDuration > 0) {
          const dur = audioDuration / newImages.length;
          return newImages.map(i => ({ ...i, duration: dur }));
        }
        return newImages;
      });
    }
  };

  // Auto-distribute duration
  useEffect(() => {
    if (audioDuration > 0 && images.length > 0) {
      const durationPerImage = audioDuration / images.length;
      setImages(prev => prev.map(img => ({ ...img, duration: durationPerImage })));
    }
  }, [audioDuration]);

  const removeImage = (id: string) => {
    setImages(prev => {
      const filtered = prev.filter(img => img.id !== id);
      if (audioDuration > 0 && filtered.length > 0) {
        const durationPerImage = audioDuration / filtered.length;
        return filtered.map(img => ({ ...img, duration: durationPerImage }));
      }
      return filtered;
    });
  };

  const applyEffectToAll = (effect: EffectType) => {
    setSelectedEffect(effect);
    setImages(prev => prev.map(img => ({ ...img, effect })));
  };

  const applyEffectToSingle = (id: string, effect: EffectType) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, effect } : img));
  };

  const drawFrame = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, progress: number, effect: EffectType, width: number, height: number) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    if (!img || !img.naturalWidth) return;

    // Calculate image dimensions to cover canvas
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

    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let alpha = 1;

    switch (effect) {
      case 'kenburns':
        scale = 1 + progress * 0.15;
        offsetX = -progress * width * 0.03;
        offsetY = -progress * height * 0.03;
        break;
      case 'zoom-in':
        scale = 1 + progress * 0.25;
        break;
      case 'zoom-out':
        scale = 1.25 - progress * 0.25;
        break;
      case 'pan-left':
        offsetX = progress * width * 0.12;
        scale = 1.15;
        break;
      case 'pan-right':
        offsetX = -progress * width * 0.12;
        scale = 1.15;
        break;
      case 'fade':
        alpha = progress < 0.15 ? progress / 0.15 : progress > 0.85 ? (1 - progress) / 0.15 : 1;
        alpha = Math.max(0, Math.min(1, alpha));
        scale = 1.05;
        break;
      default:
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

    // Subtle vignette
    const gradient = ctx.createRadialGradient(
      width / 2, height / 2, height * 0.35,
      width / 2, height / 2, height * 0.85
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  };

  const getCurrentImageAtTime = (time: number): { img: ImageItem; progress: number } | null => {
    if (images.length === 0) return null;
    
    let accumulated = 0;
    for (let i = 0; i < images.length; i++) {
      const imgItem = images[i];
      if (time < accumulated + imgItem.duration || i === images.length - 1) {
        const progress = Math.min((time - accumulated) / imgItem.duration, 1);
        return { img: imgItem, progress: Math.max(0, progress) };
      }
      accumulated += imgItem.duration;
    }
    return null;
  };

  const renderCurrentFrame = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const { width, height } = getRes();
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const result = getCurrentImageAtTime(time);
    if (result && result.img.loaded) {
      drawFrame(ctx, result.img.img, result.progress, result.img.effect, width, height);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#666';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Loading...', width / 2, height / 2);
    }
  }, [images, getRes]);

  const startPreview = () => {
    if (!audioRef.current || images.length === 0 || !audioDuration) {
      setStatusMsg('Please upload audio and images first!');
      return;
    }

    // Stop any existing preview
    cancelAnimationFrame(animFrameRef.current);

    const audio = audioRef.current;
    audio.currentTime = 0;
    
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.then(() => {
        setIsPlaying(true);
        
        const animate = () => {
          const time = audio.currentTime;
          setCurrentTime(time);
          renderCurrentFrame(time);

          if (time >= audioDuration - 0.05) {
            setIsPlaying(false);
            return;
          }
          animFrameRef.current = requestAnimationFrame(animate);
        };
        animate();
      }).catch(err => {
        console.error('Audio play failed:', err);
        setStatusMsg('Audio play failed. Try clicking again.');
      });
    }
  };

  const stopPreview = () => {
    setIsPlaying(false);
    cancelAnimationFrame(animFrameRef.current);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setCurrentTime(0);
    renderCurrentFrame(0);
  };

  const exportVideo = async () => {
    if (!audioFile || images.length === 0 || !audioDuration) {
      setStatusMsg('Upload audio and images first!');
      return;
    }

    // Check all images loaded
    const allLoaded = images.every(img => img.loaded && img.img.naturalWidth > 0);
    if (!allLoaded) {
      setStatusMsg('Images are still loading, please wait...');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    setVideoUrl('');

    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height } = getRes();
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Setup audio context
    const audioContext = new AudioContext();
    await audioContext.resume(); // Important for browser autoplay policy

    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    const dest = audioContext.createMediaStreamDestination();
    source.connect(dest);
    source.connect(audioContext.destination); // Also play through speakers

    // Get canvas stream
    const canvasStream = canvas.captureStream(30);
    
    // Combine video + audio tracks
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);

    // Determine supported mime type
    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }

    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: resolution === '1080p' ? 5000000 : 2500000
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const exportDone = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
        setIsExporting(false);
        setExportProgress(100);
        resolve();
      };
    });

    recorder.start(100); // Collect data every 100ms
    source.start(0);

    const totalMs = audioDuration * 1000;
    const startMs = performance.now();

    // Use setInterval for consistent frame rendering
    const fps = 30;
    const frameInterval = 1000 / fps;

    const renderInterval = setInterval(() => {
      const elapsed = performance.now() - startMs;
      const timeSec = elapsed / 1000;
      const progress = Math.min(elapsed / totalMs, 1);
      
      setExportProgress(Math.round(progress * 100));

      if (progress >= 1) {
        clearInterval(renderInterval);
        // Draw final frame
        renderCurrentFrame(audioDuration);
        
        // Stop everything
        setTimeout(() => {
          try {
            source.stop();
          } catch(e) {}
          recorder.stop();
          canvasStream.getTracks().forEach(t => t.stop());
          audioContext.close();
        }, 200);
        return;
      }

      renderCurrentFrame(timeSec);
    }, frameInterval);

    // Safety timeout
    setTimeout(() => {
      clearInterval(renderInterval);
      try {
        source.stop();
      } catch(e) {}
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch(e) {}
      canvasStream.getTracks().forEach(t => t.stop());
      audioContext.close();
      setIsExporting(false);
    }, totalMs + 3000);

    await exportDone;
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAudioLoaded = () => {
    if (audioRef.current) {
      const dur = audioRef.current.duration;
      if (dur && isFinite(dur)) {
        setAudioDuration(dur);
      }
    }
  };

  // Draw initial frame when images change
  useEffect(() => {
    if (images.length > 0 && !isPlaying) {
      renderCurrentFrame(0);
    }
  }, [images.length, isPlaying, renderCurrentFrame]);

  const readyForVideo = audioFile && images.length > 0 && audioDuration > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-950/30 to-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-xl bg-black/30 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                VideoForge
              </h1>
              <p className="text-xs text-gray-500">Voice + Images → Video</p>
            </div>
          </div>
          {audioDuration > 0 && (
            <span className="text-sm text-gray-400 flex items-center gap-1.5 bg-white/5 px-3 py-1.5 rounded-full">
              <Clock className="w-3.5 h-3.5" />
              {formatTime(audioDuration)} • {images.length} images
            </span>
          )}
        </div>
      </header>

      {/* Tabs */}
      <nav className="border-b border-white/10 bg-black/10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-0">
            {([
              { id: 'upload', label: 'Upload', icon: Upload },
              { id: 'storyboard', label: 'Storyboard', icon: Layers },
              { id: 'preview', label: 'Preview', icon: Play },
              { id: 'export', label: 'Export', icon: Download },
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-all ${
                  activeTab === tab.id
                    ? 'border-purple-500 text-purple-400 bg-purple-500/5'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Status message */}
      {statusMsg && (
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2 text-yellow-300 text-sm">
            <AlertCircle className="w-4 h-4" />
            {statusMsg}
            <button onClick={() => setStatusMsg('')} className="ml-auto text-yellow-500 hover:text-yellow-300">×</button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div className="grid md:grid-cols-2 gap-8">
            {/* Audio */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <Music className="w-4 h-4 text-purple-400" />
                </div>
                Voiceover Audio
              </h2>
              <label className="block border-2 border-dashed border-purple-500/30 rounded-2xl p-8 text-center cursor-pointer hover:border-purple-500/60 hover:bg-purple-500/5 transition-all group">
                <input type="file" accept="audio/*" onChange={handleAudioUpload} className="hidden" />
                {audioFile ? (
                  <div className="space-y-3">
                    <div className="w-16 h-16 mx-auto rounded-full bg-purple-500/20 flex items-center justify-center">
                      <CheckCircle className="w-8 h-8 text-purple-400" />
                    </div>
                    <p className="text-purple-300 font-medium">{audioFile.name}</p>
                    <p className="text-sm text-gray-500">{(audioFile.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-16 h-16 mx-auto rounded-full bg-gray-800 flex items-center justify-center group-hover:bg-purple-500/20 transition-all">
                      <Upload className="w-8 h-8 text-gray-500 group-hover:text-purple-400" />
                    </div>
                    <p className="text-gray-300 font-medium">Upload voiceover</p>
                    <p className="text-sm text-gray-500">MP3, WAV, OGG, M4A</p>
                  </div>
                )}
              </label>
              {audioUrl && (
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <audio ref={audioRef} src={audioUrl} onLoadedMetadata={handleAudioLoaded} controls className="w-full" />
                </div>
              )}
            </div>

            {/* Images */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-pink-500/20 flex items-center justify-center">
                  <ImageIcon className="w-4 h-4 text-pink-400" />
                </div>
                Images ({images.length})
              </h2>
              <label className="block border-2 border-dashed border-pink-500/30 rounded-2xl p-8 text-center cursor-pointer hover:border-pink-500/60 hover:bg-pink-500/5 transition-all group">
                <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                <div className="space-y-3">
                  <div className="w-16 h-16 mx-auto rounded-full bg-gray-800 flex items-center justify-center group-hover:bg-pink-500/20 transition-all">
                    <ImageIcon className="w-8 h-8 text-gray-500 group-hover:text-pink-400" />
                  </div>
                  <p className="text-gray-300 font-medium">Upload images</p>
                  <p className="text-sm text-gray-500">Multiple images • PNG, JPG, WEBP</p>
                </div>
              </label>

              {images.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {images.map((img, idx) => (
                    <div key={img.id} className="relative aspect-video rounded-lg overflow-hidden group border border-white/10">
                      <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                        <button onClick={() => removeImage(img.id)} className="w-8 h-8 rounded-full bg-red-500/80 flex items-center justify-center hover:bg-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <span className="absolute bottom-1 left-1 text-[10px] bg-black/80 px-1.5 py-0.5 rounded font-mono">
                        #{idx + 1}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Status cards */}
            <div className="md:col-span-2">
              <div className="bg-white/5 rounded-xl p-6 border border-white/10">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-yellow-400" />
                  Progress
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className={`p-4 rounded-lg transition-all ${audioFile ? 'bg-green-500/10 border border-green-500/30' : 'bg-gray-800/50 border border-gray-700/50'}`}>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Audio</p>
                    <p className={`font-semibold mt-1 ${audioFile ? 'text-green-400' : 'text-gray-600'}`}>
                      {audioFile ? '✓ Ready' : 'Pending'}
                    </p>
                  </div>
                  <div className={`p-4 rounded-lg transition-all ${images.length > 0 ? 'bg-green-500/10 border border-green-500/30' : 'bg-gray-800/50 border border-gray-700/50'}`}>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Images</p>
                    <p className={`font-semibold mt-1 ${images.length > 0 ? 'text-green-400' : 'text-gray-600'}`}>
                      {images.length > 0 ? `✓ ${images.length} images` : 'Pending'}
                    </p>
                  </div>
                  <div className={`p-4 rounded-lg transition-all ${readyForVideo ? 'bg-green-500/10 border border-green-500/30' : 'bg-gray-800/50 border border-gray-700/50'}`}>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Per Image</p>
                    <p className={`font-semibold mt-1 ${readyForVideo ? 'text-green-400' : 'text-gray-600'}`}>
                      {readyForVideo ? `${(audioDuration / images.length).toFixed(1)}s` : '—'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Storyboard Tab */}
        {activeTab === 'storyboard' && (
          <div className="space-y-6">
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-purple-400" />
                Effects — Apply to All
              </h3>
              <div className="flex flex-wrap gap-2">
                {EFFECTS.map(effect => (
                  <button
                    key={effect.id}
                    onClick={() => applyEffectToAll(effect.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedEffect === effect.id
                        ? 'bg-purple-500/30 border border-purple-500 text-purple-300 shadow-lg shadow-purple-500/10'
                        : 'bg-gray-800/80 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                  >
                    {effect.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Layers className="w-5 h-5 text-pink-400" />
                Timeline
              </h3>
              {images.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Upload images to build your storyboard</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {images.map((img, idx) => (
                    <div key={img.id} className="flex items-center gap-3 bg-gray-800/40 rounded-xl p-3 border border-white/5 hover:border-white/10 transition-all">
                      <div className="flex items-center gap-1 text-gray-600">
                        <GripVertical className="w-4 h-4" />
                        <span className="text-xs font-mono w-5 text-center">{idx + 1}</span>
                      </div>
                      <img src={img.url} alt={img.name} className="w-16 h-10 object-cover rounded-md" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-300 truncate">{img.name}</p>
                        <p className="text-xs text-gray-500">{img.duration.toFixed(1)}s</p>
                      </div>
                      <select
                        value={img.effect}
                        onChange={(e) => applyEffectToSingle(img.id, e.target.value as EffectType)}
                        className="bg-gray-700/80 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-purple-500"
                      >
                        {EFFECTS.map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeImage(img.id)}
                        className="p-2 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-gray-400" />
                Video Settings
              </h3>
              <div>
                <label className="text-sm text-gray-400 mb-2 block">Resolution</label>
                <div className="flex gap-3">
                  {(['720p', '1080p'] as const).map(res => (
                    <button
                      key={res}
                      onClick={() => setResolution(res)}
                      className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        resolution === res
                          ? 'bg-purple-500/30 border border-purple-500 text-purple-300'
                          : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-white'
                      }`}
                    >
                      {res === '720p' ? 'HD 720p' : 'Full HD 1080p'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Preview Tab */}
        {activeTab === 'preview' && (
          <div className="space-y-6">
            <div className="bg-black rounded-2xl overflow-hidden border border-white/10 relative shadow-2xl">
              <canvas
                ref={canvasRef}
                className="w-full bg-black"
                style={{ aspectRatio: '16/9', maxHeight: '70vh' }}
              />
              {!isPlaying && readyForVideo && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                  <button
                    onClick={startPreview}
                    className="w-20 h-20 rounded-full bg-purple-500/90 hover:bg-purple-500 flex items-center justify-center transition-all hover:scale-110 shadow-xl shadow-purple-500/30"
                  >
                    <Play className="w-9 h-9 ml-1" />
                  </button>
                </div>
              )}
              {!readyForVideo && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <div className="text-center">
                    <Film className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                    <p className="text-gray-400">Upload audio & images to preview</p>
                  </div>
                </div>
              )}
            </div>

            {/* Player controls */}
            <div className="flex items-center gap-4 bg-white/5 rounded-xl p-4 border border-white/10">
              <button
                onClick={isPlaying ? stopPreview : startPreview}
                disabled={!readyForVideo}
                className="w-11 h-11 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center hover:opacity-90 transition-all disabled:opacity-30 shadow-lg shadow-purple-500/20"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>
              <div className="flex-1">
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden cursor-pointer">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-100"
                    style={{ width: `${audioDuration ? (currentTime / audioDuration) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <span className="text-sm text-gray-400 font-mono min-w-[90px] text-right">
                {formatTime(currentTime)} / {formatTime(audioDuration)}
              </span>
            </div>
          </div>
        )}

        {/* Export Tab */}
        {activeTab === 'export' && (
          <div className="space-y-6">
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10 text-center">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mb-5">
                {isExporting ? (
                  <Loader className="w-10 h-10 text-purple-400 animate-spin" />
                ) : videoUrl ? (
                  <CheckCircle className="w-10 h-10 text-green-400" />
                ) : (
                  <Download className="w-10 h-10 text-purple-400" />
                )}
              </div>
              
              <h3 className="text-2xl font-bold mb-2">
                {isExporting ? 'Exporting Video...' : videoUrl ? 'Video Ready!' : 'Export Video'}
              </h3>
              <p className="text-gray-400 mb-6">
                {resolution === '1080p' ? '1920×1080' : '1280×720'} • WebM • {images.length} scenes • {formatTime(audioDuration)}
              </p>

              {isExporting ? (
                <div className="max-w-md mx-auto space-y-3">
                  <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-300"
                      style={{ width: `${exportProgress}%` }}
                    />
                  </div>
                  <p className="text-purple-400 font-medium text-lg">{exportProgress}%</p>
                  <p className="text-sm text-gray-500">Rendering frames... Please wait</p>
                </div>
              ) : videoUrl ? (
                <div className="space-y-5">
                  <a
                    href={videoUrl}
                    download="videoforge-video.webm"
                    className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-semibold hover:opacity-90 transition-all shadow-lg shadow-purple-500/20"
                  >
                    <Download className="w-5 h-5" />
                    Download Video
                  </a>
                  <div className="mt-6">
                    <video src={videoUrl} controls className="w-full max-w-2xl mx-auto rounded-xl border border-white/10" />
                  </div>
                </div>
              ) : (
                <button
                  onClick={exportVideo}
                  disabled={!readyForVideo || isExporting}
                  className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-semibold hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20"
                >
                  <Film className="w-5 h-5" />
                  Generate Video
                </button>
              )}
            </div>

            {/* How it works */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-yellow-400" />
                Steps
              </h3>
              <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { n: '1', t: 'Upload Audio', d: 'Your voiceover file' },
                  { n: '2', t: 'Add Images', d: 'Scene-by-scene images' },
                  { n: '3', t: 'Set Effects', d: 'Ken Burns, zoom, pan' },
                  { n: '4', t: 'Export', d: 'Download your video' },
                ].map(s => (
                  <div key={s.n} className="text-center p-4 bg-gray-800/30 rounded-xl border border-white/5">
                    <div className="w-8 h-8 mx-auto rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold text-sm mb-2">
                      {s.n}
                    </div>
                    <p className="font-medium text-sm">{s.t}</p>
                    <p className="text-xs text-gray-500 mt-1">{s.d}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-white/10 mt-16 py-6">
        <p className="text-center text-gray-600 text-sm">VideoForge — Voice + Images → Engaging Video</p>
      </footer>
    </div>
  );
}
