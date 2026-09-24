'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, AuthUser } from '@/lib/api';
import { BharatLogo } from '@/components/layout/bharat-logo';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let ignore = false;
    const checkSession = async () => {
      try {
        const res = await api.auth.me();
        if (!ignore) {
          setUser(res.user);
          setStatus('authenticated');
        }
      } catch {
        if (!ignore) {
          setUser(null);
          setStatus('unauthenticated');
        }
      }
    };

    void checkSession();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setStatus('unauthenticated');
    };
    window.addEventListener('bg:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('bg:unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated' && pathname !== '/login') {
      router.replace('/login');
    } else if (status === 'authenticated' && pathname === '/login') {
      router.replace('/');
    }
  }, [status, pathname, router]);

  const login = useCallback(async (username: string, password: string): Promise<AuthUser> => {
    const res = await api.auth.login(username, password);
    setUser(res.user);
    setStatus('authenticated');
    return res.user;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.auth.logout();
    } catch {
      // Session is considered logged out even if the server is unreachable.
    }
    setUser(null);
    setStatus('unauthenticated');
    router.replace('/login');
  }, [router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#007BC9] flex flex-col items-center justify-center">
        <div className="rounded-2xl bg-white/10 border border-white/15 p-8 flex flex-col items-center gap-4 shadow-xl">
          <BharatLogo size="lg" />
          <div className="flex items-center gap-2 text-blue-100 text-sm">
            <span className="h-2 w-2 rounded-full bg-[#FFDC02] animate-pulse" />
            Connecting to secure portal…
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ status, user, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return ctx;
}