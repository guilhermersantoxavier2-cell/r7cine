import React, { useEffect, useState, useCallback } from 'react';
import Navbar from './components/Navbar';
import HeroCarousel from './components/HeroCarousel';
import VodRow from './components/VodRow';
import SearchModal from './components/SearchModal';
import ModuleModal from './components/ModuleModal';
import AccountModal from './components/AccountModal';
import WatchPage from './pages/WatchPage';
import ExplorePage from './pages/ExplorePage';
import RankingsPage from './pages/RankingsPage';
import MyListPage from './pages/MyListPage';
import {
  stcineApi,
  getStoredSession,
  getLocalHistory,
  removeLocalHistory,
  getLocalFavorites,
  saveLocalFavorites,
} from './api/stcine';
import { RefreshCw } from 'lucide-react';

function parseHashRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash.startsWith('watch/')) {
    const id = Number(hash.slice('watch/'.length));
    if (id) return { view: 'watch', vodId: id };
  }
  if (['explore', 'rankings', 'mylist'].includes(hash)) {
    return { view: hash, vodId: null };
  }
  return { view: 'home', vodId: null };
}

export default function App() {
  const initial = parseHashRoute();
  const [view, setView] = useState(initial.view);
  const [previousView, setPreviousView] = useState('home');
  const [activeVodId, setActiveVodId] = useState(initial.vodId);

  const [session, setSession] = useState(() => getStoredSession());
  const [tabs, setTabs] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState(4);
  const [homeData, setHomeData] = useState({ banners: [], sections: [] });
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState('');

  const [favorites, setFavorites] = useState(() => getLocalFavorites());
  const [history, setHistory] = useState(() => getLocalHistory());

  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [moreSection, setMoreSection] = useState(null);
  const [explorePreset, setExplorePreset] = useState({ genre: '', typeId: 1 });

  // Sincronização com histórico de navegação do browser (hash routing)
  useEffect(() => {
    const onHashChange = () => {
      const next = parseHashRoute();
      setView(next.view);
      setActiveVodId(next.vodId);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Atalho global de busca (`/` ou Ctrl/Cmd+K)
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key === '/' && !isTyping && !searchOpen) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);

  // Bootstrap da sessão Web + categorias + favoritos em nuvem
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const init = await stcineApi.initSession();
        if (cancelled) return;
        setSession((prev) => ({
          ...prev,
          deviceId: init.device_id,
          token: init.token,
          user: init.user || prev.user,
          activeDomain: init.active_domain,
        }));

        const [tabList, cloudFavs] = await Promise.all([
          stcineApi.getTabs().catch(() => []),
          stcineApi.getCloudFavorites().catch(() => []),
        ]);
        if (cancelled) return;
        if (Array.isArray(tabList) && tabList.length > 0) {
          setTabs(tabList);
        }
        if (Array.isArray(cloudFavs) && cloudFavs.length > 0) {
          setFavorites((prev) => {
            const map = new Map();
            [...cloudFavs, ...prev].forEach((v) => {
              if (v?.id) map.set(Number(v.id), v);
            });
            const merged = Array.from(map.values());
            saveLocalFavorites(merged);
            return merged;
          });
        }
      } catch {
        // segue carregando Home normalmente (API faz auto-init)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Carrega conteúdo da Home para a categoria ativa
  const loadHome = useCallback(async (catId) => {
    setHomeLoading(true);
    setHomeError('');
    try {
      const data = await stcineApi.getHome(catId, 1, 12);
      setHomeData({
        banners: data?.banners || [],
        sections: data?.sections || [],
      });
    } catch (err) {
      setHomeError(err.message || 'Falha ao comunicar com a API do R7 STREAMING.');
    } finally {
      setHomeLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHome(activeCategoryId);
  }, [activeCategoryId, loadHome]);

  const navigateTo = useCallback((nextView) => {
    setView(nextView);
    setActiveVodId(null);
    window.location.hash = nextView === 'home' ? '' : `#${nextView}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openVod = useCallback(
    (vodId) => {
      if (!vodId) return;
      if (view !== 'watch') setPreviousView(view);
      setActiveVodId(Number(vodId));
      setView('watch');
      window.location.hash = `#watch/${vodId}`;
    },
    [view]
  );

  const handleSelectGenre = useCallback((genre, typePid) => {
    setExplorePreset({ genre, typeId: Number(typePid) === 2 ? 2 : 1 });
    setView('explore');
    setActiveVodId(null);
    window.location.hash = '#explore';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const isFavorite = useCallback(
    (vodId) => favorites.some((f) => Number(f.id) === Number(vodId)),
    [favorites]
  );

  const toggleFavorite = useCallback((vod) => {
    if (!vod?.id) return;
    setFavorites((prev) => {
      const exists = prev.some((item) => Number(item.id) === Number(vod.id));
      const next = exists
        ? prev.filter((item) => Number(item.id) !== Number(vod.id))
        : [vod, ...prev];
      saveLocalFavorites(next);
      stcineApi.setCloudFavorite(vod.id, !exists, vod.type_pid || 1).catch(() => {});
      return next;
    });
  }, []);

  const handleRemoveHistory = useCallback((vodId) => {
    const next = removeLocalHistory(vodId);
    setHistory(next);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#08090d] text-[#f3f4f8]">
      <Navbar
        activeView={view}
        onNavigate={navigateTo}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenAccount={() => setAccountOpen(true)}
        favoritesCount={favorites.length}
        session={session}
      />

      <main className="flex-1">
        {view === 'home' && (
          <div className="pb-20">
            {/* Hero 4K Widescreen */}
            {homeLoading && homeData.banners.length === 0 ? (
              <div className="w-full h-[60vh] min-h-[420px] bg-gradient-to-b from-[#131622] to-[#08090d] animate-pulse" />
            ) : homeData.banners.length > 0 ? (
              <HeroCarousel
                banners={homeData.banners}
                onSelectVod={openVod}
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavorite}
              />
            ) : (
              <div className="pt-20" />
            )}

            {/* Barra de categorias dinâmicas da API (/api/home/tabs) */}
            {tabs.length > 0 && (
              <div className="max-w-[1440px] mx-auto px-4 sm:px-7 lg:px-10 -mt-5 relative z-20 mb-8">
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                  {tabs.map((tab) => {
                    const active = Number(tab.id) === Number(activeCategoryId);
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveCategoryId(tab.id)}
                        className={`shrink-0 px-4 py-2 rounded-full text-xs sm:text-[13px] font-semibold border backdrop-blur-md transition-all cursor-pointer ${
                          active
                            ? 'bg-[#e50914] border-[#e50914] text-white shadow-[0_6px_20px_rgba(229,9,20,0.38)]'
                            : 'bg-[#11131d]/85 hover:bg-[#1a1d2b] border-white/10 text-zinc-300 hover:text-white'
                        }`}
                      >
                        {tab.channel_name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Trilhos de catálogo */}
            <div className="max-w-[1440px] mx-auto space-y-10">
              {/* Trilho "Continuar Assistindo" na aba Início */}
              {Number(activeCategoryId) === 4 && history.length > 0 && (
                <VodRow
                  section={{
                    module_id: 'history',
                    title: 'Continuar Assistindo',
                    items: history,
                    has_more: false,
                    can_refresh: false,
                  }}
                  isHistoryRow
                  onSelectVod={openVod}
                  onRemoveHistory={handleRemoveHistory}
                />
              )}

              {homeError ? (
                <div className="px-4 sm:px-7 lg:px-10 py-16 text-center space-y-3">
                  <p className="text-base font-semibold text-zinc-200">{homeError}</p>
                  <button
                    type="button"
                    onClick={() => loadHome(activeCategoryId)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#e50914] hover:bg-[#f6121d] text-white text-sm font-semibold cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Tentar novamente</span>
                  </button>
                </div>
              ) : homeLoading ? (
                <div className="space-y-9 px-4 sm:px-7 lg:px-10">
                  {[1, 2, 3].map((row) => (
                    <div key={row} className="space-y-3.5">
                      <div className="h-5 w-48 rounded bg-white/[0.06] animate-pulse" />
                      <div className="flex gap-4 overflow-hidden">
                        {Array.from({ length: 7 }).map((_, idx) => (
                          <div
                            key={idx}
                            className="shrink-0 w-[140px] sm:w-[168px] aspect-[2/3] rounded-xl bg-white/[0.05] animate-pulse"
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                homeData.sections.map((section) => (
                  <VodRow
                    key={`${activeCategoryId}-${section.module_id}`}
                    section={section}
                    onSelectVod={openVod}
                    onOpenMore={setMoreSection}
                    isFavorite={isFavorite}
                    onToggleFavorite={toggleFavorite}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {view === 'explore' && (
          <ExplorePage
            initialGenre={explorePreset.genre}
            initialTypeId={explorePreset.typeId}
            onSelectVod={openVod}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
          />
        )}

        {view === 'rankings' && (
          <RankingsPage
            onSelectVod={openVod}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
          />
        )}

        {view === 'mylist' && (
          <MyListPage
            favorites={favorites}
            history={history}
            onSelectVod={openVod}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
            onRemoveHistory={handleRemoveHistory}
            onExplore={() => navigateTo('explore')}
          />
        )}

        {view === 'watch' && activeVodId && (
          <WatchPage
            vodId={activeVodId}
            onBack={() => navigateTo(previousView || 'home')}
            onSelectVod={openVod}
            onSelectGenre={handleSelectGenre}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
            onHistoryUpdated={setHistory}
          />
        )}
      </main>

      {/* Rodapé minimalista */}
      <footer className="border-t border-white/[0.06] bg-[#06070b]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-7 lg:px-10 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500">
          <div className="flex items-center gap-2.5">
            <img
              src="/serve.png"
              alt="R7 STREAMING"
              className="w-7 h-7 rounded-lg object-cover bg-black ring-1 ring-white/15"
            />
            <span className="font-display font-extrabold text-zinc-200 tracking-wide">
              <span className="text-[#e50914]">R7</span> STREAMING
            </span>
            <span className="hidden sm:inline">· Filmes, Séries & Animes em HD</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigateTo('home')}
              className="hover:text-zinc-300 cursor-pointer"
            >
              Início
            </button>
            <button
              type="button"
              onClick={() => navigateTo('explore')}
              className="hover:text-zinc-300 cursor-pointer"
            >
              Explorar
            </button>
            <button
              type="button"
              onClick={() => navigateTo('rankings')}
              className="hover:text-zinc-300 cursor-pointer"
            >
              Em Alta
            </button>
            <a
              href={stcineApi.getDocsUrl()}
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-300"
            >
              API Console
            </a>
          </div>
        </div>
      </footer>

      {/* Modais globais */}
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectVod={openVod}
        isFavorite={isFavorite}
        onToggleFavorite={toggleFavorite}
      />

      <ModuleModal
        section={moreSection}
        onClose={() => setMoreSection(null)}
        onSelectVod={openVod}
        isFavorite={isFavorite}
        onToggleFavorite={toggleFavorite}
      />

      <AccountModal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        session={session}
        onSessionChange={setSession}
      />
    </div>
  );
}
