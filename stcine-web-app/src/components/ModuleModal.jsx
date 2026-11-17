import React, { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import VodCard from './VodCard';
import { stcineApi } from '../api/stcine';

export default function ModuleModal({
  section,
  onClose,
  onSelectVod,
  isFavorite,
  onToggleFavorite,
}) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!section?.module_id) return undefined;
    let cancelled = false;
    setLoading(true);
    setPage(1);

    stcineApi
      .getModuleMore(section.module_id, 1)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items?.length ? res.items : section.items || []);
        setHasMore(Boolean(res.has_more));
      })
      .catch(() => {
        if (!cancelled) setItems(section.items || []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
    };
  }, [section, onClose]);

  if (!section) return null;

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await stcineApi.getModuleMore(section.module_id, nextPage);
      const next = res.items || [];
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...next.filter((i) => !seen.has(i.id))];
      });
      setPage(nextPage);
      setHasMore(Boolean(res.has_more));
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#08090d]/95 backdrop-blur-2xl overflow-y-auto">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-7 lg:px-10 py-7 space-y-6">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
          <h2 className="font-display text-2xl font-extrabold text-white">{section.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="w-7 h-7 text-[#e50914] animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {items.map((vod) => (
                <VodCard
                  key={vod.id}
                  vod={vod}
                  onSelect={(id) => {
                    onClose();
                    onSelectVod(id);
                  }}
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
                  className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer"
                >
                  {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Carregar mais</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
