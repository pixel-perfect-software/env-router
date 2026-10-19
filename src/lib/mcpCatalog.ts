// A short list of well-known MCP servers, written from each one's own README, so adding one
// is a pick and a token rather than a search. Remote servers that sign in with OAuth need no
// secret here: the agent signs in itself with /mcp.

import type { McpServer } from './types'

export interface CatalogEntry {
  /** The name it's added under. */
  name: string
  label: string
  description: string
  server: McpServer
  /** Env or header names left for the user to fill with a secret, and what to type there. */
  secrets?: Record<string, string>
}

export const catalog = (home: string): CatalogEntry[] => [
  {
    name: 'github',
    label: 'GitHub',
    description: "GitHub's remote server: repositories, issues, pull requests and Actions. Takes a personal access token.",
    server: { transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: '' } },
    secrets: { Authorization: 'Bearer github_pat_…' },
  },
  {
    name: 'playwright',
    label: 'Playwright',
    description: 'Drives a real browser through accessibility snapshots.',
    server: { transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], env: {} },
  },
  {
    name: 'context7',
    label: 'Context7',
    description: 'Current documentation and code examples for libraries.',
    server: { transport: 'http', url: 'https://mcp.context7.com/mcp', headers: {} },
  },
  {
    name: 'linear',
    label: 'Linear',
    description: 'Issues, projects and comments. Signs in with /mcp.',
    server: { transport: 'http', url: 'https://mcp.linear.app/mcp', headers: {} },
  },
  {
    name: 'notion',
    label: 'Notion',
    description: 'Search, read and edit pages and databases. Signs in with /mcp.',
    server: { transport: 'http', url: 'https://mcp.notion.com/mcp', headers: {} },
  },
  {
    name: 'sentry',
    label: 'Sentry',
    description: 'Issues, errors and releases. Signs in with /mcp.',
    server: { transport: 'http', url: 'https://mcp.sentry.dev/mcp', headers: {} },
  },
  {
    name: 'filesystem',
    label: 'Filesystem',
    description: 'Reads and writes files inside the folders listed as its arguments.',
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', home], env: {} },
  },
  {
    name: 'fetch',
    label: 'Fetch',
    description: 'Fetches a URL and turns the page into Markdown. Needs uv.',
    server: { transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], env: {} },
  },
  {
    name: 'git',
    label: 'Git',
    description: 'Reads and changes local Git repositories. Needs uv.',
    server: { transport: 'stdio', command: 'uvx', args: ['mcp-server-git'], env: {} },
  },
  {
    name: 'memory',
    label: 'Memory',
    description: 'A knowledge graph the agent keeps between sessions.',
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: {} },
  },
  {
    name: 'sequential-thinking',
    label: 'Sequential Thinking',
    description: 'Structured, step-by-step problem solving.',
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], env: {} },
  },
]
