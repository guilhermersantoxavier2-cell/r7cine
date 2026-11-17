import React, { useState } from 'react';
import { Play, Star, Heart, X } from 'lucide-react';
import { resolvePoster } from '../api/stcine';

export default function VodCard({
  vod,
  onSelect,
  isFavorite,
  onToggleFavorite,
  rank,
  progress,
  onRemove,
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);

  if (!vod) return null;
  const poster = resolvePoster(vod);
  const rawPic = vod.poster_url || vod.vod_pic || '';
  const title = vod.vod_name || vod.name || 'Sem título';
  const score =
    vod.rating ||
    (parseFloat(vod.vod_douban_score) > 0 ? parseFloat(vod.vod_douban_score).toFixed(1) : null);
  const year = vod.vod_year || '';
  const totalEps = Number(vod.vod_total) || 0;
  const isSeries = vod.media_type === 'series' || Number(vod.type_pid) === 2 || totalEps > 1;
  const favored = isFavorite ? isFavorite(vod.id) : false;

  const progressPct =
    progress && progress.duration > 0
      ? Math.min(100, Math.max(3, Math.round((progress.currentTime / progress.duration) * 100)))
      : 0;

  return (
    <div className="group relative flex flex-col min-w-0">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(vod.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(vod.id);
          }
        }}
        className="relative aspect-[2/3] w-full rounded-xl overflow-hidden bg-[#13151f] border border-white/[0.07] group-hover:border-white/25 transition-all duration-250 group-hover:-translate-y-1 shadow-[0_6px_20px_rgba(0,0,0,0.35)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#e50914]"
      >
        {poster && !imgFailed ? (
          <img
            src={poster}
            alt={title}
            loading="lazy"
            onError={(e) => {
              if (!triedFallback && rawPic && e.currentTarget.src !== rawPic) {
                setTriedFallback(true);
                e.currentTarget.src = rawPic;
              } else {
                setImgFailed(true);
              }
            }}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-[#191c29] to-[#0f1119]">
            <span className="font-display text-sm font-bold text-zinc-300 line-clamp-3">
              {title}
            </span>
          </div>
        )}

        {/* Gradiente sutil inferior */}
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />

        {/* Número de ranking (Em Alta) */}
        {rank ? (
          <div className="absolute top-2 left-2 min-w-[28px] h-7 px-2 rounded-lg bg-[#e50914] text-white font-display font-extrabold text-xs flex items-center justify-center shadow-lg">
            #{rank}
          </div>
        ) : score ? (
          <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[11px] font-semibold text-amber-300 border border-white/10">
            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
            <span>{score}</span>
          </div>
        ) : null}

        {/* Botão de favorito ou remover */}
        {onRemove ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(vod.id);
            }}
            title="Remover do histórico"
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 hover:bg-[#e50914] text-zinc-200 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer z-10"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : onToggleFavorite ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(vod);
            }}
            title={favored ? 'Remover da Minha Lista' : 'Adicionar à Minha Lista'}
            className={`absolute top-2 right-2 w-7 h-7 rounded-full backdrop-blur-sm flex items-center justify-center transition-all cursor-pointer z-10 ${
              favored
                ? 'bg-[#e50914] text-white opacity-100'
                : 'bg-black/65 hover:bg-black/90 text-white/80 opacity-0 group-hover:opacity-100'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favored ? 'fill-white' : ''}`} />
          </button>
        ) : null}

        {/* Selo de episódios / progresso */}
        {progress?.episode && isSeries ? (
          <span className="absolute bottom-2.5 left-2 text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-black/75 text-zinc-100">
            Ep. {progress.episode}
          </span>
        ) : isSeries && totalEps > 1 ? (
          <span className="absolute bottom-2 left-2 text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-black/70 text-zinc-200 border border-white/10">
            {totalEps} eps
          </span>
        ) : null}

        {/* Overlay de Play no hover */}
        <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <div className="w-11 h-11 rounded-full bg-[#e50914] text-white flex items-center justify-center shadow-[0_6px_20px_rgba(229,9,20,0.55)] scale-90 group-hover:scale-100 transition-transform">
            <Play className="w-5 h-5 fill-white ml-0.5" />
          </div>
        </div>

        {/* Barra de progresso (Continuar Assistindo) */}
        {progressPct > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <div
              className="h-full bg-[#e50914]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </div>

      {/* Título e subtítulo limpos abaixo do pôster */}
      <div className="mt-2 px-0.5">
        <h3
          onClick={() => onSelect(vod.id)}
          className="text-[13.5px] font-semibold text-zinc-100 group-hover:text-white truncate cursor-pointer"
          title={title}
        >
          {title}
        </h3>
        <div className="flex items-center gap-1.5 text-[11.5px] text-zinc-400 mt-0.5 truncate">
          {year ? <span>{year}</span> : null}
          {year && (vod.genres?.[0] || isSeries) ? <span>·</span> : null}
          <span className="truncate">
            {vod.genres?.[0] || (isSeries ? 'Série' : 'Filme')}
          </span>
        </div>
      </div>
    </div>
  );
}
