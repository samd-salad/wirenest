import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Track all fetch calls for assertions
const fetchCalls: { url: string; method: string; body?: any }[] = [];

// Mock responses keyed by URL pattern
let mockResponses: Record<string, any> = {};

// Mock global fetch
vi.stubGlobal('fetch', async (url: string, opts?: RequestInit) => {
  const method = opts?.method ?? 'GET';
  const body = opts?.body ? JSON.parse(opts.body as string) : undefined;
  fetchCalls.push({ url, method, body });

  // Find matching mock response
  for (const [pattern, response] of Object.entries(mockResponses)) {
    if (url.includes(pattern)) {
      return {
        ok: true,
        status: 200,
        json: async () => response,
        text: async () => JSON.stringify(response),
      };
    }
  }

  return {
    ok: false,
    status: 404,
    json: async () => ({ error: 'not found' }),
    text: async () => 'not found',
  };
});

// Mock config
vi.mock('../src/config.js', () => ({
  loadConfig: () => ({
    wirenest: { url: 'http://localhost:5173' },
    wiki: { basePath: '/tmp/wiki' },
    pihole: { url: 'http://10.0.10.3', password: 'test-password' },
    pfsense: { url: 'https://10.0.10.1', apiKey: 'key', apiSecret: 'secret' },
  }),
}));

const { registerSyncTools } = await import('../src/connectors/sync.js');

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tools = (server as any)._registeredTools as Record<string, { handler: Function }>;
  const tool = tools[name];
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool.handler(args, {
    signal: new AbortController().signal,
    requestId: 'test',
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  });
}

