import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, Image as ImageIcon, Music, Play, Pause, Download, Sparkles,
  Film, Clock, Layers, Settings, Wand2, Trash2, GripVertical,
  CheckCircle, AlertCircle, Loader, Mic, Tag, Search, Zap, Brain,
  ChevronRight, Volume2, X
} from 'lucide-react';

interface ImageItem {
  id: string;
  file: File;
  url: string;
  name: string;
  duration: number;
  startTime: number;
  effect: EffectType;
  img: HTMLImageElement;
  loaded: boolean;
  keywords: string;
  matchedAt: number | null;
}

interface TranscriptWord {
  word: string;
  startTime: number;
  endTime: number;
}

type EffectType = 'kenburns' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'fade' | 'none';
type SyncMode = 'auto' | 'manual' | 'equal';

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
  const [activeTab, setActiveTab] = useState<'upload' | 'sync' | 'preview' | 'export'>('upload');
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [statusMsg, setStatusMsg] = useState('');

  // Transcription state
  const [transcript, setTranscript] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [syncMode, setSyncMode] = useState<SyncMode>('auto');
  const [editingKeyword, setEditingKeyword] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animFrameRef = useRef<number>(0);

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
      setAudioDuration(0);
      setTranscript('');
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

    for (const file of fileArray) {
      const { img, url } = await loadImage(file);
      // Extract name without extension as default keyword
      const defaultKeyword = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      
      setImages(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        file,
        url,
        name: file.name,
        duration: 0,
        startTime: 0,
        effect: selectedEffect,
        img,
        loaded: true,
        keywords: defaultKeyword,
        matchedAt: null,
      }]);
    }
  };

  // Auto-detect audio duration
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

  // Transcribe audio using Web Speech API
  const transcribeAudio = async () => {
    if (!audioFile || !audioUrl) {
      setStatusMsg('Pehle audio upload karein!');
      return;
    }

    setIsTranscribing(true);
    setTranscribeProgress(0);

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setStatusMsg('Aapka browser speech recognition support nahi karta. Chrome use karein ya manually transcript likhein.');
      setIsTranscribing(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US'; // Can be changed to 'ur-PK' for Urdu

    let fullTranscript = '';
    const results: { word: string; time: number }[] = [];
    let startTime = 0;

    // Play audio and recognize simultaneously
    const audio = new Audio(audioUrl);
    audio.crossOrigin = 'anonymous';
    
    await new Promise<void>((resolve) => {
      audio.onloadedmetadata = () => {
        const duration = audio.duration;
        startTime = Date.now();
        
        recognition.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              const text = event.results[i][0].transcript;
              const elapsed = (Date.now() - startTime) / 1000;
              fullTranscript += text + ' ';
              results.push({ word: text.trim(), time: elapsed });
              setTranscribeProgress(Math.min((elapsed / duration) * 100, 95));
            }
          }
        };

        recognition.onend = () => {
          resolve();
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          resolve();
        };

        recognition.start();
        audio.play();

        // Stop when audio ends
        audio.onended = () => {
          setTimeout(() => {
            recognition.stop();
          }, 1000);
        };

        // Safety timeout
        setTimeout(() => {
          try { recognition.stop(); } catch(e) {}
          audio.pause();
          resolve();
        }, (duration + 5) * 1000);
      };
    });

    setTranscript(fullTranscript.trim());
    setTranscribeProgress(100);
    setIsTranscribing(false);
    
    // Auto-sync after transcription
    if (fullTranscript.trim() && images.length > 0) {
      autoSyncImages(fullTranscript.trim(), results);
    }
  };

  // Auto-sync images based on keywords in transcript
  const autoSyncImages = (transcriptText: string, timedWords: { word: string; time: number }[]) => {
    if (images.length === 0 || !transcriptText) return;

    const transcriptLower = transcriptText.toLowerCase();
    const words = transcriptLower.split(/\s+/);
    
    const updatedImages = images.map(img => {
      const keywords = img.keywords.toLowerCase().split(/[\s,]+/).filter(k => k.length > 2);
      let bestMatchTime: number | null = null;
      let bestScore = 0;

      // Search for keywords in transcript
      for (const keyword of keywords) {
        for (let i = 0; i < words.length; i++) {
          // Check if word contains keyword or keyword contains word
          const score = calculateSimilarity(words[i], keyword);
          if (score > 0.6 && score > bestScore) {
            bestScore = score;
            // Find timestamp for this word position
            const timeRatio = i / words.length;
            bestMatchTime = timeRatio * audioDuration;
          }
        }
      }

      // Also check timed words for more accurate timing
      for (const tw of timedWords) {
        const twLower = tw.word.toLowerCase();
        for (const keyword of keywords) {
          if (twLower.includes(keyword) || keyword.includes(twLower)) {
            const score = calculateSimilarity(twLower, keyword);
            if (score > 0.5 && score > bestScore) {
              bestScore = score;
              bestMatchTime = tw.time;
            }
          }
        }
      }

      return {
        ...img,
        matchedAt: bestMatchTime,
      };
    });

    // Sort by matchedAt time and assign durations
    const sorted = [...updatedImages].sort((a, b) => (a.matchedAt ?? audioDuration) - (b.matchedAt ?? audioDuration));
    
    const finalImages = sorted.map((img, idx) => {
      const start = img.matchedAt ?? (idx * audioDuration / sorted.length);
      const nextStart = idx < sorted.length - 1 
        ? (sorted[idx + 1].matchedAt ?? ((idx + 1) * audioDuration / sorted.length))
        : audioDuration;
      return {
        ...img,
        startTime: start,
        duration: Math.max(0.5, nextStart - start),
      };
    });

    setImages(finalImages);
    setStatusMsg(`✓ ${finalImages.filter(i => i.matchedAt !== null).length} images auto-synced!`);
  };

  // Simple similarity score
  const calculateSimilarity = (a: string, b: string): number => {
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.8;
    
    // Levenshtein-based
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

  // Equal distribution mode
  const distributeEqually = () => {
    if (images.length === 0 || !audioDuration) return;
    const dur = audioDuration / images.length;
    setImages(prev => prev.map((img, idx) => ({
      ...img,
      startTime: idx * dur,
      duration: dur,
      matchedAt: null,
    })));
  };

  // Manual sync - set start time for an image
  const setManualTime = (id: string, time: number) => {
    setImages(prev => {
      const updated = prev.map(img => img.id === id ? { ...img, startTime: time, matchedAt: time } : img);
      // Recalculate durations based on start times
      const sorted = [...updated].sort((a, b) => a.startTime - b.startTime);
      return sorted.map((img, idx) => {
        const nextStart = idx < sorted.length - 1 ? sorted[idx + 1].startTime : audioDuration;
        return { ...img, duration: Math.max(0.5, nextStart - img.startTime) };
      });
    });
  };

  const updateKeyword = (id: string, keywords: string) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, keywords } : img));
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
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

    // Find image whose time range contains current time
    for (const imgItem of images) {
      if (time >= imgItem.startTime && time < imgItem.startTime + imgItem.duration) {
        const progress = (time - imgItem.startTime) / imgItem.duration;
        return { img: imgItem, progress: Math.min(Math.max(progress, 0), 1) };
      }
    }
    
    // If before first image, show first
    if (images.length > 0 && time < images[0].startTime) {
      return { img: images[0], progress: 0 };
    }
    
    // If after last image, show last
    if (images.length > 0) {
      const last = images[images.length - 1];
      return { img: last, progress: 1 };
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
    }
  }, [images, getRes]);

  const startPreview = () => {
    const audio = audioRef.current;
    if (!audio) {
      setStatusMsg('Audio element ready nahi hai');
      return;
    }
    if (!audioFile) {
      setStatusMsg('Audio upload karein!');
      return;
    }
    if (images.length === 0) {
      setStatusMsg('Images upload karein!');
      return;
    }
    if (!audioDuration || audioDuration <= 0) {
      setStatusMsg('Audio duration detect nahi hua');
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
        console.error('Audio play failed:', err);
        setStatusMsg('Audio play failed: ' + err.message);
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
      setStatusMsg('Pehle audio, images aur sync complete karein!');
      return;
    }

    const allLoaded = images.every(img => img.loaded && img.img.naturalWidth > 0);
    if (!allLoaded) {
      setStatusMsg('Images loading hain, wait karein...');
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

    recorder.start(100);
    source.start(0);

    const totalMs = audioDuration * 1000;
    const startMs = performance.now();
    const frameInterval = 1000 / 30;

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
    }, frameInterval);

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
    if (images.length > 0 && !isPlaying) {
      renderCurrentFrame(0);
    }
  }, [images.length, isPlaying, renderCurrentFrame]);

  const readyForVideo = audioFile && images.length > 0 && audioDuration > 0;
  const isSynced = images.every(img => img.duration > 0 && img.startTime >= 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-950/30 to-gray-900 text-white">
      {/* Hidden audio element */}
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

      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-xl bg-black/30 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                VideoForge AI
              </h1>
              <p className="text-xs text-gray-500">Narration-Synced Video Creator</p>
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
          <div className="flex gap-0 overflow-x-auto">
            {([
              { id: 'upload', label: 'Upload', icon: Upload },
              { id: 'sync', label: 'AI Sync', icon: Brain },
              { id: 'preview', label: 'Preview', icon: Play },
              { id: 'export', label: 'Export', icon: Download },
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${activeTab === tab.id
                    ? 'border-purple-500 text-purple-400 bg-purple-500/5'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                  }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Status message */}
      {statusMsg && (
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2.5 text-yellow-300 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{statusMsg}</span>
            <button onClick={() => setStatusMsg('')} className="ml-auto text-yellow-500 hover:text-yellow-300 text-lg leading-none">×</button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div className="grid md:grid-cols-2 gap-8">
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
                    <div className="w-16 h-16 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
                      <CheckCircle className="w-8 h-8 text-green-400" />
                    </div>
                    <p className="text-green-300 font-medium">{audioFile.name}</p>
                    <p className="text-sm text-gray-500">{(audioFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    {audioDuration > 0 && (
                      <p className="text-sm text-purple-400">Duration: {formatTime(audioDuration)}</p>
                    )}
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
              {audioUrl && audioDuration > 0 && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                  <p className="text-sm text-green-400 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Audio ready — Duration: {formatTime(audioDuration)}
                  </p>
                </div>
              )}
            </div>

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
          </div>
        )}

        {/* AI Sync Tab */}
        {activeTab === 'sync' && (
          <div className="space-y-6">
            {/* Transcription Section */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Mic className="w-5 h-5 text-purple-400" />
                Step 1: Transcribe Narration
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                Audio ka transcript generate karein. System narration sun kar text mein convert karega.
              </p>
              
              {isTranscribing ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Loader className="w-5 h-5 animate-spin text-purple-400" />
                    <span className="text-purple-300">Transcribing audio... {Math.round(transcribeProgress)}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all" style={{ width: `${transcribeProgress}%` }} />
                  </div>
                  <p className="text-xs text-gray-500">Audio play ho rahi hai aur speech recognize ho rahi hai. Tab band na karein.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <button
                    onClick={transcribeAudio}
                    disabled={!audioFile || isTranscribing}
                    className="flex items-center gap-2 px-5 py-2.5 bg-purple-500/20 border border-purple-500/50 rounded-lg text-purple-300 hover:bg-purple-500/30 transition-all disabled:opacity-30"
                  >
                    <Mic className="w-4 h-4" />
                    {transcript ? 'Re-Transcribe Audio' : 'Transcribe Audio'}
                  </button>
                  
                  {transcript && (
                    <div className="bg-gray-800/50 rounded-lg p-4 border border-white/5">
                      <p className="text-xs text-gray-500 mb-2">Transcript:</p>
                      <p className="text-sm text-gray-300 leading-relaxed">{transcript}</p>
                    </div>
                  )}
                  
                  {!transcript && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Ya manually transcript likhein:</p>
                      <textarea
                        value={transcript}
                        onChange={(e) => setTranscript(e.target.value)}
                        placeholder="Apni narration yahan paste karein ya likhein..."
                        className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-sm text-gray-300 focus:outline-none focus:border-purple-500 resize-none"
                        rows={4}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Keywords & Sync Section */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Tag className="w-5 h-5 text-pink-400" />
                Step 2: Image Keywords & Sync
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                Har image ke liye keywords dein jo narration mein mention hote hain. System automatically timing match karega.
              </p>

              {images.length === 0 ? (
                <p className="text-gray-500 text-center py-8">Pehle images upload karein</p>
              ) : (
                <div className="space-y-3">
                  {images.map((img, idx) => (
                    <div key={img.id} className="flex items-start gap-3 bg-gray-800/40 rounded-xl p-3 border border-white/5">
                      <div className="flex items-center gap-1 text-gray-600 pt-2">
                        <GripVertical className="w-4 h-4" />
                        <span className="text-xs font-mono w-5 text-center">{idx + 1}</span>
                      </div>
                      <img src={img.url} alt={img.name} className="w-16 h-10 object-cover rounded-md mt-1" />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Tag className="w-3.5 h-3.5 text-gray-500" />
                          <input
                            type="text"
                            value={img.keywords}
                            onChange={(e) => updateKeyword(img.id, e.target.value)}
                            placeholder="Keywords (comma separated)"
                            className="flex-1 bg-gray-700/50 border border-gray-600 rounded px-2 py-1 text-sm text-gray-300 focus:outline-none focus:border-purple-500"
                          />
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-gray-500">Start:</span>
                          <input
                            type="number"
                            value={img.startTime.toFixed(1)}
                            onChange={(e) => setManualTime(img.id, parseFloat(e.target.value) || 0)}
                            step="0.1"
                            min="0"
                            max={audioDuration}
                            className="w-16 bg-gray-700/50 border border-gray-600 rounded px-2 py-0.5 text-gray-300 focus:outline-none focus:border-purple-500"
                          />
                          <span className="text-gray-500">Duration:</span>
                          <span className="text-purple-400">{img.duration.toFixed(1)}s</span>
                          {img.matchedAt !== null && (
                            <span className="text-green-400 flex items-center gap-1">
                              <Zap className="w-3 h-3" />
                              Auto-matched
                            </span>
                          )}
                        </div>
                      </div>
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

              {/* Sync Buttons */}
              <div className="flex flex-wrap gap-3 mt-6 pt-4 border-t border-white/5">
                <button
                  onClick={() => {
                    if (transcript && images.length > 0) {
                      autoSyncImages(transcript, []);
                    } else {
                      setStatusMsg('Pehle transcript generate karein!');
                    }
                  }}
                  disabled={images.length === 0 || !transcript}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/50 rounded-lg text-purple-300 hover:from-purple-500/30 hover:to-pink-500/30 transition-all disabled:opacity-30"
                >
                  <Brain className="w-4 h-4" />
                  AI Auto-Sync
                </button>
                <button
                  onClick={distributeEqually}
                  disabled={images.length === 0 || !audioDuration}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-700 transition-all disabled:opacity-30"
                >
                  <Layers className="w-4 h-4" />
                  Equal Distribution
                </button>
              </div>
            </div>

            {/* Visual Timeline */}
            {images.length > 0 && audioDuration > 0 && (
              <div className="bg-white/5 rounded-xl p-6 border border-white/10">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-yellow-400" />
                  Visual Timeline
                </h3>
                <div className="relative h-20 bg-gray-800/50 rounded-lg overflow-hidden border border-white/5">
                  {/* Time markers */}
                  <div className="absolute inset-0 flex items-end pb-1 px-2">
                    {Array.from({ length: 11 }, (_, i) => (
                      <div key={i} className="absolute text-[9px] text-gray-600" style={{ left: `${i * 10}%` }}>
                        {formatTime((i / 10) * audioDuration)}
                      </div>
                    ))}
                  </div>
                  {/* Image blocks */}
                  {images.map((img, idx) => {
                    const left = (img.startTime / audioDuration) * 100;
                    const width = (img.duration / audioDuration) * 100;
                    return (
                      <div
                        key={img.id}
                        className="absolute top-2 bottom-6 rounded-md overflow-hidden border border-white/20 group cursor-pointer"
                        style={{ left: `${left}%`, width: `${Math.max(width, 2)}%` }}
                      >
                        <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-purple-500/30 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                          <span className="text-[10px] font-bold bg-black/70 px-1 rounded">#{idx + 1}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-500">
                  <span>0:00</span>
                  <span>{formatTime(audioDuration)}</span>
                </div>
              </div>
            )}

            {/* Effects */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-purple-400" />
                Effects
              </h3>
              <div className="flex flex-wrap gap-2">
                {EFFECTS.map(effect => (
                  <button
                    key={effect.id}
                    onClick={() => applyEffectToAll(effect.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectedEffect === effect.id
                        ? 'bg-purple-500/30 border border-purple-500 text-purple-300'
                        : 'bg-gray-800/80 border border-gray-700 text-gray-400 hover:text-white'
                      }`}
                  >
                    {effect.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Resolution */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-gray-400" />
                Resolution
              </h3>
              <div className="flex gap-3">
                {(['720p', '1080p'] as const).map(res => (
                  <button
                    key={res}
                    onClick={() => setResolution(res)}
                    className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${resolution === res
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
                  <div className="text-center px-4">
                    <Film className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                    <p className="text-gray-400">
                      {!audioFile ? 'Audio upload karein' : images.length === 0 ? 'Images upload karein' : 'AI Sync tab mein timing set karein'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4 bg-white/5 rounded-xl p-4 border border-white/10">
              <button
                onClick={isPlaying ? stopPreview : startPreview}
                disabled={!readyForVideo}
                className="w-11 h-11 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center hover:opacity-90 transition-all disabled:opacity-30 shadow-lg shadow-purple-500/20"
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
              <span className="text-sm text-gray-400 font-mono min-w-[90px] text-right">
                {formatTime(currentTime)} / {formatTime(audioDuration)}
              </span>
            </div>

            {/* Current image info */}
            {isPlaying && (
              <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                {(() => {
                  const current = getCurrentImageAtTime(currentTime);
                  if (!current) return null;
                  return (
                    <div className="flex items-center gap-3">
                      <img src={current.img.url} alt="" className="w-12 h-8 object-cover rounded" />
                      <div>
                        <p className="text-sm text-gray-300">{current.img.name}</p>
                        <p className="text-xs text-gray-500">
                          {formatTimePrecise(current.img.startTime)} → {formatTimePrecise(current.img.startTime + current.img.duration)}
                          {' • '}{current.img.effect}
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
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
                {resolution === '1080p' ? '1920×1080' : '1280×720'} • WebM • {images.length} scenes synced to narration
              </p>

              {isExporting ? (
                <div className="max-w-md mx-auto space-y-3">
                  <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-300" style={{ width: `${exportProgress}%` }} />
                  </div>
                  <p className="text-purple-400 font-medium text-lg">{exportProgress}%</p>
                </div>
              ) : videoUrl ? (
                <div className="space-y-5">
                  <a href={videoUrl} download="videoforge-synced.webm" className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-semibold hover:opacity-90 transition-all shadow-lg shadow-purple-500/20">
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
                  Generate Synced Video
                </button>
              )}
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
