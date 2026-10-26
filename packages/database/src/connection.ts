export interface DatabaseConfig {
  url: string;
  maxConnections?: number;
  ssl?: boolean;
}

export function parseDatabaseUrl(url: string): DatabaseConfig {
  return {
    url,
    maxConnections: 10,
    ssl: process.env.NODE_ENV === 'production',
  };
}
