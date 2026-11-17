import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Star,
  Heart,
  Share2,
  Check,
  Volume2,
  Send,
  Play,
  Copy,
  Layers,
  Loader2,
  Wifi,
  Download,
  ChevronDown,
  X,
  CheckCircle2,
  AlertCircle,
  Subtitles,
} from 'lucide-react';
import VideoPlayer from '../components/VideoPlayer';
import VodCard from '../components/VodCard';
import {
  stcineApi,
  getSavedVodProgress,
  upsertLocalHistory,
  resolvePoster,
  triggerBrowserDownload,
  formatBytes,
} from '../api/stcine';

const EP_PAGE_SIZE = 24;

export default function WatchPage({
  vodId,
  onBack,
  onSelectVod,
  onSelectGenre,
  isFavorite,
  onToggleFavorite,
  onHistoryUpdated,
}) {
  const [detail, setDetail] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [barrage, setBarrage] = useState([]);
  const [showBarrage, setShowBarrage] = useState(false);
  const [barrageInput, setBarrageInput] = useState('');
  const [sendingBarrage, setSendingBarrage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switchingAudio, setSwitchingAudio] = useState(false);
  const [error, setError] = useState('');

  const [episodeIdx, setEpisodeIdx] = useState(0);
  const [epRangeIdx, setEpRangeIdx] = useState(0);
  const [audioType, setAudioType] = useState(0);
  const [resumeTime, setResumeTime] = useState(0);
  const [copiedShare, setCopiedShare] = useState(false);
  const [copiedStream, setCopiedStream] = useState(false);

  // Estado de downloads de episódios / filmes
  const [downloads, setDownloads] = useState([]);
  const [dlMenuOpen, setDlMenuOpen] = useState(false);
  const dlMenuRef = useRef(null);

  const latestTimeRef = useRef(0);
  const lastCloudSyncRef = useRef(0);

  // Fecha dropdown de qualidade ao clicar fora
  useEffect(() => {
    if (!dlMenuOpen) return undefined;
    const onDocClick = (e) => {
      if (dlMenuRef.current && !dlMenuRef.current.contains(e.target)) {
        setDlMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [dlMenuOpen]);

  // Acompanha progresso em tempo real dos downloads em andamento
  const hasRunningDownloads = downloads.some(
    (d) => d.status === 'preparing' || d.status === 'downloading'
  );

  useEffect(() => {
    if (!hasRunningDownloads) return undefined;
    let cancelled = false;

    const timer = setInterval(async () => {
      setDownloads((current) => {
        const active = current.filter(
          (d) => d.status === 'preparing' || d.status === 'downloading'
        );
        active.forEach((item) => {
          stcineApi
            .getDownloadProgress(item.id)
            .then((prog) => {
              if (cancelled || !prog) return;
              setDownloads((prev) =>
                prev.map((d) =>
                  d.id === item.id
                    ? {
                        ...d,
                        status: prog.status || d.status,
                        filename: prog.filename || d.filename,
                        container: prog.container || d.container,
                        percent: Number(prog.percent ?? d.percent),
                        completedSegments: Number(prog.completed_segments ?? d.completedSegments),
                        totalSegments: Number(prog.total_segments ?? d.totalSegments),
                        bytesDownloaded: Number(prog.bytes_downloaded ?? d.bytesDownloaded),
                        speedBps: Number(prog.speed_bps ?? d.speedBps),
                        error: prog.error || null,
                      }
                    : d
                )
              );
            })
            .catch(() => {});
        });
        return current;
      });
    }, 850);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasRunningDownloads]);

  // Carrega detalhes iniciais do título
  useEffect(() => {
    let cancelled = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const saved = getSavedVodProgress(vodId);
    const initialAudio = saved?.audioType || 0;

    setLoading(true);
    setError('');
    setDetail(null);
    setSimilar([]);
    setBarrage([]);
    setDlMenuOpen(false);
    setAudioType(initialAudio);

    (async () => {
      try {
        const data = await stcineApi.getVodDetail(vodId, initialAudio);
        if (cancelled) return;
        setDetail(data);
        setAudioType(data.active_audio_type || initialAudio);

        const eps = data.vod_collection || [];
        let startEpIdx = 0;
        if (saved?.episode && eps.length > 1) {
          const found = eps.findIndex((e) => Number(e.collection) === Number(saved.episode));
          if (found >= 0) startEpIdx = found;
        }
        setEpisodeIdx(startEpIdx);
        setEpRangeIdx(Math.floor(startEpIdx / EP_PAGE_SIZE));
        setResumeTime(saved?.currentTime > 5 ? saved.currentTime : 0);
        latestTimeRef.current = saved?.currentTime || 0;

        // Carrega similares em paralelo
        const firstGenre = data.genres?.[0] || '';
        stcineApi
          .getSimilar(vodId, firstGenre, 12)
          .then((sim) => {
            if (!cancelled) setSimilar(sim || []);
          })
          .catch(() => {});
      } catch (err) {
        if (!cancelled) setError(err.message || 'Não foi possível carregar este título.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [vodId]);

  const episodes = detail?.vod_collection || [];
  const activeEpisode = episodes[episodeIdx] || episodes[0] || null;
  const isSeries = episodes.length > 1 || detail?.media_type === 'series';
  const audioOptions = Array.isArray(detail?.audio_type_option) ? detail.audio_type_option : [];

  const activeAudioLabel = useMemo(() => {
    if (!audioOptions.length) return '';
    const found = audioOptions.find((o) => Number(o.type) === Number(audioType));
    return found?.type_name || audioOptions[0]?.type_name || '';
  }, [audioOptions, audioType]);

  // Inicia o download de qualquer episódio ou filme
  const startEpisodeDownload = useCallback(
    (targetEp, epIndex = 0, chosenQuality = null) => {
      if (!detail || !targetEp) return;
      setDlMenuOpen(false);

      const epKey = `${detail.id}_${targetEp.id || epIndex}_${audioType}`;
      // Evita disparar duplicado se o mesmo episódio já estiver baixando
      const alreadyRunning = downloads.find(
        (d) =>
          d.epKey === epKey && (d.status === 'preparing' || d.status === 'downloading')
      );
      if (alreadyRunning) return;

      const q =
        chosenQuality || targetEp.web_stream?.qualities?.[0] || targetEp.web_stream || null;
      const downloadId = `r7_${detail.id}_${targetEp.id || epIndex}_${Date.now()}`;
      const epNumLabel = targetEp.title || targetEp.collection || epIndex + 1;
      const displayLabel = isSeries
        ? `${detail.vod_name} · Ep. ${epNumLabel}${activeAudioLabel ? ` (${activeAudioLabel})` : ''}`
        : `${detail.vod_name}${activeAudioLabel ? ` (${activeAudioLabel})` : ''}`;

      const dlUrl = stcineApi.buildDownloadUrl({
        episode: targetEp,
        quality: q,
        title: detail.vod_name,
        isSeries,
        episodeNumber: epIndex + 1,
        audioLabel: activeAudioLabel,
        downloadId,
      });

      setDownloads((prev) => [
        {
          id: downloadId,
          epKey,
          epId: targetEp.id || epIndex,
          label: displayLabel,
          resolution: q?.label || '720p HD',
          filename: '',
          container: '',
          status: 'preparing',
          percent: 0,
          completedSegments: 0,
          totalSegments: 0,
          bytesDownloaded: 0,
          speedBps: 0,
          error: null,
        },
        ...prev.filter((d) => d.epKey !== epKey).slice(0, 7),
      ]);

      triggerBrowserDownload(dlUrl);
    },
    [detail, audioType, downloads, isSeries, activeAudioLabel]
  );

  const handleCancelOrDismissDownload = (item) => {
    if (item.status === 'preparing' || item.status === 'downloading') {
      stcineApi.cancelDownload(item.id);
    }
    setDownloads((prev) => prev.filter((d) => d.id !== item.id));
  };

  // Baixa todos os episódios da faixa visível em sequência (opcional p/ maratonar offline)
  const getEpisodeDownloadState = useCallback(
    (ep, idx) => {
      if (!detail || !ep) return null;
      const epKey = `${detail.id}_${ep.id || idx}_${audioType}`;
      return downloads.find((d) => d.epKey === epKey) || null;
    },
    [detail, audioType, downloads]
  );

  // Carrega comentários sincronizados do episódio atual
  useEffect(() => {
    if (!detail?.id || !activeEpisode?.id) return undefined;
    let cancelled = false;
    stcineApi
      .getBarrage(detail.id, activeEpisode.collection || 1, activeEpisode.id)
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setBarrage(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [detail?.id, activeEpisode?.id, activeEpisode?.collection]);

  // Troca de áudio (Dublado <-> Legendado) preservando o tempo exato
  const handleAudioSwitch = async (nextType, curPos) => {
    if (!detail || Number(nextType) === Number(audioType) || switchingAudio) return;
    const keepTime = curPos !== undefined ? curPos : latestTimeRef.current;
    const currentCollection = activeEpisode?.collection || 1;
    setSwitchingAudio(true);
    try {
      const updated = await stcineApi.getVodDetail(detail.id, nextType);
      setDetail(updated);
      setAudioType(Number(nextType));
      const nextEps = updated.vod_collection || [];
      const sameIdx = nextEps.findIndex((e) => Number(e.collection) === Number(currentCollection));
      setEpisodeIdx(sameIdx >= 0 ? sameIdx : 0);
      setResumeTime(keepTime > 3 ? keepTime : 0);
    } catch {
      // mantém áudio atual
    } finally {
      setSwitchingAudio(false);
    }
  };

  const handleSelectEpisode = (idx) => {
    if (idx === episodeIdx) return;
    setEpisodeIdx(idx);
    setEpRangeIdx(Math.floor(idx / EP_PAGE_SIZE));
    setResumeTime(0);
    latestTimeRef.current = 0;
  };

  const handleProgress = (cur, dur) => {
    latestTimeRef.current = cur;
    if (!detail || !activeEpisode) return;

    const updatedHistory = upsertLocalHistory({
      id: detail.id,
      vod_name: detail.vod_name,
      vod_pic: detail.vod_pic,
      poster_url: detail.poster_url,
      poster_proxy: detail.poster_proxy,
      vod_year: detail.vod_year,
      vod_total: detail.vod_total,
      type_pid: detail.type_pid,
      media_type: detail.media_type,
      rating: detail.rating,
      genres: detail.genres,
      episode: activeEpisode.collection || episodeIdx + 1,
      episodeId: activeEpisode.id,
      audioType,
      currentTime: Math.floor(cur),
      duration: Math.floor(dur || activeEpisode.vod_duration || 0),
    });
    if (onHistoryUpdated) onHistoryUpdated(updatedHistory);

    // Sincroniza com servidor a cada 30s
    const now = Date.now();
    if (now - lastCloudSyncRef.current > 30000) {
      lastCloudSyncRef.current = now;
      stcineApi
        .syncProgress({
          vodId: detail.id,
          collectionId: activeEpisode.id,
          currentTime: cur,
          totalTime: dur || activeEpisode.vod_duration || 0,
        })
        .catch(() => {});
    }
  };

  const handleSendBarrage = async (e) => {
    e.preventDefault();
    const text = barrageInput.trim();
    if (!text || !detail || !activeEpisode || sendingBarrage) return;
    setSendingBarrage(true);
    try {
      const sec = Math.floor(latestTimeRef.current || 1);
      await stcineApi.sendBarrage({
        vodId: detail.id,
        collection: activeEpisode.collection || 1,
        collectionId: activeEpisode.id,
        content: text,
        playSecond: sec,
      });
      setBarrage((prev) => [...prev, { content: text, play_second: sec + 1 }]);
      setShowBarrage(true);
      setBarrageInput('');
    } catch {
      // ignora erro de rede
    } finally {
      setSendingBarrage(false);
    }
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#watch/${vodId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleCopyStream = async () => {
    const url = activeEpisode?.web_stream?.direct_url || '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedStream(true);
      setTimeout(() => setCopiedStream(false), 2000);
    } catch {
      // ignore
    }
  };

  // Faixas de episódios para séries longas (ex: 1-24, 25-48)
  const episodeRanges = useMemo(() => {
    if (episodes.length <= EP_PAGE_SIZE) return [];
    const ranges = [];
    for (let start = 0; start < episodes.length; start += EP_PAGE_SIZE) {
      const end = Math.min(episodes.length, start + EP_PAGE_SIZE);
      ranges.push({
        start,
        end,
        label: `${episodes[start]?.collection || start + 1}–${episodes[end - 1]?.collection || end}`,
      });
    }
    return ranges;
  }, [episodes]);

  const visibleEpisodes = useMemo(() => {
    if (episodeRanges.length === 0) {
      return episodes.map((ep, idx) => ({ ep, idx }));
    }
    const r = episodeRanges[epRangeIdx] || episodeRanges[0];
    return episodes.slice(r.start, r.end).map((ep, offset) => ({ ep, idx: r.start + offset }));
  }, [episodes, episodeRanges, epRangeIdx]);

  if (loading) {
    return (
      <div className="max-w-[1280px] mx-auto px-4 sm:px-7 lg:px-10 pt-24 pb-20 space-y-6">
        <div className="h-6 w-32 rounded-lg bg-white/[0.06] animate-pulse" />
        <div className="w-full aspect-video rounded-2xl bg-[#11131c] border border-white/[0.06] flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-[#e50914] animate-spin" />
          <p className="text-xs text-zinc-400">Carregando player R7 STREAMING...</p>
        </div>
        <div className="h-8 w-2/3 rounded-lg bg-white/[0.06] animate-pulse" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="max-w-[960px] mx-auto px-4 pt-28 pb-20 text-center space-y-4">
        <p className="text-lg font-semibold text-white">{error || 'Título indisponível.'}</p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium text-white cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar ao catálogo</span>
        </button>
      </div>
    );
  }

  const seasons = Array.isArray(detail.seasons) ? detail.seasons : [];
  const favored = isFavorite ? isFavorite(detail.id) : false;
  const cast = detail.vod_actor
    ? detail.vod_actor
        .split(/[,、]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const activeEpNum = activeEpisode?.title || activeEpisode?.collection || episodeIdx + 1;
  const episodeLabel = isSeries ? `Episódio ${activeEpNum}` : '';
  const activeQualities = activeEpisode?.web_stream?.qualities || [];
  const activeSubtitles = activeEpisode?.web_stream?.subtitles || [];
  const hasDownloadOptions = activeQualities.length > 1 || activeSubtitles.length > 0;
  const currentEpDl = getEpisodeDownloadState(activeEpisode, episodeIdx);
  const currentEpDownloading =
    currentEpDl && (currentEpDl.status === 'preparing' || currentEpDl.status === 'downloading');

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-7 lg:px-10 pt-20 sm:pt-22 pb-20 space-y-8">
      {/* Barra superior de retorno + status Web sem P2P */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
            <Wifi className="w-3 h-3" />
            <span>R7 Direct HD · Sem P2P</span>
          </span>
          {activeEpisode?.web_stream?.direct_url && (
            <button
              type="button"
              onClick={handleCopyStream}
              title="Copiar URL HLS (.m3u8) direta"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
            >
              {copiedStream ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              <span>{copiedStream ? 'M3U8 Copiado' : 'M3U8'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Player Cinema HLS */}
      <div className="space-y-3">
        <div className="relative">
          <VideoPlayer
            episode={activeEpisode}
            poster={resolvePoster(detail)}
            title={detail.vod_name}
            episodeLabel={episodeLabel}
            initialTime={resumeTime}
            hasNextEpisode={episodeIdx < episodes.length - 1}
            onNextEpisode={() => handleSelectEpisode(episodeIdx + 1)}
            onProgress={handleProgress}
            barrageList={barrage}
            showBarrage={showBarrage}
            onToggleBarrage={() => setShowBarrage((v) => !v)}
            audioOptions={audioOptions}
            activeAudioType={audioType}
            onChangeAudio={handleAudioSwitch}
            onDownload={() => startEpisodeDownload(activeEpisode, episodeIdx)}
          />
          {switchingAudio && (
            <div className="absolute inset-0 rounded-2xl bg-black/70 backdrop-blur-sm flex items-center justify-center gap-2.5 z-30">
              <Loader2 className="w-5 h-5 text-[#e50914] animate-spin" />
              <span className="text-sm font-medium text-white">Alternando faixa de áudio...</span>
            </div>
          )}
        </div>

        {/* Barra de controles rápidos abaixo do player: Áudio + Download EP + Favorito + Compartilhar + Comentário */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#10121b] border border-white/[0.07] rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            {audioOptions.length > 0 && (
              <div className="inline-flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/[0.07]">
                <Volume2 className="w-3.5 h-3.5 text-zinc-400 ml-1.5 mr-0.5" />
                {audioOptions.map((opt) => {
                  const active =
                    Number(audioType) === Number(opt.type) || audioOptions.length === 1;
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      disabled={switchingAudio || audioOptions.length === 1}
                      onClick={() => handleAudioSwitch(opt.type)}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer disabled:cursor-default ${
                        active
                          ? 'bg-[#e50914] text-white shadow'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {opt.type_name}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Botão principal de Download do EP / Filme */}
            {activeEpisode?.web_stream?.direct_url && (
              <div className="relative" ref={dlMenuRef}>
                <button
                  type="button"
                  disabled={Boolean(currentEpDownloading)}
                  onClick={() => {
                    if (hasDownloadOptions) {
                      setDlMenuOpen((v) => !v);
                    } else {
                      startEpisodeDownload(activeEpisode, episodeIdx);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer disabled:cursor-default ${
                    currentEpDownloading
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'bg-white text-black hover:bg-zinc-200 border-white shadow-[0_2px_12px_rgba(255,255,255,0.12)]'
                  }`}
                >
                  {currentEpDownloading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Baixando {currentEpDl.percent}%</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      <span>{isSeries ? `Baixar EP ${activeEpNum}` : 'Baixar Filme'}</span>
                      {hasDownloadOptions && <ChevronDown className="w-3.5 h-3.5 -mr-0.5" />}
                    </>
                  )}
                </button>

                {/* Menu de qualidades e legendas quando disponível */}
                {dlMenuOpen && (
                  <div className="absolute left-0 mt-2 w-60 rounded-xl bg-[#141724] border border-white/15 shadow-2xl p-1.5 z-40 space-y-1">
                    <p className="px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-zinc-400">
                      Escolha a qualidade
                    </p>
                    {activeQualities.map((q) => (
                      <button
                        key={q.resolution}
                        type="button"
                        onClick={() => startEpisodeDownload(activeEpisode, episodeIdx, q)}
                        className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-white/10 text-xs font-semibold text-white transition-colors cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Download className="w-3.5 h-3.5 text-[#ff3b47]" />
                          <span>
                            {isSeries ? `EP ${activeEpNum}` : 'Filme'} · {q.label}
                          </span>
                        </span>
                        {activeAudioLabel && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-zinc-300">
                            {activeAudioLabel}
                          </span>
                        )}
                      </button>
                    ))}
                    {activeSubtitles.length > 0 && (
                      <>
                        <div className="border-t border-white/10 my-1" />
                        <p className="px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-zinc-400">
                          Legendas
                        </p>
                        {activeSubtitles.map((sub, sIdx) => (
                          <a
                            key={`${sub.lang}-${sIdx}`}
                            href={sub.vtt_proxy_url}
                            download={`${detail.vod_name}${isSeries ? ` - Ep ${activeEpNum}` : ''} (${sub.label}).vtt`}
                            onClick={() => setDlMenuOpen(false)}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-xs text-zinc-200 transition-colors"
                          >
                            <Subtitles className="w-3.5 h-3.5 text-sky-400" />
                            <span>Baixar {sub.label} (.vtt)</span>
                          </a>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => onToggleFavorite(detail)}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                favored
                  ? 'bg-[#e50914]/15 border-[#e50914]/40 text-[#ff5c66]'
                  : 'bg-white/[0.05] hover:bg-white/[0.1] border-white/10 text-zinc-200'
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${favored ? 'fill-[#ff5c66]' : ''}`} />
              <span>{favored ? 'Salvo na Lista' : 'Minha Lista'}</span>
            </button>

            <button
              type="button"
              onClick={handleShare}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-zinc-200 transition-colors cursor-pointer"
            >
              {copiedShare ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Share2 className="w-3.5 h-3.5" />
              )}
              <span>{copiedShare ? 'Link Copiado!' : 'Compartilhar'}</span>
            </button>
          </div>

          {/* Envio de comentário sincronizado (Barrage) */}
          <form onSubmit={handleSendBarrage} className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              value={barrageInput}
              onChange={(e) => setBarrageInput(e.target.value)}
              maxLength={100}
              placeholder="Comentar neste momento do vídeo..."
              className="flex-1 sm:w-60 h-8 px-3 rounded-lg bg-black/45 border border-white/10 focus:border-[#e50914] focus:outline-none text-xs text-white placeholder:text-zinc-500"
            />
            <button
              type="submit"
              disabled={!barrageInput.trim() || sendingBarrage}
              className="h-8 px-3 rounded-lg bg-white/10 hover:bg-[#e50914] disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {/* Painel de progresso em tempo real dos downloads */}
        {downloads.length > 0 && (
          <div className="bg-[#0e111a] border border-white/10 rounded-xl p-3.5 space-y-2.5">
            {downloads.map((dl) => {
              const running = dl.status === 'preparing' || dl.status === 'downloading';
              const done = dl.status === 'completed';
              const failed = dl.status === 'error' || dl.status === 'cancelled';

              return (
                <div key={dl.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      {running && (
                        <Loader2 className="w-3.5 h-3.5 text-[#ff3b47] animate-spin shrink-0" />
                      )}
                      {done && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      {failed && <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                      <span className="font-semibold text-white truncate">{dl.label}</span>
                      <span className="hidden sm:inline text-[10.5px] px-1.5 py-0.5 rounded bg-white/[0.07] text-zinc-300 shrink-0">
                        {dl.container ? `.${dl.container.toUpperCase()}` : dl.resolution}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0 text-[11px] font-mono text-zinc-400">
                      {running && (
                        <>
                          {dl.bytesDownloaded > 0 && (
                            <span>{formatBytes(dl.bytesDownloaded)}</span>
                          )}
                          {dl.speedBps > 0 && (
                            <span className="hidden sm:inline text-emerald-400">
                              {formatBytes(dl.speedBps)}/s
                            </span>
                          )}
                          <span className="font-bold text-white">{dl.percent}%</span>
                        </>
                      )}
                      {done && (
                        <span className="text-emerald-400 font-sans font-semibold">
                          Concluído ({formatBytes(dl.bytesDownloaded)})
                        </span>
                      )}
                      {failed && (
                        <span className="text-amber-300 font-sans">
                          {dl.status === 'cancelled' ? 'Cancelado' : dl.error || 'Falhou'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCancelOrDismissDownload(dl)}
                        title={running ? 'Cancelar download' : 'Fechar aviso'}
                        className="w-6 h-6 rounded-md hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Barra de progresso */}
                  <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        done
                          ? 'bg-emerald-500'
                          : failed
                            ? 'bg-amber-500'
                            : 'bg-gradient-to-r from-[#e50914] to-[#ff4d58]'
                      }`}
                      style={{ width: `${done ? 100 : Math.max(running ? 3 : 0, dl.percent)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Temporadas + Seletor de Episódios (com botão de download individual em cada EP!) */}
      {(episodes.length > 1 || seasons.length > 1) && (
        <section className="bg-[#10121b] border border-white/[0.07] rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Layers className="w-4 h-4 text-[#ff3b47]" />
              <h2 className="font-display text-lg font-bold text-white">
                {episodes.length > 1 ? `Episódios (${episodes.length})` : 'Partes / Sequências'}
              </h2>
              {episodes.length > 1 && (
                <span className="hidden sm:inline text-xs text-zinc-500">
                  · Clique no ícone <Download className="w-3 h-3 inline -mt-0.5" /> para baixar qualquer EP
                </span>
              )}
            </div>

            {/* Abas de faixa para séries com muitos episódios */}
            {episodeRanges.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {episodeRanges.map((r, rIdx) => (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => setEpRangeIdx(rIdx)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      rIdx === epRangeIdx
                        ? 'bg-white/15 text-white border border-white/20'
                        : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Seletor de temporadas relacionadas */}
          {seasons.length > 1 && (
            <div className="flex flex-wrap gap-2 pb-1">
              {seasons.map((s) => (
                <button
                  key={s.vod_id}
                  type="button"
                  onClick={() => {
                    if (!s.is_current) onSelectVod(s.vod_id);
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    s.is_current
                      ? 'bg-[#e50914] border-[#e50914] text-white'
                      : 'bg-white/[0.04] hover:bg-white/[0.1] border-white/10 text-zinc-300'
                  }`}
                >
                  {isSeries ? `Temporada ${s.season}` : `Parte ${s.season}`}
                </button>
              ))}
            </div>
          )}

          {/* Grade de episódios com download direto por EP */}
          {episodes.length > 1 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
              {visibleEpisodes.map(({ ep, idx }) => {
                const active = idx === episodeIdx;
                const epDl = getEpisodeDownloadState(ep, idx);
                const epRunning =
                  epDl && (epDl.status === 'preparing' || epDl.status === 'downloading');
                const epDone = epDl?.status === 'completed';
                const epNumText = ep.title || ep.collection || idx + 1;

                return (
                  <div
                    key={ep.id || idx}
                    className={`group/ep relative overflow-hidden flex flex-col justify-between p-3 rounded-xl border transition-all ${
                      active
                        ? 'bg-[#e50914]/18 border-[#e50914] text-white shadow-[0_0_20px_rgba(229,9,20,0.2)]'
                        : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/[0.07] text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full gap-1">
                      <button
                        type="button"
                        onClick={() => handleSelectEpisode(idx)}
                        className="flex items-center gap-1.5 text-left text-xs font-bold flex-1 min-w-0 cursor-pointer"
                      >
                        <span className="truncate">Ep. {epNumText}</span>
                        {active && (
                          <Play className="w-3 h-3 fill-[#ff3b47] text-[#ff3b47] shrink-0" />
                        )}
                      </button>

                      {/* Botão de Download individual do EP */}
                      {ep.web_stream?.direct_url && (
                        <button
                          type="button"
                          disabled={Boolean(epRunning)}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEpisodeDownload(ep, idx);
                          }}
                          title={
                            epRunning
                              ? `Baixando Ep. ${epNumText} (${epDl.percent}%)`
                              : epDone
                                ? `Ep. ${epNumText} baixado (clique para baixar novamente)`
                                : `Baixar Ep. ${epNumText}`
                          }
                          className={`w-6 h-6 -mr-1 rounded-lg flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                            epRunning
                              ? 'bg-[#e50914]/25 text-[#ff5c66]'
                              : epDone
                                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                                : 'text-zinc-400 hover:text-white hover:bg-white/15'
                          }`}
                        >
                          {epRunning ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : epDone ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSelectEpisode(idx)}
                      className="text-left w-full mt-1 cursor-pointer"
                    >
                      {epRunning ? (
                        <span className="text-[10.5px] font-mono text-emerald-400">
                          Baixando {epDl.percent}%
                        </span>
                      ) : ep.duration ? (
                        <span className="text-[10.5px] font-mono text-zinc-400">{ep.duration}</span>
                      ) : (
                        <span className="text-[10.5px] text-zinc-500">Assistir</span>
                      )}
                    </button>

                    {/* Mini barra de progresso no rodapé do card do EP */}
                    {epRunning && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
                        <div
                          className="h-full bg-[#e50914] transition-all duration-300"
                          style={{ width: `${Math.max(5, epDl.percent)}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Ficha técnica do título */}
      <section className="flex flex-col sm:flex-row gap-6 bg-[#10121b] border border-white/[0.07] rounded-2xl p-5 sm:p-6">
        {resolvePoster(detail) && (
          <img
            src={resolvePoster(detail)}
            alt={detail.vod_name}
            className="hidden sm:block w-36 h-52 object-cover rounded-xl border border-white/10 shrink-0"
          />
        )}

        <div className="space-y-3.5 min-w-0 flex-1">
          <div className="space-y-2">
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {detail.vod_name}
            </h1>

            <div className="flex flex-wrap items-center gap-2.5 text-xs text-zinc-300">
              {detail.rating && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-400/15 text-amber-300 font-bold border border-amber-400/25">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  {detail.rating}
                </span>
              )}
              {detail.vod_year ? <span className="font-semibold">{detail.vod_year}</span> : null}
              {activeEpisode?.duration ? (
                <span className="text-zinc-400">· {activeEpisode.duration}</span>
              ) : null}
              <span className="px-2 py-0.5 rounded bg-white/[0.07] text-zinc-200 font-medium">
                {activeEpisode?.vod_resolution?.[0] || '720'}p HD
              </span>
              {detail.genres?.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => onSelectGenre && onSelectGenre(g, detail.type_pid)}
                  className="px-2.5 py-0.5 rounded-full bg-white/[0.06] hover:bg-[#e50914]/25 border border-white/10 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {detail.vod_blurb ? (
            <p className="text-sm text-zinc-300 leading-relaxed">{detail.vod_blurb}</p>
          ) : (
            <p className="text-sm text-zinc-500 italic">Sinopse não informada para este título.</p>
          )}

          <div className="pt-1 space-y-1.5 text-xs text-zinc-400">
            {detail.vod_director && (
              <p>
                <span className="text-zinc-500 font-medium">Direção: </span>
                <span className="text-zinc-200">{detail.vod_director}</span>
              </p>
            )}
            {cast.length > 0 && (
              <p>
                <span className="text-zinc-500 font-medium">Elenco: </span>
                <span className="text-zinc-200">{cast.slice(0, 8).join(', ')}</span>
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Títulos semelhantes */}
      {similar.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-bold text-white">Títulos Semelhantes</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {similar.slice(0, 12).map((item) => (
              <VodCard
                key={item.id}
                vod={item}
                onSelect={onSelectVod}
                isFavorite={isFavorite}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
