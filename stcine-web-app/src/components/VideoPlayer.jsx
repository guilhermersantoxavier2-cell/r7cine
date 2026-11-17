import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  SkipForward,
  Settings,
  PictureInPicture2,
  MessageSquare,
  Loader2,
  AlertCircle,
  RefreshCw,
  Copy,
  Check,
  Download,
} from 'lucide-react';
import { formatTime } from '../api/stcine';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export default function VideoPlayer({
  episode,
  poster,
  title,
  episodeLabel,
  initialTime = 0,
  hasNextEpisode = false,
  onNextEpisode,
  onProgress,
  barrageList = [],
  showBarrage = false,
  onToggleBarrage,
  audioOptions = [],
  activeAudioType = 0,
  onChangeAudio,
  onDownload,
}) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const hideTimerRef = useRef(null);
  const lastSavedRef = useRef(0);
  const firedBarrageRef = useRef(new Set());
  const triedSignedRef = useRef(false);

  const webStream = episode?.web_stream || {};
  const qualities = webStream.qualities || [];
  const subtitles = webStream.subtitles || [];

  const [selectedQualityIdx, setSelectedQualityIdx] = useState(0);
  const [useSigned, setUseSigned] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeDanmaku, setActiveDanmaku] = useState([]);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const activeQuality = qualities[selectedQualityIdx] || qualities[0] || null;
  const activeSrc = useSigned
    ? activeQuality?.signed_proxy_url || webStream.signed_proxy_url || activeQuality?.proxy_url
    : activeQuality?.proxy_url || webStream.proxy_url || episode?.vod_url || '';

  // Reseta estado de fallback ao trocar de episódio
  useEffect(() => {
    setSelectedQualityIdx(0);
    setUseSigned(false);
    triedSignedRef.current = false;
    firedBarrageRef.current.clear();
    setActiveDanmaku([]);
    setErrorMsg('');
  }, [episode?.id, activeAudioType]);

  // Inicializa reprodução HLS Web (sem P2P!)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeSrc) return undefined;

    setIsBuffering(true);
    setErrorMsg('');

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const startOffset = Number(initialTime) > 5 ? Number(initialTime) : 0;
    const isMp4 = activeQuality?.format === 'mp4' || activeSrc.includes('/api/stream/segment');

    const applyStartAndPlay = () => {
      if (startOffset > 0 && (!video.duration || startOffset < video.duration - 15)) {
        try {
          video.currentTime = startOffset;
        } catch {
          // ignore
        }
      }
      video.playbackRate = playbackRate;
      const playPromise = video.play();
      if (playPromise?.catch) {
        playPromise.catch(() => {
          // Autoplay com áudio bloqueado pelo navegador -> aguarda clique do usuário
          setIsPlaying(false);
          setIsBuffering(false);
        });
      }
    };

    if (!isMp4 && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startPosition: startOffset > 0 ? startOffset : -1,
        maxBufferLength: 45,
        maxMaxBufferLength: 90,
        backBufferLength: 45,
        fragLoadingMaxRetry: 4,
        manifestLoadingMaxRetry: 3,
      });
      hlsRef.current = hls;

      hls.loadSource(activeSrc);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsBuffering(false);
        applyStartAndPlay();
      });

      let mediaRecoveryAttempts = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Se falhou no CDN direto, tenta automaticamente a rota pré-assinada /GetUrl
          if (
            !triedSignedRef.current &&
            (activeQuality?.signed_proxy_url || webStream.signed_proxy_url)
          ) {
            triedSignedRef.current = true;
            setUseSigned(true);
            return;
          }
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (mediaRecoveryAttempts < 2) {
            mediaRecoveryAttempts += 1;
            hls.recoverMediaError();
          } else {
            const codecHint =
              data.details === 'manifestIncompatibleCodecsError'
                ? 'Este título usa codec HEVC (H.265). Abra no Safari/Edge com suporte HEVC ou copie o link HLS direto abaixo.'
                : 'Não foi possível decodificar este fluxo de vídeo no navegador.';
            setErrorMsg(codecHint);
            setIsBuffering(false);
          }
        } else {
          if (
            !triedSignedRef.current &&
            (activeQuality?.signed_proxy_url || webStream.signed_proxy_url)
          ) {
            triedSignedRef.current = true;
            setUseSigned(true);
            return;
          }
          setErrorMsg('Falha ao iniciar o stream Web HLS. Tente recarregar o player.');
          setIsBuffering(false);
        }
      });
    } else {
      // Safari / iOS (HLS nativo) ou MP4 direto via Range
      video.src = activeSrc;
      const onLoaded = () => {
        setIsBuffering(false);
        applyStartAndPlay();
      };
      const onErr = () => {
        if (
          !triedSignedRef.current &&
          (activeQuality?.signed_proxy_url || webStream.signed_proxy_url)
        ) {
          triedSignedRef.current = true;
          setUseSigned(true);
          return;
        }
        setErrorMsg('Não foi possível carregar este vídeo.');
        setIsBuffering(false);
      };
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onErr, { once: true });
      return () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onErr);
      };
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSrc]);

  // Controle automático de visibilidade da barra
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused && !settingsOpen) {
        setControlsVisible(false);
      }
    }, 3200);
  }, [settingsOpen]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
    revealControls();
  }, [revealControls]);

  const seekBy = useCallback(
    (delta) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration)) return;
      v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + delta));
      firedBarrageRef.current.clear();
      revealControls();
    },
    [revealControls]
  );

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  const togglePiP = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await v.requestPictureInPicture();
      }
    } catch {
      // PiP indisponível
    }
  };

  // Atalhos de teclado
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekBy(10);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekBy(-10);
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekBy, toggleMute, toggleFullscreen]);

  // Atualiza tempo, buffer, progresso salvo e danmaku
  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    const cur = v.currentTime || 0;
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    setCurrentTime(cur);
    if (dur > 0) setDuration(dur);

    if (v.buffered && v.buffered.length > 0) {
      setBufferedEnd(v.buffered.end(v.buffered.length - 1));
    }

    // Dispara comentários sincronizados (danmaku) quando ativo
    if (showBarrage && barrageList.length > 0) {
      const sec = Math.floor(cur);
      barrageList.forEach((b, idx) => {
        const key = `${idx}-${b.play_second}`;
        if (Math.floor(Number(b.play_second)) === sec && !firedBarrageRef.current.has(key)) {
          firedBarrageRef.current.add(key);
          const lane = (idx % 5) * 14 + 8;
          const id = `${key}-${Date.now()}`;
          setActiveDanmaku((prev) => [...prev.slice(-18), { id, text: b.content, top: lane }]);
          setTimeout(() => {
            setActiveDanmaku((prev) => prev.filter((item) => item.id !== id));
          }, 10500);
        }
      });
    }

    // Salva progresso a cada 8 segundos
    const now = Date.now();
    if (onProgress && cur > 3 && now - lastSavedRef.current > 8000) {
      lastSavedRef.current = now;
      onProgress(cur, dur);
    }
  };

  const handleScrub = (e) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    v.currentTime = ratio * duration;
    setCurrentTime(v.currentTime);
    firedBarrageRef.current.clear();
  };

  const handleSpeedChange = (spd) => {
    setPlaybackRate(spd);
    if (videoRef.current) videoRef.current.playbackRate = spd;
    setSettingsOpen(false);
  };

  const handleRetry = () => {
    setErrorMsg('');
    triedSignedRef.current = !useSigned;
    setUseSigned((prev) => !prev);
  };

  const handleCopyDirectUrl = async () => {
    const url = activeQuality?.direct_url || webStream.direct_url || '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // ignore
    }
  };

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bufferPct = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={revealControls}
      onMouseLeave={() => {
        if (isPlaying && !settingsOpen) setControlsVisible(false);
      }}
      className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border border-white/[0.08] shadow-[0_24px_80px_rgba(0,0,0,0.75)] select-none group"
    >
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        crossOrigin="anonymous"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => {
          setIsPlaying(true);
          setIsBuffering(false);
          revealControls();
        }}
        onPause={() => {
          setIsPlaying(false);
          setControlsVisible(true);
          if (onProgress && videoRef.current?.currentTime > 3) {
            onProgress(videoRef.current.currentTime, videoRef.current.duration || 0);
          }
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) {
            setDuration(e.currentTarget.duration);
          }
        }}
        onEnded={() => {
          setIsPlaying(false);
          setControlsVisible(true);
          if (hasNextEpisode && onNextEpisode) {
            onNextEpisode();
          }
        }}
        className="w-full h-full object-contain bg-black cursor-pointer"
      >
        {subtitles.map((sub, i) => (
          <track
            key={`${sub.lang}-${i}`}
            kind="subtitles"
            src={sub.vtt_proxy_url}
            srcLang={sub.lang}
            label={sub.label}
            default={i === 0}
          />
        ))}
      </video>

      {/* Camada de comentários sincronizados (danmaku) */}
      {showBarrage && activeDanmaku.length > 0 && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
          {activeDanmaku.map((item) => (
            <span
              key={item.id}
              style={{ top: `${item.top}%` }}
              className="danmaku-item text-white/90 text-sm sm:text-base font-semibold"
            >
              {item.text}
            </span>
          ))}
        </div>
      )}

      {/* Indicador central de carregamento */}
      {isBuffering && !errorMsg && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="w-14 h-14 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-white/10">
            <Loader2 className="w-7 h-7 text-[#ff2d3b] animate-spin" />
          </div>
        </div>
      )}

      {/* Botão grande central quando pausado */}
      {!isPlaying && !isBuffering && !errorMsg && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Reproduzir"
          className="absolute inset-0 flex items-center justify-center z-20 bg-black/25 cursor-pointer group/play"
        >
          <span className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#e50914] group-hover/play:scale-105 transition-transform flex items-center justify-center shadow-[0_12px_40px_rgba(229,9,20,0.55)]">
            <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-white text-white ml-1" />
          </span>
        </button>
      )}

      {/* Estado de erro amigável com fallback */}
      {errorMsg && (
        <div className="absolute inset-0 z-30 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center gap-3">
          <AlertCircle className="w-10 h-10 text-[#ff404c]" />
          <p className="text-sm sm:text-base text-zinc-200 max-w-md">{errorMsg}</p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#e50914] hover:bg-[#f6121d] text-white text-xs sm:text-sm font-semibold cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tentar Rota Alternativa (/GetUrl)</span>
            </button>
            {(activeQuality?.direct_url || webStream.direct_url) && (
              <button
                type="button"
                onClick={handleCopyDirectUrl}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-zinc-100 text-xs sm:text-sm font-medium border border-white/15 cursor-pointer"
              >
                {copiedUrl ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                <span>{copiedUrl ? 'Link HLS Copiado!' : 'Copiar Link M3U8'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Título superior em tela cheia ou hover */}
      <div
        className={`absolute inset-x-0 top-0 p-4 sm:p-5 bg-gradient-to-b from-black/75 to-transparent flex items-center justify-between pointer-events-none transition-opacity duration-300 z-20 ${
          controlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="min-w-0">
          <p className="text-xs sm:text-sm font-semibold text-white truncate drop-shadow">
            {title}
            {episodeLabel ? <span className="text-zinc-300 font-normal"> · {episodeLabel}</span> : null}
          </p>
        </div>
        <span className="shrink-0 text-[10.5px] font-semibold px-2 py-0.5 rounded bg-black/55 border border-emerald-400/25 text-emerald-300">
          {activeQuality?.label || 'HD'} · HLS Web
        </span>
      </div>

      {/* Menu de configurações (qualidade, áudio e velocidade) */}
      {settingsOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-4 bottom-16 z-30 w-60 rounded-xl bg-[#11131d]/96 backdrop-blur-xl border border-white/15 shadow-2xl p-3 space-y-3 text-xs"
        >
          {qualities.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
                Qualidade
              </p>
              <div className="flex flex-wrap gap-1.5">
                {qualities.map((q, idx) => (
                  <button
                    key={q.resolution}
                    type="button"
                    onClick={() => {
                      setSelectedQualityIdx(idx);
                      setSettingsOpen(false);
                    }}
                    className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                      idx === selectedQualityIdx
                        ? 'bg-[#e50914] text-white'
                        : 'bg-white/[0.07] text-zinc-300 hover:bg-white/15'
                    }`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {audioOptions.length > 1 && onChangeAudio && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
                Áudio
              </p>
              <div className="flex flex-wrap gap-1.5">
                {audioOptions.map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => {
                      onChangeAudio(opt.type, currentTime);
                      setSettingsOpen(false);
                    }}
                    className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                      Number(activeAudioType) === Number(opt.type)
                        ? 'bg-[#e50914] text-white'
                        : 'bg-white/[0.07] text-zinc-300 hover:bg-white/15'
                    }`}
                  >
                    {opt.type_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
              Velocidade
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SPEEDS.map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => handleSpeedChange(spd)}
                  className={`px-2 py-1 rounded-md font-medium cursor-pointer ${
                    playbackRate === spd
                      ? 'bg-[#e50914] text-white'
                      : 'bg-white/[0.07] text-zinc-300 hover:bg-white/15'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Barra de controles inferior */}
      <div
        className={`absolute inset-x-0 bottom-0 px-3 sm:px-5 pb-3 pt-10 bg-gradient-to-t from-black/90 via-black/55 to-transparent transition-opacity duration-300 z-20 ${
          controlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Linha do tempo (scrubber) */}
        <div
          role="slider"
          aria-label="Progresso do vídeo"
          aria-valuemin={0}
          aria-valuemax={Math.floor(duration)}
          aria-valuenow={Math.floor(currentTime)}
          tabIndex={0}
          onClick={handleScrub}
          className="group/bar relative h-4 flex items-center cursor-pointer mb-1.5"
        >
          <div className="w-full h-1 group-hover/bar:h-1.5 bg-white/20 rounded-full overflow-hidden transition-all relative">
            <div
              className="absolute inset-y-0 left-0 bg-white/35 rounded-full"
              style={{ width: `${bufferPct}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 bg-[#e50914] rounded-full"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div
            className="absolute w-3.5 h-3.5 rounded-full bg-[#e50914] ring-2 ring-white shadow -translate-x-1/2 opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none"
            style={{ left: `${progressPct}%` }}
          />
        </div>

        {/* Botões */}
        <div className="flex items-center justify-between gap-2 text-white">
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
              className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center transition-colors cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-white" />
              ) : (
                <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-white" />
              )}
            </button>

            <button
              type="button"
              onClick={() => seekBy(-10)}
              title="Voltar 10s (←)"
              className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center text-zinc-200 hover:text-white transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => seekBy(10)}
              title="Avançar 10s (→)"
              className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center text-zinc-200 hover:text-white transition-colors cursor-pointer"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {hasNextEpisode && onNextEpisode && (
              <button
                type="button"
                onClick={onNextEpisode}
                title="Próximo episódio"
                className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center text-zinc-200 hover:text-white transition-colors cursor-pointer"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            )}

            {/* Volume */}
            <div className="flex items-center gap-1.5 group/vol">
              <button
                type="button"
                onClick={toggleMute}
                title="Mudo (M)"
                className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center transition-colors cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-zinc-300" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setVolume(val);
                  if (videoRef.current) {
                    videoRef.current.volume = val;
                    videoRef.current.muted = val === 0;
                    setIsMuted(val === 0);
                  }
                }}
                aria-label="Volume"
                className="hidden sm:block w-16 lg:w-20 accent-[#e50914] cursor-pointer h-1"
              />
            </div>

            <span className="text-xs font-mono text-zinc-200 pl-1 tabular-nums">
              {formatTime(currentTime)} <span className="text-zinc-500">/</span>{' '}
              {formatTime(duration || episode?.vod_duration || 0)}
            </span>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5">
            {onToggleBarrage && (
              <button
                type="button"
                onClick={onToggleBarrage}
                title={showBarrage ? 'Ocultar comentários na tela' : 'Mostrar comentários na tela'}
                className={`h-8 px-2 rounded-lg flex items-center gap-1 text-xs font-medium transition-colors cursor-pointer ${
                  showBarrage
                    ? 'bg-[#e50914]/25 text-[#ff626c] border border-[#e50914]/40'
                    : 'hover:bg-white/15 text-zinc-300'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                {barrageList.length > 0 && (
                  <span className="hidden sm:inline text-[11px]">{barrageList.length}</span>
                )}
              </button>
            )}

            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                title="Baixar episódio / filme"
                className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center text-zinc-200 hover:text-white transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              title="Qualidade, Áudio e Velocidade"
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                settingsOpen ? 'bg-white/20 text-white' : 'hover:bg-white/15 text-zinc-200'
              }`}
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={togglePiP}
              title="Picture-in-Picture"
              className="hidden sm:flex w-8 h-8 rounded-lg hover:bg-white/15 items-center justify-center text-zinc-200 cursor-pointer"
            >
              <PictureInPicture2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              title="Tela Cheia (F)"
              className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center text-zinc-200 cursor-pointer"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
