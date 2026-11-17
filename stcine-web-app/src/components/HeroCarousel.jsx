import React, { useEffect, useState } from 'react';
import { Play, Plus, Check, Star, ChevronLeft, ChevronRight } from 'lucide-react';

export default function HeroCarousel({
  banners = [],
  onSelectVod,
  isFavorite,
  onToggleFavorite,
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const validBanners = banners.filter((b) => b?.id && (b.banner_proxy || b.banner_url));

  useEffect(() => {
    setIndex(0);
  }, [banners]);

  useEffect(() => {
    if (validBanners.length <= 1 || paused) return undefined;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % validBanners.length);
    }, 7500);
    return () => clearInterval(timer);
  }, [validBanners.length, paused]);

  if (validBanners.length === 0) return null;

  const current = validBanners[index] || validBanners[0];
  const vod = current.vod || {};
  const title = vod.vod_name || 'Em Destaque';
  const genres = Array.isArray(vod.genres) ? vod.genres.slice(0, 3) : [];
  const rating = vod.rating;
  const year = vod.vod_year;
  const isMovie = vod.media_type === 'movie';
  const actors = vod.vod_actor
    ? vod.vod_actor
        .split(/[,、]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' · ')
    : '';
  const synopsis = vod.vod_blurb?.trim() || '';
  const favored = isFavorite ? isFavorite(current.id) : false;

  const goPrev = () => setIndex((prev) => (prev - 1 + validBanners.length) % validBanners.length);
  const goNext = () => setIndex((prev) => (prev + 1) % validBanners.length);

  return (
    <section
      className="relative w-full h-[64vh] min-h-[440px] max-h-[680px] overflow-hidden select-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Destaques em cartaz"
    >
      {/* Slides de fundo 4K com crossfade */}
      {validBanners.map((slide, i) => {
        const active = i === index;
        const imgSrc = slide.banner_proxy || slide.banner_url;
        return (
          <div
            key={`${slide.id}-${i}`}
            className={`absolute inset-0 transition-opacity duration-700 ease-out ${
              active ? 'opacity-100 z-0' : 'opacity-0 -z-10 pointer-events-none'
            }`}
          >
            <img
              src={imgSrc}
              alt={slide.vod?.vod_name || ''}
              loading={i === 0 ? 'eager' : 'lazy'}
              onError={(e) => {
                if (slide.banner_url && e.currentTarget.src !== slide.banner_url) {
                  e.currentTarget.src = slide.banner_url;
                }
              }}
              className="w-full h-full object-cover object-center"
            />
          </div>
        );
      })}

      {/* Vinhetas cinematográficas para contraste perfeito */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#08090d] via-[#08090d]/72 to-transparent pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#08090d] via-[#08090d]/25 to-transparent pointer-events-none" />

      {/* Conteúdo editorial */}
      <div className="relative z-10 max-w-[1440px] mx-auto h-full px-4 sm:px-7 lg:px-10 flex flex-col justify-end pb-14 sm:pb-16">
        <div className="max-w-2xl space-y-3.5">
          {/* Metadados compactos */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold">
            <span className="px-2.5 py-0.5 rounded bg-[#e50914] text-white tracking-wide uppercase text-[11px]">
              {isMovie ? 'Filme' : 'Série'}
            </span>
            {rating && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-black/55 border border-amber-400/30 text-amber-300">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                {rating}
              </span>
            )}
            {year ? <span className="text-zinc-200">{year}</span> : null}
            {!isMovie && Number(vod.vod_total) > 1 && (
              <span className="text-zinc-300">{vod.vod_total} episódios</span>
            )}
            {genres.length > 0 && (
              <span className="text-zinc-300/90 hidden sm:inline">
                · {genres.join(' / ')}
              </span>
            )}
          </div>

          {/* Título */}
          <h1 className="font-display text-3xl sm:text-5xl lg:text-[54px] font-extrabold tracking-tight text-white leading-[1.06] drop-shadow-[0_4px_24px_rgba(0,0,0,0.65)]">
            {title}
          </h1>

          {/* Sinopse ou elenco */}
          {synopsis ? (
            <p className="text-sm sm:text-base text-zinc-200/90 line-clamp-2 max-w-xl leading-relaxed">
              {synopsis}
            </p>
          ) : actors ? (
            <p className="text-sm text-zinc-300/90 line-clamp-1">
              <span className="text-zinc-400">Com </span>
              {actors}
            </p>
          ) : null}

          {/* CTAs */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onSelectVod(current.id)}
              className="inline-flex items-center gap-2.5 h-11 sm:h-12 px-6 sm:px-7 rounded-xl bg-[#e50914] hover:bg-[#f6121d] active:scale-[0.98] text-white font-semibold text-sm sm:text-base shadow-[0_8px_28px_rgba(229,9,20,0.42)] transition-all cursor-pointer"
            >
              <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-white" />
              <span>Assistir Agora</span>
            </button>

            {vod.id && onToggleFavorite && (
              <button
                type="button"
                onClick={() => onToggleFavorite(vod)}
                className={`inline-flex items-center gap-2 h-11 sm:h-12 px-5 rounded-xl backdrop-blur-md border font-medium text-sm transition-all cursor-pointer ${
                  favored
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-white/[0.10] hover:bg-white/[0.17] border-white/15 text-zinc-100'
                }`}
              >
                {favored ? <Check className="w-4 h-4 text-emerald-400" /> : <Plus className="w-4 h-4" />}
                <span>{favored ? 'Na Minha Lista' : 'Minha Lista'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Controles laterais & indicadores */}
        {validBanners.length > 1 && (
          <div className="absolute right-4 sm:right-7 lg:right-10 bottom-14 sm:bottom-16 flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 mr-1">
              {validBanners.map((b, i) => (
                <button
                  key={`dot-${b.id}-${i}`}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Slide ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${
                    i === index ? 'w-7 bg-[#e50914]' : 'w-2 bg-white/35 hover:bg-white/60'
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Anterior"
              className="w-9 h-9 rounded-full bg-black/50 hover:bg-white/15 border border-white/15 flex items-center justify-center text-white transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Próximo"
              className="w-9 h-9 rounded-full bg-black/50 hover:bg-white/15 border border-white/15 flex items-center justify-center text-white transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
