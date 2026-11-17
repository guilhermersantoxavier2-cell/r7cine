import React, { useEffect, useRef, useState } from 'react';
import { Search, X, TrendingUp, Loader2 } from 'lucide-react';
import VodCard from './VodCard';
import { stcineApi } from '../api/stcine';

export default function SearchModal({
  open,
  onClose,
  onSelectVod,
  isFavorite,
  onToggleFavorite,
}) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [hotItems, setHotItems] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [results, setResults] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Foco automático e carregamento de Em Alta
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    if (hotItems.length === 0) {
      stcineApi
        .getHotSearch()
        .then((list) => setHotItems(list || []))
        .catch(() => {});
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, hotItems.length, onClose]);

  // Busca com debounce
  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim();
    if (!q) {
      setSuggestions([]);
      setResults([]);
      setHasMore(false);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const [sug, srch] = await Promise.all([
          stcineApi.searchSuggest(q, controller.signal).catch(() => []),
          stcineApi.search(q, { page: 1, signal: controller.signal }),
        ]);
        setSuggestions(Array.isArray(sug) ? sug.slice(0, 8) : []);
        setResults(srch?.items || []);
        setPage(1);
        setHasMore(Boolean(srch?.has_more));
      } catch (err) {
        if (err?.name !== 'AbortError') setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 280);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  if (!open) return null;

  const handlePick = (id) => {
    onClose();
    onSelectVod(id);
  };

  const handleLoadMore = async () => {
    const q = query.trim();
    if (!q || loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const srch = await stcineApi.search(q, { page: nextPage });
      const next = srch?.items || [];
      setResults((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...next.filter((i) => !seen.has(i.id))];
      });
      setPage(nextPage);
      setHasMore(Boolean(srch?.has_more));
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#08090d]/95 backdrop-blur-2xl overflow-y-auto">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-7 lg:px-10 py-6 sm:py-8 space-y-6">
        {/* Campo de busca */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-5 h-5 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Busque filmes, séries, animes, atores ou diretores..."
              className="w-full h-13 pl-12 pr-11 rounded-2xl bg-[#121521] border border-white/15 focus:border-[#e50914] focus:outline-none text-base text-white placeholder:text-zinc-500"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="h-13 px-4 rounded-2xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/10 text-sm font-medium text-zinc-200 cursor-pointer"
          >
            Fechar
          </button>
        </div>

        {/* Sugestões de autocomplete */}
        {query.trim() && suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handlePick(s.id)}
                className="px-3 py-1 rounded-full bg-white/[0.06] hover:bg-[#e50914]/25 border border-white/10 text-xs text-zinc-200 transition-colors cursor-pointer"
              >
                {s.vod_name}
              </button>
            ))}
          </div>
        )}

        {/* Estado: carregando / resultados / em alta */}
        {query.trim() ? (
          loading ? (
            <div className="py-16 flex items-center justify-center gap-2.5 text-zinc-400">
              <Loader2 className="w-5 h-5 animate-spin text-[#e50914]" />
              <span className="text-sm">Buscando "{query.trim()}"...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="py-20 text-center space-y-1.5">
              <p className="text-base font-semibold text-zinc-200">
                Nenhum resultado encontrado para "{query.trim()}"
              </p>
              <p className="text-sm text-zinc-500">Tente pesquisar com palavras diferentes.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Resultados para "{query.trim()}"
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {results.map((vod) => (
                  <VodCard
                    key={vod.id}
                    vod={vod}
                    onSelect={handlePick}
                    isFavorite={isFavorite}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer"
                  >
                    {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Mais resultados</span>
                  </button>
                </div>
              )}
            </div>
          )
        ) : (
          hotItems.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
                <TrendingUp className="w-4 h-4 text-[#ff404c]" />
                <span>Mais Buscados Hoje</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {hotItems.slice(0, 12).map((vod, idx) => (
                  <VodCard
                    key={vod.id}
                    vod={vod}
                    rank={idx + 1}
                    onSelect={handlePick}
                    isFavorite={isFavorite}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