describe('sync tools', () => {
  let server: McpServer;

  beforeEach(() => {
    fetchCalls.length = 0;
    mockResponses = {};
    server = new McpServer({ name: 'test', version: '0.0.1' });
    registerSyncTools(server);
  });

  describe('wirenest_sync_pihole', () => {
    it('creates new devices from Pi-hole clients', async () => {
      mockResponses = {
        '/api/auth': { session: { sid: 'test-sid' } },
        '/api/network/devices': {
          devices: [
            { hwaddr: 'aa:bb:cc:dd:ee:01', ip: '10.0.10.50', name: 'workstation-1' },
            { hwaddr: 'aa:bb:cc:dd:ee:02', ip: '10.0.10.51', name: 'phone-1' },
          ],
        },
        '/api/devices': { devices: [] }, // No existing devices
      };

      const result = await callTool(server, 'wirenest_sync_pihole', {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('2 created');
      expect(result.content[0].text).toContain('0 updated');

      // Verify POST calls were made to create devices
      const postCalls = fetchCalls.filter(c => c.method === 'POST' && c.url.includes('/api/devices'));
      // Filter out the auth call
      const devicePosts = postCalls.filter(c => !c.url.includes('/api/auth'));
      expect(devicePosts).toHaveLength(2);
    });

    it('updates existing devices matched by MAC', async () => {
      mockResponses = {
        '/api/auth': { session: { sid: 'test-sid' } },
        '/api/network/devices': {
          devices: [
            { hwaddr: 'aa:bb:cc:dd:ee:01', ip: '10.0.10.50', name: 'workstation-1' },
          ],
        },
        '/api/devices': {
          devices: [
            { id: 1, name: 'my-pc', mac: 'aa:bb:cc:dd:ee:01', ip: '10.0.10.99' },
          ],
        },
      };
      // Also mock the PUT endpoint
      mockResponses['/api/devices/1'] = { id: 1 };

      const result = await callTool(server, 'wirenest_sync_pihole', {});
      expect(result.content[0].text).toContain('0 created');
      expect(result.content[0].text).toContain('1 updated');
    });

    it('skips devices with user overrides', async () => {
      mockResponses = {
        '/api/auth': { session: { sid: 'test-sid' } },
        '/api/network/devices': {
          devices: [
            { hwaddr: 'aa:bb:cc:dd:ee:01', ip: '10.0.10.50', name: 'workstation-1' },
          ],
        },
        '/api/devices': {
          devices: [
            { id: 1, name: 'my-pc', mac: 'aa:bb:cc:dd:ee:01', ip: '10.0.10.50', userOverride: true },
          ],
        },
      };

      const result = await callTool(server, 'wirenest_sync_pihole', {});
      expect(result.content[0].text).toContain('0 created');
      expect(result.content[0].text).toContain('0 updated');
      expect(result.content[0].text).toContain('1 skipped');
      expect(result.content[0].text).toContain('user override');
    });

    it('dry run shows actions without writing', async () => {
      mockResponses = {
        '/api/auth': { session: { sid: 'test-sid' } },
        '/api/network/devices': {
          devices: [
            { hwaddr: 'aa:bb:cc:dd:ee:01', ip: '10.0.10.50', name: 'new-device' },
          ],
        },
        '/api/devices': { devices: [] },
      };

      const result = await callTool(server, 'wirenest_sync_pihole', { dryRun: true });
      expect(result.content[0].text).toContain('[DRY RUN]');
      expect(result.content[0].text).toContain('1 created');

      // Verify no POST/PUT calls were made to create/update
      const writeCalls = fetchCalls.filter(c =>
        (c.method === 'POST' || c.method === 'PUT') &&
        c.url.includes('/api/devices') &&
        !c.url.includes('/api/auth')
      );
      expect(writeCalls).toHaveLength(0);
    });
  });

  describe('wirenest_sync_dhcp', () => {
    it('creates new devices from DHCP leases', async () => {
      mockResponses = {
        '/api/v1/services/dhcpd/lease': {
          data: [
            { address: '10.0.30.10', mac: '11:22:33:44:55:01', hostname: 'docker-host' },
            { address: '10.0.30.11', mac: '11:22:33:44:55:02', hostname: 'k3s-node-1' },
          ],
        },
        '/api/devices': { devices: [] },
      };

      const result = await callTool(server, 'wirenest_sync_dhcp', {});
      expect(result.content[0].text).toContain('2 created');
    });

    it('updates existing devices matched by IP', async () => {
      mockResponses = {
        '/api/v1/services/dhcpd/lease': {
          data: [
            { address: '10.0.30.10', mac: '11:22:33:44:55:01', hostname: 'docker-host' },
          ],
        },
        '/api/devices': {
          devices: [
            { id: 5, name: 'docker-host', ip: '10.0.30.10' },
          ],
        },
        '/api/devices/5': { id: 5 },
      };

      const result = await callTool(server, 'wirenest_sync_dhcp', {});
      expect(result.content[0].text).toContain('1 updated');
      expect(result.content[0].text).toContain('0 created');
    });

    it('handles empty lease list gracefully', async () => {
      mockResponses = {
        '/api/v1/services/dhcpd/lease': { data: [] },
        '/api/devices': { devices: [] },
      };

      const result = await callTool(server, 'wirenest_sync_dhcp', {});
      expect(result.content[0].text).toContain('No DHCP leases found');
    });
  });

  describe('wirenest_sync_arp', () => {
    it('updates MAC addresses on matched devices', async () => {
      mockResponses = {
        '/api/v1/diagnostics/arp': {
          data: [
            { ip: '10.0.10.50', mac: 'aa:bb:cc:dd:ee:ff' },
            { ip: '10.0.10.51', mac: '11:22:33:44:55:66' },
          ],
        },
        '/api/devices': {
          devices: [
            { id: 1, name: 'server-1', ip: '10.0.10.50', mac: null },
            { id: 2, name: 'server-2', ip: '10.0.10.51', mac: '00:00:00:00:00:00' },
          ],
        },
        '/api/devices/1': { id: 1 },
        '/api/devices/2': { id: 2 },
      };

      const result = await callTool(server, 'wirenest_sync_arp', {});
      expect(result.content[0].text).toContain('2 updated');

      // Verify PUT calls
      const putCalls = fetchCalls.filter(c => c.method === 'PUT');
      expect(putCalls).toHaveLength(2);
    });

    it('skips devices not in WireNest', async () => {
      mockResponses = {
        '/api/v1/diagnostics/arp': {
          data: [
            { ip: '10.0.10.99', mac: 'aa:bb:cc:dd:ee:ff' },
          ],
        },
        '/api/devices': { devices: [] },
      };

      const result = await callTool(server, 'wirenest_sync_arp', {});
      expect(result.content[0].text).toContain('0 updated');
      expect(result.content[0].text).toContain('1 skipped');
    });

    it('skips incomplete ARP entries', async () => {
      mockResponses = {
        '/api/v1/diagnostics/arp': {
          data: [
            { ip: '10.0.10.50', mac: '(incomplete)' },
          ],
        },
        '/api/devices': {
          devices: [
            { id: 1, name: 'server-1', ip: '10.0.10.50' },
          ],
        },
      };

      const result = await callTool(server, 'wirenest_sync_arp', {});
      expect(result.content[0].text).toContain('0 updated');
    });

    it('skips devices where MAC already matches', async () => {
      mockResponses = {
        '/api/v1/diagnostics/arp': {
          data: [
            { ip: '10.0.10.50', mac: 'aa:bb:cc:dd:ee:ff' },
          ],
        },
        '/api/devices': {
          devices: [
            { id: 1, name: 'server-1', ip: '10.0.10.50', mac: 'AA:BB:CC:DD:EE:FF' },
          ],
        },
      };

      const result = await callTool(server, 'wirenest_sync_arp', {});
      expect(result.content[0].text).toContain('0 updated');
    });
  });
});
