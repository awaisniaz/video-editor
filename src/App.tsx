import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, Image as ImageIcon, Music, Play, Pause, Download, Sparkles,
  Film, Clock, CheckCircle, AlertCircle, Loader, Zap, Brain,
  Target, FileText, Mic, Info
} from 'lucide-react';

interface ImageItem {
  id: string;
  file: File;
  url: string;
  name: string;
  prompt: string;
  img: HTMLImageElement;
  loaded: boolean;
}

interface SyncedImage {
  image: ImageItem;
  startTime: number;
  duration: number;
  matchedWords: string[];
  matchPosition: number; // position in transcript (0 to 1)
  effect: EffectType;
}

type EffectType = 'kenburns' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'fade';

const EFFECTS: EffectType[] = ['kenburns', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'fade'];

type Stage = 'idle' | 'uploading' | 'prompts' | 'transcript' | 'ready';

export default function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [promptsText, setPromptsText] = useState<string>('');
  const [transcriptText, setTranscriptText] = useState<string>('');
  const [syncedImages, setSyncedImages] = useState<SyncedImage[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [statusMsg, setStatusMsg] = useState('');
  const [stage, setStage] = useState<Stage>('idle');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animFrameRef = useRef<number>(0);

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setVideoUrl('');
      setAudioDuration(0);
      setSyncedImages([]);
      setStage('uploading');
    }
  };

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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    const newImages: ImageItem[] = [];
    for (const file of fileArray) {
      const { img, url } = await loadImage(file);
      newImages.push({
        id: Math.random().toString(36).substr(2, 9),
        file, url, name: file.name, prompt: '', img, loaded: true,
      });
    }
    setImages(prev => [...prev, ...newImages]);
    setStage('prompts');
  };

  const assignPrompts = () => {
    if (!promptsText.trim()) {
      setStatusMsg('Pehle prompts paste karein!');
      return;
    }
    const prompts = promptsText.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
    if (prompts.length === 0) {
      setStatusMsg('Koi valid prompts nahi mile!');
      return;
    }
    setImages(prev => prev.map((img, idx) => ({ ...img, prompt: prompts[idx] || '' })));
    setStage('transcript');
    setStatusMsg(`✓ ${Math.min(prompts.length, images.length)} prompts assign ho gaye! Ab transcript paste karein`);
  };

  useEffect(() => {
    if (!audioUrl) return;
    const timer = setTimeout(() => {
      if (audioRef.current && (!audioDuration || audioDuration <= 0)) {
        const dur = audioRef.current.duration;
        if (dur && isFinite(dur)) {
          setAudioDuration(dur);
        } else if (audioRef.current) {
          audioRef.current.currentTime = 1e101;
          setTimeout(() => {
            if (audioRef.current) {
              const d = audioRef.current.duration;
              if (d && isFinite(d)) setAudioDuration(d);
              audioRef.current.currentTime = 0;
            }
          }, 100);
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [audioUrl]);

  // Core sync function - matches prompt words with transcript to find exact timing
  const syncWithNarration = () => {
    if (!transcriptText.trim()) {
      setStatusMsg('Pehle transcript paste karein!');
      return;
    }
    if (!audioDuration) {
      setStatusMsg('Audio duration detect nahi hua!');
      return;
    }

    const imagesWithPrompts = images.filter(img => img.prompt.trim());
    if (imagesWithPrompts.length === 0) {
      setStatusMsg('Koi image prompt nahi hai!');
      return;
    }

    // Clean transcript
    const transcriptClean = transcriptText.toLowerCase().replace(/[^\w\s]/g, ' ');
    const transcriptWords = transcriptClean.split(/\s+/).filter(w => w.length > 0);
    
    // Stop words to ignore
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but', 'with', 'by', 'from', 'as', 'it', 'its', 'this', 'that', 'we', 'you', 'they', 'he', 'she', 'i', 'my', 'your', 'their', 'his', 'her', 'our', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'not', 'no', 'so', 'if', 'then', 'than', 'too', 'very', 'just', 'about', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'because', 'while', 'also', 'what', 'which', 'who', 'whom', 'these', 'those', 'am']);

    // For each image prompt, find where it appears in transcript
    const matchedImages: SyncedImage[] = [];

    for (const img of imagesWithPrompts) {
      const promptWords = img.prompt
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

      let bestPosition = -1;
      let bestScore = 0;
      const matchedWords: string[] = [];

      // For each word in prompt, find its position in transcript
      for (const promptWord of promptWords) {
        for (let i = 0; i < transcriptWords.length; i++) {
          const tw = transcriptWords[i];
          
          // Exact match
          if (tw === promptWord) {
            const position = i / transcriptWords.length;
            if (bestScore < 1) {
              bestScore = 1;
              bestPosition = position;
              matchedWords.push(promptWord);
            }
          }
          // Partial match (contains)
          else if (tw.includes(promptWord) || promptWord.includes(tw)) {
            const position = i / transcriptWords.length;
            const score = 0.8;
            if (score > bestScore) {
              bestScore = score;
              bestPosition = position;
              matchedWords.push(promptWord);
            }
          }
        }
      }

      // If we found a match
      if (bestPosition >= 0) {
        matchedImages.push({
          image: img,
          startTime: bestPosition * audioDuration,
          duration: 0, // will calculate later
          matchedWords,
          matchPosition: bestPosition,
          effect: EFFECTS[matchedImages.length % EFFECTS.length],
        });
      }
    }

    // Sort by position in narration
    matchedImages.sort((a, b) => a.matchPosition - b.matchPosition);

    // Calculate durations: each image shows until next image starts
    const finalSynced = matchedImages.map((item, idx) => {
      const nextStart = idx < matchedImages.length - 1 
        ? matchedImages[idx + 1].startTime 
        : audioDuration;
      return {
        ...item,
        duration: Math.max(1, nextStart - item.startTime),
      };
    });

    // Handle images that didn't match - put them at end
    const unmatched = imagesWithPrompts.filter(img => 
      !finalSynced.some(s => s.image.id === img.id)
    );
    
    if (unmatched.length > 0 && finalSynced.length > 0) {
      const lastEnd = finalSynced[finalSynced.length - 1].startTime + finalSynced[finalSynced.length - 1].duration;
      const remainingTime = audioDuration - lastEnd;
      if (remainingTime > 0) {
        const durPerUnmatched = remainingTime / unmatched.length;
        unmatched.forEach((img, idx) => {
          finalSynced.push({
            image: img,
            startTime: lastEnd + idx * durPerUnmatched,
            duration: durPerUnmatched,
            matchedWords: [],
            matchPosition: 1,
            effect: EFFECTS[(finalSynced.length + idx) % EFFECTS.length],
          });
        });
      }
    }

    setSyncedImages(finalSynced);
    setStage('ready');
    setStatusMsg(`✓ ${finalSynced.length} images narration ke saath sync ho gayi!`);
  };

  const drawFrame = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, progress: number, effect: EffectType, width: number, height: number) => {
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
      drawFrame(ctx, result.img.image.img, result.progress, result.img.effect, width, height);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, width, height);
    }
  }, [syncedImages, resolution]);

  const startPreview = () => {
    const audio = audioRef.current;
    if (!audio || !audioFile || syncedImages.length === 0 || !audioDuration) {
      setStatusMsg('Pehle sync complete karein!');
      return;
    }
    cancelAnimationFrame(animFrameRef.current);
    audio.currentTime = 0;
    audio.volume = 1;
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.then(() => {
        setIsPlaying(true);
        const animate = () => {
          const time = audio.currentTime;
          setCurrentTime(time);
          renderCurrentFrame(time);
          if (time >= audioDuration - 0.05 || audio.ended) {
            setIsPlaying(false);
            return;
          }
          animFrameRef.current = requestAnimationFrame(animate);
        };
        animate();
      }).catch(err => setStatusMsg('Play failed: ' + err.message));
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
    if (!audioFile || syncedImages.length === 0 || !audioDuration) return;
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
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
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

    const totalMs = audioDuration * 1000;
    const startMs = performance.now();

    const renderInterval = setInterval(() => {
      const elapsed = performance.now() - startMs;
      const timeSec = elapsed / 1000;
      const progress = Math.min(elapsed / totalMs, 1);
      setExportProgress(Math.round(progress * 100));

      if (progress >= 1) {
        clearInterval(renderInterval);
        renderCurrentFrame(audioDuration);
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
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onLoadedMetadata={(e) => {
            const dur = (e.target as HTMLAudioElement).duration;
            if (dur && isFinite(dur)) setAudioDuration(dur);
          }}
          onCanPlay={() => {
            if (audioRef.current && (!audioDuration || audioDuration <= 0)) {
              const dur = audioRef.current.duration;
              if (dur && isFinite(dur)) setAudioDuration(dur);
            }
          }}
          className="hidden"
          preload="metadata"
        />
      )}

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
              <p className="text-xs text-gray-500">Images ko Narration ke saath EXACT Sync</p>
            </div>
          </div>
          {audioDuration > 0 && (
            <span className="text-sm text-gray-400 flex items-center gap-1.5 bg-white/5 px-3 py-1.5 rounded-full">
              <Clock className="w-3.5 h-3.5" />
              {formatTime(audioDuration)}
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
        {/* Steps indicator */}
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {[
            { id: 'uploading', label: '1. Upload', done: !!audioFile && images.length > 0 },
            { id: 'prompts', label: '2. Prompts', done: images.some(i => i.prompt) },
            { id: 'transcript', label: '3. Transcript', done: !!transcriptText.trim() },
            { id: 'ready', label: '4. Video', done: syncedImages.length > 0 },
          ].map((step, idx) => (
            <div key={step.id} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                step.done ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-gray-800 text-gray-500 border border-gray-700'
              }`}>
                {step.done && <CheckCircle className="w-3 h-3" />}
                {step.label}
              </div>
              {idx < 3 && <span className="text-gray-600">→</span>}
            </div>
          ))}
        </div>

        {/* Step 1 & 2: Upload */}
        {(stage === 'idle' || stage === 'uploading' || stage === 'prompts' || stage === 'transcript' || stage === 'ready') && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
              <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <Music className="w-4 h-4 text-purple-400" />
                </div>
                Voiceover Audio
              </h2>
              <label className="block border-2 border-dashed border-purple-500/30 rounded-xl p-6 text-center cursor-pointer hover:border-purple-500/60 hover:bg-purple-500/5 transition-all group">
                <input type="file" accept="audio/*" onChange={handleAudioUpload} className="hidden" />
                {audioFile ? (
                  <div className="space-y-2">
                    <CheckCircle className="w-10 h-10 mx-auto text-green-400" />
                    <p className="text-green-300 font-medium text-sm">{audioFile.name}</p>
                    <p className="text-xs text-gray-500">{(audioFile.size / 1024 / 1024).toFixed(2)} MB • {formatTime(audioDuration)}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="w-10 h-10 mx-auto text-gray-500 group-hover:text-purple-400" />
                    <p className="text-gray-300 font-medium">Audio upload karein</p>
                    <p className="text-xs text-gray-500">MP3, WAV, OGG</p>
                  </div>
                )}
              </label>
            </div>

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
                  <p className="text-gray-300 font-medium">Images upload karein</p>
                  <p className="text-xs text-gray-500">Multiple select karein</p>
                </div>
              </label>
              {images.length > 0 && (
                <div className="grid grid-cols-5 gap-1.5 mt-4">
                  {images.map((img, idx) => (
                    <div key={img.id} className="relative aspect-video rounded overflow-hidden border border-white/10">
                      <img src={img.url} alt="" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 left-0 text-[8px] bg-black/80 px-1 font-mono">#{idx+1}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Prompts */}
        {images.length > 0 && stage === 'prompts' && (
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-yellow-400" />
              Step 2: Image Prompts Paste Karein
            </h3>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
              <p className="text-sm text-blue-300 mb-2">
                <strong>Important:</strong> Har image ka prompt paste karein. Har prompt ke beech mein <strong>empty line</strong> dein.
              </p>
              <p className="text-xs text-gray-400">
                Pehla prompt = pehli image, doosra = doosri, etc. Order matter karta hai!
              </p>
            </div>
            <textarea
              value={promptsText}
              onChange={(e) => setPromptsText(e.target.value)}
              placeholder={`Prompt for image 1 (narration ka wo hissa jo is image ke liye hai)\n\nPrompt for image 2\n\nPrompt for image 3`}
              className="w-full h-64 bg-gray-800/50 border border-gray-700 rounded-xl p-4 text-sm text-gray-300 focus:outline-none focus:border-purple-500 resize-none font-mono"
            />
            <button
              onClick={assignPrompts}
              disabled={!promptsText.trim()}
              className="mt-4 flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-semibold hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <CheckCircle className="w-5 h-5" />
              Assign Prompts → Next Step
            </button>
          </div>
        )}

        {/* Step 3: Transcript */}
        {stage === 'transcript' && (
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Mic className="w-5 h-5 text-green-400" />
              Step 3: Narration Transcript Paste Karein
            </h3>
            
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
              <div className="flex gap-2">
                <Info className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-yellow-300 font-semibold mb-1">
                    Browser audio files ko directly transcribe nahi kar sakta
                  </p>
                  <p className="text-xs text-gray-400 mb-2">
                    Isliye aapko apni audio ka transcript paste karna hoga. Yeh sirf 10 second ka kaam hai!
                  </p>
                  <p className="text-xs text-green-400">
                    <strong>Free tools:</strong> Google Docs (Tools → Voice typing) • Otter.ai • Whisper • ya koi bhi speech-to-text
                  </p>
                </div>
              </div>
            </div>

            <textarea
              value={transcriptText}
              onChange={(e) => setTranscriptText(e.target.value)}
              placeholder="Apni audio ki poori transcript yahan paste karein..."
              className="w-full h-48 bg-gray-800/50 border border-gray-700 rounded-xl p-4 text-sm text-gray-300 focus:outline-none focus:border-purple-500 resize-none"
            />
            <button
              onClick={syncWithNarration}
              disabled={!transcriptText.trim() || !audioDuration}
              className="mt-4 flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-semibold hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Brain className="w-5 h-5" />
              Narration ke saath Sync Karein
            </button>
          </div>
        )}

        {/* Step 4: Results */}
        {stage === 'ready' && syncedImages.length > 0 && (
          <>
            <div className="bg-green-500/10 rounded-xl p-4 border border-green-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-5 h-5 text-green-400" />
                <h3 className="font-semibold text-green-300">✓ {syncedImages.length} Images Narration ke saath Sync!</h3>
              </div>
              <p className="text-xs text-gray-400">
                Har image tab dikhegi jab narrator uske baare mein bol raha ho
              </p>
            </div>

            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-400" />
                Synced Timeline
              </h3>
              <div className="space-y-2">
                {syncedImages.map((item, idx) => {
                  const durationPercent = (item.duration / audioDuration) * 100;
                  return (
                    <div key={item.image.id} className="bg-gray-800/40 rounded-lg p-3 border border-white/5">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-gray-500 w-6">#{idx+1}</span>
                        <img src={item.image.url} alt="" className="w-16 h-10 object-cover rounded" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-300 line-clamp-2">{item.image.prompt}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs flex-wrap">
                            <span className="text-green-400 font-semibold">
                              ⏱ {formatTimePrecise(item.startTime)} → {formatTimePrecise(item.startTime + item.duration)}
                            </span>
                            <span className="text-gray-500">
                              ({item.duration.toFixed(1)}s • {durationPercent.toFixed(0)}%)
                            </span>
                            {item.matchedWords.length > 0 && (
                              <span className="text-purple-400">
                                Matched: {item.matchedWords.slice(0, 3).join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-300 rounded whitespace-nowrap">{item.effect}</span>
                      </div>
                      <div className="mt-2 ml-9">
                        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                            style={{ width: `${durationPercent}%` }}
                          />
                        </div>
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
                      style={{ width: `${audioDuration ? (currentTime / audioDuration) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <span className="text-sm text-gray-400 font-mono">
                  {formatTime(currentTime)} / {formatTime(audioDuration)}
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
            <h3 className="text-xl font-bold mb-2">Images ko Narration ke saath EXACT Sync</h3>
            <p className="text-gray-400 mb-6">Har image tab dikhegi jab narrator uske baare mein bol raha ho</p>
            <div className="grid sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
              <div className="p-4 bg-gray-800/30 rounded-xl">
                <div className="w-8 h-8 mx-auto rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold mb-2">1</div>
                <p className="text-sm font-medium">Upload</p>
                <p className="text-xs text-gray-500 mt-1">Audio + Images</p>
              </div>
              <div className="p-4 bg-gray-800/30 rounded-xl">
                <div className="w-8 h-8 mx-auto rounded-full bg-pink-500/20 flex items-center justify-center text-pink-400 font-bold mb-2">2</div>
                <p className="text-sm font-medium">Prompts</p>
                <p className="text-xs text-gray-500 mt-1">Image descriptions</p>
              </div>
              <div className="p-4 bg-gray-800/30 rounded-xl">
                <div className="w-8 h-8 mx-auto rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-400 font-bold mb-2">3</div>
                <p className="text-sm font-medium">Transcript</p>
                <p className="text-xs text-gray-500 mt-1">Audio text</p>
              </div>
              <div className="p-4 bg-gray-800/30 rounded-xl">
                <div className="w-8 h-8 mx-auto rounded-full bg-green-500/20 flex items-center justify-center text-green-400 font-bold mb-2">4</div>
                <p className="text-sm font-medium">Sync!</p>
                <p className="text-xs text-gray-500 mt-1">Perfect timing</p>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-white/10 mt-16 py-6">
        <p className="text-center text-gray-600 text-sm">VideoForge AI — Narration-Synced Video Creator</p>
      </footer>
    </div>
  );
}
