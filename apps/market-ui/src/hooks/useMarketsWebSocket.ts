import { useState, useEffect, useCallback } from 'react';

interface ExchangeMarket {
  rank: number;
  name: string;
  pair: string;
  price: string;
  depth: { bid: string; ask: string };
  volume24h: string;
  volumePercent: string;
  liquidity: number;
  spreadBps: number;
  lastUpdate: string;
  symbol: string;
  market_type?: 'spot' | 'perpetual' | 'futures';
}

interface MarketsData {
  asset: string;
  exchanges: ExchangeMarket[];
  metadata: {
    updated_at: string;
    source: string;
    cached?: boolean;
    health: string;
    error?: string;
  };
}

interface UseMarketsWebSocketOptions {
  asset?: string;
  limit?: number;
}

export function useMarketsWebSocket(options: UseMarketsWebSocketOptions = {}) {
  const { asset = 'BTC', limit = 50 } = options;

  const [data, setData] = useState<MarketsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const apiUrl = import.meta.env.VITE_GRAVITY_API_URL || 'https://gravity-api-prod.fly.dev';
    const wsUrl = apiUrl.replace('https://', 'wss://').replace('http://', 'ws://');

    let disposed = false;          // set on unmount; suppresses error + reconnect
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(`${wsUrl}/api/trading/markets/ws?asset=${asset}`);

      ws.onopen = () => {
        if (disposed) return;
        setLoading(false);
        setError(null);
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const message = JSON.parse(event.data);
          if (message.error) {
            setError(message.error);
          } else {
            setData(message);
            setError(null);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to parse message');
        }
      };

      ws.onclose = () => {
        if (disposed) return; // intentional unmount close — stay silent
        setError('Connection closed');
        // auto-reconnect after a short backoff
        retry = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [asset]);

  return {
    data,
    loading,
    error,
  };
}
