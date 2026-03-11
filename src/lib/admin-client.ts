// HTTP client for the gameserver benchmark admin API.

export interface AdminClient {
  reset(): Promise<void>;
  getEventLog(): Promise<unknown[]>;
  getPlayerStats(playerId: string): Promise<Record<string, unknown>>;
}

export function createAdminClient(serverUrl: string, adminToken: string): AdminClient {
  const baseUrl = serverUrl.replace(/\/$/, "");

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const resp = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Admin API ${method} ${path} failed: ${resp.status} ${text}`);
    }
    return resp.json();
  }

  return {
    async reset() {
      await request("POST", "/api/admin/benchmark/reset");
    },

    async getEventLog() {
      const data = await request("GET", "/api/admin/benchmark/event-log");
      return Array.isArray(data) ? data : [];
    },

    async getPlayerStats(playerId: string) {
      const data = await request("GET", `/api/admin/benchmark/player-stats?player_id=${encodeURIComponent(playerId)}`);
      return (data as Record<string, unknown>) || {};
    },
  };
}
