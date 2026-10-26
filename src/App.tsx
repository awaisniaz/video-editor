import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, Image, Music, Play, Pause, Download, Sparkles,
  Film, Clock, Layers, ZoomIn, Move, RotateCw, ChevronRight,
  Volume2, Settings, Wand2, Trash2, GripVertical, ChevronLeft
} from 'lucide-react';

interface ImageItem {
  id: string;
  file: File;
  url: string;
  name: string;
  duration: number;
  effect: EffectType;
  img: HTMLImageElement;
}

type EffectType = 'kenburns' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'fade' | 'none';

const EFFECTS: { id: EffectType; name: string; icon: any }[] = [
  { id: 'kenburns', name: 'Ken Burns', icon: ZoomIn },
  { id: 'zoom-in', name: 'Zoom In', icon: ZoomIn },
  { id: 'zoom-out', name: 'Zoom Out', icon: ZoomIn },
  { id: 'pan-left', name: 'Pan Left', icon: Move },
  { id: 'pan-right', name: 'Pan Right', icon: Move },
  { id: 'fade', name: 'Fade', icon: Sparkles },
  { id: 'none', name: 'No Effect', icon: Film },
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
  const [transitionDuration, setTransitionDuration] = useState(0.5);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newImages: ImageItem[] = [];
    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        const img = new window.Image();
        img.onload = () => {
          setImages(prev => [...prev, {
            id: Math.random().toString(36).substr(2, 9),
            file,
            url,
            name: file.name,
            duration: 0,
            effect: selectedEffect,
            img,
          }]);
        };
        img.src = url;
      }
    });
  };

  // Auto-distribute duration when audio duration or images change
  useEffect(() => {
    if (audioDuration > 0 && images.length > 0) {
      const durationPerImage = audioDuration / images.length;
      setImages(prev => prev.map(img => ({ ...img, duration: durationPerImage })));
    }
  }, [audioDuration, images.length]);

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

  const getResolution = () => {
    return resolution === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  };

  const drawFrame = useCallback((canvas: HTMLCanvasElement, img: HTMLImageElement, progress: number, effect: EffectType) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = getResolution();
    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Calculate image dimensions to cover canvas
    const imgAspect = img.width / img.height;
    const canvasAspect = width / height;
    let drawWidth, drawHeight;

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
        scale = 1 + progress * 0.2;
        offsetX = -progress * drawWidth * 0.05;
        offsetY = -progress * drawHeight * 0.05;
        break;
      case 'zoom-in':
        scale = 1 + progress * 0.3;
        break;
      case 'zoom-out':
        scale = 1.3 - progress * 0.3;
        break;
      case 'pan-left':
        offsetX = progress * drawWidth * 0.15;
        scale = 1.2;
        break;
      case 'pan-right':
        offsetX = -progress * drawWidth * 0.15;
        scale = 1.2;
        break;
      case 'fade':
        alpha = progress < 0.1 ? progress * 10 : progress > 0.9 ? (1 - progress) * 10 : 1;
        scale = 1.05;
        break;
      default:
        scale = 1.05;
        break;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-width / 2 + offsetX, -height / 2 + offsetY);

    const x = (width - drawWidth) / 2;
    const y = (height - drawHeight) / 2;
    ctx.drawImage(img, x, y, drawWidth, drawHeight);
    ctx.restore();

    // Add subtle vignette
    const gradient = ctx.createRadialGradient(
      width / 2, height / 2, height * 0.3,
      width / 2, height / 2, height * 0.8
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }, [resolution]);

  const startPreview = () => {
    if (!audioRef.current || images.length === 0 || !audioDuration) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsPlaying(true);
    audioRef.current.currentTime = 0;
    audioRef.current.play();
    startTimeRef.current = performance.now();

    const animate = () => {
      if (!audioRef.current) return;
      const elapsed = audioRef.current.currentTime;
      setCurrentTime(elapsed);

      if (elapsed >= audioDuration) {
        setIsPlaying(false);
        return;
      }

      // Find current image
      let accumulatedTime = 0;
      let currentImgIndex = 0;
      for (let i = 0; i < images.length; i++) {
        if (elapsed < accumulatedTime + images[i].duration) {
          currentImgIndex = i;
          break;
        }
        accumulatedTime += images[i].duration;
        if (i === images.length - 1) currentImgIndex = i;
      }

      const currentImg = images[currentImgIndex];
      const imgProgress = (elapsed - accumulatedTime) / currentImg.duration;

      drawFrame(canvas, currentImg.img, Math.min(imgProgress, 1), currentImg.effect);
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();
  };

  const stopPreview = () => {
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    cancelAnimationFrame(animationRef.current);
    setCurrentTime(0);
  };

  const exportVideo = async () => {
    if (!audioFile || images.length === 0 || !audioDuration) return;

    setIsExporting(true);
    setExportProgress(0);

    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height } = getResolution();
    canvas.width = width;
    canvas.height = height;

    const stream = canvas.captureStream(30);
    
    // Add audio track
    const audioContext = new AudioContext();
    const audioSource = audioContext.createBufferSource();
    const audioBuffer = await audioFile.arrayBuffer();
    const decodedBuffer = await audioContext.decodeAudioData(audioBuffer);
    audioSource.buffer = decodedBuffer;
    
    const destination = audioContext.createMediaStreamDestination();
    audioSource.connect(destination);
    
    const combinedStream = new MediaStream([
      ...stream.getVideoTracks(),
      ...destination.stream.getAudioTracks()
    ]);

    const mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType: 'video/webm;codecs=vp9,opus',
      videoBitsPerSecond: resolution === '1080p' ? 8000000 : 4000000
    });

    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setIsExporting(false);
      setExportProgress(100);
    };

    mediaRecorder.start();
    audioSource.start();

    const totalDuration = audioDuration * 1000;
    const startTime = performance.now();

    const renderLoop = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / totalDuration, 1);
      setExportProgress(Math.round(progress * 100));

      if (progress >= 1) {
        mediaRecorder.stop();
        audioSource.stop();
        return;
      }

      const currentTimeSec = elapsed / 1000;
      let accumulatedTime = 0;
      let currentImgIndex = 0;
      for (let i = 0; i < images.length; i++) {
        if (currentTimeSec < accumulatedTime + images[i].duration) {
          currentImgIndex = i;
          break;
        }
        accumulatedTime += images[i].duration;
        if (i === images.length - 1) currentImgIndex = i;
      }

      const currentImg = images[currentImgIndex];
      const imgProgress = (currentTimeSec - accumulatedTime) / currentImg.duration;
      drawFrame(canvas, currentImg.img, Math.min(imgProgress, 1), currentImg.effect);

      requestAnimationFrame(renderLoop);
    };

    renderLoop();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAudioLoaded = () => {
    if (audioRef.current) {
      setAudioDuration(audioRef.current.duration);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-xl bg-black/20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                VideoForge
              </h1>
              <p className="text-xs text-gray-400">Voice + Images = Video</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {audioDuration > 0 && (
              <span className="text-sm text-gray-400 flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {formatTime(audioDuration)}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="border-b border-white/10 bg-black/10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1">
            {[
              { id: 'upload', label: 'Upload', icon: Upload },
              { id: 'storyboard', label: 'Storyboard', icon: Layers },
              { id: 'preview', label: 'Preview', icon: Play },
              { id: 'export', label: 'Export', icon: Download },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all ${
                  activeTab === tab.id
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div className="grid md:grid-cols-2 gap-8">
            {/* Audio Upload */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Music className="w-5 h-5 text-purple-400" />
                Voiceover Audio
              </h2>
              <label className="block border-2 border-dashed border-purple-500/30 rounded-2xl p-8 text-center cursor-pointer hover:border-purple-500/60 hover:bg-purple-500/5 transition-all group">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioUpload}
                  className="hidden"
                />
                {audioFile ? (
                  <div className="space-y-2">
                    <div className="w-16 h-16 mx-auto rounded-full bg-purple-500/20 flex items-center justify-center">
                      <Music className="w-8 h-8 text-purple-400" />
                    </div>
                    <p className="text-purple-300 font-medium">{audioFile.name}</p>
                    <p className="text-sm text-gray-400">
                      {(audioFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-16 h-16 mx-auto rounded-full bg-gray-800 flex items-center justify-center group-hover:bg-purple-500/20 transition-all">
                      <Upload className="w-8 h-8 text-gray-400 group-hover:text-purple-400" />
                    </div>
                    <div>
                      <p className="text-gray-300 font-medium">Click to upload voiceover</p>
                      <p className="text-sm text-gray-500">MP3, WAV, OGG supported</p>
                    </div>
                  </div>
                )}
              </label>
              {audioUrl && (
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  onLoadedMetadata={handleAudioLoaded}
                  className="w-full mt-4"
                  controls
                />
              )}
            </div>

            {/* Images Upload */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Image className="w-5 h-5 text-pink-400" />
                Images
              </h2>
              <label className="block border-2 border-dashed border-pink-500/30 rounded-2xl p-8 text-center cursor-pointer hover:border-pink-500/60 hover:bg-pink-500/5 transition-all group">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <div className="space-y-3">
                  <div className="w-16 h-16 mx-auto rounded-full bg-gray-800 flex items-center justify-center group-hover:bg-pink-500/20 transition-all">
                    <Image className="w-8 h-8 text-gray-400 group-hover:text-pink-400" />
                  </div>
                  <div>
                    <p className="text-gray-300 font-medium">Click to upload images</p>
                    <p className="text-sm text-gray-500">Multiple images supported • PNG, JPG, WEBP</p>
                  </div>
                </div>
              </label>

              {/* Image thumbnails */}
              {images.length > 0 && (
                <div className="grid grid-cols-4 gap-2 mt-4">
                  {images.map((img, idx) => (
                    <div key={img.id} className="relative aspect-video rounded-lg overflow-hidden group">
                      <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                        <button
                          onClick={() => removeImage(img.id)}
                          className="w-8 h-8 rounded-full bg-red-500/80 flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <span className="absolute bottom-1 left-1 text-xs bg-black/70 px-1.5 py-0.5 rounded">
                        {idx + 1}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Status */}
            <div className="md:col-span-2 mt-4">
              <div className="bg-white/5 rounded-xl p-6 border border-white/10">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-yellow-400" />
                  Status
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className={`p-3 rounded-lg ${audioFile ? 'bg-green-500/10 border border-green-500/30' : 'bg-gray-800'}`}>
                    <p className="text-sm text-gray-400">Audio</p>
                    <p className={`font-medium ${audioFile ? 'text-green-400' : 'text-gray-500'}`}>
                      {audioFile ? '✓ Ready' : 'Not uploaded'}
                    </p>
                  </div>
                  <div className={`p-3 rounded-lg ${images.length > 0 ? 'bg-green-500/10 border border-green-500/30' : 'bg-gray-800'}`}>
                    <p className="text-sm text-gray-400">Images</p>
                    <p className={`font-medium ${images.length > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                      {images.length > 0 ? `✓ ${images.length} images` : 'Not uploaded'}
                    </p>
                  </div>
                  <div className={`p-3 rounded-lg ${audioDuration > 0 && images.length > 0 ? 'bg-green-500/10 border border-green-500/30' : 'bg-gray-800'}`}>
                    <p className="text-sm text-gray-400">Duration/Image</p>
                    <p className={`font-medium ${audioDuration > 0 && images.length > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                      {images.length > 0 && audioDuration > 0
                        ? `${(audioDuration / images.length).toFixed(1)}s`
                        : '—'}
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
            {/* Effects Panel */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-purple-400" />
                Effects
              </h3>
              <div className="flex flex-wrap gap-2 mb-4">
                {EFFECTS.map(effect => (
                  <button
                    key={effect.id}
                    onClick={() => applyEffectToAll(effect.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                      selectedEffect === effect.id
                        ? 'bg-purple-500/30 border border-purple-500/50 text-purple-300'
                        : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-white'
                    }`}
                  >
                    <effect.icon className="w-4 h-4" />
                    {effect.name}
                  </button>
                ))}
              </div>
              <p className="text-sm text-gray-400">
                Click an effect to apply to ALL images. You can also set individual effects below.
              </p>
            </div>

            {/* Timeline */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Layers className="w-5 h-5 text-pink-400" />
                Timeline
              </h3>
              {images.length === 0 ? (
                <p className="text-gray-500 text-center py-8">Upload images first to see the timeline</p>
              ) : (
                <div className="space-y-3">
                  {images.map((img, idx) => (
                    <div key={img.id} className="flex items-center gap-4 bg-gray-800/50 rounded-lg p-3 border border-white/5">
                      <div className="flex items-center gap-2 text-gray-500">
                        <GripVertical className="w-4 h-4" />
                        <span className="text-sm font-mono w-6">{idx + 1}</span>
                      </div>
                      <img src={img.url} alt={img.name} className="w-20 h-12 object-cover rounded" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-300 truncate">{img.name}</p>
                        <p className="text-xs text-gray-500">{img.duration.toFixed(1)}s</p>
                      </div>
                      <select
                        value={img.effect}
                        onChange={(e) => applyEffectToSingle(img.id, e.target.value as EffectType)}
                        className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-300"
                      >
                        {EFFECTS.map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeImage(img.id)}
                        className="p-1.5 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Settings */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-gray-400" />
                Settings
              </h3>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Resolution</label>
                  <div className="flex gap-2">
                    {(['720p', '1080p'] as const).map(res => (
                      <button
                        key={res}
                        onClick={() => setResolution(res)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          resolution === res
                            ? 'bg-purple-500/30 border border-purple-500/50 text-purple-300'
                            : 'bg-gray-800 border border-gray-700 text-gray-400'
                        }`}
                      >
                        {res}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Transition Duration</label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={transitionDuration}
                    onChange={(e) => setTransitionDuration(parseFloat(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                  <span className="text-sm text-gray-400">{transitionDuration}s</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Preview Tab */}
        {activeTab === 'preview' && (
          <div className="space-y-6">
            <div className="bg-black rounded-2xl overflow-hidden border border-white/10 relative">
              <canvas
                ref={canvasRef}
                className="w-full aspect-video bg-black"
                style={{ maxHeight: '500px' }}
              />
              {!isPlaying && images.length > 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <button
                    onClick={startPreview}
                    disabled={!audioFile || images.length === 0}
                    className="w-16 h-16 rounded-full bg-purple-500/80 hover:bg-purple-500 flex items-center justify-center transition-all hover:scale-110 disabled:opacity-50"
                  >
                    <Play className="w-8 h-8 ml-1" />
                  </button>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4 bg-white/5 rounded-xl p-4 border border-white/10">
              <button
                onClick={isPlaying ? stopPreview : startPreview}
                disabled={!audioFile || images.length === 0}
                className="w-10 h-10 rounded-full bg-purple-500 flex items-center justify-center hover:bg-purple-600 transition-all disabled:opacity-50"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>
              <div className="flex-1">
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all"
                    style={{ width: `${audioDuration ? (currentTime / audioDuration) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <span className="text-sm text-gray-400 font-mono">
                {formatTime(currentTime)} / {formatTime(audioDuration)}
              </span>
            </div>

            {(!audioFile || images.length === 0) && (
              <div className="text-center py-8 text-gray-400">
                <p>Please upload audio and images first</p>
              </div>
            )}
          </div>
        )}

        {/* Export Tab */}
        {activeTab === 'export' && (
          <div className="space-y-6">
            <div className="bg-white/5 rounded-xl p-8 border border-white/10 text-center">
              <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mb-4">
                <Download className="w-10 h-10 text-purple-400" />
              </div>
              <h3 className="text-xl font-bold mb-2">Export Video</h3>
              <p className="text-gray-400 mb-6">
                {resolution === '1080p' ? '1920×1080' : '1280×720'} • WebM format • {images.length} images
              </p>

              {isExporting ? (
                <div className="space-y-4">
                  <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-300"
                      style={{ width: `${exportProgress}%` }}
                    />
                  </div>
                  <p className="text-purple-400 font-medium">Exporting... {exportProgress}%</p>
                </div>
              ) : videoUrl ? (
                <div className="space-y-4">
                  <a
                    href={videoUrl}
                    download="videoforge-output.webm"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-medium hover:opacity-90 transition-all"
                  >
                    <Download className="w-5 h-5" />
                    Download Video
                  </a>
                  <div className="mt-4">
                    <video src={videoUrl} controls className="w-full max-w-lg mx-auto rounded-lg" />
                  </div>
                </div>
              ) : (
                <button
                  onClick={exportVideo}
                  disabled={!audioFile || images.length === 0 || isExporting}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-medium hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Film className="w-5 h-5" />
                  Generate Video
                </button>
              )}
            </div>

            {/* Instructions */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-yellow-400" />
                How it works
              </h3>
              <div className="grid md:grid-cols-4 gap-4">
                {[
                  { step: '1', title: 'Upload Audio', desc: 'Upload your voiceover audio file' },
                  { step: '2', title: 'Add Images', desc: 'Upload images for each scene' },
                  { step: '3', title: 'Apply Effects', desc: 'Choose Ken Burns, zoom, pan effects' },
                  { step: '4', title: 'Export', desc: 'Generate and download your video' },
                ].map(item => (
                  <div key={item.step} className="text-center p-4 bg-gray-800/50 rounded-lg">
                    <div className="w-8 h-8 mx-auto rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold mb-2">
                      {item.step}
                    </div>
                    <p className="font-medium text-sm">{item.title}</p>
                    <p className="text-xs text-gray-400 mt-1">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-12 py-6">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-500 text-sm">
          <p>VideoForge — Create engaging videos from voiceover + images</p>
        </div>
      </footer>
    </div>
  );
}
