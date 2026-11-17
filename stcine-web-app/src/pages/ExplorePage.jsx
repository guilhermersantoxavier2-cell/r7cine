import React, { useEffect, useState } from 'react';
import { SlidersHorizontal, Loader2, RotateCcw } from 'lucide-react';
import VodCard from '../components/VodCard';
import { stcineApi } from '../api/stcine';

export default function ExplorePage({
  initialGenre = '',
  initialTypeId = 1,
  onSelectVod,
  isFavorite,
  onToggleFavorite,
}) {
  const [filterTree, setFilterTree] = useState([]);
  const [typeId, setTypeId] = useState(initialTypeId || 1);
  const [genre, setGenre] = useState(initialGenre || 'Tudo');
  const [year, setYear] = useState('Tudo');
  const [sort, setSort] = useState('Popularidade');

  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Aplica gênero vindo da ficha de um título
  useEffect(() => {
    if (initialGenre) setGenre(initialGenre);
    if (initialTypeId) setTypeId(Number(initialTypeId) === 2 ? 2 : 1);
  }, [initialGenre, initialTypeId]);

  useEffect(() => {
    stcineApi
      .getFilters()
      .then((data) => {
        if (Array.isArray(data)) setFilterTree(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPage(1);

    stcineApi
      .browseCatalog({ typeId, genre, year, sort, page: 1 })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items || []);
        setHasMore(Boolean(res.has_more));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [typeId, genre, year, sort]);

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await stcineApi.browseCatalog({ typeId, genre, year, sort, page: nextPage });
      const newItems = res.items || [];
      setItems((prev) => {
        const existing = new Set(prev.map((i) => i.id));
        return [...prev, ...newItems.filter((i) => !existing.has(i.id))];
      });
      setPage(nextPage);
      setHasMore(Boolean(res.has_more));
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  const activeCategory =
    filterTree.find((c) => Number(c.type_id) === Number(typeId)) || filterTree[0] || null;
  const genres = activeCategory?.genres || ['Tudo', 'Ação', 'Drama', 'Comédia', 'Suspense', 'Anime'];
  const years = activeCategory?.years || ['Tudo', '2026', '2025', '2024', '2023', '2022', '2021'];
  const sorts = activeCategory?.sorts || ['Popularidade', 'Mais recentes', 'Top hoje'];

  const hasActiveFilter = genre !== 'Tudo' || year !== 'Tudo' || sort !== 'Popularidade';

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-7 lg:px-10 pt-24 pb-20 space-y-7">
      {/* Cabeçalho + seletor Filmes / Séries */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Explorar Catálogo
          </h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            Filtre por formato, gênero, ano de lançamento e popularidade
          </p>
        </div>

        <div className="inline-flex bg-[#11131c] border border-white/10 rounded-xl p-1 gap-1">
          {(filterTree.length > 0
            ? filterTree
            : [
                { type_id: 1, name: 'Filmes' },
                { type_id: 2, name: 'Séries & Novelas' },
              ]
          ).map((cat) => (
            <button
              key={cat.type_id}
              type="button"
              onClick={() => {
                setTypeId(cat.type_id);
                setGenre('Tudo');
              }}
              className={`px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                Number(typeId) === Number(cat.type_id)
                  ? 'bg-[#e50914] text-white shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Painel de filtros enxuto */}
      <div className="bg-[#10121b] border border-white/[0.07] rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-zinc-400 mr-1" />
            {sorts.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  sort === s
                    ? 'bg-white text-black'
                    : 'bg-white/[0.05] text-zinc-300 hover:bg-white/[0.1]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2.5">
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              aria-label="Filtrar por ano"
              className="h-8 px-3 rounded-lg bg-white/[0.06] border border-white/10 text-xs font-medium text-zinc-200 focus:outline-none focus:border-[#e50914] cursor-pointer"
            >
              {years.slice(0, 35).map((y) => (
                <option key={y} value={y} className="bg-[#11131c]">
                  {y === 'Tudo' ? 'Todos os anos' : y}
                </option>
              ))}
            </select>

            {hasActiveFilter && (
              <button
                type="button"
                onClick={() => {
                  setGenre('Tudo');
                  setYear('Tudo');
                  setSort('Popularidade');
                }}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-white/[0.07] cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Limpar</span>
              </button>
            )}
          </div>
        </div>

        {/* Chips de gêneros */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
          {genres.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGenre(g)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                genre === g
                  ? 'bg-[#e50914]/20 border-[#e50914] text-white'
                  : 'bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-white hover:border-white/20'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Grade de resultados */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-[2/3] rounded-xl bg-white/[0.05] animate-pulse" />
              <div className="h-3.5 w-3/4 rounded bg-white/[0.05] animate-pulse" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-20 text-center space-y-2">
          <p className="text-base font-semibold text-zinc-200">
            Nenhum título encontrado para esta combinação de filtros.
          </p>
          <p className="text-sm text-zinc-500">Tente selecionar outro gênero ou ano.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-5">
            {items.map((vod) => (
              <VodCard
                key={vod.id}
                vod={vod}
                onSelect={onSelectVod}
                isFavorite={isFavorite}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 h-11 px-7 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-sm font-semibold text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{loadingMore ? 'Carregando...' : 'Carregar mais títulos'}</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
