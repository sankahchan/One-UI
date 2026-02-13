import { useEffect, useRef, useState } from 'react';
import { Search, Server, User, Users, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import apiClient from '../../api/client';

interface SearchResult {
  id: number;
  type: 'user' | 'inbound' | 'group';
  label: string;
  sublabel: string;
}

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const requestTokenRef = useRef(0);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;

    const debounceTimer = setTimeout(async () => {
      const trimmedQuery = query.trim();

      if (trimmedQuery.length < 2) {
        setResults([]);
        setIsOpen(false);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const payload = await apiClient.get('/search/quick', {
          params: { q: trimmedQuery },
          signal: controller.signal
        });

        if (requestTokenRef.current !== requestToken) {
          return;
        }

        setResults((payload?.data || []) as SearchResult[]);
        setIsOpen(true);
      } catch (error: any) {
        const canceled = error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED';
        if (!canceled && requestTokenRef.current === requestToken) {
          setResults([]);
        }
      } finally {
        if (requestTokenRef.current === requestToken) {
          setIsLoading(false);
        }
      }
    }, 260);

    return () => {
      controller.abort();
      clearTimeout(debounceTimer);
    };
  }, [query]);

  const handleSelect = (result: SearchResult) => {
    if (result.type === 'user') {
      navigate(`/users/${result.id}`);
    } else if (result.type === 'group') {
      navigate(`/groups/${result.id}`);
    } else {
      navigate('/inbounds');
    }

    setQuery('');
    setIsOpen(false);
  };

  return (
    <div className="relative w-full max-w-md" ref={dropdownRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => (query.trim().length >= 2 ? setIsOpen(true) : undefined)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setIsOpen(false);
            }
          }}
          placeholder="Search users, inbounds & groups"
          className="h-10 w-full rounded-xl border border-line/80 bg-card/80 py-2 pl-10 pr-9 text-sm text-foreground placeholder:text-muted focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        {query ? (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              setIsOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition hover:bg-card hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <div className="absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-2xl border border-line/80 bg-card/95 shadow-soft backdrop-blur-xl">
          {isLoading ? (
            <div className="flex items-center justify-center p-4 text-sm text-muted">
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-muted/35 border-t-brand-500" />
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted">No results found</div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-2">
              {results.map((result) => (
                <li key={`${result.type}-${result.id}`}>
                  <button
                    onClick={() => handleSelect(result)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-card"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-line/60 bg-panel/70">
                      {result.type === 'user' ? <User className="h-4 w-4 text-muted" /> : result.type === 'group' ? <Users className="h-4 w-4 text-muted" /> : <Server className="h-4 w-4 text-muted" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{result.label}</p>
                      <p className="truncate text-xs text-muted">{result.sublabel}</p>
                    </div>
                    <span className="rounded-full border border-line/70 bg-panel/80 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                      {result.type}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
