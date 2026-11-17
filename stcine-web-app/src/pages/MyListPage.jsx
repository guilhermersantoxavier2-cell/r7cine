import React from 'react';
import { Bookmark, Clock, Compass } from 'lucide-react';
import VodCard from '../components/VodCard';

export default function MyListPage({
  favorites = [],
  history = [],
  onSelectVod,
  isFavorite,
  onToggleFavorite,
  onRemoveHistory,
  onExplore,
}) {
  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-7 lg:px-10 pt-24 pb-20 space-y-12">
      {/* Favoritos sincronizados */}
      <section className="space-y-5">
        <div className="flex items-center gap-2.5">
          <Bookmark className="w-5 h-5 text-[#ff3b47]" />
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Minha Lista
          </h1>
          <span className="text-sm text-zinc-400 font-medium">({favorites.length})</span>
        </div>

        {favorites.length === 0 ? (
          <div className="bg-[#10121b] border border-white/[0.07] rounded-2xl p-10 text-center space-y-3">
            <p className="text-base font-semibold text-zinc-200">
              Sua lista ainda está vazia
            </p>
            <p className="text-sm text-zinc-400 max-w-md mx-auto">
              Salve filmes, séries e animes para assistir quando quiser — sincronizados diretamente
              com a sua sessão no R7 STREAMING.
            </p>
            <button
              type="button"
              onClick={onExplore}
              className="mt-2 inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#e50914] hover:bg-[#f6121d] text-white text-sm font-semibold cursor-pointer"
            >
              <Compass className="w-4 h-4" />
              <span>Explorar Catálogo</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-5">
            {favorites.map((vod) => (
              <VodCard
                key={vod.id}
                vod={vod}
                onSelect={onSelectVod}
                isFavorite={isFavorite}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
        )}
      </section>

      {/* Histórico / Continuar Assistindo */}
      <section className="space-y-5">
        <div className="flex items-center gap-2.5">
          <Clock className="w-5 h-5 text-zinc-300" />
          <h2 className="font-display text-xl sm:text-2xl font-bold text-white tracking-tight">
            Continuar Assistindo
          </h2>
          <span className="text-sm text-zinc-400 font-medium">({history.length})</span>
        </div>

        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Os títulos que você começar a assistir aparecerão aqui com o ponto exato de retomada.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-5">
            {history.map((item) => (
              <VodCard
                key={item.id}
                vod={item}
                onSelect={onSelectVod}
                progress={item}
                onRemove={onRemoveHistory}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
