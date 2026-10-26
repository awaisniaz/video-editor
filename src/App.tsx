import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, Image as ImageIcon, Music, Play, Pause, Download, Sparkles,
  Film, Clock, CheckCircle, AlertCircle, Loader, Zap, Brain,
  Target, SkipForward, FileText
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
  matchedPhrase: string;
  confidence: number;
  effect: EffectType;
}

type EffectType = 'kenburns' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'fade';

const EFFECTS: EffectType[] = ['kenburns', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'fade'];

type Stage = 'idle' | 'uploading' | 'prompts' | 'processing' | 'ready';

export default function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [promptsText, setPromptsText] = useState<string>('');
  const [syncedImages, setSyncedImages] = useState<SyncedImage[]>([]);
  const [skippedImages, setSkippedImages] = useState<ImageItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [statusMsg, setStatusMsg] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [stageProgress, setStageProgress] = useState(0);
  const [stageMessage, setStageMessage] = useState('');
  const [transcript, setTranscript] = useState<string>('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animFrameRef = useRef<number>(0);
  const processingRef = useRef(false);

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setVideoUrl('');
      setAudioDuration(0);
      setTranscript('');
      setSyncedImages([]);
      setSkippedImages([]);
      setStage('uploading');
      setStageMessage('Audio uploaded ✓');
      processingRef.current = false;
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
        file,
        url,
        name: file.name,
        prompt: '',
        img,
        loaded: true,
      });
    }

    setImages(prev => [...prev, ...newImages]);
    setStage('prompts');
    setStageMessage(`${newImages.length} images uploaded - ab prompts paste karein`);
  };

  // Parse prompts and assign to images
  const parseAndAssignPrompts = () => {
    if (!promptsText.trim()) {
      setStatusMsg('Pehle prompts paste karein!');
      return;
    }

    // Split by empty lines or double newlines
    const prompts = promptsText
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (prompts.length === 0) {
      setStatusMsg('Koi valid prompts nahi mile!');
      return;
    }

    // Assign prompts to images (in order)
    setImages(prev => prev.map((img, idx) => ({
      ...img,
      prompt: prompts[idx] || ''
    })));

    setStatusMsg(`✓ ${Math.min(prompts.length, images.length)} prompts assign ho gaye!`);
  };

  useEffect(() => {
    if (!audioUrl) return;
    const timer = setTimeout(() => {
      if (audioRef.current && (!audioDuration || audioDuration <= 0)) {
        const dur = audioRef.current.duration;
        if (dur && isFinite(dur)) {
          setAudioDuration(dur);
        } else {
          if (audioRef.current) {
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
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [audioUrl]);

  const calculateSimilarity = (a: string, b: string): number => {
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.8;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1;
    const editDistance = levenshtein(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  };

  const levenshtein = (a: string, b: string): number => {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  };

  const transcribeAudio = async (): Promise<string> => {
    return new Promise((resolve) => {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (!SpeechRecognition) {
        resolve('');
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      let fullTranscript = '';
      const audio = new Audio(audioUrl);
      let startTime = 0;

      audio.onloadedmetadata = () => {
        const duration = audio.duration;
        startTime = Date.now();

        recognition.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              fullTranscript += event.results[i][0].transcript + ' ';
              const elapsed = (Date.now() - startTime) / 1000;
              setStageProgress(Math.min((elapsed / duration) * 100, 95));
            }
          }
        };

        recognition.onend = () => resolve(fullTranscript.trim());
        recognition.onerror = () => resolve(fullTranscript.trim());

        recognition.start();
        audio.play();

        audio.onended = () => {
          setTimeout(() => { try { recognition.stop(); } catch(e) {} }, 1000);
        };

        setTimeout(() => {
          try { recognition.stop(); } catch(e) {}
          audio.pause();
          resolve(fullTranscript.trim());
        }, (duration + 5) * 1000);
      };
    });
  };

  const syncImagesToNarration = (transcriptText: string) => {
    if (images.length === 0 || !audioDuration) return;

    const transcriptLower = transcriptText.toLowerCase();
    const words = transcriptLower.split(/\s+/).filter(w => w.length > 0);
    
    const matched: SyncedImage[] = [];
    const skipped: ImageItem[] = [];

    // Analyze each image prompt against narration
    for (const img of images) {
      if (!img.prompt.trim()) {
        skipped.push(img);
        continue;
      }

      // Extract keywords from prompt (remove common words)
      const stopWords = ['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'and', 'or', 'but', 'if', 'then', 'so', 'as', 'by', 'about', 'like', 'through', 'after', 'over', 'between', 'out', 'against', 'during', 'without', 'before', 'under', 'around', 'among'];
      const promptWords = img.prompt
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.includes(w));

      let bestMatchTime: number | null = null;
      let bestScore = 0;
      let matchedPhrase = '';
      let totalMatches = 0;

      // Check each keyword from prompt against transcript
      for (const promptWord of promptWords) {
        for (let i = 0; i < words.length; i++) {
          const score = calculateSimilarity(words[i], promptWord);
          if (score > 0.6) {
            totalMatches++;
            const timeRatio = i / words.length;
            const matchTime = timeRatio * audioDuration;
            
            if (score > bestScore) {
              bestScore = score;
              bestMatchTime = matchTime;
              matchedPhrase = promptWord;
            }
          }
        }
      }

      // If we found good matches
      if (bestMatchTime !== null && totalMatches > 0) {
        const confidence = Math.min((totalMatches / promptWords.length) * bestScore, 1);
        
        if (confidence > 0.3) {
          matched.push({
            image: img,
            startTime: bestMatchTime,
            duration: 0,
            matchedPhrase,
            confidence,
            effect: EFFECTS[Math.floor(Math.random() * EFFECTS.length)],
          });
        } else {
          skipped.push(img);
        }
      } else {
        skipped.push(img);
      }
    }

    // Sort by time
    matched.sort((a, b) => a.startTime - b.startTime);

    // Calculate durations
    const finalSynced = matched.map((item, idx) => {
      const nextStart = idx < matched.length - 1 ? matched[idx + 1].startTime : audioDuration;
      return {
        ...item,
        duration: Math.max(0.5, nextStart - item.startTime),
      };
    });

    setSyncedImages(finalSynced);
    setSkippedImages(skipped);
  };

  const startSync = async () => {
    if (!audioFile || images.length === 0) {
      setStatusMsg('Pehle audio aur images upload karein!');
      return;
    }

    const imagesWithPrompts = images.filter(img => img.prompt.trim());
    if (imagesWithPrompts.length === 0) {
      setStatusMsg('Pehle prompts assign karein!');
      return;
    }

    if (processingRef.current) return;
    processingRef.current = true;

    setStage('processing');
    setStageProgress(0);
    setStageMessage('Narration analyze ho rahi hai...');

    const transcriptText = await transcribeAudio();
    setTranscript(transcriptText);
    setStageProgress(100);

    setStageMessage('Prompts ko narration ke saath match kar rahe hain...');

    if (transcriptText) {
      syncImagesToNarration(transcriptText);
    }

    await new Promise(r => setTimeout(r, 500));
    setStage('ready');
    setStageMessage(`✓ Sync complete!`);
    processingRef.current = false;
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

    const gradient = ctx.createRadialGradient(
      width / 2, height / 2, height * 0.35,
      width / 2, height / 2, height * 0.85
    );
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
    if (syncedImages.length > 0 && time < syncedImages[0].startTime) {
      return { img: syncedImages[0], progress: 0 };
    }
    if (syncedImages.length > 0) {
      const last = syncedImages[syncedImages.length - 1];
      return { img: last, progress: 1 };
    }
    return null;
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
      setStatusMsg('Sync complete hone dein!');
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
      }).catch(err => {
        setStatusMsg('Play failed: ' + err.message);
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
    if (!audioFile || syncedImages.length === 0 || !audioDuration) {
      setStatusMsg('Pehle sync complete karein!');
      return;
    }

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
              <p className="text-xs text-gray-500">Prompt-Based Narration Sync</p>
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
          <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2.5 text-yellow-300 text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>{statusMsg}</span>
            <button onClick={() => setStatusMsg('')} className="ml-auto text-yellow-500 hover:text-yellow-300">×</button>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Upload Section */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Music className="w-4 h-4 text-purple-400" />
              </div>
              Step 1: Voiceover Audio
            </h2>
            <label className="block border-2 border-dashed border-purple-500/30 rounded-xl p-6 text-center cursor-pointer hover:border-purple-500/60 hover:bg-purple-500/5 transition-all group">
              <input type="file" accept="audio/*" onChange={handleAudioUpload} className="hidden" />
              {audioFile ? (
                <div className="space-y-2">
                  <CheckCircle className="w-10 h-10 mx-auto text-green-400" />
                  <p className="text-green-300 font-medium text-sm">{audioFile.name}</p>
                  <p className="text-xs text-gray-500">{(audioFile.size / 1024 / 1024).toFixed(2)} MB</p>
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
              Step 2: Images ({images.length})
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

        {/* Prompts Section */}
        {images.length > 0 && stage === 'prompts' && (
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-yellow-400" />
              Step 3: Image Generation Prompts Paste Karein
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Jin prompts se images banai hain wo paste karein. Har prompt ke beech mein empty line dein. AI automatically match karega.
            </p>
            <textarea
              value={promptsText}
              onChange={(e) => setPromptsText(e.target.value)}
              placeholder={`Prompt 1 (e.g., A majestic mountain landscape at sunrise with snow-capped peaks)\n\nPrompt 2 (e.g., A busy city street at night with neon lights)\n\nPrompt 3 (e.g., Peaceful ocean waves crashing on a sandy beach)`}
              className="w-full h-64 bg-gray-800/50 border border-gray-700 rounded-xl p-4 text-sm text-gray-300 focus:outline-none focus:border-purple-500 resize-none font-mono"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={parseAndAssignPrompts}
                disabled={!promptsText.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-purple-500/20 border border-purple-500/50 rounded-lg text-purple-300 hover:bg-purple-500/30 transition-all disabled:opacity-30"
              >
                <CheckCircle className="w-4 h-4" />
                Assign Prompts
              </button>
              <button
                onClick={startSync}
                disabled={!audioFile || images.filter(i => i.prompt.trim()).length === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg text-white font-medium hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Brain className="w-4 h-4" />
                Analyze & Sync
              </button>
            </div>
            
            {images.some(i => i.prompt.trim()) && (
              <div className="mt-6 space-y-2">
                <p className="text-sm text-gray-400">Assigned Prompts:</p>
                {images.filter(i => i.prompt.trim()).map((img, idx) => (
                  <div key={img.id} className="flex items-start gap-3 bg-gray-800/30 rounded-lg p-3">
                    <img src={img.url} alt="" className="w-12 h-8 object-cover rounded" />
                    <div className="flex-1">
                      <p className="text-xs text-gray-500">Image {idx + 1}:</p>
                      <p className="text-sm text-gray-300">{img.prompt}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Processing */}
        {stage === 'processing' && (
          <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-2xl p-6 border border-purple-500/30">
            <div className="flex items-center gap-4">
              <Loader className="w-8 h-8 animate-spin text-purple-400" />
              <div className="flex-1">
                <p className="text-purple-300 font-medium">{stageMessage}</p>
                <div className="w-full bg-gray-700 rounded-full h-2 mt-2 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-300"
                    style={{ width: `${stageProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Ready - Results */}
        {stage === 'ready' && (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-green-500/10 rounded-xl p-4 border border-green-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-5 h-5 text-green-400" />
                  <h3 className="font-semibold text-green-300">Synced ({syncedImages.length})</h3>
                </div>
                <p className="text-xs text-gray-400">Narration ke saath perfectly sync hain</p>
              </div>
              {skippedImages.length > 0 && (
                <div className="bg-orange-500/10 rounded-xl p-4 border border-orange-500/30">
                  <div className="flex items-center gap-2 mb-2">
                    <SkipForward className="w-5 h-5 text-orange-400" />
                    <h3 className="font-semibold text-orange-300">Skipped ({skippedImages.length})</h3>
                  </div>
                  <p className="text-xs text-gray-400">Narration se match nahi hui</p>
                </div>
              )}
            </div>

            {syncedImages.length > 0 && (
              <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-yellow-400" />
                  Synced Timeline
                </h3>
                <div className="space-y-2">
                  {syncedImages.map((item, idx) => (
                    <div key={item.image.id} className="flex items-center gap-3 bg-gray-800/40 rounded-lg p-3 border border-white/5">
                      <img src={item.image.url} alt="" className="w-16 h-10 object-cover rounded" />
                      <div className="flex-1">
                        <p className="text-sm text-gray-300 line-clamp-1">{item.image.prompt}</p>
                        <p className="text-xs text-gray-500">
                          Matched: "{item.matchedPhrase}" • {formatTime(item.startTime)} → {formatTime(item.startTime + item.duration)} • Confidence: {Math.round(item.confidence * 100)}%
                        </p>
                      </div>
                      <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-300 rounded">{item.effect}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                    Generate Synced Video
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {stage === 'idle' && (
          <div className="bg-white/5 rounded-2xl p-12 border border-white/10 text-center">
            <Brain className="w-16 h-16 mx-auto mb-4 text-purple-400/50" />
            <h3 className="text-xl font-bold mb-2">Prompt-Based Narration Sync</h3>
            <p className="text-gray-400 mb-6">Image prompts se AI automatically narration ke saath sync karega</p>
            <div className="grid sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
              <div className="p-4 bg-gray-800/30 rounded-xl">
                <div className="w-8 h-8 mx-auto rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold mb-2">1</div>
                <p className="text-sm font-medium">Upload</p>
                <p className="text-xs text-gray-500 mt-1">Audio + Images</p>
              </div>
              <div className="p-4 bg-gray-800/30 rounded-xl">
                <div className="w-8 h-8 mx-auto rounded-full bg-pink-500/20 flex items-center justify-center text-pink-400 font-bold mb-2">2</div>
                <p className="text-sm font-medium">Prompts</p>
                <p className="text-xs text-gray-500 mt-1">Paste prompts</p>
              </div>
              <div className="p-4 bg-gray-800/30 rounded-xl">
                <div className="w-8 h-8 mx-auto rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-400 font-bold mb-2">3</div>
                <p className="text-sm font-medium">AI Sync</p>
                <p className="text-xs text-gray-500 mt-1">Auto-match</p>
              </div>
              <div className="p-4 bg-gray-800/30 rounded-xl">
                <div className="w-8 h-8 mx-auto rounded-full bg-green-500/20 flex items-center justify-center text-green-400 font-bold mb-2">4</div>
                <p className="text-sm font-medium">Export</p>
                <p className="text-xs text-gray-500 mt-1">Perfect video</p>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-white/10 mt-16 py-6">
        <p className="text-center text-gray-600 text-sm">VideoForge AI — Prompt-Based Narration Sync</p>
      </footer>
    </div>
  );
}
