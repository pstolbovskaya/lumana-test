export interface RedisConnectionParts {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
}

export function parseRedisUrl(url: string): RedisConnectionParts {
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`Unsupported Redis URL protocol: ${parsed.protocol}`);
  }
  const dbPart = parsed.pathname.replace(/^\//, '');
  return {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: dbPart ? Number(dbPart) : undefined,
  };
}
